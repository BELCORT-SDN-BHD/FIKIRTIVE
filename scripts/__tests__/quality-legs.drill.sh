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
#
# The last cases are about the DOOR rather than the wall: an intended change to
# ci.yml, with the canonical block regenerated, must pass (that is the workflow); an
# intended change whose diagnostics were NOT restated must still fail (that is why
# the diagnostics are kept); and one case where the self-test goes GREEN on purpose,
# because the bypass it models is real — the drill's requirement there is that the
# bypass could not be quiet, i.e. that it necessarily edits `.github/ci-workflow.lock`.
#
# EVERY MUTATION REGENERATES THE LOCK unless the case is about the lock itself. That
# is not politeness: it keeps each case proving what it says it proves. Without it,
# the stale-lock check would be the first thing to fire on all 20 older cases and
# they would stop being evidence about the canonical comparison at all.
#
# Nothing here touches the real repository: every case runs against a fresh copy of
# the files the self-test reads.
#
# Run: bash scripts/__tests__/quality-legs.drill.sh          (~8 min, measured)
#      QUALITY_LEGS_DRILL_TMPDIR=./.drill-tmp bash scripts/__tests__/quality-legs.drill.sh

set -euo pipefail

expected_cases=30

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && cd .. && pwd)"

drill_root="${QUALITY_LEGS_DRILL_TMPDIR:-${TMPDIR:-/tmp}}"
mkdir -p "$drill_root"
sandbox="$(cd "$drill_root" && pwd)/quality-legs-drill.$$"
trap 'rm -rf "$sandbox"' EXIT

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
      # copy of these lines and requires every job's step #2 to be exactly it.
      - name: ci.yml is the reviewed one
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
# that it necessarily shows up as an edit to files whose only job is to be looked at.
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
# always be re-blessed by whoever edits the tree. What is left, and what is required
# here, is that doing it necessarily edits .github/ci-workflow.lock — a file that
# exists for nothing else, in a PR that already has to pass review to touch
# .github/workflows at all.
reset_sandbox
patch_ci_job typecheck '      - run: pnpm install --frozen-lockfile' \
'      - run: |
          echo "npm_config_script_shell=/bin/echo" >> "$GITHUB_ENV"
          pnpm install --frozen-lockfile'
regen_sandbox
expect_green_only_by_visible_edit \
  "typecheck poisoned AND lock AND canonical both regenerated — the machine says yes, the diff says what happened" \
  .github/ci-workflow.lock .github/workflows/ci.yml
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
