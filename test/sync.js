// Tests for live updates and safe retries: lib/idempotency.js, lib/apiEvents.js and
// their wiring in lib/apiRouter.js ("npm test" runs this). The first checks use fake
// connections; the last ones start a real Express app and read the event stream
// over HTTP.
'use strict';

const assert = require('assert');
const http = require('http');
const { EventEmitter } = require('events');
const idempotency = require('../lib/idempotency');
const apiEvents = require('../lib/apiEvents');
const apiRouter = require('../lib/apiRouter');
const { harness } = require('./api');

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a response object that records what was written
function fakeRes() {
  const res = new EventEmitter();
  res.written = '';
  res.ended = false;
  res.headers = {};
  res.statusCode = 0;
  res.status = (c) => { res.statusCode = c; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.flushHeaders = () => {};
  res.write = (t) => { res.written += t; return true; };
  res.end = () => { res.ended = true; };
  return res;
}
const messages = (res) => res.written.split('\n\n').filter((m) => m.startsWith('event: changes')).map((m) => JSON.parse(m.split('data: ')[1]));

async function main() {
  console.log('idempotency');
  await check('the same key runs the work once and returns the first answer', async () => {
    const idem = idempotency.create();
    let runs = 0;
    const work = async () => { runs++; return { status: 201, body: { n: runs } }; };
    const a = await idem.run('zed', 'POST /lists/1/items {}', 'key-12345678', work);
    const b = await idem.run('zed', 'POST /lists/1/items {}', 'key-12345678', work);
    assert.strictEqual(runs, 1);
    assert.strictEqual(a.replayed, false);
    assert.strictEqual(b.replayed, true);
    assert.deepStrictEqual(b.result, a.result);
  });
  await check('two requests with the same key at the same moment still run once', async () => {
    const idem = idempotency.create();
    let runs = 0;
    const work = async () => { runs++; await wait(20); return { status: 200, body: {} }; };
    await Promise.all([1, 2, 3].map(() => idem.run('zed', 'r', 'key-12345678', work)));
    assert.strictEqual(runs, 1);
  });
  await check('keys are per person and per request, and a missing or odd key means no protection', async () => {
    const idem = idempotency.create();
    let runs = 0;
    const work = async () => { runs++; return { status: 200 }; };
    await idem.run('zed', 'r1', 'key-12345678', work);
    await idem.run('amy', 'r1', 'key-12345678', work);
    await idem.run('zed', 'r2', 'key-12345678', work);
    await idem.run('zed', 'r1', undefined, work);
    await idem.run('zed', 'r1', 'short', work);
    await idem.run('zed', 'r1', 'has spaces in it!', work);
    assert.strictEqual(runs, 6);
  });
  await check('failures are not remembered, so the retry gets a real try', async () => {
    const idem = idempotency.create();
    let runs = 0;
    const work = async () => { runs++; if (runs === 1) { throw new Error('boom'); } return { status: 200 }; };
    await assert.rejects(() => idem.run('zed', 'r', 'key-12345678', work));
    const second = await idem.run('zed', 'r', 'key-12345678', work);
    assert.strictEqual(second.replayed, false);
    assert.strictEqual(runs, 2);
  });
  await check('answers are forgotten after a day, and the store has a size limit', async () => {
    let t = 0;
    const idem = idempotency.create({ now: () => t, ttlMs: 1000, max: 3 });
    let runs = 0;
    const work = async () => { runs++; return { status: 200 }; };
    await idem.run('zed', 'r', 'key-12345678', work);
    t = 1500;
    await idem.run('zed', 'r', 'key-12345678', work);
    assert.strictEqual(runs, 2);
    for (let i = 0; i < 10; i++) { await idem.run('zed', 'r' + i, 'key-12345678', work); }
    assert(idem.size() <= 4, 'size ' + idem.size());
  });

  console.log('event stream');
  await check('a new stream gets the current digest straight away and later edits as they happen', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id);
    const events = apiEvents.create({ api: h.api, setInterval: () => null });
    const res = fakeRes();
    const req = new EventEmitter();
    req.headers = { authorization: 'Bearer ' + zed.token };
    await events.handle(req, res, (e) => { throw e; });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.strictEqual(messages(res).length, 1);
    assert.strictEqual(messages(res)[0].lists[0].id, Number(id));
    await events.tick();
    assert.strictEqual(messages(res).length, 1, 'nothing changed, nothing sent');
    await h.call('post', '/lists/:id/items', { token: zed.token, params: { id: id }, body: { name: 'Milk' } });
    await events.tick();
    assert.strictEqual(messages(res).length, 2);
    assert.notStrictEqual(messages(res)[1].revision, messages(res)[0].revision);
  });
  await check('another device of the same person hears about it, someone else does not', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const amy = await h.member('amy');
    const second = await h.signIn('zed', 'iPad');
    const id = String((await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id);
    const events = apiEvents.create({ api: h.api, setInterval: () => null });
    async function open(token) {
      const res = fakeRes();
      const req = new EventEmitter();
      req.headers = { authorization: 'Bearer ' + token };
      await events.handle(req, res, (e) => { throw e; });
      return res;
    }
    const phone = await open(zed.token);
    const pad = await open(second.accessToken);
    const other = await open(amy.token);
    await h.call('post', '/lists/:id/items', { token: zed.token, params: { id: id }, body: { name: 'Milk' } });
    await events.tick();
    assert.strictEqual(messages(phone).length, 2);
    assert.strictEqual(messages(pad).length, 2);
    assert.strictEqual(messages(other).length, 1);
  });
  await check('quiet streams get a comment now and then so proxies keep them open', async () => {
    const h = harness();
    const zed = await h.member('zed');
    let t = 1000;
    const events = apiEvents.create({ api: h.api, now: () => t, setInterval: () => null, pingMs: 15000 });
    const res = fakeRes();
    const req = new EventEmitter();
    req.headers = { authorization: 'Bearer ' + zed.token };
    await events.handle(req, res, (e) => { throw e; });
    t += 5000; await events.tick();
    assert(!res.written.includes(': ping'));
    t += 11000; await events.tick();
    assert(res.written.includes(': ping'));
  });
  await check('a stream ends after its maximum age and when its sign-in is revoked', async () => {
    const h = harness();
    const zed = await h.member('zed');
    let t = 1000;
    const events = apiEvents.create({ api: h.api, now: () => t, setInterval: () => null, maxAgeMs: 600000, recheckMs: 30000 });
    const old = fakeRes();
    const oldReq = new EventEmitter();
    oldReq.headers = { authorization: 'Bearer ' + zed.token };
    await events.handle(oldReq, old, (e) => { throw e; });
    t += 601000;
    await events.tick();
    assert(old.ended && old.written.includes('event: bye'));
    assert.strictEqual(events.open(), 0);

    const fresh = fakeRes();
    const freshReq = new EventEmitter();
    freshReq.headers = { authorization: 'Bearer ' + zed.token };
    await events.handle(freshReq, fresh, (e) => { throw e; });
    await h.call('post', '/auth/logout', { token: zed.token });
    t += 31000;
    await events.tick();
    assert(fresh.ended, 'signed-out device must stop receiving');
    assert.strictEqual(events.open(), 0);
  });
  await check('limits: a few streams per person, and a bad token is turned away', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const events = apiEvents.create({ api: h.api, setInterval: () => null, maxPerUser: 2 });
    const errors = [];
    for (let i = 0; i < 3; i++) {
      const req = new EventEmitter();
      req.headers = { authorization: 'Bearer ' + zed.token };
      await events.handle(req, fakeRes(), (e) => errors.push(e));
    }
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].status, 429);
    const bad = new EventEmitter();
    bad.headers = { authorization: 'Bearer nope' };
    await events.handle(bad, fakeRes(), (e) => errors.push(e));
    assert.strictEqual(errors[1].status, 401);
  });
  await check('closing the connection frees its place', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const events = apiEvents.create({ api: h.api, setInterval: () => null });
    const req = new EventEmitter();
    req.headers = { authorization: 'Bearer ' + zed.token };
    const res = fakeRes();
    await events.handle(req, res, (e) => { throw e; });
    assert.strictEqual(events.open(), 1);
    res.emit('close');
    assert.strictEqual(events.open(), 0);
  });

  console.log('over HTTP');
  async function serve(h) {
    const express = require('express');
    const app = express();
    const events = apiEvents.create({ api: h.api, pollMs: 50, pingMs: 100000 });
    app.use('/api/v1', apiRouter.create(express, h.api, { events: events, idempotency: idempotency.create() }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return { server: server, port: server.address().port, events: events };
  }
  function request(port, method, urlPath, options) {
    options = options || {};
    return new Promise((resolve, reject) => {
      const body = options.body ? JSON.stringify(options.body) : null;
      const headers = Object.assign({}, options.headers || {});
      if (body) { headers['Content-Type'] = 'application/json'; }
      const req = http.request({ host: '127.0.0.1', port: port, method: method, path: '/api/v1' + urlPath, headers: headers }, (res) => {
        if (options.stream) { return resolve({ res: res, req: req }); }
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  await check('a repeated write with the same Idempotency-Key adds one item', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = (await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id;
    const web = await serve(h);
    try {
      const send = () => request(web.port, 'POST', '/lists/' + id + '/items', {
        headers: { Authorization: 'Bearer ' + zed.token, 'Idempotency-Key': 'offline-add-0001' },
        body: { name: 'Milk', count: 2 }
      });
      const first = await send();
      const second = await send();
      assert.strictEqual(first.status, 201);
      assert.strictEqual(second.status, 201);
      assert.deepStrictEqual(second.body, first.body);
      assert.strictEqual(second.headers['idempotent-replay'], 'true');
      assert.strictEqual(first.headers['idempotent-replay'], undefined);
      assert.strictEqual(h.db.state.items.length, 1);
      const third = await request(web.port, 'POST', '/lists/' + id + '/items', {
        headers: { Authorization: 'Bearer ' + zed.token }, body: { name: 'Milk', count: 2 }
      });
      assert.strictEqual(third.status, 201);
      assert.strictEqual(h.db.state.items.length, 2, 'without a key every request counts');
    } finally { web.server.close(); }
  });
  await check('the live stream sends the digest, then an update after an edit made through the API', async () => {
    const h = harness();
    const zed = await h.member('zed');
    const id = (await h.call('post', '/lists', { token: zed.token, body: { name: 'Food', color: 'ff9900' } })).body.list.id;
    const web = await serve(h);
    let stream;
    try {
      stream = await request(web.port, 'GET', '/events', { stream: true, headers: { Authorization: 'Bearer ' + zed.token } });
      assert.strictEqual(stream.res.statusCode, 200);
      assert(/text\/event-stream/.test(stream.res.headers['content-type']));
      let text = '';
      stream.res.on('data', (c) => { text += c; });
      for (let i = 0; i < 40 && !text.includes('event: changes'); i++) { await wait(25); }
      assert(text.includes('retry: 5000'));
      assert.strictEqual((text.match(/event: changes/g) || []).length, 1);
      await request(web.port, 'POST', '/lists/' + id + '/items', {
        headers: { Authorization: 'Bearer ' + zed.token }, body: { name: 'Milk' }
      });
      for (let i = 0; i < 60 && (text.match(/event: changes/g) || []).length < 2; i++) { await wait(25); }
      assert.strictEqual((text.match(/event: changes/g) || []).length, 2, text);
    } finally {
      if (stream) { stream.req.destroy(); }
      await wait(30);
      web.server.close();
    }
    assert.strictEqual(web.events.open(), 0, 'the server noticed the app went away');
  });
  await check('the stream refuses a missing token with a JSON error', async () => {
    const h = harness();
    const web = await serve(h);
    try {
      const r = await request(web.port, 'GET', '/events');
      assert.strictEqual(r.status, 401);
      assert.strictEqual(r.body.error.code, 'unauthorized');
    } finally { web.server.close(); }
  });

  console.log(failures === 0 ? '\nAll sync checks passed.' : '\n' + failures + ' check(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
}

main();
