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

test('device network fields are created, listed, patched and cleared independently', async () => {
  const network = { ip: '192.168.1.42', broadcast: '192.168.1.255', probe_port: 3389 };
  const created = await authedPost('/api/devices').send({
    name: 'pc',
    mac: 'aa:bb:cc:dd:ee:01',
    description: 'Bureau',
    ...network,
  });
  assert.equal(created.status, 201);
  const id = created.body.device.id;
  const list = await request(app).get('/api/devices');
  for (const [key, value] of Object.entries(network)) {
    assert.equal(created.body.device[key], value);
    assert.equal(list.body[0][key], value);
  }
  const patch = (payload) =>
    request(app)
      .patch(`/api/devices/${id}`)
      .set('Origin', ORIGIN)
      .set('Host', '127.0.0.1')
      .send(payload);
  const updated = await patch({
    name: 'pc renomme',
    description: 'Salon',
    ip: '10.0.0.42',
    probe_port: 65535,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.device.name, 'pc renomme');
  assert.equal(updated.body.device.description, 'Salon');
  assert.equal(updated.body.device.ip, '10.0.0.42');
  assert.equal(updated.body.device.probe_port, 65535);
  assert.equal(updated.body.device.broadcast, network.broadcast);
  assert.equal(updated.body.device.mac, 'aa:bb:cc:dd:ee:01');
  const cleared = await patch({ ip: '', broadcast: null, probe_port: null });
  assert.equal(cleared.status, 200);
  for (const key of Object.keys(network)) assert.equal(cleared.body.device[key], null);
  assert.equal((await patch({ ip: null, broadcast: '' })).status, 200);
});

test('POST and PATCH strictly validate IPv4 and probe port without mutating on error', async () => {
  const created = await authedPost('/api/devices').send({
    name: 'pc',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '10.0.0.1',
  });
  const invalid = [];
  for (const field of ['ip', 'broadcast']) {
    for (const value of [
      '999.1.2.3',
      '::1',
      'nas.local',
      '1.2.3.4;id',
      '01.2.3.4',
      ' 1.2.3.4 ',
      123,
      [],
      {},
    ])
      invalid.push({ [field]: value });
  }
  for (const probe_port of [0, -1, 65536, 1.5, '22', '', true, [], {}])
    invalid.push({ probe_port });
  for (const fields of invalid) {
    const post = await authedPost('/api/devices').send({
      name: 'other',
      mac: 'aa:bb:cc:dd:ee:02',
      ...fields,
    });
    assert.equal(post.status, 400, JSON.stringify(fields));
    assert.match(post.body.message, /invalide/);
    const patch = await request(app)
      .patch(`/api/devices/${created.body.device.id}`)
      .set('Origin', ORIGIN)
      .set('Host', '127.0.0.1')
      .send({ name: 'modified', ...fields });
    assert.equal(patch.status, 400, JSON.stringify(fields));
  }
  const list = await request(app).get('/api/devices');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].name, 'pc');
  assert.equal(list.body[0].ip, '10.0.0.1');
});

test('PATCH keeps the write guard and validates IDs, names and descriptions', async () => {
  const created = await authedPost('/api/devices').send({ name: 'pc', mac: 'aa:bb:cc:dd:ee:01' });
  const url = `/api/devices/${created.body.device.id}`;
  assert.equal((await request(app).patch(url).send({ ip: '10.0.0.1' })).status, 403);
  assert.equal(
    (await request(app).patch(url).set('Origin', 'http://evil.example').send({ ip: '10.0.0.1' }))
      .status,
    403
  );
  for (const [target, payload, status] of [
    [url, { name: '<script>' }, 400],
    [url, { description: 'x'.repeat(201) }, 400],
    ['/api/devices/1abc', {}, 400],
    ['/api/devices/99999', {}, 404],
  ]) {
    const res = await request(app)
      .patch(target)
      .set('Origin', ORIGIN)
      .set('Host', '127.0.0.1')
      .send(payload);
    assert.equal(res.status, status);
  }
});
