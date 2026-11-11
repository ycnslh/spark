const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-events-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.AUTH_USER = 'admin';
process.env.AUTH_PASS = 'secret';
process.env.SSE_MAX_CLIENTS = '2';
const sender = require('../src/services/wolSender');
const pinger = require('../src/services/pinger');
const sendWake = mock.method(sender, 'sendWakeOnLan', async () => {});
const ping = mock.method(pinger, 'pollUntilUp', async () => true);
const { app } = require('../src/server');
const { closeDb } = require('../src/services/db');
const store = require('../src/services/deviceStore');
const eventBus = require('../src/services/eventBus');
const { StatusPoller } = require('../src/services/statusPoller');
const { createEventsRouter } = require('../src/routes/events');
const express = require('express');
const request = require('supertest');

after(() => {
  mock.restoreAll();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function listen(t, application) {
  const server = application.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      })
  );
  return server;
}

async function connect(t, server, url = '/api/events', auth = 'admin:secret') {
  const req = http.get({
    host: '127.0.0.1',
    port: server.address().port,
    path: url,
    auth,
  });
  t.after(() => req.destroy());
  const [res] = await once(req, 'response');
  const frames = [];
  const received = new EventEmitter();
  let buffer = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      frames.push(frame);
      received.emit('frame');
    }
  });
  return {
    req,
    res,
    async next() {
      if (!frames.length) {
        await once(received, 'frame', { signal: AbortSignal.timeout(2000) });
      }
      return frames.shift();
    },
  };
}

function parse(frame) {
  const [event, data] = frame.split('\n');
  return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
}

async function fixture(t, options = {}) {
  const poller = new StatusPoller();
  const bus = new EventEmitter();
  const router = createEventsRouter({ poller, bus, ...options });
  const application = express();
  application.use(router);
  const server = await listen(t, application);
  t.after(() => router.closeAll());
  return { poller, bus, router, server };
}

test('SSE sends initial snapshot, status after setStatus, remove and wake JSON', async (t) => {
  const { poller, bus, server } = await fixture(t);
  poller.setStatus(1, false);
  const stream = await connect(t, server);
  assert.equal(stream.res.statusCode, 200);
  assert.match(stream.res.headers['content-type'], /^text\/event-stream/);
  assert.equal(stream.res.headers['cache-control'], 'no-cache');
  assert.equal(stream.res.headers.connection, 'keep-alive');
  assert.equal(stream.res.headers['x-accel-buffering'], 'no');
  assert.deepEqual(parse(await stream.next()), {
    event: 'snapshot',
    data: [{ id: 1, online: false }],
  });
  poller.setStatus(1, true);
  assert.deepEqual(parse(await stream.next()), { event: 'status', data: { id: 1, online: true } });
  poller.emit('remove', { id: 1 });
  assert.deepEqual(parse(await stream.next()), { event: 'remove', data: { id: 1 } });
  const payload = { type: 'wake', deviceId: 1, state: 'sent' };
  bus.emit('wake', payload);
  assert.deepEqual(parse(await stream.next()), { event: 'wake', data: payload });
});

test('SSE heartbeat uses injectable interval and legacy route retains change events', async (t) => {
  const { server, poller } = await fixture(t, { heartbeatMs: 15 });
  const stream = await connect(t, server, '/api/status/stream');
  assert.equal(parse(await stream.next()).event, 'snapshot');
  poller.setStatus(2, false);
  assert.equal(parse(await stream.next()).event, 'change');
  assert.equal(await stream.next(), ': heartbeat');
});

test('SSE stays open past the HTTP idle timeout and clears its heartbeat on close', async (t) => {
  const { server, poller } = await fixture(t, { heartbeatMs: 50 });
  server.setTimeout(10);
  server.requestTimeout = 10;
  const clear = t.mock.method(global, 'clearInterval');
  const stream = await connect(t, server);
  await stream.next();
  assert.equal(await stream.next(), ': heartbeat');
  assert.equal(stream.res.complete, false);
  stream.req.destroy();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(poller.listenerCount('change'), 0);
});

test('SSE caps clients, releases slots and cleans all source listeners after disconnect', async (t) => {
  const { server, poller, bus } = await fixture(t, { maxClients: 2, heartbeatMs: 15 });
  const counts = () => [
    poller.listenerCount('change'),
    poller.listenerCount('remove'),
    bus.listenerCount('wake'),
  ];
  const baseline = counts();
  const first = await connect(t, server);
  await first.next();
  const second = await connect(t, server);
  await second.next();
  assert.deepEqual(
    counts(),
    baseline.map((n) => n + 1)
  );
  const excess = await request(server).get('/api/events');
  assert.equal(excess.status, 503);
  assert.match(excess.body.message, /Trop de connexions/);
  first.req.destroy();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(
    counts(),
    baseline.map((n) => n + 1)
  );
  const replacement = await connect(t, server);
  await replacement.next();
  second.req.destroy();
  replacement.req.destroy();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(counts(), baseline);
});

test('SSE closeAll ends active responses and removes listeners before HTTP shutdown', async (t) => {
  const { server, poller, bus, router } = await fixture(t, { heartbeatMs: 10 });
  const stream = await connect(t, server);
  await stream.next();
  const ended = once(stream.res, 'end');
  router.closeAll();
  await ended;
  assert.equal(poller.listenerCount('change'), 0);
  assert.equal(poller.listenerCount('remove'), 0);
  assert.equal(bus.listenerCount('wake'), 0);
  assert.equal((await request(server).get('/api/events')).status, 503);
});

test('SSE uses existing Basic auth and configured client limit', async (t) => {
  const server = await listen(t, app);
  const baseline = eventBus.listenerCount('wake');
  const unauthenticated = await request(server).get('/api/events?token=invalid');
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers['www-authenticate'], 'Basic realm="Spark"');
  assert.equal(eventBus.listenerCount('wake'), baseline);
  const first = await connect(t, server);
  await first.next();
  const second = await connect(t, server);
  await second.next();
  const excess = await request(server).get('/api/events').auth('admin', 'secret');
  assert.equal(excess.status, 503);
});

for (const up of [true, false]) {
  test(`wake SSE sends sent then ${up ? 'confirmed' : 'timeout'} with unchanged persistence`, async (t) => {
    let finishPing;
    ping.mock.mockImplementationOnce(() => new Promise((resolve) => (finishPing = resolve)));
    const device = store.createDevice({
      name: `PC-${up}`,
      mac: up ? 'aa:bb:cc:dd:ee:01' : 'aa:bb:cc:dd:ee:02',
      ip: '192.0.2.1',
    });
    const server = await listen(t, app);
    const stream = await connect(t, server);
    await stream.next();
    const response = await request(server)
      .post(`/api/wake/${device.mac}`)
      .auth('admin', 'secret')
      .set('Origin', 'http://spark.local')
      .set('Host', 'spark.local');
    assert.equal(response.status, 200);
    assert.deepEqual(parse(await stream.next()), {
      event: 'wake',
      data: { type: 'wake', deviceId: device.id, state: 'sent' },
    });
    assert.equal(store.getHistory(device.id)[0].ping_confirmed, null);
    finishPing(up);
    assert.deepEqual(parse(await stream.next()), {
      event: 'wake',
      data: { type: 'wake', deviceId: device.id, state: up ? 'confirmed' : 'timeout' },
    });
    const history = store.getHistory(device.id)[0];
    assert.equal(history.ping_confirmed, up ? 1 : 0);
    assert.equal(history.success, 1);
    assert.equal(!!history.confirmed_at, up);
    assert.equal(ping.mock.calls.at(-1).arguments[0], '192.0.2.1');
  });
}

test('wake SSE sends failed on simulated UDP error and preserves failure history', async (t) => {
  sendWake.mock.mockImplementationOnce(async () => {
    throw new Error('UDP indisponible');
  });
  const device = store.createDevice({ name: 'Échec', mac: 'aa:bb:cc:dd:ee:03' });
  const server = await listen(t, app);
  const stream = await connect(t, server);
  await stream.next();
  const response = await request(server)
    .post(`/api/wake/${device.mac}`)
    .auth('admin', 'secret')
    .set('Origin', 'http://spark.local')
    .set('Host', 'spark.local');
  assert.equal(response.status, 500);
  assert.deepEqual(parse(await stream.next()), {
    event: 'wake',
    data: { type: 'wake', deviceId: device.id, state: 'failed' },
  });
  assert.equal(store.getHistory(device.id)[0].success, 0);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`server closes live SSE and exits cleanly on ${signal}`, { timeout: 10_000 }, async (t) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const config = require('./src/config');
        config.port = 0;
        const server = require('./src/server').start();
        server.on('listening', () => process.send(server.address().port));`,
      ],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, DB_PATH: path.join(tmpDir, `${signal}.db`) },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    t.after(() => child.kill('SIGKILL'));
    const exited = once(child, 'exit');
    const [port] = await once(child, 'message');
    const stream = await connect(t, { address: () => ({ port }) });
    assert.equal(parse(await stream.next()).event, 'snapshot');
    const ended = once(stream.res, 'end');
    child.kill(signal);
    await ended;
    const [code, exitSignal] = await exited;
    assert.equal(code, 0, stderr);
    assert.equal(exitSignal, null, stderr);
  });
}
