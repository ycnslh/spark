const { test, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-scheduler-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.TZ = 'UTC';
process.env.SCHEDULER_ENABLED = 'true';
const sender = require('../src/services/wolSender');
const pinger = require('../src/services/pinger');
// Ces doubles sont installés avant le service partagé : aucun UDP ni ping réel.
const wol = mock.method(sender, 'sendWakeOnLan', async () => {});
const ping = mock.method(pinger, 'pollUntilUp', async () => true);
require('../src/config').dataDir = tmpDir;
const { createScheduler } = require('../src/services/scheduler');
const { getDb, closeDb } = require('../src/services/db');
const devices = require('../src/services/deviceStore');
const schedules = require('../src/services/scheduleStore');
const eventBus = require('../src/services/eventBus');
let device;
let clock;
const makeScheduler = (options = {}) =>
  createScheduler({ now: () => new Date(clock), timeZone: 'UTC', ...options });
const create = (options = {}, deviceId = device.id) =>
  schedules.createSchedule(deviceId, { time: '08:30', days: [1], ...options });

beforeEach(() => {
  getDb().exec('DELETE FROM devices');
  schedules.setPaused(false);
  device = devices.createDevice({ name: 'PC', mac: 'aa:bb:cc:dd:ee:01' });
  clock = '2026-11-09T08:30:05.000Z'; // Lundi.
  wol.mock.resetCalls();
  ping.mock.resetCalls();
});
after(() => {
  closeDb();
  mock.restoreAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('tick : correspondance heure/jour, déduplication persistée et historique schedule:<id>', async () => {
  const schedule = create();
  create({ time: '08:31' });
  create({ days: [0] });
  const scheduler = makeScheduler();
  await scheduler.tick();
  clock = '2026-11-09T08:30:50.000Z';
  await scheduler.tick();
  assert.equal(wol.mock.callCount(), 1);
  const last = schedules.findById(schedule.id);
  assert.equal(last.last_run_at, '2026-11-09T08:30:05.000Z');
  assert.equal(last.last_run_minute, '2026-11-09T08:30');
  assert.equal(last.last_status, 'sent');
  assert.equal(devices.getHistory(device.id)[0].triggered_by, `schedule:${schedule.id}`);
  closeDb();
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 1, 'Un redémarrage dans la minute ne doit pas renvoyer');
  clock = '2026-11-16T08:30:00.000Z';
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 2, 'La semaine suivante doit fonctionner');
});

test('réservation persistée avant l’envoi : un arrêt brutal ne rejoue pas une tentative', async () => {
  const schedule = create();
  schedules.claimMinute(schedule.id, '2026-11-09T08:30', clock);
  closeDb();
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 0);
  assert.equal(schedules.findById(schedule.id).last_status, 'running');
});

test('pause globale persistée, planification désactivée et scheduler désactivé', async () => {
  const schedule = create({ enabled: false });
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 0);
  schedules.updateSchedule(schedule.id, { enabled: true });
  schedules.setPaused(true);
  closeDb();
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 0);
  schedules.setPaused(false);
  const disabled = makeScheduler({
    enabled: false,
    setIntervalFn: () => assert.fail('Aucun timer si désactivé'),
  });
  disabled.start();
  await disabled.tick();
  assert.equal(wol.mock.callCount(), 0);
  assert.equal(schedules.findById(schedule.id).last_run_at, null);
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 1);
});

test('aucun rattrapage des minutes manquées pendant un arrêt ou une pause', async () => {
  create();
  clock = '2026-11-09T08:29:59Z';
  await makeScheduler().tick();
  clock = '2026-11-09T08:31:00Z';
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 0);
  clock = '2026-11-16T08:30:00Z';
  schedules.setPaused(true);
  await makeScheduler().tick();
  schedules.setPaused(false);
  clock = '2026-11-16T08:31:00Z';
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 0);
});

test('fuseau différent du système : heure et jour locaux, y compris minuit', async () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC');
  create({ time: '00:00', days: [2] });
  clock = '2026-11-09T15:00:00Z'; // Mardi à Tokyo, lundi sur le système.
  await makeScheduler({ timeZone: 'Asia/Tokyo' }).tick();
  assert.equal(wol.mock.callCount(), 1);
  assert.equal(schedules.listSchedules()[0].last_run_minute, '2026-11-10T00:00');
  assert.throws(() => makeScheduler({ timeZone: 'Invalide/Fuseau' }), /SCHEDULER_TZ invalide/);
});

test('heure d’été : heure inexistante ignorée et minute répétée exécutée une seule fois', async () => {
  const schedule = create({ time: '02:30', days: [0] });
  const scheduler = makeScheduler({ timeZone: 'Europe/Paris' });
  clock = '2026-03-29T00:30:00Z'; // 01:30 CET.
  await scheduler.tick();
  clock = '2026-03-29T01:30:00Z'; // 03:30 CEST, pas de 02:30.
  await scheduler.tick();
  assert.equal(wol.mock.callCount(), 0);
  clock = '2026-10-25T00:30:00Z'; // Premier 02:30.
  await scheduler.tick();
  closeDb();
  clock = '2026-10-25T01:30:00Z'; // Second 02:30 après redémarrage.
  await makeScheduler({ timeZone: 'Europe/Paris' }).tick();
  assert.equal(wol.mock.callCount(), 1);
  assert.equal(schedules.findById(schedule.id).last_run_minute, '2026-10-25T02:30');
});

test('un échec isolé conserve historique/SSE et laisse les autres planifications s’exécuter', async (t) => {
  const failed = create();
  const next = create();
  const events = [];
  const listener = (event) => events.push(event);
  eventBus.on('wake', listener);
  t.after(() => eventBus.off('wake', listener));
  wol.mock.mockImplementationOnce(async () => {
    throw new Error('UDP simulé indisponible');
  });
  const scheduler = makeScheduler();
  await scheduler.tick();
  assert.equal(wol.mock.callCount(), 2);
  assert.equal(schedules.findById(failed.id).last_status, 'failed');
  assert.equal(schedules.findById(next.id).last_status, 'sent');
  const history = devices.getHistory(device.id);
  assert.equal(history.find((h) => h.triggered_by === `schedule:${failed.id}`).success, 0);
  assert.equal(history.find((h) => h.triggered_by === `schedule:${next.id}`).success, 1);
  assert.deepEqual(events.map((e) => e.state).sort(), ['failed', 'sent']);
  assert.ok(events.every((e) => e.type === 'wake' && e.deviceId === device.id));
  await scheduler.tick();
  assert.equal(wol.mock.callCount(), 2, 'Un échec ne doit pas être rejoué dans la minute');
  clock = '2026-11-16T08:30:00Z';
  await scheduler.tick();
  assert.equal(wol.mock.callCount(), 4);
});

test('le réveil partagé conserve broadcast, sonde et événements de confirmation', async (t) => {
  devices.updateDevice(device.id, { ip: '192.0.2.1', broadcast: '192.0.2.255', probe_port: 3389 });
  create();
  const states = [];
  const listener = (event) => states.push(event.state);
  eventBus.on('wake', listener);
  t.after(() => eventBus.off('wake', listener));
  await makeScheduler().tick();
  await Promise.resolve();
  assert.deepEqual(wol.mock.calls[0].arguments, [device.mac, { broadcasts: ['192.0.2.255'] }]);
  assert.equal(ping.mock.calls[0].arguments[0], '192.0.2.1');
  assert.equal(ping.mock.calls[0].arguments[1].probePort, 3389);
  assert.deepEqual(states, ['sent', 'confirmed']);
  assert.equal(devices.getHistory(device.id)[0].ping_confirmed, 1);
});

test('timers injectables et unref, start idempotent, ticks concurrents, stop attend l’envoi', async () => {
  create();
  let release;
  wol.mock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  let callback;
  let unrefs = 0;
  let cleared = 0;
  const handle = {
    unref: () => {
      unrefs++;
    },
  };
  const scheduler = makeScheduler({
    intervalMs: 123,
    setIntervalFn: (fn, ms) => {
      assert.equal(ms, 123);
      callback = fn;
      return handle;
    },
    clearIntervalFn: (timer) => {
      assert.equal(timer, handle);
      cleared++;
    },
  });
  scheduler.start();
  scheduler.start();
  assert.equal(unrefs, 1);
  callback();
  assert.equal(wol.mock.callCount(), 1);
  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.equal(cleared, 1);
  release();
  await stopping;
  assert.equal(stopped, true);
  clock = '2026-11-16T08:30:00Z';
  await callback();
  assert.equal(wol.mock.callCount(), 1);
  await scheduler.stop();
  assert.equal(cleared, 1);
});

test('une erreur de tick ne tue pas la boucle et les intervalles invalides sont rejetés', async () => {
  create();
  let fail = true;
  const scheduler = makeScheduler({
    store: {
      ...schedules,
      listSchedules: () => {
        if (fail) {
          fail = false;
          throw new Error('Erreur de base simulée');
        }
        return schedules.listSchedules();
      },
    },
  });
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(wol.mock.callCount(), 1);
  for (const intervalMs of [0, -1, 1.5, NaN])
    assert.throws(() => makeScheduler({ intervalMs }), /Intervalle/);
});

test('deux instances concurrentes réservent la même minute une seule fois', async () => {
  create();
  let release;
  wol.mock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const first = makeScheduler().tick();
  await makeScheduler().tick();
  assert.equal(wol.mock.callCount(), 1);
  release();
  await first;
  assert.equal(devices.getHistory(device.id).length, 1);
});

test('la réservation revérifie pause et activation après lecture de la liste', async () => {
  const schedule = create();
  const scheduler = makeScheduler({
    store: {
      ...schedules,
      listSchedules: () => {
        const snapshot = schedules.listSchedules();
        schedules.setPaused(true);
        return snapshot;
      },
    },
  });
  await scheduler.tick();
  assert.equal(wol.mock.callCount(), 0);
  schedules.setPaused(false);
  const otherScheduler = makeScheduler({
    store: {
      ...schedules,
      listSchedules: () => {
        const snapshot = schedules.listSchedules();
        schedules.updateSchedule(schedule.id, { enabled: false });
        return snapshot;
      },
    },
  });
  await otherScheduler.tick();
  assert.equal(wol.mock.callCount(), 0);
  assert.equal(schedules.findById(schedule.id).last_run_at, null);
});
