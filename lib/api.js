// The JSON API (/api/v1) for the mobile apps.
//
// Everything the website can do has an endpoint here. The handlers are plain
// functions: they take { body, params, query, ip, user } and return
// { status, body, headers } (or throw an ApiError). lib/apiRouter.js is the thin
// Express layer around them, which keeps the logic testable without a server.
// Authentication is a bearer token (lib/apiTokens.js); no cookies are used.
//
// The permission rules mirror the website: a list's owner can do everything, a
// person it is shared with can edit it (EDIT) or only look at it (VIEW).
'use strict';

const crypto = require('crypto');
const v = require('./validate');
const accounts = require('./accounts');

class ApiError extends Error {
  constructor(status, code, message, headers) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.headers = headers || {};
  }
}

function fail(status, code, message, headers) {
  throw new ApiError(status, code, message, headers);
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const USERNAME = /^[A-Za-z0-9._@+-]{1,50}$/;
const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';

function create(ctx) {
  const con = ctx.con;
  const passwords = ctx.passwords;
  const tokens = ctx.tokens;
  const limit = ctx.limiters;
  const config = ctx.config;
  const failureKeys = ctx.failureKeys;
  const log = ctx.log || function () {};

  const q = function (sql, values) { return con.asyncQuery(sql, values); };

  // ---- small helpers ------------------------------------------------------

  function tooMany(message, retryAfterSeconds) {
    return new ApiError(429, 'too_many_requests', message || TOO_MANY, { 'Retry-After': String(retryAfterSeconds || 900) });
  }

  function cleanName(value, label) {
    const s = v.asString(value).trim();
    if (!s || s.length > 100 || CONTROL_CHARS.test(s)) {
      fail(400, 'invalid_request', label + ' is required (up to 100 characters).');
    }
    return s;
  }

  function cleanColor(value) {
    let c = v.asString(value).trim();
    if (c.charAt(0) === '#') { c = c.slice(1); }
    if (!v.isHexColor(c)) {
      fail(400, 'invalid_request', 'color must be a hex colour such as "ff9900".');
    }
    return c;
  }

  function deviceName(value) {
    return v.asString(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || 'Unknown device';
  }

  function userView(row) {
    return { username: row.uname, firstName: row.fname, lastName: row.lname, email: row.email };
  }

  function signInView(user, session) {
    return {
      user: userView(user),
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresIn
    };
  }

  function listView(row, role) {
    return {
      id: row.list_id,
      name: row.list_name,
      color: row.listColor,
      owner: row.owner,
      role: role,
      lastChange: row.last_change === undefined ? null : row.last_change
    };
  }

  function itemView(row) {
    return {
      id: row.sItem_id,
      name: row.item_name,
      count: (row.number === null || row.number === undefined) ? null : Number(row.number),
      checked: row.checked == 1
    };
  }

  // A short fingerprint of everything the apps show for a list: its name, colour,
  // owner, the person's role and every item in order. It changes exactly when
  // what the person sees would change, whoever made the edit (the website, an
  // app, or a stored procedure), so apps can tell "nothing new" from "fetch it
  // again" without relying on timestamps.
  function revisionOf(row, role, itemRows) {
    const parts = [row.list_name, row.listColor, row.owner, role, itemRows.map(function (r) {
      const item = itemView(r);
      return [item.id, item.name, item.count, item.checked];
    })];
    return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
  }

  function roleFromShare(perms) {
    const p = String(perms).toUpperCase();
    return p === 'EDIT' ? 'edit' : (p === 'VIEW' ? 'view' : null);
  }

  // The list, and what this user may do with it. 404 when it does not exist or
  // is not theirs, so ids of other people's lists are not revealed.
  async function accessTo(user, rawId) {
    const id = v.toId(rawId);
    if (id === null) { fail(404, 'not_found', 'List not found.'); }
    const [lists] = await q('SELECT * FROM ShoppingList WHERE list_id = ?', [id]);
    if (lists.length === 0) { fail(404, 'not_found', 'List not found.'); }
    let role = null;
    if (lists[0].owner == user.uname) {
      role = 'owner';
    } else {
      const [shares] = await q('SELECT * FROM Shared_list WHERE list_id = ? AND share_user = ?', [id, user.uname]);
      if (shares[0]) { role = roleFromShare(shares[0].share_perms); }
    }
    if (!role) { fail(404, 'not_found', 'List not found.'); }
    return { id: id, list: lists[0], role: role };
  }

  function need(access, level) {
    if (level === 'owner' && access.role !== 'owner') {
      fail(403, 'forbidden', 'Only the owner of a list can do that.');
    }
    if (level === 'edit' && access.role === 'view') {
      fail(403, 'forbidden', 'You only have view access to this list.');
    }
  }

  async function loadItems(listId) {
    const [rows] = await q('SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item JOIN Item WHERE ShoppingList_Item.list_id = ? AND Item.item_id = ShoppingList_Item.item_id', [listId]);
    return rows;
  }

  // An item must be on the list named in the URL, so edit rights on one list
  // never reach an item on another.
  function findItem(rows, rawItemId) {
    const id = v.toId(rawItemId);
    const row = id === null ? null : rows.find(function (r) { return r.sItem_id == id; });
    if (!row) { fail(404, 'not_found', 'Item not found.'); }
    return row;
  }

  async function requireAccount(uname) {
    const [rows] = await q('SELECT * FROM User WHERE uname = ?', [uname]);
    if (rows.length === 0) { fail(401, 'unauthorized', 'Sign in required, or your session has expired.', { 'WWW-Authenticate': 'Bearer' }); }
    return rows[0];
  }

  async function findResetToken(token) {
    const [rows] = await q('SELECT * FROM PasswordResetToken NATURAL JOIN User WHERE token = ? AND PasswordResetToken.date_added > (NOW() - INTERVAL ' + v.RESET_TOKEN_HOURS + ' HOUR)', [token]);
    return rows;
  }

  // ---- authentication -----------------------------------------------------

  async function authenticate(headerValue) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(typeof headerValue === 'string' ? headerValue.trim() : '');
    const user = m ? await tokens.authenticate(m[1]) : null;
    if (!user) {
      fail(401, 'unauthorized', 'Sign in required, or your session has expired.', { 'WWW-Authenticate': 'Bearer' });
    }
    return user;
  }

  async function login(req) {
    const uname = v.asString(req.body.username);
    const password = v.asString(req.body.password);
    if (!uname || !password) { fail(400, 'invalid_request', 'username and password are required.'); }
    const keys = failureKeys(req.ip, uname);
    if (limit.failedPerUser.isLimited(keys.user) || limit.failedPerIp.isLimited(keys.ip)) {
      log('api login: too many failed attempts from ' + req.ip);
      throw tooMany();
    }
    const [users] = await q('SELECT * FROM User WHERE uname = ?', [uname]);
    const found = users.length > 0;
    // an unknown username takes as long to answer as a wrong password
    const result = await passwords.verify(password, found ? users[0].password : null);
    if (!(found && result.ok)) {
      limit.failedPerUser.hit(keys.user);
      limit.failedPerIp.hit(keys.ip);
      log('api login: failed for ' + JSON.stringify(uname.slice(0, 64)));
      fail(401, 'invalid_credentials', 'Invalid username or password.');
    }
    limit.failedPerUser.reset(keys.user);
    if (result.upgrade) {
      try {
        await ctx.updatePassword(users[0].uname, password);
      } catch (e) {
        log('api login: could not update the stored password for "' + users[0].uname + '": ' + e.message);
      }
    }
    const session = await tokens.issue(users[0].uname, deviceName(req.body.deviceName));
    return { body: signInView(users[0], session) };
  }

  async function register(req) {
    if (limit.registrations.isLimited(req.ip)) {
      throw tooMany('Too many sign-ups from this address. Please try again later.', 3600);
    }
    limit.registrations.hit(req.ip);
    const fname = cleanName(req.body.firstName, 'firstName');
    const lname = cleanName(req.body.lastName, 'lastName');
    const uname = v.asString(req.body.username);
    const email = v.asString(req.body.email).trim();
    const password = v.asString(req.body.password);
    if (!USERNAME.test(uname)) {
      fail(400, 'invalid_request', 'username must be 1 to 50 letters, numbers or . _ @ + -');
    }
    if (!v.isEmail(email)) { fail(400, 'invalid_request', 'Please enter a valid email address.'); }
    const problem = v.passwordProblem(password);
    if (problem) { fail(400, 'invalid_request', problem); }
    const [emailIn] = await q('SELECT uname FROM User WHERE email = ?', [email]);
    if (emailIn.length > 0) { fail(409, 'email_in_use', 'Email is already in use!'); }
    const [nameIn] = await q('SELECT uname FROM User WHERE uname = ?', [uname]);
    if (nameIn.length > 0 || await accounts.isRetired(con, uname)) { fail(409, 'username_taken', 'Username is already in use!'); }
    const hash = await passwords.hash(password);
    await q('INSERT INTO User (uname,fname,lname,email,password) VALUES (?,?,?,?,?)', [uname, fname, lname, email, hash]);
    const session = await tokens.issue(uname, deviceName(req.body.deviceName));
    return {
      status: 201,
      body: signInView({ uname: uname, fname: fname, lname: lname, email: email }, session)
    };
  }

  async function refresh(req) {
    const result = await tokens.refresh(v.asString(req.body.refreshToken));
    if (!result) { fail(401, 'invalid_refresh_token', 'Please sign in again.'); }
    return { body: { accessToken: result.accessToken, tokenType: 'Bearer', expiresIn: result.expiresIn } };
  }

  async function logout(req) {
    await tokens.revoke(req.user.uname, req.user.tokenId);
    return { status: 204 };
  }

  async function logoutEverywhere(req) {
    await tokens.revokeAll(req.user.uname, null);
    return { status: 204 };
  }

  async function listSessions(req) {
    const rows = await tokens.list(req.user.uname);
    return {
      body: {
        sessions: rows.map(function (r) {
          return {
            id: r.token_id,
            deviceName: r.device_name,
            createdAt: r.created_at,
            lastUsedAt: r.last_used_at,
            current: r.token_id == req.user.tokenId
          };
        })
      }
    };
  }

  async function deleteSession(req) {
    const id = v.toId(req.params.sessionId);
    const removed = id !== null && await tokens.revoke(req.user.uname, id);
    if (!removed) { fail(404, 'not_found', 'Session not found.'); }
    return { status: 204 };
  }

  // ---- password reset (the emailed link opens the website; these are for apps
  // that want to handle the link themselves) --------------------------------

  async function requestPasswordReset(req) {
    const email = v.asString(req.body.email).trim();
    // The answer is the same whether or not the address has an account, so this
    // cannot be used to find out who is registered.
    const limited = limit.resetRequests.isLimited(req.ip);
    limit.resetRequests.hit(req.ip);
    if (!limited && v.isEmail(email)) {
      const [users] = await q('SELECT * FROM User WHERE email = ?', [email]);
      if (users.length > 0) {
        const token = crypto.randomBytes(16).toString('hex');
        await q('DELETE FROM PasswordResetToken WHERE date_added <= (NOW() - INTERVAL ' + v.RESET_TOKEN_HOURS + ' HOUR)');
        await q('DELETE FROM PasswordResetToken WHERE uname = ?', [users[0].uname]);
        await q('INSERT INTO PasswordResetToken (uname,token,date_added) VALUES (?, ?, NOW())', [users[0].uname, token]);
        ctx.sendMail('reset', users[0].email, 'Password Reset - Lori\'s List', {
          name: users[0].fname + ' ' + users[0].lname,
          email: users[0].email,
          uname: users[0].uname,
          link: config.url + '/passwordReset/' + token
        });
      }
    }
    return { status: 202, body: { message: 'If that email address has an account, a reset link is on its way.' } };
  }

  async function checkResetToken(req) {
    const rows = await findResetToken(v.asString(req.params.token));
    if (rows.length === 0) { fail(404, 'not_found', 'This reset link is not valid any more.'); }
    return { status: 204 };
  }

  async function completePasswordReset(req) {
    const token = v.asString(req.params.token);
    const rows = await findResetToken(token);
    if (rows.length === 0) { fail(404, 'not_found', 'This reset link is not valid any more.'); }
    const password = v.asString(req.body.password);
    const problem = v.passwordProblem(password);
    if (problem) { fail(400, 'invalid_request', problem); }
    await ctx.updatePassword(rows[0].uname, password);
    await q('DELETE FROM PasswordResetToken WHERE uname = ?', [rows[0].uname]);
    // a new password signs the account out everywhere
    await tokens.revokeAll(rows[0].uname, null);
    return { status: 204 };
  }

  // ---- account ------------------------------------------------------------

  function meView(row) {
    return {
      username: row.uname,
      firstName: row.fname,
      lastName: row.lname,
      email: row.email,
      showTips: row.showAlert !== null && row.showAlert !== undefined && Number(row.showAlert) !== 0
    };
  }

  async function getMe(req) {
    return { body: { user: meView(await requireAccount(req.user.uname)) } };
  }

  async function updateMe(req) {
    const b = req.body;
    const sets = [];
    const values = [];
    if (b.firstName !== undefined) { sets.push('fname = ?'); values.push(cleanName(b.firstName, 'firstName')); }
    if (b.lastName !== undefined) { sets.push('lname = ?'); values.push(cleanName(b.lastName, 'lastName')); }
    if (b.email !== undefined) {
      const email = v.asString(b.email).trim();
      if (!v.isEmail(email)) { fail(400, 'invalid_request', 'Please enter a valid email address.'); }
      const [taken] = await q('SELECT uname FROM User WHERE email = ? AND uname <> ?', [email, req.user.uname]);
      if (taken.length > 0) { fail(409, 'email_in_use', 'The email you entered is already in use!'); }
      sets.push('email = ?');
      values.push(email);
    }
    if (b.showTips !== undefined) {
      if (typeof b.showTips !== 'boolean') { fail(400, 'invalid_request', 'showTips must be true or false.'); }
      sets.push('showAlert = ?');
      values.push(b.showTips ? 1 : 0);
    }
    if (sets.length === 0) {
      fail(400, 'invalid_request', 'Send at least one of firstName, lastName, email, showTips.');
    }
    values.push(req.user.uname);
    await q('UPDATE User SET ' + sets.join(', ') + ' WHERE uname = ?', values);
    return { body: { user: meView(await requireAccount(req.user.uname)) } };
  }

  async function changePassword(req) {
    const current = v.asString(req.body.currentPassword);
    const next = v.asString(req.body.newPassword);
    const keys = failureKeys(req.ip, req.user.uname);
    if (limit.failedPerUser.isLimited(keys.user) || limit.failedPerIp.isLimited(keys.ip)) { throw tooMany(); }
    const account = await requireAccount(req.user.uname);
    const check = await passwords.verify(current, account.password);
    if (!check.ok) {
      limit.failedPerUser.hit(keys.user);
      limit.failedPerIp.hit(keys.ip);
      fail(400, 'wrong_password', 'Your current password was not correct.');
    }
    const problem = v.passwordProblem(next);
    if (problem) { fail(400, 'invalid_request', problem); }
    limit.failedPerUser.reset(keys.user);
    await ctx.updatePassword(req.user.uname, next);
    // every other device has to sign in again with the new password
    await tokens.revokeAll(req.user.uname, req.user.tokenId);
    return { status: 204 };
  }

  // Deletes the account and everything in it (lib/accounts.js). Needs the
  // password, so a phone left unlocked or a stolen token cannot do it.
  async function deleteMe(req) {
    const password = v.asString(req.body.password);
    const keys = failureKeys(req.ip, req.user.uname);
    if (limit.failedPerUser.isLimited(keys.user) || limit.failedPerIp.isLimited(keys.ip)) { throw tooMany(); }
    const account = await requireAccount(req.user.uname);
    const check = await passwords.verify(password, account.password);
    if (!check.ok) {
      limit.failedPerUser.hit(keys.user);
      limit.failedPerIp.hit(keys.ip);
      fail(400, 'wrong_password', 'Your password was not correct.');
    }
    limit.failedPerUser.reset(keys.user);
    await accounts.deleteAccount(con, account);
    log('api: deleted the account "' + account.uname + '"');
    return { status: 204 };
  }

  // ---- colours and suggestions ---------------------------------------------

  async function listColors() {
    const [rows] = await q('SELECT * FROM colors');
    return { body: { colors: rows.map(function (r) { return { id: r.id, hex: r.hex, name: r['alt-text'] }; }) } };
  }

  async function itemSuggestions(req) {
    const [rows] = await q('SELECT * FROM Item WHERE Item.owner = ?', [req.user.uname]);
    const names = [];
    rows.forEach(function (r) { if (r.item_name && names.indexOf(r.item_name) === -1) { names.push(r.item_name); } });
    return { body: { suggestions: names } };
  }

  // ---- lists --------------------------------------------------------------

  async function getLists(req) {
    const [owned] = await q('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [req.user.uname]);
    const [shared] = await q('SELECT * FROM Shared_list NATURAL JOIN ShoppingList WHERE share_user = ?', [req.user.uname]);
    const lists = owned.map(function (r) { return listView(r, 'owner'); });
    shared.forEach(function (r) {
      const role = roleFromShare(r.share_perms);
      if (role) { lists.push(listView(r, role)); }
    });
    return { body: { lists: lists } };
  }

  async function createList(req) {
    const name = cleanName(req.body.name, 'name');
    const color = cleanColor(req.body.color);
    await q('CALL addList(?,?,?)', [name, req.user.uname, color]);
    const [mine] = await q('SELECT * FROM ShoppingList WHERE Owner = ? ORDER BY last_change DESC', [req.user.uname]);
    if (mine.length === 0) { fail(500, 'server_error', 'The list could not be created.'); }
    return { status: 201, body: { list: listView(mine[0], 'owner') } };
  }

  async function getList(req) {
    const access = await accessTo(req.user, req.params.id);
    const items = await loadItems(access.id);
    const list = listView(access.list, access.role);
    list.canEdit = access.role !== 'view';
    list.items = items.map(itemView);
    list.revision = revisionOf(access.list, access.role, items);
    return { body: { list: list } };
  }

  // Everything the person can see, as one small fingerprint per list. The apps
  // compare it with what they have stored and fetch only the lists that differ;
  // a list that is missing from it was deleted or is no longer shared.
  async function digestFor(user) {
    const [owned] = await q('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [user.uname]);
    const [shared] = await q('SELECT * FROM Shared_list NATURAL JOIN ShoppingList WHERE share_user = ?', [user.uname]);
    const visible = owned.map(function (r) { return { row: r, role: 'owner' }; });
    shared.forEach(function (r) {
      const role = roleFromShare(r.share_perms);
      if (role) { visible.push({ row: r, role: role }); }
    });
    visible.sort(function (a, b) { return a.row.list_id - b.row.list_id; });
    const lists = [];
    for (const entry of visible) {
      lists.push({ id: entry.row.list_id, revision: revisionOf(entry.row, entry.role, await loadItems(entry.row.list_id)) });
    }
    const revision = crypto.createHash('sha1').update(JSON.stringify(lists)).digest('hex').slice(0, 16);
    return { revision: revision, lists: lists };
  }

  async function getChanges(req) {
    return { body: await digestFor(req.user) };
  }

  async function updateList(req) {
    const access = await accessTo(req.user, req.params.id);
    need(access, 'owner');
    if (req.body.name === undefined && req.body.color === undefined) {
      fail(400, 'invalid_request', 'Send name, color, or both.');
    }
    const name = req.body.name === undefined ? access.list.list_name : cleanName(req.body.name, 'name');
    const color = req.body.color === undefined ? access.list.listColor : cleanColor(req.body.color);
    await q('CALL editList(?,?,?)', [access.id, name, color]);
    const [rows] = await q('SELECT * FROM ShoppingList WHERE list_id = ?', [access.id]);
    return { body: { list: listView(rows[0] || access.list, 'owner') } };
  }

  async function deleteList(req) {
    const access = await accessTo(req.user, req.params.id);
    need(access, 'owner');
    await q('CALL deleteList(?)', [access.id]);
    return { status: 204 };
  }

  async function leaveList(req) {
    const access = await accessTo(req.user, req.params.id);
    if (access.role === 'owner') {
      fail(400, 'invalid_request', 'You own this list. Delete it instead of leaving it.');
    }
    await q('DELETE FROM Shared_list WHERE list_id = ? AND share_user = ?', [access.id, req.user.uname]);
    return { status: 204 };
  }

  // ---- items --------------------------------------------------------------

  async function addItem(req) {
    const access = await accessTo(req.user, req.params.id);
    need(access, 'edit');
    const name = v.asString(req.body.name).trim();
    if (!name || name.length > 100 || CONTROL_CHARS.test(name)) {
      fail(400, 'invalid_request', 'name is required (up to 100 characters).');
    }
    let count = null;
    if (req.body.count !== undefined && req.body.count !== null) {
      count = v.parseCount(req.body.count);
      if (count === null) { fail(400, 'invalid_request', 'count must be a whole number above zero.'); }
    }
    await q('CALL addShoppingItem(?,?,?,?)', [req.user.uname, access.id, count, name]);
    const items = await loadItems(access.id);
    return { status: 201, body: { items: items.map(itemView) } };
  }

  async function setItemChecked(req) {
    const access = await accessTo(req.user, req.params.id);
    need(access, 'edit');
    if (typeof req.body.checked !== 'boolean') { fail(400, 'invalid_request', 'checked must be true or false.'); }
    const item = findItem(await loadItems(access.id), req.params.itemId);
    await q('CALL setChecked(?,?)', [item.sItem_id, req.body.checked ? 1 : 0]);
    return { body: { id: item.sItem_id, checked: req.body.checked } };
  }

  async function deleteItem(req) {
    const access = await accessTo(req.user, req.params.id);
    need(access, 'edit');
    const item = findItem(await loadItems(access.id), req.params.itemId);
    await q('CALL deleteShoppingItem(?, ?)', [item.sItem_id, access.id]);
    return { status: 204 };
  }

  async function clearChecked(req) {
    const access = await accessTo(req.user, req.params.id);
    need(access, 'edit');
    if (req.query.checked !== 'true') {
      fail(400, 'invalid_request', 'Add ?checked=true to remove the crossed-off items.');
    }
    const checked = (await loadItems(access.id)).filter(function (r) { return r.checked == 1; });
    for (const row of checked) {
      await q('CALL deleteShoppingItem(?, ?)', [row.sItem_id, access.id]);
    }
    return { body: { deleted: checked.length } };
  }

  // ---- sharing ------------------------------------------------------------

  async function createShare(req) {
    const access = await accessTo(req.user, req.params.id);
    need(access, 'owner');
    const email = v.asString(req.body.email).trim().toLowerCase();
    const permission = v.asString(req.body.permission).toLowerCase();
    const perms = permission === 'edit' ? 'EDIT' : (permission === 'view' ? 'VIEW' : null);
    if (!perms) { fail(400, 'invalid_request', 'permission must be "edit" or "view".'); }
    if (!v.isEmail(email)) { fail(400, 'invalid_request', 'Please enter a valid email address.'); }
    if (limit.shareRequests.isLimited(req.user.uname)) {
      throw tooMany('You have shared a lot of lists recently. Please try again in a while.', 3600);
    }
    limit.shareRequests.hit(req.user.uname);
    const shareKey = crypto.randomBytes(16).toString('hex');
    await q(`INSERT INTO share_pending (share_key,list_id,list_owner,share_email,share_perms) VALUES(?,?,?,?,?)
                ON DUPLICATE KEY UPDATE share_key = ?, list_id = ?, list_owner = ?, share_email = ?, share_perms = ?`,
      [shareKey, access.id, req.user.uname, email, perms, shareKey, access.id, req.user.uname, email, perms]);
    const [people] = await q('SELECT DISTINCT * FROM User WHERE email = ?', [email]);
    const person = people[0];
    ctx.sendMail('share', email, req.user.uname + ' would like to share a list with you - Lori\'s List', {
      uname: req.user.uname,
      share_user: person ? { fname: person.fname, lname: person.lname } : undefined,
      perms: perms,
      list: access.list.list_name,
      list_name: access.list.list_name,
      link: config.url + '/share/' + shareKey,
      register_link: config.url + '/register'
    });
    return { status: 202, body: { message: 'Invitation sent.' } };
  }

  async function getShare(req) {
    const key = v.asString(req.params.key);
    const [pending] = await q('SELECT DISTINCT * FROM share_pending WHERE share_key = ?', [key]);
    if (pending.length === 0) { fail(404, 'not_found', 'This invitation was not found.'); }
    const [lists] = await q('SELECT * FROM ShoppingList WHERE list_id = ?', [pending[0].list_id]);
    if (lists.length === 0) { fail(404, 'not_found', 'This invitation was not found.'); }
    return {
      body: {
        share: {
          key: key,
          permission: roleFromShare(pending[0].share_perms),
          list: { id: lists[0].list_id, name: lists[0].list_name, color: lists[0].listColor, owner: lists[0].owner }
        }
      }
    };
  }

  async function answerShare(req) {
    const key = v.asString(req.params.key);
    const response = v.asString(req.body.response).toLowerCase();
    if (response !== 'accept' && response !== 'deny') {
      fail(400, 'invalid_request', 'response must be "accept" or "deny".');
    }
    const [pending] = await q('SELECT DISTINCT * FROM share_pending WHERE share_key = ?', [key]);
    if (pending.length === 0) { fail(404, 'not_found', 'This invitation was not found.'); }
    const share = pending[0];
    const [lists] = await q('SELECT * FROM ShoppingList WHERE list_id = ?', [share.list_id]);
    const forget = function () { return q('DELETE FROM share_pending WHERE share_key = ?', [key]); };
    if (lists.length === 0) {
      await forget();
      fail(404, 'not_found', 'This invitation was not found.');
    }
    if (response === 'deny') {
      await forget();
      return { status: 204 };
    }
    if (lists[0].owner == req.user.uname) {
      await forget();
      fail(400, 'invalid_request', 'You already own this list.');
    }
    const [existing] = await q('SELECT * FROM Shared_list WHERE list_id = ? AND share_user = ?', [share.list_id, req.user.uname]);
    let role;
    if (existing.length > 0) {
      role = roleFromShare(existing[0].share_perms);
    } else {
      await q('INSERT INTO Shared_list (list_id,share_user,share_perms) VALUES (?,?,?)', [share.list_id, req.user.uname, share.share_perms]);
      role = roleFromShare(share.share_perms);
    }
    await forget();
    return { body: { list: listView(lists[0], role) } };
  }

  // ---- the route table ----------------------------------------------------

  const routes = [
    { method: 'get', path: '/', auth: false, handler: async function () { return { body: { name: 'Lori\'s List API', version: 1 } }; } },

    { method: 'post', path: '/auth/login', auth: false, handler: login },
    { method: 'post', path: '/auth/register', auth: false, handler: register },
    { method: 'post', path: '/auth/refresh', auth: false, handler: refresh },
    { method: 'post', path: '/auth/logout', auth: true, handler: logout },
    { method: 'post', path: '/auth/logout-everywhere', auth: true, handler: logoutEverywhere },
    { method: 'get', path: '/auth/sessions', auth: true, handler: listSessions },
    { method: 'delete', path: '/auth/sessions/:sessionId', auth: true, handler: deleteSession },
    { method: 'post', path: '/auth/password-reset', auth: false, handler: requestPasswordReset },
    { method: 'get', path: '/auth/password-reset/:token', auth: false, handler: checkResetToken },
    { method: 'put', path: '/auth/password-reset/:token', auth: false, handler: completePasswordReset },

    { method: 'get', path: '/me', auth: true, handler: getMe },
    { method: 'patch', path: '/me', auth: true, handler: updateMe },
    { method: 'delete', path: '/me', auth: true, handler: deleteMe },
    { method: 'put', path: '/me/password', auth: true, handler: changePassword },

    { method: 'get', path: '/colors', auth: true, handler: listColors },
    { method: 'get', path: '/items/suggestions', auth: true, handler: itemSuggestions },

    { method: 'get', path: '/changes', auth: true, handler: getChanges },
    // Server-sent events: lib/apiEvents.js answers this one (it streams), so it has no handler here.
    { method: 'get', path: '/events', auth: true, stream: true, handler: null },

    { method: 'get', path: '/lists', auth: true, handler: getLists },
    { method: 'post', path: '/lists', auth: true, handler: createList },
    { method: 'get', path: '/lists/:id', auth: true, handler: getList },
    { method: 'patch', path: '/lists/:id', auth: true, handler: updateList },
    { method: 'delete', path: '/lists/:id', auth: true, handler: deleteList },
    { method: 'delete', path: '/lists/:id/members/me', auth: true, handler: leaveList },

    { method: 'post', path: '/lists/:id/items', auth: true, handler: addItem },
    { method: 'delete', path: '/lists/:id/items', auth: true, handler: clearChecked },
    { method: 'patch', path: '/lists/:id/items/:itemId', auth: true, handler: setItemChecked },
    { method: 'delete', path: '/lists/:id/items/:itemId', auth: true, handler: deleteItem },

    { method: 'post', path: '/lists/:id/shares', auth: true, handler: createShare },
    { method: 'get', path: '/shares/:key', auth: true, handler: getShare },
    { method: 'post', path: '/shares/:key', auth: true, handler: answerShare }
  ];

  // Turn anything thrown by a handler into an ApiError.
  function describeError(e) {
    if (e instanceof ApiError) { return e; }
    if (e && e.name === 'TableMissing') {
      log('api: ' + e.message);
      return new ApiError(503, 'api_not_ready', 'The API is not set up on this server yet.');
    }
    log('api error: ' + ((e && e.stack) || e));
    return new ApiError(500, 'server_error', 'Something went wrong. Please try again.');
  }

  return { routes: routes, authenticate: authenticate, describeError: describeError, digestFor: digestFor, tooMany: tooMany };
}

module.exports = { create: create, ApiError: ApiError };
