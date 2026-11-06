#!/usr/bin/env bash
# Prints the version of this checkout, for the page footer and GET /api/ (lib/version.js).
#
# A merge to master is tagged by .github/workflows/auto-release.yml a few seconds after it lands, so a deploy that starts
# straight away builds before its tag exists. Rather than show "1.8.5 + 4 commits", this works out the version the
# release workflow gives (or will give) each merge since the last tag, with the same rules (.github/scripts/next-version.sh,
# "[skip release]" skipped), so the footer always shows a release number.
#
# Outside master (a feature branch checked out locally) the number is followed by "-dev".
set -euo pipefail
cd "$(dirname "$0")/.."

exact=$(git describe --tags --exact-match --match 'v*' HEAD 2>/dev/null || true)
if [ -n "$exact" ]; then
  echo "$exact"
  exit 0
fi

last=$(git describe --tags --abbrev=0 --match 'v*' HEAD)
version=${last#v}
from=$last
for commit in $(git rev-list --first-parent --reverse "$last..HEAD"); do
  # Like the workflow: a skipped merge gets no number, and its changes count towards the next release.
  if git log -1 --format=%B "$commit" | grep -qF '[skip release]'; then
    continue
  fi
  version=$(.github/scripts/next-version.sh "$version" "$from..$commit")
  from=$commit
done

suffix=""
if [ "$(git rev-parse --abbrev-ref HEAD)" != "master" ] &&
   ! git merge-base --is-ancestor HEAD origin/master 2>/dev/null; then
  suffix="-dev"
fi
echo "v$version$suffix"
