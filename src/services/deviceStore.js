const { getDb } = require('./db');
const { normalizeMac, formatMac } = require('../utils/mac');

const SELECT_COLS = 'id, name, mac, host, description, created_at';

function listDevices() {
  return getDb().prepare(`SELECT ${SELECT_COLS} FROM devices ORDER BY name COLLATE NOCASE`).all();
}

function findByMac(mac) {
  return getDb().prepare('SELECT * FROM devices WHERE mac = ?').get(formatMac(mac));
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

function createDevice({ name, mac, host, description }) {
  const formatted = formatMac(mac);
  const stmt = getDb().prepare(
    'INSERT INTO devices (name, mac, host, description) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(name, formatted, host || null, description || null);
  return findById(result.lastInsertRowid);
}

function updateDevice(id, { name, host, description }) {
  const fields = [];
  const values = [];
  if (name !== undefined) {
    fields.push('name = ?');
    values.push(name);
  }
  if (host !== undefined) {
    fields.push('host = ?');
    values.push(host || null);
  }
  if (description !== undefined) {
    fields.push('description = ?');
    values.push(description || null);
  }
  if (fields.length === 0) return findById(id);
  values.push(id);
  getDb()
    .prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  return findById(id);
}

function deleteByMac(mac) {
  const result = getDb().prepare('DELETE FROM devices WHERE mac = ?').run(formatMac(mac));
  return result.changes > 0;
}

function macExists(mac) {
  const normalized = normalizeMac(mac);
  return (
    getDb()
      .prepare("SELECT 1 FROM devices WHERE LOWER(REPLACE(REPLACE(mac, ':', ''), '-', '')) = ?")
      .get(normalized) != null
  );
}

function nameExists(name, exceptId = null) {
  if (exceptId == null) {
    return getDb().prepare('SELECT 1 FROM devices WHERE name = ? COLLATE NOCASE').get(name) != null;
  }
  return (
    getDb()
      .prepare('SELECT 1 FROM devices WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(name, exceptId) != null
  );
}

function recordWake({ deviceId, triggeredBy, success, pingConfirmed = null }) {
  return getDb()
    .prepare(
      'INSERT INTO wake_history (device_id, triggered_by, success, ping_confirmed) VALUES (?, ?, ?, ?)'
    )
    .run(
      deviceId,
      triggeredBy,
      success ? 1 : 0,
      pingConfirmed === null ? null : pingConfirmed ? 1 : 0
    );
}

function setLastPingResult(historyId, confirmed) {
  getDb()
    .prepare(
      "UPDATE wake_history SET ping_confirmed = ?, confirmed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?"
    )
    .run(confirmed ? 1 : 0, confirmed ? 1 : 0, historyId);
}

function getHistory(deviceId, limit = 20, beforeId = null) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  if (beforeId) {
    return getDb()
      .prepare(
        'SELECT id, triggered_by, triggered_at, success, ping_confirmed, confirmed_at FROM wake_history WHERE device_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
      )
      .all(deviceId, beforeId, lim);
  }
  return getDb()
    .prepare(
      'SELECT id, triggered_by, triggered_at, success, ping_confirmed, confirmed_at FROM wake_history WHERE device_id = ? ORDER BY id DESC LIMIT ?'
    )
    .all(deviceId, lim);
}

module.exports = {
  listDevices,
  findByMac,
  findByNameOrMac,
  findById,
  createDevice,
  updateDevice,
  deleteByMac,
  macExists,
  nameExists,
  recordWake,
  setLastPingResult,
  getHistory,
};
