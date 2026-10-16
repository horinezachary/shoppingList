// Diagnose a login problem for one account without changing anything.
//
//   NODE_ENV=<same value the app runs with> node scripts/check-login.js <username>
//
// It asks for the password (typed text is not shown), looks the account up in
// the database configured in config.js, and reports what kind of password hash
// is stored and which form of the password matches it. The password is never
// printed or stored.
'use strict';

const mysql = require('mysql');
const bcrypt = require('bcryptjs');
const env = process.env.NODE_ENV || 'development';
const config = require('../config.js')[env];
if (!config) {
  console.log('config.js has no "' + env + '" section. Run this with the same NODE_ENV the app uses.');
  process.exit(1);
}
console.log('config section:    ' + env + '  (database ' + config.database.user + '@' + config.database.host + '/' + config.database.database + ')');

const uname = process.argv[2];
if (!uname) {
  console.log('usage: node scripts/check-login.js <username>');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (text) {
      if (text.includes(question)) { rl.output.write(text); }
    };
    rl.question(question, (answer) => { rl.output.write('\n'); rl.close(); resolve(answer); });
  });
}

async function main() {
  const db = mysql.createConnection(config.database);
  const q = (sql, values) => new Promise((resolve, reject) => db.query(sql, values, (e, r) => (e ? reject(e) : resolve(r))));
  const rows = await q('SELECT uname, password, salt, hash FROM User WHERE uname = ?', [uname]);
  if (rows.length === 0) {
    console.log('No user named "' + uname + '" (the lookup is case-insensitive on most MySQL setups).');
    const like = '%' + uname + '%';
    const near = await q('SELECT uname, fname, lname, email FROM User WHERE uname LIKE ? OR email LIKE ? OR fname LIKE ? OR lname LIKE ? LIMIT 20', [like, like, like, like]);
    if (near.length > 0) {
      console.log('Accounts that look similar:');
      near.forEach((r) => console.log('  ' + r.uname + '  (' + r.fname + ' ' + r.lname + ', ' + r.email + ')'));
    }
    db.end();
    return;
  }
  const u = rows[0];
  const stored = u.password == null ? '' : String(u.password);
  console.log('user found:        ' + u.uname);
  console.log('password column:   length ' + stored.length + ', starts with "' + stored.slice(0, 4) + '"  (a bcrypt hash is 60 characters and starts with $2a$, $2b$ or $2y$)');
  console.log('hash column:       ' + JSON.stringify(u.hash) + '   salt column: ' + (u.salt ? 'set (' + String(u.salt).length + ' characters)' : 'empty'));

  const password = await askHidden('Password to test: ');
  const candidates = [
    ['exactly as typed (current form)', password],
    ['quoted/escaped form (older accounts)', mysql.escape(password)],
    ['typed, trimmed of spaces', password.trim()]
  ];
  for (const [label, value] of candidates) {
    let result;
    try {
      result = await bcrypt.compare(value, stored);
    } catch (e) {
      result = 'error: ' + e.message;
    }
    console.log('  ' + label.padEnd(42) + ' -> ' + result);
  }
  db.end();
}

main().catch((e) => { console.log('failed:', e.message); process.exit(1); });
