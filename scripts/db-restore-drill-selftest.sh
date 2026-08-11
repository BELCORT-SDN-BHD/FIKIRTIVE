#!/usr/bin/env bash
# #794① — 恢复演练的自证:证明「备份能恢复」这件事本身可以被机器验证,不用等出事。
#
# 这个脚本从零走完一整条真实链路,全程零生产触碰:
#   1. 在本地 Postgres 建一个全新的空库(fresh database,不是复用的测试库)
#   2. 用 prisma migrate deploy 把**当前仓库的全部迁移**跑上去 —— 所以它同时是
#      一次 fresh-database 迁移验证:某条迁移在空库上跑不起来,这里就红
#   3. 往钱的真相里塞可数的行(CreditAccount / CreditLedger)
#   4. 用**和 worker 夜间备份完全相同的命令**做 dump:
#        pg_dump --format=custom --no-owner --no-privileges | gzip
#      (apps/worker/src/db-backup.ts 的 dumpAndUpload;命令一致是这次演练能代表
#       真实备份的前提,不一致就只是在演练一个我们自己发明的文件格式)
#   5. 跑 scripts/db-restore-drill.sh --apply,带 --expect-* 断言行数
#   6. 打印 RTO(第 5 步的耗时)
#
# 任何一步失败 = 非零退出。可以在本地跑,也可以在 CI 跑(只要有 Postgres 与
# pg_dump/pg_restore)。真实的 R2 dump 走同一个 db-restore-drill.sh,只是把第 1-4 步
# 换成「从 R2 下载那一晚的对象」。
#
# Usage:
#   scripts/db-restore-drill-selftest.sh [--rows N] [--keep] [--json <path>]
#     --rows N   seed N CreditLedger rows (default 500)
#     --keep     don't drop the scratch databases at the end (for poking around)
#     --json     forwarded to db-restore-drill.sh
#
# Env:
#   PGHOST_URL  admin connection to a LOCAL Postgres
#               (default postgres://fikirtive:fikirtive@localhost:5432/postgres)
set -euo pipefail

cd "$(dirname "$0")/.."

ROWS=500
KEEP=0
JSON_OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --rows) ROWS="${2:-}"; shift ;;
    --keep) KEEP=1 ;;
    --json) JSON_OUT="${2:-}"; shift ;;
    --help|-h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[drill-selftest] unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

ADMIN_URL="${PGHOST_URL:-postgres://fikirtive:fikirtive@localhost:5432/postgres}"
host="$(printf '%s' "$ADMIN_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#')"
case "$host" in
  localhost|127.0.0.1|::1|postgres) ;;
  *) echo "[drill-selftest] REFUSING: PGHOST_URL host '$host' is not local. This script only ever runs against a local Postgres." >&2; exit 3 ;;
esac

# Both names carry _test / _drill so db-restore-drill.sh's own guard also accepts them,
# and so nothing here can ever be mistaken for a real database.
SRC_DB="fikirtive_794_selftest_source_test"
DST_DB="fikirtive_794_selftest_restore_drill"
base_url="${ADMIN_URL%/*}"
SRC_URL="$base_url/$SRC_DB"
DST_URL="$base_url/$DST_DB"

for bin in psql pg_dump pg_restore gzip; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[drill-selftest] error: '$bin' not on PATH." >&2; exit 4; }
done

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR"
  if [ "$KEEP" != 1 ]; then
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$SRC_DB\";" >/dev/null 2>&1 || true
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$DST_DB\";" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[drill-selftest] 1/6 fresh source database: $SRC_DB"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$SRC_DB\";"
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$SRC_DB\";"

echo "[drill-selftest] 2/6 prisma migrate deploy (fresh-database migration check)"
DATABASE_URL="$SRC_URL" corepack pnpm --filter @fikirtive/db exec prisma migrate deploy >/dev/null

echo "[drill-selftest] 3/6 seed the money truth ($ROWS ledger rows)"
psql "$SRC_URL" -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO "Organization" ("id", "name", "updatedAt") VALUES ('drill-org', 'Drill org', now());
INSERT INTO "CreditAccount" ("orgId", "balance", "reserved", "updatedAt") VALUES ('drill-org', 10000, 0, now());
INSERT INTO "CreditLedger" ("id", "orgId", "kind", "source", "balanceDelta", "reservedDelta", "idempotencyKey", "createdBy")
SELECT 'drill-' || g, 'drill-org', 'GRANT'::"CreditTxnKind", 'ADMIN'::"CreditTxnSource", 1, 0, 'drill-key-' || g, 'drill'
  FROM generate_series(1, $ROWS) AS g;
SQL
expect_ledger="$(psql "$SRC_URL" -t -A -c 'select count(*) from "CreditLedger";')"
expect_accounts="$(psql "$SRC_URL" -t -A -c 'select count(*) from "CreditAccount";')"
echo "[drill-selftest]     source truth: CreditLedger=$expect_ledger CreditAccount=$expect_accounts"

echo "[drill-selftest] 4/6 dump with the worker's exact command (pg_dump --format=custom | gzip)"
dump_gz="$WORKDIR/fikirtive-selftest.dump.gz"
pg_dump --format=custom --no-owner --no-privileges --dbname "$SRC_URL" | gzip > "$dump_gz"
echo "[drill-selftest]     dump: $(wc -c < "$dump_gz" | tr -d ' ') bytes"

echo "[drill-selftest] 5/6 restore drill (the real script, with assertions)"
drill_args=(--apply "$dump_gz" "$DST_URL" --expect-ledger "$expect_ledger" --expect-accounts "$expect_accounts")
[ -n "$JSON_OUT" ] && drill_args+=(--json "$JSON_OUT")
bash scripts/db-restore-drill.sh "${drill_args[@]}"

echo "[drill-selftest] 6/6 PASS — a dump produced by the nightly backup's own command"
echo "[drill-selftest]      restored into a fresh database with the money truth intact."
