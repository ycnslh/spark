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
  if (cached && now - cached.at < TTL_MS) {
    return { id: d.id, online: cached.online };
  }
  const online = await isHostUp(host, { timeoutMs: 800 });
  cache.set(d.id, { online, at: now });
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
  const online = await isHostUp(host, { timeoutMs: 1500 });
  cache.set(id, { online, at: Date.now() });
  const poller = getPoller();
  poller.setStatus(id, online);
  res.json({ id, online });
});

router.get('/api/status/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const poller = getPoller();
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('snapshot', poller.getSnapshot());

  const onChange = (payload) => send('change', payload);
  const onRemove = (payload) => send('remove', payload);
  poller.on('change', onChange);
  poller.on('remove', onRemove);

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(ping);
    poller.off('change', onChange);
    poller.off('remove', onRemove);
  });
});

module.exports = router;
