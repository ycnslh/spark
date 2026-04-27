const EventEmitter = require('events');
const store = require('./deviceStore');
const { isHostUp } = require('./pinger');
const { resolveDeviceHost } = require('../utils/deviceHost');
const logger = require('../utils/logger');

class StatusPoller extends EventEmitter {
  constructor({ intervalMs = 30_000, timeoutMs = 800 } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.timer = null;
    this.lastStatus = new Map();
    this.running = false;
  }

  getSnapshot() {
    return [...this.lastStatus.entries()].map(([id, online]) => ({ id, online }));
  }

  setStatus(id, online) {
    const prev = this.lastStatus.get(id);
    if (prev === online) return false;
    this.lastStatus.set(id, online);
    this.emit('change', { id, online });
    return true;
  }

  async runOnce() {
    const devices = store.listDevices();
    const seen = new Set();
    await Promise.all(
      devices.map(async (d) => {
        seen.add(d.id);
        const host = resolveDeviceHost(d);
        const online = host ? await isHostUp(host, { timeoutMs: this.timeoutMs }) : null;
        this.setStatus(d.id, online);
      })
    );
    for (const id of [...this.lastStatus.keys()]) {
      if (!seen.has(id)) {
        this.lastStatus.delete(id);
        this.emit('remove', { id });
      }
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      try {
        await this.runOnce();
      } catch (err) {
        logger.warn('StatusPoller loop failed', { error: err.message });
      }
      if (this.running) this.timer = setTimeout(loop, this.intervalMs);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

let instance = null;
function getPoller(options) {
  if (!instance) instance = new StatusPoller(options);
  return instance;
}

module.exports = { StatusPoller, getPoller };
