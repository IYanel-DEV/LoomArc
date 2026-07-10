'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const schedulerManager = require('../managers/SchedulerManager');

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

// GET /api/scheduler/tasks?network_id=&server_id=
router.get('/tasks', (req, res) => {
  res.json(schedulerManager.listTasks({
    networkId: req.query.network_id || undefined,
    serverId:  req.query.server_id  || undefined,
  }));
});

// GET /api/scheduler/tasks/:id
router.get('/tasks/:id', param('id').isUUID(), validate, (req, res) => {
  const task = schedulerManager.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// POST /api/scheduler/tasks
router.post('/tasks',
  adminOnly,
  body('action').isIn(['restart', 'command']).withMessage('action must be restart or command'),
  body('cron_expr').trim().notEmpty().withMessage('cron_expr required'),
  body('command').optional().isString(),
  body('label').optional().isString(),
  validate,
  (req, res) => {
    try {
      const task = schedulerManager.create({
        networkId: req.body.network_id || null,
        serverId:  req.body.server_id  || null,
        action:    req.body.action,
        command:   req.body.command   || '',
        cronExpr:  req.body.cron_expr,
        label:     req.body.label     || '',
      });
      res.status(201).json(task);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// PATCH /api/scheduler/tasks/:id
router.patch('/tasks/:id',
  adminOnly,
  param('id').isUUID(),
  validate,
  (req, res) => {
    try {
      const task = schedulerManager.updateTask(req.params.id, {
        cronExpr: req.body.cron_expr,
        label:    req.body.label,
        command:  req.body.command,
        enabled:  req.body.enabled,
      });
      res.json(task);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/scheduler/tasks/:id/toggle
router.post('/tasks/:id/toggle', adminOnly, param('id').isUUID(), validate, (req, res) => {
  try {
    res.json(schedulerManager.toggleTask(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// DELETE /api/scheduler/tasks/:id
router.delete('/tasks/:id', adminOnly, param('id').isUUID(), validate, (req, res) => {
  try {
    schedulerManager.deleteTask(req.params.id);
    res.status(204).end();
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

module.exports = router;
