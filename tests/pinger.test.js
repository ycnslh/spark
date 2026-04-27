const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isSafeHost, icmpPing, tcpProbe } = require('../src/services/pinger');

test('isSafeHost accepts IPv4', () => {
  assert.equal(isSafeHost('192.168.1.1'), true);
});

test('isSafeHost accepts hostname', () => {
  assert.equal(isSafeHost('my-server.local'), true);
});

test('isSafeHost accepts IPv6 (colon form)', () => {
  assert.equal(isSafeHost('fe80::1'), true);
});

test('isSafeHost rejects shell metacharacters', () => {
  assert.equal(isSafeHost('127.0.0.1; rm -rf /'), false);
  assert.equal(isSafeHost('127.0.0.1 && echo pwn'), false);
  assert.equal(isSafeHost('$(whoami)'), false);
  assert.equal(isSafeHost('`id`'), false);
  assert.equal(isSafeHost('host|cat'), false);
});

test('isSafeHost rejects empty/non-string', () => {
  assert.equal(isSafeHost(''), false);
  assert.equal(isSafeHost(null), false);
  assert.equal(isSafeHost(undefined), false);
  assert.equal(isSafeHost(123), false);
});

test('icmpPing returns false for unsafe host without spawning ping', async () => {
  const result = await icmpPing('127.0.0.1; touch /tmp/spark-pwn-test', 200);
  assert.equal(result, false);
});

test('tcpProbe returns false for unsafe host', async () => {
  const result = await tcpProbe('host && evil', 22, 100);
  assert.equal(result, false);
});
