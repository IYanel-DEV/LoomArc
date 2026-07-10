'use strict';

const express = require('express');
const { query, param, validationResult } = require('express-validator');
const pluginManager = require('../managers/PluginManager');

const router = express.Router();

function validate(req, res, next) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  next();
}

// GET /api/plugins/search?q=essentials&page=1&size=10&sort=-downloads
router.get('/search',
  query('q').trim().notEmpty().withMessage('q is required'),
  query('page').optional().isInt({ min: 1 }),
  query('size').optional().isInt({ min: 1, max: 50 }),
  query('sort').optional().isIn(['-downloads', '-rating', '-updateDate', 'name']),
  validate,
  async (req, res) => {
    try {
      const results = await pluginManager.search(req.query.q, {
        page: parseInt(req.query.page) || 1,
        size: parseInt(req.query.size) || 10,
        sort: req.query.sort || '-downloads',
      });
      res.json(results);
    } catch (e) {
      res.status(502).json({ error: `Spiget API error: ${e.message}` });
    }
  }
);

// GET /api/plugins/resource/:spigetId
router.get('/resource/:spigetId',
  param('spigetId').isInt({ min: 1 }),
  validate,
  async (req, res) => {
    try {
      const resource = await pluginManager.getResource(req.params.spigetId);
      res.json(resource);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }
);

// GET /api/plugins/resource/:spigetId/versions
router.get('/resource/:spigetId/versions',
  param('spigetId').isInt({ min: 1 }),
  validate,
  async (req, res) => {
    try {
      const versions = await pluginManager.getResourceVersions(req.params.spigetId);
      res.json(versions);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }
);

module.exports = router;
