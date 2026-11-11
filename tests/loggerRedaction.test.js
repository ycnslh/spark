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
