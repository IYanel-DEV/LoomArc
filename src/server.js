'use strict';

const http    = require('http');
const path    = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const config            = require('./config');
const logger            = require('./utils/logger');
const processManager    = require('./managers/ProcessManager');
const telemetryManager  = require('./managers/TelemetryManager');

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve the SPA
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Auth middleware (simple API key) ─────────────────────────────────────────
// The panel UI obtains the key from /api/session after loading;
// external API callers must send x-api-key header.

function authMiddleware(req, res, next) {
  if (req.path === '/api/session') return next();

  // Accept key from header (normal API calls) OR query string (EventSource — browsers
  // cannot set custom headers on EventSource so we fall back to ?key=…).
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || key !== config.apiSecret) {
    return res.status(401).json({ error: 'Unauthorised — missing or invalid x-api-key' });
  }
  next();
}

// Expose the key to the browser once so the frontend can use it for API calls.
// This is intentional: the panel is self-hosted, single-user.
app.get('/api/session', (req, res) => {
  res.json({ apiKey: config.apiSecret });
});

app.use('/api', authMiddleware);

// ─── Route mounting ───────────────────────────────────────────────────────────

app.use('/api/networks',  require('./routes/networks'));
app.use('/api/servers',   require('./routes/servers'));
app.use('/api/plugins',   require('./routes/plugins'));
app.use('/api/system',    require('./routes/system'));
app.use('/api/telemetry', require('./routes/telemetry'));

// Catch-all — serve the SPA for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────

const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

// Per-client subscription set: Set<processId>
const clients = new Map(); // ws → Set<processId>

wss.on('connection', (ws, req) => {
  // Validate API key from query string
  const urlParams = new URLSearchParams(req.url.replace('/ws', '').replace('?', ''));
  if (urlParams.get('key') !== config.apiSecret) {
    ws.close(4401, 'Unauthorised');
    return;
  }

  clients.set(ws, new Set());
  logger.debug('WS client connected');

  ws.on('message', rawMsg => {
    let msg;
    try { msg = JSON.parse(rawMsg); } catch { return; }

    switch (msg.type) {
      case 'subscribe': {
        // { type: 'subscribe', processId: 'bungee-xxx' }
        const subs = clients.get(ws);
        if (subs && msg.processId) {
          subs.add(msg.processId);
          // Send recent history immediately
          const history = processManager.getOutput(msg.processId, 200);
          ws.send(JSON.stringify({ type: 'history', processId: msg.processId, lines: history }));
        }
        break;
      }
      case 'unsubscribe': {
        clients.get(ws)?.delete(msg.processId);
        break;
      }
      case 'command': {
        // { type: 'command', processId: 'xxx', command: '/list' }
        try {
          processManager.sendCommand(msg.processId, msg.command);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    logger.debug('WS client disconnected');
  });
});

// ─── Broadcast process events to subscribed clients ───────────────────────────

function broadcast(processId, payload) {
  const data = JSON.stringify({ ...payload, processId });
  for (const [ws, subs] of clients) {
    if (ws.readyState === ws.OPEN && subs.has(processId)) {
      ws.send(data);
    }
  }
}

processManager.on('line', ({ id, ts, text, stream }) => {
  broadcast(id, { type: 'line', ts, text, stream });
  telemetryManager.handleLine(id, text);
});

processManager.on('status', ({ id, status, pid, code, signal, error }) => {
  if (status === 'running' && pid) {
    telemetryManager.track(id, pid);
  } else if (status === 'stopped' || status === 'crashed') {
    telemetryManager.untrack(id);
  }
  const db = require('./database');
  // Store PID while the process is live; clear it once it stops or crashes.
  const pidVal = status === 'running' ? (pid ?? null) : null;
  if (id.startsWith('bungee-')) {
    const networkId = id.replace('bungee-', '');
    db.run(
      'UPDATE networks SET status=?, pid=?, updated_at=unixepoch() WHERE id=?',
      [status, pidVal, networkId],
    );
  } else {
    db.run(
      'UPDATE servers SET status=?, pid=?, updated_at=unixepoch() WHERE id=?',
      [status, pidVal, id],
    );
  }
  broadcast(id, { type: 'status', status, pid: pidVal, code, signal, error });
});

// ─── Orphan-PID utilities ─────────────────────────────────────────────────────

/**
 * Hard-kill a PID that may or may not be a child of this process.
 * Uses taskkill /T /F on Windows to take down the full process tree.
 */
function killOrphan(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {}
}

// ─── Startup orphan sweep ─────────────────────────────────────────────────────
// Kill any Java PIDs that were left running by a previous panel session (crash
// or CTRL+C without a clean shutdown).  Runs once before the server starts.
;(function sweepOrphans() {
  const db = require('./database');
  const rows = [
    ...db.all('SELECT pid FROM servers  WHERE pid IS NOT NULL'),
    ...db.all('SELECT pid FROM networks WHERE pid IS NOT NULL'),
  ];
  if (rows.length) {
    logger.info(`[startup] Sweeping ${rows.length} orphan PID(s) from previous session`);
    rows.forEach(r => killOrphan(r.pid));
  }
  db.run("UPDATE servers  SET status='stopped', pid=NULL WHERE pid IS NOT NULL");
  db.run("UPDATE networks SET status='stopped', pid=NULL WHERE pid IS NOT NULL");
})();

// ─── Startup ──────────────────────────────────────────────────────────────────

server.listen(config.panel.port, config.panel.host, () => {
  logger.info(`LoomArc panel listening on http://${config.panel.host}:${config.panel.port}`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`Shutting down (${signal})…`);

  // 1. Kill every Java process tracked in this session
  processManager.killAll();

  // 2. Kill any DB-tracked PIDs not in ProcessManager (e.g. another panel instance)
  const db = require('./database');
  [
    ...db.all('SELECT pid FROM servers  WHERE pid IS NOT NULL'),
    ...db.all('SELECT pid FROM networks WHERE pid IS NOT NULL'),
  ].forEach(r => killOrphan(r.pid));

  // 3. Reset DB so the next startup sees a clean slate
  db.run("UPDATE servers  SET status='stopped', pid=NULL WHERE status IN ('running','starting')");
  db.run("UPDATE networks SET status='stopped', pid=NULL WHERE status IN ('running','starting')");

  // 4. Stop accepting new HTTP connections; force-exit after 5 s as a safety net
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
