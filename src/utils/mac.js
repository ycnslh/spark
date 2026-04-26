const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]?){5}([0-9A-Fa-f]{2})$/;

function isValidMac(mac) {
  return typeof mac === 'string' && MAC_REGEX.test(mac);
}

function normalizeMac(mac) {
  return mac.replace(/[:-]/g, '').toLowerCase();
}

function formatMac(mac) {
  const clean = normalizeMac(mac);
  return clean.match(/.{2}/g).join(':');
}

function macToBuffer(mac) {
  const clean = normalizeMac(mac);
  const buffer = Buffer.from(clean, 'hex');
  if (buffer.length !== 6) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  return buffer;
}

module.exports = { isValidMac, normalizeMac, formatMac, macToBuffer, MAC_REGEX };
