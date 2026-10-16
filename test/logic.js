// Tests for the small modules in lib/ that need no installed packages and no
// database ("npm test" runs this first). bcrypt is replaced by a stand-in; the
// real bcryptjs is exercised by test/smoke.js.
'use strict';

const assert = require('assert');
const passwordsLib = require('../lib/passwords');
const { createLimiter } = require('../lib/rateLimit');
const { isEmail } = require('../lib/validate');

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

// stand-in for bcrypt: "hash" is h$ + password; a non-string hash is an error,
// like the real library
function fakeBcrypt() {
  const calls = { compare: 0 };
  return {
    calls: calls,
    hash: async (pw) => 'h$' + pw,
    compare: async (pw, stored) => {
      calls.compare++;
      if (typeof stored !== 'string') { throw new Error('Illegal arguments'); }
      return stored === 'h$' + pw;
    }
  };
}
const quote = (v) => "'" + v + "'";

async function main() {
  console.log('passwords');
  const logged = [];
  const bc = fakeBcrypt();
  const pw = passwordsLib.create({ bcrypt: bc, escape: quote, rounds: 10, log: (m) => logged.push(m) });

  await check('a password stored in the current form verifies, no upgrade needed', async () => {
    assert.deepStrictEqual(await pw.verify('secret', await pw.hash('secret')), { ok: true, upgrade: false });
  });
  await check('a password stored in the older quoted form verifies and asks for an upgrade', async () => {
    const legacy = await pw.hash(quote('secret'));
    assert.deepStrictEqual(await pw.verify('secret', legacy), { ok: true, upgrade: true });
  });
  await check('a wrong password is refused in both forms', async () => {
    assert.deepStrictEqual(await pw.verify('nope', await pw.hash('secret')), { ok: false, upgrade: false });
    assert.deepStrictEqual(await pw.verify('nope', await pw.hash(quote('secret'))), { ok: false, upgrade: false });
  });
  await check('a password that is the quoted form of the real one does not match by accident', async () => {
    // someone typing  'secret'  (with quotes) must not unlock a "secret" account
    assert.strictEqual((await pw.verify(quote('secret'), await pw.hash('secret'))).ok, false);
  });
  await check('an unknown user still costs a password check and is refused', async () => {
    const before = bc.calls.compare;
    assert.deepStrictEqual(await pw.verify('anything', null), { ok: false, upgrade: false });
    assert.strictEqual(bc.calls.compare, before + 1);
  });
  await check('a stored value that is not a hash is refused, logged, and does not throw', async () => {
    assert.deepStrictEqual(await pw.verify('x', 12345), { ok: false, upgrade: false });
    assert.deepStrictEqual(await pw.verify('x', ''), { ok: false, upgrade: false });
    const bad = passwordsLib.create({
      bcrypt: { hash: async () => 'x', compare: async () => { throw new Error('boom'); } },
      escape: quote, rounds: 10, log: (m) => logged.push(m)
    });
    assert.deepStrictEqual(await bad.verify('x', 'not-a-hash'), { ok: false, upgrade: false });
    assert(logged.some((m) => m.includes('boom')), 'the error was not logged');
  });

  console.log('rate limiter');
  let clock = 1000;
  const limiter = createLimiter({ max: 3, windowMs: 60000, now: () => clock });
  await check('allows attempts until the limit is reached', () => {
    assert.strictEqual(limiter.isLimited('a'), false);
    assert.strictEqual(limiter.hit('a'), false);
    assert.strictEqual(limiter.hit('a'), false);
    assert.strictEqual(limiter.isLimited('a'), false);
    assert.strictEqual(limiter.hit('a'), true);
    assert.strictEqual(limiter.isLimited('a'), true);
  });
  await check('keys are independent', () => {
    assert.strictEqual(limiter.isLimited('b'), false);
  });
  await check('the limit lifts when the window has passed', () => {
    clock += 60001;
    assert.strictEqual(limiter.isLimited('a'), false);
    assert.strictEqual(limiter.hit('a'), false);
  });
  await check('reset clears a key (after a successful login)', () => {
    limiter.hit('c'); limiter.hit('c'); limiter.hit('c');
    assert.strictEqual(limiter.isLimited('c'), true);
    limiter.reset('c');
    assert.strictEqual(limiter.isLimited('c'), false);
  });

  console.log('email check');
  await check('accepts ordinary addresses', () => {
    for (const e of ['a@b.co', 'first.last+tag@example.com', 'x@sub.example.org']) {
      assert.strictEqual(isEmail(e), true, e);
    }
  });
  await check('rejects things that are not a single address', () => {
    const bad = ['', 'plain', 'a@b', '@b.com', 'a@.com', 'a b@c.com', 'a@b.com,c@d.com',
      'a@b.com;c@d.com', '<a@b.com>', '"a"@b.com', 'a@b.com\nBcc: x@y.com', undefined, null, 42, {},
      'a@' + 'b'.repeat(260) + '.com'];
    for (const e of bad) { assert.strictEqual(isEmail(e), false, JSON.stringify(e)); }
  });

  console.log(failures === 0 ? '\nAll logic checks passed.' : '\n' + failures + ' check(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
}

main();
