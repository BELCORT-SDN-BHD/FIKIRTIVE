#!/usr/bin/env bash

# Decides whether a PR's changed-file list touches anything outside docs/.
#
#   usage: bash scripts/ci/pr-scope.sh <changed-file-list> <total-changed-files>
#   prints: "true"  → the diff touches code, or we cannot prove it does not;
#                     CI must run every gate
#           "false" → every path in the PR is under docs/ AND the list is
#                     provably complete; the gates have nothing to check
#
# This answer decides whether `quality` runs its gates at all, so the ONLY safe
# failure direction is "true". Every unclear input — no arguments, missing file,
# empty list, missing/garbled total, a total that disagrees with what we read, a
# line we cannot parse — prints "true".
#
# INPUT FORMAT: one line per changed-file entry, exactly
#
#     <filename as a JSON string><TAB><previous_filename as a JSON string>
#
# with the second field `""` when the entry is not a rename. ci.yml produces it
# with `(.filename|tojson) + "\t" + ((.previous_filename // "")|tojson)`.
# Raw paths are NOT accepted, for two reasons that each once produced a green
# `quality` over unreviewed code (#809):
#
#   * A path may legally contain a newline. A root file named "\ndocs/x.md"
#     printed raw becomes a blank line plus "docs/x.md" — one apparent path,
#     under docs/, agreeing with changed_files=1. JSON-quoting keeps every path
#     on exactly one line (a newline becomes the two characters \ and n), so a
#     line is once again an entry, and "\ndocs/x.md" no longer starts with docs/.
#     Nothing here counts lines as a proxy for anything else.
#   * A rename reports only its NEW name in `filename`. Renaming
#     apps/web/live.ts to docs/moved-live.ts looks docs-only while deleting a
#     real code path, so `previous_filename` has to travel with it and an entry
#     counts as docs-only only if BOTH names are under docs/.
#
# JSON escaping cannot manufacture a false "docs/" prefix: tojson escapes only
# `"`, `\` and control characters, and none of d, o, c, s or / is ever produced
# by an escape. A tab is escaped to \t, so a literal TAB never appears inside a
# field and the separator stays unambiguous.
#
# The other hazards this file exists to keep out:
#
#   * Early-exiting pipeline consumers. The first version piped the list into
#     `grep -qv '^docs/'`; `grep -q` exits on its first match, so on a list
#     longer than the pipe buffer the writer took SIGPIPE, the pipeline returned
#     141 under `pipefail`, and the `if` read that as "no code files". Measured:
#     1 code path + 2,999 docs paths (154,858 bytes, code path first) → 141.
#     Hence no pipes here at all; the list is read from a file.
#   * A silently truncated list. GET /pulls/{n}/files returns at most 3,000
#     entries however hard you paginate and says nothing about the rest, so the
#     caller passes the PR's own `changed_files` and the two must agree exactly.
#     A PR at or past the ceiling is never trusted, because there "complete" and
#     "truncated" look identical.
#
# scripts/__tests__/pr-scope.test.sh pins every branch below.

set -euo pipefail

# GitHub's hard ceiling on GET /repos/{owner}/{repo}/pulls/{number}/files.
readonly API_FILE_CEILING=3000

note() { echo "pr-scope: $*" >&2; }

# A JSON string literal, as produced by jq's tojson: opens and closes with a
# double quote. Anything else means the projection broke and we must not guess.
is_json_string() {
  [[ ${#1} -ge 2 && "$1" == '"'*'"' ]]
}

# True when the JSON-quoted path lies under docs/.
is_docs_path() {
  [[ "$1" == '"docs/'* ]]
}

list="${1:-}"
total="${2:-}"

if [[ -z "$list" || ! -r "$list" ]]; then
  note "no readable changed-file list — running every gate"
  echo "true"
  exit 0
fi

seen=0
code=false

# No `break` on the first code path: the full entry count is part of the answer.
while IFS=$'\t' read -r name previous extra || [[ -n "$name" ]]; do
  if [[ -z "$name" && -z "$previous" ]]; then
    continue
  fi
  seen=$((seen + 1))

  if [[ -n "$extra" ]] || ! is_json_string "$name" || ! is_json_string "$previous"; then
    note "entry $seen is not <json-name>TAB<json-previous-name> — running every gate"
    echo "true"
    exit 0
  fi

  # `""` is "this entry is not a rename". Any other previous name is a path the
  # PR removes, and it counts exactly as much as the name it moved to.
  if ! is_docs_path "$name" || { [[ "$previous" != '""' ]] && ! is_docs_path "$previous"; }; then
    code=true
  fi
done <"$list"

if [[ "$seen" -eq 0 ]]; then
  # An empty list means we never learned what changed, not that nothing changed.
  note "changed-file list is empty — running every gate"
  echo "true"
  exit 0
fi

# Plain decimal, no leading zeros, at most 7 digits. The width cap is not cosmetic:
# `[[ a -ne b ]]` evaluates both sides as shell arithmetic, which wraps modulo 2^64, so
# a 20-digit total can wrap into agreement with the handful of entries we actually read
# and buy a "false". Measured: total=18446744073709551618 against a 2-entry list compared
# equal. No PR has ten million files, so anything outside this shape is garbage.
if [[ ! "$total" =~ ^(0|[1-9][0-9]{0,6})$ ]]; then
  note "no usable changed_files count (got '$total') — running every gate"
  echo "true"
  exit 0
fi

if [[ "$seen" -ne "$total" ]]; then
  note "read $seen entries but the PR reports $total changed files — the list is incomplete, running every gate"
  echo "true"
  exit 0
fi

if [[ "$total" -ge "$API_FILE_CEILING" ]]; then
  note "$total changed files is at or past the $API_FILE_CEILING-file API ceiling — the list cannot be trusted, running every gate"
  echo "true"
  exit 0
fi

echo "$code"
