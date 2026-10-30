// The two small files that let the phone apps open Lori's List links.
//
// The emails the server sends contain links to the website (/share/<key> for an
// invitation, /passwordReset/<token> for a password reset). Once the apps are
// installed, iOS and Android can open those links in the app instead of the
// browser, but only if this site vouches for the app:
//
//   iOS      GET /.well-known/apple-app-site-association   (Apple "universal links")
//   Android  GET /.well-known/assetlinks.json              (Google "app links")
//
// Each file names the app (its Apple Team ID + bundle id, or its package name +
// signing certificate fingerprint). Nothing here is secret, but the values are
// specific to whoever builds the apps, so they come from config.js (see
// exampleConfig.js). Until they are set the routes answer 404 and links keep
// opening the website, which is how it works today.
'use strict';

// The only paths the apps handle. Everything else on the site stays in the browser.
const PATHS = ['/share/*', '/passwordReset/*'];

const APPLE_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9][A-Za-z0-9.-]*$/;
const SHA256_FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

// "ab12..." or "AB:12:..." -> "AB:12:..." (the form Android uses), or null
function normalizeFingerprint(value) {
  if (typeof value !== 'string') { return null; }
  const hex = value.replace(/[:\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) { return null; }
  return hex.match(/../g).join(':');
}

// settings: { ios: { appIds: ['TEAMID.bundle.id'] }, android: { package: '...', sha256: ['..'] } }
// Returns { apple, android } where each is the JSON to serve, or null when that
// side is not set up. Throws on a value that is clearly a typo, so a bad config
// is noticed when the server starts instead of when a phone silently ignores it.
function build(settings) {
  const config = settings || {};
  const result = { apple: null, android: null };

  const appIds = (config.ios && config.ios.appIds) || [];
  if (appIds.length > 0) {
    appIds.forEach(function (id) {
      if (!APPLE_APP_ID.test(id)) {
        throw new Error('appLinks.ios.appIds: "' + id + '" should look like TEAMID.bundle.id (10 letters or digits, a dot, then the bundle id)');
      }
    });
    result.apple = {
      applinks: {
        details: [{
          appIDs: appIds.slice(),
          components: PATHS.map(function (path) { return { '/': path }; })
        }]
      }
    };
  }

  const android = config.android || {};
  const fingerprints = android.sha256 || [];
  if (android.package || fingerprints.length > 0) {
    if (!ANDROID_PACKAGE.test(android.package || '')) {
      throw new Error('appLinks.android.package: "' + android.package + '" is not a package name such as dev.horine.lorislist');
    }
    if (fingerprints.length === 0) {
      throw new Error('appLinks.android.sha256: add at least one SHA-256 signing certificate fingerprint');
    }
    const normalized = fingerprints.map(function (fingerprint) {
      const clean = normalizeFingerprint(fingerprint);
      if (!clean || !SHA256_FINGERPRINT.test(clean)) {
        throw new Error('appLinks.android.sha256: "' + fingerprint + '" is not a SHA-256 fingerprint (32 pairs of hex digits)');
      }
      return clean;
    });
    result.android = [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: android.package,
        sha256_cert_fingerprints: normalized
      }
    }];
  }

  return result;
}

// Adds the routes to an Express app. Call this before express.static, which
// skips dot-folders such as /.well-known.
function mount(app, settings) {
  const files = build(settings);

  function serve(body) {
    return function (req, res) {
      if (!body) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      // Both platforms fetch these over HTTPS without following redirects.
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.type('application/json').send(JSON.stringify(body));
    };
  }

  app.get(['/.well-known/apple-app-site-association', '/apple-app-site-association'], serve(files.apple));
  app.get('/.well-known/assetlinks.json', serve(files.android));
  return files;
}

module.exports = { build: build, mount: mount, normalizeFingerprint: normalizeFingerprint, PATHS: PATHS };
