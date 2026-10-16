// Sign-in tokens for the JSON API.
//
// A signed-in device holds two random secrets: a short-lived access token that
// goes on every request, and a long-lived refresh token that is only used to
// get a new access token. Only SHA-256 hashes are stored (migrations/
// 001_api_tokens.sql); both secrets are 256 random bits, so a fast hash is
// enough. Every request looks the access token up, so deleting the row signs a
// device out immediately.
'use strict';

const crypto = require('crypto');

const ACCESS_MINUTES = 60;
const REFRESH_DAYS = 60;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function newSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// Thrown when the ApiToken table has not been created yet.
class TableMissing extends Error {
  constructor() {
    super('The ApiToken table does not exist. Run migrations/001_api_tokens.sql.');
    this.name = 'TableMissing';
  }
}

function create(options) {
  const con = options.con;
  const log = options.log || function () {};

  async function query(sql, values) {
    try {
      return await con.asyncQuery(sql, values);
    } catch (e) {
      if (e && e.code === 'ER_NO_SUCH_TABLE') { throw new TableMissing(); }
      throw e;
    }
  }

  // Start a signed-in session for a device.
  async function issue(uname, deviceName) {
    const accessToken = newSecret();
    const refreshToken = newSecret();
    const [result] = await query(
      'INSERT INTO ApiToken (uname, device_name, access_hash, access_expires, refresh_hash, refresh_expires, created_at, last_used_at) ' +
      'VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, DATE_ADD(NOW(), INTERVAL ? DAY), NOW(), NOW())',
      [uname, deviceName, sha256(accessToken), ACCESS_MINUTES, sha256(refreshToken), REFRESH_DAYS]);
    // forget sessions that expired long ago; failure here is not important
    query('DELETE FROM ApiToken WHERE refresh_expires < NOW()').catch(function (e) { log('api tokens: cleanup failed: ' + e.message); });
    return {
      tokenId: result.insertId,
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresIn: ACCESS_MINUTES * 60
    };
  }

  // The signed-in user for an access token, or null.
  async function authenticate(accessToken) {
    if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 200) { return null; }
    const [rows] = await query('SELECT token_id, uname FROM ApiToken WHERE access_hash = ? AND access_expires > NOW()', [sha256(accessToken)]);
    if (!rows || rows.length === 0) { return null; }
    // note when the device was last seen, at most every few minutes
    query('UPDATE ApiToken SET last_used_at = NOW() WHERE token_id = ? AND last_used_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)', [rows[0].token_id])
      .catch(function (e) { log('api tokens: could not record use: ' + e.message); });
    return { tokenId: rows[0].token_id, uname: rows[0].uname };
  }

  // Trade a refresh token for a new access token. The refresh token stays the
  // same and its 60 days start over, so a phone in regular use stays signed in.
  async function refresh(refreshToken) {
    if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 200) { return null; }
    const [rows] = await query('SELECT token_id, uname FROM ApiToken WHERE refresh_hash = ? AND refresh_expires > NOW()', [sha256(refreshToken)]);
    if (!rows || rows.length === 0) { return null; }
    const accessToken = newSecret();
    await query(
      'UPDATE ApiToken SET access_hash = ?, access_expires = DATE_ADD(NOW(), INTERVAL ? MINUTE), refresh_expires = DATE_ADD(NOW(), INTERVAL ? DAY), last_used_at = NOW() WHERE token_id = ?',
      [sha256(accessToken), ACCESS_MINUTES, REFRESH_DAYS, rows[0].token_id]);
    return { tokenId: rows[0].token_id, uname: rows[0].uname, accessToken: accessToken, expiresIn: ACCESS_MINUTES * 60 };
  }

  // Sign one device out. True if it existed (and belonged to this user).
  async function revoke(uname, tokenId) {
    const [result] = await query('DELETE FROM ApiToken WHERE token_id = ? AND uname = ?', [tokenId, uname]);
    return result.affectedRows > 0;
  }

  // Sign out every device, optionally keeping one.
  async function revokeAll(uname, exceptTokenId) {
    if (exceptTokenId === null || exceptTokenId === undefined) {
      await query('DELETE FROM ApiToken WHERE uname = ?', [uname]);
    } else {
      await query('DELETE FROM ApiToken WHERE uname = ? AND token_id <> ?', [uname, exceptTokenId]);
    }
  }

  async function list(uname) {
    const [rows] = await query('SELECT token_id, device_name, created_at, last_used_at FROM ApiToken WHERE uname = ? AND refresh_expires > NOW() ORDER BY last_used_at DESC', [uname]);
    return rows;
  }

  return { issue: issue, authenticate: authenticate, refresh: refresh, revoke: revoke, revokeAll: revokeAll, list: list };
}

module.exports = { create: create, TableMissing: TableMissing, ACCESS_MINUTES: ACCESS_MINUTES, REFRESH_DAYS: REFRESH_DAYS, sha256: sha256 };
