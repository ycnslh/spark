const express = require('express');
const store = require('../services/deviceStore');
const { isHostUp } = require('../services/pinger');

const router = express.Router();
const cache = new Map();
const TTL_MS = 25_000;

router.get('/api/status', async (_req, res) => {
  const devices = store.listDevices();
  const now = Date.now();

  const results = await Promise.all(
    devices.map(async (d) => {
      const host = d.description && /^\d+\.\d+\.\d+\.\d+$/.test(d.description.trim())
        ? d.description.trim()
        : null;
      if (!host) return { id: d.id, online: null };

      const cached = cache.get(d.id);
      if (cached && now - cached.at < TTL_MS) {
        return { id: d.id, online: cached.online };
      }
      const online = await isHostUp(host, { timeoutMs: 800 });
      cache.set(d.id, { online, at: now });
      return { id: d.id, online };
    })
  );

  res.json(results);
});

module.exports = router;
