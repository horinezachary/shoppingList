// An in-memory stand-in for the MySQL database, for tests only. It understands
// exactly the statements lib/api.js and lib/apiTokens.js send and throws on
// anything else, so a change to the SQL that the tests do not cover shows up as
// a failure instead of being silently ignored. Time is a fake clock.
'use strict';

function create() {
  const state = {
    now: Date.UTC(2026, 9, 16, 12, 0, 0),
    users: [],
    lists: [],
    shares: [],      // { list_id, share_user, share_perms }
    items: [],       // { sItem_id, item_id, list_id, item_name, number, checked, owner }
    pending: [],     // share_pending rows
    resets: [],      // { uname, token, added }
    tokens: [],      // ApiToken rows
    suggestions: [], // Item rows that are on no list any more: { item_id, item_name, owner }
    retired: [],     // DeletedAccount uname_hash values
    failOn: null,    // a statement prefix that throws, to test rollbacks
    colors: [{ id: 1, hex: 'ff9900', 'alt-text': 'Orange' }, { id: 2, hex: '3366cc', 'alt-text': 'Blue' }],
    nextList: 1,
    nextItem: 1,
    nextToken: 1,
    log: []
  };
  const HOUR = 3600 * 1000;

  const rows = (list) => [list, []];
  const done = (extra) => [Object.assign({ affectedRows: 0 }, extra), []];
  const lower = (s) => String(s).toLowerCase();

  function listById(id) { return state.lists.find((l) => l.list_id == id); }

  async function asyncQuery(sql, p) {
    const n = sql.replace(/\s+/g, ' ').trim();
    state.log.push(n);
    p = p || [];
    const is = (prefix) => n.startsWith(prefix);
    if (state.failOn && is(state.failOn)) { throw new Error('fakeDb: failing on purpose'); }

    // ---- users ----
    if (is('SELECT * FROM User WHERE uname = ?')) { return rows(state.users.filter((u) => lower(u.uname) === lower(p[0]))); }
    if (is('SELECT uname FROM User WHERE email = ? AND uname <> ?')) { return rows(state.users.filter((u) => lower(u.email) === lower(p[0]) && u.uname !== p[1])); }
    if (is('SELECT uname FROM User WHERE email = ?')) { return rows(state.users.filter((u) => lower(u.email) === lower(p[0]))); }
    if (is('SELECT uname FROM User WHERE uname = ?')) { return rows(state.users.filter((u) => lower(u.uname) === lower(p[0]))); }
    if (is('SELECT * FROM User WHERE email = ?') || is('SELECT DISTINCT * FROM User WHERE email = ?')) { return rows(state.users.filter((u) => lower(u.email) === lower(p[0]))); }
    if (is('INSERT INTO User (uname,fname,lname,email,password) VALUES (?,?,?,?,?)')) {
      state.users.push({ uname: p[0], fname: p[1], lname: p[2], email: p[3], password: p[4], showAlert: 1 });
      return done({ affectedRows: 1 });
    }
    let m = /^UPDATE User SET (.+) WHERE uname = \?$/.exec(n);
    if (m) {
      const user = state.users.find((u) => u.uname === p[p.length - 1]);
      m[1].split(', ').forEach((assignment, i) => {
        const column = assignment.replace(/ = \?$/, '');
        if (!/^[A-Za-z_]+$/.test(column)) { throw new Error('fakeDb: odd column ' + column); }
        user[column] = p[i];
      });
      return done({ affectedRows: user ? 1 : 0 });
    }

    // ---- lists, items, sharing ----
    if (is('SELECT * FROM ShoppingList WHERE list_id = ?')) { return rows(state.lists.filter((l) => l.list_id == p[0])); }
    if (is('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?')) { return rows(state.lists.filter((l) => l.owner === p[0])); }
    if (is('SELECT * FROM ShoppingList WHERE Owner = ? ORDER BY last_change DESC')) {
      return rows(state.lists.filter((l) => l.owner === p[0]).sort((a, b) => b.last_change - a.last_change));
    }
    if (is('SELECT * FROM Shared_list WHERE list_id = ? AND share_user = ?')) { return rows(state.shares.filter((s) => s.list_id == p[0] && s.share_user === p[1])); }
    if (is('SELECT * FROM Shared_list NATURAL JOIN ShoppingList WHERE share_user = ?')) {
      return rows(state.shares.filter((s) => s.share_user === p[0]).map((s) => Object.assign({}, listById(s.list_id), s)));
    }
    if (is('INSERT INTO Shared_list (list_id,share_user,share_perms) VALUES (?,?,?)')) {
      state.shares.push({ list_id: p[0], share_user: p[1], share_perms: p[2] });
      return done({ affectedRows: 1 });
    }
    if (is('DELETE FROM Shared_list WHERE list_id = ? AND share_user = ?')) {
      const before = state.shares.length;
      state.shares = state.shares.filter((s) => !(s.list_id == p[0] && s.share_user === p[1]));
      return done({ affectedRows: before - state.shares.length });
    }
    if (is('SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item JOIN Item WHERE ShoppingList_Item.list_id = ?')) {
      return rows(state.items.filter((i) => i.list_id == p[0]).map((i) => Object.assign({}, i)));
    }
    if (is('SELECT * FROM Item WHERE Item.owner = ?')) { return rows(state.items.filter((i) => i.owner === p[0])); }
    if (is('SELECT * FROM colors')) { return rows(state.colors); }
    if (is('SELECT list_id FROM ShoppingList WHERE ShoppingList.owner = ?')) {
      return rows(state.lists.filter((l) => l.owner === p[0]).map((l) => ({ list_id: l.list_id })));
    }
    if (is('DELETE FROM Shared_list WHERE share_user = ?')) {
      state.shares = state.shares.filter((s) => s.share_user !== p[0]);
      return done();
    }
    if (is('DELETE FROM Item WHERE Item.owner = ? AND NOT EXISTS (SELECT 1 FROM ShoppingList_Item WHERE ShoppingList_Item.item_id = Item.item_id)')) {
      state.suggestions = state.suggestions.filter((i) => i.owner !== p[0]);
      return done();
    }

    // ---- deleted accounts ----
    if (is('DELETE FROM User WHERE uname = ?')) {
      state.users = state.users.filter((u) => u.uname !== p[0]);
      return done({ affectedRows: 1 });
    }
    if (is('INSERT IGNORE INTO DeletedAccount (uname_hash, deleted_at) VALUES (?, NOW())')) {
      if (!state.retired.includes(p[0])) { state.retired.push(p[0]); }
      return done({ affectedRows: 1 });
    }
    if (is('SELECT uname_hash FROM DeletedAccount WHERE uname_hash = ?')) {
      return rows(state.retired.filter((h) => h === p[0]).map((h) => ({ uname_hash: h })));
    }

    // stored procedures
    if (is('CALL addList(?,?,?)')) {
      state.now += 1000;
      state.lists.push({ list_id: state.nextList++, list_name: p[0], owner: p[1], listColor: p[2], last_change: state.now });
      return rows([]);
    }
    if (is('CALL editList(?,?,?)')) {
      const l = listById(p[0]);
      if (l) { l.list_name = p[1]; l.listColor = p[2]; }
      return rows([]);
    }
    if (is('CALL deleteList(?)')) {
      state.lists = state.lists.filter((l) => l.list_id != p[0]);
      state.items = state.items.filter((i) => i.list_id != p[0]);
      state.shares = state.shares.filter((s) => s.list_id != p[0]);
      return rows([]);
    }
    if (is('CALL addShoppingItem(?,?,?,?)')) {
      const id = state.nextItem++;
      state.items.push({ sItem_id: id, item_id: 1000 + id, list_id: p[1], item_name: p[3], number: p[2], checked: 0, owner: p[0] });
      return rows([]);
    }
    if (is('CALL setChecked(?,?)')) {
      const i = state.items.find((x) => x.sItem_id == p[0]);
      if (i) { i.checked = p[1]; }
      return rows([]);
    }
    if (is('CALL deleteShoppingItem(?, ?)')) {
      state.items = state.items.filter((i) => !(i.sItem_id == p[0] && i.list_id == p[1]));
      return rows([]);
    }

    // ---- pending shares ----
    if (is('INSERT INTO share_pending')) {
      state.pending = state.pending.filter((s) => !(s.list_id == p[1] && s.share_email === p[3]));
      state.pending.push({ share_key: p[0], list_id: p[1], list_owner: p[2], share_email: p[3], share_perms: p[4] });
      return done({ affectedRows: 1 });
    }
    if (is('SELECT DISTINCT * FROM share_pending WHERE share_key = ?')) { return rows(state.pending.filter((s) => s.share_key === p[0])); }
    if (is('DELETE FROM share_pending WHERE list_owner = ? OR share_email = ?')) {
      state.pending = state.pending.filter((s) => !(s.list_owner === p[0] || lower(s.share_email) === lower(p[1])));
      return done();
    }
    if (is('DELETE FROM share_pending WHERE share_key = ?')) {
      state.pending = state.pending.filter((s) => s.share_key !== p[0]);
      return done({ affectedRows: 1 });
    }

    // ---- password reset links ----
    if (is('SELECT * FROM PasswordResetToken NATURAL JOIN User WHERE token = ?')) {
      const hours = Number(/INTERVAL (\d+) HOUR/.exec(n)[1]);
      return rows(state.resets
        .filter((r) => r.token === p[0] && r.added > state.now - hours * HOUR)
        .map((r) => Object.assign({}, state.users.find((u) => u.uname === r.uname), r)));
    }
    if (is('DELETE FROM PasswordResetToken WHERE date_added <= ')) {
      const hours = Number(/INTERVAL (\d+) HOUR/.exec(n)[1]);
      state.resets = state.resets.filter((r) => r.added > state.now - hours * HOUR);
      return done();
    }
    if (is('DELETE FROM PasswordResetToken WHERE uname = ?')) {
      state.resets = state.resets.filter((r) => r.uname !== p[0]);
      return done();
    }
    if (is('INSERT INTO PasswordResetToken (uname,token,date_added) VALUES (?, ?, NOW())')) {
      state.resets.push({ uname: p[0], token: p[1], added: state.now });
      return done({ affectedRows: 1 });
    }

    // ---- API sign-in tokens ----
    if (is('INSERT INTO ApiToken')) {
      const row = {
        token_id: state.nextToken++, uname: p[0], device_name: p[1],
        access_hash: p[2], access_expires: state.now + p[3] * 60000,
        refresh_hash: p[4], refresh_expires: state.now + p[5] * 24 * HOUR,
        created_at: new Date(state.now), last_used_at: state.now
      };
      state.tokens.push(row);
      return done({ affectedRows: 1, insertId: row.token_id });
    }
    if (is('DELETE FROM ApiToken WHERE refresh_expires < NOW()')) {
      state.tokens = state.tokens.filter((t) => t.refresh_expires >= state.now);
      return done();
    }
    if (is('SELECT token_id, uname FROM ApiToken WHERE access_hash = ?')) {
      return rows(state.tokens.filter((t) => t.access_hash === p[0] && t.access_expires > state.now));
    }
    if (is('SELECT token_id, uname FROM ApiToken WHERE refresh_hash = ?')) {
      return rows(state.tokens.filter((t) => t.refresh_hash === p[0] && t.refresh_expires > state.now));
    }
    if (is('UPDATE ApiToken SET last_used_at = NOW() WHERE token_id = ?')) {
      const t = state.tokens.find((x) => x.token_id == p[0]);
      if (t && t.last_used_at < state.now - 5 * 60000) { t.last_used_at = state.now; }
      return done({ affectedRows: 1 });
    }
    if (is('UPDATE ApiToken SET access_hash = ?')) {
      const t = state.tokens.find((x) => x.token_id == p[3]);
      t.access_hash = p[0];
      t.access_expires = state.now + p[1] * 60000;
      t.refresh_expires = state.now + p[2] * 24 * HOUR;
      t.last_used_at = state.now;
      return done({ affectedRows: 1 });
    }
    if (is('DELETE FROM ApiToken WHERE token_id = ? AND uname = ?')) {
      const before = state.tokens.length;
      state.tokens = state.tokens.filter((t) => !(t.token_id == p[0] && t.uname === p[1]));
      return done({ affectedRows: before - state.tokens.length });
    }
    if (is('DELETE FROM ApiToken WHERE uname = ? AND token_id <> ?')) {
      state.tokens = state.tokens.filter((t) => !(t.uname === p[0] && t.token_id != p[1]));
      return done();
    }
    if (is('DELETE FROM ApiToken WHERE uname = ?')) {
      state.tokens = state.tokens.filter((t) => t.uname !== p[0]);
      return done();
    }
    if (is('SELECT token_id, device_name, created_at, last_used_at FROM ApiToken WHERE uname = ?')) {
      return rows(state.tokens
        .filter((t) => t.uname === p[0] && t.refresh_expires > state.now)
        .sort((a, b) => b.last_used_at - a.last_used_at)
        .map((t) => ({ token_id: t.token_id, device_name: t.device_name, created_at: t.created_at, last_used_at: new Date(t.last_used_at) })));
    }

    throw new Error('fakeDb: unhandled SQL: ' + n);
  }

  // Like the real one: everything work() does is undone if it throws.
  async function transaction(work) {
    const saved = structuredClone(Object.assign({}, state, { log: [] }));
    try {
      return await work(asyncQuery);
    } catch (e) {
      Object.assign(state, saved, { log: state.log });
      throw e;
    }
  }

  return { asyncQuery: asyncQuery, transaction: transaction, state: state };
}

module.exports = { create: create };
