#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "usage: bash scripts/ci/run-job.sh {check|test|web-build|lint}" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 64
fi

job="$1"
case "$job" in
  check|test|web-build|lint) ;;
  *)
    usage
    exit 64
    ;;
esac

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "run-job: not inside a Git worktree" >&2
  exit 1
}
cd "$repo_root"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "run-job: Node 22 is required (found $(node --version))" >&2
  exit 1
fi

expected_pnpm="$(node -p 'require("./package.json").packageManager.replace(/^pnpm@/, "")')"
actual_pnpm="$(pnpm --version)"
if [[ "$actual_pnpm" != "$expected_pnpm" ]]; then
  echo "run-job: pnpm $expected_pnpm is required (found $actual_pnpm)" >&2
  exit 1
fi

prepare_workspace() {
  pnpm install --frozen-lockfile
  pnpm --filter "./packages/*" build
}

case "$job" in
  check)
    prepare_workspace
    node scripts/ci/check-provider-secrecy.mjs
    pnpm -r typecheck
    bash scripts/check-skill-imports.sh
    pnpm lint:otto-cli
    bash scripts/check-northstar-imports.sh
    bash scripts/check-no-raw-prisma.sh
    pnpm --filter @fikirtive/otto run catalog:check
    node scripts/__tests__/check-parity.test.mjs
    pnpm lint:parity
    node scripts/__tests__/check-margin-floor.test.mjs
    node scripts/check-margin-floor.mjs
    bash scripts/check-blueprint-integrity.sh
    bash scripts/check-destructive-migrations.sh
    node scripts/ci/check-money-path-review.mjs
    node scripts/__tests__/verify-auth-guards.test.mjs
    node scripts/verify-auth-guards.mjs
    node scripts/route-b-matrix-check.mjs
    node --test \
      scripts/__tests__/task-ownership-check.test.mjs \
      scripts/__tests__/ci-job-parity.test.mjs \
      scripts/__tests__/check-project-authority.test.mjs \
      scripts/__tests__/governance-hooks.test.mjs
    node scripts/check-project-authority.mjs
    ;;
  test)
    node -e '
      const fail = (message) => { console.error(message); process.exit(1); };
      const raw = process.env.DATABASE_URL;
      if (!raw) fail("run-job test requires DATABASE_URL");
      let url;
      try { url = new URL(raw); } catch { fail("run-job test requires a valid DATABASE_URL"); }
      const database = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
      if (!database.endsWith("_test")) fail("run-job test refuses a non-_test database");
    '
    prepare_workspace
    pnpm --filter @fikirtive/db exec prisma migrate deploy
    pnpm --filter @fikirtive/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
    pnpm -r test
    ;;
  web-build)
    prepare_workspace
    pnpm --filter @fikirtive/web build
    ;;
  lint)
    prepare_workspace
    pnpm lint
    ;;
esac
