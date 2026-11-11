const { test, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-network-routes-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = '';
process.env.AUTH_PASS = '';
process.env.NODE_ENV = 'test';

// Remplacer les services avant de charger les routes : aucun WoL ni ping réel.
const pinger = require('../src/services/pinger');
const wolSender = require('../src/services/wolSender');
const wake = mock.method(wolSender, 'sendWakeOnLan', async () => {});
const poll = mock.method(pinger, 'pollUntilUp', async () => true);
const probe = mock.method(pinger, 'isHostUp', async () => true);
const { app } = require('../src/server');
const { StatusPoller } = require('../src/services/statusPoller');
const { closeDb, getDb } = require('../src/services/db');
const store = require('../src/services/deviceStore');
const request = require('supertest');
const auth = (req) => req.set('Origin', 'http://127.0.0.1').set('Host', '127.0.0.1');

beforeEach(() => {
  getDb().exec('DELETE FROM wake_history; DELETE FROM devices;');
  wake.mock.resetCalls();
  poll.mock.resetCalls();
  probe.mock.resetCalls();
});
after(() => {
  closeDb();
  mock.restoreAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('both wake routes forward the device broadcast and probe port', async () => {
  const device = store.createDevice({
    name: 'pc',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '10.0.0.42',
    broadcast: '10.0.0.255',
    probe_port: 3389,
  });
  assert.equal((await auth(request(app).post(`/api/wake/${device.mac}`))).status, 200);
  assert.equal((await auth(request(app).get('/wake/pc'))).status, 200);
  assert.equal(wake.mock.callCount(), 2);
  for (const call of wake.mock.calls)
    assert.deepEqual(call.arguments, [device.mac, { broadcasts: ['10.0.0.255'] }]);
  for (const call of poll.mock.calls) {
    assert.equal(call.arguments[0], device.ip);
    assert.equal(call.arguments[1].probePort, 3389);
  }
  assert.equal(store.getHistory(device.id).length, 2);
});

test('a device without broadcast keeps global WoL defaults', async () => {
  const device = store.createDevice({ name: 'pc', mac: 'aa:bb:cc:dd:ee:02' });
  assert.equal((await auth(request(app).post(`/api/wake/${device.mac}`))).status, 200);
  assert.deepEqual(wake.mock.calls[0].arguments, [device.mac, undefined]);
  assert.equal(poll.mock.callCount(), 0);
});

test('status routes and status poller forward explicit IP and probe port', async () => {
  const device = store.createDevice({
    name: 'pc',
    mac: 'aa:bb:cc:dd:ee:03',
    ip: '10.0.0.42',
    host: 'old.local',
    probe_port: 12345,
  });
  const status = await request(app).get('/api/status');
  assert.deepEqual(status.body, [{ id: device.id, online: true }]);
  assert.equal(
    (await auth(request(app).post(`/api/status/${device.id}/refresh`))).body.online,
    true
  );
  const poller = new StatusPoller({ timeoutMs: 50 });
  await poller.runOnce();
  assert.deepEqual(poller.getSnapshot(), [{ id: device.id, online: true }]);
  assert.equal(probe.mock.callCount(), 3);
  for (const call of probe.mock.calls) {
    assert.equal(call.arguments[0], device.ip);
    assert.equal(call.arguments[1].probePort, device.probe_port);
  }
});

test('status cache is invalidated when IP or probe port changes', async () => {
  const device = store.createDevice({
    name: 'pc',
    mac: 'aa:bb:cc:dd:ee:04',
    ip: '10.0.0.1',
    probe_port: 22,
  });
  await request(app).get('/api/status');
  await request(app).get('/api/status');
  assert.equal(probe.mock.callCount(), 1);
  store.updateDevice(device.id, { probe_port: 80 });
  await request(app).get('/api/status');
  assert.equal(probe.mock.callCount(), 2);
  store.updateDevice(device.id, { ip: '10.0.0.2' });
  await request(app).get('/api/status');
  assert.equal(probe.mock.callCount(), 3);
  assert.deepEqual(probe.mock.calls[2].arguments, ['10.0.0.2', { timeoutMs: 800, probePort: 80 }]);
});
