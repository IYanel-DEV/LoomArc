'use strict';

const { spawn }    = require('child_process');
const EventEmitter = require('events');
const config       = require('../config');
const logger       = require('../utils/logger');

const BUFFER = config.process.consoleBuffer;
const STOP_TIMEOUT = config.process.gracefulStopTimeout;

/**
 * Manages OS-level child processes for BungeeCord and Spigot instances.
 *
 * Emits:
 *   'line'   { id, ts, text, stream }     — new console line
 *   'status' { id, status, code, signal } — process state change
 */
class ProcessManager extends EventEmitter {
  constructor() {
    super();
    // id → { proc, buffer, status, pid, startedAt, stopTimer }
    this._procs = new Map();
  }

  /**
   * Spawn a Java process.
   *
   * @param {string} id        Unique process identifier (e.g. "bungee-<networkId>")
   * @param {string} javaPath  Path to java executable
   * @param {string[]} jvmArgs  Full JVM + jar arguments array
   * @param {string} cwd       Working directory for the process
   */
  spawn(id, javaPath, jvmArgs, cwd) {
    const existing = this._procs.get(id);
    if (existing && existing.status === 'running') {
      throw new Error(`Process "${id}" is already running`);
    }

    logger.info(`[PM] Spawning ${id}: ${javaPath} ${jvmArgs.join(' ')} (cwd: ${cwd})`);

    const proc = spawn(javaPath, jvmArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });

    const entry = {
      proc,
      buffer:    [],
      status:    'starting',
      pid:       proc.pid,
      startedAt: Date.now(),
      stopTimer: null,
    };
    this._procs.set(id, entry);

    const pushLine = (text, stream) => {
      const item = { ts: Date.now(), text: text.trimEnd(), stream };
      entry.buffer.push(item);
      if (entry.buffer.length > BUFFER) entry.buffer.shift();
      this.emit('line', { id, ...item });
    };

    // Stream stdout line-by-line
    let stdoutRem = '';
    proc.stdout.on('data', chunk => {
      stdoutRem += chunk.toString();
      const lines = stdoutRem.split('\n');
      stdoutRem   = lines.pop();
      lines.forEach(l => pushLine(l, 'stdout'));
    });
    proc.stdout.on('end', () => { if (stdoutRem) pushLine(stdoutRem, 'stdout'); });

    // Stream stderr line-by-line
    let stderrRem = '';
    proc.stderr.on('data', chunk => {
      stderrRem += chunk.toString();
      const lines = stderrRem.split('\n');
      stderrRem   = lines.pop();
      lines.forEach(l => pushLine(l, 'stderr'));
    });
    proc.stderr.on('end', () => { if (stderrRem) pushLine(stderrRem, 'stderr'); });

    proc.on('spawn', () => {
      entry.status = 'running';
      logger.info(`[PM] ${id} running (PID ${proc.pid})`);
      this.emit('status', { id, status: 'running', pid: proc.pid });
    });

    proc.on('close', (code, signal) => {
      if (entry.stopTimer) { clearTimeout(entry.stopTimer); entry.stopTimer = null; }
      entry.status = (code === 0 || signal === 'SIGTERM') ? 'stopped' : 'crashed';
      logger.info(`[PM] ${id} exited (code=${code}, signal=${signal}) → ${entry.status}`);
      this.emit('status', { id, status: entry.status, code, signal });
    });

    proc.on('error', err => {
      entry.status = 'crashed';
      logger.error(`[PM] ${id} spawn error: ${err.message}`);
      this.emit('status', { id, status: 'crashed', error: err.message });
    });

    return id;
  }

  /**
   * Send a console command (writes to stdin).
   */
  sendCommand(id, command) {
    const entry = this._procs.get(id);
    if (!entry || entry.status !== 'running') {
      throw new Error(`Process "${id}" is not running`);
    }
    entry.proc.stdin.write(command + '\n');
  }

  /**
   * Gracefully stop a process (sends "stop" command, force-kills after timeout).
   */
  stop(id) {
    const entry = this._procs.get(id);
    if (!entry || entry.status !== 'running') return Promise.resolve();

    return new Promise((resolve) => {
      const onClose = () => resolve();
      entry.proc.once('close', onClose);

      try { entry.proc.stdin.write('stop\n'); } catch {}

      entry.stopTimer = setTimeout(() => {
        if (entry.status === 'running') {
          logger.warn(`[PM] ${id} did not stop in ${STOP_TIMEOUT}ms — force killing`);
          this.kill(id);
        }
        resolve();
      }, STOP_TIMEOUT);
    });
  }

  /**
   * Immediately kill a process (SIGKILL / taskkill on Windows).
   */
  kill(id) {
    const entry = this._procs.get(id);
    if (!entry) return;
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /PID ${entry.pid} /T /F`, { stdio: 'ignore' });
      } else {
        entry.proc.kill('SIGKILL');
      }
    } catch {}
  }

  /** Returns the last `lines` console lines for a process. */
  getOutput(id, lines = 100) {
    const entry = this._procs.get(id);
    return entry ? entry.buffer.slice(-lines) : [];
  }

  getStatus(id) {
    return this._procs.get(id)?.status ?? 'stopped';
  }

  /** Kill every tracked process immediately. Used during panel shutdown. */
  killAll() {
    for (const [id] of this._procs) {
      this.kill(id);
    }
  }

  /** Returns a summary map of all tracked processes. */
  snapshot() {
    const out = {};
    for (const [id, e] of this._procs) {
      out[id] = { status: e.status, pid: e.pid, startedAt: e.startedAt };
    }
    return out;
  }
}

module.exports = new ProcessManager();
