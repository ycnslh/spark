const express = require('express');
const store = require('../services/deviceStore');
const tagStore = require('../services/tagStore');
const { isValidMac, formatMac } = require('../utils/mac');
const { isSafeHost } = require('../services/pinger');
const logger = require('../utils/logger');

const NAME_REGEX = /^[\p{L}\p{N} _.-]{1,50}$/u;
const router = express.Router();

function validateName(name) {
  if (!name || typeof name !== 'string') return 'Nom requis';
  if (!NAME_REGEX.test(name)) return 'Nom invalide (1-50 caractères, lettres/chiffres/espace/_.-)';
  return null;
}

function validateHost(host) {
  if (host == null || host === '') return null;
  if (typeof host !== 'string' || !isSafeHost(host.trim()))
    return 'Host invalide (IPv4, IPv6 ou hostname uniquement)';
  return null;
}

function validateDescription(description) {
  if (description == null || description === '') return null;
  if (typeof description !== 'string' || description.length > 200)
    return 'Description invalide (max 200 caractères)';
  return null;
}

router.get('/', (_req, res) => {
  res.json(tagStore.listDevicesWithTags());
});

router.post('/', (req, res) => {
  const { name, mac, host, description } = req.body || {};

  if (!name || !mac) {
    return res.status(400).json({ success: false, message: 'Nom et adresse MAC requis' });
  }

  const nameErr = validateName(name);
  if (nameErr) return res.status(400).json({ success: false, message: nameErr });

  if (!isValidMac(mac)) {
    return res.status(400).json({
      success: false,
      message: "Format d'adresse MAC invalide (XX:XX:XX:XX:XX:XX)",
    });
  }

  const hostErr = validateHost(host);
  if (hostErr) return res.status(400).json({ success: false, message: hostErr });

  const descErr = validateDescription(description);
  if (descErr) return res.status(400).json({ success: false, message: descErr });

  if (store.macExists(mac)) {
    return res.status(409).json({ success: false, message: 'Cette adresse MAC existe déjà' });
  }
  if (store.nameExists(name)) {
    return res.status(409).json({ success: false, message: 'Ce nom existe déjà' });
  }

  try {
    const device = store.createDevice({
      name,
      mac: formatMac(mac),
      host: host?.trim() || null,
      description: description?.trim() || null,
    });
    logger.info('Device created', { id: device.id, name: device.name });
    return res.status(201).json({ success: true, device });
  } catch (err) {
    logger.error('Device creation failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde' });
  }
});

router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'ID invalide' });
  const existing = store.findById(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Appareil non trouvé' });

  const { name, host, description } = req.body || {};
  const update = {};

  if (name !== undefined) {
    const err = validateName(name);
    if (err) return res.status(400).json({ success: false, message: err });
    if (store.nameExists(name, id)) {
      return res.status(409).json({ success: false, message: 'Ce nom existe déjà' });
    }
    update.name = name;
  }
  if (host !== undefined) {
    const err = validateHost(host);
    if (err) return res.status(400).json({ success: false, message: err });
    update.host = host?.trim() || null;
  }
  if (description !== undefined) {
    const err = validateDescription(description);
    if (err) return res.status(400).json({ success: false, message: err });
    update.description = description?.trim() || null;
  }

  try {
    const device = store.updateDevice(id, update);
    logger.info('Device updated', { id, fields: Object.keys(update) });
    return res.json({ success: true, device });
  } catch (err) {
    logger.error('Device update failed', { id, error: err.message });
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour' });
  }
});

router.delete('/:mac', (req, res) => {
  const { mac } = req.params;
  if (!isValidMac(mac)) {
    return res.status(400).json({ success: false, message: 'Adresse MAC invalide' });
  }
  if (!store.deleteByMac(mac)) {
    return res.status(404).json({ success: false, message: 'Appareil non trouvé' });
  }
  logger.info('Device deleted', { mac });
  return res.json({ success: true });
});

router.get('/:id/history', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ success: false });
  if (!store.findById(id)) return res.status(404).json({ success: false });
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const before = parseInt(req.query.before, 10);
  res.json(store.getHistory(id, limit, Number.isInteger(before) ? before : null));
});

module.exports = router;
