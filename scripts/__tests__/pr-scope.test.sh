#!/usr/bin/env bash

# Permanent red/green self-test for scripts/ci/pr-scope.sh (#809).
#
# pr-scope.sh decides whether CI runs its gates at all, so a wrong "false" is the
# worst bug this repository can have: every gate skipped, job green, code merged
# unchecked. Four shapes below are historical, kept as fixtures because each of
# them once produced exactly that:
#
#   "code file FIRST"     the list is far larger than a pipe buffer, so the
#                         original `printf … | grep -qv '^docs/'` killed its own
#                         writer with SIGPIPE, returned 141 under `pipefail`, and
#                         reported "docs only". Any early-exiting pipeline
#                         consumer reintroduced into pr-scope.sh turns it red.
#   "API ceiling"         GET /pulls/{n}/files stops at 3,000 entries without
#                         saying so, so a 3,001-file PR whose code file sorts
#                         into the dropped tail read as docs-only.
#   "rename out of code"  a rename reports only its new name, so moving
#                         apps/web/live.ts to docs/moved-live.ts read as
#                         docs-only while deleting a code path.
#   "newline in a name"   a path may legally contain a newline; printed raw, a
#                         root file named "\ndocs/apparent.md" became a blank
#                         line plus a docs/ path and read as docs-only.
#
# Input format is one line per changed-file entry:
#     <filename as a JSON string><TAB><previous_filename as a JSON string>
# with `""` as the previous name when the entry is not a rename — exactly what
# ci.yml's jq projection emits. The fixtures below are written as literal bytes
# rather than generated, so the test cannot drift into agreeing with a broken
# projection, and expected totals are literals so it cannot agree with a miscount.
#
# Run: bash scripts/__tests__/pr-scope.test.sh

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scope="$here/../ci/pr-scope.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failures=0
case_no=0
T=$'\t'

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
    printf '"docs/references/long-directory-name/chapter-%s.md"%s""\n' "$i" "$T"
  done
} >"$docs_body"

{ printf '"apps/web/live.ts"%s""\n' "$T"; cat "$docs_body"; } >"$tmp/big-code-first.txt"     # 2,999
{ cat "$docs_body"; printf '"apps/web/live.ts"%s""\n' "$T"; } >"$tmp/big-code-last.txt"      # 2,999
{ cat "$docs_body"; printf '"docs/a/chapter-2999.md"%s""\n' "$T"; } >"$tmp/big-all-docs.txt" # 2,999
{ cat "$tmp/big-all-docs.txt"; printf '"docs/a/chapter-3000.md"%s""\n' "$T"; } >"$tmp/at-ceiling.txt" # 3,000

# ── docs-only diffs may short-circuit ──
printf '"docs/BLUEPRINT.md"%s""\n' "$T" >"$tmp/one-doc.txt"
check false "a single docs file" "$tmp/one-doc.txt" 1

printf '"docs/a.md"%s""\n"docs/adr/b.md"%s""\n"docs/references/c/d.md"%s""\n' "$T" "$T" "$T" >"$tmp/all-docs.txt"
check false "several docs files" "$tmp/all-docs.txt" 3

printf '"docs/my notes (draft) [v2].md"%s""\n' "$T" >"$tmp/docs-odd-name.txt"
check false "docs path with spaces and brackets" "$tmp/docs-odd-name.txt" 1

check false "2,999 docs files, complete list" "$tmp/big-all-docs.txt" 2999

# A rename that starts and ends inside docs/ is still a docs-only diff.
printf '"docs/b.md"%s"docs/a.md"\n' "$T" >"$tmp/rename-docs-docs.txt"
check false "rename docs/a.md → docs/b.md" "$tmp/rename-docs-docs.txt" 1

# A newline inside the name, but the path really is under docs/.
printf '"docs/we\\nird.md"%s""\n' "$T" >"$tmp/newline-real-docs.txt"
check false "newline inside a name that really is under docs/" "$tmp/newline-real-docs.txt" 1

# ── anything else must run every gate ──
printf '"apps/web/live.ts"%s""\n"docs/a.md"%s""\n' "$T" "$T" >"$tmp/code-first-small.txt"
check true "mixed, code first" "$tmp/code-first-small.txt" 2

printf '"docs/a.md"%s""\n"apps/web/live.ts"%s""\n' "$T" "$T" >"$tmp/code-last-small.txt"
check true "mixed, code last" "$tmp/code-last-small.txt" 2

printf '"docs/a.md"%s""\n"apps/web/live.ts"%s""' "$T" "$T" >"$tmp/no-trailing-newline.txt"
check true "last line has no trailing newline" "$tmp/no-trailing-newline.txt" 2

printf '"docsite/index.html"%s""\n' "$T" >"$tmp/docs-prefix.txt"
check true "docs-prefixed directory is NOT docs/" "$tmp/docs-prefix.txt" 1

printf '"docs"%s""\n' "$T" >"$tmp/bare-docs.txt"
check true "a root file literally named docs" "$tmp/bare-docs.txt" 1

printf '"apps/web/it'"'"'s a \\"weird\\" *name*?.ts"%s""\n' "$T" >"$tmp/hostile-name.txt"
check true "code path with quotes and glob characters" "$tmp/hostile-name.txt" 1

check true "2,999 entries, code file FIRST (the SIGPIPE shape)" "$tmp/big-code-first.txt" 2999
check true "2,999 entries, code file LAST" "$tmp/big-code-last.txt" 2999

# ── renames carry the path they came from ──
printf '"docs/moved-live.ts"%s"apps/web/live.ts"\n' "$T" >"$tmp/rename-code-docs.txt"
check true "rename apps/web/live.ts → docs/moved-live.ts" "$tmp/rename-code-docs.txt" 1

printf '"apps/web/live.ts"%s"docs/was-here.md"\n' "$T" >"$tmp/rename-docs-code.txt"
check true "rename docs/was-here.md → apps/web/live.ts" "$tmp/rename-docs-code.txt" 1

printf '"docs/a.md"%s""\n"docs/moved-live.ts"%s"apps/web/live.ts"\n' "$T" "$T" >"$tmp/rename-among-docs.txt"
check true "one code→docs rename hidden among docs edits" "$tmp/rename-among-docs.txt" 2

# ── a newline in a name cannot fake a docs/ prefix ──
printf '"\\ndocs/apparent.md"%s""\n' "$T" >"$tmp/newline-fake-docs.txt"
check true "root file named <LF>docs/apparent.md" "$tmp/newline-fake-docs.txt" 1

printf '"\\tdocs/apparent.md"%s""\n' "$T" >"$tmp/tab-fake-docs.txt"
check true "root file named <TAB>docs/apparent.md" "$tmp/tab-fake-docs.txt" 1

printf '"docs/ok.md"%s"\\napps/web/live.ts"\n' "$T" >"$tmp/newline-in-previous.txt"
check true "rename whose previous name begins with a newline" "$tmp/newline-in-previous.txt" 1

# ── a line that is not the agreed shape is never docs-only ──
printf 'docs/a.md\n' >"$tmp/raw-path.txt"
check true "raw unquoted path (the pre-#809 format)" "$tmp/raw-path.txt" 1

printf '"docs/a.md"\n' >"$tmp/missing-previous.txt"
check true "entry missing its previous-name field" "$tmp/missing-previous.txt" 1

printf '"docs/a.md"%s""%s"extra"\n' "$T" "$T" >"$tmp/extra-field.txt"
check true "entry with a third field" "$tmp/extra-field.txt" 1

printf '"docs/a.md%s""\n' "$T" >"$tmp/unterminated.txt"
check true "unterminated JSON string" "$tmp/unterminated.txt" 1

# ── an incomplete list is never docs-only ──
check true "list shorter than the PR's changed_files (API dropped the tail)" "$tmp/all-docs.txt" 4
check true "list longer than the PR's changed_files" "$tmp/all-docs.txt" 2
check true "3,000 entries at the API ceiling, count agrees" "$tmp/at-ceiling.txt" 3000
check true "3,000 listed but the PR changed 3,001" "$tmp/at-ceiling.txt" 3001

# ── an unusable total is never docs-only ──
check true "no total argument at all" "$tmp/all-docs.txt"
check true "empty total" "$tmp/all-docs.txt" ""
check true "non-numeric total" "$tmp/all-docs.txt" "abc"
check true "negative total" "$tmp/all-docs.txt" "-1"
check true "total with trailing junk" "$tmp/all-docs.txt" "3x"
check true "total with leading zeros" "$tmp/all-docs.txt" "003"
# 2^64 + 3. Shell arithmetic wraps this to 3, which would otherwise agree with the three
# entries in the fixture and buy a "false" — the width cap in pr-scope.sh is what stops it.
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
