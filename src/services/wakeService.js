const store = require('./deviceStore');
const { sendWakeOnLan } = require('./wolSender');
const { pollUntilUp } = require('./pinger');
const { resolveDeviceHost } = require('../utils/deviceHost');
const logger = require('../utils/logger');
const config = require('../config');
const eventBus = require('./eventBus');

async function performWake(device, triggeredBy) {
  const emitWake = (state) => eventBus.emit('wake', { type: 'wake', deviceId: device.id, state });
  try {
    await sendWakeOnLan(
      device.mac,
      device.broadcast ? { broadcasts: [device.broadcast] } : undefined
    );
  } catch (err) {
    emitWake('failed');
    throw err;
  }
  emitWake('sent');
  const result = store.recordWake({ deviceId: device.id, triggeredBy, success: true });
  const host = resolveDeviceHost(device);
  if (host) {
    pollUntilUp(host, {
      totalMs: config.pingTimeoutMs,
      intervalMs: config.pingIntervalMs,
      probePort: device.probe_port,
    })
      .then((up) => {
        store.setLastPingResult(result.lastInsertRowid, up);
        emitWake(up ? 'confirmed' : 'timeout');
      })
      .catch((err) => logger.warn('Ping poll failed', { error: err.message }));
  }
}

module.exports = { performWake };
