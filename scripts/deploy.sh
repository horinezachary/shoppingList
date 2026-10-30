#!/usr/bin/env bash
# Updates the production server in place: pull, install, reload under pm2.
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

if [ "${SKIP_RELOAD:-0}" = "1" ]; then
  echo "Installed. Not reloading the app (SKIP_RELOAD=1)."
  exit 0
fi

pm2 reload lorislist
