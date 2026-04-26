const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidMac, normalizeMac, formatMac, macToBuffer } = require('../src/utils/mac');

test('isValidMac accepts colon, dash and bare formats', () => {
  assert.equal(isValidMac('aa:bb:cc:dd:ee:ff'), true);
  assert.equal(isValidMac('AA-BB-CC-DD-EE-FF'), true);
  assert.equal(isValidMac('aabbccddeeff'), true);
});

test('isValidMac rejects malformed input', () => {
  assert.equal(isValidMac(''), false);
  assert.equal(isValidMac('aa:bb:cc:dd:ee'), false);
  assert.equal(isValidMac('zz:bb:cc:dd:ee:ff'), false);
  assert.equal(isValidMac(null), false);
  assert.equal(isValidMac(undefined), false);
});

test('normalizeMac strips separators and lowercases', () => {
  assert.equal(normalizeMac('AA:BB:CC:DD:EE:FF'), 'aabbccddeeff');
  assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'aabbccddeeff');
});

test('formatMac inserts colons every two characters', () => {
  assert.equal(formatMac('aabbccddeeff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(formatMac('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff');
});

test('macToBuffer produces 6 bytes', () => {
  const buf = macToBuffer('aa:bb:cc:dd:ee:ff');
  assert.equal(buf.length, 6);
  assert.equal(buf[0], 0xaa);
  assert.equal(buf[5], 0xff);
});

test('macToBuffer throws on bad input', () => {
  assert.throws(() => macToBuffer('not-a-mac'));
});
