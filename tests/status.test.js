const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-status-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = '';
process.env.AUTH_PASS = '';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app } = require('../src/server');
const { closeDb, getDb } = require('../src/services/db');
const store = require('../src/services/deviceStore');

beforeEach(() => {
  getDb().exec('DELETE FROM wake_history; DELETE FROM devices;');
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /api/status returns null online for devices without host', async () => {
  store.createDevice({ name: 'no-host', mac: 'aa:bb:cc:dd:ee:01' });
  const res = await request(app).get('/api/status');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.map((r) => ({ online: r.online })),
    [{ online: null }]
  );
});

test('GET /api/status returns boolean for devices with host', async () => {
  store.createDevice({
    name: 'unreachable',
    mac: 'aa:bb:cc:dd:ee:02',
    host: '203.0.113.42', // TEST-NET-3, RFC 5737, never routable
  });
  const res = await request(app).get('/api/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(typeof res.body[0].online, 'boolean');
});

test('POST /api/status/:id/refresh returns 404 for unknown device', async () => {
  const res = await request(app)
    .post('/api/status/9999/refresh')
    .set('Origin', 'http://127.0.0.1')
    .set('Host', '127.0.0.1');
  assert.equal(res.status, 404);
});

test('POST /api/status/:id/refresh returns null online for hostless device', async () => {
  const d = store.createDevice({ name: 'no-host', mac: 'aa:bb:cc:dd:ee:03' });
  const res = await request(app)
    .post(`/api/status/${d.id}/refresh`)
    .set('Origin', 'http://127.0.0.1')
    .set('Host', '127.0.0.1');
  assert.equal(res.status, 200);
  assert.equal(res.body.online, null);
});
