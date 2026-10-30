// Smoke test for the dependency stack ("npm test").
//
// Run it after `npm install`, on the same Node version and machine that will
// run the app. It needs no database. It loads every dependency, checks the
// handlebars version, exercises password hashing, renders both email
// templates through nodemailer, and starts a small Express app that uses the
// same kinds of routes, body parsers and cookie sessions as server.js.
//
// The mail settings below mirror ViewOption() in server.js; keep them in sync.
'use strict';

const assert = require('assert');
const path = require('path');

// views and static files are looked up relative to the working directory,
// as they are when the server is started from the project folder
process.chdir(path.join(__dirname, '..'));

const pkg = require('../package.json');

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

function atLeast(version, minimum) {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) { return true; }
    if ((a[i] || 0) < (b[i] || 0)) { return false; }
  }
  return true;
}

async function main() {
  console.log('runtime');
  await check('Node 24 or newer (running ' + process.versions.node + ')', () => {
    assert(Number(process.versions.node.split('.')[0]) >= 24, 'package.json requires Node 24 or newer');
  });

  console.log('dependencies');
  for (const name of Object.keys(pkg.dependencies)) {
    await check('require("' + name + '")', () => { require(name); });
  }
  await check('handlebars is 4.7.10 or newer (the critical advisories are fixed there)', () => {
    // handlebars comes in through express-handlebars, so resolve it from there
    const from = path.dirname(require.resolve('express-handlebars'));
    const version = require(require.resolve('handlebars', { paths: [from] })).VERSION;
    assert(atLeast(version, '4.7.10'), 'found handlebars ' + version);
  });

  console.log('passwords');
  const bcrypt = require('bcryptjs');
  await check('hash and compare, promise and callback forms (server.js uses both)', async () => {
    const hash = await bcrypt.hash('correct horse', 10);
    assert(/^\$2[aby]\$10\$/.test(hash), 'unexpected hash format ' + hash.slice(0, 7));
    assert.strictEqual(await bcrypt.compare('correct horse', hash), true);
    assert.strictEqual(await bcrypt.compare('wrong', hash), false);
    const viaCallback = await new Promise((resolve, reject) => {
      bcrypt.compare('correct horse', hash, (err, ok) => (err ? reject(err) : resolve(ok)));
    });
    assert.strictEqual(viaCallback, true);
  });
  await check('hashes with the $2a$, $2b$ and $2y$ prefixes all verify (existing users have $2b$)', async () => {
    const hash = await bcrypt.hash('legacy', 10);
    for (const prefix of ['$2a$', '$2b$', '$2y$']) {
      const variant = prefix + hash.slice(4);
      assert.strictEqual(await bcrypt.compare('legacy', variant), true, 'prefix ' + prefix);
    }
  });

  await check('lib/passwords with the real bcryptjs: current form, older quoted form, and the upgrade flag', async () => {
    const mysql = require('mysql');
    const passwords = require('../lib/passwords').create({
      bcrypt: bcrypt, escape: (v) => mysql.escape(v), rounds: 4, log: () => {}
    });
    const current = await passwords.hash("it's a secret");
    assert.deepStrictEqual(await passwords.verify("it's a secret", current), { ok: true, upgrade: false });
    // how accounts made before this version were stored
    const older = await bcrypt.hash(mysql.escape("it's a secret"), 4);
    assert.deepStrictEqual(await passwords.verify("it's a secret", older), { ok: true, upgrade: true });
    assert.deepStrictEqual(await passwords.verify('wrong', older), { ok: false, upgrade: false });
    assert.deepStrictEqual(await passwords.verify('anything', null), { ok: false, upgrade: false });
    assert.deepStrictEqual(await passwords.verify('anything', 'not a bcrypt hash'), { ok: false, upgrade: false });
  });

  console.log('email templates');
  const nodemailer = require('nodemailer');
  const nodemailerhbs = require('nodemailer-express-handlebars');
  async function render(template, context) {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    transport.use('compile', nodemailerhbs({
      viewEngine: {
        extName: '.hbs',
        partialsDir: 'views/partials',
        layoutsDir: 'views/layouts',
        defaultLayout: 'email.handlebars',
        helpers: require('../lib/viewHelpers')
      },
      viewPath: 'views/email',
      extName: '.handlebars'
    }));
    const info = await transport.sendMail({
      from: '"Loris-List" <noreply@example.com>',
      to: 'someone@example.com',
      subject: 'test',
      template: template,
      context: context
    });
    return JSON.parse(info.message).html;
  }
  await check('password reset email renders with the layout and the link', async () => {
    const html = await render('reset', {
      name: 'Zed Smith', email: 'zed@example.com', uname: 'zed',
      link: 'https://example.com/passwordReset/abc123'
    });
    assert(html.includes('Hello Zed Smith!'), 'name missing');
    assert(html.includes('https://example.com/passwordReset/abc123'), 'link missing');
    assert(html.includes('Lori\'s List Development Team'), 'template body missing');
    assert(html.includes('page-header'), 'email layout was not applied');
    assert(html.includes('Copyright ' + new Date().getFullYear()), 'footer year is not the current year');
  });
  await check('share email renders for an existing user', async () => {
    const html = await render('share', {
      uname: 'owner', share_user: { fname: 'Zed', lname: 'Smith' }, perms: 'EDIT',
      list: 'Groceries', list_name: 'Groceries', link: 'https://example.com/share/abc123',
      register_link: 'https://example.com/register'
    });
    assert(html.includes('Hello Zed!'), 'greeting missing');
    assert(html.includes('Groceries'), 'list name missing');
    assert(html.includes('https://example.com/share/abc123'), 'share link missing');
  });
  await check('share email renders for someone without an account', async () => {
    const html = await render('share', {
      uname: 'owner', share_user: undefined, perms: 'VIEW',
      list: 'Groceries', list_name: 'Groceries', link: 'https://example.com/share/abc123',
      register_link: 'https://example.com/register'
    });
    assert(html.includes('Groceries'), 'list name missing');
    assert(html.includes('https://example.com/register'), 'register link missing');
    assert(html.includes('https://example.com/share/abc123'), 'share link missing');
  });

  console.log('express app (same route patterns, body parsers and cookie sessions as server.js)');
  await check('routes, body parsers and cookie session work end to end', async () => {
    const express = require('express');
    const bodyParser = require('body-parser');
    const session = require('client-sessions');
    const app = express();
    app.use(express.static('public'));
    app.use('/:url', express.static('public'));
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());
    app.use(session({
      cookieName: 'session',
      secret: 'test-secret-test-secret-test-secret',
      duration: 60 * 1000,
      activeDuration: 60 * 1000,
      cookie: { httpOnly: true, secure: false }
    }));
    app.post('/login', (req, res) => { req.session.uname = req.body.username; res.redirect('/home'); });
    app.get('/home', (req, res) => { res.send('home:' + req.session.uname); });
    app.post('/:other?/addList', (req, res) => { res.json(req.body); });
    app.get('/:other?/myAccount', (req, res) => { res.send('account'); });
    app.get('*', (req, res) => { res.status(404).send('missing'); });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const json = { 'Content-Type': 'application/json' };

      assert.strictEqual((await fetch(base + '/nope')).status, 404, 'catch-all route');
      assert.strictEqual(await (await fetch(base + '/anything/myAccount')).text(), 'account', '/:other?/myAccount with a prefix');
      assert.strictEqual(await (await fetch(base + '/myAccount')).text(), 'account', '/:other?/myAccount without a prefix');
      let r = await fetch(base + '/y/addList', { method: 'POST', headers: json, body: JSON.stringify({ listName: 'a' }) });
      assert.deepStrictEqual(await r.json(), { listName: 'a' }, 'JSON body');
      r = await fetch(base + '/addList', { method: 'POST', headers: form, body: 'listName=b' });
      assert.deepStrictEqual(await r.json(), { listName: 'b' }, 'form body');

      // log in, then read the value back using only the cookie
      r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: form, body: 'username=zed' });
      assert.strictEqual(r.status, 302, 'login redirect');
      const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      assert(cookie.startsWith('session='), 'no session cookie was set');
      assert.strictEqual(await (await fetch(base + '/home', { headers: { cookie: cookie } })).text(), 'home:zed', 'session did not survive a round trip');
    } finally {
      server.close();
    }
  });

  await check('secure cookies behind a TLS-terminating proxy (as in production with cookieSecure on)', async () => {
    // mirrors the COOKIE_SECURE block in server.js; keep in sync
    const express = require('express');
    const session = require('client-sessions');
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(function (req, res, next) {
      if (req.protocol === 'https') { req.connection.proxySecure = true; }
      next();
    });
    app.use(session({
      cookieName: 'session',
      secret: 'test-secret-test-secret-test-secret',
      duration: 60 * 1000,
      activeDuration: 60 * 1000,
      cookie: { httpOnly: true, secure: true }
    }));
    app.post('/login', (req, res) => { req.session.uname = 'zed'; res.redirect('/home'); });
    app.get('/home', (req, res) => { res.send('home:' + req.session.uname); });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      const viaProxy = { 'X-Forwarded-Proto': 'https' };
      const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: viaProxy });
      assert.strictEqual(r.status, 302, 'login redirect');
      const setCookie = r.headers.getSetCookie();
      assert(setCookie.length > 0 && /secure/i.test(setCookie[0]), 'no Secure session cookie was sent');
      const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      const home = await fetch(base + '/home', { headers: Object.assign({ cookie: cookie }, viaProxy) });
      assert.strictEqual(await home.text(), 'home:zed', 'session did not survive a round trip');
    } finally {
      server.close();
    }
  });

  await check('trust proxy loopback: req.ip is the visitor address from X-Forwarded-For', async () => {
    const express = require('express');
    const app = express();
    app.set('trust proxy', 'loopback');
    app.get('/ip', (req, res) => { res.send(req.ip); });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const r = await fetch('http://127.0.0.1:' + server.address().port + '/ip', { headers: { 'X-Forwarded-For': '203.0.113.9' } });
      assert.strictEqual(await r.text(), '203.0.113.9');
    } finally {
      server.close();
    }
  });

  console.log('JSON API (lib/apiRouter.js with real express, and lib/api.js with an in-memory database)');
  await check('API over HTTP: sign in, make a list, add and tick an item, sign out', async () => {
    const express = require('express');
    const mysql = require('mysql');
    const fakeDb = require('./fakeDb');
    const apiLib = require('../lib/api');
    const limiters = require('../lib/rateLimit');
    const db = fakeDb.create();
    const passwords = require('../lib/passwords').create({ bcrypt: bcrypt, escape: (v) => mysql.escape(v), rounds: 4, log: () => {} });
    db.state.users.push({ uname: 'zed', fname: 'Zed', lname: 'Test', email: 'zed@example.com', password: await passwords.hash('password123'), showAlert: 1 });
    const api = apiLib.create({
      con: db, passwords: passwords, tokens: require('../lib/apiTokens').create({ con: db, log: () => {} }),
      config: { url: 'https://lorislist.example' },
      limiters: {
        failedPerUser: limiters.createLimiter({ max: 5, windowMs: 60000 }), failedPerIp: limiters.createLimiter({ max: 30, windowMs: 60000 }),
        resetRequests: limiters.createLimiter({ max: 5, windowMs: 60000 }), shareRequests: limiters.createLimiter({ max: 20, windowMs: 60000 }),
        registrations: limiters.createLimiter({ max: 10, windowMs: 60000 })
      },
      failureKeys: limiters.failureKeys, updatePassword: async () => {}, sendMail: () => {}, log: () => {}
    });
    const app = express();
    app.use('/api/v1', require('../lib/apiRouter').create(express, api));
    app.use((req, res) => { res.status(404).send('<html>web 404</html>'); });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const base = 'http://127.0.0.1:' + server.address().port + '/api/v1';
      const call = async (method, url, body, token) => {
        const headers = {};
        if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
        if (token) { headers.Authorization = 'Bearer ' + token; }
        const r = await fetch(base + url, { method: method, headers: headers, body: typeof body === 'string' ? body : (body === undefined ? undefined : JSON.stringify(body)) });
        const text = await r.text();
        return { status: r.status, headers: r.headers, json: text ? JSON.parse(text) : null };
      };

      let r = await call('GET', '/');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('cache-control'), 'no-store');
      r = await call('GET', '/nonsense');
      assert.strictEqual(r.status, 404);
      assert.strictEqual(r.json.error.code, 'not_found', 'unknown API paths must answer in JSON');
      r = await call('POST', '/auth/login', '{not json');
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.json.error.code, 'invalid_json');
      r = await call('POST', '/auth/login', { username: 'x'.repeat(60000) });
      assert.strictEqual(r.status, 413);
      r = await call('GET', '/me');
      assert.strictEqual(r.status, 401);
      assert.strictEqual(r.headers.get('www-authenticate'), 'Bearer');
      r = await call('POST', '/auth/login', ['not', 'an', 'object']);
      assert.strictEqual(r.status, 400);

      r = await call('POST', '/auth/login', { username: 'zed', password: 'password123', deviceName: 'curl' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('set-cookie'), null, 'the API must not set cookies');
      const token = r.json.accessToken;
      r = await call('POST', '/lists', { name: 'Food', color: 'ff9900' }, token);
      assert.strictEqual(r.status, 201);
      const id = r.json.list.id;
      r = await call('POST', '/lists/' + id + '/items', { name: 'Milk', count: 2 }, token);
      assert.strictEqual(r.status, 201);
      const itemId = r.json.items[0].id;
      r = await call('PATCH', '/lists/' + id + '/items/' + itemId, { checked: true }, token);
      assert.deepStrictEqual(r.json, { id: itemId, checked: true });
      r = await call('GET', '/lists/' + id, undefined, token);
      assert.deepStrictEqual(r.json.list.items, [{ id: itemId, name: 'Milk', count: 2, checked: true }]);
      r = await call('DELETE', '/lists/' + id + '/items?checked=true', undefined, token);
      assert.deepStrictEqual(r.json, { deleted: 1 });
      r = await call('DELETE', '/lists/' + id, undefined, token);
      assert.strictEqual(r.status, 204);
      assert.strictEqual(r.json, null);
      r = await call('POST', '/auth/logout', undefined, token);
      assert.strictEqual(r.status, 204);
      r = await call('GET', '/me', undefined, token);
      assert.strictEqual(r.status, 401);
      // paths outside /api/v1 still reach the website
      const web = await fetch(base.replace('/api/v1', '') + '/anything');
      assert.strictEqual(await web.text(), '<html>web 404</html>');
    } finally {
      server.close();
    }
  });

  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' check(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
}

main();
