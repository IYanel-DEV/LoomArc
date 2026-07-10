'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const authManager = require('../managers/AuthManager');

const router = express.Router();

function validate(req, res, next) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  next();
}

// POST /api/auth/login
router.post('/login',
  body('username').trim().notEmpty().withMessage('username required'),
  body('password').notEmpty().withMessage('password required'),
  validate,
  (req, res) => {
    const user = authManager.verifyPassword(req.body.username, req.body.password);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const token = authManager.signToken(user);
    res.json({ token, username: user.username, role: user.role });
  }
);

// POST /api/auth/setup  — create first admin (only if no users exist)
router.post('/setup',
  body('username').trim().notEmpty().withMessage('username required')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('username may only contain letters, numbers, - and _'),
  body('password').isLength({ min: 6 }).withMessage('password must be at least 6 characters'),
  validate,
  (req, res) => {
    if (authManager.hasUsers()) {
      return res.status(403).json({ error: 'Setup already complete — log in instead.' });
    }
    try {
      const user  = authManager.createUser(req.body.username, req.body.password, 'admin');
      const token = authManager.signToken({ id: user.id, username: user.username, role: user.role });
      res.status(201).json({ token, username: user.username, role: user.role });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/auth/me — verify token and return current user
router.get('/me', (req, res) => {
  res.json({ id: req.user.sub, username: req.user.username, role: req.user.role });
});

// GET /api/auth/users — admin only
router.get('/users', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(authManager.listUsers());
});

// POST /api/auth/users — admin only
router.post('/users',
  body('username').trim().notEmpty().withMessage('username required')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('letters, numbers, - and _ only'),
  body('password').isLength({ min: 6 }).withMessage('password must be ≥ 6 characters'),
  body('role').optional().isIn(['admin', 'viewer']).withMessage('role must be admin or viewer'),
  validate,
  (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      const user = authManager.createUser(req.body.username, req.body.password, req.body.role || 'viewer');
      res.status(201).json(user);
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  }
);

// PATCH /api/auth/users/:id — change password or role (admin only)
router.patch('/users/:id',
  param('id').isUUID(),
  body('password').optional().isLength({ min: 6 }).withMessage('password must be ≥ 6 characters'),
  body('role').optional().isIn(['admin', 'viewer']),
  validate,
  (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      if (req.body.password) authManager.updatePassword(req.params.id, req.body.password);
      if (req.body.role)     authManager.updateRole(req.params.id, req.body.role);
      const user = authManager.getUser(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// DELETE /api/auth/users/:id — admin only
router.delete('/users/:id', param('id').isUUID(), validate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    authManager.deleteUser(req.params.id);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
