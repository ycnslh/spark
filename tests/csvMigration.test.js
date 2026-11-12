const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { migrate } = require('../scripts/migrate-csv-to-sqlite');
const { getDb, closeDb } = require('../src/services/db');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-csv-'));
  config.dataDir = dir;
  config.dbPath = path.join(dir, 'migration.db');
  config.legacyCsvPath = path.join(dir, 'devices.csv');
  t.after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('CSV sync migration preserves quoted fields, CRLF, trimming and duplicate handling', (t) => {
  fixture(t);
  fs.writeFileSync(
    config.legacyCsvPath,
    'name,mac\r\n"Bureau, étage",AA-BB-CC-DD-EE-01\r\n\r\n' +
      ' NAS , aa:bb:cc:dd:ee:02 \r\n"Bureau, étage",aa:bb:cc:dd:ee:01\r\n' +
      'invalid,not-a-mac\r\n,aa:bb:cc:dd:ee:03\r\n'
  );
  migrate();
  const expected = [
    { name: 'Bureau, étage', mac: 'aa:bb:cc:dd:ee:01' },
    { name: 'NAS', mac: 'aa:bb:cc:dd:ee:02' },
  ];
  assert.deepEqual(getDb().prepare('SELECT name, mac FROM devices ORDER BY id').all(), expected);
  // La reprise d'une ancienne installation doit aussi être idempotente.
  migrate();
  assert.deepEqual(getDb().prepare('SELECT name, mac FROM devices ORDER BY id').all(), expected);
});

test('malformed CSV fails before opening SQLite instead of importing partial data', (t) => {
  fixture(t);
  fs.writeFileSync(config.legacyCsvPath, 'name,mac\n"unfinished,aa:bb:cc:dd:ee:01');
  assert.throws(migrate, { code: 'CSV_QUOTE_NOT_CLOSED' });
  assert.equal(fs.existsSync(config.dbPath), false);
});

test('missing legacy CSV is a no-op without creating a database', (t) => {
  fixture(t);
  migrate();
  assert.equal(fs.existsSync(config.dbPath), false);
});
