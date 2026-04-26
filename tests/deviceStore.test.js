const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const store = require('../src/services/deviceStore');
const { closeDb, getDb } = require('../src/services/db');

beforeEach(() => {
  getDb().exec('DELETE FROM wake_history; DELETE FROM devices;');
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createDevice persists and returns device with id', () => {
  const device = store.createDevice({ name: 'desk', mac: 'aa:bb:cc:dd:ee:ff' });
  assert.ok(device.id);
  assert.equal(device.name, 'desk');
  assert.equal(device.mac, 'aa:bb:cc:dd:ee:ff');
});

test('listDevices returns all devices alphabetically', () => {
  store.createDevice({ name: 'zebra', mac: '11:11:11:11:11:11' });
  store.createDevice({ name: 'alpha', mac: '22:22:22:22:22:22' });
  const list = store.listDevices();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'alpha');
});

test('macExists detects duplicates regardless of separators', () => {
  store.createDevice({ name: 'pc', mac: 'aa:bb:cc:dd:ee:ff' });
  assert.equal(store.macExists('AA-BB-CC-DD-EE-FF'), true);
  assert.equal(store.macExists('aabbccddeeff'), true);
  assert.equal(store.macExists('11:11:11:11:11:11'), false);
});

test('deleteByMac removes a device and returns true', () => {
  store.createDevice({ name: 'pc', mac: 'aa:bb:cc:dd:ee:ff' });
  assert.equal(store.deleteByMac('aa:bb:cc:dd:ee:ff'), true);
  assert.equal(store.listDevices().length, 0);
});

test('recordWake then getHistory returns the entry', () => {
  const d = store.createDevice({ name: 'pc', mac: 'aa:bb:cc:dd:ee:ff' });
  store.recordWake({ deviceId: d.id, triggeredBy: 'tester', success: true });
  const history = store.getHistory(d.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].success, 1);
  assert.equal(history[0].triggered_by, 'tester');
});
