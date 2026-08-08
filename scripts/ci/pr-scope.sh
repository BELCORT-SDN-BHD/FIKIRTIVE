#!/usr/bin/env bash

# Decides whether a PR's changed-file list touches anything outside docs/.
#
#   usage: bash scripts/ci/pr-scope.sh <path-to-file-with-one-changed-path-per-line>
#   prints: "true"  → the diff touches code; CI must run every gate
#           "false" → every changed path is under docs/; the gates are a no-op
#
# This answer decides whether `quality` runs its gates at all, so the ONLY safe
# failure direction is "true". Anything unclear — no argument, missing file,
# empty list, unreadable list — prints "true".
#
# Why this is a script and not two lines of shell inside ci.yml (#809):
# the version this replaces piped the list into `grep -qv '^docs/'`. `grep -q`
# exits the moment it finds its first match, so on a list longer than the pipe
# buffer the writer got SIGPIPE, the pipeline returned 141 under `pipefail`, and
# the `if` read that as "no code files" — a PR that changed code was declared
# docs-only and every gate was skipped while the job stayed green. Measured:
# 1 code path + 2,999 docs paths (154,858 bytes, code path first) → status 141.
# So: no pipes here at all. The list is read from a file, and no consumer can
# die under a producer. scripts/__tests__/pr-scope.test.sh holds that shape as a
# permanent fixture.

set -euo pipefail

list="${1:-}"

if [[ -z "$list" || ! -r "$list" ]]; then
  echo "true"
  exit 0
fi

saw_any=false
code=false

while IFS= read -r file || [[ -n "$file" ]]; do
  if [[ -z "$file" ]]; then
    continue
  fi
  saw_any=true
  case "$file" in
    docs/*) ;;
    *)
      code=true
      break
      ;;
  esac
done <"$list"

if [[ "$saw_any" != true ]]; then
  # An empty list means we never learned what changed, not that nothing changed.
  echo "true"
  exit 0
fi

echo "$code"
