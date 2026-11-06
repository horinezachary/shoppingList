// Tests for the release number: scripts/app-version.sh and .github/scripts/next-version.sh, run against a throwaway
// git repository, and lib/version.js's fallbacks. Needs git, nothing else.
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compute } = require('../lib/version');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + ((e && e.message) || e));
  }
}

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-version-'));
const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
  { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (message) => git('commit', '-q', '--allow-empty', '-m', message);
const version = () => execFileSync('bash', [path.join(dir, 'scripts', 'app-version.sh')],
  { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

fs.mkdirSync(path.join(dir, 'scripts'));
fs.mkdirSync(path.join(dir, '.github', 'scripts'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'app-version.sh'), path.join(dir, 'scripts', 'app-version.sh'));
fs.copyFileSync(path.join(root, '.github', 'scripts', 'next-version.sh'), path.join(dir, '.github', 'scripts', 'next-version.sh'));
git('init', '-q', '-b', 'master');
commit('first');
git('tag', '-a', 'v2.0.0', '-m', 'v2.0.0');

console.log('version');
check('a tagged commit is its tag', () => assert.strictEqual(version(), 'v2.0.0'));
check('a fix after the tag is the next patch', () => { commit('Fix a typo'); assert.strictEqual(version(), 'v2.0.1'); });
check('each merge counts on its own', () => { commit('Another fix'); assert.strictEqual(version(), 'v2.0.2'); });
check('"feat:" is a minor release', () => { commit('feat: something new'); assert.strictEqual(version(), 'v2.1.0'); });
check('"[skip release]" gets no number', () => { commit('Docs only [skip release]'); assert.strictEqual(version(), 'v2.1.0'); });
check('"!:" is a major release', () => { commit('feat!: drop the old API'); assert.strictEqual(version(), 'v3.0.0'); });
check('a feature branch is marked -dev', () => {
  git('checkout', '-q', '-b', 'feature');
  commit('Work in progress');
  assert.strictEqual(version(), 'v3.0.1-dev');
});
check('APP_VERSION wins', () => assert.strictEqual(compute({ APP_VERSION: 'v9.9.9' }), 'v9.9.9'));
check('lib/version.js gives a string', () => assert.ok(typeof compute({}) === 'string' && compute({}).length > 0));

fs.rmSync(dir, { recursive: true, force: true });
if (failures) {
  console.log(failures + ' failed');
  process.exit(1);
}
