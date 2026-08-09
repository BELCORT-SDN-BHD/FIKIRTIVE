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

if [[ -z "${GITHUB_ACTIONS:-}" ]]; then
  local_database="${FIKIRTIVE_TEST_DB:-fikirtive_$$_${RANDOM}_test}"
  if [[ ! "$local_database" =~ ^[a-z0-9_]+_test$ ]]; then
    echo "quality: FIKIRTIVE_TEST_DB must match ^[a-z0-9_]+_test$" >&2
    exit 1
  fi
  DATABASE_URL="$(DATABASE_URL="$base_database_url" FIKIRTIVE_TEST_DB="$local_database" node -e '
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${process.env.FIKIRTIVE_TEST_DB}`;
    process.stdout.write(url.toString());
  ')"
  export DATABASE_URL
  export FIKIRTIVE_TEST_DB="$local_database"
  create_local_database
  if [[ "${FIKIRTIVE_KEEP_TEST_DB:-}" != "1" ]]; then
    trap drop_local_database EXIT
  fi
  echo "quality: using isolated local database $local_database"
else
  export DATABASE_URL="$base_database_url"
fi

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
