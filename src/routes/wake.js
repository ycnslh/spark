const express = require('express');
const store = require('../services/deviceStore');
const { sendWakeOnLan } = require('../services/wolSender');
const { pollUntilUp } = require('../services/pinger');
const { isValidMac } = require('../utils/mac');
const { renderPage, escapeHtml } = require('../utils/html');
const { wakeRateLimiter } = require('../middleware/rateLimit');
const { sameOrigin } = require('../middleware/sameOrigin');
const { resolveDeviceHost } = require('../utils/deviceHost');
const logger = require('../utils/logger');
const config = require('../config');

const router = express.Router();
const requireSameOrigin = sameOrigin();

async function performWake(device, triggeredBy) {
  await sendWakeOnLan(device.mac);
  const result = store.recordWake({ deviceId: device.id, triggeredBy, success: true });
  const host = resolveDeviceHost(device);
  if (host) {
    pollUntilUp(host, { totalMs: config.pingTimeoutMs, intervalMs: config.pingIntervalMs })
      .then((up) => store.setLastPingResult(result.lastInsertRowid, up))
      .catch((err) => logger.warn('Ping poll failed', { error: err.message }));
  }
}

router.post('/api/wake/:mac', requireSameOrigin, wakeRateLimiter, async (req, res) => {
  const { mac } = req.params;
  if (!isValidMac(mac)) {
    return res.status(400).json({ success: false, message: 'Adresse MAC invalide' });
  }
  const device = store.findByMac(mac);
  if (!device) {
    return res.status(404).json({ success: false, message: 'Appareil non trouvé' });
  }
  try {
    await performWake(device, req.authUser || req.ip);
    return res.json({ success: true, message: `Paquet WoL envoyé à ${device.mac}` });
  } catch (err) {
    store.recordWake({ deviceId: device.id, triggeredBy: req.authUser || req.ip, success: false });
    logger.error('Wake failed', { mac, error: err.message });
    return res
      .status(500)
      .json({ success: false, message: "Erreur lors de l'envoi du paquet WoL" });
  }
});

router.get('/wake/:deviceId', requireSameOrigin, wakeRateLimiter, async (req, res) => {
  const device = store.findByNameOrMac(req.params.deviceId);
  if (!device) {
    const page = renderPage({
      title: 'Erreur',
      status: 404,
      body: `<h1>Erreur</h1><p class="err">Appareil "${escapeHtml(req.params.deviceId)}" non trouvé</p>`,
    });
    return res.status(page.status).send(page.html);
  }
  try {
    await performWake(device, req.authUser || req.ip);
    const page = renderPage({
      title: 'Réveil envoyé',
      body: `<h1>Succès</h1>
        <p class="ok">Signal de réveil envoyé !</p>
        <div class="card">
          <p><strong>Appareil :</strong> ${escapeHtml(device.name)}</p>
          <p><strong>Adresse MAC :</strong> ${escapeHtml(device.mac)}</p>
        </div>`,
    });
    res.send(page.html);
  } catch (err) {
    store.recordWake({ deviceId: device.id, triggeredBy: req.authUser || req.ip, success: false });
    const page = renderPage({
      title: 'Erreur',
      status: 500,
      body: `<h1>Erreur</h1><p class="err">${escapeHtml(err.message)}</p>`,
    });
    res.status(page.status).send(page.html);
  }
});

module.exports = router;
