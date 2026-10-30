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

const db = mysql.createConnection(Object.assign({}, config.database, { multipleStatements: true }));
const query = (sql, values) => new Promise((resolve, reject) => {
  db.query(sql, values, (e, rows) => (e ? reject(e) : resolve(rows)));
});

console.log('Migrations: database ' + config.database.user + '@' + config.database.host + '/' + config.database.database + ' (config "' + env + '")');
migrations.run({ query: query, dir: path.join(__dirname, '..', 'migrations') })
  .then(() => { db.end(); })
  .catch((e) => {
    console.log('Migrations: failed. ' + ((e && e.message) || e));
    db.destroy();
    process.exit(1);
  });
