// Tests for lib/migrations.js against a stand-in for the database.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const migrations = require('../lib/migrations');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + ((e && e.message) || e));
  }
}

// Remembers what was applied, and runs nothing else. A file whose SQL says FAIL throws.
function fakeDb(applied) {
  const state = { applied: applied || [], ran: [] };
  state.query = async (sql, values) => {
    if (sql.startsWith('CREATE TABLE IF NOT EXISTS SchemaMigration')) { return []; }
    if (sql === 'SELECT name FROM SchemaMigration') { return state.applied.map((name) => ({ name: name })); }
    if (sql.startsWith('INSERT INTO SchemaMigration')) { state.applied.push(values[0]); return []; }
    if (sql.includes('FAIL')) { throw new Error('syntax error'); }
    state.ran.push(sql);
    return [];
  };
  return state;
}

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  for (const name of Object.keys(files)) { fs.writeFileSync(path.join(dir, name), files[name]); }
  return dir;
}

const quiet = () => {};

async function main() {
  console.log('migrations');

  await check('applies new files in name order and records them', async () => {
    const db = fakeDb();
    const dir = folder({ '002_b.sql': 'B', '001_a.sql': 'A', 'README.txt': 'not sql' });
    const applied = await migrations.run({ query: db.query, dir: dir, log: quiet });
    assert.deepStrictEqual(applied, ['001_a.sql', '002_b.sql']);
    assert.deepStrictEqual(db.ran, ['A', 'B']);
    assert.deepStrictEqual(db.applied, ['001_a.sql', '002_b.sql']);
  });

  await check('skips files that were already applied', async () => {
    const db = fakeDb(['001_a.sql']);
    const dir = folder({ '001_a.sql': 'A', '002_b.sql': 'B' });
    const applied = await migrations.run({ query: db.query, dir: dir, log: quiet });
    assert.deepStrictEqual(applied, ['002_b.sql']);
    assert.deepStrictEqual(db.ran, ['B']);
  });

  await check('does nothing when up to date', async () => {
    const db = fakeDb(['001_a.sql']);
    const applied = await migrations.run({ query: db.query, dir: folder({ '001_a.sql': 'A' }), log: quiet });
    assert.deepStrictEqual(applied, []);
    assert.deepStrictEqual(db.ran, []);
  });

  await check('stops at a failing file without recording it', async () => {
    const db = fakeDb();
    const dir = folder({ '001_a.sql': 'A', '002_bad.sql': 'FAIL', '003_c.sql': 'C' });
    await assert.rejects(migrations.run({ query: db.query, dir: dir, log: quiet }), /syntax error/);
    assert.deepStrictEqual(db.applied, ['001_a.sql']);
    assert.deepStrictEqual(db.ran, ['A']);
  });

  await check('the real migrations folder holds only numbered .sql files', async () => {
    const files = migrations.listFiles(path.join(__dirname, '..', 'migrations'));
    assert.ok(files.includes('001_api_tokens.sql'));
    for (const f of files) { assert.match(f, /^\d{3}_[a-z0-9_]+\.sql$/); }
  });

  if (failures) {
    console.log(failures + ' failed');
    process.exit(1);
  }
}

main();
