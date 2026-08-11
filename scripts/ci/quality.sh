#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "quality: not inside a Git worktree" >&2
  exit 1
}
cd "$repo_root"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "quality: Node 22 is required (found $(node --version))" >&2
  exit 1
fi

expected_pnpm="$(node -p 'require("./package.json").packageManager.replace(/^pnpm@/, "")')"
actual_pnpm="$(pnpm --version)"
if [[ "$actual_pnpm" != "$expected_pnpm" ]]; then
  echo "quality: pnpm $expected_pnpm is required (found $actual_pnpm)" >&2
  exit 1
fi

# ── gate timing ────────────────────────────────────────────────────────────────
# Every gate below runs through `gate`, which prints its own wall time and appends
# it to a summary printed at the end. Without per-gate numbers, "quality is slow"
# is a feeling; with them it is a list you can act on (#800).
gate_timings=()
quality_started_at="$(date +%s)"

gate() {
  local name="$1"
  shift
  local started
  started="$(date +%s)"
  echo "quality: ▶ $name"
  "$@"
  local elapsed=$(($(date +%s) - started))
  gate_timings+=("$(printf '%6ss  %s' "$elapsed" "$name")")
  echo "quality: ✔ $name (${elapsed}s)"
}

print_gate_summary() {
  local total=$(($(date +%s) - quality_started_at))
  echo ""
  echo "quality: gate timings (slowest gate is the next thing worth fixing)"
  local row
  # `${a[@]+...}`: bash 3.2 (macOS default) treats an empty array as unset under `set -u`.
  for row in ${gate_timings[@]+"${gate_timings[@]}"}; do
    echo "  $row"
  done
  printf '  %6ss  TOTAL\n' "$total"
}

base_database_url="${DATABASE_URL:-postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test}"
database_name="$(DATABASE_URL="$base_database_url" node -e '
  const url = new URL(process.env.DATABASE_URL);
  process.stdout.write(decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || ""));
')"
if [[ ! "$database_name" =~ _test$ ]]; then
  echo "quality: refuses DATABASE_URL whose database does not end in _test" >&2
  exit 1
fi

# Test-run connection ceiling. packages/db/src/index.ts defaults the pg pool to 10 per
# process, which is right for a production replica and wrong for a laptop running several
# agent worktrees at once: N suites × 10 saturates local Postgres and turns unrelated tests
# red (measured 5+ times on 2026-08-08). Production defaults are untouched — this export
# lives in the test harness only.
#
# Why 4 and not the 2 #800 proposed: the concurrency tests need THREE live connections at
# once (transaction A holds a row/advisory lock, transaction B blocks on it, and a third
# connection asks Postgres via pg_blocking_pids whether B is really blocked). At 2 the third
# query waits for a pool slot instead, so `expectPostgresBlockedBy` sees "not blocked" and
# the lock proof evaporates. Measured 2026-08-08 on apps/web's integration project:
#   DB_POOL_MAX=2 → 3 failed / 55 passed, 172s   (campaign-lifecycle undo-vs-charge,
#                                                 canvas-terminal-settlement, customer-workflow ×2)
#   DB_POOL_MAX=4 → 58 passed, 74s
#   DB_POOL_MAX=6 → 58 passed, 120s
#   DB_POOL_MAX=10 (old default) → 58 passed, 144s
# Of the four ceilings measured, 4 is the smallest that keeps every lock proof meaningful,
# and it happened to be the fastest of the four as well. 3 was never measured, so read this
# as "smallest measured green value", not as a proven floor.
export DB_POOL_MAX="${DB_POOL_MAX:-4}"

local_database=""

create_local_database() {
  pnpm --filter @fikirtive/db exec node -e '
    const { Client } = require("pg");
    const target = process.env.FIKIRTIVE_TEST_DB;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = "/postgres";
    (async () => {
      const client = new Client({ connectionString: url.toString() });
      await client.connect();
      const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
      if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${target}"`);
      await client.end();
    })().catch((error) => {
      console.error(`quality: failed to create isolated test database: ${error.message}`);
      process.exit(1);
    });
  '
}

# The drop runs on the exit path, and on the exit path a hang is not a slow drop —
# it is a machine-wide outage. Cleanup never reaches the lock release, the run
# becomes an abandoned holder of the machine mutex, and every later run starves on
# it (#855, measured 2026-08-11: one DROP sat 1h31m, its run held the lock 2h12m,
# two CI runs died waiting). So the drop is bounded three times over:
#   - Postgres aborts the statement itself (statement_timeout). DROP ... WITH
#     (FORCE) waits on other backends, and on a loaded machine that wait has no
#     ceiling of its own.
#   - node exits hard on error instead of setting process.exitCode: an errored
#     client is still connected, and an open socket keeps the event loop — and the
#     whole cleanup — alive forever.
#   - a pure-bash watchdog kills the process tree if anything UPSTREAM of the
#     statement is what wedged (connect, pnpm, node startup).
# Every budget is far below the job budget on purpose: an abandoned drop costs one
# stray database, a wedged drop costs the machine.
quality_drop_timeout_seconds="${QUALITY_DROP_TIMEOUT_SECONDS:-60}"

drop_local_database_now() {
  FIKIRTIVE_TEST_DB="$local_database" pnpm --filter @fikirtive/db exec node -e '
    const { Client } = require("pg");
    const target = process.env.FIKIRTIVE_TEST_DB;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = "/postgres";
    (async () => {
      const client = new Client({
        connectionString: url.toString(),
        connectionTimeoutMillis: 15000,
      });
      await client.connect();
      await client.query("SET statement_timeout = 30000");
      await client.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
      await client.end();
    })().catch((error) => {
      console.error(`quality: failed to drop isolated test database: ${error.message}`);
      process.exit(1);
    });
  '
}

# run_with_timeout lives in the lock library below — defined later in the file,
# resolved at call time, which is inside the EXIT trap.
drop_local_database() {
  run_with_timeout "$quality_drop_timeout_seconds" drop_local_database_now
}

# >>> quality-lock library ─────────────────────────────────────────────────────
# Everything between these two markers is extracted verbatim and sourced by
# scripts/ci/quality-lock.drill.sh, which exercises it against a throwaway
# QUALITY_LOCK_DIR. Keep this block free of anything that needs the database, the
# network, or an installed workspace: the drill has to be able to run the real
# code on a machine where nothing is built.

# Kill a process and everything below it, children first. Parent-first kills hand
# the children to pid 1, which is how #855 also left a vitest burning CPU for two
# hours after its run was cancelled. Returns 0 only when the target is provably
# gone; callers use that answer to decide whether taking over the target's lock is
# safe.
kill_process_tree() {
  local pid="$1" child waited=0
  # Never aim at init, at "the whole process group" (pid 0), or at ourselves.
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || (( pid <= 1 )) || [[ "$pid" == "$$" || "$pid" == "${BASHPID:-}" ]]; then
    return 1
  fi
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_process_tree "$child" || true
  done
  kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null || true
  while (( waited < 5 )); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
    waited=$((waited + 1))
  done
  kill -KILL "$pid" 2>/dev/null || true
  sleep 1
  ! kill -0 "$pid" 2>/dev/null
}

# macOS ships no GNU `timeout` and CI must not depend on Homebrew being on PATH,
# so the watchdog is pure bash: run the command in the background, poll once a
# second, kill its whole tree when the budget is spent. Returns the command's own
# status, or 124 (timeout(1)'s convention) when the budget ran out. Polling with
# `kill -0` is safe here because bash reaps background children as they exit, so a
# finished child stops being visible while `wait` still reports its status.
run_with_timeout() {
  local seconds="$1"
  shift
  local status=0 waited=0 child
  "$@" &
  child=$!
  while (( waited < seconds )); do
    if ! kill -0 "$child" 2>/dev/null; then
      wait "$child" || status=$?
      return "$status"
    fi
    sleep 1
    waited=$((waited + 1))
  done
  kill_process_tree "$child" || true
  wait "$child" 2>/dev/null || true
  return 124
}

# One machine, one Postgres: two overlapping quality runs starve each other into
# false reds (hook timeouts in packages/db — measured repeatedly on this repo), so a
# run first takes a machine-wide mutex. mkdir is atomic; the pid file inside makes a
# crashed holder detectable. A lock is stale when its recorded pid is provably dead,
# or when it has sat >60s with no pid at all (a healthy holder writes its pid
# milliseconds after mkdir, so an old pid-less lock can only be a corpse).
# Fixed /tmp on purpose, NOT $TMPDIR: a mutex only works if every party resolves the
# same path, and on macOS TMPDIR differs between launchd services (the CI runner) and
# user shells (local runs) — an env-dependent lock path would quietly stop excluding.
quality_lock_dir="${QUALITY_LOCK_DIR:-/tmp/fikirtive-quality.lock}"
quality_lock_held=""

# How long an ORPHANED holder may keep the machine before waiters treat its lock
# as abandoned. See holder_is_abandoned_orphan for why orphan ≠ dead.
quality_orphan_grace_seconds="${QUALITY_ORPHAN_GRACE_SECONDS:-120}"

# A lock is stale when its recorded pid is provably dead, or when it has sat for
# over 60s with no pid at all (a healthy holder writes its pid milliseconds after
# mkdir, so an old pid-less lock can only be a corpse — without this rule a crash
# inside that window would park every later run forever).
#
# STEALING IS NOT "judge, then mv": between a waiter's staleness judgment and its
# mv, the path may already hold someone else's brand-new live lock, and mv moves
# whatever is there NOW, not the incarnation that was judged. So the steal happens
# inside a tiny arbiter mutex and RE-DERIVES staleness in there: under the arbiter
# no other stealer can interleave, and a fresh holder's lock re-reads as alive (or
# as too young) and is left alone. A corpse ARBITER (stealer killed inside the
# ms-long critical section) is deliberately NOT auto-recovered — see the note in
# try_steal_stale_lock; runs keep waiting and print the manual recovery line.
quality_steal_arbiter="${quality_lock_dir}.arbiter"

lock_mtime_epoch() {
  # BSD stat first, GNU stat second — and trust neither blindly: GNU stat -f
  # writes a filesystem report to stdout before failing, so anything that is not
  # a pure integer is discarded rather than fed into arithmetic.
  local raw
  raw="$(stat -f %m "$1" 2>/dev/null)"
  if [[ ! "$raw" =~ ^[0-9]+$ ]]; then
    raw="$(stat -c %Y "$1" 2>/dev/null)"
  fi
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    echo "$raw"
  else
    echo ""
  fi
}

path_age_seconds() {
  local mtime
  mtime="$(lock_mtime_epoch "$1")"
  if [[ -z "$mtime" ]]; then
    echo 0
  else
    echo $(( $(date +%s) - mtime ))
  fi
}

# The third staleness rule, and the only one that judges a LIVE process (#855).
# A cancelled CI job leaves quality.sh running but reparented to pid 1: its
# launcher is gone, so nobody will ever read its result, and if it is wedged in
# cleanup (the incident: a DROP DATABASE that sat 1h31m) it will never release the
# lock either. "Provably dead" never fires for such a holder, so before this rule
# every later run simply waited until its own job timeout killed it — the machine
# was starved by a process no one wanted any more.
#
# PPID 1 is the honest signal that the holder was abandoned rather than merely
# slow, and the grace period is what keeps the rule from being a race: the holder
# must ALSO have owned the machine longer than the grace period, so a run that is
# reparented milliseconds before finishing is left alone.
#
# ACCEPTED COST: a run deliberately detached from its launcher (`nohup`, `disown`,
# a background job whose parent shell exits) is orphaned from birth and therefore
# reads as abandoned once past the grace period — it can be killed and its lock
# taken. Attended runs — CI, a terminal, any launcher that outlives the run — are
# untouched, and every steal names the pid it killed. Raise
# QUALITY_ORPHAN_GRACE_SECONDS if a detached run must survive longer.
holder_is_abandoned_orphan() {
  local holder="$1" ppid
  ppid="$(ps -p "$holder" -o ppid= 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$ppid" == "1" ]] || return 1
  (( $(path_age_seconds "$quality_lock_dir") > quality_orphan_grace_seconds ))
}

# Returns 0 if the CURRENT lock at $quality_lock_dir is stale (dead pid, abandoned
# orphan pid, or no pid and older than 60s). Must be called with the arbiter held
# for a steal decision.
current_lock_is_stale() {
  local holder age
  holder="$(cat "$quality_lock_dir/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]]; then
    if ! kill -0 "$holder" 2>/dev/null; then
      return 0
    fi
    if holder_is_abandoned_orphan "$holder"; then
      return 0
    fi
    return 1
  fi
  age="$(path_age_seconds "$quality_lock_dir")"
  (( age > 60 ))
}

try_steal_stale_lock() {
  # A corpse arbiter (a stealer killed inside this ms-long critical section) is NOT
  # auto-recovered: any "judge age, then remove the shared path" here would recreate
  # the exact cross-generation race this arbiter exists to prevent, one level down —
  # and there is no deeper mutex to hide behind. The trade is deliberate: dying
  # inside a window this narrow is vanishingly rare, and the failure mode is loud
  # (every run prints the manual recovery line below until a human clears it),
  # while the common corpse — a dead quality RUN — is still recovered automatically.
  if [[ -d "$quality_steal_arbiter" ]] && (( $(path_age_seconds "$quality_steal_arbiter") > 60 )); then
    echo "quality: steal arbiter has been held for >60s — if no stealer process is alive, recover manually with: rm -rf $quality_steal_arbiter" >&2
  fi
  if ! mkdir "$quality_steal_arbiter" 2>/dev/null; then
    return 1  # another stealer is arbitrating — just go back to waiting
  fi
  local outcome=0
  if current_lock_is_stale; then
    local holder take=1
    holder="$(cat "$quality_lock_dir/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
      # Only the orphan rule can call a LIVE holder stale, and an abandoned holder
      # has to be gone BEFORE its lock changes hands: it still owns a wedged
      # cleanup whose last act is `rm -rf $quality_lock_dir`, which would delete
      # the next holder's brand-new lock, and its children may still be burning the
      # CPU the next run needs. kill_process_tree only reports success once the
      # holder is provably dead, so that cleanup has already run by then.
      echo "quality: lock holder pid $holder is an orphan (PPID 1) past ${quality_orphan_grace_seconds}s — clearing it before taking the lock"
      if kill_process_tree "$holder"; then
        echo "quality: cleared abandoned holder pid $holder and its children"
      else
        # A lock held by a process we could not stop is not ours to give away.
        # Returning non-zero sends the caller back to its 30s wait instead of
        # spinning on a steal that cannot succeed.
        echo "quality: could not kill abandoned holder pid $holder — NOT stealing its lock; recover manually with: kill -9 $holder && rm -rf $quality_lock_dir" >&2
        take=0
        outcome=1
      fi
    fi
    if (( take )); then
      local graveyard="${quality_lock_dir}.stale.$$"
      if mv "$quality_lock_dir" "$graveyard" 2>/dev/null; then
        echo "quality: reclaimed stale lock"
        rm -rf "$graveyard"
      fi
    fi
  fi
  rmdir "$quality_steal_arbiter" 2>/dev/null || rm -rf "$quality_steal_arbiter"
  return "$outcome"
}

acquire_quality_lock() {
  while true; do
    if mkdir "$quality_lock_dir" 2>/dev/null; then
      # Flag before pid write: the EXIT trap is already installed, so a death in
      # this window still removes the lock instead of leaving a pid-less corpse.
      # ACCEPTED RESIDUAL: a signal landing between the mkdir syscall and this
      # assignment leaves a flagless, pid-less lock that cleanup will not remove —
      # bash cannot fuse a syscall and a variable write into one atom. That corpse
      # is exactly what the >60s pid-less rule recovers, so the cost is a bounded
      # stall (worst case ~90s: the 60s age threshold plus one 30s poll), not a
      # deadlock.
      quality_lock_held=1
      echo "$$" > "$quality_lock_dir/pid"
      return 0
    fi
    if current_lock_is_stale; then
      # A failed steal (arbiter busy or corpse-arbiter policy) must NOT skip the
      # wait: with a corpse main lock AND a corpse arbiter this branch would
      # otherwise spin hot and flood the log. One steal attempt per 30s is plenty.
      if ! try_steal_stale_lock; then
        sleep 30
      fi
      continue
    fi
    local holder
    holder="$(cat "$quality_lock_dir/pid" 2>/dev/null || true)"
    echo "quality: another quality run (pid ${holder:-starting}) holds this machine — waiting 30s"
    sleep 30
  done
}
# <<< quality-lock library ─────────────────────────────────────────────────────

# Single EXIT trap for both responsibilities: bash keeps only one, so the database
# drop and the lock release live in one function. Each step is guarded so no step
# can abort the function under `set -e` — the lock release must run even when the
# database drop fails (Postgres down, run SIGTERMed mid-create, ...) and, since
# #855, even when the drop does not fail but simply never answers: the drop is
# time-bounded, so this function always reaches the release below. Leaving a stray
# database is litter (its name is unique to this run); leaving the machine locked
# is an outage.
cleanup_quality_run() {
  if [[ -n "$local_database" && "${FIKIRTIVE_KEEP_TEST_DB:-}" != "1" ]]; then
    drop_local_database || echo "quality: test-database drop failed or timed out after ${quality_drop_timeout_seconds}s — leaving $local_database behind and releasing the machine anyway" >&2
  fi
  if [[ -n "$quality_lock_held" ]]; then
    rm -rf "$quality_lock_dir" || true
  fi
}

# CI and local runs take the same path on purpose — there used to be a
# GITHUB_ACTIONS branch that skipped database creation because GitHub-hosted
# runners got a fresh dockerized Postgres per run. On a self-hosted runner that
# assumption silently inverts: reusing one long-lived database across PRs loses the
# fresh-database guarantee. One path, per-run database, force-dropped on exit.
# Trap goes on BEFORE the lock so cleanup runs on every exit path (with the one
# accepted residual noted at the mkdir site: a signal inside the mkdir→flag window
# leaves a corpse for the >60s rule instead). Cleanup no-ops on whatever was not
# yet acquired. At this point local_database is still "" — cleanup only releases
# the lock. The name is validated BEFORE it is assigned to local_database, so the
# FORCE-drop in cleanup can never see an unvalidated name (FIKIRTIVE_TEST_DB=
# fikirtive must die at the validation, not reach DROP DATABASE — that is the dev
# database).
trap cleanup_quality_run EXIT
acquire_quality_lock
requested_database="${FIKIRTIVE_TEST_DB:-fikirtive_$$_${RANDOM}_test}"
if [[ ! "$requested_database" =~ ^[a-z0-9_]+_test$ ]]; then
  echo "quality: FIKIRTIVE_TEST_DB must match ^[a-z0-9_]+_test$" >&2
  exit 1
fi
local_database="$requested_database"
DATABASE_URL="$(DATABASE_URL="$base_database_url" FIKIRTIVE_TEST_DB="$local_database" node -e '
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${process.env.FIKIRTIVE_TEST_DB}`;
  process.stdout.write(url.toString());
')"
export DATABASE_URL
export FIKIRTIVE_TEST_DB="$local_database"
create_local_database
echo "quality: using isolated database $local_database"

# ── gate order ─────────────────────────────────────────────────────────────────
# Same gates as before, nothing dropped — only reordered so a failure surfaces as
# early as it possibly can. Cheapest and most-often-broken first; the two long poles
# (the full test suite, `next build`) last. Constraint: everything after the packages
# build needs `packages/*/dist` and the generated Prisma client, so that build cannot
# move.

# 1. Pure text fences — grep only, no build, ~1s. Nothing should ever run before these.
gate "skill-import fence" bash scripts/check-skill-imports.sh
gate "destructive-migration fence" bash scripts/check-destructive-migrations.sh
# The gate that decides whether the gates run. Its own self-test therefore goes first
# among the things that can be checked without a build (#809).
gate "PR-scope gate self-test" bash scripts/__tests__/pr-scope.test.sh

# 2. The one unavoidable prerequisite: dist + generated Prisma client.
gate "packages build" pnpm --filter "./packages/*" build

# 3. Static analysis over the whole workspace — fast relative to tests, catches most breaks.
gate "typecheck" pnpm -r typecheck
gate "lint" pnpm lint

# 4. Small node checks that only need packages/* built.
gate "otto CATALOG.md freshness" pnpm --filter @fikirtive/otto catalog:check
gate "margin-floor gate self-test" node scripts/__tests__/check-margin-floor.test.mjs
gate "margin floor" node scripts/check-margin-floor.mjs

# 5. Schema truth: the migrations must deploy and must fully describe schema.prisma.
gate "prisma migrate deploy" pnpm --filter @fikirtive/db exec prisma migrate deploy
gate "prisma schema drift" pnpm --filter @fikirtive/db exec prisma migrate diff \
  --from-config-datasource \
  --to-schema prisma/schema.prisma \
  --exit-code

# 6. Long pole #1 — the full suite.
gate "tests" pnpm -r test

# 7. Long pole #2 — `next build`. Last on purpose: it is the only gate that needs a
#    healthy heap ceiling (see NODE_OPTIONS in ci.yml) and it re-runs a TypeScript pass,
#    so anything it would catch on its own is already covered above except the
#    build-only failures (e.g. the `"use server"` re-export trap, #741) — which is
#    exactly why it still runs on every commit.
gate "web build" pnpm --filter @fikirtive/web build

print_gate_summary
