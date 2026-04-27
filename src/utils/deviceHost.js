const { isSafeHost } = require('../services/pinger');

const IPV4_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/;

function resolveDeviceHost(device) {
  if (!device) return null;
  if (device.host && isSafeHost(device.host.trim())) return device.host.trim();
  if (device.description) {
    const desc = device.description.trim();
    if (IPV4_REGEX.test(desc) && isSafeHost(desc)) return desc;
  }
  return null;
}

module.exports = { resolveDeviceHost };
