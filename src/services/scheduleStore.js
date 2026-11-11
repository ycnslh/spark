const { getDb } = require('./db');

const MAX_PER_DEVICE = 20;

function decode(row) {
  if (!row) return row;
  return { ...row, days: row.days.split(',').map(Number), enabled: row.enabled === 1 };
}

function listSchedules() {
  return getDb()
    .prepare(
      `SELECT s.*, d.name AS device_name FROM schedules s
       JOIN devices d ON d.id = s.device_id ORDER BY s.time, s.id`
    )
    .all()
    .map(decode);
}

function findById(id) {
  return decode(getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id));
}

function createSchedule(deviceId, { time, days, label = null, enabled = true }) {
  const db = getDb();
  return db.transaction(() => {
    const count = db
      .prepare('SELECT count(*) AS n FROM schedules WHERE device_id = ?')
      .get(deviceId);
    if (count.n >= MAX_PER_DEVICE) return null;
    const result = db
      .prepare(
        'INSERT INTO schedules (device_id, time, days, label, enabled) VALUES (?, ?, ?, ?, ?)'
      )
      .run(deviceId, time, [...days].sort().join(','), label, enabled ? 1 : 0);
    return findById(result.lastInsertRowid);
  })();
}

function updateSchedule(id, patch) {
  const current = findById(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  getDb()
    .prepare('UPDATE schedules SET time = ?, days = ?, label = ?, enabled = ? WHERE id = ?')
    .run(next.time, [...next.days].sort().join(','), next.label, next.enabled ? 1 : 0, id);
  return findById(id);
}

function deleteSchedule(id) {
  return getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
}

function getState() {
  return {
    paused:
      getDb().prepare("SELECT value FROM scheduler_settings WHERE key = 'paused'").get().value ===
      1,
  };
}

function setPaused(paused) {
  getDb()
    .prepare("UPDATE scheduler_settings SET value = ? WHERE key = 'paused'")
    .run(paused ? 1 : 0);
  return getState();
}

// Réserver avant l'envoi garantit au plus une tentative, même après un arrêt brutal.
function claimMinute(id, minuteKey, runAt) {
  return (
    getDb()
      .prepare(
        `UPDATE schedules SET last_run_at = ?, last_run_minute = ?, last_status = 'running'
       WHERE id = ? AND enabled = 1 AND (last_run_minute IS NULL OR last_run_minute != ?)
       AND (SELECT value FROM scheduler_settings WHERE key = 'paused') = 0`
      )
      .run(runAt, minuteKey, id, minuteKey).changes > 0
  );
}

function finishRun(id, minuteKey, status) {
  getDb()
    .prepare('UPDATE schedules SET last_status = ? WHERE id = ? AND last_run_minute = ?')
    .run(status, id, minuteKey);
}

module.exports = {
  MAX_PER_DEVICE,
  listSchedules,
  findById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getState,
  setPaused,
  claimMinute,
  finishRun,
};
