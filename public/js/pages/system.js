import { system } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { confirm } from '../components/modal.js';

const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export async function renderSystem(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">System</div>
    </div>
    <div id="system-content"><div class="loading-splash" style="height:160px"><div class="spinner"></div></div></div>
  `;
  await load(container);
}

async function load(container) {
  const el = document.getElementById('system-content') || container;
  try {
    const [status, java, jars, metrics] = await Promise.all([
      system.status(),
      system.java(),
      system.jars.list(),
      system.metrics().catch(() => null),
    ]);

    const uptime = formatUptime(status.uptime);
    const procs  = Object.entries(status.processes || {});

    el.innerHTML = `
      <!-- Host resource metrics -->
      ${metrics ? renderMetrics(metrics) : ''}

      <!-- Status cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:24px">
        <div class="card">
          <div class="card-title">Panel Uptime</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--green)">${uptime}</div>
          <div class="text-muted text-sm">v${escHtml(status.version)}</div>
        </div>
        <div class="card">
          <div class="card-title">Active Processes</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--cyan)">${procs.filter(([,p])=>p.status==='running').length}</div>
          <div class="text-muted text-sm">${procs.length} total tracked</div>
        </div>
        <div class="card">
          <div class="card-title">JAR Cache</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--accent)">${jars.length}</div>
          <div class="text-muted text-sm">stored JARs</div>
        </div>
        <div class="card">
          <div class="card-title">Port Allocations</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--yellow)">${status.ports?.length ?? 0}</div>
          <div class="text-muted text-sm">ports in use</div>
        </div>
      </div>

      <!-- Java installs -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-title">Java Installations</div>
        <p class="text-muted text-sm" style="margin-bottom:10px">Configured: <code>${escHtml(java.configured)}</code></p>
        ${java.detected.length === 0
          ? `<p class="text-muted text-sm">No Java installations auto-detected. Set JAVA_PATH in .env.</p>`
          : `<div class="servers-list">${java.detected.map(j => `
            <div class="server-card" style="cursor:default">
              <div class="server-info">
                <div class="server-name text-mono" style="font-size:.82rem">${escHtml(j.bin)}</div>
                <div class="server-sub">${escHtml(j.version)}</div>
              </div>
            </div>`).join('')}</div>`
        }
      </div>

      <!-- Active processes -->
      ${procs.length > 0 ? `
      <div class="card" style="margin-bottom:20px">
        <div class="card-title">Active Processes</div>
        <div class="servers-list">
          ${procs.map(([id, p]) => `
            <div class="server-card" style="cursor:default">
              <div class="server-info">
                <div class="server-name text-mono" style="font-size:.82rem">${escHtml(id)}</div>
                <div class="server-sub">PID ${p.pid ?? '—'} · started ${p.startedAt ? new Date(p.startedAt).toLocaleTimeString() : '—'}</div>
              </div>
              <span class="status-badge status-${p.status}">${p.status}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- JAR cache -->
      <div class="card">
        <div class="card-title">JAR Cache</div>
        <p class="text-muted text-sm" style="margin-bottom:12px">
          JARs stored here can be linked to any network or server without re-uploading.
        </p>
        ${jars.length === 0
          ? `<p class="text-muted text-sm">No JARs cached yet. Upload via a network's JAR Manager tab.</p>`
          : `<div class="servers-list">${jars.map(j => `
            <div class="server-card" style="cursor:default">
              <div class="server-info">
                <div class="server-name text-mono" style="font-size:.82rem">${escHtml(j.file_name)}</div>
                <div class="server-sub">${j.kind} · MC ${escHtml(j.mc_version)}</div>
              </div>
              <button class="btn btn-sm btn-danger" data-del-jar="${j.id}">Delete</button>
            </div>`).join('')}</div>`
        }
      </div>
    `;

    el.querySelectorAll('[data-del-jar]').forEach(btn => {
      btn.addEventListener('click', () => {
        confirm('Remove this JAR from the cache? (server files are not affected)', async () => {
          try {
            await system.jars.delete(btn.dataset.delJar);
            toastSuccess('JAR removed from cache');
            load(container);
          } catch (e) { toastError(e.message); }
        }, { danger: true });
      });
    });

  } catch (e) {
    el.innerHTML = `<p class="text-muted">Failed to load system info: ${e.message}</p>`;
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h > 0 ? `${h}h` : null, `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function fmtBytes(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

function progressBar(pct, color) {
  const w = Math.max(0, Math.min(100, pct));
  return `
    <div style="background:var(--border);border-radius:3px;height:6px;overflow:hidden;margin-top:6px">
      <div style="height:100%;border-radius:3px;background:${color};width:${w}%;transition:width .3s"></div>
    </div>`;
}

function renderMetrics(m) {
  const cpuColor  = m.cpu.percent > 85 ? 'var(--red)' : m.cpu.percent > 60 ? 'var(--yellow)' : 'var(--cyan)';
  const ramPct    = Math.round(m.ram.used / m.ram.total * 100);
  const ramColor  = ramPct > 85 ? 'var(--red)' : ramPct > 60 ? 'var(--yellow)' : 'var(--green)';
  const cpuModel  = (m.cpu.model || '').replace(/\(.*?\)/g, '').trim().slice(0, 40);

  const diskCard = m.disk ? (() => {
    const diskPct   = Math.round(m.disk.used / m.disk.total * 100);
    const diskColor = diskPct > 85 ? 'var(--red)' : diskPct > 60 ? 'var(--yellow)' : 'var(--accent)';
    return `
      <div>
        <div class="text-muted text-sm">Data Dir Disk</div>
        <div style="font-size:1.5rem;font-weight:700;color:${diskColor}">${diskPct}%</div>
        ${progressBar(diskPct, diskColor)}
        <div class="text-muted text-sm" style="margin-top:4px">${fmtBytes(m.disk.used)} / ${fmtBytes(m.disk.total)}</div>
      </div>`;
  })() : '';

  return `
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="card-title" style="margin:0">Host Resources</div>
        <span class="text-muted text-sm">${escHtml(m.hostname)} · ${escHtml(m.platform)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:20px">
        <div>
          <div class="text-muted text-sm">CPU Usage</div>
          <div style="font-size:1.5rem;font-weight:700;color:${cpuColor}">${m.cpu.percent}%</div>
          ${progressBar(m.cpu.percent, cpuColor)}
          <div class="text-muted text-sm" style="margin-top:4px">${m.cpu.cores} cores${cpuModel ? ' · ' + escHtml(cpuModel) : ''}</div>
        </div>
        <div>
          <div class="text-muted text-sm">Memory</div>
          <div style="font-size:1.5rem;font-weight:700;color:${ramColor}">${ramPct}%</div>
          ${progressBar(ramPct, ramColor)}
          <div class="text-muted text-sm" style="margin-top:4px">${fmtBytes(m.ram.used)} / ${fmtBytes(m.ram.total)}</div>
        </div>
        ${diskCard}
      </div>
    </div>`;
}
