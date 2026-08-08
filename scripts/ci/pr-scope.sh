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
# This file deliberately does no parsing. Four review rounds of #809 all failed
# the same way: a shell layer re-parsing projected text let some legal-but-odd
# input through and produced a WRONG "false" — every gate skipped, job green,
# code merged unreviewed. So there is no field splitting, no IFS, no quote
# handling and no string arithmetic here. jq reads the API's own JSON, and this
# script only moves bytes and refuses anything that is not, byte for byte, the
# single word `false`.

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

# `-s` slurps the (possibly paginated) pages into one array; the filter validates
# that shape rather than trusting it. A jq failure of any kind lands on "true".
verdict="$(jq -s -r --slurpfile pr "$pr" -f "$filter" -- "$files" 2>/dev/null)" || {
  note "jq could not evaluate the PR payloads — running every gate"
  echo "true"
  exit 0
}

# Byte-exact. Command substitution strips trailing newlines, so anything else at
# all — extra output, a second line, whitespace, `true`, an error string — is not
# permission to skip.
if [[ "$verdict" == "false" ]]; then
  echo "false"
else
  if [[ "$verdict" != "true" ]]; then
    note "unexpected filter output — running every gate"
  fi
  echo "true"
fi
