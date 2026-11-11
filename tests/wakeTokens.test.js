const { test, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-tokens-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = 'admin';
process.env.AUTH_PASS = 'secret';
const sender = require('../src/services/wolSender');
const wake = mock.method(sender, 'sendWakeOnLan', async () => {});
const { app } = require('../src/server');
const { getDb, closeDb } = require('../src/services/db');
const store = require('../src/services/deviceStore');
const tokenStore = require('../src/services/tokenStore');
const request = require('supertest');
const admin = (req) =>
  req.auth('admin', 'secret').set('Origin', 'http://spark.local').set('Host', 'spark.local');
let device;
let other;
beforeEach(() => {
  getDb().exec('DELETE FROM devices');
  device = store.createDevice({ name: 'PC bureau', mac: 'aa:bb:cc:dd:ee:01' });
  other = store.createDevice({ name: 'NAS', mac: 'aa:bb:cc:dd:ee:02' });
  wake.mock.resetCalls();
});
after(() => {
  closeDb();
  mock.restoreAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
const create = (label) =>
  admin(request(app).post(`/api/devices/${device.id}/tokens`)).send(
    label === undefined ? {} : { label }
  );
const use = (token, identifier = device.name) =>
  request(app)
    .get(`/wake/${encodeURIComponent(identifier)}`)
    .query({ token });

test('creation returns a random token once, stores only SHA256 and lists metadata', async () => {
  const res = await create('<img src=x onerror=alert(1)>');
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(res.body).sort(), ['id', 'token', 'url']);
  assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
  const row = getDb().prepare('SELECT * FROM wake_tokens WHERE id = ?').get(res.body.id);
  assert.equal(row.token_hash, crypto.createHash('sha256').update(res.body.token).digest('hex'));
  assert.equal(JSON.stringify(row).includes(res.body.token), false);
  getDb().pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(fs.readFileSync(process.env.DB_PATH).includes(Buffer.from(res.body.token)), false);
  const second = await create();
  assert.notEqual(second.body.token, res.body.token);
  const list = await admin(request(app).get(`/api/devices/${device.id}/tokens`));
  assert.equal(list.status, 200);
  for (const item of list.body)
    assert.deepEqual(Object.keys(item).sort(), [
      'created_at',
      'id',
      'label',
      'last_used_at',
      'revoked_at',
    ]);
  assert.equal(list.body[1].label, '<img src=x onerror=alert(1)>');
  const url = new URL(res.body.url);
  assert.equal(url.origin, 'http://spark.local');
  assert.equal(url.searchParams.get('token'), res.body.token);
  assert.equal((await request(app).get(url.pathname + url.search)).status, 200);
  assert.match(res.headers['cache-control'], /no-store/);
});

test('valid token bypasses Basic and origin only for the matching device, records identity and usage', async () => {
  const { body } = await create('iPhone');
  for (const identifier of [device.name.toLowerCase(), device.mac, device.id]) {
    const res = await use(body.token, identifier).set('Origin', 'https://foreign.example');
    assert.equal(res.status, 200);
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['cache-control'], /no-store/);
    assert.equal(res.text.includes(body.token), false);
  }
  assert.equal(wake.mock.callCount(), 3);
  assert.equal(store.getHistory(device.id)[0].triggered_by, 'token:iPhone');
  assert.ok(tokenStore.listTokens(device.id)[0].last_used_at);
  const unlabeled = await create();
  assert.equal((await use(unlabeled.body.token)).status, 200);
  assert.equal(store.getHistory(device.id)[0].triggered_by, `token:${unlabeled.body.id}`);
});

test('invalid, empty, repeated, revoked and wrong-device tokens have identical generic 401', async () => {
  const { body } = await create('iPhone');
  const mismatch = await use(body.token, other.name);
  const unknown = await use(body.token, 'absent');
  const invalid = await use('x'.repeat(43));
  const empty = await use('');
  const repeated = await use([body.token, body.token]);
  const revoked = await admin(request(app).delete(`/api/devices/${device.id}/tokens/${body.id}`));
  assert.equal(revoked.status, 200);
  const afterRevoke = await use(body.token);
  for (const res of [mismatch, unknown, invalid, empty, repeated, afterRevoke]) {
    assert.equal(res.status, 401);
    assert.equal(res.text, 'Authentification requise');
    assert.equal(res.headers['www-authenticate'], 'Basic realm="Spark"');
  }
  assert.equal(wake.mock.callCount(), 0);
  assert.equal(tokenStore.listTokens(device.id)[0].last_used_at, null);
  assert.ok(tokenStore.listTokens(device.id)[0].revoked_at);
});

test('absent token still requires Basic and origin, including Shortcuts UA', async () => {
  assert.equal((await request(app).get('/wake/NAS')).status, 401);
  assert.equal(
    (await request(app).get('/wake/NAS').auth('admin', 'secret').set('User-Agent', 'Shortcuts/1'))
      .status,
    403
  );
  assert.equal((await admin(request(app).get('/wake/NAS'))).status, 200);
});

test('token cannot access any other protected route or method; health stays public', async () => {
  const { body } = await create();
  for (const [method, url] of [
    ['get', '/api/devices'],
    ['get', `/api/devices/${device.id}/tokens`],
    ['post', `/api/devices/${device.id}/tokens`],
    ['post', `/api/wake/${device.mac}`],
    ['get', `/api/wake/${device.mac}`],
    ['head', `/wake/${device.name}`],
    ['post', `/wake/${device.name}`],
    ['get', `/wake/${device.name}/extra`],
    ['get', '/'],
  ]) {
    const res = await request(app)[method](url).query({ token: body.token });
    assert.equal(res.status, 401, `${method} ${url}`);
  }
  assert.equal((await request(app).get('/health').query({ token: body.token })).status, 200);
  assert.equal(wake.mock.callCount(), 0);
});

test('token management requires Basic and write guards, validates label and ownership', async () => {
  const url = `/api/devices/${device.id}/tokens`;
  assert.equal((await request(app).post(url).send({})).status, 401);
  assert.equal((await request(app).get(url)).status, 401);
  assert.equal((await request(app).post(url).auth('admin', 'secret').send({})).status, 403);
  assert.equal(
    (
      await request(app)
        .post(url)
        .auth('admin', 'secret')
        .set('Origin', 'https://foreign.example')
        .send({})
    ).status,
    403
  );
  for (const label of [null, 1, [], {}, 'a'.repeat(61)])
    assert.equal((await create(label)).status, 400);
  assert.equal((await create('a'.repeat(60))).status, 201);
  const { body } = await create();
  assert.equal(
    (await request(app).delete(`${url}/${body.id}`).auth('admin', 'secret')).status,
    403
  );
  assert.equal(
    (await admin(request(app).delete(`/api/devices/${other.id}/tokens/${body.id}`))).status,
    404
  );
  assert.equal((await admin(request(app).delete(`${url}/oops`))).status, 400);
  assert.equal((await admin(request(app).get('/api/devices/99999/tokens'))).status, 404);
  assert.equal((await admin(request(app).post('/api/devices/oops/tokens')).send({})).status, 400);
});

test('deleting the device cascades tokens and rejects its former URL', async () => {
  const { body } = await create();
  assert.equal(getDb().pragma('foreign_keys', { simple: true }), 1);
  assert.equal((await admin(request(app).delete(`/api/devices/${device.mac}`))).status, 200);
  assert.equal(getDb().prepare('SELECT count(*) n FROM wake_tokens').get().n, 0);
  assert.equal((await use(body.token)).status, 401);
  assert.equal(wake.mock.callCount(), 0);
});

test('failed wake records token identity without leaking its secret', async () => {
  const { body } = await create('Siri');
  wake.mock.mockImplementationOnce(async () => {
    throw new Error('UDP indisponible');
  });
  assert.equal((await use(body.token)).status, 500);
  assert.equal(store.getHistory(device.id)[0].triggered_by, 'token:Siri');
  assert.equal(store.getHistory(device.id)[0].success, 0);
});
