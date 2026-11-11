const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-migration-'));
process.env.DB_PATH = path.join(tmpDir, 'old.db');
const { getDb, closeDb } = require('../src/services/db');

test('old SQLite schema migrates and backfills once without changing descriptions or history', (t) => {
  t.after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  const old = new Database(process.env.DB_PATH);
  old.exec(`
    CREATE TABLE devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, mac TEXT NOT NULL UNIQUE, description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE wake_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER REFERENCES devices(id),
      triggered_by TEXT, triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      success INTEGER NOT NULL, ping_confirmed INTEGER
    );
    INSERT INTO devices (name, mac, description) VALUES
      ('pc', 'aa:bb:cc:dd:ee:01', 'PC 999.1.2.3 puis 192.168.1.42 et 10.0.0.2'),
      ('nas', 'aa:bb:cc:dd:ee:02', 'NAS sans adresse'),
      ('empty', 'aa:bb:cc:dd:ee:03', NULL),
      ('invalid', 'aa:bb:cc:dd:ee:04', '999.1.2.3 ou 1.2.3.4.5');
    INSERT INTO wake_history (device_id, success) VALUES (1, 1);
  `);
  const descriptions = old.prepare('SELECT description FROM devices ORDER BY id').all();
  old.close();

  const db = getDb();
  const columns = db.prepare('PRAGMA table_info(devices)').all();
  for (const [name, type] of [
    ['ip', 'TEXT'],
    ['broadcast', 'TEXT'],
    ['probe_port', 'INTEGER'],
  ]) {
    const column = columns.find((col) => col.name === name);
    assert.equal(column.type, type);
    assert.equal(column.notnull, 0);
  }
  assert.deepEqual(db.prepare('SELECT ip FROM devices ORDER BY id').all(), [
    { ip: '192.168.1.42' },
    { ip: null },
    { ip: null },
    { ip: null },
  ]);
  assert.deepEqual(db.prepare('SELECT description FROM devices ORDER BY id').all(), descriptions);
  assert.equal(db.prepare('SELECT count(*) AS n FROM wake_history').get().n, 1);
  const snapshot = db.prepare('SELECT * FROM devices ORDER BY id').all();
  closeDb();
  assert.deepEqual(getDb().prepare('SELECT * FROM devices ORDER BY id').all(), snapshot);

  // Effacer une IP après migration ne doit pas relancer le backfill au redémarrage.
  getDb().prepare('UPDATE devices SET ip = NULL WHERE id = 1').run();
  closeDb();
  assert.equal(getDb().prepare('SELECT ip FROM devices WHERE id = 1').get().ip, null);
});
