'use strict';

const express   = require('express');
const telemetry = require('../managers/TelemetryManager');

const RING_SIZE = 120;
const router    = express.Router();

// GET /api/telemetry/stream  — SSE stream of live metric samples for all tracked processes
// EventSource cannot send custom headers; auth key must come via ?key= query param (handled
// by the global authMiddleware in server.js before this route is reached).
router.get('/stream', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection:          'keep-alive',
  });
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Immediate snapshot so the client can seed charts without waiting for the first tick
  send({ type: 'snapshot', data: telemetry.snapshot() });

  const onSample = data => send({ type: 'sample', ...data });
  telemetry.on('sample', onSample);
  req.on('close', () => telemetry.removeListener('sample', onSample));
});

// GET /api/telemetry/:processId/history?n=60  — seeded history for chart on tab open
router.get('/:processId/history', (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 60, RING_SIZE);
  res.json(telemetry.getHistory(req.params.processId, n));
});

module.exports = router;
