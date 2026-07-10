'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const templateManager = require('../managers/TemplateManager');

const router = express.Router();

function validate(req, res, next) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /api/templates
router.get('/', (req, res) => {
  res.json(templateManager.list());
});

// GET /api/templates/:id
router.get('/:id', param('id').isUUID(), validate, (req, res) => {
  const tpl = templateManager.get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tpl);
});

// POST /api/templates  — create from server snapshot or from scratch
router.post('/',
  adminOnly,
  body('name').trim().notEmpty().withMessage('name required'),
  body('server_id').optional().isUUID(),
  body('memory_mb').optional().isInt({ min: 256, max: 32768 }),
  validate,
  (req, res) => {
    try {
      const tpl = req.body.server_id
        ? templateManager.createFromServer(req.body.server_id, req.body.name, req.body.description)
        : templateManager.create({
            name:        req.body.name,
            description: req.body.description,
            serverType:  req.body.server_type || 'custom',
            memoryMb:    parseInt(req.body.memory_mb) || 1024,
            configYml:   req.body.config_yml || '',
          });
      res.status(201).json(tpl);
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  }
);

// DELETE /api/templates/:id
router.delete('/:id', adminOnly, param('id').isUUID(), validate, (req, res) => {
  try {
    templateManager.delete(req.params.id);
    res.status(204).end();
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/templates/:id/deploy  — create a new server using this template
router.post('/:id/deploy',
  adminOnly,
  param('id').isUUID(),
  body('network_id').isUUID().withMessage('network_id required'),
  body('name').trim().notEmpty().withMessage('name required')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('name may only contain letters, numbers, - and _'),
  validate,
  async (req, res) => {
    try {
      const params = templateManager.serverParams(req.params.id, req.body.network_id, req.body.name);
      const serverManager = require('../managers/ServerManager');
      const server = await serverManager.create(params.network_id, params.name, params.type, params.memory_mb);
      if (params.extra_flags) {
        await serverManager.updateSettings(server.id, { extraFlags: params.extra_flags });
      }
      res.status(201).json(server);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

module.exports = router;
