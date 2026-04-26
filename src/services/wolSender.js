const dgram = require('dgram');
const { macToBuffer } = require('../utils/mac');
const logger = require('../utils/logger');

const BROADCAST_ADDRESS = '255.255.255.255';
const WOL_PORT = 9;

function buildMagicPacket(macBuffer) {
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBuffer.copy(packet, 6 + i * 6);
  }
  return packet;
}

function sendWakeOnLan(mac) {
  return new Promise((resolve, reject) => {
    let macBuffer;
    try {
      macBuffer = macToBuffer(mac);
    } catch (err) {
      return reject(err);
    }

    const packet = buildMagicPacket(macBuffer);
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      logger.error('WoL socket error', { error: err.message });
      socket.close();
      reject(err);
    });

    socket.on('listening', () => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, WOL_PORT, BROADCAST_ADDRESS, (err) => {
        socket.close();
        if (err) {
          logger.error('WoL send error', { mac, error: err.message });
          return reject(err);
        }
        logger.info('WoL packet sent', { mac });
        resolve();
      });
    });

    socket.bind({ address: '0.0.0.0', port: 0 });
  });
}

module.exports = { sendWakeOnLan, buildMagicPacket };
