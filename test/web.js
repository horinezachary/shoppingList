// Tests for the website (server.js): the pages, sign-in and sessions, lists,
// sharing, account changes and deletion, the CSRF check, and the JSON API as it
// is mounted in the real app. The whole of server.js is started on a spare port
// with config.js, the database (test/fakeDb.js) and the mail transport swapped
// for stand-ins, and driven over HTTP like a browser would. "npm test" runs it.
'use strict';

const assert = require('assert');
const path = require('path');
const Module = require('module');
const bcrypt = require('bcryptjs');
const fakeDb = require('./fakeDb');
const accounts = require('../lib/accounts');

// views and static files are looked up relative to the working directory
process.chdir(path.join(__dirname, '..'));

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

const SITE = 'https://lorislist.example';
const HOUR = 3600 * 1000;

// ---------------------------------------------------------------------------
// Start server.js with stand-ins for config.js, sqlConfig.js and nodemailer.
// ---------------------------------------------------------------------------
const db = fakeDb.create();
const sent = [];
const fakeNodemailer = {
  createTransport: function () {
    return {
      use: function () {},
      sendMail: function (message, callback) { sent.push(message); if (callback) { callback(null); } }
    };
  }
};
const testConfig = {
  url: SITE,
  database: {},
  server: { host: '127.0.0.1', port: 0 },
  session: { secret: 'test-secret-that-is-long-enough-to-sign-cookies', cookieSecure: false },
  mail: { user: 'smtp-user', pass: 'smtp-pass' }
};

const SERVER = path.join(__dirname, '..', 'server.js');
const realLoad = Module._load;
Module._load = function (request, parent) {
  if (parent && parent.filename === SERVER) {
    if (request === './config') { return { test: testConfig }; }
    if (request === './sqlConfig') { return Object.assign({ start: function () {} }, db); }
  }
  if (request === 'nodemailer') { return fakeNodemailer; }
  return realLoad.apply(this, arguments);
};

// server.js talks a lot; keep its output for when a check fails
const serverLog = [];
const realLog = console.log;
function quiet() { console.log = function () { serverLog.push(Array.from(arguments).join(' ')); }; }
function loud() { console.log = realLog; }

let base;
let server;

async function start() {
  process.env.NODE_ENV = 'test';
  delete process.env.PORT;
  delete process.env.HOST;
  delete process.env.SESSION_SECRET;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.COOKIE_SECURE;
  quiet();
  server = require(SERVER).server;
  if (!server.listening) { await new Promise((resolve) => server.once('listening', resolve)); }
  loud();
  base = 'http://127.0.0.1:' + server.address().port;
}

// ---------------------------------------------------------------------------
// A browser: keeps its cookies, does not follow 302 redirects. Each one gets its
// own address (X-Forwarded-For, trusted from loopback) so the rate limits of
// one check do not spill into the next.
// ---------------------------------------------------------------------------
let nextIp = 1;
function browser() {
  const ip = '203.0.113.' + (nextIp++);
  const jar = new Map();
  async function request(method, url, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'X-Forwarded-For': ip }, opts.headers || {});
    if (jar.size) { headers.Cookie = Array.from(jar).map(([k, v]) => k + '=' + v).join('; '); }
    let body;
    if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers['Content-Type'] = 'application/json';
    }
    quiet();
    let res;
    try {
      res = await fetch(base + url, { method: method, headers: headers, body: body, redirect: 'manual' });
    } finally {
      loud();
    }
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    // express.static (mounted at "/:url" too) sends one-segment GETs such as
    // /home to /home/ with a 301 first; a browser follows that on its own
    if (res.status === 301 && method === 'GET') {
      return request(method, res.headers.get('location'), opts);
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = undefined; }
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, text: text, json: json };
  }
  return {
    ip: ip,
    jar: jar,
    get: (url, opts) => request('GET', url, opts),
    post: (url, form, opts) => request('POST', url, Object.assign({}, opts, { form: form })),
    postJson: (url, json, opts) => request('POST', url, Object.assign({}, opts, { json: json })),
    request: request
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
let userCount = 0;
function addUser(password, extra) {
  userCount++;
  const user = Object.assign({
    uname: 'user' + userCount,
    fname: 'First' + userCount,
    lname: 'Last' + userCount,
    email: 'user' + userCount + '@example.com',
    password: bcrypt.hashSync(password || 'correct horse', 4),
    showAlert: 1
  }, extra || {});
  db.state.users.push(user);
  return user;
}

function addList(owner, name) {
  db.state.now += 1000;
  const list = { list_id: db.state.nextList++, list_name: name || 'Groceries', owner: owner.uname, listColor: 'ff9900', last_change: db.state.now };
  db.state.lists.push(list);
  return list;
}

function addItem(list, name, by) {
  const id = db.state.nextItem++;
  const item = { sItem_id: id, item_id: 1000 + id, list_id: list.list_id, item_name: name, number: null, checked: 0, owner: by ? by.uname : list.owner };
  db.state.items.push(item);
  return item;
}

async function signedIn(user, password) {
  const b = browser();
  const r = await b.post('/login', { username: user.uname, password: password || 'correct horse' });
  assert.strictEqual(r.location, '/home', 'could not sign in as ' + user.uname);
  return b;
}

const findUser = (uname) => db.state.users.find((u) => u.uname === uname);
const findList = (id) => db.state.lists.find((l) => l.list_id == id);
const loginRedirect = (r, to) => {
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.location, '/login?redirect=' + encodeURIComponent(to));
};

async function main() {
  await start();

  console.log('pages');
  await check('the front page shows the info page when signed out', async () => {
    const r = await browser().get('/');
    assert.strictEqual(r.status, 200);
    assert(/Lori/.test(r.text));
  });
  await check('login, register, privacy and terms pages render for anyone', async () => {
    const b = browser();
    for (const url of ['/login', '/register', '/privacy', '/terms']) {
      const r = await b.get(url);
      assert.strictEqual(r.status, 200, url);
      assert(/<html/i.test(r.text), url + ' is not a page');
    }
    assert(/October 30, 2026/.test((await b.get('/privacy')).text), 'the privacy policy shows its date');
  });
  await check('unknown pages are a 404 page', async () => {
    const r = await browser().get('/no/such/page');
    assert.strictEqual(r.status, 404);
    assert(/<html/i.test(r.text));
  });
  await check('static files are served', async () => {
    const r = await browser().get('/style.css');
    assert.strictEqual(r.status, 200);
    assert(/css/.test(r.headers.get('content-type')));
  });
  await check('every response has the security headers and no X-Powered-By', async () => {
    const r = await browser().get('/login');
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(r.headers.get('referrer-policy'), 'same-origin');
    assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.strictEqual(r.headers.get('x-powered-by'), null);
  });
  await check('the login page never shows text taken from the URL', async () => {
    const b = browser();
    const r = await b.get('/login?error=' + encodeURIComponent('<b>Call 555-0100 for help</b>'));
    assert(!/555-0100/.test(r.text));
    const ok = await b.get('/login?error=' + encodeURIComponent('Invalid username or password.'));
    assert(/Invalid username or password\./.test(ok.text));
  });

  console.log('signing in');
  await check('pages that need an account send you to sign in, remembering where you were', async () => {
    const b = browser();
    loginRedirect(await b.get('/home'), '/home');
    loginRedirect(await b.get('/myAccount'), '/myAccount');
    loginRedirect(await b.get('/l/1'), '/l/1');
    loginRedirect(await b.get('/share/abc'), '/share/abc');
    loginRedirect(await b.post('/l/1/addItem', { itemName: 'x' }), '/l/1');
    loginRedirect(await b.post('/deleteAccount', { password: 'x' }), '/myAccount');
  });
  await check('a wrong password or unknown user is refused the same way', async () => {
    const u = addUser();
    const b = browser();
    const wrong = await b.post('/login', { username: u.uname, password: 'nope' });
    const unknown = await b.post('/login', { username: 'nobody-here', password: 'nope' });
    assert.strictEqual(wrong.status, 302);
    assert.strictEqual(wrong.location, unknown.location);
    assert(wrong.location.startsWith('/login/?error='));
    loginRedirect(await b.get('/home'), '/home');
  });
  await check('signing in sets a session cookie that opens the home page with your lists', async () => {
    const u = addUser();
    addList(u, 'Hardware store');
    const b = browser();
    const r = await b.post('/login', { username: u.uname, password: 'correct horse' });
    assert.strictEqual(r.location, '/home');
    assert(b.jar.has('session'));
    const home = await b.get('/home');
    assert.strictEqual(home.status, 200);
    assert(/Hardware store/.test(home.text));
    const front = await b.get('/');
    assert.strictEqual(front.location, '/home');
  });
  await check('usernames are not case sensitive at sign-in', async () => {
    const u = addUser();
    const r = await browser().post('/login', { username: u.uname.toUpperCase(), password: 'correct horse' });
    assert.strictEqual(r.location, '/home');
  });
  await check('after signing in you go back to the page you came from, but only on this site', async () => {
    const u = addUser();
    const login = (redirect) => browser().post('/login?redirect=' + encodeURIComponent(redirect), { username: u.uname, password: 'correct horse' });
    assert.strictEqual((await login('/l/7')).location, '/l/7');
    assert.strictEqual((await login('//evil.example/')).location, '/home');
    assert.strictEqual((await login('/\\evil.example/')).location, '/home');
    assert.strictEqual((await login('https://evil.example/')).location, '/home');
    assert.strictEqual((await login('/home\r\nSet-Cookie: x=1')).location, '/home');
  });
  await check('an account in the older password form signs in and is re-hashed', async () => {
    // older accounts hashed the mysql-escaped (quoted) password
    const u = addUser(null, { password: bcrypt.hashSync("'old password'", 4) });
    const before = u.password;
    await signedIn(u, 'old password');
    assert.notStrictEqual(findUser(u.uname).password, before);
    assert(bcrypt.compareSync('old password', findUser(u.uname).password));
  });
  await check('five wrong passwords lock that username out for a while, even with the right one', async () => {
    const u = addUser();
    const b = browser();
    for (let i = 0; i < 5; i++) { await b.post('/login', { username: u.uname, password: 'wrong' + i }); }
    const r = await b.post('/login', { username: u.uname, password: 'correct horse' });
    assert(/Too%20many%20attempts/.test(r.location), r.location);
    loginRedirect(await b.get('/home'), '/home');
  });
  await check('signing out ends the session', async () => {
    const b = await signedIn(addUser());
    const r = await b.get('/logout');
    assert.strictEqual(r.location, '/');
    loginRedirect(await b.get('/home'), '/home');
  });
  await check('a tampered session cookie is ignored', async () => {
    const b = await signedIn(addUser());
    const value = b.jar.get('session');
    b.jar.set('session', value.slice(0, -4) + (value.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'));
    loginRedirect(await b.get('/home'), '/home');
  });
  await check('a cookie for an account that no longer exists is signed out', async () => {
    const u = addUser();
    const b = await signedIn(u);
    db.state.users = db.state.users.filter((x) => x !== u);
    loginRedirect(await b.get('/home'), '/home');
    db.state.users.push(u);
    loginRedirect(await b.get('/home'), '/home'); // the cookie was reset, not just refused once
  });

  console.log('registering');
  await check('registration checks its input and creates nothing when it fails', async () => {
    const taken = addUser();
    db.state.retired.push(accounts.usernameHash('retired-name'));
    const good = { fname: 'New', lname: 'Person', username: 'newperson', email: 'new@example.com', password: 'long enough', password2: 'long enough' };
    const cases = [
      [{ username: '' }, 'Username, email and password are required.'],
      [{ email: taken.email.toUpperCase() }, 'Email is already in use!'],
      [{ username: taken.uname }, 'Username is already in use!'],
      [{ username: 'Retired-Name' }, 'Username is already in use!'],
      [{ email: 'not an email' }, 'Please enter a valid email address.'],
      [{ password2: 'different!' }, 'Passwords must match.'],
      [{ password: 'short', password2: 'short' }, 'at least 8 characters']
    ];
    const count = db.state.users.length;
    for (const [change, message] of cases) {
      const r = await browser().post('/register', Object.assign({}, good, change));
      assert.strictEqual(r.status, 200);
      assert(r.text.includes(message), JSON.stringify(change) + ' should say ' + message);
    }
    assert.strictEqual(db.state.users.length, count);
  });
  await check('registering creates a bcrypt account and signs it in', async () => {
    const b = browser();
    const r = await b.post('/register?redirect=%2Fhome', { fname: 'Reg', lname: 'Ister', username: 'registered1', email: 'reg@example.com', password: 'a good password', password2: 'a good password' });
    assert.strictEqual(r.location, '/home');
    const u = findUser('registered1');
    assert(u && bcrypt.compareSync('a good password', u.password));
    assert.strictEqual((await b.get('/home')).status, 200);
  });

  console.log('password reset');
  await check('an unknown email gets the same answer and no email', async () => {
    const count = sent.length;
    const r = await browser().post('/passwordReset', { email: 'nobody@example.com' });
    assert.strictEqual(r.location, '/login');
    assert.strictEqual(sent.length, count);
  });
  await check('request, open, complete: the link works once and signs you in with the new password', async () => {
    const u = addUser();
    const b = browser();
    const r = await b.post('/passwordReset', { email: u.email });
    assert.strictEqual(r.location, '/login');
    const mail = sent[sent.length - 1];
    assert.strictEqual(mail.to, u.email);
    assert.strictEqual(mail.template, 'reset');
    const link = mail.context.link;
    assert(link.startsWith(SITE + '/passwordReset/'), link);
    const url = link.slice(SITE.length);
    assert.strictEqual((await b.get(url)).status, 200);
    const token = url.split('/').pop();
    const mismatch = await b.post('/updatePassword/' + token, { password: 'new password 1', password2: 'new password 2' });
    assert.strictEqual(mismatch.status, 400);
    assert(/Passwords must match/.test(mismatch.text));
    const short = await b.post('/updatePassword/' + token, { password: 'short', password2: 'short' });
    assert.strictEqual(short.status, 400);
    const done = await b.post('/updatePassword/' + token, { password: 'new password 1', password2: 'new password 1' });
    assert.strictEqual(done.location, '/');
    assert.strictEqual((await b.get(url)).status, 404, 'the link still works');
    await signedIn(u, 'new password 1');
  });
  await check('a reset link stops working after a day', async () => {
    const u = addUser();
    await browser().post('/passwordReset', { email: u.email });
    const url = sent[sent.length - 1].context.link.slice(SITE.length);
    db.state.now += 25 * HOUR;
    const b = browser();
    assert.strictEqual((await b.get(url)).status, 404);
    assert.strictEqual((await b.post('/updatePassword/' + url.split('/').pop(), { password: 'new password 1', password2: 'new password 1' })).status, 404);
  });
  await check('reset emails are limited per address', async () => {
    const u = addUser();
    const b = browser();
    const count = sent.length;
    for (let i = 0; i < 7; i++) { assert.strictEqual((await b.post('/passwordReset', { email: u.email })).location, '/login'); }
    assert.strictEqual(sent.length - count, 5);
  });

  console.log('lists and items');
  await check('making a list checks the name and colour, then opens it', async () => {
    const u = addUser();
    const b = await signedIn(u);
    assert.strictEqual((await b.post('/addList', { listName: 'Bad', color: 'red;}' })).status, 400);
    assert.strictEqual((await b.post('/addList', { listName: '  ', color: 'ff9900' })).status, 400);
    const r = await b.post('/home/addList', { listName: 'Party', color: '3366cc' });
    const list = db.state.lists.find((l) => l.owner === u.uname && l.list_name === 'Party');
    assert(list, 'the list was not made');
    assert.strictEqual(r.location, '/l/' + list.list_id);
    const page = await b.get(r.location);
    assert.strictEqual(page.status, 200);
    assert(/Party/.test(page.text));
  });
  await check('a list is a 404 for people it is not shared with, and for ids that do not exist', async () => {
    const owner = addUser();
    const list = addList(owner, 'Private stuff');
    const b = await signedIn(addUser());
    for (const url of ['/l/' + list.list_id, '/l/999999', '/l/abc', '/l/1%20OR%201=1']) {
      const r = await b.get(url);
      assert.strictEqual(r.status, 404, url);
      assert(!/Private stuff/.test(r.text));
    }
  });
  await check('the owner adds, ticks, unticks and deletes items', async () => {
    const u = addUser();
    const list = addList(u);
    const b = await signedIn(u);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Milk', icount: '2' })).location, '/l/' + list.list_id);
    await b.post('/l/' + list.list_id + '/addItem', { itemName: '   ' });
    const items = db.state.items.filter((i) => i.list_id === list.list_id);
    assert.strictEqual(items.length, 1, 'a blank item was added');
    assert.strictEqual(items[0].item_name, 'Milk');
    assert.strictEqual(items[0].number, 2);
    assert(/Milk/.test((await b.get('/l/' + list.list_id)).text));
    const id = items[0].sItem_id;
    await b.postJson('/l/' + list.list_id + '/crossItem', { items: id, check: 1 });
    assert.strictEqual(items[0].checked, 1);
    await b.postJson('/l/' + list.list_id + '/crossItem', { items: id, check: 0 });
    assert.strictEqual(items[0].checked, 0);
    await b.postJson('/l/' + list.list_id + '/delItem', { items: [id, 'junk'] });
    assert.strictEqual(db.state.items.filter((i) => i.list_id === list.list_id).length, 0);
  });
  await check('an item on another list cannot be ticked or deleted through your own list', async () => {
    const me = addUser();
    const mine = addList(me);
    const other = addList(addUser());
    const theirs = addItem(other, 'Theirs');
    const b = await signedIn(me);
    assert.strictEqual((await b.postJson('/l/' + mine.list_id + '/crossItem', { items: theirs.sItem_id, check: 1 })).status, 404);
    assert.strictEqual(theirs.checked, 0);
    await b.postJson('/l/' + mine.list_id + '/delItem', { items: [theirs.sItem_id] });
    assert(db.state.items.includes(theirs));
    assert.strictEqual((await b.postJson('/l/' + other.list_id + '/crossItem', { items: theirs.sItem_id, check: 1 })).status, 404);
  });
  await check('only the owner renames or deletes a list, and the colour is checked', async () => {
    const owner = addUser();
    const list = addList(owner, 'Old name');
    const stranger = await signedIn(addUser());
    assert.strictEqual((await stranger.post('/l/' + list.list_id + '/editList', { listName: 'Hacked', color: '000000' })).status, 404);
    assert.strictEqual((await stranger.postJson('/l/' + list.list_id + '/delList/', {})).status, 404);
    assert.strictEqual(findList(list.list_id).list_name, 'Old name');
    const b = await signedIn(owner);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/editList', { listName: 'New', color: '"><script>' })).status, 400);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/editList', { listName: 'New name', color: '3366cc' })).location, '/');
    assert.strictEqual(findList(list.list_id).list_name, 'New name');
    assert.strictEqual(findList(list.list_id).listColor, '3366cc');
    assert.strictEqual((await b.postJson('/l/' + list.list_id + '/delList/', { list: 1 })).location, '/');
    assert.strictEqual(findList(list.list_id), undefined);
  });
  await check('"don\'t show again" turns the list tip off for good', async () => {
    const u = addUser();
    const list = addList(u);
    const b = await signedIn(u);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/showAlert', { dontshow: 'Show' })).location, '/l/' + list.list_id);
    assert.strictEqual(findUser(u.uname).showAlert, 0);
    assert.strictEqual((await b.post('/l/abc/showAlert', {})).location, '/home');
  });

  console.log('sharing');
  await check('sharing checks the permission, the address and that you own the list', async () => {
    const owner = addUser();
    const list = addList(owner);
    const b = await signedIn(owner);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/share/', { email: 'a@example.com', perms: 'OWNER' })).status, 400);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/share/', { email: 'not-an-email', perms: 'VIEW' })).status, 400);
    const other = await signedIn(addUser());
    assert.strictEqual((await other.post('/l/' + list.list_id + '/share/', { email: 'a@example.com', perms: 'VIEW' })).status, 404);
    assert.strictEqual(db.state.pending.filter((p) => p.list_id == list.list_id).length, 0);
  });

  async function share(owner, list, friend, perms) {
    const b = await signedIn(owner);
    const r = await b.post('/l/' + list.list_id + '/share/', { email: ' ' + friend.email.toUpperCase() + ' ', perms: perms });
    assert.strictEqual(r.location, '/l/' + list.list_id);
    const mail = sent[sent.length - 1];
    assert.strictEqual(mail.to, friend.email);
    assert.strictEqual(mail.template, 'share');
    assert.strictEqual(mail.context.list, list.list_name);
    assert.deepStrictEqual(Object.keys(mail.context.share_user).sort(), ['fname', 'lname'], 'the email gets more of the user row than it needs');
    return mail.context.link.slice(SITE.length);
  }

  await check('a VIEW share: accept, then see the list but not change it', async () => {
    const owner = addUser();
    const friend = addUser();
    const list = addList(owner, 'Shared groceries');
    const item = addItem(list, 'Eggs');
    const url = await share(owner, list, friend, 'VIEW');
    const b = await signedIn(friend);
    const confirm = await b.get(url);
    assert.strictEqual(confirm.status, 200);
    assert(/Shared groceries/.test(confirm.text));
    const key = url.split('/').pop();
    const accepted = await b.post('/shareConfirmation/' + key, { confirm: 'ACCEPT' });
    assert.strictEqual(accepted.status, 200);
    assert.deepStrictEqual(db.state.shares.filter((s) => s.list_id == list.list_id).map((s) => [s.share_user, s.share_perms]), [[friend.uname, 'VIEW']]);
    assert.strictEqual((await b.get(url)).status, 404, 'the invitation can be used twice');
    assert(/Shared groceries/.test((await b.get('/home')).text), 'the list is not on the home page');
    assert.strictEqual((await b.get('/l/' + list.list_id)).status, 200);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Ham' })).status, 404);
    assert.strictEqual((await b.postJson('/l/' + list.list_id + '/crossItem', { items: item.sItem_id, check: 1 })).status, 404);
    assert.strictEqual(item.checked, 0);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/share/', { email: 'x@example.com', perms: 'EDIT' })).status, 404);
  });
  await check('an EDIT share can add and tick items but not rename or delete the list', async () => {
    const owner = addUser();
    const friend = addUser();
    const list = addList(owner, 'Team list');
    const url = await share(owner, list, friend, 'EDIT');
    const b = await signedIn(friend);
    await b.post('/shareConfirmation/' + url.split('/').pop(), { confirm: 'ACCEPT' });
    await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Bread' });
    const item = db.state.items.find((i) => i.list_id === list.list_id && i.item_name === 'Bread');
    assert(item);
    await b.postJson('/l/' + list.list_id + '/crossItem', { items: item.sItem_id, check: 1 });
    assert.strictEqual(item.checked, 1);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/editList', { listName: 'Mine now', color: 'ffffff' })).status, 404);
    assert.strictEqual((await b.postJson('/l/' + list.list_id + '/delList/', {})).status, 404);
    assert(findList(list.list_id));
  });
  await check('declining removes the invitation, and an unknown answer or key is a 404', async () => {
    const owner = addUser();
    const friend = addUser();
    const list = addList(owner);
    const key = (await share(owner, list, friend, 'VIEW')).split('/').pop();
    const b = await signedIn(friend);
    assert.strictEqual((await b.post('/shareConfirmation/' + key, { confirm: 'MAYBE' })).status, 404);
    assert.strictEqual((await b.post('/shareConfirmation/' + key, { confirm: 'DENY' })).status, 200);
    assert.strictEqual(db.state.pending.filter((p) => p.share_key === key).length, 0);
    assert.strictEqual(db.state.shares.filter((s) => s.list_id == list.list_id).length, 0);
    assert.strictEqual((await b.post('/shareConfirmation/' + key, { confirm: 'ACCEPT' })).status, 404);
    assert.strictEqual((await b.get('/share/' + 'f'.repeat(32))).status, 404);
  });
  await check('leaving a shared list removes it from you and nobody else', async () => {
    const owner = addUser();
    const list = addList(owner);
    const a = addUser();
    const c = addUser();
    db.state.shares.push({ list_id: list.list_id, share_user: a.uname, share_perms: 'VIEW' }, { list_id: list.list_id, share_user: c.uname, share_perms: 'EDIT' });
    const b = await signedIn(a);
    assert.strictEqual((await b.postJson('/l/' + list.list_id + '/unsub/', {})).status, 204);
    assert.deepStrictEqual(db.state.shares.filter((s) => s.list_id == list.list_id).map((s) => s.share_user), [c.uname]);
    assert.strictEqual((await b.get('/l/' + list.list_id)).status, 404);
  });
  await check('share emails are limited per account', async () => {
    const owner = addUser();
    const list = addList(owner);
    const b = await signedIn(owner);
    for (let i = 0; i < 20; i++) {
      assert.strictEqual((await b.post('/l/' + list.list_id + '/share/', { email: 'f' + i + '@example.com', perms: 'VIEW' })).status, 302);
    }
    assert.strictEqual((await b.post('/l/' + list.list_id + '/share/', { email: 'one-more@example.com', perms: 'VIEW' })).status, 429);
  });

  console.log('account');
  await check('the account page shows your details', async () => {
    const u = addUser();
    const r = await (await signedIn(u)).get('/myAccount');
    assert.strictEqual(r.status, 200);
    assert(r.text.includes(u.email));
    assert.strictEqual((await (await signedIn(u)).get('/home/myAccount')).status, 200);
  });
  await check('changing your name and email', async () => {
    const u = addUser();
    const taken = addUser();
    const b = await signedIn(u);
    assert.strictEqual((await b.post('/editInfo', { fname: 'Renamed', lname: 'Person' })).location, '/myAccount');
    assert.strictEqual(findUser(u.uname).fname, 'Renamed');
    assert(/Renamed/.test((await b.get('/myAccount')).text));
    assert.strictEqual((await b.post('/editInfo', { email: 'not an email' })).status, 400);
    const inUse = await b.post('/editInfo', { email: taken.email });
    assert(/already in use/.test(inUse.text));
    assert.strictEqual(findUser(u.uname).email, u.email);
    assert.strictEqual((await b.post('/editInfo', { email: ' changed@example.com ' })).location, '/myAccount');
    assert.strictEqual(findUser(u.uname).email, 'changed@example.com');
  });
  await check('changing your password needs the current one', async () => {
    const u = addUser();
    const b = await signedIn(u);
    const wrong = await b.post('/editInfo', { current_password: 'nope', password: 'brand new pw', password2: 'brand new pw' });
    assert.strictEqual(wrong.status, 400);
    assert(/current password was not correct/.test(wrong.text));
    const mismatch = await b.post('/editInfo', { current_password: 'correct horse', password: 'brand new pw', password2: 'brand new px' });
    assert.strictEqual(mismatch.status, 400);
    const short = await b.post('/editInfo', { current_password: 'correct horse', password: 'short', password2: 'short' });
    assert.strictEqual(short.status, 400);
    assert(bcrypt.compareSync('correct horse', findUser(u.uname).password), 'a refused change changed the password');
    assert.strictEqual((await b.post('/editInfo', { current_password: 'correct horse', password: 'brand new pw', password2: 'brand new pw' })).location, '/myAccount');
    await signedIn(u, 'brand new pw');
  });
  await check('guessing the current password is rate limited', async () => {
    const u = addUser();
    const b = await signedIn(u);
    for (let i = 0; i < 5; i++) { await b.post('/editInfo', { current_password: 'guess' + i, password: 'brand new pw', password2: 'brand new pw' }); }
    const r = await b.post('/editInfo', { current_password: 'correct horse', password: 'brand new pw', password2: 'brand new pw' });
    assert.strictEqual(r.status, 400);
    assert(/Too many attempts/.test(r.text));
  });

  console.log('deleting an account');
  await check('a wrong password deletes nothing', async () => {
    const u = addUser();
    addList(u);
    const b = await signedIn(u);
    const r = await b.post('/deleteAccount', { password: 'nope' });
    assert.strictEqual(r.status, 400);
    assert(/password was not correct/.test(r.text));
    assert(findUser(u.uname));
    assert.strictEqual(db.state.lists.filter((l) => l.owner === u.uname).length, 1);
    assert.strictEqual((await b.get('/home')).status, 200, 'still signed in');
  });
  await check('deleting removes the account and its lists, signs you out and retires the username', async () => {
    const u = addUser();
    const friend = addUser();
    const own = addList(u, 'Mine');
    addItem(own, 'Apples');
    const theirs = addList(friend, 'Friend list');
    const left = addItem(theirs, 'Added by the deleted user', u);
    db.state.shares.push({ list_id: theirs.list_id, share_user: u.uname, share_perms: 'EDIT' });
    db.state.shares.push({ list_id: own.list_id, share_user: friend.uname, share_perms: 'VIEW' });
    db.state.resets.push({ uname: u.uname, token: 'r'.repeat(32), added: db.state.now });
    const b = await signedIn(u);
    const other = await signedIn(u); // a second browser
    const r = await b.post('/deleteAccount', { password: 'correct horse' });
    assert.strictEqual(r.location, '/login?deleted=1');
    assert(/Your account has been deleted\./.test((await b.get(r.location)).text));
    assert.strictEqual(findUser(u.uname), undefined);
    assert.strictEqual(findList(own.list_id), undefined);
    assert.strictEqual(db.state.items.filter((i) => i.list_id === own.list_id).length, 0);
    assert.strictEqual(db.state.shares.filter((s) => s.share_user === u.uname || s.list_id === own.list_id).length, 0);
    assert.strictEqual(db.state.resets.filter((x) => x.uname === u.uname).length, 0);
    assert(findList(theirs.list_id), 'the friend\'s list went too');
    assert(db.state.items.includes(left), 'items on other people\'s lists should stay');
    assert(db.state.retired.includes(accounts.usernameHash(u.uname)));
    loginRedirect(await b.get('/home'), '/home');
    loginRedirect(await other.get('/home'), '/home');
    const again = await browser().post('/register', { fname: 'A', lname: 'B', username: u.uname, email: 'reuse@example.com', password: 'long enough', password2: 'long enough' });
    assert(/Username is already in use!/.test(again.text));
  });
  await check('a failure part way through deleting changes nothing', async () => {
    const u = addUser();
    addList(u);
    const b = await signedIn(u);
    db.state.failOn = 'DELETE FROM User WHERE uname = ?';
    let r;
    try { r = await b.post('/deleteAccount', { password: 'correct horse' }); } finally { db.state.failOn = null; }
    assert.strictEqual(r.status, 500);
    assert(findUser(u.uname));
    assert.strictEqual(db.state.lists.filter((l) => l.owner === u.uname).length, 1);
    assert(!db.state.retired.includes(accounts.usernameHash(u.uname)));
  });
  await check('guessing the password to delete the account is rate limited', async () => {
    const u = addUser();
    const b = await signedIn(u);
    for (let i = 0; i < 5; i++) { await b.post('/deleteAccount', { password: 'guess' + i }); }
    const r = await b.post('/deleteAccount', { password: 'correct horse' });
    assert.strictEqual(r.status, 400);
    assert(/Too many attempts/.test(r.text));
    assert(findUser(u.uname));
  });

  console.log('cross-site requests');
  await check('a form posted from another site is refused and changes nothing', async () => {
    const u = addUser();
    const list = addList(u);
    const b = await signedIn(u);
    const evil = { headers: { Origin: 'https://evil.example' } };
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Spam' }, evil)).status, 403);
    assert.strictEqual((await b.post('/deleteAccount', { password: 'correct horse' }, evil)).status, 403);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Spam' }, { headers: { Referer: 'https://evil.example/page' } })).status, 403);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Spam' }, { headers: { Origin: 'not a url' } })).status, 403);
    assert.strictEqual(db.state.items.filter((i) => i.list_id === list.list_id).length, 0);
    assert(findUser(u.uname));
  });
  await check('posts from the site itself, or with no Origin at all, go through', async () => {
    const u = addUser();
    const list = addList(u);
    const b = await signedIn(u);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'One' }, { headers: { Origin: SITE } })).status, 302);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Two' }, { headers: { Referer: SITE + '/l/' + list.list_id } })).status, 302);
    assert.strictEqual((await b.post('/l/' + list.list_id + '/addItem', { itemName: 'Three' })).status, 302);
    assert.strictEqual(db.state.items.filter((i) => i.list_id === list.list_id).length, 3);
  });

  console.log('errors');
  await check('a database failure is a generic 500 and the site keeps running', async () => {
    const b = await signedIn(addUser());
    db.state.failOn = 'SELECT * FROM colors';
    let r;
    try { r = await b.get('/home'); } finally { db.state.failOn = null; }
    assert.strictEqual(r.status, 500);
    assert.strictEqual(r.text, 'Something went wrong. Please try again.');
    assert.strictEqual((await b.get('/home')).status, 200);
  });

  console.log('the API inside the real app');
  await check('/api/v1 answers JSON, with no-store, and unknown endpoints are a JSON 404', async () => {
    const b = browser();
    const root = await b.get('/api/v1/');
    assert.strictEqual(root.status, 200);
    assert.strictEqual(root.json.version, 1);
    assert.strictEqual(root.headers.get('cache-control'), 'no-store');
    assert.strictEqual(root.headers.get('x-frame-options'), 'SAMEORIGIN');
    const missing = await b.get('/api/v1/nope');
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.json.error.code, 'not_found');
  });
  await check('the apps sign in from anywhere (no CSRF check), with tokens and no cookie', async () => {
    const u = addUser();
    const b = browser();
    const r = await b.postJson('/api/v1/auth/login', { username: u.uname, password: 'correct horse', deviceName: 'Test phone' }, { headers: { Origin: 'capacitor://localhost' } });
    assert.strictEqual(r.status, 200, r.text);
    assert(r.json.accessToken && r.json.refreshToken);
    assert(!b.jar.has('session'), 'the API set a website cookie');
    const me = await b.get('/api/v1/me', { headers: { Authorization: 'Bearer ' + r.json.accessToken } });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.json.user.username, u.uname);
    assert.strictEqual((await b.get('/api/v1/me')).status, 401);
  });
  await check('a website cookie does not sign you in to the API', async () => {
    const b = await signedIn(addUser());
    assert.strictEqual((await b.get('/api/v1/me')).status, 401);
  });
  await check('bad JSON is a 400 in the API\'s own error format', async () => {
    const bad = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).error.code, 'invalid_json');
  });
  await check('deleting the account from the app signs the website out too', async () => {
    const u = addUser();
    addList(u, 'From the app');
    const web = await signedIn(u);
    const app = browser();
    const token = (await app.postJson('/api/v1/auth/login', { username: u.uname, password: 'correct horse', deviceName: 'Phone' })).json.accessToken;
    const auth = { headers: { Authorization: 'Bearer ' + token } };
    const wrong = await app.request('DELETE', '/api/v1/me', Object.assign({ json: { password: 'nope' } }, auth));
    assert.strictEqual(wrong.status, 400);
    assert.strictEqual(wrong.json.error.code, 'wrong_password');
    const r = await app.request('DELETE', '/api/v1/me', Object.assign({ json: { password: 'correct horse' } }, auth));
    assert.strictEqual(r.status, 204, r.text);
    assert.strictEqual(findUser(u.uname), undefined);
    assert.strictEqual(db.state.lists.filter((l) => l.owner === u.uname).length, 0);
    assert.strictEqual((await app.get('/api/v1/me', auth)).status, 401);
    loginRedirect(await web.get('/home'), '/home');
    const login = await browser().post('/login', { username: u.uname, password: 'correct horse' });
    assert(login.location.startsWith('/login/?error='));
  });

  if (failures) {
    console.log('\nserver output:\n  ' + serverLog.slice(-30).join('\n  '));
    console.log('\n' + failures + ' check(s) failed.');
  } else {
    console.log('\nAll website checks passed.');
  }
  server.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  loud();
  console.log(e);
  process.exit(1);
});
