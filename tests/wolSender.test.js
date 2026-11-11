const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { once, EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const os = require('node:os');
process.env.NODE_ENV = 'test';
const {
  buildMagicPacket,
  calculateBroadcasts,
  sendWakeOnLan,
} = require('../src/services/wolSender');
const { macToBuffer } = require('../src/utils/mac');
const config = require('../src/config');
const logger = require('../src/utils/logger');

test('magic packet is 102 bytes (6 + 16*6)', () => {
  const packet = buildMagicPacket(macToBuffer('aa:bb:cc:dd:ee:ff'));
  assert.equal(packet.length, 102);
});

test('magic packet starts with 6 FF bytes', () => {
  const packet = buildMagicPacket(macToBuffer('aa:bb:cc:dd:ee:ff'));
  for (let i = 0; i < 6; i++) {
    assert.equal(packet[i], 0xff);
  }
});

test('magic packet contains MAC repeated 16 times', () => {
  const mac = macToBuffer('11:22:33:44:55:66');
  const packet = buildMagicPacket(mac);
  for (let i = 0; i < 16; i++) {
    const offset = 6 + i * 6;
    assert.deepEqual(packet.subarray(offset, offset + 6), mac);
  }
});

test('broadcasts use /24, /16 and /23 netmasks and deduplicate targets', () => {
  const ipv4 = (address, netmask) => ({ family: 'IPv4', address, netmask, internal: false });
  assert.deepEqual(
    calculateBroadcasts({
      eth0: [ipv4('192.168.1.42', '255.255.255.0')],
      eth1: [ipv4('172.20.12.34', '255.255.0.0')],
      eth2: [ipv4('10.0.4.17', '255.255.254.0'), ipv4('10.0.5.200', '255.255.254.0')],
      wlan0: [ipv4('192.168.1.50', '255.255.255.0')],
      fallback: [ipv4('192.168.1.42', '0.0.0.0')],
    }),
    ['192.168.1.255', '172.20.255.255', '10.0.5.255', '255.255.255.255']
  );
});

test('broadcasts ignore internal interfaces, IPv6 and unavailable entries', () => {
  assert.deepEqual(
    calculateBroadcasts({
      lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
      eth0: [
        { family: 'IPv6', address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', internal: false },
      ],
      missing: undefined,
      invalid: [{ family: 'IPv4', address: 'invalid', netmask: '255.255.255.0', internal: false }],
    }),
    ['255.255.255.255']
  );
  assert.deepEqual(calculateBroadcasts({}), ['255.255.255.255']);
});

test('broadcasts accept numeric IPv4 family identifiers', () => {
  assert.deepEqual(
    calculateBroadcasts({
      eth0: [{ family: 4, address: '192.168.2.10', netmask: '255.255.255.0', internal: false }],
    }),
    ['192.168.2.255', '255.255.255.255']
  );
});

async function udpReceiver(t) {
  const socket = dgram.createSocket('udp4');
  const packets = [];
  socket.on('message', (packet) => packets.push(packet));
  const listening = once(socket, 'listening');
  socket.bind(0, '127.0.0.1');
  await listening;
  t.after(() => socket.close());
  return {
    port: socket.address().port,
    packets,
    async waitForPackets(count) {
      const signal = AbortSignal.timeout(2000);
      while (packets.length < count) {
        await once(socket, 'message', { signal });
      }
      return packets;
    },
  };
}

function assertMagicPacket(packet) {
  const mac = macToBuffer('11:22:33:44:55:66');
  assert.equal(packet.length, 102);
  assert.deepEqual(packet.subarray(0, 6), Buffer.alloc(6, 0xff));
  for (let i = 0; i < 16; i++) {
    assert.deepEqual(packet.subarray(6 + i * 6, 12 + i * 6), mac);
  }
}

test('sends the complete magic packet over real UDP on an ephemeral port', async (t) => {
  const receiver = await udpReceiver(t);
  await sendWakeOnLan('11:22:33:44:55:66', {
    broadcasts: ['127.0.0.1'],
    port: receiver.port,
    repeatDelayMs: 0,
  });
  const [packet] = await receiver.waitForPackets(1);
  assertMagicPacket(packet);
});

test('sends a second magic packet in the background', async (t) => {
  const receiver = await udpReceiver(t);
  await sendWakeOnLan('11:22:33:44:55:66', {
    broadcasts: ['127.0.0.1'],
    port: receiver.port,
    repeatDelayMs: 50,
  });
  const packets = await receiver.waitForPackets(2);
  assert.equal(packets.length, 2);
  packets.forEach(assertMagicPacket);
});

test('repeatDelayMs=0 disables the second send', async (t) => {
  const receiver = await udpReceiver(t);
  await sendWakeOnLan('11:22:33:44:55:66', {
    broadcasts: ['127.0.0.1'],
    port: receiver.port,
    repeatDelayMs: 0,
  });
  await receiver.waitForPackets(1);
  await delay(150);
  assert.equal(receiver.packets.length, 1);
});

test('a failing target does not prevent a valid UDP target from receiving', async (t) => {
  const receiver = await udpReceiver(t);
  // IPv6 cannot be sent through an udp4 socket; this fails without DNS or network access.
  await sendWakeOnLan('11:22:33:44:55:66', {
    broadcasts: ['::1', '127.0.0.1'],
    port: receiver.port,
    repeatDelayMs: 0,
  });
  const [packet] = await receiver.waitForPackets(1);
  assertMagicPacket(packet);
});

test('rejects when every target fails', async () => {
  await assert.rejects(
    sendWakeOnLan('11:22:33:44:55:66', { broadcasts: ['::1'], repeatDelayMs: 0 }),
    AggregateError
  );
});

test('invalid MAC rejects before any packet is sent', async () => {
  await assert.rejects(
    sendWakeOnLan('invalid', { broadcasts: ['127.0.0.1'], repeatDelayMs: 0 }),
    /Invalid MAC address/
  );
});

test('a repeat failure is caught and only logged at debug level', async (t) => {
  const receiver = await udpReceiver(t);
  await sendWakeOnLan('11:22:33:44:55:66', {
    broadcasts: ['127.0.0.1'],
    port: receiver.port,
    repeatDelayMs: 50,
  });
  const failure = new Error('repeat socket failed');
  t.mock.method(dgram, 'createSocket', () => {
    throw failure;
  });
  const debug = t.mock.method(logger, 'debug', () => {});
  const error = t.mock.method(logger, 'error', () => {});
  await delay(150);
  assert.ok(debug.mock.calls.some(({ arguments: args }) => args[0] === 'WoL repeat failed'));
  assert.equal(error.mock.callCount(), 0);
});

test('the background repeat timer does not keep the process alive or delay the response', () => {
  execFileSync(
    process.execPath,
    [
      '-e',
      `require('./src/services/wolSender').sendWakeOnLan('11:22:33:44:55:66', {
        broadcasts: ['127.0.0.1'], port: 9, repeatDelayMs: 60000
      }).catch(() => { process.exitCode = 1; });`,
    ],
    { cwd: config.rootDir, timeout: 5000, env: { ...process.env, NODE_ENV: 'test' } }
  );
});

test('default targets respect explicit broadcast, allInterfaces and configured port', async (t) => {
  const previousConfig = config.wol;
  t.after(() => {
    config.wol = previousConfig;
  });
  const targets = [];
  t.mock.method(dgram, 'createSocket', () => {
    const socket = new EventEmitter();
    socket.bind = () => queueMicrotask(() => socket.emit('listening'));
    socket.setBroadcast = () => {};
    socket.close = () => {};
    socket.send = (packet, offset, length, port, address, callback) => {
      targets.push({ port, address });
      queueMicrotask(() => callback(null));
    };
    return socket;
  });
  const interfaces = t.mock.method(os, 'networkInterfaces', () => ({
    eth0: [{ family: 'IPv4', address: '10.0.1.2', netmask: '255.255.255.0', internal: false }],
  }));
  config.wol = { broadcast: '192.168.3.255', allInterfaces: true, port: 12345, repeatDelayMs: 0 };
  await sendWakeOnLan('11:22:33:44:55:66');
  assert.deepEqual(targets.splice(0), [{ port: 12345, address: '192.168.3.255' }]);
  assert.equal(interfaces.mock.callCount(), 0);

  config.wol = { ...config.wol, broadcast: null, allInterfaces: false };
  await sendWakeOnLan('11:22:33:44:55:66');
  assert.deepEqual(targets.splice(0), [{ port: 12345, address: '255.255.255.255' }]);
  assert.equal(interfaces.mock.callCount(), 0);

  config.wol.allInterfaces = true;
  await sendWakeOnLan('11:22:33:44:55:66');
  assert.deepEqual(targets, [
    { port: 12345, address: '10.0.1.255' },
    { port: 12345, address: '255.255.255.255' },
  ]);
  assert.equal(interfaces.mock.callCount(), 1);
});

test('WoL environment configuration has the requested defaults and accepts overrides', () => {
  function loadWolConfig(overrides = {}) {
    const env = { ...process.env };
    for (const name of ['WOL_BROADCAST', 'WOL_ALL_INTERFACES', 'WOL_REPEAT_DELAY_MS', 'WOL_PORT']) {
      delete env[name];
    }
    return JSON.parse(
      execFileSync(
        process.execPath,
        ['-e', "console.log(JSON.stringify(require('./src/config').wol))"],
        {
          cwd: config.rootDir,
          env: { ...env, ...overrides },
        }
      )
    );
  }
  assert.deepEqual(loadWolConfig(), {
    broadcast: null,
    allInterfaces: true,
    repeatDelayMs: 2000,
    port: 9,
  });
  assert.deepEqual(
    loadWolConfig({
      WOL_BROADCAST: '192.168.4.255',
      WOL_ALL_INTERFACES: 'false',
      WOL_REPEAT_DELAY_MS: '0',
      WOL_PORT: '12345',
    }),
    { broadcast: '192.168.4.255', allInterfaces: false, repeatDelayMs: 0, port: 12345 }
  );
});
