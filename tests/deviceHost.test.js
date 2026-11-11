const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveDeviceHost } = require('../src/utils/deviceHost');

test('resolveDeviceHost prefers explicit IP and preserves existing host support', () => {
  assert.equal(
    resolveDeviceHost({ ip: '10.0.0.1', host: 'nas.local', description: '10.0.0.2' }),
    '10.0.0.1'
  );
  assert.equal(resolveDeviceHost({ host: ' nas.local ', description: '10.0.0.2' }), 'nas.local');
});

test('resolveDeviceHost extracts the first valid IPv4 from legacy descriptions', () => {
  assert.equal(
    resolveDeviceHost({ description: 'PC 999.1.1.1 puis 192.168.2.3 et 10.0.0.1' }),
    '192.168.2.3'
  );
  assert.equal(
    resolveDeviceHost({ ip: 'invalid', host: 'bad;host', description: '10.0.0.2' }),
    '10.0.0.2'
  );
});

test('resolveDeviceHost rejects invalid IPv4 and unsafe hosts', () => {
  for (const device of [
    null,
    {},
    { ip: '999.1.1.1' },
    { ip: '1.2.3.4;id' },
    { description: '999.1.1.1' },
    { description: '1.2.3.4.5' },
    { description: '01.2.3.4' },
    { host: '$(id)' },
  ]) {
    assert.equal(resolveDeviceHost(device), null);
  }
});
