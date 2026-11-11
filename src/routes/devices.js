const express = require('express');
const store = require('../services/deviceStore');
const tokenStore = require('../services/tokenStore');
const tagStore = require('../services/tagStore');
const { isValidMac, formatMac } = require('../utils/mac');
const { isSafeHost } = require('../services/pinger');
const logger = require('../utils/logger');
const { validateNetworkFields } = require('../utils/ipv4');

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
  const { name, mac, host, description, ip, broadcast, probe_port } = req.body || {};
  const networkErr = validateNetworkFields({ ip, broadcast, probe_port });
  if (networkErr) return res.status(400).json({ success: false, message: networkErr });

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
      ip: ip || null,
      broadcast: broadcast || null,
      probe_port: probe_port ?? null,
    });
    logger.info('Device created', { id: device.id, name: device.name });
    return res.status(201).json({ success: true, device });
  } catch (err) {
    logger.error('Device creation failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde' });
  }
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1)
    return res.status(400).json({ success: false, message: 'ID invalide' });
  const existing = store.findById(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Appareil non trouvé' });

  const { name, host, description, ip, broadcast, probe_port } = req.body || {};
  const networkErr = validateNetworkFields({ ip, broadcast, probe_port });
  if (networkErr) return res.status(400).json({ success: false, message: networkErr });
  const update = { ip, broadcast, probe_port };

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

// Les gardes Basic, origine et débit d'écriture sont appliquées par server.js.
router.use('/:id/tokens', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1)
    return res.status(400).json({ success: false, message: 'ID invalide' });
  const device = store.findById(id);
  if (!device) return res.status(404).json({ success: false, message: 'Appareil non trouvé' });
  req.tokenDevice = device;
  res.set('Cache-Control', 'no-store');
  return next();
});

router.post('/:id/tokens', (req, res) => {
  const { label } = req.body || {};
  if (label !== undefined && (typeof label !== 'string' || Array.from(label).length > 60)) {
    return res
      .status(400)
      .json({ success: false, message: 'Libellé invalide (max 60 caractères)' });
  }
  const created = tokenStore.createToken(req.tokenDevice.id, label?.trim() || null);
  // La MAC reste stable après un renommage de l'appareil.
  const url = `${req.protocol}://${req.get('host')}/wake/${req.tokenDevice.mac}?token=${created.token}`;
  return res.status(201).json({ ...created, url });
});

router.get('/:id/tokens', (req, res) => {
  return res.json(tokenStore.listTokens(req.tokenDevice.id));
});

router.delete('/:id/tokens/:tokenId', (req, res) => {
  const id = Number(req.params.tokenId);
  if (!Number.isSafeInteger(id) || id < 1)
    return res.status(400).json({ success: false, message: 'ID de token invalide' });
  if (!tokenStore.revokeToken(req.tokenDevice.id, id))
    return res.status(404).json({ success: false, message: 'Token non trouvé' });
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
