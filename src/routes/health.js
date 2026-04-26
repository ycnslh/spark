const express = require('express');
const { getDb } = require('../services/db');

const router = express.Router();

router.get('/', (_req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

module.exports = router;
