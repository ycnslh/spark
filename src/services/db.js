const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');
const { extractIPv4 } = require('../utils/ipv4');

let db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    mac TEXT NOT NULL UNIQUE,
    host TEXT,
    description TEXT,
    ip TEXT,
    broadcast TEXT,
    probe_port INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wake_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    triggered_by TEXT,
    triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
    success INTEGER NOT NULL,
    ping_confirmed INTEGER,
    confirmed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_history_device ON wake_history(device_id, triggered_at DESC);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
  );

  CREATE TABLE IF NOT EXISTS device_tags (
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (device_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_device_tags_tag ON device_tags(tag_id);
`;

function addColumnIfMissing(database, table, column, definition) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    logger.info('Schema: column added', { table, column });
  }
}

function initSchema(database) {
  database.pragma('foreign_keys = ON');
  database.transaction(() => {
    database.exec(SCHEMA);
    // Compat avec d'anciens volumes créés avant l'ajout de ces colonnes
    addColumnIfMissing(database, 'devices', 'host', 'TEXT');
    addColumnIfMissing(database, 'wake_history', 'confirmed_at', 'TEXT');
    addColumnIfMissing(database, 'devices', 'ip', 'TEXT');
    addColumnIfMissing(database, 'devices', 'broadcast', 'TEXT');
    addColumnIfMissing(database, 'devices', 'probe_port', 'INTEGER');
    if (database.pragma('user_version', { simple: true }) < 1) {
      const update = database.prepare('UPDATE devices SET ip = ? WHERE id = ? AND ip IS NULL');
      for (const device of database
        .prepare('SELECT id, description FROM devices WHERE ip IS NULL')
        .all()) {
        const ip = extractIPv4(device.description);
        if (ip) update.run(ip, device.id);
      }
      database.pragma('user_version = 1');
    }
    if (database.pragma('user_version', { simple: true }) < 2) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS wake_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          label TEXT,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_wake_tokens_device ON wake_tokens(device_id);
      `);
      database.pragma('user_version = 2');
    }
    if (database.pragma('user_version', { simple: true }) < 3) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          label TEXT,
          time TEXT NOT NULL,
          days TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          last_run_at TEXT,
          last_run_minute TEXT,
          last_status TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_schedules_device ON schedules(device_id);
        CREATE TABLE IF NOT EXISTS scheduler_settings (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL CHECK (value IN (0, 1))
        );
        INSERT OR IGNORE INTO scheduler_settings (key, value) VALUES ('paused', 0);
      `);
      database.pragma('user_version = 3');
    }
  })();
}

function getDb() {
  if (db) return db;

  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  logger.info('SQLite database ready', { path: config.dbPath });
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
