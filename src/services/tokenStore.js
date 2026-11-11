const crypto = require('crypto');
const { getDb } = require('./db');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createToken(deviceId, label = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const result = getDb()
    .prepare('INSERT INTO wake_tokens (device_id, label, token_hash) VALUES (?, ?, ?)')
    .run(deviceId, label, hashToken(token));
  return { id: Number(result.lastInsertRowid), token };
}

function listTokens(deviceId) {
  return getDb()
    .prepare(
      'SELECT id, label, created_at, last_used_at, revoked_at FROM wake_tokens WHERE device_id = ? ORDER BY id DESC'
    )
    .all(deviceId);
}

function findActiveToken(token, deviceId) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return getDb()
    .prepare(
      'SELECT id, label FROM wake_tokens WHERE token_hash = ? AND device_id = ? AND revoked_at IS NULL'
    )
    .get(hashToken(token), deviceId);
}

function revokeToken(deviceId, id) {
  return (
    getDb()
      .prepare(
        "UPDATE wake_tokens SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE device_id = ? AND id = ?"
      )
      .run(deviceId, id).changes > 0
  );
}

function markUsed(id) {
  getDb()
    .prepare(
      "UPDATE wake_tokens SET last_used_at = datetime('now') WHERE id = ? AND revoked_at IS NULL"
    )
    .run(id);
}

module.exports = { createToken, listTokens, findActiveToken, revokeToken, markUsed };
