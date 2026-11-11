const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-token-limit-'));
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_DISABLED = '0';
process.env.AUTH_USER = 'admin';
process.env.AUTH_PASS = 'secret';
process.env.AUTH_RATE_LIMIT = '3';
process.env.WAKE_RATE_LIMIT = '2';
process.env.TRUST_PROXY = 'loopback';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
const wake = mock.method(require('../src/services/wolSender'), 'sendWakeOnLan', async () => {});
const { app } = require('../src/server');
const { closeDb } = require('../src/services/db');
const store = require('../src/services/deviceStore');
const tokens = require('../src/services/tokenStore');
const request = require('supertest');
after(() => {
  closeDb();
  mock.restoreAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('token failures share the Basic auth failure limiter; valid tokens use the wake limiter', async () => {
  const device = store.createDevice({ name: 'pc', mac: 'aa:bb:cc:dd:ee:01' });
  const other = store.createDevice({ name: 'nas', mac: 'aa:bb:cc:dd:ee:02' });
  const active = tokens.createToken(device.id);
  const revoked = tokens.createToken(device.id);
  tokens.revokeToken(device.id, revoked.id);
  const get = (url, ip) => request(app).get(url).set('X-Forwarded-For', ip);
  const ip = '198.51.100.1';
  for (const url of [
    `/wake/pc?token=invalid`,
    `/wake/pc?token=${revoked.token}`,
    `/wake/${other.name}?token=${active.token}`,
  ]) {
    assert.equal((await get(url, ip)).status, 401);
  }
  assert.equal((await get(`/wake/pc?token=${active.token}`, ip)).status, 429);
  assert.equal((await get('/api/devices', ip)).status, 429);
  const wakeIp = '198.51.100.2';
  for (let i = 0; i < 2; i++)
    assert.equal((await get(`/wake/pc?token=${active.token}`, wakeIp)).status, 200);
  const limited = await get(`/wake/pc?token=${active.token}`, wakeIp);
  assert.equal(limited.status, 429);
  assert.match(limited.body.message, /Trop de requêtes/);
  assert.equal(wake.mock.callCount(), 2);
  // Le limiteur des écritures administratives reste lui aussi actif.
  const write = () =>
    request(app)
      .post(`/api/devices/${device.id}/tokens`)
      .auth('admin', 'secret')
      .set('X-Forwarded-For', '198.51.100.3')
      .set('Host', 'spark.local')
      .set('Origin', 'http://spark.local')
      .send({});
  for (let i = 0; i < 30; i++) assert.equal((await write()).status, 201);
  assert.equal((await write()).status, 429);
});
