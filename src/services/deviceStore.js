const { getDb } = require('./db');
const { normalizeMac, formatMac } = require('../utils/mac');

function listDevices() {
  return getDb()
    .prepare('SELECT id, name, mac, description, created_at FROM devices ORDER BY name COLLATE NOCASE')
    .all();
}

function findByMac(mac) {
  return getDb()
    .prepare('SELECT * FROM devices WHERE mac = ?')
    .get(formatMac(mac));
}

function findByNameOrMac(identifier) {
  const db = getDb();
  const byName = db.prepare('SELECT * FROM devices WHERE name = ? COLLATE NOCASE').get(identifier);
  if (byName) return byName;
  try {
    return db.prepare('SELECT * FROM devices WHERE mac = ?').get(formatMac(identifier));
  } catch {
    return null;
  }
}

function findById(id) {
  return getDb().prepare('SELECT * FROM devices WHERE id = ?').get(id);
}

function createDevice({ name, mac, description }) {
  const formatted = formatMac(mac);
  const stmt = getDb().prepare(
    'INSERT INTO devices (name, mac, description) VALUES (?, ?, ?)'
  );
  const result = stmt.run(name, formatted, description || null);
  return findById(result.lastInsertRowid);
}

function deleteByMac(mac) {
  const result = getDb()
    .prepare('DELETE FROM devices WHERE mac = ?')
    .run(formatMac(mac));
  return result.changes > 0;
}

function macExists(mac) {
  const normalized = normalizeMac(mac);
  return getDb()
    .prepare("SELECT 1 FROM devices WHERE LOWER(REPLACE(REPLACE(mac, ':', ''), '-', '')) = ?")
    .get(normalized) != null;
}

function nameExists(name) {
  return getDb()
    .prepare('SELECT 1 FROM devices WHERE name = ? COLLATE NOCASE')
    .get(name) != null;
}

function recordWake({ deviceId, triggeredBy, success, pingConfirmed = null }) {
  return getDb()
    .prepare(
      'INSERT INTO wake_history (device_id, triggered_by, success, ping_confirmed) VALUES (?, ?, ?, ?)'
    )
    .run(deviceId, triggeredBy, success ? 1 : 0, pingConfirmed === null ? null : (pingConfirmed ? 1 : 0));
}

function setLastPingResult(historyId, confirmed) {
  getDb()
    .prepare('UPDATE wake_history SET ping_confirmed = ? WHERE id = ?')
    .run(confirmed ? 1 : 0, historyId);
}

function getHistory(deviceId, limit = 20) {
  return getDb()
    .prepare(
      'SELECT id, triggered_by, triggered_at, success, ping_confirmed FROM wake_history WHERE device_id = ? ORDER BY triggered_at DESC LIMIT ?'
    )
    .all(deviceId, limit);
}

module.exports = {
  listDevices,
  findByMac,
  findByNameOrMac,
  findById,
  createDevice,
  deleteByMac,
  macExists,
  nameExists,
  recordWake,
  setLastPingResult,
  getHistory,
};
