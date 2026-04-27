const express = require('express');
const tagStore = require('../services/tagStore');
const store = require('../services/deviceStore');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/api/tags', (_req, res) => {
  res.json(tagStore.listTags());
});

router.post('/api/tags', (req, res) => {
  const { name, color } = req.body || {};
  if (!tagStore.isValidTagName(name)) {
    return res.status(400).json({ success: false, message: 'Nom de tag invalide' });
  }
  if (!tagStore.isValidColor(color)) {
    return res.status(400).json({ success: false, message: 'Couleur invalide (#RRGGBB)' });
  }
  try {
    const tag = tagStore.createTag({ name, color });
    return res.status(201).json({ success: true, tag });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ success: false, message: 'Tag existe déjà' });
    }
    logger.error('Tag create failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Erreur' });
  }
});

router.delete('/api/tags/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ success: false });
  if (!tagStore.deleteTag(id)) return res.status(404).json({ success: false });
  res.json({ success: true });
});

router.put('/api/devices/:id/tags', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ success: false });
  if (!store.findById(id)) return res.status(404).json({ success: false });
  const { tagIds } = req.body || {};
  if (!Array.isArray(tagIds)) {
    return res.status(400).json({ success: false, message: 'tagIds doit être un tableau' });
  }
  tagStore.setDeviceTags(id, tagIds.map((n) => parseInt(n, 10)).filter(Number.isInteger));
  res.json({ success: true, tags: tagStore.tagsForDevice(id) });
});

module.exports = router;
