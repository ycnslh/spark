const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-api-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = '';
process.env.AUTH_PASS = '';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app } = require('../src/server');
const { closeDb, getDb } = require('../src/services/db');

const ORIGIN = 'http://127.0.0.1';

function authedPost(url) {
  return request(app).post(url).set('Origin', ORIGIN).set('Host', '127.0.0.1');
}
function authedDelete(url) {
  return request(app).delete(url).set('Origin', ORIGIN).set('Host', '127.0.0.1');
}

beforeEach(() => {
  getDb().exec('DELETE FROM wake_history; DELETE FROM devices;');
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /health returns ok', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('GET /api/devices returns empty array initially', async () => {
  const res = await request(app).get('/api/devices');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('POST /api/devices validates MAC format', async () => {
  const res = await authedPost('/api/devices').send({ name: 'desk', mac: 'invalid-mac' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('POST /api/devices validates name format', async () => {
  const res = await authedPost('/api/devices').send({
    name: '<script>',
    mac: 'aa:bb:cc:dd:ee:ff',
  });
  assert.equal(res.status, 400);
});

test('POST /api/devices creates a device and rejects duplicates', async () => {
  const create = await authedPost('/api/devices').send({ name: 'desk', mac: 'aa:bb:cc:dd:ee:ff' });
  assert.equal(create.status, 201);
  assert.equal(create.body.success, true);

  const dup = await authedPost('/api/devices').send({
    name: 'other',
    mac: 'AA-BB-CC-DD-EE-FF',
  });
  assert.equal(dup.status, 409);
});

test('POST /api/devices rejects request without Origin (CSRF guard)', async () => {
  const res = await request(app)
    .post('/api/devices')
    .send({ name: 'desk', mac: 'aa:bb:cc:dd:ee:ff' });
  assert.equal(res.status, 403);
});

test('POST /api/devices rejects cross-origin request', async () => {
  const res = await request(app)
    .post('/api/devices')
    .set('Origin', 'http://evil.example')
    .send({ name: 'desk', mac: 'aa:bb:cc:dd:ee:ff' });
  assert.equal(res.status, 403);
});

test('GET /wake/:unknown returns 404 with escaped HTML', async () => {
  const res = await request(app).get('/wake/<img>').set('Origin', ORIGIN).set('Host', '127.0.0.1');
  assert.equal(res.status, 404);
  assert.match(res.text, /&lt;img&gt;/);
  assert.doesNotMatch(res.text, /<img>/);
});

test('GET /wake/:id allows Apple Shortcuts user-agent without Origin', async () => {
  const res = await request(app).get('/wake/<img>').set('User-Agent', 'Shortcuts/1234');
  assert.equal(res.status, 404);
});

test('DELETE /api/devices/:mac removes the device', async () => {
  await authedPost('/api/devices').send({ name: 'desk', mac: 'aa:bb:cc:dd:ee:ff' });
  const del = await authedDelete('/api/devices/aa:bb:cc:dd:ee:ff');
  assert.equal(del.status, 200);
  const list = await request(app).get('/api/devices');
  assert.deepEqual(list.body, []);
});
