#!/usr/bin/env bash
# Updates the production server in place: pull, install, run the tests, apply new database migrations, reload under pm2.
# Run it on the server, from anywhere:  scripts/deploy.sh
# Set SKIP_PULL=1 to install what is already checked out, and SKIP_RELOAD=1 to stop after the install and
# leave the pm2 reload to whatever called this. The server console's release mode fetches the branch and
# reloads the app itself, so its deploy command should be:  SKIP_PULL=1 SKIP_RELOAD=1 scripts/deploy.sh
# Without SKIP_RELOAD=1 there the app is reloaded twice per deploy, and pm2 counts the second restart as unstable.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${SKIP_PULL:-0}" != "1" ]; then
  git fetch origin
  git pull
fi

npm ci --omit=dev

# The tests run before anything changes: if one fails the deploy stops here, with the database untouched and
# the app still running the old code. They need no database or dev packages. SKIP_TESTS=1 skips them, for
# an emergency only.
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  npm test
else
  echo "Skipping the tests (SKIP_TESTS=1)."
fi

# New files in migrations/ are applied before the new code runs. If one fails the deploy stops here, and
# the app keeps running the old code. The database is the one in config.js for the app's NODE_ENV: taken
# from the environment, else from the running pm2 process, else "development" as server.js does.
if [ -z "${NODE_ENV:-}" ] && command -v pm2 >/dev/null 2>&1; then
  NODE_ENV="$(pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => {
      try { const app = JSON.parse(s).find((p) => p.name === "lorislist"); process.stdout.write((app && app.pm2_env.NODE_ENV) || ""); } catch (e) {}
    });' || true)"
fi
NODE_ENV="${NODE_ENV:-development}" node scripts/migrate.js

if [ "${SKIP_RELOAD:-0}" = "1" ]; then
  echo "Installed. Not reloading the app (SKIP_RELOAD=1)."
  exit 0
fi

pm2 reload lorislist
