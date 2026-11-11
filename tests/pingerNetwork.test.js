const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const childProcess = require('node:child_process');
const { once, EventEmitter } = require('node:events');

function loadPinger(t, icmpSuccess = false) {
  t.mock.method(childProcess, 'execFile', (_file, _args, _options, callback) => {
    queueMicrotask(() => callback(icmpSuccess ? null : new Error('ICMP indisponible')));
  });
  delete require.cache[require.resolve('../src/services/pinger')];
  return require('../src/services/pinger');
}

test('isHostUp and pollUntilUp use only the configured TCP port on a local ephemeral server', async (t) => {
  const pinger = loadPinger(t);
  const server = net.createServer((socket) => socket.end());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const connectedPorts = [];
  const connect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    connectedPorts.push(args[0]);
    return connect.apply(this, args);
  });
  assert.equal(await pinger.isHostUp('127.0.0.1', { probePort: port, timeoutMs: 500 }), true);
  assert.equal(
    await pinger.pollUntilUp('127.0.0.1', { probePort: port, totalMs: 1000, intervalMs: 10 }),
    true
  );
  assert.deepEqual(connectedPorts, [port, port]);
});

function fakeSockets(t, successPort) {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      sockets.push(this);
    }
    setTimeout(timeoutMs) {
      this.timer = setTimeout(() => this.emit('timeout'), timeoutMs);
    }
    connect(port, host) {
      this.port = port;
      this.host = host;
      if (port === successPort) queueMicrotask(() => this.emit('connect'));
    }
    destroy() {
      clearTimeout(this.timer);
      this.destroyed = true;
    }
  }
  t.mock.method(net, 'Socket', function () {
    return new FakeSocket();
  });
  t.after(() => sockets.forEach((socket) => socket.destroy()));
  return sockets;
}

test('default TCP probes all start before the first success and remaining sockets are cancelled', async (t) => {
  const pinger = loadPinger(t);
  const sockets = fakeSockets(t, 3389);
  assert.equal(await pinger.isHostUp('192.0.2.42', { timeoutMs: 1000 }), true);
  assert.deepEqual(
    sockets.map((socket) => socket.port),
    [22, 3389, 445, 80]
  );
  assert.ok(sockets.every((socket) => socket.destroyed));
});

test('parallel TCP probes return false only after every failure', async (t) => {
  const pinger = loadPinger(t);
  const sockets = fakeSockets(t);
  assert.equal(await pinger.isHostUp('192.0.2.42', { timeoutMs: 10 }), false);
  assert.deepEqual(
    sockets.map((socket) => socket.port),
    [22, 3389, 445, 80]
  );
  assert.ok(sockets.every((socket) => socket.destroyed));
});

test('an ICMP success still returns true without opening TCP sockets', async (t) => {
  const pinger = loadPinger(t, true);
  const sockets = fakeSockets(t);
  assert.equal(await pinger.isHostUp('127.0.0.1', { probePort: 12345 }), true);
  assert.equal(sockets.length, 0);
});

test('unsafe hosts never reach ICMP or TCP in isHostUp', async (t) => {
  const pinger = loadPinger(t);
  const sockets = fakeSockets(t);
  assert.equal(await pinger.isHostUp('127.0.0.1;id', { probePort: 22 }), false);
  assert.equal(childProcess.execFile.mock.callCount(), 0);
  assert.equal(sockets.length, 0);
});
