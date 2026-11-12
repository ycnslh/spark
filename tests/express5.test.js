const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-express5-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = 'admin';
process.env.AUTH_PASS = 'secret';
const { app } = require('../src/server');
const store = require('../src/services/deviceStore');
const tokens = require('../src/services/tokenStore');
const { closeDb } = require('../src/services/db');

after(() => {
  mock.restoreAll();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Express 5 named wildcards include the root only with braces', async () => {
  const routes = express();
  routes.get('/assets/*file', (req, res) => res.json(req.params.file));
  routes.get('/{*rest}', (req, res) => res.status(404).json(req.params.rest || []));
  assert.deepEqual((await request(routes).get('/assets/js/app.js')).body, ['js', 'app.js']);
  const root = await request(routes).get('/');
  assert.equal(root.status, 404);
  assert.deepEqual(root.body, []);
  assert.deepEqual((await request(routes).get('/missing/nested')).body, ['missing', 'nested']);
});

test('wake token auth accepts the getter query object and rejects ambiguous keys', async () => {
  const device = store.createDevice({ name: 'query', mac: '02:00:00:00:00:01' });
  const token = tokens.createToken(device.id);
  // Pas de réveil réel : les formes ambiguës doivent être refusées avant la route WoL.
  for (const query of [
    `token=${token.token}&token=${token.token}`,
    `token[secret]=${token.token}`,
    `__proto__[token]=${token.token}`,
    `hasOwnProperty=x&token=invalid`,
  ]) {
    const result = await request(app).get(`/wake/query?${query}`);
    assert.equal(result.status, 401, query);
    assert.equal(result.text, 'Authentification requise');
  }
  // L'absence de body parsé reste une erreur de validation, jamais un TypeError.
  const empty = await request(app)
    .post('/api/devices')
    .auth('admin', 'secret')
    .set('Host', 'spark.local')
    .set('Origin', 'http://spark.local');
  assert.equal(empty.status, 400);
  assert.match(empty.body.message, /requis/);
});

test('both schedule mount paths retain their write guard and route parameters', async () => {
  const device = store.createDevice({ name: 'schedule', mac: '02:00:00:00:00:02' });
  for (const [method, url, body] of [
    ['post', `/api/devices/${device.id}/schedules`, { time: '08:00', days: [1] }],
    ['put', '/api/schedules/state', { paused: true }],
  ]) {
    const unguarded = await request(app)[method](url).auth('admin', 'secret').send(body);
    assert.equal(unguarded.status, 403);
    const guardedRequest = request(app)[method](url);
    const guarded = await guardedRequest
      .auth('admin', 'secret')
      .set('Host', 'spark.local')
      .set('Origin', 'http://spark.local')
      .send(body);
    assert.equal(guarded.status, method === 'post' ? 201 : 200);
    if (method === 'post') assert.equal(guarded.body.schedule.device_id, device.id);
  }
});

test('async status rejection reaches the real final error handler', async (t) => {
  const failure = mock.method(store, 'listDevices', () => {
    throw new Error('internal database failure');
  });
  t.after(() => failure.mock.restore());
  const result = await request(app)
    .get('/api/status')
    .auth('admin', 'secret')
    .timeout({ response: 2000 });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { success: false, message: 'Erreur interne' });
});

test('unknown routes fall through to 404 without bypassing authentication or static guards', async () => {
  assert.equal((await request(app).get('/missing/deep/path')).status, 401);
  for (const url of ['/missing/deep/path', '/api/missing', '/.env', '/wake/query/extra']) {
    const result = await request(app).get(url).auth('admin', 'secret');
    assert.equal(result.status, 404, url);
    assert.match(result.text, /Cannot GET/);
  }
  assert.equal((await request(app).get('/').auth('admin', 'secret')).status, 200);
  const worker = await request(app).get('/sw.js').auth('admin', 'secret');
  assert.equal(worker.status, 200);
  assert.equal(worker.headers['cache-control'], 'no-cache');
  assert.match(worker.headers['content-type'], /javascript/);
});
