#!/usr/bin/env bash

# Mutation drill for scripts/__tests__/quality-legs.test.sh.
#
# The self-test's whole claim is "if CI stops running a gate, this goes red". A
# self-test that has never been shown a broken ci.yml has not demonstrated that; it
# has demonstrated that it passes on a correct one, which is also what a self-test
# that checks nothing does. So this script breaks ci.yml on purpose, one way at a
# time, in a throwaway copy of the repo, and requires the self-test to notice.
#
# Every shape below is one that FIVE ROUNDS of review of #874 actually found, plus
# the ones the r6 design closed by construction:
#
#   r4  a step that never runs (`if: ${{ false }}`), a failure that never arrives
#       (`continue-on-error: true`), a command inside a branch nothing takes
#       (`if false; then … fi`)
#   r5  the environment the legs are handed — six ways to add, remove or change one
#       at workflow, job and step level, of which `npm_config_script_shell=/bin/echo`
#       makes every leg print its own command and exit 0
#   r6  the two r5 review found next: the INSTALL step exporting that same variable
#       through `$GITHUB_ENV` (the leg's own command stays byte-perfect), and
#       `container: { image, env }` on a job (job-level `env:` was refused; this is
#       a different key that lands in the same place)
#   and the faces no list had reached at all: an action version bumped, a `with:`
#       injected, a step added, two steps swapped, `services.postgres.env` changed
#   r7  the one r6's review named that all of the above miss BY CONSTRUCTION: every
#       case up to r6 mutated a leg the self-test does not live in, so the self-test
#       always ran. Aim the same mutations at the TYPECHECK leg and the self-test is
#       the thing being switched off — it cannot report on its own absence. Those
#       cases are the group below headed "the judge's own off switch", and what
#       catches them is the tripwire in ci.yml (every job's step #2), reproduced
#       here by leaving `.github/ci-workflow.lock` pinning the OLD file.
#   r8  the one every case up to r7 misses for a DIFFERENT structural reason: they
#       all mutate ci.yml and then ask the self-test. r8's bypass was not something
#       the self-test could be asked about, because it never reached the gate's first
#       line — `BASH_ENV` at workflow level is sourced by bash BEFORE the script it
#       was handed, so it can rewrite the lock, or define `cut` and `sha256sum` as
#       functions that agree with anything. Two groups answer it: the ci.yml shapes
#       (now refused by the deny check in 3d and by the `shell:` field 3f pins), and
#       a group that does not use the self-test at all — it STARTS THE GATE, under
#       `sh` and under `bash`, with the poison in place. sh must refuse; bash must be
#       fooled. The second half is the nail that keeps `shell: sh` from being tidied
#       away as noise.
#
# The last cases are about the DOOR rather than the wall: an intended change to
# ci.yml, with the canonical block regenerated, must pass (that is the workflow); an
# intended change whose diagnostics were NOT restated must still fail (that is why
# the diagnostics are kept); and one case where the self-test goes GREEN on purpose,
# because the bypass it models is real — the drill's requirement there is that the
# bypass could not be quiet, i.e. that it necessarily edits
# `.github/workflows/ci.yml`. (Up to r8 that case demanded an edit to
# `.github/ci-workflow.lock` as well. r8's bypass touched no lock, so that demand was
# simply false and has been dropped — see the note on expect_green_only_by_visible_edit.)
#
# EVERY MUTATION REGENERATES THE LOCK unless the case is about the lock itself. That
# is not politeness: it keeps each case proving what it says it proves. Without it,
# the stale-lock check would be the first thing to fire on all 20 older cases and
# they would stop being evidence about the canonical comparison at all.
#
# Nothing here touches the real repository: every case runs against a fresh copy of
# the files the self-test reads.
#
# Run: bash scripts/__tests__/quality-legs.drill.sh          (~10 min, measured)
#      QUALITY_LEGS_DRILL_TMPDIR=./.drill-tmp bash scripts/__tests__/quality-legs.drill.sh

set -euo pipefail

expected_cases=42

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && cd .. && pwd)"

drill_root="${QUALITY_LEGS_DRILL_TMPDIR:-${TMPDIR:-/tmp}}"
mkdir -p "$drill_root"
sandbox="$(cd "$drill_root" && pwd)/quality-legs-drill.$$"
trap 'rm -rf "$sandbox" "$sandbox.gate"' EXIT

ci_yml="$sandbox/.github/workflows/ci.yml"
lock_file="$sandbox/.github/ci-workflow.lock"
test_sh="$sandbox/scripts/__tests__/quality-legs.test.sh"
log="$sandbox/last.log"

pass=0
fail=0
total=0

reset_sandbox() {
  rm -rf "$sandbox"
  mkdir -p "$sandbox/.github/workflows" "$sandbox/scripts/ci" "$sandbox/scripts/__tests__"
  cp "$repo_root/.github/workflows/ci.yml" "$ci_yml"
  cp "$repo_root/.github/ci-workflow.lock" "$lock_file"
  cp "$repo_root/scripts/ci/quality.sh" "$sandbox/scripts/ci/quality.sh"
  cp "$repo_root/scripts/ci/ci-workflow-lock.sh" "$sandbox/scripts/ci/ci-workflow-lock.sh"
  cp "$repo_root/scripts/__tests__/quality-legs.test.sh" "$test_sh"
  cp "$repo_root/package.json" "$sandbox/package.json"
}

# The tripwire exactly as ci.yml carries it, for the cases that remove or neuter it.
# It is written out here rather than read back out of ci.yml so that the drill cannot
# quietly "mutate" nothing; the occurrence count patch_ci insists on is what says the
# copy is still current.
# (`read -d ''` and not `$(cat <<…)`: bash 3.2, which is what macOS ships, mis-parses
# a here-document nested inside a command substitution when the body contains an odd
# number of quote characters — and this body is a YAML comment written in English.)
IFS= read -r -d '' tripwire_block <<'DRILL_TRIPWIRE_EOF' || true
      # THE TRIPWIRE (see the note at the top of this file). Byte-identical in every
      # job on purpose: scripts/__tests__/quality-legs.test.sh holds one hand-written
      # copy of these lines and requires every job's step #2 to be exactly it —
      # `shell: sh` included, because that field is what stops a startup file named
      # in this workflow's own environment (`BASH_ENV`, `ENV`) from running first.
      - name: ci.yml is the reviewed one
        shell: sh
        run: |
          set -eu
          want="$(cut -d' ' -f1 .github/ci-workflow.lock)"
          got="$(sha256sum .github/workflows/ci.yml | cut -d' ' -f1)"
          [ ${#want} -eq 64 ] || { echo "ci-guard: .github/ci-workflow.lock does not hold one sha256 digest"; exit 1; }
          [ "$want" = "$got" ] || { echo "ci-guard: ci.yml is $got, .github/ci-workflow.lock pins $want. If the change to ci.yml was intended, regenerate the lock in the SAME commit: bash scripts/ci/ci-workflow-lock.sh"; exit 1; }
          echo "ci-guard: ci.yml matches .github/ci-workflow.lock ($got)"
DRILL_TRIPWIRE_EOF

# What an author does after an intended ci.yml change, and what CI tells them to do
# when they forget: rewrite the lock from the (mutated) file.
relock_sandbox() {
  bash "$sandbox/scripts/ci/ci-workflow-lock.sh" >/dev/null
}

# An anchored text edit on the sandbox's ci.yml. The anchor must appear EXACTLY the
# number of times stated, or the drill stops: a mutation that silently did not apply
# is a case that "passed" without ever being run.
patch_ci_text() { # <anchor> <replacement> [<expected occurrences, default 1>]
  python3 -c '
import sys
path, anchor, repl, want = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
src = open(path, encoding="utf-8").read()
got = src.count(anchor)
if got != want:
    sys.exit("drill: anchor found %d time(s), expected %d: %r" % (got, want, anchor[:70]))
open(path, "w", encoding="utf-8").write(src.replace(anchor, repl))
' "$ci_yml" "$1" "$2" "${3:-1}"
}

# The same edit, but confined to one job's block, for the cases that have to name a
# job whose steps are byte-identical to five others' (every job now opens with the
# same checkout and the same tripwire, so "lint's checkout" is not a unique string).
patch_ci_in_job() { # <job> <anchor> <replacement> [<expected occurrences, default 1>]
  python3 -c '
import re, sys
path, job, anchor, repl, want = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
lines = open(path, encoding="utf-8").read().split("\n")
starts = [i for i, l in enumerate(lines) if l == "  %s:" % job]
if len(starts) != 1:
    sys.exit("drill: found %d job blocks called %r" % (len(starts), job))
start = starts[0]
end = len(lines)
for i in range(start + 1, len(lines)):
    if re.match(r"^  [A-Za-z_][A-Za-z0-9_-]*:", lines[i]):
        end = i
        break
block = "\n".join(lines[start:end])
got = block.count(anchor)
if got != want:
    sys.exit("drill: anchor found %d time(s) inside job %r, expected %d: %r" % (got, job, want, anchor[:70]))
patched = block.replace(anchor, repl)
open(path, "w", encoding="utf-8").write("\n".join(lines[:start] + patched.split("\n") + lines[end:]))
' "$ci_yml" "$1" "$2" "$3" "${4:-1}"
}

# The default: mutate, then regenerate the lock, so that the stale-lock check is
# never what makes the case red and every case still proves what it claims.
patch_ci() { patch_ci_text "$@"; relock_sandbox; }
patch_ci_job() { patch_ci_in_job "$@"; relock_sandbox; }
# And the deliberate opposite, for the cases that ARE about the lock: mutate ci.yml
# and leave the lock pinning the file as it was. That is what CI sees when someone
# edits the workflow and does not say so — in ci.yml it is caught by every job's
# step #2, before any leg starts; here it is caught by 3f.
patch_ci_stale() { patch_ci_text "$@"; }
patch_ci_job_stale() { patch_ci_in_job "$@"; }

# Regenerate the sandbox self-test's canonical blocks from the sandbox's (mutated)
# ci.yml — exactly what a human does after an intended workflow change, through the
# switch the self-test documents. The run it reads is allowed to fail; the blocks are
# printed before the first check.
regen_sandbox() {
  local out
  out="$(QUALITY_LEGS_PRINT_CANONICAL=1 bash "$test_sh" 2>/dev/null || true)"
  python3 -c '
import sys
test_path, printed = sys.argv[1], sys.stdin.read()

def section(name):
    head = "==== quality-legs canonical: %s ====\n" % name
    if head not in printed:
        sys.exit("drill: the regeneration switch printed no %s block" % name)
    rest = printed.split(head, 1)[1]
    return rest.split("\n==== quality-legs canonical:", 1)[0]

def replace_block(src, marker, body):
    q = chr(39)  # this whole program is inside single quotes in the shell
    start = "<<" + q + marker + q + "\n"
    end = "\n" + marker + "\n"
    i = src.index(start) + len(start)
    j = src.index(end, i)
    return src[:i] + body + src[j:]

src = open(test_path, encoding="utf-8").read()
src = replace_block(src, "QUALITY_LEGS_TOPLEVEL_CANONICAL_EOF", section("toplevel"))
src = replace_block(src, "QUALITY_LEGS_JOBS_CANONICAL_EOF", section("jobs"))
open(test_path, "w", encoding="utf-8").write(src)
' "$test_sh" <<<"$out"
}

run_self_test() {
  local rc=0
  bash "$test_sh" >"$log" 2>&1 || rc=$?
  printf '%s' "$rc"
}

expect_red() { # <description>
  local desc="$1" rc
  rc="$(run_self_test)"
  total=$((total + 1))
  if [[ "$rc" != "0" ]]; then
    pass=$((pass + 1))
    printf '  RED   (rc=%s)  %s\n' "$rc" "$desc"
  else
    fail=$((fail + 1))
    printf '  GREEN — WRONG-PASS  %s\n' "$desc" >&2
  fi
}

expect_green() { # <description>
  local desc="$1" rc
  rc="$(run_self_test)"
  total=$((total + 1))
  if [[ "$rc" == "0" ]]; then
    pass=$((pass + 1))
    printf '  GREEN         %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  RED (rc=%s) — FALSE ALARM  %s\n' "$rc" "$desc" >&2
    sed 's/^/      /' "$log" >&2
  fi
}

# The one case that is allowed to pass, and the only one whose requirement is about
# the DIFF rather than about an exit status. Some bypasses are real: an author who
# edits ci.yml and regenerates the lock in the same commit gets a green self-test and
# a green tripwire, and pretending otherwise is how r1-r6 each shipped a claim the
# next round falsified. What is required instead is that the bypass cannot be quiet —
# that it necessarily shows up as an edit to a file whose job is to be looked at.
#
# WHAT THIS CASE MAY REQUIRE, AND WHAT IT MAY NOT. r8 refused the earlier version of
# this requirement, and was right to: it demanded that the bypass touch
# `.github/ci-workflow.lock`, and r8's own `BASH_ENV` bypass touched no such thing —
# it edited one `env:` entry in ci.yml and nothing else. So the only file this case
# is entitled to insist on is `.github/workflows/ci.yml`. That is the claim the whole
# design now rests on, and it is deliberately the weaker one: not "a bypass has to
# disturb the lock", but "a bypass has to be written down in the workflow file, where
# the diff is". Do not add files back to this call to make it feel stronger — a
# requirement this case cannot meet for every bypass is a requirement that will be
# falsified in r10.
expect_green_only_by_visible_edit() { # <description> <file that must have changed>…
  local desc="$1"
  shift
  local rc unchanged=() f
  rc="$(run_self_test)"
  total=$((total + 1))
  for f in "$@"; do
    if cmp -s "$sandbox/$f" "$repo_root/$f"; then unchanged+=("$f"); fi
  done
  if [[ "$rc" == "0" && "${#unchanged[@]}" == "0" ]]; then
    pass=$((pass + 1))
    printf '  GREEN, and it had to touch %s   %s\n' "$*" "$desc"
  elif [[ "$rc" != "0" ]]; then
    # Not a wrong-PASS, but the case no longer models what it says it models.
    fail=$((fail + 1))
    printf '  RED (rc=%s) — this case is supposed to model a real bypass  %s\n' "$rc" "$desc" >&2
    sed 's/^/      /' "$log" >&2
  else
    fail=$((fail + 1))
    printf '  GREEN AND SILENT — WRONG-PASS  %s (unchanged: %s)\n' "$desc" "${unchanged[*]}" >&2
  fi
}

# ── the gate itself, started the way a runner starts it ──────────────────────
# Everything above answers "does the self-test go red?". These answer a question the
# self-test structurally cannot: "what does the GATE do when it is started in a
# hostile environment?" — because #874 r8's bypass never reached the gate's first
# line. It put `BASH_ENV` in the workflow's `env:`, and bash sources what BASH_ENV
# names BEFORE the script it was given. The minimal body was irrelevant: the sourced
# file can rewrite `.github/ci-workflow.lock`, or define functions named `cut` and
# `sha256sum` that answer with whatever digest makes the comparison pass.
#
# So these cases take the gate body out of ci.yml, put it in a directory with a lock
# that DOES NOT MATCH, and start it the two ways GitHub starts a `run:` step:
#   `shell: sh` (what ci.yml now declares) → `sh -e <file>`
#   the default (what it used to get)     → `bash --noprofile --norc -eo pipefail <file>`
# The requirement is not symmetric, and deliberately so: sh must REFUSE, and bash
# must be FOOLED. The bash half is the nail — it is what makes `shell: sh` a check
# rather than a decoration somebody tidies away in six months. If a future bash stops
# reading $BASH_ENV those cases go red, and that failure is the drill correctly
# reporting that this nail no longer holds anything.
gate_root="$sandbox.gate"
gate_log="$gate_root/last.log"
zeros64="0000000000000000000000000000000000000000000000000000000000000000"
[[ "${#zeros64}" == "64" ]] || { echo "drill: the placeholder digest is not 64 characters" >&2; exit 1; }

# The gate body is LIFTED FROM the drill's hand-written tripwire block — the lines
# inside its `run: |`, with the block scalar's indent removed — and the block is first
# required to appear in the real ci.yml seven times. So what runs below is the script
# CI runs, not a paraphrase of it that could drift into being easier to defend.
gate_block_count="$(printf '%s' "$tripwire_block" | python3 -c '
import sys
block = sys.stdin.read().rstrip("\n")
src = open(sys.argv[1], encoding="utf-8").read()
print(src.count(block))
' "$repo_root/.github/workflows/ci.yml")"
[[ "$gate_block_count" == "7" ]] \
  || { echo "drill: the tripwire block written out in this file appears $gate_block_count time(s) in ci.yml, expected 7 — the drill would be testing a script CI does not run" >&2; exit 1; }
gate_body="$(printf '%s\n' "$tripwire_block" | sed -n 's/^          //p')"
[[ "$(printf '%s\n' "$gate_body" | head -n 1)" == "set -eu" ]] \
  || { echo "drill: could not lift the gate body out of the tripwire block" >&2; exit 1; }

setup_gate() { # <current|stale>
  rm -rf "$gate_root"
  mkdir -p "$gate_root/.github/workflows" "$gate_root/scripts/ci"
  cp "$repo_root/.github/workflows/ci.yml" "$gate_root/.github/workflows/ci.yml"
  cp "$repo_root/scripts/ci/ci-workflow-lock.sh" "$gate_root/scripts/ci/ci-workflow-lock.sh"
  printf '%s\n' "$gate_body" >"$gate_root/gate.sh"
  # Poison (a): shadow the only two commands the gate runs. Both answer 64 zeros, so
  # `want` and `got` agree no matter what is on disk.
  printf 'cut() { printf "%%s\\n" %s; }\nsha256sum() { printf "%%s  %%s\\n" %s "$1"; }\n' \
    "$zeros64" "$zeros64" >"$gate_root/poison-functions.sh"
  # Poison (b) is not written here at all: it is scripts/ci/ci-workflow-lock.sh, the
  # repository's own lock generator, copied in above. Sourcing it RUNS it, and its
  # default branch writes the lock from the current ci.yml — so the gate then compares
  # the file against a digest taken from that same file, moments earlier.
  if [[ "$1" == "current" ]]; then
    cp "$repo_root/.github/ci-workflow.lock" "$gate_root/.github/ci-workflow.lock"
  else
    printf '%s  %s\n' "$zeros64" ".github/workflows/ci.yml" >"$gate_root/.github/ci-workflow.lock"
  fi
}

run_gate() { # <sh|bash> [NAME=value …] — prints the exit code
  local interp="$1"; shift
  local rc=0
  if [[ "$interp" == "sh" ]]; then
    ( cd "$gate_root" && env "$@" sh -e ./gate.sh ) >"$gate_log" 2>&1 || rc=$?
  else
    ( cd "$gate_root" && env "$@" bash --noprofile --norc -eo pipefail ./gate.sh ) >"$gate_log" 2>&1 || rc=$?
  fi
  printf '%s' "$rc"
}

# The same, with the startup file arriving on a pipe instead of from disk — r8's own
# read-only proof. It matters because it removes the last comfort available here: the
# poison needs no file in the repository, no artefact a reviewer could notice.
run_gate_piped_poison() { # <sh|bash> — prints the exit code
  local interp="$1" rc=0
  if [[ "$interp" == "sh" ]]; then
    ( cd "$gate_root" && cat poison-functions.sh \
      | env BASH_ENV=/dev/stdin sh -e ./gate.sh ) >"$gate_log" 2>&1 || rc=$?
  else
    ( cd "$gate_root" && cat poison-functions.sh \
      | env BASH_ENV=/dev/stdin bash --noprofile --norc -eo pipefail ./gate.sh ) >"$gate_log" 2>&1 || rc=$?
  fi
  printf '%s' "$rc"
}

expect_gate_refuses() { # <rc> <description>
  local rc="$1" desc="$2"
  total=$((total + 1))
  if [[ "$rc" != "0" ]]; then
    pass=$((pass + 1))
    printf '  REFUSED (rc=%s)  %s\n' "$rc" "$desc"
  else
    fail=$((fail + 1))
    printf '  ACCEPTED — WRONG-PASS  %s\n' "$desc" >&2
    sed 's/^/      /' "$gate_log" >&2
  fi
}

expect_gate_accepts() { # <rc> <description> — the control: the gate still works
  local rc="$1" desc="$2"
  total=$((total + 1))
  if [[ "$rc" == "0" ]]; then
    pass=$((pass + 1))
    printf '  ACCEPTED       %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  REFUSED (rc=%s) — FALSE ALARM  %s\n' "$rc" "$desc" >&2
    sed 's/^/      /' "$gate_log" >&2
  fi
}

# The asymmetric half. A "pass" here means the bypass WORKED — that is the point: it
# is the evidence that `shell: sh` is load-bearing, kept as a case so that it stays
# true rather than being remembered as a claim.
expect_gate_fooled() { # <rc> <description>
  local rc="$1" desc="$2"
  total=$((total + 1))
  if [[ "$rc" == "0" ]]; then
    pass=$((pass + 1))
    printf '  FOOLED (as required)  %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  REFUSED (rc=%s) — this case exists to prove the bypass is REAL under bash; if bash here no longer reads $BASH_ENV, say so and retire the case rather than deleting shell: sh  %s\n' "$rc" "$desc" >&2
    sed 's/^/      /' "$gate_log" >&2
  fi
}

echo "quality-legs drill: sandbox $sandbox"
echo

echo "the workflow as it is — must pass, before anything is broken:"
reset_sandbox
expect_green "untouched ci.yml"
echo

echo "r4's three: a command that is present but does not run, or cannot fail:"

reset_sandbox
patch_ci '      - run: pnpm quality --leg lint' \
'      - if: ${{ false }}
        run: pnpm quality --leg lint'
expect_red "lint's leg step carries if: \${{ false }}"

reset_sandbox
patch_ci '      - run: pnpm quality --leg tests' \
'      - continue-on-error: true
        run: pnpm quality --leg tests'
expect_red "tests' leg step carries continue-on-error: true"

reset_sandbox
patch_ci '      - run: pnpm quality --leg checks' \
'      - run: |
          if false; then pnpm quality --leg checks; fi'
expect_red "checks' leg command sits inside 'if false; then … fi'"
echo

echo "r5's six: the environment the legs are handed:"

reset_sandbox
patch_ci '  NODE_OPTIONS: --max-old-space-size=6144' \
'  NODE_OPTIONS: --max-old-space-size=6144
  npm_config_script_shell: /bin/echo'
expect_red "workflow env gains npm_config_script_shell (every leg echoes its command)"

reset_sandbox
patch_ci '  NODE_OPTIONS: --max-old-space-size=6144
' ''
expect_red "workflow env loses NODE_OPTIONS"

reset_sandbox
patch_ci 'postgresql://postgres:postgres@localhost:5432/fikirtive_test' \
'postgresql://postgres:postgres@localhost:5432/somewhere_else'
expect_red "workflow env DATABASE_URL points somewhere else"

reset_sandbox
patch_ci '  lint:
    name: lint' \
'  lint:
    name: lint
    env:
      npm_config_script_shell: /bin/echo'
expect_red "job-level env: on lint"

reset_sandbox
patch_ci '      - run: pnpm quality --leg build' \
'      - env:
          npm_config_script_shell: /bin/echo
        run: pnpm quality --leg build'
expect_red "step-level env: on build's leg step"

reset_sandbox
patch_ci '          GH_TOKEN: ${{ github.token }}' \
'          GH_TOKEN: ${{ secrets.SOMETHING_ELSE }}'
expect_red "an existing step-level env value changed (scope's GH_TOKEN)"
echo

echo "r5's review, the two the lists could not reach (r6's P0s):"

reset_sandbox
patch_ci '      - run: pnpm install --frozen-lockfile
      - run: pnpm quality --leg lint' \
'      - run: |
          echo "npm_config_script_shell=/bin/echo" >> "$GITHUB_ENV"
          pnpm install --frozen-lockfile
      - run: pnpm quality --leg lint'
expect_red "the INSTALL step exports npm_config_script_shell via \$GITHUB_ENV (leg command untouched)"

reset_sandbox
patch_ci '  lint:
    name: lint' \
'  lint:
    name: lint
    container:
      image: node:22
      env:
        npm_config_script_shell: /bin/echo'
expect_red "container: { image, env } on lint (job-level env was refused; this is the same reach)"
echo

echo "and the faces no list had reached at all:"

reset_sandbox
patch_ci '      - uses: actions/checkout@v4' '      - uses: actions/checkout@v3' 7
expect_red "actions/checkout pinned to another version"

reset_sandbox
patch_ci_job lint '      - uses: actions/checkout@v4
' '      - uses: actions/checkout@v4
        with:
          repository: someone-else/fikirtive
          ref: main
'
expect_red "a with: block injected into lint's checkout (another repository, another ref)"

reset_sandbox
patch_ci '      - run: pnpm install --frozen-lockfile
      - run: pnpm quality --leg lint' \
'      - run: pnpm install --frozen-lockfile
      - run: echo "an extra step nobody stated"
      - run: pnpm quality --leg lint'
expect_red "an extra step added to lint"

reset_sandbox
patch_ci '      - run: pnpm install --frozen-lockfile
      - run: pnpm quality --leg checks' \
'      - run: pnpm quality --leg checks
      - run: pnpm install --frozen-lockfile'
expect_red "checks runs its leg BEFORE installing (two steps swapped)"

reset_sandbox
patch_ci '          POSTGRES_DB: fikirtive_test' '          POSTGRES_DB: fikirtive_other' 5
expect_red "services.postgres.env changed (r5 left this one deliberately uncovered)"
echo

echo "the container's own reach, one level further than the P0:"

reset_sandbox
patch_ci '  checks:
    name: checks' \
'  checks:
    name: checks
    container: node:22'
expect_red "container: on checks as a bare image string"
echo

echo "r6's review — the judge's own off switch (every case above left the typecheck leg running):"

# The r6 P0, aimed where it was meant to be aimed. Up to r6 every case mutated a leg
# the self-test does not live in, so the self-test always ran and could always report.
# Put the same poison in the TYPECHECK job and the self-test is the thing being turned
# off: `pnpm quality --leg typecheck` prints its own command and exits 0, so nothing
# below this line would have run in CI at all. What is left is the tripwire, in this
# job and in six others, and it fires on the lock — which is why these cases leave the
# lock pinning the file as it was.
reset_sandbox
patch_ci_job_stale typecheck '      - run: pnpm install --frozen-lockfile' \
'      - run: |
          echo "npm_config_script_shell=/bin/echo" >> "$GITHUB_ENV"
          pnpm install --frozen-lockfile'
expect_red "TYPECHECK's install step exports npm_config_script_shell (this is the leg that runs the self-test)"

reset_sandbox
patch_ci_stale '  typecheck:
    name: typecheck' \
'  typecheck:
    name: typecheck
    container:
      image: node:22
      env:
        npm_config_script_shell: /bin/echo'
expect_red "container: { image, env } on TYPECHECK (reaches every step of the leg that runs the self-test)"

reset_sandbox
patch_ci_job_stale typecheck "$tripwire_block" ''
expect_red "the tripwire deleted from typecheck, lock left alone (the other six jobs still hash the whole file)"

reset_sandbox
patch_ci_job typecheck "$tripwire_block" ''
regen_sandbox
expect_red "the tripwire deleted from typecheck AND lock and canonical block both regenerated — the hand-written expectation in 3f still refuses it"

reset_sandbox
patch_ci '          set -eu
          want=' \
'          set -eu
          exit 0
          want=' 7
regen_sandbox
expect_red "the tripwire neutered in ALL SEVEN jobs (exit 0 first) AND everything regenerated — 3f compares its script byte for byte"
echo

echo "r8's review — the startup environment, stated in ci.yml (the two shapes that never touch the tripwire's own lines):"

# r8 got past the tripwire without editing the tripwire or the lock. Both shapes below
# are edits to ci.yml and nothing else, and both are now refused by the self-test — the
# first by the deny check in 3d, the second by the `shell:` field 3f pins. What ACTUALLY
# happens when the gate is started under these conditions is not asserted here, because
# a mutated-workflow-plus-self-test model cannot show it; that is the section after this
# one, which runs the gate itself.
reset_sandbox
patch_ci '  NODE_OPTIONS: --max-old-space-size=6144' \
'  NODE_OPTIONS: --max-old-space-size=6144
  BASH_ENV: scripts/ci/ci-workflow-lock.sh'
regen_sandbox
expect_red "workflow env gains BASH_ENV pointing at the repo's own lock generator (r8's P0) — bash sources it before the gate's first line and it rewrites the lock the gate is about to read"

reset_sandbox
patch_ci '        shell: sh
' '' 7
regen_sandbox
expect_red "'shell: sh' deleted from ALL SEVEN tripwires AND everything regenerated — 3f pins the field, because deleting it is what re-opens BASH_ENV"

# The case the deny check in 3d exists for, and the reason it is not merely a second
# way of saying what the allow lists already say. `container:` is not in
# forbidden_job_keys, and `container.env` is in no allow list (both tables say so in
# as many words). So with the lock regenerated AND the canonical block regenerated,
# every other check in the file agrees — and BASH_ENV still reaches every step of the
# job. This one is held by the deny check alone.
reset_sandbox
patch_ci '  lint:
    name: lint' \
'  lint:
    name: lint
    container:
      image: node:22
      env:
        BASH_ENV: scripts/ci/ci-workflow-lock.sh'
regen_sandbox
expect_red "container.env carrying BASH_ENV on lint AND everything regenerated — no allow list covers container.env and no list forbids 'container:', so the BASH_ENV/ENV deny check in 3d is the only thing holding this"
echo

echo "and the same finding where it actually lives — the gate STARTED, against a lock that does not match:"

# Controls first: against a stale lock the gate must refuse, and against the real one
# it must still pass. Without both, "sh refused" below proves nothing — a gate that
# refuses everything would score full marks.
setup_gate stale
expect_gate_refuses "$(run_gate sh)" "sh, clean environment — a lock that does not match ci.yml (this is the gate doing its job)"
setup_gate current
expect_gate_accepts "$(run_gate sh)" "sh, clean environment — the real lock and the real ci.yml (the gate is not simply always-red)"

# Poison (a): the two commands the gate runs, shadowed by functions.
setup_gate stale
expect_gate_refuses "$(run_gate sh BASH_ENV=./poison-functions.sh)" \
  "sh + BASH_ENV naming a file that defines cut and sha256sum — sh reads no startup file, so the real commands run"
setup_gate stale
expect_gate_fooled "$(run_gate bash BASH_ENV=./poison-functions.sh)" \
  "bash + the same file — sourced before the gate's first line, forging a 64-zero match (r8's read-only finding, reproduced)"

# The same, with nothing on disk.
setup_gate stale
expect_gate_refuses "$(run_gate_piped_poison sh)" \
  "sh + BASH_ENV=/dev/stdin, poison on a pipe — nothing in the repository to notice, and still refused"
setup_gate stale
expect_gate_fooled "$(run_gate_piped_poison bash)" \
  "bash + BASH_ENV=/dev/stdin, poison on a pipe — a bypass leaving no artefact at all"

# Poison (b): no bespoke script — the repository's own lock generator, which is what
# made r8's finding sharp. Sourcing it rewrites the lock the gate is about to read.
setup_gate stale
expect_gate_refuses "$(run_gate sh BASH_ENV=scripts/ci/ci-workflow-lock.sh)" \
  "sh + BASH_ENV=scripts/ci/ci-workflow-lock.sh — the lock is left as it was, and the mismatch stands"
setup_gate stale
expect_gate_fooled "$(run_gate bash BASH_ENV=scripts/ci/ci-workflow-lock.sh)" \
  "bash + the same — the repo's own generator runs first and re-pins the lock to the file it is about to be compared against"

# `ENV` is the other name 3d refuses, and the reason it is refused separately: it is
# the POSIX spelling, so it is the one that would survive a switch of shell.
setup_gate stale
expect_gate_refuses "$(run_gate sh ENV=./poison-functions.sh)" \
  "sh + ENV naming the same poison — a non-interactive sh reads ENV no more than it reads BASH_ENV"
echo

echo "the lock itself:"

reset_sandbox
patch_ci_stale '  merge_group:' '  merge_group:
  # a comment nobody stated'
expect_red "ci.yml edited and .github/ci-workflow.lock left pinning the old file"

reset_sandbox
: >"$lock_file"
expect_red "an empty .github/ci-workflow.lock"
echo

echo "the door: an intended change, stated in the same commit — and one that was not:"

# The action bumped here is `pnpm/action-setup`, NOT `actions/checkout`, and the
# difference is the point. Since r7 the checkout is one of the things 3f states by
# hand (it has to be step #1, or the tripwire has nothing to hash yet), so bumping it
# is red until that line is restated too — the same "say it twice" rule the gate map
# and the env tables have always had. `pnpm/action-setup` is stated nowhere by hand,
# so it is the honest test of the DOOR: an ordinary intended change, regenerated in
# the same commit, must go green.
reset_sandbox
patch_ci '      - uses: pnpm/action-setup@v4' '      - uses: pnpm/action-setup@v5' 5
regen_sandbox
expect_green "pnpm/action-setup bumped AND the canonical block regenerated (this is the workflow)"

reset_sandbox
patch_ci '  lint:
    name: lint' \
'  lint:
    name: lint
    env:
      npm_config_script_shell: /bin/echo'
regen_sandbox
expect_red "job-level env: added AND the canonical block regenerated — the diagnostics still refuse it"

reset_sandbox
patch_ci '      - uses: actions/checkout@v4' '      - uses: actions/checkout@v5' 7
regen_sandbox
expect_red "actions/checkout bumped AND the canonical block regenerated — 3f pins step #1 by hand, so this one has to be said twice"
echo

echo "and the bypass that is REAL — the requirement here is that it cannot be quiet:"

# This is the honest end of the recursion, and it is stated as a case rather than as
# a paragraph so that it stays true. An author who poisons the typecheck leg AND
# regenerates the lock AND regenerates the canonical block gets a green self-test and
# a green tripwire: a checker that ships in the same tree as the thing it checks can
# always be re-blessed by whoever edits the tree.
#
# What is left is the one requirement that survived r8: the bypass had to be WRITTEN
# DOWN IN ci.yml. It is asserted on that file alone — r8's bypass never touched the
# lock, so demanding the lock here would be demanding something untrue, which is the
# mistake this whole line of cases exists to stop repeating.
reset_sandbox
patch_ci_job typecheck '      - run: pnpm install --frozen-lockfile' \
'      - run: |
          echo "npm_config_script_shell=/bin/echo" >> "$GITHUB_ENV"
          pnpm install --frozen-lockfile'
regen_sandbox
expect_green_only_by_visible_edit \
  "typecheck poisoned AND lock AND canonical both regenerated — the machine says yes, and it is in the ci.yml diff" \
  .github/workflows/ci.yml
echo

echo "and the workflow as it is, once more, after all of that:"
reset_sandbox
expect_green "untouched ci.yml"
echo

if (( total != expected_cases )); then
  echo "quality-legs drill: ran $total cases, expected $expected_cases — a case disappeared without saying so; treat this as a failure" >&2
  exit 1
fi
if (( fail > 0 )); then
  echo "quality-legs drill: $fail of $expected_cases cases FAILED ($pass passed)" >&2
  exit 1
fi
echo "quality-legs drill: all $expected_cases cases behaved as required ($pass passed)"
