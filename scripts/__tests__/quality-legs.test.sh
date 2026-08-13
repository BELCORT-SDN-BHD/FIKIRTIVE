#!/usr/bin/env bash

# Self-test for the quality LEG SPLIT.
#
# CI no longer runs the gates in one job. It runs scripts/ci/quality.sh five times
# in parallel — `--leg typecheck`, `--leg tests`, `--leg build`, `--leg lint`,
# `--leg checks` — and a fan-in job named `quality` (the required status check)
# passes only when every leg passed. That is a strictly faster way to run the same
# gates, and it introduces exactly one new way to be wrong: a gate that belongs to
# NO leg, or a leg CI stops launching, stops running while `quality` stays green.
# Nothing about that failure is visible — the job is green, the log looks normal,
# and the gate is simply absent.
#
# So the facts the split rests on are checked here, against the two files that
# hold them, and this script runs as a gate itself (in the `typecheck` leg):
#
#   1. THE GATE MAP — quality.sh runs exactly the gates named in expected_gates
#      below, each on exactly the leg named there, no more and no fewer. Same for
#      the leg list itself, against expected_legs.
#
#      READ THIS BEFORE EDITING: both lists are hand-written, and they are
#      hand-written ON PURPOSE. Everything else in this file is derived from
#      quality.sh and ci.yml, which means everything else agrees with them by
#      construction — including when a gate is deleted, or moved to a leg where it
#      no longer runs. Review of #874 proved the cost twice: with a whole gate (the
#      margin floor) cut out of quality.sh this self-test still printed OK, because
#      a shorter list is still a self-consistent one; and with that same gate MOVED
#      from `checks` to `tests` it still printed OK, because a list of bare names
#      cannot say where a name runs. An independent list of "leg → gate" pairs is
#      the only thing that can say "a gate that used to run does not run any more"
#      or "a gate quietly changed legs". So ADDING, REMOVING, RENAMING OR
#      RE-LEGGING A GATE MEANS EDITING THIS LIST IN THE SAME COMMIT. That is the
#      design — the second edit is where a human states that the change to the
#      gates was intended, and reviewers see it in the diff.
#   2. COVERAGE — every gate in quality.sh names at least one leg, every leg name
#      it uses is real, and every declared leg is named by at least one gate. With
#      1., this is what makes the union of the five legs the whole expected gate
#      list; no leg is an empty green job.
#   3. WIRING — .github/workflows/ci.yml launches exactly the legs quality.sh
#      declares, no more and no fewer; the job that runs a leg IS that leg, because
#      the fan-in judges it as `needs.<leg>.result`; the fan-in reads exactly one
#      result variable per leg, each fed by that leg's own job; and the fan-in job
#      is still called `quality`, byte for byte, because that string is the required
#      check in the protect-main ruleset (bypass_actors empty) and a rename freezes
#      all merges.
#
#      ci.yml is PARSED AS YAML here, never scanned as text. Review of #874 showed
#      what the difference is worth: a text `grep` for `--leg` over the whole file
#      reads
#
#          - run: pnpm quality --leg lint      # --leg checks
#
#      as "the checks leg is launched" while the job actually runs lint, and reads
#      a correct-looking `LEG_RESULT_CHECKS: ${{ needs.checks.result }}` sitting in
#      a comment as wiring while the live line beside it is fed by
#      needs.lint.result. Both are wrong-PASSes of exactly the kind this file
#      exists to stop: the required `quality` check goes green while a gate never
#      ran. A YAML parser sees what GitHub sees — comments are gone before anything
#      is compared.
#
# Plus a unit test of the router itself (gate_runs_here, extracted and sourced
# from the real file, the same way quality-lock.drill.sh exercises the real lock
# library): a correct map routed by a broken router checks nothing either.
#
# Run: bash scripts/__tests__/quality-legs.test.sh    (well under a second)

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && cd .. && pwd)"
quality_sh="$repo_root/scripts/ci/quality.sh"
workflow="$repo_root/.github/workflows/ci.yml"

fail() {
  echo "quality-legs: FAIL — $*" >&2
  exit 1
}

[[ -r "$quality_sh" ]] || fail "cannot read $quality_sh"
[[ -r "$workflow" ]] || fail "cannot read $workflow"

contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then return 0; fi
  done
  return 1
}

count_of() {
  local needle="$1"
  shift
  local item n=0
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then n=$((n + 1)); fi
  done
  printf '%s' "$n"
}

# A gate's leg field is a set, not a sequence: `tests,checks` and `checks,tests`
# route identically, so both sides of every comparison are sorted before they meet.
normalize_legs() {
  printf '%s\n' "${1//,/ }" | tr ' ' '\n' | grep -v '^$' | LC_ALL=C sort | paste -sd, -
}

# ── the hand-written truth (see 1. in the header) ─────────────────────────────
# The legs, and every gate with the leg it runs on. Order is irrelevant — both
# comparisons sort — but names and legs are not.
expected_legs=(typecheck tests build lint checks)

expected_gates=(
  "typecheck|skill-import fence"
  "typecheck|destructive-migration fence"
  "typecheck|PR-scope gate self-test"
  "typecheck|quality-leg coverage self-test"
  "all|packages build"
  "typecheck|typecheck"
  "lint|lint"
  "checks|otto CATALOG.md freshness"
  "checks|margin-floor gate self-test"
  "checks|margin floor"
  "checks,tests|prisma migrate deploy"
  "checks|prisma schema drift"
  "tests|tests"
  "build|web build"
)

# ── the legs quality.sh declares ──────────────────────────────────────────────
declaration="$(grep -E '^quality_legs=\(.*\)$' "$quality_sh" || true)"
[[ -n "$declaration" ]] || fail "quality.sh no longer declares quality_legs=(...) on one line"
declaration="${declaration#quality_legs=(}"
declaration="${declaration%)}"
declared_legs=()
while IFS= read -r leg; do
  [[ -n "$leg" ]] || continue
  declared_legs+=("$leg")
done < <(printf '%s\n' "$declaration" | tr ' ' '\n')
(( ${#declared_legs[@]} > 0 )) || fail "quality.sh declares an empty leg list"

for leg in "${expected_legs[@]}"; do
  contains "$leg" "${declared_legs[@]}" \
    || fail "leg '$leg' is expected here but quality.sh no longer declares it — if dropping a leg was intended, say so by editing expected_legs in this file, in the same commit"
done
for leg in "${declared_legs[@]}"; do
  contains "$leg" "${expected_legs[@]}" \
    || fail "quality.sh declares leg '$leg', which this file does not expect — a new leg has to be stated in expected_legs here, in the same commit"
done

# ── the gate call sites, read once ────────────────────────────────────────────
# Only the call sites: `gate() {` and `gate_runs_here() {` do not match `^gate `.
gate_lines="$(grep -E '^gate ' "$quality_sh" || true)"
[[ -n "$gate_lines" ]] || fail "quality.sh has no gates at all"

legs_with_a_gate=()
actual_gates=()
gate_count=0
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  gate_count=$((gate_count + 1))
  legs="${line#gate }"
  legs="${legs%% *}"
  # The name is the first quoted field AFTER the legs field. A gate written in the
  # old two-argument form (`gate "name" cmd`) leaves nothing to match here, which
  # is the point: it would otherwise be read as a gate whose leg is `"name`.
  name="$(printf '%s\n' "$line" | sed -n 's/^gate [^ "]* "\([^"]*\)".*/\1/p')"
  [[ -n "$name" ]] || fail "this gate call names no leg (or is not quoted as expected): $line"
  [[ -n "$legs" ]] || fail "gate \"$name\" names no leg"
  actual_gates+=("$(normalize_legs "$legs")|$name")

  for leg in ${legs//,/ }; do
    if [[ "$leg" == "all" ]]; then
      # `all` means every declared leg, so it can never leave one uncovered — but
      # it also never PROVES a leg does anything, so it is deliberately not
      # recorded below.
      continue
    fi
    contains "$leg" "${declared_legs[@]}" \
      || fail "gate \"$name\" names leg '$leg', which quality_legs does not declare"
    if ! contains "$leg" ${legs_with_a_gate[@]+"${legs_with_a_gate[@]}"}; then
      legs_with_a_gate+=("$leg")
    fi
  done
done < <(printf '%s\n' "$gate_lines")

# ── 1. the gate map ───────────────────────────────────────────────────────────
# Every gate, with the leg it runs on, against the hand-written expectation.
# Sorted, so order in either file is free; compared with duplicates intact, so the
# same gate name twice is red too.
actual_sorted="$(printf '%s\n' ${actual_gates[@]+"${actual_gates[@]}"} | LC_ALL=C sort)"
expected_normalized=()
for pair in "${expected_gates[@]}"; do
  expected_normalized+=("$(normalize_legs "${pair%%|*}")|${pair#*|}")
done
expected_sorted="$(printf '%s\n' "${expected_normalized[@]}" | LC_ALL=C sort)"
if [[ "$actual_sorted" != "$expected_sorted" ]]; then
  missing="$(LC_ALL=C comm -23 <(printf '%s\n' "$expected_sorted") <(printf '%s\n' "$actual_sorted") | sed 's/^/    - /')"
  extra="$(LC_ALL=C comm -13 <(printf '%s\n' "$expected_sorted") <(printf '%s\n' "$actual_sorted") | sed 's/^/    + /')"
  echo "quality-legs: quality.sh does not run the expected gates on the expected legs" >&2
  echo "  (each line is 'leg[,leg]|gate name')" >&2
  if [[ -n "$missing" ]]; then
    echo "  expected but NOT in quality.sh (a gate stopped running, or moved to another leg):" >&2
    echo "$missing" >&2
  fi
  if [[ -n "$extra" ]]; then
    echo "  in quality.sh but not expected (a new gate, a renamed gate, or a gate that moved leg):" >&2
    echo "$extra" >&2
  fi
  fail "the expected_gates list in this file and the gates in quality.sh disagree — if the change to the gates was intended, state it by editing expected_gates here in the same commit"
fi

# ── 2. coverage ───────────────────────────────────────────────────────────────
for leg in "${declared_legs[@]}"; do
  contains "$leg" ${legs_with_a_gate[@]+"${legs_with_a_gate[@]}"} \
    || fail "leg '$leg' has no gate of its own — CI would run a green job that checks nothing"
done

# ── 3. wiring, read as YAML ───────────────────────────────────────────────────
# The parser is whichever real one this machine has; the first that turns ci.yml
# into JSON with a `jobs` map wins, and every query below is the same whichever it
# was. GitHub's ubuntu runners carry several of these; a laptop generally carries
# at least one. Finding none is a FAIL, never a skip — an unprovable invariant is
# not a proven one.
#
# jq does the querying. The sibling gate in this same leg
# (scripts/__tests__/pr-scope.test.sh) already requires jq and says so, so this
# adds no dependency the run did not already have.
command -v jq >/dev/null 2>&1 \
  || fail "jq is required to read ci.yml (the pr-scope self-test in this same leg needs it too). Install it: brew install jq"

workflow_json=""
yaml_parser=""
try_parser() {
  local label="$1"
  shift
  [[ -z "$workflow_json" ]] || return 0
  command -v "$1" >/dev/null 2>&1 || return 0
  local out
  out="$("$@" 2>/dev/null)" || return 0
  [[ -n "$out" ]] || return 0
  printf '%s' "$out" | jq -e 'type == "object" and (.jobs | type) == "object" and (.jobs | length) > 0' >/dev/null 2>&1 || return 0
  workflow_json="$out"
  yaml_parser="$label"
}

try_parser "python3 + PyYAML" \
  python3 -c 'import json,sys,yaml; json.dump(yaml.safe_load(open(sys.argv[1], encoding="utf-8")), sys.stdout)' "$workflow"
try_parser "ruby + psych" \
  ruby -ryaml -rjson -e 'print YAML.safe_load(File.read(ARGV[0]), aliases: true).to_json' "$workflow"
# Two different programs are called yq. mikefarah's needs `-o=json`; kislyuk's
# emits JSON already and rejects that flag. Both are tried, and the `jobs`-map
# check inside try_parser is what says which one answered.
try_parser "yq" yq -o=json '.' "$workflow"
try_parser "yq" yq '.' "$workflow"
try_parser "node + js-yaml" \
  node -e 'const fs = require("fs"), yaml = require("js-yaml"); process.stdout.write(JSON.stringify(yaml.load(fs.readFileSync(process.argv[1], "utf8"))))' "$workflow"

[[ -n "$workflow_json" ]] \
  || fail "no YAML parser on this machine, so the ci.yml wiring cannot be checked — and text-scanning it instead is exactly the wrong-PASS this gate exists to stop. Install any one of: PyYAML (pip install pyyaml), ruby, yq (brew install yq), js-yaml"

wf() { printf '%s' "$workflow_json" | jq "$@"; }

# Every `quality.sh --leg X` this workflow actually runs, as `job<TAB>leg<TAB>line`
# lines, read out of the parsed `run:` scripts. Shell comments inside those scripts
# are stripped first, for the same reason YAML comments never reach here: a leg
# named in a comment is a leg nobody runs. (Stripping from an unquoted `#` can only
# ever hide an invocation, never invent one — worst case it fails loud.) The line
# itself is carried along, whitespace-normalised, because WHAT ELSE is on it
# decides whether the leg's verdict survives the shell.
leg_invocations="$(wf -r '
  .jobs
  | to_entries[]
  | .key as $job
  | (.value.steps // [])[]
  | (.run // empty)
  | split("\n")[]
  | sub("(^|[ \t])#.*$"; "")
  | gsub("[ \t]+"; " ") | gsub("^ | $"; "")
  | . as $line
  | [scan("--leg ([A-Za-z][A-Za-z0-9_-]*)")]
  | flatten[]
  | "\($job)\t\(.)\t\($line)"
')"
[[ -n "$leg_invocations" ]] || fail "ci.yml runs no legs at all — every gate would be skipped"

invoked_legs=()
while IFS= read -r invocation; do
  [[ -n "$invocation" ]] || continue
  job="${invocation%%$'\t'*}"
  rest="${invocation#*$'\t'}"
  leg="${rest%%$'\t'*}"
  line="${rest#*$'\t'}"
  # The fan-in judges each leg as `needs.<leg>.result`, so the job that runs a leg
  # has to BE that leg. A job called `checks` running `--leg lint` reports lint's
  # outcome under the name `checks`, and the checks gates never run at all.
  [[ "$job" == "$leg" ]] \
    || fail "ci.yml job '$job' runs 'quality.sh --leg $leg' — the fan-in reads needs.$job.result, so it would report the '$leg' gates under the name '$job' while leg '$job' never ran"
  contains "$leg" "${declared_legs[@]}" \
    || fail "ci.yml runs 'quality.sh --leg $leg', which quality.sh does not declare — that job would die on an unknown leg"
  # Nothing may share the line. `pnpm quality --leg tests || true` launches the leg,
  # runs every gate, prints every failure — and hands the job a zero exit, so the
  # leg is green, the fan-in is satisfied and `quality` merges the break. A parser
  # sees that line perfectly well; only comparing the whole command notices it.
  [[ "$line" == "pnpm quality --leg $leg" ]] \
    || fail "ci.yml's '$leg' leg must run exactly 'pnpm quality --leg $leg', found '$line' — anything else on that line can swallow the leg's exit status, and a leg that cannot fail is not a gate"
  invoked_legs+=("$leg")
done < <(printf '%s\n' "$leg_invocations")

for leg in "${expected_legs[@]}"; do
  launched="$(count_of "$leg" ${invoked_legs[@]+"${invoked_legs[@]}"})"
  [[ "$launched" == "1" ]] \
    || fail "ci.yml must run 'quality.sh --leg $leg' exactly once, found $launched — a leg CI stops launching is a set of gates that stops running while 'quality' stays green"
done

# The required status check, from the parsed file. A job's check name is its
# `name:`, or its id when it has none, so both are folded before counting: nothing
# else in this workflow may claim the string the ruleset requires.
check_names="$(wf -r '.jobs | to_entries[] | (.value.name // .key)')"
fan_in_count="$(printf '%s\n' "$check_names" | grep -cx 'quality' || true)"
[[ "$fan_in_count" == "1" ]] \
  || fail "expected exactly one job reporting as 'quality' in ci.yml (the fan-in, and the required check), found $fan_in_count"
fan_in="$(wf -r '.jobs | to_entries[] | select((.value.name // .key) == "quality") | .key')"

fan_in_needs="$(wf -r --arg j "$fan_in" '.jobs[$j].needs // [] | if type == "string" then [.] else . end | .[]')"
needs_list=()
while IFS= read -r need; do
  [[ -n "$need" ]] || continue
  wf -e --arg n "$need" '.jobs | has($n)' >/dev/null \
    || fail "the fan-in waits on '$need', which is not a job in this workflow"
  needs_list+=("$need")
done < <(printf '%s\n' "$fan_in_needs")
for leg in "${declared_legs[@]}"; do
  contains "$leg" ${needs_list[@]+"${needs_list[@]}"} \
    || fail "the fan-in job does not list leg '$leg' in 'needs' — it would judge that leg on an empty result, or not wait for it at all"
done

# The fan-in reads FIVE FIXED IDENTITIES, not a list it counts. Each declared leg
# gets exactly one environment variable, fed by its OWN job's result. The total is
# what turns "each of ours is present" into "and nothing else is".
#
# Why this is checked here at all: inside the fan-in shell, `checks` can only ever
# be answered for by `checks`, so the wrong-PASS shapes #874's review found (a
# rogue job standing in for a missing leg; one leg wired in twice) are no longer
# expressible AT RUNTIME. What remains expressible is a mistake in the wiring
# itself — LEG_RESULT_CHECKS fed from needs.lint.result — and no runtime check
# inside that shell can see it. It is a fact about the file, so it is proved
# against the parsed file.
leg_result_env="$(wf -r --arg j "$fan_in" '
  [ (.jobs[$j].env // {}), ((.jobs[$j].steps // [])[] | .env // {}) ]
  | map(to_entries) | add
  | .[]
  | select(.key | startswith("LEG_RESULT_"))
  | "\(.key)\t\(.value)"
')"

env_keys=()
while IFS= read -r pair; do
  [[ -n "$pair" ]] || continue
  env_keys+=("${pair%%$'\t'*}")
done < <(printf '%s\n' "$leg_result_env")

for leg in "${declared_legs[@]}"; do
  var="LEG_RESULT_$(printf '%s' "$leg" | tr '[:lower:]' '[:upper:]' | tr -- '-' '_')"
  wired="$(count_of "$var" ${env_keys[@]+"${env_keys[@]}"})"
  [[ "$wired" == "1" ]] \
    || fail "ci.yml's fan-in must set '$var' exactly once, found $wired — a leg whose result variable is missing or duplicated is a leg the fan-in cannot honestly judge"
  value="$(printf '%s\n' "$leg_result_env" | grep -F "$var"$'\t' | head -n 1)"
  value="${value#*$'\t'}"
  if [[ ! "$value" =~ ^\$\{\{[[:space:]]*needs\.${leg}\.result[[:space:]]*\}\}$ ]]; then
    fail "ci.yml's fan-in sets '$var: $value' — it must be fed by leg '$leg' itself, as \${{ needs.$leg.result }}, or the fan-in reports another job's outcome under this leg's name"
  fi
done
[[ "${#env_keys[@]}" == "${#declared_legs[@]}" ]] \
  || fail "ci.yml's fan-in wires ${#env_keys[@]} LEG_RESULT_* variables but quality.sh declares ${#declared_legs[@]} legs — a variable that answers for no declared leg has no business in the fan-in"

# And the comparisons, in the fan-in's own shell script. Whole lines, anchored at
# both ends: a `leg_is` inside a shell comment starts with `#` and does not match,
# and a trailing comment on a real one breaks the match rather than adding to it.
fan_in_run="$(wf -r --arg j "$fan_in" '(.jobs[$j].steps // [])[] | .run // empty')"
[[ -n "$fan_in_run" ]] || fail "the fan-in job '$fan_in' runs no script at all"
for leg in "${declared_legs[@]}"; do
  var="LEG_RESULT_$(printf '%s' "$leg" | tr '[:lower:]' '[:upper:]' | tr -- '-' '_')"
  compared="$(printf '%s\n' "$fan_in_run" | grep -cE "^[[:space:]]*leg_is[[:space:]]+${leg}[[:space:]]+\"\\\$\{${var}:-\}\"[[:space:]]*$" || true)"
  [[ "$compared" == "1" ]] \
    || fail "ci.yml's fan-in must compare leg '$leg' exactly once, as 'leg_is $leg \"\${${var}:-}\"', found $compared"
done
compared_total="$(printf '%s\n' "$fan_in_run" | grep -cE '^[[:space:]]*leg_is[[:space:]]' || true)"
[[ "$compared_total" == "${#declared_legs[@]}" ]] \
  || fail "ci.yml's fan-in makes $compared_total leg comparisons but quality.sh declares ${#declared_legs[@]} legs"

# ── 4. the router ─────────────────────────────────────────────────────────────
# The real function, extracted from the real file — a copy in this test would
# drift and then prove nothing.
router="$(sed -n '/^gate_runs_here() {/,/^}$/p' "$quality_sh")"
[[ -n "$router" ]] || fail "could not extract gate_runs_here() from quality.sh"

router_says() {
  # subshell: quality_leg is set per case and must not leak into the next one
  (
    quality_leg="$1"
    eval "$router"
    gate_runs_here "$2"
  )
}

expect_router() {
  local leg="$1" legs="$2" want="$3"
  if router_says "$leg" "$legs"; then
    [[ "$want" == "runs" ]] || fail "router: leg='$leg' gate legs='$legs' ran, expected skip"
  else
    [[ "$want" == "skips" ]] || fail "router: leg='$leg' gate legs='$legs' was skipped, expected run"
  fi
}

# No leg selected — the local default — runs everything, including gates whose
# leg field nobody would ever pass on the command line.
expect_router "" "typecheck" runs
expect_router "" "all" runs
expect_router "" "tests,checks" runs
# A selected leg takes its own gates, the shared ones, and nothing else.
expect_router "typecheck" "typecheck" runs
expect_router "typecheck" "all" runs
expect_router "typecheck" "tests" skips
expect_router "checks" "tests,checks" runs
expect_router "tests" "tests,checks" runs
expect_router "build" "tests,checks" skips
# Substrings must not match: a leg named `test` must never collect the `tests`
# gates, and the comma list is a set of whole names, not a haystack.
expect_router "test" "tests" skips
expect_router "check" "tests,checks" skips
expect_router "all" "typecheck" skips

echo "quality-legs: OK — all $gate_count expected gates are in quality.sh on their expected legs, legs [${declared_legs[*]}] all covered there and all launched by ci.yml (read as YAML with $yaml_parser), fan-in check 'quality' judges each leg by name exactly once"
