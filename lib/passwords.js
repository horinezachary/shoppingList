// Password hashing and checking.
//
// Older accounts were created by hashing the password *after* it had been run
// through mysql.escape(), so the hash covers the quoted string ('secret' with
// the quotes). New hashes cover the password exactly as typed. A login is
// checked against both forms, and when only the older form matches the caller
// is told to re-hash, so accounts move to the new form the next time their
// owner signs in. No database column or schema change is involved.
//
// bcrypt and the escape function are passed in so this can be tested without
// installing anything.
'use strict';

function create(options) {
  const bcrypt = options.bcrypt;
  const escape = options.escape;
  const rounds = options.rounds;
  const log = options.log || function () {};

  // Used to spend the same time on an unknown username as on a real one.
  let dummyHash = null;
  function getDummyHash() {
    if (!dummyHash) { dummyHash = bcrypt.hash('not-a-real-password', rounds); }
    return dummyHash;
  }

  async function safeCompare(candidate, stored) {
    try {
      return (await bcrypt.compare(candidate, stored)) === true;
    } catch (e) {
      // a stored value that is not a valid bcrypt hash ends up here
      log('password check failed: ' + e.message);
      return false;
    }
  }

  function hash(password) {
    return bcrypt.hash(password, rounds);
  }

  // Returns { ok, upgrade }. upgrade is true when the password is right but the
  // stored hash is in the older form and should be replaced.
  async function verify(password, stored) {
    if (typeof stored !== 'string' || stored === '') {
      await safeCompare(password, await getDummyHash());
      return { ok: false, upgrade: false };
    }
    if (await safeCompare(password, stored)) {
      return { ok: true, upgrade: false };
    }
    if (await safeCompare(escape(password), stored)) {
      return { ok: true, upgrade: true };
    }
    return { ok: false, upgrade: false };
  }

  return { hash: hash, verify: verify, dummy: getDummyHash };
}

module.exports = { create: create };
