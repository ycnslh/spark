const { test, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-schedules-api-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = 'admin';
process.env.AUTH_PASS = 'secret';
const sender = require('../src/services/wolSender');
const wol = mock.method(sender, 'sendWakeOnLan', async () => {});
require('../src/config').dataDir = tmpDir;
const { app } = require('../src/server');
const { getDb, closeDb } = require('../src/services/db');
const devices = require('../src/services/deviceStore');
const schedules = require('../src/services/scheduleStore');
const { validateSchedule } = require('../src/routes/schedules');
const admin = (req) =>
  req.auth('admin', 'secret').set('Origin', 'http://spark.local').set('Host', 'spark.local');
let device;
const payload = { time: '08:30', days: [5, 1, 3], label: 'Bureau' };
const create = (body = payload, id = device.id) =>
  admin(request(app).post(`/api/devices/${id}/schedules`)).send(body);

beforeEach(() => {
  getDb().exec('DELETE FROM devices');
  schedules.setPaused(false);
  device = devices.createDevice({ name: 'Bureau', mac: 'aa:bb:cc:dd:ee:01' });
});
after(() => {
  assert.equal(wol.mock.callCount(), 0, 'Le CRUD ne doit jamais envoyer de paquet WoL');
  closeDb();
  mock.restoreAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validation stricte des heures, jours, libellés, booléens et champs', () => {
  for (const time of ['00:00', '23:59', '09:05'])
    assert.equal(validateSchedule({ ...payload, time }), null);
  for (const time of [
    '24:00',
    '12:60',
    '8:30',
    '08:3',
    '08:30:00',
    '08:30\n',
    ' 08:30',
    null,
    830,
  ]) {
    assert.match(validateSchedule({ ...payload, time }), /Heure invalide/);
  }
  for (const days of [[], [0, 0], [7], [-1], [1.5], ['1'], '1,2', null, [true]]) {
    assert.match(validateSchedule({ ...payload, days }), /Jours invalides/);
  }
  for (const body of [null, [], {}, { ...payload, extra: 1 }, { days: [1] }, { time: '08:30' }]) {
    assert.ok(validateSchedule(body));
  }
  for (const label of [null, 1, [], {}, 'é'.repeat(61)])
    assert.match(validateSchedule({ ...payload, label }), /Libellé invalide/);
  assert.equal(validateSchedule({ ...payload, label: '😀'.repeat(60) }), null);
  for (const enabled of [0, 1, 'false', null])
    assert.match(validateSchedule({ ...payload, enabled }), /booléen/);
  assert.equal(validateSchedule({ enabled: false }, true), null);
  assert.ok(validateSchedule({}, true));
});

test('CRUD API : valeurs par défaut, stockage normalisé, modification et suppression', async () => {
  const created = await create();
  assert.equal(created.status, 201);
  const { schedule } = created.body;
  assert.equal(schedule.enabled, true);
  assert.deepEqual(schedule.days, [1, 3, 5]);
  assert.equal(schedule.last_run_at, null);
  assert.equal(
    getDb().prepare('SELECT days FROM schedules WHERE id = ?').get(schedule.id).days,
    '1,3,5'
  );
  const list = await admin(request(app).get('/api/schedules'));
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].device_name, 'Bureau');
  const patch = await admin(request(app).patch(`/api/schedules/${schedule.id}`)).send({
    time: '23:59',
    days: [0, 6],
    label: '<img src=x>',
    enabled: false,
  });
  assert.equal(patch.status, 200);
  assert.deepEqual(patch.body.schedule, {
    ...schedule,
    time: '23:59',
    days: [0, 6],
    label: '<img src=x>',
    enabled: false,
  });
  closeDb();
  assert.equal(schedules.findById(schedule.id).enabled, false);
  assert.equal((await admin(request(app).delete(`/api/schedules/${schedule.id}`))).status, 200);
  assert.equal((await admin(request(app).get('/api/schedules'))).body.length, 0);
  assert.equal((await admin(request(app).delete(`/api/schedules/${schedule.id}`))).status, 404);
  assert.equal(
    (await admin(request(app).patch(`/api/schedules/${schedule.id}`)).send({ enabled: true }))
      .status,
    404
  );
  assert.equal(
    (await create({ time: '00:00', days: [0], enabled: false })).body.schedule.label,
    null
  );
});

test('API : validation des payloads et identifiants, plafond de 20 par appareil', async () => {
  const created = await create();
  for (const patch of [
    {},
    { enabled: 1 },
    { days: [1, 1] },
    { time: '25:00' },
    { label: null },
    { device_id: 1 },
  ]) {
    assert.equal(
      (await admin(request(app).patch(`/api/schedules/${created.body.schedule.id}`)).send(patch))
        .status,
      400
    );
  }
  for (const body of [
    { time: '24:00', days: [1] },
    { time: '10:00', days: [] },
    { ...payload, enabled: 'true' },
  ]) {
    const response = await create(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /invalide/);
  }
  for (const id of ['oops', '1.5', '0', '-1', '9007199254740992', '1x']) {
    assert.equal((await create(payload, id)).status, 400);
    assert.equal(
      (await admin(request(app).patch(`/api/schedules/${id}`)).send({ enabled: false })).status,
      400
    );
    assert.equal((await admin(request(app).delete(`/api/schedules/${id}`))).status, 400);
  }
  assert.equal((await create(payload, 999999)).status, 404);
  for (let i = 1; i < schedules.MAX_PER_DEVICE; i++) assert.equal((await create()).status, 201);
  assert.equal((await create()).status, 409);
  assert.equal(schedules.listSchedules().length, 20);
  const other = devices.createDevice({ name: 'NAS', mac: 'aa:bb:cc:dd:ee:02' });
  assert.equal((await create(payload, other.id)).status, 201);
});

test('pause globale persistante et suppression en cascade avec l’appareil', async () => {
  const { body } = await create();
  assert.deepEqual((await admin(request(app).get('/api/schedules/state'))).body, { paused: false });
  assert.deepEqual(
    (await admin(request(app).put('/api/schedules/state')).send({ paused: true })).body,
    { paused: true }
  );
  closeDb();
  assert.deepEqual(schedules.getState(), { paused: true });
  for (const value of [
    {},
    { paused: 1 },
    { paused: 'false' },
    { paused: null },
    { paused: true, extra: 1 },
    [],
  ]) {
    assert.equal((await admin(request(app).put('/api/schedules/state')).send(value)).status, 400);
  }
  assert.equal(
    (await admin(request(app).put('/api/schedules/state')).send({ paused: false })).status,
    200
  );
  assert.equal((await admin(request(app).delete(`/api/devices/${device.mac}`))).status, 200);
  assert.equal(schedules.findById(body.schedule.id), undefined);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM schedules').get().n, 0);
});

test('toutes les API exigent Basic ; toutes les écritures gardent la protection d’origine', async () => {
  const { schedule } = (await create()).body;
  for (const [method, url, body] of [
    ['get', '/api/schedules'],
    ['get', '/api/schedules/state'],
    ['post', `/api/devices/${device.id}/schedules`, payload],
    ['patch', `/api/schedules/${schedule.id}`, { enabled: false }],
    ['delete', `/api/schedules/${schedule.id}`],
    ['put', '/api/schedules/state', { paused: true }],
  ]) {
    assert.equal((await request(app)[method](url).send(body)).status, 401, `${method} ${url}`);
    if (method === 'get') continue;
    assert.equal((await request(app)[method](url).auth('admin', 'secret').send(body)).status, 403);
    const foreignRequest = request(app)[method](url);
    const foreign = await foreignRequest
      .auth('admin', 'secret')
      .set('Origin', 'https://foreign.example')
      .send(body);
    assert.equal(foreign.status, 403);
  }
});
