#!/usr/bin/env bash

# Decides whether a PR's changed-file list touches anything outside docs/.
#
#   usage: bash scripts/ci/pr-scope.sh <changed-file-list> <total-changed-files>
#   prints: "true"  → the diff touches code, or we cannot prove it does not;
#                     CI must run every gate
#           "false" → every changed path is under docs/ AND the list is provably
#                     complete; the gates have nothing to check
#
# This answer decides whether `quality` runs its gates at all, so the ONLY safe
# failure direction is "true". Every unclear input — no arguments, missing file,
# empty list, missing/garbled total, a total that disagrees with what we read —
# prints "true".
#
# Two hazards this exists to keep out, both of which produced a green `quality`
# over unreviewed code (#809):
#
# 1. Early-exiting pipeline consumers. The first version piped the list into
#    `grep -qv '^docs/'`. `grep -q` exits on its first match, so on a list longer
#    than the pipe buffer the writer took SIGPIPE, the pipeline returned 141 under
#    `pipefail`, and the `if` read that as "no code files". Measured: 1 code path
#    + 2,999 docs paths (154,858 bytes, code path first) → status 141 → "docs
#    only". Hence: no pipes here at all, and the list is read from a file.
#
# 2. A silently truncated list. GET /pulls/{n}/files returns at most 3,000 files
#    however hard you paginate, and says nothing about the ones it dropped. A PR
#    of 3,001 files whose only code file sorts into the tail therefore *looks*
#    docs-only. So the caller must also pass the PR's own `changed_files` count
#    and the two must agree exactly — and a PR at or past the 3,000 ceiling is
#    never trusted, because at the ceiling "complete" and "truncated" are
#    indistinguishable. Any disagreement (including exotic ones we have not
#    thought of, e.g. a rename accounted differently by the two endpoints) lands
#    on "run every gate", which costs minutes, not correctness.
#
# scripts/__tests__/pr-scope.test.sh pins every branch below.

set -euo pipefail

# GitHub's hard ceiling on GET /repos/{owner}/{repo}/pulls/{number}/files.
readonly API_FILE_CEILING=3000

note() { echo "pr-scope: $*" >&2; }

list="${1:-}"
total="${2:-}"

if [[ -z "$list" || ! -r "$list" ]]; then
  note "no readable changed-file list — running every gate"
  echo "true"
  exit 0
fi

seen=0
code=false

# No `break` on the first code path: the full count is part of the answer.
while IFS= read -r file || [[ -n "$file" ]]; do
  if [[ -z "$file" ]]; then
    continue
  fi
  seen=$((seen + 1))
  case "$file" in
    docs/*) ;;
    *) code=true ;;
  esac
done <"$list"

if [[ "$seen" -eq 0 ]]; then
  # An empty list means we never learned what changed, not that nothing changed.
  note "changed-file list is empty — running every gate"
  echo "true"
  exit 0
fi

# Plain decimal, no leading zeros, at most 7 digits. The width cap is not cosmetic:
# `[[ a -ne b ]]` evaluates both sides as shell arithmetic, which wraps modulo 2^64, so
# a 20-digit total can wrap into agreement with the handful of paths we actually read and
# buy a "false". Measured: total=18446744073709551618 against a 2-path list compared equal.
# No PR has ten million files, so anything outside this shape is garbage, not a count.
if [[ ! "$total" =~ ^(0|[1-9][0-9]{0,6})$ ]]; then
  note "no usable changed_files count (got '$total') — running every gate"
  echo "true"
  exit 0
fi

if [[ "$seen" -ne "$total" ]]; then
  note "read $seen paths but the PR reports $total changed files — the list is incomplete, running every gate"
  echo "true"
  exit 0
fi

if [[ "$total" -ge "$API_FILE_CEILING" ]]; then
  note "$total changed files is at or past the $API_FILE_CEILING-file API ceiling — the list cannot be trusted, running every gate"
  echo "true"
  exit 0
fi

echo "$code"
