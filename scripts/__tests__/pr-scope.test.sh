#!/usr/bin/env bash

# Permanent red/green self-test for scripts/ci/pr-scope.sh (#809).
#
# pr-scope.sh decides whether CI runs its gates at all, so a wrong "false" is the
# worst bug this repository can have: every gate skipped, job green, code merged
# unchecked. Two shapes below are the historical ones, kept as fixtures because
# each of them once produced exactly that:
#
#   "code file FIRST"  — the list is far larger than a pipe buffer, so the
#                        original `printf … | grep -qv '^docs/'` killed its own
#                        writer with SIGPIPE, returned 141 under `pipefail`, and
#                        reported "docs only". Reintroducing any early-exiting
#                        pipeline consumer turns that case red again.
#   "API ceiling"      — GET /pulls/{n}/files stops at 3,000 files and does not
#                        say so, so a 3,001-file PR whose code file sorts into
#                        the dropped tail read as docs-only. Every case that
#                        passes a total pins the completeness check.
#
# Expected totals are written out literally rather than counted from the fixture,
# so the test cannot agree with a miscount in the script under test.
#
# Run: bash scripts/__tests__/pr-scope.test.sh

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scope="$here/../ci/pr-scope.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failures=0
case_no=0

# check <expected> <label> [args-to-pr-scope…]
check() {
  local expected="$1" label="$2"
  shift 2
  local actual status=0
  case_no=$((case_no + 1))
  actual="$(bash "$scope" "$@" 2>"$tmp/stderr")" || status=$?
  if [[ "$actual" == "$expected" && "$status" -eq 0 ]]; then
    printf '  ok    %2d. %s → %s\n' "$case_no" "$label" "$actual"
  else
    printf '  FAIL  %2d. %s → expected %s (exit 0), got %s (exit %s)\n' \
      "$case_no" "$label" "$expected" "${actual:-<empty>}" "$status" >&2
    [[ -s "$tmp/stderr" ]] && sed 's/^/          /' "$tmp/stderr" >&2
    failures=$((failures + 1))
  fi
}

# ── build the large fixtures once ──
docs_body="$tmp/docs-2998.txt"
{
  for i in $(seq 1 2998); do
    printf 'docs/references/long-directory-name/chapter-%s.md\n' "$i"
  done
} >"$docs_body"

{ printf 'apps/web/live.ts\n'; cat "$docs_body"; } >"$tmp/big-code-first.txt"          # 2,999
{ cat "$docs_body"; printf 'apps/web/live.ts\n'; } >"$tmp/big-code-last.txt"           # 2,999
{ cat "$docs_body"; printf 'docs/a/chapter-2999.md\n'; } >"$tmp/big-all-docs.txt"      # 2,999
{ cat "$tmp/big-all-docs.txt"; printf 'docs/a/chapter-3000.md\n'; } >"$tmp/at-ceiling.txt" # 3,000

# ── docs-only diffs may short-circuit ──
printf 'docs/BLUEPRINT.md\n' >"$tmp/one-doc.txt"
check false "a single docs file" "$tmp/one-doc.txt" 1

printf 'docs/a.md\ndocs/adr/b.md\ndocs/references/c/d.md\n' >"$tmp/all-docs.txt"
check false "several docs files" "$tmp/all-docs.txt" 3

printf 'docs/my notes (draft) [v2].md\n' >"$tmp/docs-odd-name.txt"
check false "docs path with spaces and brackets" "$tmp/docs-odd-name.txt" 1

check false "2,999 docs files, complete list" "$tmp/big-all-docs.txt" 2999

# ── anything else must run every gate ──
printf 'apps/web/live.ts\ndocs/a.md\n' >"$tmp/code-first-small.txt"
check true "mixed, code first" "$tmp/code-first-small.txt" 2

printf 'docs/a.md\napps/web/live.ts\n' >"$tmp/code-last-small.txt"
check true "mixed, code last" "$tmp/code-last-small.txt" 2

printf 'docs/a.md\napps/web/live.ts' >"$tmp/no-trailing-newline.txt"
check true "last line has no trailing newline" "$tmp/no-trailing-newline.txt" 2

printf 'docsite/index.html\n' >"$tmp/docs-prefix.txt"
check true "docs-prefixed directory is NOT docs/" "$tmp/docs-prefix.txt" 1

printf 'docs\n' >"$tmp/bare-docs.txt"
check true "a root file literally named docs" "$tmp/bare-docs.txt" 1

printf 'apps/web/it'"'"'s a "weird" *name*?.ts\n' >"$tmp/hostile-name.txt"
check true "code path with quotes and glob characters" "$tmp/hostile-name.txt" 1

check true "2,999 paths, code file FIRST (the SIGPIPE shape)" "$tmp/big-code-first.txt" 2999
check true "2,999 paths, code file LAST" "$tmp/big-code-last.txt" 2999

# ── an incomplete list is never docs-only ──
check true "list shorter than the PR's changed_files (API dropped the tail)" "$tmp/all-docs.txt" 4
check true "list longer than the PR's changed_files" "$tmp/all-docs.txt" 2
check true "3,000 docs paths at the API ceiling, count agrees" "$tmp/at-ceiling.txt" 3000
check true "3,000 listed but the PR changed 3,001" "$tmp/at-ceiling.txt" 3001

# ── an unusable total is never docs-only ──
check true "no total argument at all" "$tmp/all-docs.txt"
check true "empty total" "$tmp/all-docs.txt" ""
check true "non-numeric total" "$tmp/all-docs.txt" "abc"
check true "negative total" "$tmp/all-docs.txt" "-1"
check true "total with trailing junk" "$tmp/all-docs.txt" "3x"
check true "total with leading zeros" "$tmp/all-docs.txt" "003"
# 2^64 + 3. Shell arithmetic wraps this to 3, which would otherwise agree with the three
# paths in the fixture and buy a "false" — the width cap in pr-scope.sh is what stops it.
check true "total that wraps modulo 2^64 into agreement" "$tmp/all-docs.txt" "18446744073709551619"
check true "absurdly wide total" "$tmp/all-docs.txt" "99999999999999999999"

# ── fail closed: an answer we could not derive is never "false" ──
: >"$tmp/empty.txt"
check true "empty list" "$tmp/empty.txt" 0

printf '\n\n\n' >"$tmp/blank-lines.txt"
check true "list of blank lines" "$tmp/blank-lines.txt" 3

check true "missing file" "$tmp/does-not-exist.txt" 1
check true "no arguments at all"

if [[ "$failures" -ne 0 ]]; then
  echo "pr-scope: $failures of $case_no case(s) failed" >&2
  exit 1
fi
echo "pr-scope: all $case_no cases passed"
