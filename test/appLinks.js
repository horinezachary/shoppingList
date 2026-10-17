// Tests for lib/appLinks.js: the files that let the phone apps open invitation
// and password-reset links ("npm test" runs this). The last checks start a small
// Express app the way server.js sets it up, to prove the routes are reachable
// even though express.static skips dot-folders such as /.well-known.
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const appLinks = require('../lib/appLinks');

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

const FINGERPRINT = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const GOOD = {
  ios: { appIds: ['ABCDE12345.dev.horine.lorislist'] },
  android: { package: 'dev.horine.lorislist', sha256: [FINGERPRINT] }
};

function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: urlPath }, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: body }); });
    }).on('error', reject);
  });
}

function listen(settings) {
  const express = require('express');
  const app = express();
  appLinks.mount(app, settings);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

async function main() {
  console.log('app links');

  await check('nothing is served until the apps are configured', () => {
    assert.deepStrictEqual(appLinks.build(undefined), { apple: null, android: null });
    assert.deepStrictEqual(appLinks.build({}), { apple: null, android: null });
  });

  await check('the Apple file names the app and only the two link paths', () => {
    const apple = appLinks.build(GOOD).apple;
    assert.deepStrictEqual(apple, {
      applinks: {
        details: [{
          appIDs: ['ABCDE12345.dev.horine.lorislist'],
          components: [{ '/': '/share/*' }, { '/': '/passwordReset/*' }]
        }]
      }
    });
  });

  await check('the Android file names the package and the signing fingerprint', () => {
    const android = appLinks.build(GOOD).android;
    assert.strictEqual(android.length, 1);
    assert.deepStrictEqual(android[0].relation, ['delegate_permission/common.handle_all_urls']);
    assert.strictEqual(android[0].target.namespace, 'android_app');
    assert.strictEqual(android[0].target.package_name, 'dev.horine.lorislist');
    assert.deepStrictEqual(android[0].target.sha256_cert_fingerprints, [FINGERPRINT]);
  });

  await check('either platform can be set up without the other', () => {
    const iosOnly = appLinks.build({ ios: GOOD.ios });
    assert(iosOnly.apple && iosOnly.android === null);
    const androidOnly = appLinks.build({ android: GOOD.android });
    assert(androidOnly.android && androidOnly.apple === null);
  });

  await check('fingerprints are accepted in lower case and without colons', () => {
    const plain = FINGERPRINT.replace(/:/g, '').toLowerCase();
    const built = appLinks.build({ android: { package: 'dev.horine.lorislist', sha256: [plain] } });
    assert.deepStrictEqual(built.android[0].target.sha256_cert_fingerprints, [FINGERPRINT]);
  });

  await check('a debug and a release fingerprint can both be listed', () => {
    const other = FINGERPRINT.replace(/AA/g, '11');
    const built = appLinks.build({ android: { package: 'dev.horine.lorislist', sha256: [FINGERPRINT, other] } });
    assert.strictEqual(built.android[0].target.sha256_cert_fingerprints.length, 2);
  });

  await check('typos in the settings are reported when the server starts', () => {
    const bad = [
      { ios: { appIds: ['dev.horine.lorislist'] } },
      { ios: { appIds: ['abcde12345.dev.horine.lorislist'] } },
      { android: { package: 'lorislist', sha256: [FINGERPRINT] } },
      { android: { package: 'dev.horine.lorislist', sha256: [] } },
      { android: { package: 'dev.horine.lorislist', sha256: ['AA:BB'] } },
      { android: { sha256: [FINGERPRINT] } }
    ];
    bad.forEach(function (settings) {
      assert.throws(function () { appLinks.build(settings); }, JSON.stringify(settings));
    });
  });

  await check('the link paths match the ones the server puts in its emails', () => {
    const fs = require('fs');
    const api = fs.readFileSync(path.join(__dirname, '..', 'lib', 'api.js'), 'utf8');
    assert(api.includes("'/share/'"), 'invitation link path changed');
    assert(api.includes("'/passwordReset/'"), 'reset link path changed');
    assert.deepStrictEqual(appLinks.PATHS, ['/share/*', '/passwordReset/*']);
  });

  console.log('routes');

  await check('the files are served as JSON from the well-known paths, ahead of express.static', async () => {
    const server = await listen(GOOD);
    try {
      const port = server.address().port;
      const apple = await get(port, '/.well-known/apple-app-site-association');
      assert.strictEqual(apple.status, 200);
      assert(/^application\/json/.test(apple.headers['content-type']), apple.headers['content-type']);
      assert.strictEqual(JSON.parse(apple.body).applinks.details[0].appIDs[0], 'ABCDE12345.dev.horine.lorislist');

      const old = await get(port, '/apple-app-site-association');
      assert.strictEqual(old.status, 200);
      assert.strictEqual(old.body, apple.body);

      const android = await get(port, '/.well-known/assetlinks.json');
      assert.strictEqual(android.status, 200);
      assert(/^application\/json/.test(android.headers['content-type']));
      assert.strictEqual(JSON.parse(android.body)[0].target.package_name, 'dev.horine.lorislist');
    } finally {
      server.close();
    }
  });

  await check('without settings the same paths answer 404 instead of a made-up file', async () => {
    const server = await listen(undefined);
    try {
      const port = server.address().port;
      for (const p of ['/.well-known/apple-app-site-association', '/apple-app-site-association', '/.well-known/assetlinks.json']) {
        const res = await get(port, p);
        assert.strictEqual(res.status, 404, p);
      }
    } finally {
      server.close();
    }
  });

  console.log(failures === 0 ? '\nAll app-link checks passed.' : '\n' + failures + ' check(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
}

main();
