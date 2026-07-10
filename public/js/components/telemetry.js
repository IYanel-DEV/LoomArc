/**
 * TelemetryMonitor — SSE-driven live charts + player list for the Monitoring tab.
 *
 * Usage:
 *   const mon = new TelemetryMonitor(hostEl, processMap, apiKey);
 *   // later:
 *   mon.destroy();
 */

const HISTORY_POINTS = 60; // points shown on chart (last 60 s)

function fmtMem(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576)    return (bytes / 1048576   ).toFixed(0) + ' MB';
  if (bytes >= 1024)       return (bytes / 1024      ).toFixed(0) + ' KB';
  return bytes + ' B';
}

// ── Animated sparkline chart on a <canvas> ─────────────────────────────────────

class SparkLine {
  constructor(canvas, color) {
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._color  = color;
    this._data   = [];
    this._raf    = null;
  }

  push(v) {
    this._data.push(v);
    if (this._data.length > HISTORY_POINTS) this._data.shift();
    this._schedDraw();
  }

  seed(values) {
    this._data = values.slice(-HISTORY_POINTS);
    this._schedDraw();
  }

  _schedDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  _draw() {
    const c   = this._canvas;
    const ctx = this._ctx;
    const d   = this._data;
    const col = this._color;
    const W   = c.width;
    const H   = c.height;

    ctx.clearRect(0, 0, W, H);
    if (d.length < 2) return;

    const max = Math.max(...d, 1);
    const toX = i => (i / (HISTORY_POINTS - 1)) * W;
    const toY = v => H - 2 - (v / max) * (H - 6);

    // Gradient fill under the line
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, col + '55');
    gr.addColorStop(1, col + '00');
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(d[0]));
    for (let i = 1; i < d.length; i++) ctx.lineTo(toX(i), toY(d[i]));
    ctx.lineTo(toX(d.length - 1), H);
    ctx.lineTo(toX(0), H);
    ctx.closePath();
    ctx.fillStyle = gr;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(d[0]));
    for (let i = 1; i < d.length; i++) ctx.lineTo(toX(i), toY(d[i]));
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Dot at the current (rightmost) point
    const lx = toX(d.length - 1);
    const ly = toY(d[d.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle   = col;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}

// ── TelemetryMonitor ──────────────────────────────────────────────────────────

export class TelemetryMonitor {
  /**
   * @param {HTMLElement} host        - Container element to render into
   * @param {Map<string,{name,label}>} processMap - processId → display meta
   * @param {string} apiKey
   */
  constructor(host, processMap, token) {
    this._host       = host;
    this._processMap = processMap;
    this._apiKey     = token; // kept as _apiKey internally for minimal diff
    this._charts     = new Map();  // processId → { cpu: SparkLine, mem: SparkLine }
    this._sse        = null;
    this._dead       = false;

    this._render();
    this._openSSE();
  }

  _render() {
    this._host.innerHTML = '';

    if (this._processMap.size === 0) {
      this._host.innerHTML = `<div class="telemetry-empty">No servers in this network yet.</div>`;
      return;
    }

    for (const [processId, meta] of this._processMap) {
      const row = document.createElement('div');
      row.className   = 'telemetry-row';
      row.dataset.pid = processId;
      row.innerHTML   = `
        <div class="telemetry-label">
          <div class="telemetry-name">${_esc(meta.name)}</div>
          <div class="telemetry-sub">${_esc(meta.label)}</div>
        </div>
        <div class="telemetry-charts">
          <div class="telemetry-metric">
            <div class="telemetry-metric-hdr">CPU</div>
            <canvas class="telemetry-canvas" width="140" height="46" data-role="cpu"></canvas>
            <div class="telemetry-val" data-val="cpu">—</div>
          </div>
          <div class="telemetry-metric">
            <div class="telemetry-metric-hdr">Heap / RAM</div>
            <canvas class="telemetry-canvas" width="140" height="46" data-role="mem"></canvas>
            <div class="telemetry-val" data-val="mem">—</div>
          </div>
          <div class="telemetry-metric telemetry-players">
            <div class="telemetry-metric-hdr">Online Players</div>
            <div class="telemetry-player-list" data-val="players">
              <span class="telemetry-player-count">—</span>
            </div>
          </div>
        </div>`;
      this._host.appendChild(row);

      const charts = {
        cpu: new SparkLine(row.querySelector('[data-role="cpu"]'), '#8b5cf6'),
        mem: new SparkLine(row.querySelector('[data-role="mem"]'), '#06b6d4'),
      };
      this._charts.set(processId, charts);
    }
  }

  _openSSE() {
    const url    = `/api/telemetry/stream?token=${encodeURIComponent(this._apiKey)}`;
    const source = new EventSource(url);
    this._sse    = source;

    source.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'snapshot') {
        for (const [id, stats] of Object.entries(msg.data || {})) {
          this._apply(id, stats.cpu, stats.mem, stats.players);
        }
      } else if (msg.type === 'sample') {
        this._apply(msg.processId, msg.cpu, msg.mem, msg.players);
      }
    };

    // EventSource auto-reconnects on error; nothing extra needed.
    source.onerror = () => {};
  }

  /** Seed chart from the /history endpoint right after mounting. */
  async seedHistory(processId) {
    try {
      const res = await fetch(
        `/api/telemetry/${encodeURIComponent(processId)}/history?n=60`,
        { headers: { 'Authorization': `Bearer ${this._apiKey}` } }
      );
      if (!res.ok) return;
      const { cpu, mem } = await res.json();
      const charts = this._charts.get(processId);
      if (!charts) return;
      if (cpu.length) charts.cpu.seed(cpu.map(s => s.v));
      if (mem.length) charts.mem.seed(mem.map(s => s.v));
    } catch {}
  }

  _apply(processId, cpu, mem, players) {
    const charts = this._charts.get(processId);
    if (!charts) return;

    charts.cpu.push(cpu ?? 0);
    charts.mem.push(mem ?? 0);

    const row = this._host.querySelector(`[data-pid="${processId}"]`);
    if (!row) return;

    const cpuEl     = row.querySelector('[data-val="cpu"]');
    const memEl     = row.querySelector('[data-val="mem"]');
    const playerEl  = row.querySelector('[data-val="players"]');

    if (cpuEl) cpuEl.textContent = `${cpu ?? 0}%`;
    if (memEl) memEl.textContent = fmtMem(mem ?? 0);

    if (playerEl && players) {
      const count = players.length;
      if (count === 0) {
        playerEl.innerHTML = `<span class="telemetry-player-count">0</span>`;
      } else {
        const chips = players.slice(0, 10)
          .map(p => `<span class="telemetry-player-chip">${_esc(p)}</span>`)
          .join('');
        const more  = count > 10
          ? `<span class="telemetry-player-more">+${count - 10}</span>`
          : '';
        playerEl.innerHTML =
          `<span class="telemetry-player-count">${count}</span>${chips}${more}`;
      }
    }
  }

  destroy() {
    this._dead = true;
    this._sse?.close();
    for (const { cpu, mem } of this._charts.values()) {
      cpu.destroy();
      mem.destroy();
    }
    this._charts.clear();
  }
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
