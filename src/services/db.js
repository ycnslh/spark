const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    mac TEXT NOT NULL UNIQUE,
    host TEXT,
    description TEXT,
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
  database.exec(SCHEMA);
  // Compat avec d'anciens volumes créés avant l'ajout de ces colonnes
  addColumnIfMissing(database, 'devices', 'host', 'TEXT');
  addColumnIfMissing(database, 'wake_history', 'confirmed_at', 'TEXT');
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
