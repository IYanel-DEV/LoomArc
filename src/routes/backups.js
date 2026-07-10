'use strict';

const fs      = require('fs');
const express = require('express');
const { param, validationResult } = require('express-validator');
const backupManager = require('../managers/BackupManager');

// mergeParams:true so :id from the parent server route is accessible
const router = express.Router({ mergeParams: true });

function validate(req, res, next) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /api/servers/:id/backups
router.get('/', param('id').isUUID(), validate, (req, res) => {
  res.json(backupManager.listBackups(req.params.id));
});

// POST /api/servers/:id/backups  — trigger a new backup
router.post('/', adminOnly, param('id').isUUID(), validate, async (req, res) => {
  try {
    const backup = await backupManager.createBackup(req.params.id);
    res.status(201).json(backup);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/servers/:id/backups/:bid/download
// Auth: accepts ?token= query param because browser download links can't set headers
router.get('/:bid/download',
  param('id').isUUID(),
  param('bid').isUUID(),
  validate,
  (req, res) => {
    const backup = backupManager.getBackup(req.params.bid);
    if (!backup || backup.server_id !== req.params.id) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ error: 'Backup file missing from disk' });
    }
    res.download(backup.file_path, backup.file_name);
  }
);

// DELETE /api/servers/:id/backups/:bid
router.delete('/:bid',
  adminOnly,
  param('id').isUUID(),
  param('bid').isUUID(),
  validate,
  (req, res) => {
    try {
      backupManager.deleteBackup(req.params.bid);
      res.status(204).end();
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

module.exports = router;
