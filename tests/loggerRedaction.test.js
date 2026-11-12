const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('application logs redact URL queries and sensitive fields in messages, metadata, errors and children', () => {
  const script = `
    const logger = require('./src/utils/logger');
    const secret = 'secret-token-never-in-logs';
    const url = '/wake/pc?token=' + secret + '&other=value';
    logger.info('Request ' + url, { originalUrl: url, nested: { token: secret } });
    logger.error('Error ' + url, { error: new Error('Failed ' + url) });
    logger.child({ url, token: secret }).warn('Child ' + url, { url });
    logger.raw.warn({ req: { url }, authorization: secret }, 'Raw request ' + url);
    logger.info('Encoded key /wake/pc?%74oken=' + secret);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: pathRoot(),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('secret-token-never-in-logs'), false);
  const records = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 5);
  for (const record of records) assert.match(record.msg, /REDACTED/);
  assert.equal(records[0].nested.token, '[REDACTED]');
  assert.match(records[1].error.stack, /REDACTED/);
  assert.equal(records[2].token, '[REDACTED]');
});

function pathRoot() {
  return require('node:path').resolve(__dirname, '..');
}

test('development pretty transport preserves the redaction hook under Pino 10', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const logger = require('./src/utils/logger');
       logger.info('Wake /wake/pc?token=pretty-secret', { token: 'pretty-secret' });
       logger.child({ nested: { authorization: 'pretty-secret' } }).warn('Child');`,
    ],
    {
      cwd: pathRoot(),
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'info' },
    }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REDACTED/);
  assert.match(result.stdout, /Child/);
  assert.equal(result.stdout.includes('pretty-secret'), false);
});

test('development logger and SQLite close cleanly in short-lived processes', () => {
  const script = `
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-pretty-sqlite-'));
    process.env.DB_PATH = path.join(dir, 'test.db');
    const store = require('./src/services/deviceStore');
    const { closeDb } = require('./src/services/db');
    const logger = require('./src/utils/logger');
    try {
      for (let i = 0; i < 20; i++) {
        const device = store.createDevice({ name: 'device-' + i, mac: '02:00:00:00:00:01' });
        store.recordWake({ deviceId: device.id, triggeredBy: 'test', success: true });
        store.getHistory(device.id);
        store.listDevices();
        store.deleteByMac(device.mac);
      }
      logger.info('Completed /wake/pc?token=sqlite-pretty-secret');
    } finally {
      closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  `;
  for (let i = 0; i < 10; i++) {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: pathRoot(),
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'info' },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, `run ${i}: ${result.signal}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Completed.*REDACTED/);
    assert.equal(result.stdout.includes('sqlite-pretty-secret'), false);
  }
});
