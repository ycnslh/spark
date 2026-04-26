const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;

function getDb() {
  if (db) return db;

  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      mac TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wake_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      triggered_by TEXT,
      triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      success INTEGER NOT NULL,
      ping_confirmed INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_history_device ON wake_history(device_id, triggered_at DESC);
  `);

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
