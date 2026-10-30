// Applies the SQL files in migrations/ that the database has not had yet.
//
// Each file runs once, in name order (001_..., 002_...). Applied files are
// recorded in the SchemaMigration table, so running this again does nothing
// until a new file is added. A file that fails stops the run: it is not
// recorded, the files after it are not run, and the error is thrown.
'use strict';

const fs = require('fs');
const path = require('path');

const TRACKING_TABLE =
  'CREATE TABLE IF NOT EXISTS SchemaMigration (' +
  ' name       VARCHAR(255) NOT NULL,' +
  ' applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' PRIMARY KEY (name)' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

// The .sql files in a folder, sorted by name.
function listFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

// query(sql, values) returns a promise of the result rows. It must allow more
// than one statement per call, since a migration file may hold several.
async function run(options) {
  const query = options.query;
  const dir = options.dir;
  const log = options.log || console.log;

  await query(TRACKING_TABLE);
  const done = new Set((await query('SELECT name FROM SchemaMigration')).map((r) => r.name));
  const pending = listFiles(dir).filter((f) => !done.has(f));

  if (pending.length === 0) {
    log('Migrations: the database is up to date.');
    return [];
  }
  for (const file of pending) {
    log('Migrations: applying ' + file);
    await query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await query('INSERT INTO SchemaMigration (name) VALUES (?)', [file]);
  }
  log('Migrations: applied ' + pending.length + '.');
  return pending;
}

module.exports = { run: run, listFiles: listFiles };
