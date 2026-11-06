// The release this checkout is, for the page footer and GET /api/. Worked out once, when the server starts (a deploy
// reloads it), by scripts/app-version.sh from the release tags: the tag on this commit, or else the number the
// Auto release workflow gives (or will give) it. APP_VERSION overrides it, a checkout without release tags falls back
// to git describe, and a copy outside a git checkout shows "development".
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function compute(env) {
  if (env.APP_VERSION) { return env.APP_VERSION; }
  const run = (cmd, args) => execFileSync(cmd, args, {
    cwd: root, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  try {
    return run('bash', [path.join(root, 'scripts', 'app-version.sh')]);
  } catch (e) {
    try {
      return run('git', ['describe', '--tags', '--always']);
    } catch (e2) {
      return 'development';
    }
  }
}

let cached = null;
function appVersion() {
  if (cached === null) { cached = compute(process.env); }
  return cached;
}

module.exports = { appVersion: appVersion, compute: compute };
