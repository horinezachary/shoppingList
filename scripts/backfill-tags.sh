#!/usr/bin/env bash
# One-off (Nov 6, 2026): makes the back-dated release tags listed in .github/workflows/backfill-releases.yml and pushes them in
# one go. Run it from an up-to-date checkout of master on your own computer:  scripts/backfill-tags.sh
#
# Why not in Actions: GitHub refuses to let a workflow's token create a tag on a commit whose workflow files differ from
# master's. Your own login may. Pushing more than three tags at once starts no workflows, so this runs no CI. Afterwards run
# "Backfill releases" from the Actions tab, which publishes a release for each tag. Tags that already exist are left alone.
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch --quiet --tags origin
# The Oct 30 release was published by hand as v2.0.0 and is re-tagged v1.5.0 (Nov 6). Its tag must be gone first, or the
# next release would count from it.
if [ -n "$(git ls-remote --tags origin refs/tags/v2.0.0)" ]; then
  echo "v2.0.0 still exists on GitHub. Delete it first:  gh release delete v2.0.0 --cleanup-tag --yes" >&2
  exit 1
fi
if git rev-parse -q --verify refs/tags/v2.0.0 >/dev/null; then
  git tag -d v2.0.0 >/dev/null
  echo "Removed your local copy of the old v2.0.0 tag."
fi
list=$(sed -n "/releases='/,/^ *'$/p" .github/workflows/backfill-releases.yml | sed "1d;\$d;s/^ *//" | grep '|')
made=()
while IFS='|' read -r tag commit title; do
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "$tag already exists"
    continue
  fi
  sha=$(git rev-parse "$commit^{commit}")
  # Back-dated: the tag carries the date of the merge, not today's.
  GIT_COMMITTER_DATE="$(git show -s --format=%cI "$sha")" git tag -a "$tag" "$sha" -m "$tag: $title"
  made+=("refs/tags/$tag")
done <<< "$list"

if [ "${#made[@]}" -eq 0 ]; then
  echo "Nothing to push."
  exit 0
fi
if [ "${#made[@]}" -le 3 ]; then
  echo "Note: pushing three tags or fewer at once starts CI for each of them."
fi
git push origin "${made[@]}"
echo "Pushed ${#made[@]} tags. Now run Backfill releases from the Actions tab."
