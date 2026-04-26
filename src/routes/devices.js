const express = require('express');
const store = require('../services/deviceStore');
const { isValidMac, formatMac } = require('../utils/mac');
const logger = require('../utils/logger');

const NAME_REGEX = /^[\p{L}\p{N} _.-]{1,50}$/u;
const router = express.Router();

router.get('/', (req, res) => {
  res.json(store.listDevices());
});

router.post('/', (req, res) => {
  const { name, mac, description } = req.body || {};

  if (!name || !mac) {
    return res.status(400).json({ success: false, message: 'Nom et adresse MAC requis' });
  }

  if (!NAME_REGEX.test(name)) {
    return res.status(400).json({
      success: false,
      message: 'Nom invalide (1-50 caractères, lettres/chiffres/espace/_.-)',
    });
  }

  if (!isValidMac(mac)) {
    return res.status(400).json({
      success: false,
      message: 'Format d\'adresse MAC invalide (XX:XX:XX:XX:XX:XX)',
    });
  }

  if (description && (typeof description !== 'string' || description.length > 200)) {
    return res.status(400).json({ success: false, message: 'Description invalide (max 200 caractères)' });
  }

  if (store.macExists(mac)) {
    return res.status(409).json({ success: false, message: 'Cette adresse MAC existe déjà' });
  }
  if (store.nameExists(name)) {
    return res.status(409).json({ success: false, message: 'Ce nom existe déjà' });
  }

  try {
    const device = store.createDevice({ name, mac: formatMac(mac), description: description?.trim() || null });
    logger.info('Device created', { id: device.id, name: device.name });
    return res.status(201).json({ success: true, device });
  } catch (err) {
    logger.error('Device creation failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde' });
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
  res.json(store.getHistory(id));
});

module.exports = router;
