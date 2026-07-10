'use strict';

const { execFile } = require('child_process');
const fs           = require('fs');
const os           = require('os');
const EventEmitter = require('events');

const RING_SIZE  = 120;  // 2 min history at 1 sample/s
const SAMPLE_MS  = 1000;
const NUM_CORES  = os.cpus().length || 1;

class TelemetryManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(64);
    // processId → { pid, lastCpuSec, lastTs, cpuBuf, memBuf, players }
    this._procs = new Map();
    this._timer = null;
    this._busy  = false;
  }

  track(processId, pid) {
    this._procs.set(processId, {
      pid,
      lastCpuSec: null,     // null = first sample; skip delta calc
      lastTs:     Date.now(),
      cpuBuf:     [],
      memBuf:     [],
      players:    new Set(),
    });
    if (!this._timer) {
      this._timer = setInterval(() => this._poll(), SAMPLE_MS);
      if (this._timer.unref) this._timer.unref();
    }
  }

  untrack(processId) {
    this._procs.delete(processId);
    if (this._procs.size === 0 && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Parse console lines to maintain the active-player set. */
  handleLine(processId, text) {
    const e = this._procs.get(processId);
    if (!e) return;

    // Join: "PlayerName[/1.2.3.4:port] logged in" (Spigot) or "PlayerName joined the game"
    let m = text.match(/: (\w{2,16})\[\/[\d.:]+\] logged in/);
    if (!m) m = text.match(/\[INFO\]: (\w{2,16}) joined the game/);
    if (m) { e.players.add(m[1]); return; }

    // Leave: "PlayerName left the game" or "PlayerName lost connection"
    m = text.match(/\[INFO\]: (\w{2,16}) left the game/);
    if (!m) m = text.match(/\[INFO\]: (\w{2,16}) lost connection/);
    if (m) e.players.delete(m[1]);
  }

  getHistory(processId, n = RING_SIZE) {
    const e = this._procs.get(processId);
    if (!e) return { cpu: [], mem: [], players: [] };
    return {
      cpu:     e.cpuBuf.slice(-n),
      mem:     e.memBuf.slice(-n),
      players: [...e.players],
    };
  }

  /** Latest value for every tracked process (used for SSE snapshot-on-connect). */
  snapshot() {
    const out = {};
    for (const [id, e] of this._procs) {
      out[id] = {
        cpu:     e.cpuBuf.at(-1)?.v ?? 0,
        mem:     e.memBuf.at(-1)?.v ?? 0,
        players: [...e.players],
      };
    }
    return out;
  }

  async _poll() {
    if (this._procs.size === 0 || this._busy) return;
    this._busy = true;
    try {
      const entries = [...this._procs.entries()];
      const pids    = entries.map(([, e]) => e.pid);
      const metrics = await this._fetch(pids);
      const now     = Date.now();

      for (const [processId, e] of entries) {
        const m = metrics.get(e.pid);
        if (!m) continue;

        let cpuPct  = 0;
        const elapsed = (now - e.lastTs) / 1000 || 1;
        if (e.lastCpuSec !== null) {
          cpuPct = Math.max(0, Math.min(100,
            Math.round(((m.cpu - e.lastCpuSec) / elapsed) * 100 / NUM_CORES)
          ));
        }
        e.lastCpuSec = m.cpu;
        e.lastTs     = now;

        e.cpuBuf.push({ ts: now, v: cpuPct });
        e.memBuf.push({ ts: now, v: m.mem  });
        if (e.cpuBuf.length > RING_SIZE) e.cpuBuf.shift();
        if (e.memBuf.length > RING_SIZE) e.memBuf.shift();

        this.emit('sample', {
          processId,
          ts:      now,
          cpu:     cpuPct,
          mem:     m.mem,
          players: [...e.players],
        });
      }
    } finally {
      this._busy = false;
    }
  }

  _fetch(pids) {
    if (pids.length === 0) return Promise.resolve(new Map());
    return process.platform === 'win32'
      ? this._fetchWin(pids)
      : this._fetchLinux(pids);
  }

  // Windows: wmic returns KernelModeTime + UserModeTime in 100-ns units, WorkingSetSize in bytes
  _fetchWin(pids) {
    const where = pids.map(p => `ProcessId=${p}`).join(' or ');
    return new Promise(resolve => {
      execFile('wmic', [
        'process', 'where', where,
        'get', 'ProcessId,WorkingSetSize,KernelModeTime,UserModeTime',
        '/format:value',
      ], { timeout: 800, windowsHide: true }, (err, stdout) => {
        const map = new Map();
        if (err) return resolve(map);
        // /format:value output: blocks of key=value lines separated by blank lines
        for (const block of stdout.split(/\r?\n\r?\n+/)) {
          const kv = {};
          for (const line of block.split(/\r?\n/)) {
            const hit = line.match(/^(\w+)=(.*)$/);
            if (hit) kv[hit[1]] = hit[2].trim();
          }
          const pid = parseInt(kv.ProcessId);
          if (isNaN(pid)) continue;
          map.set(pid, {
            cpu: ((parseInt(kv.KernelModeTime) || 0) + (parseInt(kv.UserModeTime) || 0)) / 1e7,
            mem:  parseInt(kv.WorkingSetSize) || 0,
          });
        }
        resolve(map);
      });
    });
  }

  // Linux: read /proc/<pid>/stat for CPU jiffies, /proc/<pid>/status for RSS
  _fetchLinux(pids) {
    const map = new Map();
    for (const pid of pids) {
      try {
        const stat   = fs.readFileSync(`/proc/${pid}/stat`,   'utf8').split(' ');
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const cpu    = (parseInt(stat[13]) + parseInt(stat[14])) / 100; // jiffies → seconds
        const rss    = (status.match(/VmRSS:\s+(\d+)/) || [])[1];
        map.set(pid, { cpu, mem: rss ? parseInt(rss) * 1024 : 0 });
      } catch {}
    }
    return Promise.resolve(map);
  }
}

module.exports = new TelemetryManager();
