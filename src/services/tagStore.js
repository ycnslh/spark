const { getDb } = require('./db');

const NAME_REGEX = /^[\p{L}\p{N} _-]{1,30}$/u;
const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

function isValidTagName(name) {
  return typeof name === 'string' && NAME_REGEX.test(name);
}
function isValidColor(color) {
  return color == null || color === '' || (typeof color === 'string' && COLOR_REGEX.test(color));
}

function listTags() {
  return getDb().prepare('SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE').all();
}

function createTag({ name, color = null }) {
  const result = getDb()
    .prepare('INSERT INTO tags (name, color) VALUES (?, ?)')
    .run(name.trim(), color || null);
  return getDb()
    .prepare('SELECT id, name, color FROM tags WHERE id = ?')
    .get(result.lastInsertRowid);
}

function deleteTag(id) {
  return getDb().prepare('DELETE FROM tags WHERE id = ?').run(id).changes > 0;
}

function tagsForDevice(deviceId) {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN device_tags dt ON dt.tag_id = t.id
       WHERE dt.device_id = ?
       ORDER BY t.name COLLATE NOCASE`
    )
    .all(deviceId);
}

function setDeviceTags(deviceId, tagIds) {
  const db = getDb();
  const ids = [...new Set(tagIds.filter((n) => Number.isInteger(n)))];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM device_tags WHERE device_id = ?').run(deviceId);
    if (ids.length === 0) return;
    const insert = db.prepare(
      'INSERT OR IGNORE INTO device_tags (device_id, tag_id) VALUES (?, ?)'
    );
    for (const tagId of ids) insert.run(deviceId, tagId);
  });
  tx();
}

function listDevicesWithTags() {
  const db = getDb();
  const devices = db
    .prepare(
      'SELECT id, name, mac, host, description, created_at FROM devices ORDER BY name COLLATE NOCASE'
    )
    .all();
  const links = db
    .prepare(
      `SELECT dt.device_id AS deviceId, t.id, t.name, t.color
       FROM device_tags dt JOIN tags t ON t.id = dt.tag_id`
    )
    .all();
  const byDevice = new Map();
  for (const l of links) {
    if (!byDevice.has(l.deviceId)) byDevice.set(l.deviceId, []);
    byDevice.get(l.deviceId).push({ id: l.id, name: l.name, color: l.color });
  }
  return devices.map((d) => ({ ...d, tags: byDevice.get(d.id) || [] }));
}

module.exports = {
  isValidTagName,
  isValidColor,
  listTags,
  createTag,
  deleteTag,
  tagsForDevice,
  setDeviceTags,
  listDevicesWithTags,
};
