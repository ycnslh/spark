const express = require('express');
const config = require('../config');
const { getPoller } = require('../services/statusPoller');
const eventBus = require('../services/eventBus');

function createEventsRouter({
  poller = getPoller(),
  bus = eventBus,
  maxClients = config.sseMaxClients,
  heartbeatMs = 25_000,
} = {}) {
  const router = express.Router();
  const clients = new Set();
  let closing = false;
  const broadcast = (event, payload) => {
    for (const client of clients) client.send(event, payload);
  };
  const onChange = (payload) => broadcast('status', payload);
  const onRemove = (payload) => broadcast('remove', payload);
  const onWake = (payload) => broadcast('wake', payload);
  const subscribe = () => {
    // Un seul listener par source, quel que soit le nombre de clients.
    poller.on('change', onChange);
    poller.on('remove', onRemove);
    bus.on('wake', onWake);
  };
  const unsubscribe = () => {
    poller.off('change', onChange);
    poller.off('remove', onRemove);
    bus.off('wake', onWake);
  };

  const stream = (req, res) => {
    if (closing || clients.size >= maxClients) {
      return res.status(503).json({
        success: false,
        message: closing
          ? 'Le serveur est en cours d’arrêt.'
          : 'Trop de connexions en direct. Réessayez dans quelques instants.',
      });
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Désactive le délai d'inactivité de la socket pour cette réponse longue.
    req.setTimeout(0);
    res.setTimeout(0);
    res.flushHeaders();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clients.delete(client);
      if (!clients.size) unsubscribe();
      res.off('close', close);
      res.off('error', close);
      res.end();
    };
    const write = (frame) => {
      // Un client trop lent ne doit pas accumuler des données en mémoire.
      if (!closed && !res.write(frame)) close();
    };
    const client = {
      close,
      send(event, payload) {
        const name = req.path === '/api/status/stream' && event === 'status' ? 'change' : event;
        write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
      },
    };
    if (!clients.size) subscribe();
    clients.add(client);
    res.on('close', close);
    res.on('error', close);
    const heartbeat = setInterval(() => write(': heartbeat\n\n'), heartbeatMs);
    heartbeat.unref?.();
    client.send('snapshot', poller.getSnapshot());
  };

  router.get('/api/events', stream);
  // Compatibilité avec les anciens clients, avec les mêmes limites et le même nettoyage.
  router.get('/api/status/stream', stream);
  router.closeAll = () => {
    closing = true;
    for (const client of clients) client.close();
  };
  return router;
}

module.exports = { createEventsRouter };
