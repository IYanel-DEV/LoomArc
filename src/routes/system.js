'use strict';

const os      = require('os');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { v4: uuid } = require('uuid');

const db             = require('../database');
const config         = require('../config');
const processManager = require('../managers/ProcessManager');
const portAlloc      = require('../managers/PortAllocator');
const javaDetector   = require('../utils/javaDetector');
const fsu            = require('../utils/fileSystem');
const downloader     = require('../managers/JarDownloader');

// ─── OS metrics helpers ───────────────────────────────────────────────────────

/**
 * Sample CPU idle/total ticks twice 150 ms apart and return a 0-100 usage %.
 * Works on Windows where os.loadavg() always returns [0,0,0].
 */
function sampleCpuPercent() {
  return new Promise(resolve => {
    const snap1 = os.cpus();
    setTimeout(() => {
      const snap2 = os.cpus();
      let idleDelta = 0, totalDelta = 0;
      for (let i = 0; i < snap1.length; i++) {
        const t1 = snap1[i].times;
        const t2 = snap2[i].times;
        const sum = t => t.user + t.nice + t.sys + t.idle + t.irq;
        idleDelta  += t2.idle - t1.idle;
        totalDelta += sum(t2)  - sum(t1);
      }
      resolve(totalDelta > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100))) : 0);
    }, 150);
  });
}

/**
 * Return disk stats for the filesystem that contains `dir`.
 * Uses fs.statfs (Node ≥ 18.15) — returns null on older runtimes or error.
 */
async function diskStats(dir) {
  try {
    const { bavail, blocks, bsize } = await fs.promises.statfs(dir);
    const total = blocks * bsize;
    const free  = bavail * bsize;
    return { total, used: total - free, free };
  } catch { return null; }
}

const router = express.Router();

// Multer for JAR uploads to the global jar cache
const jarUpload = multer({
  dest: path.join(config.dataDir, 'tmp'),
  limits: { fileSize: 256 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.endsWith('.jar')) return cb(new Error('Only .jar files accepted'));
    cb(null, true);
  },
});

// GET /api/system/metrics  — host CPU, RAM, and disk utilisation
router.get('/metrics', async (req, res) => {
  try {
    const [cpuPct, disk] = await Promise.all([sampleCpuPercent(), diskStats(config.dataDir)]);
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    res.json({
      cpu:      { percent: cpuPct, cores: os.cpus().length, model: os.cpus()[0]?.model ?? '' },
      ram:      { total: totalMem, free: freeMem, used: totalMem - freeMem },
      disk,
      platform: os.platform(),
      hostname: os.hostname(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/system/status  — panel health + process snapshot
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    version: require('../../package.json').version,
    uptime: process.uptime(),
    processes: processManager.snapshot(),
    ports: portAlloc.listAllocations(),
  });
});

// GET /api/system/java  — detected Java installations
router.get('/java', (req, res) => {
  const installs = javaDetector.detectAll();
  res.json({ configured: config.javaPath, detected: installs });
});

// ─── Global JAR cache ─────────────────────────────────────────────────────────

// GET /api/system/jars
router.get('/jars', (req, res) => {
  res.json(db.all('SELECT * FROM jars ORDER BY downloaded_at DESC'));
});

// POST /api/system/jars/upload  — store a JAR in the global cache
router.post('/jars/upload', jarUpload.single('jar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const kind      = req.body.kind === 'bungee' ? 'bungee' : 'spigot';
    const mc        = (req.body.mc_version || 'unknown').trim();
    const jarsDir   = path.join(config.dataDir, 'jars');
    await fsu.ensureDir(jarsDir);

    const dest = path.join(jarsDir, req.file.originalname);
    fs.renameSync(req.file.path, dest);

    const id = uuid();
    db.run(
      'INSERT INTO jars (id, kind, mc_version, file_name, file_path) VALUES (?, ?, ?, ?, ?)',
      [id, kind, mc, req.file.originalname, dest]
    );

    res.status(201).json({ id, kind, mc_version: mc, file_name: req.file.originalname });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/system/jars/:id
router.delete('/jars/:id', async (req, res) => {
  const jar = db.get('SELECT * FROM jars WHERE id = ?', [req.params.id]);
  if (!jar) return res.status(404).json({ error: 'JAR not found' });
  await fsu.remove(jar.file_path);
  db.run('DELETE FROM jars WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

// POST /api/system/jars/:id/link-to-server  — copy cached JAR into a server dir
router.post('/jars/:id/link-to-server', async (req, res) => {
  const jar    = db.get('SELECT * FROM jars WHERE id = ?', [req.params.id]);
  if (!jar) return res.status(404).json({ error: 'JAR not found' });

  const { server_id } = req.body;
  if (!server_id) return res.status(400).json({ error: 'server_id is required' });

  const serverManager = require('../managers/ServerManager');
  try {
    await serverManager.linkJar(server_id, jar.file_path);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/system/jars/:id/link-to-network  — copy cached JAR into bungee dir
router.post('/jars/:id/link-to-network', async (req, res) => {
  const jar = db.get('SELECT * FROM jars WHERE id = ?', [req.params.id]);
  if (!jar) return res.status(404).json({ error: 'JAR not found' });

  const { network_id } = req.body;
  if (!network_id) return res.status(400).json({ error: 'network_id is required' });

  const bungeeDir = path.join(config.dataDir, 'servers', network_id, 'bungee');
  const dest      = path.join(bungeeDir, jar.file_name);
  try {
    await fsu.copyFile(jar.file_path, dest);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Purpur (Paper-compatible) version/build browser ─────────────────────────

// GET /api/system/paper/versions  — list available MC versions from Purpur API
router.get('/paper/versions', async (req, res) => {
  try {
    const versions = await downloader.getPurpurVersions();
    res.json({ versions });
  } catch (e) {
    res.status(502).json({ error: `Could not fetch versions: ${e.message}` });
  }
});

// GET /api/system/paper/versions/:version/builds  — list builds for a version
router.get('/paper/versions/:version/builds', async (req, res) => {
  try {
    const data = await downloader.getPurpurBuilds(req.params.version);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `Could not fetch builds: ${e.message}` });
  }
});

module.exports = router;
