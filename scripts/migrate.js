// Brings the database up to date with the files in migrations/ (see lib/migrations.js).
//
//   NODE_ENV=<same value the app runs with> node scripts/migrate.js
//
// scripts/deploy.sh runs this before reloading the app. Safe to run by hand at
// any time: files that were already applied are skipped.
'use strict';

const path = require('path');
const mysql = require('mysql');
const migrations = require('../lib/migrations');

const env = process.env.NODE_ENV || 'development';
const config = require('../config.js')[env];
if (!config) {
  console.log('config.js has no "' + env + '" section. Run this with the same NODE_ENV the app uses.');
  process.exit(1);
}

// migrationDatabase (optional) is a login allowed to change tables; the app's own login need not be.
const dbConfig = Object.assign({}, config.database, config.migrationDatabase, { multipleStatements: true });
const db = mysql.createConnection(dbConfig);
const query = (sql, values) => new Promise((resolve, reject) => {
  db.query(sql, values, (e, rows) => (e ? reject(e) : resolve(rows)));
});

console.log('Migrations: database ' + dbConfig.user + '@' + dbConfig.host + '/' + dbConfig.database + ' (config "' + env + '")');
migrations.run({ query: query, dir: path.join(__dirname, '..', 'migrations') })
  .then(() => { db.end(); })
  .catch((e) => {
    console.log('Migrations: failed. ' + ((e && e.message) || e));
    if (e && (e.code === 'ER_TABLEACCESS_DENIED_ERROR' || e.code === 'ER_DBACCESS_DENIED_ERROR')) {
      console.log('Migrations: the "' + dbConfig.user + '" login may not change tables. Add a migrationDatabase login that can (see exampleConfig.js).');
    }
    db.destroy();
    process.exit(1);
  });
