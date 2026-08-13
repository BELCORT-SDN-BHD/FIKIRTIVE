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
#
# The last two cases are about the DOOR rather than the wall: an intended change to
# ci.yml, with the canonical block regenerated, must pass (that is the workflow), and
# an intended change whose diagnostics were NOT restated must still fail (that is why
# the diagnostics are kept).
#
# Nothing here touches the real repository: every case runs against a fresh copy of
# the four files the self-test reads.
#
# Run: bash scripts/__tests__/quality-legs.drill.sh          (about a minute)
#      QUALITY_LEGS_DRILL_TMPDIR=./.drill-tmp bash scripts/__tests__/quality-legs.drill.sh

set -euo pipefail

expected_cases=21

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && cd .. && pwd)"

drill_root="${QUALITY_LEGS_DRILL_TMPDIR:-${TMPDIR:-/tmp}}"
mkdir -p "$drill_root"
sandbox="$(cd "$drill_root" && pwd)/quality-legs-drill.$$"
trap 'rm -rf "$sandbox"' EXIT

ci_yml="$sandbox/.github/workflows/ci.yml"
test_sh="$sandbox/scripts/__tests__/quality-legs.test.sh"
log="$sandbox/last.log"

pass=0
fail=0
total=0

reset_sandbox() {
  rm -rf "$sandbox"
  mkdir -p "$sandbox/.github/workflows" "$sandbox/scripts/ci" "$sandbox/scripts/__tests__"
  cp "$repo_root/.github/workflows/ci.yml" "$ci_yml"
  cp "$repo_root/scripts/ci/quality.sh" "$sandbox/scripts/ci/quality.sh"
  cp "$repo_root/scripts/__tests__/quality-legs.test.sh" "$test_sh"
  cp "$repo_root/package.json" "$sandbox/package.json"
}

# An anchored text edit on the sandbox's ci.yml. The anchor must appear EXACTLY the
# number of times stated, or the drill stops: a mutation that silently did not apply
# is a case that "passed" without ever being run.
patch_ci() { # <anchor> <replacement> [<expected occurrences, default 1>]
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
patch_ci '      - uses: actions/checkout@v4' '      - uses: actions/checkout@v3' 6
expect_red "actions/checkout pinned to another version"

reset_sandbox
patch_ci '      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality --leg lint' \
'      - uses: actions/checkout@v4
        with:
          repository: someone-else/fikirtive
          ref: main
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality --leg lint'
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

echo "the door: an intended change, stated in the same commit — and one that was not:"

reset_sandbox
patch_ci '      - uses: actions/checkout@v4' '      - uses: actions/checkout@v5' 6
regen_sandbox
expect_green "checkout bumped AND the canonical block regenerated (this is the workflow)"

reset_sandbox
patch_ci '  lint:
    name: lint' \
'  lint:
    name: lint
    env:
      npm_config_script_shell: /bin/echo'
regen_sandbox
expect_red "job-level env: added AND the canonical block regenerated — the diagnostics still refuse it"
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
