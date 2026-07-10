'use strict';

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const networkManager = require('../managers/NetworkManager');
const serverManager  = require('../managers/ServerManager');
const processManager = require('../managers/ProcessManager');
const provisioner    = require('../managers/Provisioner');
const config         = require('../config');
const fsu            = require('../utils/fileSystem');
const { safeFilePath, listEditableFiles, safePath, listDir, MAX_READ_BYTES } = require('../utils/fileEditor');

const router = express.Router();

function validate(req, res, next) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  next();
}

// GET /api/networks
router.get('/', (req, res) => {
  const networks = networkManager.list().map(n => ({
    ...n,
    liveStatus: networkManager.getLiveStatus(n.id),
    // Include servers so the plugin browser install modal can populate its server picker
    servers: serverManager.listByNetwork(n.id).map(s => ({
      ...s,
      liveStatus: serverManager.getLiveStatus(s.id),
    })),
    provisioning: (() => {
      const s = provisioner.getState(n.id);
      return s && !s.done && !s.error ? s : null;
    })(),
  }));
  res.json(networks);
});

// POST /api/networks
router.post('/',
  body('name').trim().notEmpty().withMessage('name is required')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('name may only contain letters, numbers, - and _'),
  body('description').optional().trim(),
  body('mc_version').optional().trim(),
  body('mc_build').optional(),
  validate,
  async (req, res) => {
    try {
      const { name, description, mc_version, mc_build } = req.body;
      const network = await networkManager.create(name, description, { mcVersion: mc_version, mcBuild: mc_build });
      const provState = provisioner.getState(network.id);
      res.status(201).json({
        ...network,
        liveStatus:   networkManager.getLiveStatus(network.id),
        provisioning: provState && !provState.done ? provState : null,
      });
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  }
);

// GET /api/networks/:id/provision  — SSE stream of provisioning progress
// Auth: accepts key as query param because EventSource can't set custom headers.
router.get('/:id/provision', (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).end();

  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'X-Accel-Buffering': 'no',   // disable nginx buffering
    Connection:          'keep-alive',
  });
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Send the current snapshot immediately so the client doesn't spin blank
  const current = provisioner.getState(id);
  if (current) {
    send(current);
    if (current.done || current.error) return res.end();
  } else {
    send({ networkId: id, step: 'queued', message: 'Queued…', percent: 0, done: false, error: null });
  }

  // Stream live updates
  const handler = (update) => {
    if (update.networkId !== id) return;
    send(update);
    if (update.done || update.error) res.end();
  };

  provisioner.on('progress', handler);
  req.on('close', () => provisioner.off('progress', handler));
});

// GET /api/networks/:id
router.get('/:id', param('id').isUUID(), validate, (req, res) => {
  const network = networkManager.get(req.params.id);
  if (!network) return res.status(404).json({ error: 'Network not found' });
  const servers = serverManager.listByNetwork(network.id).map(s => ({
    ...s,
    liveStatus: serverManager.getLiveStatus(s.id),
  }));
  res.json({ ...network, liveStatus: networkManager.getLiveStatus(network.id), servers });
});

// PATCH /api/networks/:id  — rename or update description / memory
router.patch('/:id',
  param('id').isUUID(),
  body('name').optional().trim().matches(/^[a-zA-Z0-9_-]+$/).withMessage('Invalid name'),
  body('description').optional().trim(),
  validate,
  async (req, res) => {
    try {
      const { name, description, memory_mb } = req.body;
      let network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });

      if (name) network = await networkManager.rename(req.params.id, name);
      if (description !== undefined || memory_mb !== undefined) {
        const db = require('../database');
        const fields = []; const vals = [];
        if (description !== undefined) { fields.push('description=?'); vals.push(description); }
        if (memory_mb   !== undefined) { fields.push('memory_mb=?');   vals.push(memory_mb); }
        vals.push(req.params.id);
        db.run(`UPDATE networks SET ${fields.join(',')}, updated_at=unixepoch() WHERE id=?`, vals);
        network = networkManager.get(req.params.id);
      }

      res.json(network);
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  }
);

// PUT /api/networks/:id/memory — update proxy RAM
router.put('/:id/memory',
  param('id').isUUID(),
  body('memory_mb').isInt({ min: 128, max: 16384 }).withMessage('memory_mb must be 128–16384'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const db = require('../database');
      db.run('UPDATE networks SET memory_mb = ?, updated_at = unixepoch() WHERE id = ?', [req.body.memory_mb, req.params.id]);
      res.json(networkManager.get(req.params.id));
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  }
);

// DELETE /api/networks/:id
router.delete('/:id', param('id').isUUID(), validate, async (req, res) => {
  try {
    await networkManager.delete(req.params.id);
    res.status(204).end();
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/networks/:id/start
router.post('/:id/start', param('id').isUUID(), validate, async (req, res) => {
  try {
    await networkManager.start(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/networks/:id/stop
router.post('/:id/stop', param('id').isUUID(), validate, async (req, res) => {
  try {
    await networkManager.stop(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/networks/:id/kill — force-kill the BungeeCord process
router.post('/:id/kill', param('id').isUUID(), validate, (req, res) => {
  try {
    const pid = networkManager.kill(req.params.id);
    res.json({ ok: true, pid, method: 'taskkill' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/networks/:id/restart
router.post('/:id/restart', param('id').isUUID(), validate, async (req, res) => {
  try {
    await networkManager.restart(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/networks/:id/command
router.post('/:id/command',
  param('id').isUUID(),
  body('command').trim().notEmpty().withMessage('command is required'),
  validate,
  (req, res) => {
    try {
      networkManager.sendCommand(req.params.id, req.body.command);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/networks/:id/console?lines=200
router.get('/:id/console', param('id').isUUID(), validate, (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  res.json(networkManager.getOutput(req.params.id, lines));
});

// ─── File Editor (BungeeCord config files) ────────────────────────────────────

// GET /api/networks/:id/files
router.get('/:id/files', param('id').isUUID(), validate, async (req, res) => {
  try {
    const network = networkManager.get(req.params.id);
    if (!network) return res.status(404).json({ error: 'Network not found' });
    const baseDir = path.join(config.dataDir, 'servers', network.id, 'bungee');
    res.json(await listEditableFiles(baseDir));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/networks/:id/files/read?path=config.yml
router.get('/:id/files/read',
  param('id').isUUID(),
  query('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const baseDir = path.join(config.dataDir, 'servers', network.id, 'bungee');
      const abs     = safeFilePath(baseDir, req.query.path);
      if (!await fsu.exists(abs)) return res.status(404).json({ error: 'File not found' });
      res.json({ path: req.query.path, content: await fsu.readFile(abs) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// PUT /api/networks/:id/files — save edited BungeeCord config file
router.put('/:id/files',
  param('id').isUUID(),
  body('path').trim().notEmpty().withMessage('path is required'),
  body('content').isString().withMessage('content must be a string'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const baseDir = path.join(config.dataDir, 'servers', network.id, 'bungee');
      const abs     = safeFilePath(baseDir, req.body.path);
      if (!await fsu.exists(abs)) return res.status(404).json({ error: 'File not found' });
      await fsu.writeFile(abs, req.body.content);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ─── Full File Manager (/fs routes — BungeeCord directory) ───────────────────

function bungeeBaseDir(network) {
  return path.join(config.dataDir, 'servers', network.id, 'bungee');
}

// GET /api/networks/:id/fs?path=
router.get('/:id/fs',
  param('id').isUUID(),
  query('path').optional().isString(),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const relPath = (req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const entries = await listDir(bungeeBaseDir(network), relPath);
      res.json({ path: relPath, entries });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/networks/:id/fs/read?path=
router.get('/:id/fs/read',
  param('id').isUUID(),
  query('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const abs = safePath(bungeeBaseDir(network), req.query.path);
      let stat;
      try { stat = fs.statSync(abs); } catch { return res.status(404).json({ error: 'File not found' }); }
      if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot read a directory' });
      if (stat.size > MAX_READ_BYTES) return res.status(413).json({ error: 'File too large to edit (>2 MB)' });
      res.json({ path: req.query.path, content: await fsu.readFile(abs) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// PUT /api/networks/:id/fs — write or create a file
router.put('/:id/fs',
  param('id').isUUID(),
  body('path').trim().notEmpty().withMessage('path is required'),
  body('content').isString().withMessage('content must be a string'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const abs = safePath(bungeeBaseDir(network), req.body.path);
      await fsu.writeFile(abs, req.body.content);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/networks/:id/fs/mkdir
router.post('/:id/fs/mkdir',
  param('id').isUUID(),
  body('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const abs = safePath(bungeeBaseDir(network), req.body.path);
      await fsu.ensureDir(abs);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// DELETE /api/networks/:id/fs?path=
router.delete('/:id/fs',
  param('id').isUUID(),
  query('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const base = bungeeBaseDir(network);
      const abs  = safePath(base, req.query.path);
      if (abs === base) return res.status(400).json({ error: 'Cannot delete root' });
      await fsu.remove(abs);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/networks/:id/fs/rename
router.post('/:id/fs/rename',
  param('id').isUUID(),
  body('from').trim().notEmpty().withMessage('from is required'),
  body('to').trim().notEmpty().withMessage('to is required'),
  validate,
  async (req, res) => {
    try {
      const network = networkManager.get(req.params.id);
      if (!network) return res.status(404).json({ error: 'Network not found' });
      const base    = bungeeBaseDir(network);
      const fromAbs = safePath(base, req.body.from);
      const toAbs   = safePath(base, req.body.to);
      if (fromAbs === base) return res.status(400).json({ error: 'Cannot rename root' });
      await fs.promises.rename(fromAbs, toAbs);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/networks/:id/sync-config
router.post('/:id/sync-config', param('id').isUUID(), validate, async (req, res) => {
  try {
    await networkManager.syncConfig(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
