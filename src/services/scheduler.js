const config = require('../config');
const scheduleStore = require('./scheduleStore');
const deviceStore = require('./deviceStore');
const { performWake } = require('./wakeService');
const logger = require('../utils/logger');

function createScheduler({
  intervalMs = 30_000,
  now = () => new Date(),
  timeZone = config.scheduler.timeZone,
  enabled = config.scheduler.enabled,
  store = scheduleStore,
  devices = deviceStore,
  wake = performWake,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error('Intervalle de planification invalide');
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
  } catch {
    throw new Error('Fuseau horaire SCHEDULER_TZ invalide');
  }
  let timer = null;
  let pending = null;
  let stopped = false;

  async function runTick() {
    if (stopped || !enabled || store.getState().paused) return;
    const date = now();
    const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
    const time = `${parts.hour}:${parts.minute}`;
    const minuteKey = `${parts.year}-${parts.month}-${parts.day}T${time}`;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    // On ne parcourt que la minute courante : aucun rattrapage après un arrêt.
    await Promise.all(
      store.listSchedules().map(async (schedule) => {
        if (stopped || !schedule.enabled || schedule.time !== time || !schedule.days.includes(day))
          return;
        try {
          if (!store.claimMinute(schedule.id, minuteKey, date.toISOString())) return;
          const device = devices.findById(schedule.device_id);
          if (!device) return;
          try {
            await wake(device, `schedule:${schedule.id}`);
            store.finishRun(schedule.id, minuteKey, 'sent');
          } catch (err) {
            devices.recordWake({
              deviceId: device.id,
              triggeredBy: `schedule:${schedule.id}`,
              success: false,
            });
            store.finishRun(schedule.id, minuteKey, 'failed');
            throw err;
          }
        } catch (err) {
          logger.warn('Échec du réveil planifié', { scheduleId: schedule.id, error: err.message });
        }
      })
    );
  }

  function tick() {
    if (!pending) {
      pending = runTick()
        .catch((err) => logger.warn('Échec du scheduler', { error: err.message }))
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  }

  function start() {
    if (timer !== null || !enabled) return;
    stopped = false;
    timer = setIntervalFn(tick, intervalMs);
    timer.unref?.();
    tick();
  }

  async function stop() {
    stopped = true;
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
    await pending;
  }

  return { tick, start, stop };
}

module.exports = { createScheduler };
