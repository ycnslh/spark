const dgram = require('dgram');
const os = require('os');
const { isIPv4 } = require('net');
const config = require('../config');
const { macToBuffer } = require('../utils/mac');
const logger = require('../utils/logger');

const BROADCAST_ADDRESS = '255.255.255.255';

function calculateBroadcasts(networkInterfaces) {
  const broadcasts = new Set();
  for (const addresses of Object.values(networkInterfaces)) {
    for (const entry of addresses || []) {
      if (
        entry.internal ||
        (entry.family !== 'IPv4' && entry.family !== 4) ||
        !isIPv4(entry.address) ||
        !isIPv4(entry.netmask)
      ) {
        continue;
      }
      const mask = entry.netmask.split('.').map(Number);
      const broadcast = entry.address
        .split('.')
        .map((octet, i) => Number(octet) | (~mask[i] & 255))
        .join('.');
      broadcasts.add(broadcast);
    }
  }
  broadcasts.add(BROADCAST_ADDRESS);
  return [...broadcasts];
}

function buildMagicPacket(macBuffer) {
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBuffer.copy(packet, 6 + i * 6);
  }
  return packet;
}

function sendToBroadcast(packet, broadcast, port) {
  return new Promise((resolve, reject) => {
    // A socket per target keeps a socket error from cancelling the other sends.
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;
    function finish(err) {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // Binding may have failed before the socket started running.
      }
      if (err) reject(err);
      else resolve();
    }

    socket.on('error', finish);
    socket.once('listening', () => {
      try {
        socket.setBroadcast(true);
        socket.send(packet, 0, packet.length, port, broadcast, finish);
      } catch (err) {
        finish(err);
      }
    });
    try {
      socket.bind({ address: '0.0.0.0', port: 0 });
    } catch (err) {
      finish(err);
    }
  });
}

async function sendPacket(packet, broadcasts, port) {
  const results = await Promise.allSettled(
    broadcasts.map((broadcast) => sendToBroadcast(packet, broadcast, port))
  );
  const errors = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      errors.push(result.reason);
      logger.debug('WoL target failed', { broadcast: broadcasts[i], error: result.reason.message });
    }
  });
  if (errors.length === results.length) {
    throw new AggregateError(errors, 'WoL send failed for all targets');
  }
}

async function sendWakeOnLan(mac, options = {}) {
  const packet = buildMagicPacket(macToBuffer(mac));
  const broadcasts =
    options.broadcasts ??
    (config.wol.broadcast
      ? [config.wol.broadcast]
      : config.wol.allInterfaces
        ? calculateBroadcasts(os.networkInterfaces())
        : [BROADCAST_ADDRESS]);
  const port = options.port ?? config.wol.port;
  const repeatDelayMs = options.repeatDelayMs ?? config.wol.repeatDelayMs;

  try {
    await sendPacket(packet, broadcasts, port);
  } catch (err) {
    logger.error('WoL send error', { mac, error: err.message });
    throw err;
  }
  logger.info('WoL packet sent', { mac });

  if (repeatDelayMs > 0) {
    setTimeout(() => {
      sendPacket(packet, broadcasts, port).then(
        () => logger.debug('WoL repeat sent', { mac }),
        (err) => logger.debug('WoL repeat failed', { mac, error: err.message })
      );
    }, repeatDelayMs).unref();
  }
}

module.exports = { sendWakeOnLan, buildMagicPacket, calculateBroadcasts };
