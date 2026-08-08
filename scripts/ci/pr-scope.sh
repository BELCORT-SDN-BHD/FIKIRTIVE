#!/usr/bin/env bash

# Transport for scripts/ci/pr-scope.jq, which is where the decision actually lives.
#
#   usage : bash scripts/ci/pr-scope.sh <files.json> <pr.json>
#           <files.json>  raw body of GET /repos/{o}/{r}/pulls/{n}/files
#                         (with --paginate: the pages concatenated, unmodified)
#           <pr.json>     raw body of GET /repos/{o}/{r}/pulls/{n}
#   prints: "true"  → the PR touches code, or we cannot prove it does not;
#                     CI must run every gate
#           "false" → every path in the PR is under docs/ and the list is
#                     provably complete; the gates have nothing to check
#
# This file deliberately does no parsing. Five review rounds of #809 all failed
# the same way: a shell layer re-parsing projected text let some legal-but-odd
# input through and produced a WRONG "false" — every gate skipped, job green,
# code merged unreviewed. So there is no field splitting, no IFS, no quote
# handling and no string arithmetic here (that is what shrank this file from 137
# lines to 64). jq reads the API's own JSON, and this script only moves bytes
# and refuses anything that is not, byte for byte, exactly "false\n".

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
filter="$here/pr-scope.jq"

note() { echo "pr-scope: $*" >&2; }

files="${1:-}"
pr="${2:-}"

if [[ -z "$files" || ! -r "$files" || -z "$pr" || ! -r "$pr" ]]; then
  note "missing or unreadable API payloads — running every gate"
  echo "true"
  exit 0
fi

if [[ ! -r "$filter" ]]; then
  note "scripts/ci/pr-scope.jq is missing — running every gate"
  echo "true"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# `-s` slurps the (possibly paginated) pages into one array; the filter validates
# that shape rather than trusting it. A jq failure of any kind lands on "true".
if ! jq -s -r --slurpfile pr "$pr" -f "$filter" -- "$files" >"$work/verdict" 2>/dev/null; then
  note "jq could not evaluate the PR payloads — running every gate"
  echo "true"
  exit 0
fi

# Byte-exact, via a file rather than a variable. `$(…)` strips trailing newlines
# and drops NUL bytes, so "false\n\n" and "false\0" would both have compared
# equal to "false" and bought a skip. `cmp` sees every byte: the only output that
# skips the gates is exactly the six bytes f-a-l-s-e-LF.
printf 'false\n' >"$work/expected"
if cmp -s "$work/verdict" "$work/expected"; then
  echo "false"
else
  echo "true"
fi
