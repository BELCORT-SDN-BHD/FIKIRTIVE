#!/usr/bin/env bash

# Permanent red/green self-test for scripts/ci/pr-scope.sh (#809).
#
# pr-scope.sh decides whether CI runs its gates at all, so a wrong "false" is the
# worst bug this repository can have: every gate skipped, job green, code merged
# unchecked. The fixtures below pin all four directions — docs-only, mixed,
# empty, and hostile paths — plus the exact shape that broke the version this
# replaced: one code file in front of 2,999 docs files. That list is far larger
# than a pipe buffer, so the old `printf … | grep -qv '^docs/'` killed its own
# writer with SIGPIPE, returned 141 under `pipefail`, and reported "docs only".
# Any reintroduction of an early-exiting consumer turns case 5 red here.
#
# Run: bash scripts/__tests__/pr-scope.test.sh

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scope="$here/../ci/pr-scope.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failures=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ok    $label → $actual"
  else
    echo "  FAIL  $label → expected $expected, got $actual" >&2
    failures=$((failures + 1))
  fi
}

# ── docs-only diffs may short-circuit ──
printf 'docs/BLUEPRINT.md\n' >"$tmp/one-doc.txt"
check "a single docs file" false "$(bash "$scope" "$tmp/one-doc.txt")"

printf 'docs/a.md\ndocs/adr/b.md\ndocs/references/c/d.md\n' >"$tmp/all-docs.txt"
check "several docs files" false "$(bash "$scope" "$tmp/all-docs.txt")"

printf 'docs/my notes (draft) [v2].md\n' >"$tmp/docs-odd-name.txt"
check "docs path with spaces and brackets" false "$(bash "$scope" "$tmp/docs-odd-name.txt")"

# ── anything else must run every gate ──
printf 'apps/web/live.ts\ndocs/a.md\n' >"$tmp/code-first-small.txt"
check "mixed, code first" true "$(bash "$scope" "$tmp/code-first-small.txt")"

printf 'docs/a.md\napps/web/live.ts\n' >"$tmp/code-last-small.txt"
check "mixed, code last" true "$(bash "$scope" "$tmp/code-last-small.txt")"

printf 'docs/a.md\napps/web/live.ts' >"$tmp/no-trailing-newline.txt"
check "last line has no trailing newline" true "$(bash "$scope" "$tmp/no-trailing-newline.txt")"

printf 'docsite/index.html\n' >"$tmp/docs-prefix.txt"
check "docs-prefixed directory is NOT docs/" true "$(bash "$scope" "$tmp/docs-prefix.txt")"

printf 'docs\n' >"$tmp/bare-docs.txt"
check "a root file literally named docs" true "$(bash "$scope" "$tmp/bare-docs.txt")"

printf 'apps/web/it'"'"'s a "weird" *name*?.ts\n' >"$tmp/hostile-name.txt"
check "code path with quotes and glob characters" true "$(bash "$scope" "$tmp/hostile-name.txt")"

# ── the #809 fixture: 3,000 paths, well past any pipe buffer ──
{
  printf 'apps/web/live.ts\n'
  for i in $(seq 1 2999); do
    printf 'docs/references/long-directory-name/chapter-%s.md\n' "$i"
  done
} >"$tmp/big-code-first.txt"
check "3,000 paths, code file FIRST (the SIGPIPE shape)" true "$(bash "$scope" "$tmp/big-code-first.txt")"

{
  for i in $(seq 1 2999); do
    printf 'docs/references/long-directory-name/chapter-%s.md\n' "$i"
  done
  printf 'apps/web/live.ts\n'
} >"$tmp/big-code-last.txt"
check "3,000 paths, code file LAST" true "$(bash "$scope" "$tmp/big-code-last.txt")"

{
  for i in $(seq 1 3000); do
    printf 'docs/references/long-directory-name/chapter-%s.md\n' "$i"
  done
} >"$tmp/big-all-docs.txt"
check "3,000 paths, all docs" false "$(bash "$scope" "$tmp/big-all-docs.txt")"

# ── fail closed: an answer we could not derive is never "false" ──
: >"$tmp/empty.txt"
check "empty list" true "$(bash "$scope" "$tmp/empty.txt")"

printf '\n\n\n' >"$tmp/blank-lines.txt"
check "list of blank lines" true "$(bash "$scope" "$tmp/blank-lines.txt")"

check "missing file" true "$(bash "$scope" "$tmp/does-not-exist.txt")"
check "no argument" true "$(bash "$scope")"

if [[ "$failures" -ne 0 ]]; then
  echo "pr-scope: $failures case(s) failed" >&2
  exit 1
fi
echo "pr-scope: all cases passed"
