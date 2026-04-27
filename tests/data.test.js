const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-data-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = '';
process.env.AUTH_PASS = '';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app } = require('../src/server');
const { closeDb, getDb } = require('../src/services/db');
const store = require('../src/services/deviceStore');

const ORIGIN = 'http://127.0.0.1';
const auth = (req) => req.set('Origin', ORIGIN).set('Host', '127.0.0.1');

beforeEach(() => {
  getDb().exec(
    'DELETE FROM device_tags; DELETE FROM tags; DELETE FROM wake_history; DELETE FROM devices;'
  );
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /api/export returns versioned payload', async () => {
  store.createDevice({ name: 'pc', mac: 'aa:bb:cc:dd:ee:ff', host: '192.168.1.10' });
  const res = await request(app).get('/api/export');
  assert.equal(res.status, 200);
  assert.equal(res.body.version, 1);
  assert.equal(res.body.devices.length, 1);
  assert.equal(res.body.devices[0].host, '192.168.1.10');
});

test('POST /api/import re-creates devices and tags', async () => {
  const payload = {
    version: 1,
    tags: [{ name: 'office', color: '#4d6fff' }],
    devices: [{ name: 'pc', mac: 'aa:bb:cc:dd:ee:ff', host: '10.0.0.1', tags: ['office'] }],
  };
  const res = await auth(request(app).post('/api/import')).send(payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.stats.devices, 1);
  assert.equal(res.body.stats.tags, 1);

  const devices = await request(app).get('/api/devices');
  assert.equal(devices.body.length, 1);
  assert.equal(devices.body[0].tags[0].name, 'office');
});

test('POST /api/import skips invalid entries', async () => {
  const payload = {
    version: 1,
    tags: [],
    devices: [
      { name: 'good', mac: 'aa:bb:cc:dd:ee:ff' },
      { name: 'bad', mac: 'not-a-mac' },
      { name: 'evil', mac: 'aa:bb:cc:dd:ee:01', host: '127.0.0.1; rm -rf /' },
    ],
  };
  const res = await auth(request(app).post('/api/import')).send(payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.stats.devices, 1);
  assert.equal(res.body.stats.skipped, 2);
});

test('POST /api/import rejects unknown version', async () => {
  const res = await auth(request(app).post('/api/import')).send({ version: 99 });
  assert.equal(res.status, 400);
});
