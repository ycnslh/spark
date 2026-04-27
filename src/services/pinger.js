const net = require('net');
const { execFile } = require('child_process');
const logger = require('../utils/logger');

const PROBE_PORTS = [22, 3389, 445, 80];
const HOST_REGEX = /^[a-zA-Z0-9.:_-]{1,253}$/;

function isSafeHost(host) {
  return typeof host === 'string' && HOST_REGEX.test(host);
}

function tcpProbe(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (!isSafeHost(host)) return resolve(false);
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function icmpPing(host, timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (!isSafeHost(host)) return resolve(false);
    const flag = process.platform === 'darwin' ? '-t' : '-W';
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    execFile(
      'ping',
      ['-c', '1', flag, String(seconds), host],
      { timeout: timeoutMs + 500 },
      (error) => {
        resolve(!error);
      }
    );
  });
}

async function isHostUp(host, options = {}) {
  if (!host) return false;
  if (await icmpPing(host, options.timeoutMs)) return true;
  for (const port of PROBE_PORTS) {
    if (await tcpProbe(host, port, options.timeoutMs)) return true;
  }
  return false;
}

async function pollUntilUp(host, { totalMs, intervalMs }) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (await isHostUp(host)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  logger.debug('pollUntilUp timed out', { host });
  return false;
}

module.exports = { isHostUp, pollUntilUp, tcpProbe, icmpPing, isSafeHost };
