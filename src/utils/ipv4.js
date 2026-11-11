const { isIPv4 } = require('net');

function extractIPv4(text) {
  if (typeof text !== 'string') return null;
  const candidates = text.match(/(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w.])/g) || [];
  return candidates.find((candidate) => isIPv4(candidate)) || null;
}

function validateNetworkFields({ ip, broadcast, probe_port }) {
  for (const [label, value] of [
    ['IP', ip],
    ['Broadcast', broadcast],
  ]) {
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || !isIPv4(value)) return `${label} invalide (IPv4 requise)`;
  }
  if (
    probe_port != null &&
    (!Number.isInteger(probe_port) || probe_port < 1 || probe_port > 65535)
  ) {
    return 'Port de sonde invalide (entier entre 1 et 65535 requis)';
  }
  return null;
}

module.exports = { extractIPv4, validateNetworkFields };
