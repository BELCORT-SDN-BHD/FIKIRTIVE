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
# crashed holder detectable, and only a lock whose recorded pid is provably dead is
# stolen. An empty pid file is the tiny window between mkdir and the write — always
# wait on it, never steal it.
# Fixed /tmp on purpose, NOT $TMPDIR: a mutex only works if every party resolves the
# same path, and on macOS TMPDIR differs between launchd services (the CI runner) and
# user shells (local runs) — an env-dependent lock path would quietly stop excluding.
quality_lock_dir="${QUALITY_LOCK_DIR:-/tmp/fikirtive-quality.lock}"
quality_lock_held=""

# Stealing a stale lock must itself be atomic: two waiters can both judge the same
# lock dead. Renaming the directory decides the winner — exactly one mv succeeds,
# the loser's mv fails on the now-missing path and goes back to waiting on the
# winner's fresh lock. Never rm -rf the live path: between "judged dead" and "rm",
# the path may already be someone else's brand-new lock.
steal_stale_lock() {
  local graveyard="${quality_lock_dir}.stale.$$"
  if mv "$quality_lock_dir" "$graveyard" 2>/dev/null; then
    echo "quality: reclaimed stale lock ($1)"
    rm -rf "$graveyard"
  fi
}

lock_age_seconds() {
  local mtime
  mtime="$(stat -f %m "$quality_lock_dir" 2>/dev/null || stat -c %Y "$quality_lock_dir" 2>/dev/null || true)"
  if [[ -z "$mtime" ]]; then
    echo 0
  else
    echo $(( $(date +%s) - mtime ))
  fi
}

acquire_quality_lock() {
  while true; do
    if mkdir "$quality_lock_dir" 2>/dev/null; then
      echo "$$" > "$quality_lock_dir/pid"
      quality_lock_held=1
      return 0
    fi
    local holder
    holder="$(cat "$quality_lock_dir/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      steal_stale_lock "held by dead pid $holder"
      continue
    fi
    if [[ -z "$holder" ]]; then
      # No pid file: the holder is inside the mkdir→write-pid window (milliseconds),
      # or it died inside it. Age decides — a healthy holder writes its pid long
      # before 60s, so an old pid-less lock can only be a corpse. Without this, a
      # crash in that window would park every later run forever.
      local age
      age="$(lock_age_seconds)"
      if (( age > 60 )); then
        steal_stale_lock "no pid recorded after ${age}s"
        continue
      fi
    fi
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
acquire_quality_lock
# Trap goes on right after the lock so no exit path leaks it. At this point
# local_database is still "" — cleanup only releases the lock. The name is
# validated BEFORE it is assigned to local_database, so the FORCE-drop in cleanup
# can never see an unvalidated name (FIKIRTIVE_TEST_DB=fikirtive must die at the
# validation, not reach DROP DATABASE — that is the dev database).
trap cleanup_quality_run EXIT
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
