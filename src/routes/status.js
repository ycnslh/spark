const express = require('express');
const store = require('../services/deviceStore');
const { isHostUp } = require('../services/pinger');
const { resolveDeviceHost } = require('../utils/deviceHost');
const { getPoller } = require('../services/statusPoller');

const router = express.Router();
const cache = new Map();
const TTL_MS = 25_000;

async function checkDevice(d, now) {
  const host = resolveDeviceHost(d);
  if (!host) return { id: d.id, online: null };

  const cached = cache.get(d.id);
  if (
    cached &&
    cached.host === host &&
    cached.probePort === d.probe_port &&
    now - cached.at < TTL_MS
  ) {
    return { id: d.id, online: cached.online };
  }
  const online = await isHostUp(host, { timeoutMs: 800, probePort: d.probe_port });
  cache.set(d.id, { online, at: now, host, probePort: d.probe_port });
  return { id: d.id, online };
}

router.get('/api/status', async (_req, res) => {
  const devices = store.listDevices();
  const now = Date.now();
  const results = await Promise.all(devices.map((d) => checkDevice(d, now)));
  res.json(results);
});

router.post('/api/status/:id/refresh', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ success: false });
  const device = store.findById(id);
  if (!device) return res.status(404).json({ success: false });
  const host = resolveDeviceHost(device);
  if (!host) return res.json({ id, online: null });
  const online = await isHostUp(host, { timeoutMs: 1500, probePort: device.probe_port });
  cache.set(id, { online, at: Date.now(), host, probePort: device.probe_port });
  const poller = getPoller();
  poller.setStatus(id, online);
  res.json({ id, online });
});

module.exports = router;
