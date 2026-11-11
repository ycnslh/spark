const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-token-migration-'));
process.env.DB_PATH = path.join(tmpDir, 'lot3.db');
process.env.NODE_ENV = 'test';
const { getDb, closeDb } = require('../src/services/db');

test('lot 3 version 1 migrates idempotently to version 2 without repeating IP backfill', (t) => {
  t.after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  const old = new Database(process.env.DB_PATH);
  old.exec(`
    CREATE TABLE devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, mac TEXT NOT NULL UNIQUE,
      host TEXT, description TEXT, ip TEXT, broadcast TEXT, probe_port INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE wake_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      triggered_by TEXT, triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      success INTEGER NOT NULL, ping_confirmed INTEGER, confirmed_at TEXT
    );
    INSERT INTO devices (name, mac, description, broadcast, probe_port)
    VALUES ('pc', 'aa:bb:cc:dd:ee:01', 'Ancienne IP 192.168.1.42 effacée', '10.0.0.255', 3389);
    INSERT INTO wake_history (device_id, triggered_by, success) VALUES (1, 'admin', 1);
    PRAGMA user_version = 1;
  `);
  const before = old.prepare('SELECT * FROM devices').all();
  const history = old.prepare('SELECT * FROM wake_history').all();
  old.close();
  const db = getDb();
  assert.equal(db.pragma('user_version', { simple: true }), 2);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.prepare('SELECT * FROM devices').all(), before);
  assert.deepEqual(db.prepare('SELECT * FROM wake_history').all(), history);
  assert.equal(db.pragma('foreign_key_list(wake_tokens)')[0].on_delete, 'CASCADE');
  const token = require('../src/services/tokenStore').createToken(1);
  closeDb();
  assert.equal(getDb().pragma('user_version', { simple: true }), 2);
  assert.deepEqual(getDb().prepare('SELECT * FROM devices').all(), before);
  assert.equal(
    getDb().prepare('SELECT count(*) n FROM wake_tokens WHERE id = ?').get(token.id).n,
    1
  );
});
