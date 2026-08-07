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

base_database_url="${DATABASE_URL:-postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test}"
database_name="$(DATABASE_URL="$base_database_url" node -e '
  const url = new URL(process.env.DATABASE_URL);
  process.stdout.write(decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || ""));
')"
if [[ ! "$database_name" =~ _test$ ]]; then
  echo "quality: refuses DATABASE_URL whose database does not end in _test" >&2
  exit 1
fi

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

pnpm --filter "./packages/*" build
pnpm --filter @fikirtive/db exec prisma migrate deploy
pnpm --filter @fikirtive/db exec prisma migrate diff \
  --from-config-datasource \
  --to-schema prisma/schema.prisma \
  --exit-code

pnpm -r test
pnpm -r typecheck
pnpm lint
bash scripts/check-skill-imports.sh
node scripts/__tests__/check-margin-floor.test.mjs
node scripts/check-margin-floor.mjs
bash scripts/check-destructive-migrations.sh
pnpm --filter @fikirtive/web build
