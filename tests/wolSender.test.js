const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMagicPacket } = require('../src/services/wolSender');
const { macToBuffer } = require('../src/utils/mac');

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
