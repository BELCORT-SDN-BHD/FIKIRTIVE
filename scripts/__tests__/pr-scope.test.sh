#!/usr/bin/env bash

# Permanent red/green self-test for scripts/ci/pr-scope.jq + pr-scope.sh (#809).
#
# pr-scope decides whether CI runs its gates at all, so a wrong "false" is the
# worst bug this repository can have: every gate skipped, job green, code merged
# unreviewed. Four review rounds each found another input that produced exactly
# that, so every one of those shapes is a permanent fixture below:
#
#   round 1  a 3,000-path list, code file first — the old `printf | grep -qv`
#            took SIGPIPE and returned 141 under `pipefail`, read as "docs only"
#   round 2  a 3,001-file PR — GET .../files stops at 3,000 and never says so
#   round 3  apps/web/live.ts renamed to docs/moved-live.ts — only the new name
#            was projected, so deleting a code path looked like a docs edit
#   round 3  a root file named "<LF>docs/apparent.md" — printed raw it became a
#            blank line plus a docs/ path
#   round 4  "docs/a\q.md" (an illegal JSON escape) and previous_filename set to
#            false/null/absent — the hand-written parser waved all of them through
#
# Fixtures are raw API payloads: the files endpoint's JSON and the PR object's
# JSON, exactly as GitHub returns them. Nothing here builds an intermediate text
# format, because that format was the bug.
#
# Run: bash scripts/__tests__/pr-scope.test.sh

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "pr-scope: jq is required (it is what makes the decision). Install it: brew install jq" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scope="$here/../ci/pr-scope.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failures=0
case_no=0

# fixture <name> <files-json> <changed_files-json>
fixture() {
  # $2 is one page of the files endpoint; gh --paginate --slurp wraps pages in
  # an outer array, so that is what the filter is fed.
  printf '[%s]' "$2" >"$tmp/$1.files.json"
  printf '{"number":809,"changed_files":%s}' "$3" >"$tmp/$1.pr.json"
}

# check <expected> <name> <label>
check() {
  local expected="$1" name="$2" label="$3"
  local actual status=0
  case_no=$((case_no + 1))
  actual="$(bash "$scope" "$tmp/$name.files.json" "$tmp/$name.pr.json" 2>"$tmp/stderr")" || status=$?
  if [[ "$actual" == "$expected" && "$status" -eq 0 ]]; then
    printf '  ok    %2d. %s → %s\n' "$case_no" "$label" "$actual"
  else
    printf '  FAIL  %2d. %s → expected %s (exit 0), got %s (exit %s)\n' \
      "$case_no" "$label" "$expected" "${actual:-<empty>}" "$status" >&2
    [[ -s "$tmp/stderr" ]] && sed 's/^/          /' "$tmp/stderr" >&2
    failures=$((failures + 1))
  fi
}

# ── big payloads, built with jq so they are real JSON ──
jq -nc '[[range(2999) | {status:"modified", filename:("docs/references/long/chapter-"+(.|tostring)+".md")}]]' >"$tmp/big-docs.files.json"
printf '{"changed_files":2999}' >"$tmp/big-docs.pr.json"

jq -nc '[[{status:"modified",filename:"apps/web/live.ts"}] + [range(2998) | {status:"modified", filename:("docs/references/long/chapter-"+(.|tostring)+".md")}]]' >"$tmp/big-code-first.files.json"
printf '{"changed_files":2999}' >"$tmp/big-code-first.pr.json"

jq -nc '[[range(2998) | {status:"modified", filename:("docs/references/long/chapter-"+(.|tostring)+".md")}] + [{status:"modified",filename:"apps/web/live.ts"}]]' >"$tmp/big-code-last.files.json"
printf '{"changed_files":2999}' >"$tmp/big-code-last.pr.json"

jq -nc '[[range(3000) | {status:"modified", filename:("docs/x-"+(.|tostring)+".md")}]]' >"$tmp/at-ceiling.files.json"
printf '{"changed_files":3000}' >"$tmp/at-ceiling.pr.json"

jq -nc '[[range(3000) | {status:"modified", filename:("docs/x-"+(.|tostring)+".md")}]]' >"$tmp/truncated.files.json"
printf '{"changed_files":3001}' >"$tmp/truncated.pr.json"

# `gh api --paginate` concatenates one array per page.
printf '%s' '[[{"status":"modified","filename":"docs/p1.md"}],[{"status":"modified","filename":"docs/p2.md"}]]' >"$tmp/paginated.files.json"
printf '{"changed_files":2}' >"$tmp/paginated.pr.json"

# ══ docs-only PRs may still short-circuit ══
fixture one_doc '[{"status":"modified","filename":"docs/BLUEPRINT.md"}]' 1
check false one_doc "a single docs file"

fixture many_docs '[{"status":"modified","filename":"docs/a.md"},{"status":"added","filename":"docs/adr/b.md"},{"status":"removed","filename":"docs/refs/c/d.md"}]' 3
check false many_docs "several docs files, mixed statuses"

fixture odd_name '[{"status":"modified","filename":"docs/my notes (draft) [v2].md"}]' 1
check false odd_name "docs path with spaces and brackets"

fixture backslash_name '[{"status":"modified","filename":"docs/a\\b.md"}]' 1
check false backslash_name "docs path containing a literal backslash"

fixture newline_real '[{"status":"added","filename":"docs/we\nird.md"}]' 1
check false newline_real "newline inside a name that really is under docs/"

fixture rename_docs_docs '[{"status":"renamed","filename":"docs/b.md","previous_filename":"docs/a.md"}]' 1
check false rename_docs_docs "rename docs/a.md → docs/b.md"

fixture rename_docs_docs_nl '[{"status":"renamed","filename":"docs/b\nb.md","previous_filename":"docs/a\na.md"}]' 1
check false rename_docs_docs_nl "docs→docs rename where both names contain newlines"

check false big-docs "2,999 docs entries, count agrees"
check false paginated "two pages of docs entries (--paginate shape)"

# ══ anything touching code must run every gate ══
fixture mixed_first '[{"status":"modified","filename":"apps/web/live.ts"},{"status":"modified","filename":"docs/b.md"}]' 2
check true mixed_first "mixed, code first"

fixture mixed_last '[{"status":"modified","filename":"docs/b.md"},{"status":"modified","filename":"apps/web/live.ts"}]' 2
check true mixed_last "mixed, code last"

fixture docsite '[{"status":"modified","filename":"docsite/index.html"}]' 1
check true docsite "docs-prefixed directory is NOT docs/"

fixture bare_docs '[{"status":"modified","filename":"docs"}]' 1
check true bare_docs "a root file literally named docs"

fixture hostile '[{"status":"modified","filename":"apps/web/it'"'"'s a \"weird\" *name*?.ts"}]' 1
check true hostile "code path with quotes and glob characters"

check true big-code-first "2,999 entries, code file FIRST (the SIGPIPE shape)"
check true big-code-last "2,999 entries, code file LAST"

# ══ renames carry the path they came from ══
fixture rename_code_docs '[{"status":"renamed","filename":"docs/moved-live.ts","previous_filename":"apps/web/live.ts"}]' 1
check true rename_code_docs "rename apps/web/live.ts → docs/moved-live.ts"

fixture rename_docs_code '[{"status":"renamed","filename":"apps/web/live.ts","previous_filename":"docs/was-here.md"}]' 1
check true rename_docs_code "rename docs/was-here.md → apps/web/live.ts"

fixture rename_hidden '[{"status":"modified","filename":"docs/a.md"},{"status":"renamed","filename":"docs/moved.ts","previous_filename":"apps/web/live.ts"}]' 2
check true rename_hidden "one code→docs rename hidden among docs edits"

fixture rename_prev_nl '[{"status":"renamed","filename":"docs/ok.md","previous_filename":"\napps/web/live.ts"}]' 1
check true rename_prev_nl "rename whose previous name begins with a newline"

# Round 3's break-in: printed as raw text these became a blank line plus a
# docs/ path. As parsed JSON they are one string that does not start with docs/.
fixture newline_fake '[{"status":"added","filename":"\ndocs/apparent.md"}]' 1
check true newline_fake "root file named <LF>docs/apparent.md"

fixture tab_fake '[{"status":"added","filename":"\tdocs/apparent.md"}]' 1
check true tab_fake "root file named <TAB>docs/apparent.md"

fixture copied_code '[{"status":"copied","filename":"docs/copy.ts","previous_filename":"apps/web/live.ts"}]' 1
check true copied_code "copied from a code path into docs/"

# ══ previous_filename must be a real path, never a sentinel ══
fixture prev_false '[{"status":"renamed","filename":"docs/a.md","previous_filename":false}]' 1
check true prev_false "renamed with previous_filename: false"

fixture prev_null '[{"status":"renamed","filename":"docs/a.md","previous_filename":null}]' 1
check true prev_null "renamed with previous_filename: null"

fixture prev_absent '[{"status":"renamed","filename":"docs/a.md"}]' 1
check true prev_absent "renamed with previous_filename absent"

fixture prev_empty '[{"status":"renamed","filename":"docs/a.md","previous_filename":""}]' 1
check true prev_empty "renamed with previous_filename empty string"

fixture prev_number '[{"status":"renamed","filename":"docs/a.md","previous_filename":7}]' 1
check true prev_number "renamed with previous_filename a number"

fixture copied_absent '[{"status":"copied","filename":"docs/a.md"}]' 1
check true copied_absent "copied with previous_filename absent"

fixture prev_false_mod '[{"status":"modified","filename":"docs/a.md","previous_filename":false}]' 1
check true prev_false_mod "modified entry carrying previous_filename: false"

# ══ malformed entries are never docs-only ══
fixture dotdot '[{"status":"modified","filename":"docs/../apps/web/live.ts"}]' 1
check true dotdot "a path with a .. segment"

fixture name_number '[{"status":"modified","filename":7}]' 1
check true name_number "filename is not a string"

fixture name_empty '[{"status":"modified","filename":""}]' 1
check true name_empty "filename is an empty string"

fixture status_absent '[{"filename":"docs/a.md"}]' 1
check true status_absent "entry without a status"

fixture status_number '[{"status":3,"filename":"docs/a.md"}]' 1
check true status_number "status is not a string"

# `status` must be one of the endpoint's seven values. Anything else used to
# fall through to the non-rename branch and skip the rename checks entirely.
fixture status_empty '[{"status":"","filename":"docs/a.md"}]' 1
check true status_empty 'status is the empty string'

fixture status_bogus '[{"status":"bogus","filename":"docs/a.md"}]' 1
check true status_bogus 'status is an unknown word'

fixture status_upper '[{"status":"RENAMED","filename":"docs/a.md"}]' 1
check true status_upper 'status is RENAMED (wrong case)'

fixture status_title '[{"status":"Modified","filename":"docs/a.md"}]' 1
check true status_title 'status is Modified (wrong case)'

fixture status_space '[{"status":"renamed ","filename":"docs/a.md"}]' 1
check true status_space 'status has a trailing space'

# Every path segment must be a real name.
fixture path_trailing_slash '[{"status":"modified","filename":"docs/"}]' 1
check true path_trailing_slash 'path is "docs/" (empty last segment)'

fixture path_double_slash '[{"status":"modified","filename":"docs//a.md"}]' 1
check true path_double_slash 'path is "docs//a.md" (empty middle segment)'

fixture path_leading_slash '[{"status":"modified","filename":"/docs/a.md"}]' 1
check true path_leading_slash 'path has an empty leading segment'

fixture path_dot_segment '[{"status":"modified","filename":"docs/./a.md"}]' 1
check true path_dot_segment 'path has a "." segment'

fixture entry_string '["docs/a.md"]' 1
check true entry_string "array element is a string, not an object"

fixture entry_null '[null]' 1
check true entry_null "array element is null"

# ══ malformed payloads are never docs-only ══
printf '%s' '[[{"status":"modified","filename":"docs/a\q.md"}]]' >"$tmp/bad_escape.files.json"
printf '{"changed_files":1}' >"$tmp/bad_escape.pr.json"
check true bad_escape "illegal JSON escape in a filename"

printf '%s' '[[{"status":"modified","filename":"docs/a.md"}]' >"$tmp/unterminated.files.json"
printf '{"changed_files":1}' >"$tmp/unterminated.pr.json"
check true unterminated "unterminated JSON array"

printf '%s' '{"message":"Not Found","status":"404"}' >"$tmp/api_error.files.json"
printf '{"changed_files":1}' >"$tmp/api_error.pr.json"
check true api_error "files endpoint returned an error object"

printf '%s' '[[{"status":"modified","filename":"docs/a.md"}]]' >"$tmp/pr_error.files.json"
printf '%s' '{"message":"Not Found"}' >"$tmp/pr_error.pr.json"
check true pr_error "PR object has no changed_files"

printf '%s' '[[{"status":"modified","filename":"docs/a.md"}]]' >"$tmp/pr_junk.files.json"
printf '%s' 'not json at all' >"$tmp/pr_junk.pr.json"
check true pr_junk "PR payload is not JSON"

# ══ the count must prove the list is complete ══
fixture count_low '[{"status":"modified","filename":"docs/a.md"},{"status":"modified","filename":"docs/b.md"}]' 5
check true count_low "fewer entries than changed_files (API dropped the tail)"

fixture count_high '[{"status":"modified","filename":"docs/a.md"},{"status":"modified","filename":"docs/b.md"}]' 1
check true count_high "more entries than changed_files"

fixture count_string '[{"status":"modified","filename":"docs/a.md"}]' '"1"'
check true count_string "changed_files is a string"

fixture count_frac '[{"status":"modified","filename":"docs/a.md"}]' 1.5
check true count_frac "changed_files is fractional"

fixture count_neg '[{"status":"modified","filename":"docs/a.md"}]' -1
check true count_neg "changed_files is negative"

fixture count_null '[{"status":"modified","filename":"docs/a.md"}]' null
check true count_null "changed_files is null"

fixture count_huge '[{"status":"modified","filename":"docs/a.md"}]' 18446744073709551619
check true count_huge "changed_files is absurdly large"

# jq compares 1.0000000000000000001 unequal to 1 in one context and equal in
# another, so `floor` agreed with it and the length check let it through. The
# count is therefore validated as text, not as a float.
fixture count_near_int '[{"status":"modified","filename":"docs/a.md"}]' 1.0000000000000000001
check true count_near_int "changed_files is a hair above 1"

fixture count_near_int_lo '[{"status":"modified","filename":"docs/a.md"}]' 0.9999999999999999999
check true count_near_int_lo "changed_files is a hair below 1"

fixture count_dot_zero '[{"status":"modified","filename":"docs/a.md"}]' 1.0
check true count_dot_zero "changed_files written as 1.0"

# Two entries naming the same file satisfy a length check while hiding whatever
# the real second file was.
fixture dup_entries '[{"status":"modified","filename":"docs/a.md"},{"status":"modified","filename":"docs/a.md"}]' 2
check true dup_entries "the same path listed twice"

fixture dup_rename '[{"status":"modified","filename":"docs/a.md"},{"status":"renamed","filename":"docs/a.md","previous_filename":"docs/b.md"}]' 2
check true dup_rename "a path listed twice, once as a rename target"

check true at-ceiling "3,000 entries at the API ceiling, count agrees"
check true truncated "3,000 entries listed but the PR changed 3,001"

fixture empty_pr '[]' 0
check true empty_pr "empty PR"

# ══ missing inputs ══
check true does_not_exist "missing payload files"

case_no=$((case_no + 1))
if [[ "$(bash "$scope" 2>/dev/null)" == "true" ]]; then
  printf '  ok    %2d. no arguments at all → true\n' "$case_no"
else
  printf '  FAIL  %2d. no arguments at all\n' "$case_no" >&2
  failures=$((failures + 1))
fi

# ══ number encodings: strict JSON first, then value semantics ══
#
# jq's reader is lenient where JSON is not: it accepts `01` and hands back 1, so
# the count arrived already normalised and the text check saw a clean "1". The
# strict JSON.parse in pr-scope.sh is what rejects it. `1E0` and `1E1`, by
# contrast, ARE legal JSON; jq resolves them to their value, and the decision
# only asks whether the count equals the number of entries, so they are honoured
# as the integers they are.
printf '%s' '[[{"status":"modified","filename":"docs/a.md"}]]' >"$tmp/lead_zero.files.json"
printf '{"changed_files":01}' >"$tmp/lead_zero.pr.json"
check true lead_zero "changed_files written as 01 (not legal JSON)"

printf '%s' '[[{"status":"modified","filename":"docs/a.md"}]]' >"$tmp/exp_one.files.json"
printf '{"changed_files":1E0}' >"$tmp/exp_one.pr.json"
check false exp_one "changed_files written as 1E0 against one entry"

jq -nc '[[range(10) | {status:"modified", filename:("docs/d"+(.|tostring)+".md")}]]' >"$tmp/exp_ten.files.json"
printf '{"changed_files":1E1}' >"$tmp/exp_ten.pr.json"
check false exp_ten "changed_files written as 1E1 against ten entries"

# ══ a NUL byte is the one thing a Git path cannot contain ══
node -e 'const z=String.fromCharCode(0);require("fs").writeFileSync(process.argv[1],JSON.stringify([[{status:"modified",filename:"docs/a"+z+".md"}]]))' "$tmp/nul_path.files.json"
printf '{"changed_files":1}' >"$tmp/nul_path.pr.json"
check true nul_path "a NUL byte inside a docs/ path"

node -e 'const z=String.fromCharCode(0);require("fs").writeFileSync(process.argv[1],JSON.stringify([[{status:"renamed",filename:"docs/b.md",previous_filename:"docs/a"+z+".md"}]]))' "$tmp/nul_prev.files.json"
printf '{"changed_files":1}' >"$tmp/nul_prev.pr.json"
check true nul_prev "a NUL byte inside a rename's previous name"

fixture blank_segment '[{"status":"modified","filename":"docs/ "}]' 1
check true blank_segment 'path segment is nothing but a space'

fixture blank_segment_mid '[{"status":"modified","filename":"docs/  /a.md"}]' 1
check true blank_segment_mid 'a middle segment is nothing but spaces'

# ══ without a strict JSON parser we cannot honour the contract at all ══
case_no=$((case_no + 1))
printf '%s' '[[{"status":"modified","filename":"docs/a.md"}]]' >"$tmp/nonode.files.json"
printf '{"changed_files":1}' >"$tmp/nonode.pr.json"
# A shim that always fails stands in for "node is missing or broken" — the
# script cannot tell the difference, and must fail closed either way.
nonode_dir="$tmp/nonode-bin"; mkdir -p "$nonode_dir"
printf '#!/bin/sh\nexit 127\n' >"$nonode_dir/node"
chmod +x "$nonode_dir/node"
if [[ "$(PATH="$nonode_dir:$PATH" bash "$scope" "$tmp/nonode.files.json" "$tmp/nonode.pr.json" 2>/dev/null)" == "true" ]]; then
  printf '  ok    %2d. node unavailable → true\n' "$case_no"
else
  printf '  FAIL  %2d. node unavailable should fail closed\n' "$case_no" >&2
  failures=$((failures + 1))
fi

# ══ only the exact bytes "false\n" buy a skip ══
#
# The transport used to compare a command substitution against the word "false".
# `$(…)` strips trailing newlines and drops NUL bytes, so "false\n\n" and
# "false\0" both compared equal and would have skipped every gate. These run the
# real transport against a substituted filter that emits the forged bytes.
forged() {
  local expected="$1" label="$2" program="$3"
  local dir="$tmp/forged"
  rm -rf "$dir"; mkdir -p "$dir"
  cp "$scope" "$dir/pr-scope.sh"
  printf '%s\n' "$program" >"$dir/pr-scope.jq"
  printf '%s' '[[{"status":"modified","filename":"docs/a.md"}]]' >"$dir/f.json"
  printf '{"changed_files":1}' >"$dir/p.json"
  local actual
  case_no=$((case_no + 1))
  actual="$(bash "$dir/pr-scope.sh" "$dir/f.json" "$dir/p.json" 2>/dev/null)"
  if [[ "$actual" == "$expected" ]]; then
    printf '  ok    %2d. %s → %s\n' "$case_no" "$label" "$actual"
  else
    printf '  FAIL  %2d. %s → expected %s, got %s\n' "$case_no" "$label" "$expected" "${actual:-<empty>}" >&2
    failures=$((failures + 1))
  fi
}

forged false 'filter emits exactly false'             'false'
forged true  'filter emits false plus a blank line'   '"false\n"'
forged true  'filter emits false plus a NUL byte'     '"false\u0000"'
forged true  'filter emits false with a trailing space' '"false "'
forged true  'filter emits a leading space'           '" false"'
forged true  'filter emits false twice'               'false,false'
forged true  'filter emits falsefalse'                '"falsefalse"'
forged true  'filter emits true'                      'true'
forged true  'filter emits nothing'                   'empty'
forged true  'filter emits a quoted JSON string'      '"false" | tojson'
if [[ "$failures" -ne 0 ]]; then
  echo "pr-scope: $failures of $case_no case(s) failed" >&2
  exit 1
fi
echo "pr-scope: all $case_no cases passed"
