const { isSafeHost } = require('../services/pinger');

const { isIPv4 } = require('net');
const { extractIPv4 } = require('./ipv4');

function resolveDeviceHost(device) {
  if (!device) return null;
  if (typeof device.ip === 'string' && isIPv4(device.ip) && isSafeHost(device.ip)) return device.ip;
  if (typeof device.host === 'string' && isSafeHost(device.host.trim())) return device.host.trim();
  return extractIPv4(device.description);
}

module.exports = { resolveDeviceHost };
