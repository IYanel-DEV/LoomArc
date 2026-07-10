'use strict';

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const multer  = require('multer');
const { body, param, query, validationResult } = require('express-validator');

const serverManager              = require('../managers/ServerManager');
const pluginManager              = require('../managers/PluginManager');
const config                     = require('../config');
const fsu                        = require('../utils/fileSystem');
const { safeFilePath, listEditableFiles, safePath, listDir, MAX_READ_BYTES } = require('../utils/fileEditor');

const router = express.Router();

function validate(req, res, next) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  next();
}

// Multer — upload JARs to a temp area
const upload = multer({
  dest: path.join(config.dataDir, 'tmp'),
  limits: { fileSize: 256 * 1024 * 1024 }, // 256 MB
  fileFilter: (req, file, cb) => {
    if (!file.originalname.endsWith('.jar')) {
      return cb(new Error('Only .jar files are accepted'));
    }
    cb(null, true);
  },
});

const SERVER_TYPES = ['hub', 'survival', 'bedwars', 'skywars', 'custom'];

// POST /api/servers
router.post('/',
  body('network_id').isUUID().withMessage('network_id must be a UUID'),
  body('name').trim().notEmpty().withMessage('name is required')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('name may only contain letters, numbers, - and _'),
  body('type').optional().isIn(SERVER_TYPES).withMessage(`type must be one of: ${SERVER_TYPES.join(', ')}`),
  body('memory_mb').optional().isInt({ min: 256, max: 32768 }).withMessage('memory_mb must be 256–32768'),
  validate,
  async (req, res) => {
    try {
      const { network_id, name, type, memory_mb } = req.body;
      const server = await serverManager.create(network_id, name, type, memory_mb);
      res.status(201).json(server);
    } catch (e) {
      res.status(e.message.includes('not found') ? 404 : 409).json({ error: e.message });
    }
  }
);

// GET /api/servers/:id
router.get('/:id', param('id').isUUID(), validate, (req, res) => {
  const server = serverManager.get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json({ ...server, liveStatus: serverManager.getLiveStatus(server.id) });
});

// PATCH /api/servers/:id
router.patch('/:id',
  param('id').isUUID(),
  body('name').optional().trim().matches(/^[a-zA-Z0-9_-]+$/).withMessage('Invalid name'),
  body('memory_mb').optional().isInt({ min: 256, max: 32768 }),
  body('extra_flags').optional().isString(),
  validate,
  async (req, res) => {
    try {
      const { name, memory_mb, extra_flags } = req.body;
      let server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });

      if (name) server = await serverManager.rename(req.params.id, name);
      if (memory_mb !== undefined || extra_flags !== undefined) {
        server = await serverManager.updateSettings(req.params.id, {
          memoryMb: memory_mb,
          extraFlags: extra_flags,
        });
      }
      res.json({ ...server, liveStatus: serverManager.getLiveStatus(server.id) });
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  }
);

// PUT /api/servers/:id/memory — update allocated RAM
router.put('/:id/memory',
  param('id').isUUID(),
  body('memory_mb').isInt({ min: 256, max: 32768 }).withMessage('memory_mb must be 256–32768'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const updated = await serverManager.updateSettings(req.params.id, { memoryMb: req.body.memory_mb });
      res.json({ ...updated, liveStatus: serverManager.getLiveStatus(updated.id) });
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  }
);

// DELETE /api/servers/:id
router.delete('/:id', param('id').isUUID(), validate, async (req, res) => {
  try {
    await serverManager.delete(req.params.id);
    res.status(204).end();
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/servers/:id/start
router.post('/:id/start', param('id').isUUID(), validate, async (req, res) => {
  try {
    await serverManager.start(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/servers/:id/stop
router.post('/:id/stop', param('id').isUUID(), validate, async (req, res) => {
  try {
    await serverManager.stop(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/servers/:id/restart
router.post('/:id/restart', param('id').isUUID(), validate, async (req, res) => {
  try {
    await serverManager.restart(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/servers/:id/kill — force-kill the server process
router.post('/:id/kill', param('id').isUUID(), validate, (req, res) => {
  try {
    const pid = serverManager.kill(req.params.id);
    res.json({ ok: true, pid, method: 'taskkill' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/servers/:id/command
router.post('/:id/command',
  param('id').isUUID(),
  body('command').trim().notEmpty(),
  validate,
  (req, res) => {
    try {
      serverManager.sendCommand(req.params.id, req.body.command);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/servers/:id/console?lines=100
router.get('/:id/console', param('id').isUUID(), validate, (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  res.json(serverManager.getOutput(req.params.id, lines));
});

// ─── File Editor ──────────────────────────────────────────────────────────────

// GET /api/servers/:id/files — list editable config files in the server directory
router.get('/:id/files', param('id').isUUID(), validate, async (req, res) => {
  try {
    const server = serverManager.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const baseDir = path.join(config.dataDir, 'servers', server.network_id, server.id);
    res.json(await listEditableFiles(baseDir));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/servers/:id/files/read?path=server.properties
router.get('/:id/files/read',
  param('id').isUUID(),
  query('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const baseDir = path.join(config.dataDir, 'servers', server.network_id, server.id);
      const abs     = safeFilePath(baseDir, req.query.path);
      if (!await fsu.exists(abs)) return res.status(404).json({ error: 'File not found' });
      res.json({ path: req.query.path, content: await fsu.readFile(abs) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// PUT /api/servers/:id/files — save edited file content
router.put('/:id/files',
  param('id').isUUID(),
  body('path').trim().notEmpty().withMessage('path is required'),
  body('content').isString().withMessage('content must be a string'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const baseDir = path.join(config.dataDir, 'servers', server.network_id, server.id);
      const abs     = safeFilePath(baseDir, req.body.path);
      if (!await fsu.exists(abs)) return res.status(404).json({ error: 'File not found' });
      await fsu.writeFile(abs, req.body.content);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ─── Full File Manager (/fs routes) ──────────────────────────────────────────

function serverBaseDir(server) {
  return path.join(config.dataDir, 'servers', server.network_id, server.id);
}

// GET /api/servers/:id/fs?path= — list directory contents
router.get('/:id/fs',
  param('id').isUUID(),
  query('path').optional().isString(),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const relPath = (req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const entries = await listDir(serverBaseDir(server), relPath);
      res.json({ path: relPath, entries });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/servers/:id/fs/read?path= — read file content
router.get('/:id/fs/read',
  param('id').isUUID(),
  query('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const abs = safePath(serverBaseDir(server), req.query.path);
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

// PUT /api/servers/:id/fs — write or create a file
router.put('/:id/fs',
  param('id').isUUID(),
  body('path').trim().notEmpty().withMessage('path is required'),
  body('content').isString().withMessage('content must be a string'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const abs = safePath(serverBaseDir(server), req.body.path);
      await fsu.writeFile(abs, req.body.content);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/servers/:id/fs/mkdir — create directory
router.post('/:id/fs/mkdir',
  param('id').isUUID(),
  body('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const abs = safePath(serverBaseDir(server), req.body.path);
      await fsu.ensureDir(abs);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// DELETE /api/servers/:id/fs?path= — delete file or directory
router.delete('/:id/fs',
  param('id').isUUID(),
  query('path').trim().notEmpty().withMessage('path is required'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const base = serverBaseDir(server);
      const abs  = safePath(base, req.query.path);
      if (abs === base) return res.status(400).json({ error: 'Cannot delete root' });
      await fsu.remove(abs);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/servers/:id/fs/rename — rename or move a file/directory
router.post('/:id/fs/rename',
  param('id').isUUID(),
  body('from').trim().notEmpty().withMessage('from is required'),
  body('to').trim().notEmpty().withMessage('to is required'),
  validate,
  async (req, res) => {
    try {
      const server = serverManager.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const base    = serverBaseDir(server);
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

// POST /api/servers/:id/upload-jar  (multipart)
router.post('/:id/upload-jar', param('id').isUUID(), validate, upload.single('jar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No JAR file uploaded' });
  try {
    // Rename temp file to original name in server dir
    const server = serverManager.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    await serverManager.linkJar(req.params.id, req.file.path);

    const fsu = require('../utils/fileSystem');
    await fsu.remove(req.file.path); // clean up tmp

    res.json({ ok: true, fileName: req.file.originalname });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Plugin sub-routes ────────────────────────────────────────────────────────

// GET /api/servers/:id/plugins
router.get('/:id/plugins', param('id').isUUID(), validate, (req, res) => {
  res.json(pluginManager.listForServer(req.params.id));
});

// GET /api/servers/:id/plugins/local — scan filesystem for .jar / .jar.disabled
router.get('/:id/plugins/local', param('id').isUUID(), validate, (req, res) => {
  try {
    res.json(pluginManager.listLocal(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/servers/:id/plugins/toggle — toggle .jar / .jar.disabled
router.post('/:id/plugins/toggle',
  param('id').isUUID(),
  body('file_name').trim().notEmpty().withMessage('file_name is required'),
  validate,
  (req, res) => {
    try {
      const result = pluginManager.toggleLocal(req.params.id, req.body.file_name);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/servers/:id/plugins/install-spiget
router.post('/:id/plugins/install-spiget',
  param('id').isUUID(),
  body('spiget_id').isInt({ min: 1 }).withMessage('spiget_id required'),
  body('version_id').optional().isString(),
  validate,
  async (req, res) => {
    try {
      const result = await pluginManager.install(
        req.params.id, req.body.spiget_id, req.body.version_id
      );
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/servers/:id/plugins/upload
router.post('/:id/plugins/upload', param('id').isUUID(), validate, upload.single('plugin'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No plugin JAR uploaded' });
  try {
    const result = await pluginManager.installFromFile(req.params.id, req.file.path, req.body.name);
    const fsu = require('../utils/fileSystem');
    await fsu.remove(req.file.path);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/servers/:serverId/plugins/:pluginId
router.delete('/:serverId/plugins/:pluginId', async (req, res) => {
  try {
    await pluginManager.uninstall(req.params.pluginId);
    res.status(204).end();
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

module.exports = router;
