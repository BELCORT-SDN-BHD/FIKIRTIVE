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

drop_local_database() {
  FIKIRTIVE_TEST_DB="$local_database" pnpm --filter @fikirtive/db exec node -e '
    const { Client } = require("pg");
    const target = process.env.FIKIRTIVE_TEST_DB;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = "/postgres";
    (async () => {
      const client = new Client({ connectionString: url.toString() });
      await client.connect();
      await client.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
      await client.end();
    })().catch((error) => {
      console.error(`quality: failed to drop isolated test database: ${error.message}`);
      process.exitCode = 1;
    });
  '
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

# Returns 0 if the CURRENT lock at $quality_lock_dir is stale (dead pid, or no pid
# and older than 60s). Must be called with the arbiter held for a steal decision.
current_lock_is_stale() {
  local holder age
  holder="$(cat "$quality_lock_dir/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]]; then
    ! kill -0 "$holder" 2>/dev/null
    return
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
  if current_lock_is_stale; then
    local graveyard="${quality_lock_dir}.stale.$$"
    if mv "$quality_lock_dir" "$graveyard" 2>/dev/null; then
      echo "quality: reclaimed stale lock"
      rm -rf "$graveyard"
    fi
  fi
  rmdir "$quality_steal_arbiter" 2>/dev/null || rm -rf "$quality_steal_arbiter"
  return 0
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
      # one-minute stall, not a deadlock.
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

# Single EXIT trap for both responsibilities: bash keeps only one, so the database
# drop and the lock release live in one function. Each step is guarded so no step
# can abort the function under `set -e` — the lock release must run even when the
# database drop fails (Postgres down, run SIGTERMed mid-create, ...).
cleanup_quality_run() {
  if [[ -n "$local_database" && "${FIKIRTIVE_KEEP_TEST_DB:-}" != "1" ]]; then
    drop_local_database || echo "quality: test-database drop failed — leaving $local_database behind" >&2
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
# Trap goes on BEFORE the lock so no exit path can leak it — a SIGTERM between
# mkdir and anything later still runs cleanup (which no-ops on whatever was not
# yet acquired). At this point local_database is still "" — cleanup only releases
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
