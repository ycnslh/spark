const express = require('express');
const store = require('../services/deviceStore');
const tagStore = require('../services/tagStore');
const { isValidMac, formatMac } = require('../utils/mac');
const { isSafeHost } = require('../services/pinger');
const { getDb } = require('../services/db');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/api/export', (_req, res) => {
  const devices = tagStore.listDevicesWithTags();
  const tags = tagStore.listTags();
  res.set('Content-Disposition', 'attachment; filename="spark-export.json"');
  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    tags,
    devices: devices.map((d) => ({
      name: d.name,
      mac: d.mac,
      host: d.host,
      description: d.description,
      tags: (d.tags || []).map((t) => t.name),
    })),
  });
});

router.post('/api/import', (req, res) => {
  const payload = req.body || {};
  if (payload.version !== 1) {
    return res.status(400).json({ success: false, message: "Version d'export non supportée" });
  }
  const { devices = [], tags = [] } = payload;
  if (!Array.isArray(devices) || !Array.isArray(tags)) {
    return res.status(400).json({ success: false, message: 'Format invalide' });
  }

  const db = getDb();
  const stats = { devices: 0, tags: 0, skipped: 0 };

  const tx = db.transaction(() => {
    const tagIdByName = new Map();
    for (const t of tags) {
      if (!tagStore.isValidTagName(t.name) || !tagStore.isValidColor(t.color)) {
        stats.skipped++;
        continue;
      }
      const existing = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(t.name);
      if (existing) {
        tagIdByName.set(t.name.toLowerCase(), existing.id);
      } else {
        const created = tagStore.createTag({ name: t.name, color: t.color });
        tagIdByName.set(created.name.toLowerCase(), created.id);
        stats.tags++;
      }
    }

    for (const d of devices) {
      if (!d || typeof d.name !== 'string' || !isValidMac(d.mac)) {
        stats.skipped++;
        continue;
      }
      if (d.host && !isSafeHost(d.host)) {
        stats.skipped++;
        continue;
      }
      if (store.macExists(d.mac) || store.nameExists(d.name)) {
        stats.skipped++;
        continue;
      }
      const created = store.createDevice({
        name: d.name,
        mac: formatMac(d.mac),
        host: d.host || null,
        description: d.description || null,
      });
      if (Array.isArray(d.tags) && d.tags.length) {
        const tagIds = d.tags
          .map((name) => tagIdByName.get(String(name).toLowerCase()))
          .filter(Number.isInteger);
        if (tagIds.length) tagStore.setDeviceTags(created.id, tagIds);
      }
      stats.devices++;
    }
  });

  try {
    tx();
    logger.info('Import completed', stats);
    return res.json({ success: true, stats });
  } catch (err) {
    logger.error('Import failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Erreur import' });
  }
});

module.exports = router;
