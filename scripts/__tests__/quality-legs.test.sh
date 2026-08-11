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
# So the two facts the split rests on are derived here, from the two files that
# hold them, and this script runs as a gate itself (in the `typecheck` leg):
#
#   1. COVERAGE — every gate in quality.sh names at least one leg, every leg name
#      it uses is real, and every declared leg is named by at least one gate. The
#      union of the legs is the whole gate list; no leg is an empty green job.
#   2. WIRING — .github/workflows/ci.yml launches exactly the legs quality.sh
#      declares, no more and no fewer, and the fan-in job is still called
#      `quality`, byte for byte, because that string is the required check in the
#      protect-main ruleset (bypass_actors empty) and a rename freezes all merges.
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

# ── 1. coverage ───────────────────────────────────────────────────────────────
# Only the call sites: `gate() {` and `gate_runs_here() {` do not match `^gate `.
gate_lines="$(grep -E '^gate ' "$quality_sh" || true)"
[[ -n "$gate_lines" ]] || fail "quality.sh has no gates at all"

legs_with_a_gate=()
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

for leg in "${declared_legs[@]}"; do
  contains "$leg" ${legs_with_a_gate[@]+"${legs_with_a_gate[@]}"} \
    || fail "leg '$leg' has no gate of its own — CI would run a green job that checks nothing"
done

# ── 2. wiring ─────────────────────────────────────────────────────────────────
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

# ── 3. the router ─────────────────────────────────────────────────────────────
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

echo "quality-legs: OK — $gate_count gates, legs [${declared_legs[*]}] all covered in quality.sh and all launched by ci.yml, fan-in check name 'quality' intact"
