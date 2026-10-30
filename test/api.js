// Tests for the JSON API (lib/api.js, lib/apiTokens.js) against an in-memory
// database (test/fakeDb.js). They call the handlers directly, the way the
// Express layer does, so no packages or database are needed. "npm test" runs
// this before the smoke test.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const passwordsLib = require('../lib/passwords');
const apiTokens = require('../lib/apiTokens');
const apiLib = require('../lib/api');
const { createLimiter, failureKeys } = require('../lib/rateLimit');
const fakeDb = require('./fakeDb');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + ((e && e.stack) || e).toString().split('\n').slice(0, 4).join('\n       '));
  }
}

const quote = (v) => "'" + v + "'";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// a stand-in for bcrypt: "hash" is h$ + password
const fakeBcrypt = {
  hash: async (pw) => 'h$' + pw,
  compare: async (pw, stored) => {
    if (typeof stored !== 'string') { throw new Error('Illegal arguments'); }
    return stored === 'h$' + pw;
  }
};

function harness() {
  const db = fakeDb.create();
  const clock = () => db.state.now;
  const mail = [];
  const logs = [];
  const updated = [];
  const passwords = passwordsLib.create({ bcrypt: fakeBcrypt, escape: quote, rounds: 10, log: () => {} });
  const tokens = apiTokens.create({ con: db, log: () => {} });
  const limiters = {
    failedPerUser: createLimiter({ max: 5, windowMs: 15 * MINUTE, now: clock }),
    failedPerIp: createLimiter({ max: 30, windowMs: 15 * MINUTE, now: clock }),
    resetRequests: createLimiter({ max: 5, windowMs: HOUR, now: clock }),
    shareRequests: createLimiter({ max: 20, windowMs: HOUR, now: clock }),
    registrations: createLimiter({ max: 10, windowMs: HOUR, now: clock })
  };
  const api = apiLib.create({
    con: db,
    passwords: passwords,
    tokens: tokens,
    config: { url: 'https://lorislist.example' },
    limiters: limiters,
    failureKeys: failureKeys,
    updatePassword: async (uname, pw) => {
      updated.push(uname);
      db.state.users.find((u) => u.uname === uname).password = await passwords.hash(pw);
    },
    sendMail: (template, to, subject, context) => { mail.push({ template: template, to: to, subject: subject, context: context }); },
    log: (m) => logs.push(m)
  });

  // call a route the way lib/apiRouter.js does
  async function call(method, route, opts) {
    opts = opts || {};
    const def = api.routes.find((r) => r.method === method && r.path === route);
    if (!def) { throw new Error('no such route: ' + method + ' ' + route); }
    try {
      const header = opts.token ? 'Bearer ' + opts.token : opts.header;
      const user = def.auth ? await api.authenticate(header) : null;
      const out = await def.handler({ body: opts.body || {}, params: opts.params || {}, query: opts.query || {}, ip: opts.ip || '198.51.100.1', user: user });
      return { status: out.status || 200, body: out.body, headers: out.headers || {} };
    } catch (e) {
      const err = api.describeError(e);
      return { status: err.status, body: { error: { code: err.code, message: err.message } }, headers: err.headers };
    }
  }

  async function addUser(name, options) {
    options = options || {};
    db.state.users.push({
      uname: name, fname: name[0].toUpperCase() + name.slice(1), lname: 'Test', email: name + '@example.com',
      password: options.legacy ? await passwords.hash(quote('password123')) : await passwords.hash('password123'),
      showAlert: 1
    });
  }

  async function signIn(name, device) {
    const r = await call('post', '/auth/login', { body: { username: name, password: 'password123', deviceName: device || 'Test phone' }, ip: '192.0.2.' + (name.length + 10) });
    assert.strictEqual(r.status, 200, 'sign in as ' + name + ': ' + JSON.stringify(r.body));
    return r.body;
  }

  // a user, signed in
  async function member(name) {
    await addUser(name);
    const s = await signIn(name);
    return { name: name, token: s.accessToken, refresh: s.refreshToken };
  }

  return { db: db, api: api, call: call, mail: mail, logs: logs, updated: updated, limiters: limiters, addUser: addUser, signIn: signIn, member: member, passwords: passwords, tokens: tokens };
}

async function main() {
  console.log('route table');
  await check('every route has a method, a path and a handler, and none is listed twice', () => {
    const h = harness();
    const seen = new Set();
    h.api.routes.forEach((r) => {
      assert(['get', 'post', 'put', 'patch', 'delete'].includes(r.method), r.path);
      assert(r.path.startsWith('/'), r.path);
      assert(r.stream || typeof r.handler === 'function', r.path);
      assert.strictEqual(typeof r.auth, 'boolean', r.path);
      const key = r.method + ' ' + r.path;
      assert(!seen.has(key), 'duplicate ' + key);
      seen.add(key);
    });
  });
  await check('docs/openapi.yaml documents exactly the routes that exist', () => {
    const h = harness();
    const text = fs.readFileSync(path.join(__dirname, '..', 'docs', 'openapi.yaml'), 'utf8');
    const documented = new Set();
    let current = null;
    text.split('\n').forEach((line) => {
      let m = /^  (\/[^\s:]*):\s*$/.exec(line);
      if (m) { current = m[1]; return; }
      m = /^    (get|post|put|patch|delete):\s*$/.exec(line);
      if (m && current) { documented.add(m[1] + ' ' + current); }
      if (/^\S/.test(line)) { current = null; }
    });
    const actual = new Set(h.api.routes.map((r) => r.method + ' ' + (r.path === '/' ? '/' : r.path.replace(/:(\w+)/g, '{$1}'))));
    const missing = [...actual].filter((x) => !documented.has(x));
    const extra = [...documented].filter((x) => !actual.has(x));
    assert.deepStrictEqual({ missing: missing, extra: extra }, { missing: [], extra: [] });
  });

  console.log('signing in');
  await check('login returns tokens and the user, and never anything password-like', async () => {
    const h = harness();
    await h.addUser('zed');
    const r = await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123', deviceName: 'Pixel 9' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.tokenType, 'Bearer');
    assert.strictEqual(r.body.expiresIn, 3600);
    assert(r.body.accessToken.length >= 40 && r.body.refreshToken.length >= 40);
    assert.notStrictEqual(r.body.accessToken, r.body.refreshToken);
    assert.deepStrictEqual(r.body.user, { username: 'zed', firstName: 'Zed', lastName: 'Test', email: 'zed@example.com' });
    assert(!JSON.stringify(r.body).includes('h$'), 'a password hash leaked');
    assert.strictEqual(h.db.state.tokens[0].device_name, 'Pixel 9');
  });
  await check('only hashes of the tokens are stored', async () => {
    const h = harness();
    await h.addUser('zed');
    const s = await h.signIn('zed');
    const row = h.db.state.tokens[0];
    assert.strictEqual(row.access_hash, apiTokens.sha256(s.accessToken));
    assert.strictEqual(row.refresh_hash, apiTokens.sha256(s.refreshToken));
    assert(!JSON.stringify(row).includes(s.accessToken) && !JSON.stringify(row).includes(s.refreshToken));
  });
  await check('a wrong password and an unknown user get the same answer', async () => {
    const h = harness();
    await h.addUser('zed');
    const a = await h.call('post', '/auth/login', { body: { username: 'zed', password: 'nope-nope' } });
    const b = await h.call('post', '/auth/login', { body: { username: 'nobody', password: 'nope-nope' } });
    assert.strictEqual(a.status, 401);
    assert.deepStrictEqual(a.body, b.body);
    assert.strictEqual(a.body.error.code, 'invalid_credentials');
  });
  await check('missing fields are a 400', async () => {
    const h = harness();
    assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed' } })).status, 400);
  });
  await check('an account in the older password form can sign in and is re-hashed', async () => {
    const h = harness();
    await h.addUser('lori', { legacy: true });
    const r = await h.call('post', '/auth/login', { body: { username: 'lori', password: 'password123' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(h.updated, ['lori']);
    assert.strictEqual(h.db.state.users[0].password, 'h$password123');
  });
  await check('five wrong passwords lock that address and username out for a while', async () => {
    const h = harness();
    await h.addUser('zed');
    for (let i = 0; i < 5; i++) {
      assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed', password: 'wrong-' + i } })).status, 401);
    }
    const blocked = await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123' } });
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.headers['Retry-After'], '900');
    // another address is not affected
    assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123' }, ip: '203.0.113.77' })).status, 200);
    h.db.state.now += 16 * MINUTE;
    assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123' } })).status, 200);
  });

  console.log('tokens');
  await check('requests need a valid bearer token', async () => {
    const h = harness();
    const none = await h.call('get', '/me');
    assert.strictEqual(none.status, 401);
    assert.strictEqual(none.headers['WWW-Authenticate'], 'Bearer');
    assert.strictEqual((await h.call('get', '/me', { token: 'x'.repeat(43) })).status, 401);
    assert.strictEqual((await h.call('get', '/me', { header: 'Basic abc' })).status, 401);
    assert.strictEqual((await h.call('get', '/me', { header: 'Bearer ' })).status, 401);
  });
  await check('an access token works for an hour, then the refresh token gets a new one', async () => {
    const h = harness();
    const zed = await h.member('zed');
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 200);
    h.db.state.now += 61 * MINUTE;
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 401);
    const r = await h.call('post', '/auth/refresh', { body: { refreshToken: zed.refresh } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.expiresIn, 3600);
    assert.strictEqual((await h.call('get', '/me', { token: r.body.accessToken })).status, 200);
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 401, 'the old access token still works');
  });
  await check('a bad or expired refresh token is refused', async () => {
    const h = harness();
    const zed = await h.member('zed');
    assert.strictEqual((await h.call('post', '/auth/refresh', { body: { refreshToken: 'y'.repeat(43) } })).status, 401);
    assert.strictEqual((await h.call('post', '/auth/refresh', { body: {} })).status, 401);
    h.db.state.now += 61 * 24 * HOUR;
    const r = await h.call('post', '/auth/refresh', { body: { refreshToken: zed.refresh } });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.body.error.code, 'invalid_refresh_token');
  });
  await check('a phone in regular use stays signed in (each refresh restarts the 60 days)', async () => {
    const h = harness();
    const zed = await h.member('zed');
    for (let i = 0; i < 3; i++) {
      h.db.state.now += 40 * 24 * HOUR;
      assert.strictEqual((await h.call('post', '/auth/refresh', { body: { refreshToken: zed.refresh } })).status, 200, 'refresh ' + i);
    }
  });

  console.log('sessions');
  await check('lists devices, signs one out, signs out this one, signs out everywhere', async () => {
    const h = harness();
    await h.addUser('zed');
    const phone = await h.signIn('zed', 'Phone');
    const tablet = await h.signIn('zed', 'Tablet');
    let r = await h.call('get', '/auth/sessions', { token: phone.accessToken });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.sessions.map((s) => [s.deviceName, s.current]).sort(), [['Phone', true], ['Tablet', false]]);
    const tabletId = r.body.sessions.find((s) => s.deviceName === 'Tablet').id;
    assert.strictEqual((await h.call('delete', '/auth/sessions/:sessionId', { token: phone.accessToken, params: { sessionId: String(tabletId) } })).status, 204);
    assert.strictEqual((await h.call('get', '/me', { token: tablet.accessToken })).status, 401);
    assert.strictEqual((await h.call('delete', '/auth/sessions/:sessionId', { token: phone.accessToken, params: { sessionId: String(tabletId) } })).status, 404);
    assert.strictEqual((await h.call('post', '/auth/logout', { token: phone.accessToken })).status, 204);
    assert.strictEqual((await h.call('get', '/me', { token: phone.accessToken })).status, 401);
    const a = await h.signIn('zed'); const b = await h.signIn('zed');
    assert.strictEqual((await h.call('post', '/auth/logout-everywhere', { token: a.accessToken })).status, 204);
    assert.strictEqual((await h.call('get', '/me', { token: b.accessToken })).status, 401);
  });
  await check('one person cannot sign out another person\'s device', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const amy = await h.member('amy');
    const zedSession = h.db.state.tokens.find((t) => t.uname === 'zed');
    assert.strictEqual((await h.call('delete', '/auth/sessions/:sessionId', { token: amy.token, params: { sessionId: String(zedSession.token_id) } })).status, 404);
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 200);
  });
  await check('without the ApiToken table the API says it is not set up, and the cause is logged', async () => {
    const h = harness();
    await h.addUser('zed');
    const original = h.db.asyncQuery;
    h.db.asyncQuery = async (sql, p) => {
      if (/ApiToken/.test(sql)) { const e = new Error('no table'); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
      return original(sql, p);
    };
    const r = await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123' } });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.error.code, 'api_not_ready');
    assert(h.logs.some((l) => l.includes('001_api_tokens.sql')), 'the fix was not logged');
  });
  await check('unexpected errors become a generic 500 that leaks nothing', async () => {
    const h = harness();
    await h.addUser('zed');
    h.db.asyncQuery = async () => { throw new Error('secret database detail'); };
    const r = await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123' } });
    assert.strictEqual(r.status, 500);
    assert(!JSON.stringify(r.body).includes('secret database detail'));
    assert(h.logs.some((l) => l.includes('secret database detail')), 'not logged');
  });

  console.log('registering');
  await check('creates an account, signs it in, and checks the input', async () => {
    const h = harness();
    const good = { username: 'new.user', firstName: 'New', lastName: 'User', email: 'new@example.com', password: 'longenough1', deviceName: 'iPhone' };
    const bad = (changes) => h.call('post', '/auth/register', { body: Object.assign({}, good, changes), ip: '203.0.113.' + Math.floor(Math.random() * 200 + 1) });
    assert.strictEqual((await bad({ username: 'has space' })).status, 400);
    assert.strictEqual((await bad({ username: '' })).status, 400);
    assert.strictEqual((await bad({ email: 'nope' })).status, 400);
    assert.strictEqual((await bad({ password: 'short' })).status, 400);
    assert.strictEqual((await bad({ firstName: '' })).status, 400);
    assert.strictEqual(h.db.state.users.length, 0);
    const r = await bad({});
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.user.username, 'new.user');
    assert.strictEqual(h.db.state.users[0].password, 'h$longenough1');
    assert.strictEqual((await h.call('get', '/me', { token: r.body.accessToken })).status, 200);
    const dupEmail = await bad({ username: 'other' });
    assert.strictEqual(dupEmail.status, 409);
    assert.strictEqual(dupEmail.body.error.code, 'email_in_use');
    const dupName = await bad({ email: 'other@example.com' });
    assert.strictEqual(dupName.status, 409);
    assert.strictEqual(dupName.body.error.code, 'username_taken');
  });
  await check('sign-ups are limited per address', async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) {
      await h.call('post', '/auth/register', { body: {}, ip: '203.0.113.9' });
    }
    const r = await h.call('post', '/auth/register', { body: {}, ip: '203.0.113.9' });
    assert.strictEqual(r.status, 429);
  });

  console.log('password reset');
  await check('request, check, complete: emails a link, expires, signs everything out', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const unknown = await h.call('post', '/auth/password-reset', { body: { email: 'nobody@example.com' } });
    assert.strictEqual(unknown.status, 202);
    assert.strictEqual(h.mail.length, 0, 'an email went to an address with no account');
    const known = await h.call('post', '/auth/password-reset', { body: { email: 'zed@example.com' } });
    assert.strictEqual(known.status, 202);
    assert.deepStrictEqual(known.body, unknown.body, 'the answers differ, which would reveal who has an account');
    assert.strictEqual(h.mail.length, 1);
    assert.strictEqual(h.mail[0].template, 'reset');
    assert.strictEqual(h.mail[0].to, 'zed@example.com');
    const token = /\/passwordReset\/([0-9a-f]{32})$/.exec(h.mail[0].context.link)[1];
    assert(h.mail[0].context.link.startsWith('https://lorislist.example/'));
    assert.strictEqual((await h.call('get', '/auth/password-reset/:token', { params: { token: token } })).status, 204);
    assert.strictEqual((await h.call('get', '/auth/password-reset/:token', { params: { token: 'f'.repeat(32) } })).status, 404);
    assert.strictEqual((await h.call('put', '/auth/password-reset/:token', { params: { token: token }, body: { password: 'short' } })).status, 400);
    assert.strictEqual((await h.call('put', '/auth/password-reset/:token', { params: { token: token }, body: { password: 'brand-new-pass' } })).status, 204);
    assert.strictEqual((await h.call('get', '/auth/password-reset/:token', { params: { token: token } })).status, 404, 'a reset link worked twice');
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 401, 'old sign-ins survived a password reset');
    assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123' } })).status, 401);
    assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed', password: 'brand-new-pass' } })).status, 200);
  });
  await check('a reset link stops working after a day', async () => {
    const h = harness();
    await h.addUser('zed');
    await h.call('post', '/auth/password-reset', { body: { email: 'zed@example.com' } });
    const token = /([0-9a-f]{32})$/.exec(h.mail[0].context.link)[1];
    h.db.state.now += 25 * HOUR;
    assert.strictEqual((await h.call('put', '/auth/password-reset/:token', { params: { token: token }, body: { password: 'brand-new-pass' } })).status, 404);
  });
  await check('reset emails are limited per address, with the same answer', async () => {
    const h = harness();
    await h.addUser('zed');
    for (let i = 0; i < 7; i++) {
      assert.strictEqual((await h.call('post', '/auth/password-reset', { body: { email: 'zed@example.com' } })).status, 202);
    }
    assert.strictEqual(h.mail.length, 5);
  });

  console.log('account');
  await check('shows and updates the profile', async () => {
    const h = harness();
    const zed = await h.member('zed');
    await h.addUser('amy');
    let r = await h.call('get', '/me', { token: zed.token });
    assert.deepStrictEqual(r.body.user, { username: 'zed', firstName: 'Zed', lastName: 'Test', email: 'zed@example.com', showTips: true });
    assert.strictEqual((await h.call('patch', '/me', { token: zed.token, body: {} })).status, 400);
    assert.strictEqual((await h.call('patch', '/me', { token: zed.token, body: { email: 'bad' } })).status, 400);
    assert.strictEqual((await h.call('patch', '/me', { token: zed.token, body: { firstName: '   ' } })).status, 400);
    assert.strictEqual((await h.call('patch', '/me', { token: zed.token, body: { showTips: 'no' } })).status, 400);
    const taken = await h.call('patch', '/me', { token: zed.token, body: { email: 'amy@example.com' } });
    assert.strictEqual(taken.status, 409);
    assert.strictEqual((await h.call('patch', '/me', { token: zed.token, body: { email: 'zed@example.com' } })).status, 200, 'saving your own email failed');
    r = await h.call('patch', '/me', { token: zed.token, body: { firstName: 'Zachary', lastName: 'Horine', email: 'zach@example.com', showTips: false } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.user, { username: 'zed', firstName: 'Zachary', lastName: 'Horine', email: 'zach@example.com', showTips: false });
  });
  await check('changing the password needs the current one and signs out the other devices', async () => {
    const h = harness();
    await h.addUser('zed');
    const phone = await h.signIn('zed', 'Phone');
    const tablet = await h.signIn('zed', 'Tablet');
    const change = (body) => h.call('put', '/me/password', { token: phone.accessToken, body: body });
    assert.strictEqual((await change({ currentPassword: 'wrong', newPassword: 'brand-new-pass' })).body.error.code, 'wrong_password');
    assert.strictEqual((await change({ currentPassword: 'password123', newPassword: 'short' })).status, 400);
    assert.strictEqual((await change({ currentPassword: 'password123', newPassword: 'brand-new-pass' })).status, 204);
    assert.strictEqual((await h.call('get', '/me', { token: phone.accessToken })).status, 200, 'this device was signed out');
    assert.strictEqual((await h.call('get', '/me', { token: tablet.accessToken })).status, 401, 'another device stayed signed in');
    assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed', password: 'brand-new-pass' } })).status, 200);
  });
  await check('guessing the current password is rate limited', async () => {
    const h = harness();
    const zed = await h.member('zed');
    for (let i = 0; i < 5; i++) {
      await h.call('put', '/me/password', { token: zed.token, body: { currentPassword: 'wrong' + i, newPassword: 'brand-new-pass' } });
    }
    const r = await h.call('put', '/me/password', { token: zed.token, body: { currentPassword: 'password123', newPassword: 'brand-new-pass' } });
    assert.strictEqual(r.status, 429);
  });
  await check('deleting the account needs the password', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const r = await h.call('delete', '/me', { token: zed.token, body: { password: 'wrong' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'wrong_password');
    assert.strictEqual((await h.call('delete', '/me', { token: zed.token })).status, 400, 'no password was accepted');
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 200, 'the account went anyway');
    assert.strictEqual((await h.call('delete', '/me', { header: 'Bearer nope' })).status, 401);
  });
  await check('deleting the account removes its data, signs it out everywhere and retires the username', async () => {
    const h = harness();
    await h.addUser('zed');
    const phone = await h.signIn('zed', 'Phone');
    const tablet = await h.signIn('zed', 'Tablet');
    const amy = await h.member('amy');
    const mine = (await h.call('post', '/lists', { token: phone.accessToken, body: { name: 'Mine', color: 'ff9900' } })).body.list;
    await h.call('post', '/lists/:id/items', { token: phone.accessToken, params: { id: String(mine.id) }, body: { name: 'Milk' } });
    const hers = (await h.call('post', '/lists', { token: amy.token, body: { name: 'Hers', color: 'ff9900' } })).body.list;
    h.db.state.shares.push({ list_id: mine.id, share_user: 'amy', share_perms: 'EDIT' });
    h.db.state.shares.push({ list_id: hers.id, share_user: 'zed', share_perms: 'EDIT' });
    await h.call('post', '/lists/:id/items', { token: phone.accessToken, params: { id: String(hers.id) }, body: { name: 'Bread' } });
    await h.call('post', '/lists/:id/shares', { token: phone.accessToken, params: { id: String(mine.id) }, body: { email: 'bob@example.com', permission: 'view' } });
    await h.call('post', '/lists/:id/shares', { token: amy.token, params: { id: String(hers.id) }, body: { email: 'ZED@example.com', permission: 'view' } });
    h.db.state.resets.push({ uname: 'zed', token: 'r'.repeat(32), added: h.db.state.now });
    h.db.state.suggestions.push({ item_id: 1, item_name: 'Old', owner: 'zed' }, { item_id: 2, item_name: 'Kept', owner: 'amy' });

    const r = await h.call('delete', '/me', { token: phone.accessToken, body: { password: 'password123' } });
    assert.strictEqual(r.status, 204, JSON.stringify(r.body));
    const s = h.db.state;
    assert(!s.users.some((u) => u.uname === 'zed'), 'the User row is still there');
    assert(!s.lists.some((l) => l.owner === 'zed'), 'their lists are still there');
    assert(!s.shares.some((x) => x.share_user === 'zed' || x.list_id === mine.id), 'shares are still there');
    assert(!s.pending.some((x) => x.list_owner === 'zed' || x.share_email.toLowerCase() === 'zed@example.com'), 'invitations are still there');
    assert(!s.resets.some((x) => x.uname === 'zed'), 'reset links are still there');
    assert(!s.tokens.some((t) => t.uname === 'zed'), 'sign-ins are still there');
    assert.deepStrictEqual(s.suggestions.map((i) => i.owner), ['amy']);
    // what they added to amy's list stays on amy's list, and amy is untouched
    const list = (await h.call('get', '/lists/:id', { token: amy.token, params: { id: String(hers.id) } })).body.list;
    assert.deepStrictEqual(list.items.map((i) => i.name), ['Bread']);
    assert.strictEqual((await h.call('get', '/me', { token: amy.token })).status, 200);

    for (const token of [phone.accessToken, tablet.accessToken]) {
      assert.strictEqual((await h.call('get', '/me', { token: token })).status, 401, 'a device stayed signed in');
    }
    assert.strictEqual((await h.call('post', '/auth/refresh', { body: { refreshToken: tablet.refreshToken } })).status, 401);
    assert.strictEqual((await h.call('post', '/auth/login', { body: { username: 'zed', password: 'password123' } })).status, 401);
    const again = await h.call('post', '/auth/register', { body: { firstName: 'Z', lastName: 'Z', username: 'ZED', email: 'new@example.com', password: 'password123' } });
    assert.strictEqual(again.status, 409, 'the username could be registered again');
    assert.strictEqual(again.body.error.code, 'username_taken');
    const email = await h.call('post', '/auth/register', { body: { firstName: 'Z', lastName: 'Z', username: 'zed2', email: 'zed@example.com', password: 'password123' } });
    assert.strictEqual(email.status, 201, 'the email address could not be used again');
  });
  await check('a failure part way through deleting the account changes nothing', async () => {
    const h = harness();
    const zed = await h.member('zed');
    await h.call('post', '/lists', { token: zed.token, body: { name: 'Mine', color: 'ff9900' } });
    h.db.state.failOn = 'DELETE FROM User';
    const r = await h.call('delete', '/me', { token: zed.token, body: { password: 'password123' } });
    assert.strictEqual(r.status, 500);
    assert.strictEqual(h.db.state.lists.length, 1, 'the list was deleted');
    assert.strictEqual(h.db.state.retired.length, 0, 'the username was retired');
    h.db.state.failOn = null;
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 200, 'the device was signed out');
    assert.strictEqual((await h.call('delete', '/me', { token: zed.token, body: { password: 'password123' } })).status, 204, 'trying again failed');
  });
  await check('guessing the password to delete the account is rate limited', async () => {
    const h = harness();
    const zed = await h.member('zed');
    for (let i = 0; i < 5; i++) {
      await h.call('delete', '/me', { token: zed.token, body: { password: 'wrong' + i } });
    }
    const r = await h.call('delete', '/me', { token: zed.token, body: { password: 'password123' } });
    assert.strictEqual(r.status, 429);
    assert.strictEqual((await h.call('get', '/me', { token: zed.token })).status, 200);
  });
  await check('colours and item suggestions', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const c = await h.call('get', '/colors', { token: zed.token });
    assert.deepStrictEqual(c.body.colors[0], { id: 1, hex: 'ff9900', name: 'Orange' });
    const list = (await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list;
    for (const name of ['Milk', 'Eggs', 'Milk']) {
      await h.call('post', '/lists/:id/items', { token: zed.token, params: { id: String(list.id) }, body: { name: name } });
    }
    const s = await h.call('get', '/items/suggestions', { token: zed.token });
    assert.deepStrictEqual(s.body.suggestions, ['Milk', 'Eggs']);
  });

  console.log('lists and items');
  await check('create, read, rename, delete a list', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const post = (body) => h.call('post', '/lists', { token: zed.token, body: body });
    assert.strictEqual((await post({ name: '', color: 'ff9900' })).status, 400);
    assert.strictEqual((await post({ name: 'Food', color: 'red; background:url(x)' })).status, 400);
    assert.strictEqual((await post({ name: 'Food' })).status, 400);
    const created = await post({ name: 'Food', color: '#FF9900' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.list.name, 'Food');
    assert.strictEqual(created.body.list.color, 'FF9900', 'the # was not removed');
    assert.strictEqual(created.body.list.role, 'owner');
    const id = String(created.body.list.id);
    const all = await h.call('get', '/lists', { token: zed.token });
    assert.deepStrictEqual(all.body.lists.map((l) => l.name), ['Food']);
    const upd = (body) => h.call('patch', '/lists/:id', { token: zed.token, params: { id: id }, body: body });
    assert.strictEqual((await upd({})).status, 400);
    assert.strictEqual((await upd({ color: 'nothex' })).status, 400);
    const renamed = await upd({ name: 'Groceries' });
    assert.strictEqual(renamed.body.list.name, 'Groceries');
    assert.strictEqual(renamed.body.list.color, 'FF9900', 'a rename changed the colour');
    assert.strictEqual((await upd({ color: '3366cc' })).body.list.color, '3366cc');
    assert.strictEqual((await h.call('delete', '/lists/:id', { token: zed.token, params: { id: id } })).status, 204);
    assert.strictEqual((await h.call('get', '/lists/:id', { token: zed.token, params: { id: id } })).status, 404);
  });
  await check('people see only their own lists, and other people\'s lists look like they do not exist', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const amy = await h.member('amy');
    const list = (await h.call('post', '/lists', { token: zed.token, body: { name: 'Mine', color: 'ff9900' } })).body.list;
    const id = String(list.id);
    assert.deepStrictEqual((await h.call('get', '/lists', { token: amy.token })).body.lists, []);
    for (const [method, route, extra] of [
      ['get', '/lists/:id', {}],
      ['patch', '/lists/:id', { body: { name: 'x' } }],
      ['delete', '/lists/:id', {}],
      ['post', '/lists/:id/items', { body: { name: 'x' } }],
      ['post', '/lists/:id/shares', { body: { email: 'a@b.co', permission: 'view' } }],
      ['delete', '/lists/:id/members/me', {}]
    ]) {
      const r = await h.call(method, route, Object.assign({ token: amy.token, params: { id: id } }, extra));
      assert.strictEqual(r.status, 404, method + ' ' + route + ' gave ' + r.status);
    }
    for (const bad of ['abc', '0', '-1', '1; DROP TABLE x', '99999']) {
      assert.strictEqual((await h.call('get', '/lists/:id', { token: zed.token, params: { id: bad } })).status, 404, bad);
    }
  });
  await check('items: add, tick, untick, delete, clear the ticked ones', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id);
    const add = (body) => h.call('post', '/lists/:id/items', { token: zed.token, params: { id: id }, body: body });
    assert.strictEqual((await add({ name: '   ' })).status, 400);
    assert.strictEqual((await add({ name: 'x'.repeat(101) })).status, 400);
    assert.strictEqual((await add({ name: 'Milk', count: 0 })).status, 400);
    assert.strictEqual((await add({ name: 'Milk', count: 'two' })).status, 400);
    assert.strictEqual((await add({ name: 'Milk', count: 2.5 })).status, 400);
    await add({ name: 'Milk', count: 2 });
    await add({ name: 'Eggs' });
    const third = await add({ name: 'Bread', count: '3' });
    assert.strictEqual(third.status, 201);
    assert.deepStrictEqual(third.body.items.map((i) => [i.name, i.count, i.checked]), [['Milk', 2, false], ['Eggs', null, false], ['Bread', 3, false]]);
    const milk = third.body.items[0].id; const eggs = third.body.items[1].id;
    const tick = (itemId, checked) => h.call('patch', '/lists/:id/items/:itemId', { token: zed.token, params: { id: id, itemId: String(itemId) }, body: { checked: checked } });
    assert.strictEqual((await tick(milk, 'yes')).status, 400);
    assert.deepStrictEqual((await tick(milk, true)).body, { id: milk, checked: true });
    await tick(eggs, true);
    await tick(eggs, false);
    let list = (await h.call('get', '/lists/:id', { token: zed.token, params: { id: id } })).body.list;
    assert.deepStrictEqual(list.items.map((i) => [i.name, i.checked]), [['Milk', true], ['Eggs', false], ['Bread', false]]);
    assert.strictEqual(list.canEdit, true);
    assert.strictEqual((await h.call('delete', '/lists/:id/items', { token: zed.token, params: { id: id } })).status, 400, 'clearing without ?checked=true');
    const cleared = await h.call('delete', '/lists/:id/items', { token: zed.token, params: { id: id }, query: { checked: 'true' } });
    assert.deepStrictEqual(cleared.body, { deleted: 1 });
    list = (await h.call('get', '/lists/:id', { token: zed.token, params: { id: id } })).body.list;
    assert.deepStrictEqual(list.items.map((i) => i.name), ['Eggs', 'Bread']);
    assert.strictEqual((await h.call('delete', '/lists/:id/items/:itemId', { token: zed.token, params: { id: id, itemId: String(eggs) } })).status, 204);
    assert.strictEqual((await h.call('delete', '/lists/:id/items/:itemId', { token: zed.token, params: { id: id, itemId: String(eggs) } })).status, 404);
  });
  await check('an item on one list cannot be changed through another list', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const amy = await h.member('amy');
    const mine = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Mine', color: 'ff9900' } })).body.list.id);
    const hers = String((await h.call('post', '/lists', { token: amy.token, body: { name: 'Hers', color: 'ff9900' } })).body.list.id);
    const item = (await h.call('post', '/lists/:id/items', { token: amy.token, params: { id: hers }, body: { name: 'Secret' } })).body.items[0].id;
    const params = { id: mine, itemId: String(item) };
    assert.strictEqual((await h.call('patch', '/lists/:id/items/:itemId', { token: zed.token, params: params, body: { checked: true } })).status, 404);
    assert.strictEqual((await h.call('delete', '/lists/:id/items/:itemId', { token: zed.token, params: params })).status, 404);
    assert.strictEqual(h.db.state.items.length, 1);
    assert.strictEqual(h.db.state.items[0].checked, 0);
  });

  console.log('sharing');
  await check('share, accept, then edit or only view depending on the permission', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const amy = await h.member('amy');
    const bob = await h.member('bob');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Party', color: 'ff9900' } })).body.list.id);
    const share = (body) => h.call('post', '/lists/:id/shares', { token: zed.token, params: { id: id }, body: body });
    assert.strictEqual((await share({ email: 'not-an-email', permission: 'edit' })).status, 400);
    assert.strictEqual((await share({ email: 'amy@example.com', permission: 'admin' })).status, 400);
    assert.strictEqual((await share({ email: 'amy@example.com', permission: 'edit' })).status, 202);
    assert.strictEqual((await share({ email: 'bob@example.com', permission: 'VIEW' })).status, 202);
    assert.strictEqual(h.mail.length, 2);
    assert.strictEqual(h.mail[0].template, 'share');
    assert.strictEqual(h.mail[0].context.list, 'Party', 'the email should name the list');
    assert.strictEqual(h.mail[0].context.perms, 'EDIT');
    assert(h.mail[0].context.share_user && h.mail[0].context.share_user.fname === 'Amy');
    const amyKey = /([0-9a-f]{32})$/.exec(h.mail[0].context.link)[1];
    const bobKey = /([0-9a-f]{32})$/.exec(h.mail[1].context.link)[1];

    const peek = await h.call('get', '/shares/:key', { token: amy.token, params: { key: amyKey } });
    assert.deepStrictEqual(peek.body.share, { key: amyKey, permission: 'edit', list: { id: Number(id), name: 'Party', color: 'ff9900', owner: 'zed' } });
    assert.strictEqual((await h.call('get', '/shares/:key', { token: amy.token, params: { key: 'f'.repeat(32) } })).status, 404);
    assert.strictEqual((await h.call('post', '/shares/:key', { token: amy.token, params: { key: amyKey }, body: { response: 'maybe' } })).status, 400);

    const accepted = await h.call('post', '/shares/:key', { token: amy.token, params: { key: amyKey }, body: { response: 'accept' } });
    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(accepted.body.list.role, 'edit');
    assert.strictEqual((await h.call('post', '/shares/:key', { token: amy.token, params: { key: amyKey }, body: { response: 'accept' } })).status, 404, 'an invitation worked twice');
    await h.call('post', '/shares/:key', { token: bob.token, params: { key: bobKey }, body: { response: 'accept' } });

    const amyLists = await h.call('get', '/lists', { token: amy.token });
    assert.deepStrictEqual(amyLists.body.lists.map((l) => [l.name, l.role, l.owner]), [['Party', 'edit', 'zed']]);
    const amyAdd = await h.call('post', '/lists/:id/items', { token: amy.token, params: { id: id }, body: { name: 'Cake' } });
    assert.strictEqual(amyAdd.status, 201);
    const bobView = await h.call('get', '/lists/:id', { token: bob.token, params: { id: id } });
    assert.strictEqual(bobView.status, 200);
    assert.strictEqual(bobView.body.list.canEdit, false);
    assert.deepStrictEqual(bobView.body.list.items.map((i) => i.name), ['Cake']);
    const itemId = String(bobView.body.list.items[0].id);
    for (const [method, route, extra] of [
      ['post', '/lists/:id/items', { body: { name: 'x' } }],
      ['patch', '/lists/:id/items/:itemId', { body: { checked: true } }],
      ['delete', '/lists/:id/items/:itemId', {}],
      ['delete', '/lists/:id/items', { query: { checked: 'true' } }]
    ]) {
      const r = await h.call(method, route, Object.assign({ token: bob.token, params: { id: id, itemId: itemId } }, extra));
      assert.strictEqual(r.status, 403, 'view-only ' + method + ' ' + route + ' gave ' + r.status);
    }
    // only the owner can rename, delete or share
    for (const who of [amy, bob]) {
      assert.strictEqual((await h.call('patch', '/lists/:id', { token: who.token, params: { id: id }, body: { name: 'x' } })).status, 403);
      assert.strictEqual((await h.call('delete', '/lists/:id', { token: who.token, params: { id: id } })).status, 403);
      assert.strictEqual((await h.call('post', '/lists/:id/shares', { token: who.token, params: { id: id }, body: { email: 'a@b.co', permission: 'view' } })).status, 403);
    }
    // leaving
    assert.strictEqual((await h.call('delete', '/lists/:id/members/me', { token: bob.token, params: { id: id } })).status, 204);
    assert.strictEqual((await h.call('get', '/lists/:id', { token: bob.token, params: { id: id } })).status, 404);
    assert.strictEqual((await h.call('delete', '/lists/:id/members/me', { token: zed.token, params: { id: id } })).status, 400, 'an owner can leave their own list');
  });
  await check('declining, accepting your own list, and accepting twice', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const amy = await h.member('amy');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Party', color: 'ff9900' } })).body.list.id);
    const invite = async (permission) => {
      await h.call('post', '/lists/:id/shares', { token: zed.token, params: { id: id }, body: { email: 'amy@example.com', permission: permission } });
      return /([0-9a-f]{32})$/.exec(h.mail[h.mail.length - 1].context.link)[1];
    };
    let key = await invite('view');
    assert.strictEqual((await h.call('post', '/shares/:key', { token: amy.token, params: { key: key }, body: { response: 'deny' } })).status, 204);
    assert.strictEqual((await h.call('get', '/shares/:key', { token: amy.token, params: { key: key } })).status, 404);
    assert.deepStrictEqual((await h.call('get', '/lists', { token: amy.token })).body.lists, []);
    key = await invite('view');
    await h.call('post', '/shares/:key', { token: amy.token, params: { key: key }, body: { response: 'accept' } });
    key = await invite('edit');
    const again = await h.call('post', '/shares/:key', { token: amy.token, params: { key: key }, body: { response: 'accept' } });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(h.db.state.shares.length, 1, 'a second share row was created');
    key = await invite('edit');
    const own = await h.call('post', '/shares/:key', { token: zed.token, params: { key: key }, body: { response: 'accept' } });
    assert.strictEqual(own.status, 400);
    assert.strictEqual(h.db.state.shares.length, 1);
  });
  await check('share emails are limited per account', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Party', color: 'ff9900' } })).body.list.id);
    let last;
    for (let i = 0; i < 21; i++) {
      last = await h.call('post', '/lists/:id/shares', { token: zed.token, params: { id: id }, body: { email: 'p' + i + '@example.com', permission: 'view' } });
    }
    assert.strictEqual(last.status, 429);
    assert.strictEqual(h.mail.length, 20);
  });

  console.log('change digest');
  await check('GET /changes lists every visible list with a fingerprint, and a list carries the same one', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = (await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id;
    await h.call('post', '/lists/:id/items', { token: zed.token, params: { id: String(id) }, body: { name: 'Milk', count: 2 } });
    const digest = (await h.call('get', '/changes', { token: zed.token })).body;
    assert.strictEqual(digest.lists.length, 1);
    assert.strictEqual(digest.lists[0].id, id);
    assert(/^[0-9a-f]{16}$/.test(digest.lists[0].revision));
    assert(/^[0-9a-f]{16}$/.test(digest.revision));
    const detail = (await h.call('get', '/lists/:id', { token: zed.token, params: { id: String(id) } })).body.list;
    assert.strictEqual(detail.revision, digest.lists[0].revision);
  });
  await check('the fingerprint changes for each kind of edit and not otherwise', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id);
    const rev = async () => (await h.call('get', '/changes', { token: zed.token })).body;
    const seen = [await rev()];
    assert.deepStrictEqual(await rev(), seen[0], 'asking twice changes nothing');
    const add = await h.call('post', '/lists/:id/items', { token: zed.token, params: { id: id }, body: { name: 'Milk' } });
    seen.push(await rev());
    const itemId = String(add.body.items[0].id);
    await h.call('patch', '/lists/:id/items/:itemId', { token: zed.token, params: { id: id, itemId: itemId }, body: { checked: true } });
    seen.push(await rev());
    await h.call('patch', '/lists/:id', { token: zed.token, params: { id: id }, body: { name: 'Groceries' } });
    seen.push(await rev());
    await h.call('patch', '/lists/:id', { token: zed.token, params: { id: id }, body: { color: '3366cc' } });
    seen.push(await rev());
    await h.call('delete', '/lists/:id/items/:itemId', { token: zed.token, params: { id: id, itemId: itemId } });
    seen.push(await rev());
    const all = new Set(seen.map((d) => d.revision));
    assert.strictEqual(all.size, seen.length, 'every edit gave a new revision');
    await h.call('delete', '/lists/:id', { token: zed.token, params: { id: id } });
    assert.deepStrictEqual((await rev()).lists, []);
  });
  await check('a change made outside the API (no timestamp moves) is still noticed', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id);
    const before = (await h.call('get', '/changes', { token: zed.token })).body;
    const lastChange = h.db.state.lists[0].last_change;
    h.db.state.items.push({ sItem_id: 99, item_id: 1099, list_id: Number(id), item_name: 'Eggs', number: null, checked: 0, owner: 'zed' });
    assert.strictEqual(h.db.state.lists[0].last_change, lastChange);
    const after = (await h.call('get', '/changes', { token: zed.token })).body;
    assert.notStrictEqual(after.revision, before.revision);
  });
  await check('people only see their own lists, and sharing or leaving changes what they see', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const amy = await h.member('amy');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id);
    assert.deepStrictEqual((await h.call('get', '/changes', { token: amy.token })).body.lists, []);
    h.db.state.shares.push({ list_id: Number(id), share_user: 'amy', share_perms: 'VIEW' });
    const asViewer = (await h.call('get', '/changes', { token: amy.token })).body;
    assert.strictEqual(asViewer.lists.length, 1);
    const asOwner = (await h.call('get', '/changes', { token: zed.token })).body;
    assert.notStrictEqual(asViewer.lists[0].revision, asOwner.lists[0].revision, 'the role is part of what a person sees');
    h.db.state.shares[0].share_perms = 'EDIT';
    assert.notStrictEqual((await h.call('get', '/changes', { token: amy.token })).body.lists[0].revision, asViewer.lists[0].revision);
    await h.call('delete', '/lists/:id/members/me', { token: amy.token, params: { id: id } });
    assert.deepStrictEqual((await h.call('get', '/changes', { token: amy.token })).body.lists, []);
  });
  await check('GET /changes needs a sign-in', async () => {
    const h = harness();
    assert.strictEqual((await h.call('get', '/changes')).status, 401);
  });

  console.log('misc');
  await check('the root endpoint needs no sign-in', async () => {
    const h = harness();
    const r = await h.call('get', '/');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.version, 1);
  });
  await check('SQL injection attempts in ids and text are harmless', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: "x'); DROP TABLE User;--", color: 'ff9900' } })).body.list.id);
    // every statement the fake database saw used placeholders, never the raw text
    assert(h.db.state.log.every((s) => !s.includes('DROP TABLE')), 'text was put into the SQL');
    const r = await h.call('get', '/lists/:id', { token: zed.token, params: { id: id + ' OR 1=1' } });
    assert.strictEqual(r.status, 404);
    const login = await h.call('post', '/auth/login', { body: { username: { $ne: '' }, password: { $ne: '' } } });
    assert.strictEqual(login.status, 400);
  });

  console.log(failures === 0 ? '\nAll API checks passed.' : '\n' + failures + ' check(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
}

if (require.main === module) { main(); }
module.exports = { harness: harness };
