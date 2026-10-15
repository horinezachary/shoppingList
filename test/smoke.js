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
        defaultLayout: 'email.handlebars'
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
  });
  await check('share email renders for an existing user', async () => {
    const html = await render('share', {
      uname: 'owner', share_user: { fname: 'Zed', lname: 'Smith' }, perms: 'EDIT',
      list_name: 'Groceries', link: 'https://example.com/share/abc123',
      register_link: 'https://example.com/register'
    });
    assert(html.includes('Hello Zed!'), 'greeting missing');
    assert(html.includes('https://example.com/share/abc123'), 'share link missing');
  });
  await check('share email renders for someone without an account', async () => {
    const html = await render('share', {
      uname: 'owner', share_user: undefined, perms: 'VIEW',
      list_name: 'Groceries', link: 'https://example.com/share/abc123',
      register_link: 'https://example.com/register'
    });
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

  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' check(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
}

main();
