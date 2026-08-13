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
#      the fan-in judges it as `needs.<leg>.result`; each leg's job runs exactly the
#      script `pnpm quality --leg <leg>` and nothing else, because anything sharing
#      that script can swallow the leg's exit status; the fan-in waits on every leg,
#      reads exactly one result variable per leg, each fed by that leg's own job; and
#      the fan-in job is still called `quality`, byte for byte, because that string
#      is the required check in the protect-main ruleset (bypass_actors empty) and a
#      rename freezes all merges.
#
#      AND THE SHAPE OF THE JOB AROUND THAT SCRIPT — because a command that is
#      present in the file is not a command that runs. Review of #874 found three
#      more wrong-PASSes of exactly that kind, and not one of them alters the leg's
#      command by a single character:
#
#        - `if: ${{ false }}` on the step — the command never executes, and a job
#          all of whose steps succeeded (because none of them ran anything) is a
#          green job;
#        - `continue-on-error: true` on the step — the leg fails, loudly, in the log,
#          and the job still reports success;
#        - the command wrapped in `if false; then … fi` inside the script — never
#          executed, and under the Bash semantics Actions runs `run:` with, a script
#          whose last thing was a false `if` exits 0.
#
#      Each of the three leaves `needs.<leg>.result` at `success`, and the fan-in —
#      which can read nothing but that result — has nothing to object to. So the
#      WHOLE run script is compared against what a leg is supposed to run, not a line
#      found inside it; every job's `if:` is compared against a hand-written
#      condition (expected_jobs below); and no step of any job in this workflow may
#      carry `if`, `continue-on-error`, `shell` or `working-directory` — the four keys
#      that decide whether a command runs at all and whether its failure reaches the
#      job — nor may any job carry `continue-on-error`, `strategy` or `defaults`.
#
#      The fan-in's own script is not only read, it is RUN, against a synthetic
#      environment, once for every way each leg can come back un-green. It is the
#      same three shapes one level up: a fan-in step that is skipped, or excused, or
#      whose comparisons sit inside a branch nothing takes, reports success while
#      judging nothing — and `quality` is the required check, so that is a green
#      merge button over a red repository. Reading the file says the comparison is
#      written. Only running it says the comparison is reached.
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
# EVERY check below is written to fail closed: each one names the answer that passes
# and treats anything else — including the empty string a failed `jq` leaves behind —
# as a failure. Nothing here may take the shape "collect the problems, pass if the
# list came back empty", because then one broken query is a silent all-clear. That
# shape was written during #874 r4 and reverted: a single jq error made nine of these
# checks pass at once, and the file's own mutation drill is what caught it.
#
# Run: bash scripts/__tests__/quality-legs.test.sh
# (a few seconds — a couple of hundred short-lived jq and bash processes, most of
# them the fan-in drill in 3c, which runs the real verdict script 32 times)

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

# The environment variable the fan-in reads a leg's result from. One definition, used
# everywhere the name is needed — three copies of this would be three chances to drift.
leg_result_var_for() {
  printf 'LEG_RESULT_%s' "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -- '-' '_')"
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

# Every job ci.yml may contain, with the exact `if:` it must carry — hand-written
# for the same reason the gate map is, and for a sharper one. `if:` is the single
# key that decides whether a job's commands run AT ALL, and a job that does not run
# reports `skipped`, never `failure`. So a drifted condition is not a broken build,
# it is a gate that quietly stopped being one. Both directions are compared: a job
# that vanishes from ci.yml and a job that appears in it are each red until someone
# states the change here, in the same commit.
#
# `<job>|` with nothing after the bar means "this job must carry no `if:` at all".
expected_jobs=(
  "scope|github.event_name != 'pull_request' || github.event.pull_request.draft == false"
  "typecheck|needs.scope.outputs.code != 'false'"
  "tests|needs.scope.outputs.code != 'false'"
  "build|needs.scope.outputs.code != 'false'"
  "lint|needs.scope.outputs.code != 'false'"
  "checks|needs.scope.outputs.code != 'false'"
  "quality|always() && (github.event_name != 'pull_request' || github.event.pull_request.draft == false)"
)

# Keys that decide whether a step's command is executed, and whether its failure is
# allowed to reach the job. None of them belongs anywhere in this workflow; each of
# them, on the one step that runs a leg, is a silent wrong-PASS.
forbidden_step_keys=(if continue-on-error shell working-directory)
# The same question at job level. `defaults` carries `run.shell`, which replaces the
# interpreter and the flags every `run:` below it is executed with.
forbidden_job_keys=(continue-on-error strategy defaults)

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

# Every `quality.sh --leg X` this workflow actually runs, as `job<TAB>step index<TAB>leg`
# records, read out of the parsed `run:` scripts. Shell comments inside those scripts
# are stripped BEFORE the search, for the same reason YAML comments never reach here:
# a leg named in a comment is a leg nobody runs. (Stripping from an unquoted `#` can
# only ever hide an invocation, never invent one — worst case it fails loud.) What
# is carried forward is the step's ADDRESS, not the matching line, because the line
# is not what the runner executes: the whole script is, and the rest of it decides
# whether the leg's verdict survives.
leg_invocations="$(wf -r '
  .jobs
  | to_entries[]
  | .key as $job
  | (.value.steps // []) | to_entries[]
  | .key as $index
  | (.value.run // empty)
  | split("\n") | map(sub("(^|[ \t])#.*$"; "")) | join("\n")
  | [scan("--leg ([A-Za-z][A-Za-z0-9_-]*)")]
  | flatten
  | unique[]
  | "\($job)\t\($index)\t\(.)"
')"
[[ -n "$leg_invocations" ]] || fail "ci.yml runs no legs at all — every gate would be skipped"

invoked_legs=()
while IFS= read -r invocation; do
  [[ -n "$invocation" ]] || continue
  job="${invocation%%$'\t'*}"
  rest="${invocation#*$'\t'}"
  index="${rest%%$'\t'*}"
  leg="${rest#*$'\t'}"
  # The fan-in judges each leg as `needs.<leg>.result`, so the job that runs a leg
  # has to BE that leg. A job called `checks` running `--leg lint` reports lint's
  # outcome under the name `checks`, and the checks gates never run at all.
  [[ "$job" == "$leg" ]] \
    || fail "ci.yml job '$job' runs 'quality.sh --leg $leg' — the fan-in reads needs.$job.result, so it would report the '$leg' gates under the name '$job' while leg '$job' never ran"
  contains "$leg" "${declared_legs[@]}" \
    || fail "ci.yml runs 'quality.sh --leg $leg', which quality.sh does not declare — that job would die on an unknown leg"
  # THE WHOLE SCRIPT, byte for byte, against the one command a leg is supposed to be.
  # Not the line the leg name was found on — the script around that line is shell, and
  # shell decides both whether the line is reached and what the step's exit status ends
  # up being. `pnpm quality --leg tests || true` launches the leg, runs every gate,
  # prints every failure, and hands the job a zero exit. `if false; then pnpm quality
  # --leg tests; fi` never launches it at all and also exits zero. Both leave a line
  # that reads perfectly; only the whole script tells them from the real thing.
  #
  # The expectation is a literal written here, built from a hand-written leg name —
  # nothing about it is read back out of ci.yml, so agreeing with ci.yml is not
  # something it can do by construction.
  run_script="$(wf -r --arg j "$job" --argjson i "$index" '.jobs[$j].steps[$i].run')"
  expected_run="pnpm quality --leg $leg"
  if [[ "$run_script" != "$expected_run" ]]; then
    echo "quality-legs: ci.yml's '$leg' leg must run exactly this script, and nothing else:" >&2
    printf '    %s\n' "$expected_run" >&2
    echo "  what step #$((index + 1)) of job '$job' actually runs:" >&2
    printf '%s\n' "$run_script" | sed 's/^/    /' >&2
    fail "the '$leg' leg's run script is not exactly 'pnpm quality --leg $leg' — anything else in that script can stop the leg from running, or stop its failure from reaching the job, and a leg that cannot fail is not a gate"
  fi
  invoked_legs+=("$leg")
done < <(printf '%s\n' "$leg_invocations")

for leg in "${expected_legs[@]}"; do
  launched="$(count_of "$leg" ${invoked_legs[@]+"${invoked_legs[@]}"})"
  [[ "$launched" == "1" ]] \
    || fail "ci.yml must run 'quality.sh --leg $leg' exactly once, found $launched — a leg CI stops launching is a set of gates that stops running while 'quality' stays green"
done

# The last link in the chain ci.yml starts. `pnpm quality` is a NAME; what it
# resolves to lives in package.json, and everything above this line would be just as
# green if that line said `true`. `bash scripts/ci/quality.sh || true` there greens
# all five legs at once — every leg's script still byte-perfect, every condition
# still holding, the fan-in still handed five honest `success` results. It is the
# same wrong-PASS as `|| true` in ci.yml, one file further along, so it is pinned in
# the same way: a literal, written here.
package_json="$repo_root/package.json"
[[ -r "$package_json" ]] || fail "cannot read $package_json"
quality_script="$(jq -r '.scripts.quality // ""' "$package_json")"
[[ "$quality_script" == "bash scripts/ci/quality.sh" ]] \
  || fail "package.json's 'quality' script must be exactly 'bash scripts/ci/quality.sh', found '${quality_script:-<missing>}' — that is what every 'pnpm quality --leg …' in ci.yml resolves to, so anything else there is five legs running something that is not the gates"
for hook in prequality postquality; do
  [[ "$(jq -r --arg h "$hook" '(.scripts // {}) | has($h)' "$package_json")" == "false" ]] \
    || fail "package.json defines a '$hook' script — a leg must run the gates and nothing else"
done

# ── 3b. and nothing may stop those scripts running, or eat their failure ──────
# The command is right. Now: does it run, and does its failure arrive? Three keys
# answer that, and all three are invisible in the command itself — `if:` (the step
# or the job is skipped, and skipped is not failed), `continue-on-error:` (it failed
# and the job says success anyway), and the shell the script is handed to (`shell:`
# on a step, `defaults.run.shell` on a job or on the workflow, either of which
# replaces both the interpreter and the flags it runs with). `working-directory:`
# rides along with them, because a script that runs somewhere else is not the script
# this file believes it is; `strategy:` because a matrix turns one job into several
# under other names, and `needs.<leg>.result` then answers for none of them
# individually.
#
# The rule is the whole workflow, not just the five legs, and that is not
# thoroughness for its own sake: `quality` itself is a job whose step can be skipped
# or excused, and `scope` is the job whose answer both the legs and the fan-in are
# gated on.
[[ "$(wf -r 'has("defaults")')" == "false" ]] \
  || fail "ci.yml sets a workflow-level 'defaults:' — its 'run.shell' replaces the interpreter and the exit-status flags every script in this file is run with, including the five legs' and the fan-in's"

# The job list itself, both directions, against the hand-written expectation. The
# emptiness check is not decoration: this direction is a loop over what jq returned,
# so a query that returned nothing would "find no unexpected jobs" and pass.
declared_jobs="$(wf -r '.jobs | keys_unsorted[]')"
[[ -n "$declared_jobs" ]] || fail "ci.yml parses to a workflow with no jobs at all"
expected_job_names=()
for pair in "${expected_jobs[@]}"; do expected_job_names+=("${pair%%|*}"); done
while IFS= read -r job; do
  [[ -n "$job" ]] || continue
  contains "$job" "${expected_job_names[@]}" \
    || fail "ci.yml has a job '$job' that this file does not expect — a new job in this workflow has to be stated in expected_jobs here, in the same commit, with the exact condition it runs under"
done < <(printf '%s\n' "$declared_jobs")

for pair in "${expected_jobs[@]}"; do
  job="${pair%%|*}"
  want_if="${pair#*|}"
  wf -e --arg j "$job" '.jobs | has($j)' >/dev/null \
    || fail "ci.yml no longer has a job '$job' — if removing it was intended, say so by editing expected_jobs in this file, in the same commit"

  # The condition, byte for byte. A job that does not run is reported as `skipped`,
  # and `skipped` is a result the fan-in can be made to accept (it is exactly what a
  # docs-only PR looks like) — so a drifted `if:` is not a red build, it is a gate
  # that stops being a gate without saying anything.
  got_if="$(wf -r --arg j "$job" '.jobs[$j]["if"] // ""')"
  [[ "$got_if" == "$want_if" ]] \
    || fail "ci.yml job '$job' runs under 'if: ${got_if:-<none>}', this file expects 'if: ${want_if:-<none>}' — a job's condition decides whether its gates run at all, so a change to it has to be stated in expected_jobs here, in the same commit"

  # One query per question, and every one of them phrased so that the ANSWER has to
  # arrive for the check to pass. `[[ "$(wf …)" == "false" ]] || fail` fails closed:
  # if jq errors, or the query is malformed, the substitution is empty, empty is not
  # "false", and the gate goes red. Batching these into a single query that emits a
  # list of violations was tried and reverted — it reads "no output means nothing is
  # wrong", so ONE jq error silently passes every job in this loop. That is the exact
  # shape this file exists to catch, and a self-test may not be built out of it.
  for key in "${forbidden_job_keys[@]}"; do
    [[ "$(wf -r --arg j "$job" --arg k "$key" '.jobs[$j] | has($k)')" == "false" ]] \
      || fail "ci.yml job '$job' sets '$key:' — that key decides whether this job's commands run, or whether their failure is reported, and no job in this workflow may carry it"
  done

  # A job with no steps runs nothing and reports success.
  steps_len="$(wf -r --arg j "$job" '(.jobs[$j].steps // []) | length')"
  [[ "$steps_len" =~ ^[0-9]+$ ]] && (( steps_len > 0 )) \
    || fail "ci.yml job '$job' has no steps — it would report success without running anything"

  # The offending step numbers are useful in the message, but "an empty list means
  # all clear" is the fail-open shape again. So the clean answer is a WORD the query
  # has to produce — `none` — and the step list is what replaces it. A jq error
  # produces neither, and neither is `none`.
  for key in "${forbidden_step_keys[@]}"; do
    offenders="$(wf -r --arg j "$job" --arg k "$key" '
      [ (.jobs[$j].steps // []) | to_entries[] | select(.value | has($k)) | "#\(.key + 1)" ]
      | if length == 0 then "none" else join(", ") end
    ')"
    [[ "$offenders" == "none" ]] \
      || fail "ci.yml job '$job' has step(s) $offenders carrying '$key:' — that key decides whether the step's command is executed and whether its failure reaches the job, so no step in this workflow may carry it"
  done

  # A zero or negative timeout is a step or job that is killed before it can run.
  # (It fails closed rather than passing, but it is the same family, and it is one
  # jq query.)
  [[ "$(wf -r --arg j "$job" '(.jobs[$j]["timeout-minutes"] // 1) | (type == "number" and . >= 1)')" == "true" ]] \
    || fail "ci.yml job '$job' sets a 'timeout-minutes' that is not a positive number of minutes"
  bad_step_timeouts="$(wf -r --arg j "$job" '
    [ (.jobs[$j].steps // []) | to_entries[]
      | select((.value["timeout-minutes"] // 1) | (type != "number" or . < 1))
      | "#\(.key + 1)" ]
    | if length == 0 then "none" else join(", ") end
  ')"
  [[ "$bad_step_timeouts" == "none" ]] \
    || fail "ci.yml job '$job' has step(s) $bad_step_timeouts with a 'timeout-minutes' that is not a positive number of minutes"
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
  var="$(leg_result_var_for "$leg")"
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
fan_in_run_steps="$(wf -r --arg j "$fan_in" '[ (.jobs[$j].steps // [])[] | select(has("run")) ] | length')"
[[ "$fan_in_run_steps" == "1" ]] \
  || fail "the fan-in job '$fan_in' must be exactly one 'run:' step, found $fan_in_run_steps — the verdict is one script, so that it can be run here as one script"
fan_in_run="$(wf -r --arg j "$fan_in" '[ (.jobs[$j].steps // [])[] | select(has("run")) ][0].run')"
[[ -n "$fan_in_run" ]] || fail "the fan-in job '$fan_in' runs no script at all"
for leg in "${declared_legs[@]}"; do
  var="$(leg_result_var_for "$leg")"
  compared="$(printf '%s\n' "$fan_in_run" | grep -cE "^[[:space:]]*leg_is[[:space:]]+${leg}[[:space:]]+\"\\\$\{${var}:-\}\"[[:space:]]*$" || true)"
  [[ "$compared" == "1" ]] \
    || fail "ci.yml's fan-in must compare leg '$leg' exactly once, as 'leg_is $leg \"\${${var}:-}\"', found $compared"
done
compared_total="$(printf '%s\n' "$fan_in_run" | grep -cE '^[[:space:]]*leg_is[[:space:]]' || true)"
[[ "$compared_total" == "${#declared_legs[@]}" ]] \
  || fail "ci.yml's fan-in makes $compared_total leg comparisons but quality.sh declares ${#declared_legs[@]} legs"

# ── 3c. the fan-in's verdict, RUN ─────────────────────────────────────────────
# Everything above this line reads the fan-in. Reading proves the comparisons are
# written; it cannot prove they are REACHED. Put the same five comparisons inside
# `if false; then … fi` and every grep above still matches, line for line, while the
# step exits 0 having judged nothing — and `quality` is the required check, so that
# is a green merge button over a red repository.
#
# So the real script, taken out of the parsed workflow, is executed here against a
# synthetic environment: once for the run that must pass, and once for every way
# each leg can come back un-green. It is cheap (echoes and string compares, no
# network, no repo), and it is the only thing in this file that tests behaviour
# rather than text.
#
# `bash -e` because that is what Actions hands a `run:` script on Linux by default,
# and `env -i` because the script enumerates its own environment by prefix
# (`${!LEG_RESULT_@}`) — a stray LEG_RESULT_* inherited from this shell would be a
# finding the fan-in reported about us, not about ci.yml.
# fan_in_exit <scope result> <scope code> <leg>=<result>… [NAME=VALUE…] → exit status
fan_in_exit() {
  local scope_result="$1" scope_code="$2"
  shift 2
  local env_args=(SCOPE_RESULT="$scope_result" SCOPE_CODE="$scope_code")
  local pair
  for pair in "$@"; do
    if [[ "$pair" == LEG_RESULT_* ]]; then
      env_args+=("$pair")
    else
      env_args+=("$(leg_result_var_for "${pair%%=*}")=${pair#*=}")
    fi
  done
  local rc=0
  env -i PATH="$PATH" "${env_args[@]}" bash -e -c "$fan_in_run" >/dev/null 2>&1 || rc=$?
  printf '%s' "$rc"
}

# The environments a run can arrive in, built from the declared legs so that adding
# a leg extends the drill instead of leaving a hole in it.
every_leg_success=()
every_leg_skipped=()
for leg in "${declared_legs[@]}"; do
  every_leg_success+=("$leg=success")
  every_leg_skipped+=("$leg=skipped")
done

# The one shape that passes, in each of the two worlds the scope job can describe.
[[ "$(fan_in_exit success true "${every_leg_success[@]}")" == "0" ]] \
  || fail "ci.yml's fan-in FAILS a run where the scope found code and every leg succeeded — it would block every merge in the repository"
[[ "$(fan_in_exit success false "${every_leg_skipped[@]}")" == "0" ]] \
  || fail "ci.yml's fan-in FAILS a docs-only run where every leg was skipped — docs-only PRs would be unmergeable"

# And every shape that must not. One leg at a time, so that a fan-in which judges
# four legs and forgets the fifth is red on exactly the leg it forgot.
for broken in "${declared_legs[@]}"; do
  for bad_result in failure cancelled skipped ''; do
    env_set=()
    for leg in "${declared_legs[@]}"; do
      if [[ "$leg" == "$broken" ]]; then env_set+=("$leg=$bad_result"); else env_set+=("$leg=success"); fi
    done
    [[ "$(fan_in_exit success true "${env_set[@]}")" != "0" ]] \
      || fail "ci.yml's fan-in PASSES a run in which leg '$broken' reported '${bad_result:-<no result>}' — that leg's gates did not pass, and 'quality' is the check that says they did"
  done
  # The mirror image: on a docs-only run, a leg that ran anyway means the legs and
  # the fan-in disagree about what this run was, and an unexplained run may not merge.
  env_set=()
  for leg in "${declared_legs[@]}"; do
    if [[ "$leg" == "$broken" ]]; then env_set+=("$leg=success"); else env_set+=("$leg=skipped"); fi
  done
  [[ "$(fan_in_exit success false "${env_set[@]}")" != "0" ]] \
    || fail "ci.yml's fan-in PASSES a docs-only run in which leg '$broken' ran anyway — the scope answer the legs read and the one this step read disagree"
done

# The scope job is the premise under both worlds; if it did not succeed, nothing
# below it can be trusted, whatever the legs say.
for bad_scope in failure cancelled skipped ''; do
  [[ "$(fan_in_exit "$bad_scope" true "${every_leg_success[@]}")" != "0" ]] \
    || fail "ci.yml's fan-in PASSES a run in which the scope job reported '${bad_scope:-<no result>}' — the legs were gated on an answer that was never given"
done

# And a result the fan-in was never told to judge must be rejected rather than
# ignored: a sixth job wired into `needs` and into the variables, but not into the
# comparisons, would be a gate whose outcome this step silently discards.
[[ "$(fan_in_exit success true "${every_leg_success[@]}" LEG_RESULT_ROGUE=success)" != "0" ]] \
  || fail "ci.yml's fan-in PASSES a run carrying a LEG_RESULT_* variable it does not judge — a leg wired in but never compared is a gate nobody reads"

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

echo "quality-legs: OK — all $gate_count expected gates are in quality.sh on their expected legs, legs [${declared_legs[*]}] all covered there and all launched by ci.yml (read as YAML with $yaml_parser) by a job that runs that leg's command and nothing else, under the conditions expected here and with no step allowed to skip it or excuse its failure, and the fan-in check 'quality' judges each leg by name exactly once — its own script run here against every way a leg can come back un-green"
