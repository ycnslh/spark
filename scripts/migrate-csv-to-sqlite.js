#!/usr/bin/env node
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const config = require('../src/config');
const { getDb, closeDb } = require('../src/services/db');
const { isValidMac, formatMac } = require('../src/utils/mac');

function migrate() {
  if (!fs.existsSync(config.legacyCsvPath)) {
    console.log(`No legacy CSV found at ${config.legacyCsvPath}, nothing to migrate.`);
    return;
  }

  const csvData = fs.readFileSync(config.legacyCsvPath, 'utf8');
  const rows = parse(csvData, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Found ${rows.length} rows in CSV`);

  const db = getDb();
  const insert = db.prepare('INSERT OR IGNORE INTO devices (name, mac) VALUES (?, ?)');

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.name || !row.mac || !isValidMac(row.mac)) {
      console.warn('Skipping invalid row:', row);
      skipped++;
      continue;
    }
    const result = insert.run(row.name, formatMac(row.mac));
    if (result.changes > 0) imported++;
    else skipped++;
  }
  console.log(`Imported ${imported}, skipped ${skipped}`);
  closeDb();
}

if (require.main === module) {
  try {
    migrate();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

module.exports = { migrate };
