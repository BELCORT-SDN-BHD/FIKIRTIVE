#!/usr/bin/env bash

# Writes .github/ci-workflow.lock from .github/workflows/ci.yml.
#
# The lock is one line — `<sha256>  .github/workflows/ci.yml` — and every job in
# ci.yml re-derives that digest as its own step #2, before any setup, install or
# `$GITHUB_ENV` write can reach it. A ci.yml edit without this regeneration fails
# that step in `scope` first, which leaves the five legs `skipped` and the required
# `quality` check RED — not mergeable. (Not "seven red jobs": the legs carry
# `needs: scope`, and a job that never starts reports `skipped`, not `failure`.)
#
# What regenerating the lock does NOT do is bless the change. The digest says the
# workflow that ran is the workflow that was committed; it says nothing about whether
# the committed one still runs the gates. #874 r10 skipped every gate by editing one
# repository script this workflow RUNS, and r12 did it with a project `.npmrc` that no
# file here mentions — both with a green lock. So this comment no longer claims that a
# bypass has to touch ci.yml; what a bypass has to do is appear in the PR's diff, and
# review is what reads it. See the tripwire note at the top of ci.yml.
#
# Run after any intended change to ci.yml, in the same commit:
#     bash scripts/ci/ci-workflow-lock.sh
#
# --check verifies instead of writing (what scripts/__tests__/quality-legs.test.sh
# and the drill use), and exits non-zero when the two disagree.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow_rel=".github/workflows/ci.yml"
lock_rel=".github/ci-workflow.lock"
workflow="$repo_root/$workflow_rel"
lock="$repo_root/$lock_rel"

[[ -r "$workflow" ]] || { echo "ci-workflow-lock: cannot read $workflow_rel" >&2; exit 1; }

# The runner has coreutils' sha256sum; macOS has shasum. Both print the digest first.
digest_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    echo "ci-workflow-lock: no sha256sum and no shasum on this machine" >&2
    exit 1
  fi
}

digest="$(digest_of "$workflow")"
[[ "${#digest}" == "64" ]] || { echo "ci-workflow-lock: '$digest' is not a sha256 digest" >&2; exit 1; }

if [[ "${1:-}" == "--check" ]]; then
  [[ -r "$lock" ]] || { echo "ci-workflow-lock: $lock_rel is missing" >&2; exit 1; }
  want="$(cut -d' ' -f1 "$lock")"
  if [[ "$want" != "$digest" ]]; then
    echo "ci-workflow-lock: $lock_rel pins $want, but $workflow_rel is $digest" >&2
    exit 1
  fi
  echo "ci-workflow-lock: OK — $lock_rel matches $workflow_rel ($digest)"
  exit 0
fi

printf '%s  %s\n' "$digest" "$workflow_rel" >"$lock"
echo "ci-workflow-lock: wrote $lock_rel — $digest"
