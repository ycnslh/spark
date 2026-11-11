const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-schedule-migration-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'lot6.db');
require('../src/config').dataDir = tmpDir;
const { getDb, closeDb } = require('../src/services/db');

test('migration v2 vers v3 idempotente, préserve appareils, tokens, historique et pause', (t) => {
  t.after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  // Recréer une base lot 6 en supprimant uniquement les tables du nouveau lot dans /tmp.
  const db = getDb();
  const device = require('../src/services/deviceStore').createDevice({
    name: 'PC',
    mac: 'aa:bb:cc:dd:ee:01',
    description: 'IP effacée 192.0.2.1',
  });
  const token = require('../src/services/tokenStore').createToken(device.id, 'Téléphone');
  require('../src/services/deviceStore').recordWake({
    deviceId: device.id,
    triggeredBy: 'admin',
    success: true,
  });
  const snapshots = Object.fromEntries(
    ['devices', 'wake_tokens', 'wake_history'].map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table}`).all(),
    ])
  );
  db.exec('DROP TABLE schedules; DROP TABLE scheduler_settings; PRAGMA user_version = 2;');
  closeDb();
  const migrated = getDb();
  assert.equal(migrated.pragma('user_version', { simple: true }), 3);
  assert.equal(migrated.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(migrated.pragma('foreign_key_list(schedules)')[0].on_delete, 'CASCADE');
  for (const [table, rows] of Object.entries(snapshots))
    assert.deepEqual(migrated.prepare(`SELECT * FROM ${table}`).all(), rows);
  assert.ok(migrated.prepare('SELECT id FROM wake_tokens WHERE id = ?').get(token.id));
  assert.equal(
    migrated.prepare('SELECT ip FROM devices').get().ip,
    null,
    'Ne pas répéter le backfill v1'
  );
  const store = require('../src/services/scheduleStore');
  const schedule = store.createSchedule(device.id, { time: '08:00', days: [1, 2] });
  store.setPaused(true);
  closeDb();
  const reopened = getDb();
  assert.equal(reopened.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(store.findById(schedule.id), schedule);
  assert.deepEqual(store.getState(), { paused: true });
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM scheduler_settings').get().n, 1);
  // Une seconde connexion a aussi besoin de foreign_keys ; la fabrique le garantit.
  const inspection = new Database(process.env.DB_PATH, { readonly: true });
  assert.equal(inspection.pragma('user_version', { simple: true }), 3);
  inspection.close();
});
