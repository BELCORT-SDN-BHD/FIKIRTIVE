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
#   1. THE GATE LIST — quality.sh runs exactly the gates named in expected_gates
#      below, no more and no fewer.
#
#      READ THIS BEFORE EDITING: that list is hand-written, and it is hand-written
#      ON PURPOSE. Everything else in this file is derived from quality.sh, which
#      means everything else agrees with quality.sh by construction — including
#      when a gate is deleted from it. Review of #874 proved the cost: with a whole
#      gate (the margin floor) cut out of quality.sh, this self-test still printed
#      OK, because a shorter list is still a self-consistent one. An independent
#      list is the only thing that can say "a gate that used to run does not run
#      any more". So ADDING OR REMOVING A GATE MEANS EDITING THIS LIST IN THE SAME
#      COMMIT. That is the design — the second edit is where a human states that
#      the change to the gates was intended, and reviewers see it in the diff.
#   2. COVERAGE — every gate in quality.sh names at least one leg, every leg name
#      it uses is real, and every declared leg is named by at least one gate. With
#      1., this is what makes the union of the five legs the whole expected gate
#      list; no leg is an empty green job.
#   3. WIRING — .github/workflows/ci.yml launches exactly the legs quality.sh
#      declares, no more and no fewer; the fan-in job reads exactly one result
#      variable per leg, each fed by that leg's own job; and the fan-in job is
#      still called `quality`, byte for byte, because that string is the required
#      check in the protect-main ruleset (bypass_actors empty) and a rename freezes
#      all merges.
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

# ── the declared legs ─────────────────────────────────────────────────────────
declaration="$(grep -E '^quality_legs=\(.*\)$' "$quality_sh" || true)"
[[ -n "$declaration" ]] || fail "quality.sh no longer declares quality_legs=(...) on one line"
declaration="${declaration#quality_legs=(}"
declaration="${declaration%)}"
read -r -a declared_legs <<<"$declaration"
(( ${#declared_legs[@]} > 0 )) || fail "quality.sh declares an empty leg list"

contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then return 0; fi
  done
  return 1
}

# ── the expected gate list ────────────────────────────────────────────────────
# The independent truth source (see 1. in the header). Order is irrelevant — the
# comparison sorts both sides, so reordering the gates in quality.sh for a faster
# first failure stays green. Names are not: a rename is a change to what the run
# proves it did, and it is red until it is stated here too.
expected_gates=(
  "skill-import fence"
  "destructive-migration fence"
  "PR-scope gate self-test"
  "quality-leg coverage self-test"
  "packages build"
  "typecheck"
  "lint"
  "otto CATALOG.md freshness"
  "margin-floor gate self-test"
  "margin floor"
  "prisma migrate deploy"
  "prisma schema drift"
  "tests"
  "web build"
)

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
  name="$(sed -n 's/^gate [^ "]* "\([^"]*\)".*/\1/p' <<<"$line")"
  [[ -n "$name" ]] || fail "this gate call names no leg (or is not quoted as expected): $line"
  [[ -n "$legs" ]] || fail "gate \"$name\" names no leg"
  actual_gates+=("$name")

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
done <<<"$gate_lines"

# ── 1. the gate list ──────────────────────────────────────────────────────────
# The gate list itself, against the hand-written expectation. Sorted, so order is
# free; compared with duplicates intact, so the same gate name twice is red too.
actual_sorted="$(printf '%s\n' ${actual_gates[@]+"${actual_gates[@]}"} | LC_ALL=C sort)"
expected_sorted="$(printf '%s\n' "${expected_gates[@]}" | LC_ALL=C sort)"
if [[ "$actual_sorted" != "$expected_sorted" ]]; then
  missing="$(LC_ALL=C comm -23 <(printf '%s\n' "$expected_sorted") <(printf '%s\n' "$actual_sorted") | sed 's/^/    - /')"
  extra="$(LC_ALL=C comm -13 <(printf '%s\n' "$expected_sorted") <(printf '%s\n' "$actual_sorted") | sed 's/^/    + /')"
  echo "quality-legs: quality.sh does not run the expected gates" >&2
  if [[ -n "$missing" ]]; then
    echo "  expected but NOT in quality.sh (a gate stopped running):" >&2
    echo "$missing" >&2
  fi
  if [[ -n "$extra" ]]; then
    echo "  in quality.sh but not expected (new or renamed gate):" >&2
    echo "$extra" >&2
  fi
  fail "the expected_gates list in this file and the gates in quality.sh disagree — if the change to the gates was intended, state it by editing expected_gates here in the same commit"
fi

# ── 2. coverage ───────────────────────────────────────────────────────────────
for leg in "${declared_legs[@]}"; do
  contains "$leg" ${legs_with_a_gate[@]+"${legs_with_a_gate[@]}"} \
    || fail "leg '$leg' has no gate of its own — CI would run a green job that checks nothing"
done

# ── 3. wiring ─────────────────────────────────────────────────────────────────
workflow_legs=()
while IFS= read -r leg; do
  [[ -n "$leg" ]] || continue
  if ! contains "$leg" ${workflow_legs[@]+"${workflow_legs[@]}"}; then
    workflow_legs+=("$leg")
  fi
done <<<"$(grep -oE -- '--leg [a-z][a-z-]*' "$workflow" | awk '{print $2}' | sort)"

(( ${#workflow_legs[@]} > 0 )) || fail "ci.yml runs no legs at all — every gate would be skipped"

for leg in "${declared_legs[@]}"; do
  contains "$leg" "${workflow_legs[@]}" \
    || fail "ci.yml never runs 'quality.sh --leg $leg' — that leg's gates would not run in CI"
done
for leg in "${workflow_legs[@]}"; do
  contains "$leg" "${declared_legs[@]}" \
    || fail "ci.yml runs 'quality.sh --leg $leg', which quality.sh does not declare — that job would die on an unknown leg"
done

# The required status check, byte for byte. It is a job `name:` and nothing else
# in this workflow may claim it.
fan_in_count="$(grep -cE '^ +name: quality$' "$workflow" || true)"
[[ "$fan_in_count" == "1" ]] \
  || fail "expected exactly one job named 'quality' in ci.yml (the fan-in, and the required check), found $fan_in_count"

# The fan-in reads FIVE FIXED IDENTITIES, not a list it counts. Each declared leg
# must appear exactly twice in that job and nowhere else: once as an environment
# variable fed by its OWN job's result, once as the comparison that names it. The
# totals at the end are what turn "each of ours is present" into "and nothing
# else is" — an extra variable, a sixth comparison, or a duplicate of one that
# exists all land over the expected count.
#
# Why this is checked here at all: inside the fan-in shell, `checks` can only ever
# be answered for by `checks`, so the wrong-PASS shapes #874's review found (a
# rogue job standing in for a missing leg; one leg wired in twice) are no longer
# expressible AT RUNTIME. What remains expressible is a mistake in the wiring
# itself — LEG_RESULT_CHECKS fed from needs.lint.result, or a comparison deleted —
# and no runtime check inside that shell can see it. It is a fact about the file,
# so it is proved against the file.
#
# `|| true` on the grep, not on the pipeline: under `set -o pipefail` a grep that
# matches nothing fails the whole pipeline, the assignment at the call site fails
# with it, and `set -e` would kill this script before it could say WHY. Zero
# matches is the most interesting answer this function has; it must be returned,
# not thrown.
occurrences() {
  { grep -oE -- "$1" "$workflow" || true; } | wc -l | tr -d '[:space:]'
}

for leg in "${declared_legs[@]}"; do
  var="LEG_RESULT_$(printf '%s' "$leg" | tr '[:lower:]' '[:upper:]' | tr -- '-' '_')"
  wired="$(occurrences "${var}:[[:space:]]+[\$][{][{][[:space:]]+needs[.]${leg}[.]result[[:space:]]+[}][}]")"
  [[ "$wired" == "1" ]] \
    || fail "ci.yml's fan-in must set '$var: \${{ needs.$leg.result }}' exactly once, found $wired — a leg whose result variable is missing, duplicated, or fed by another job's result is a leg the fan-in cannot honestly judge"
  compared="$(occurrences "leg_is[[:space:]]+${leg}[[:space:]]+\"[\$][{]${var}:-[}]\"")"
  [[ "$compared" == "1" ]] \
    || fail "ci.yml's fan-in must compare leg '$leg' exactly once, as 'leg_is $leg \"\${${var}:-}\"', found $compared"
done

wired_total="$(occurrences 'LEG_RESULT_[A-Z_]+:[[:space:]]+[$][{][{]')"
[[ "$wired_total" == "${#declared_legs[@]}" ]] \
  || fail "ci.yml's fan-in wires $wired_total result variables but quality.sh declares ${#declared_legs[@]} legs — a variable that answers for no declared leg has no business in the fan-in"
compared_total="$(occurrences '^[[:space:]]*leg_is[[:space:]]')"
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

echo "quality-legs: OK — all $gate_count expected gates are in quality.sh, legs [${declared_legs[*]}] all covered there and all launched by ci.yml, fan-in check 'quality' judges each leg by name exactly once"
