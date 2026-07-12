#!/usr/bin/env bash
# Recovery drill for the nightly Postgres → R2 backup (P0-1②, verdict 7-1).
# "没有恢复演练的备份不算备份" — this automates the runbook's manual restore into a
# LOCAL throwaway DB and reconciles the money-truth row counts (CreditLedger /
# CreditAccount) so a dump is proven restorable BEFORE anyone needs it for real.
#
# SAFE BY DEFAULT:
#   - DRY RUN unless --apply is passed (prints the exact commands, runs nothing).
#   - --apply refuses any non-local target host and any DB name that isn't clearly a
#     drill/test DB. It NEVER touches prod / Neon — restoring prod is a founder-only,
#     out-of-band operation (see docs/runbooks/db-backup.md).
#
# Usage:
#   scripts/db-restore-drill.sh <dump-file[.gz]>                 # dry run (default)
#   scripts/db-restore-drill.sh --apply <dump-file[.gz]> [target-url]
#     target-url default: postgres://fikirtive:fikirtive@localhost:5432/restore_drill
set -euo pipefail

APPLY=0
DUMP=""
TARGET_URL="postgres://fikirtive:fikirtive@localhost:5432/restore_drill"
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --help|-h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) if [ -z "$DUMP" ]; then DUMP="$arg"; else TARGET_URL="$arg"; fi ;;
  esac
done

if [ -z "$DUMP" ]; then
  echo "[restore-drill] error: pass a dump file. See --help." >&2
  exit 2
fi
if [ ! -f "$DUMP" ]; then
  echo "[restore-drill] error: dump file not found: $DUMP" >&2
  exit 2
fi

# ---- parse + guard the target (only enforced on --apply) ----
host="$(printf '%s' "$TARGET_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#')"
dbname="$(printf '%s' "$TARGET_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"

is_local=0
case "$host" in localhost|127.0.0.1|::1|postgres) is_local=1 ;; esac
is_drill_db=0
case "$dbname" in *drill*|*restore*|*_test) is_drill_db=1 ;; esac

# custom-format dump → pg_restore; if gzipped we decompress to a sibling .dump first
plain_dump="$DUMP"
case "$DUMP" in *.gz) plain_dump="${DUMP%.gz}" ;; esac

echo "[restore-drill] dump         : $DUMP"
echo "[restore-drill] target host  : $host   (local: $is_local)"
echo "[restore-drill] target db    : $dbname (drill/test: $is_drill_db)"
echo "[restore-drill] mode         : $([ "$APPLY" = 1 ] && echo APPLY || echo 'DRY RUN (no changes)')"

restore_cmds() {
  cat <<EOF
  # 1. (if gzipped) decompress the custom-format dump
  [ "$DUMP" != "$plain_dump" ] && gunzip -kf "$DUMP"
  # 2. recreate a clean throwaway target DB
  psql "postgres://fikirtive:fikirtive@$host:5432/postgres" -c 'DROP DATABASE IF EXISTS "$dbname";'
  psql "postgres://fikirtive:fikirtive@$host:5432/postgres" -c 'CREATE DATABASE "$dbname";'
  # 3. restore (custom format → pg_restore, NOT psql)
  pg_restore --no-owner --no-privileges -d "$TARGET_URL" "$plain_dump"
  # 4. reconcile the money truth against prod's same-night counts
  psql "$TARGET_URL" -c 'select count(*) as credit_ledger_rows from "CreditLedger";'
  psql "$TARGET_URL" -c 'select count(*) as credit_account_rows from "CreditAccount";'
EOF
}

if [ "$APPLY" != 1 ]; then
  echo "[restore-drill] would run:"
  restore_cmds
  echo "[restore-drill] DRY RUN complete — pass --apply to execute against the LOCAL target above."
  exit 0
fi

# ---- --apply: hard local-only guards (never prod / Neon) ----
if [ "$is_local" != 1 ]; then
  echo "[restore-drill] REFUSING --apply: target host '$host' is not local. Prod/Neon restore is founder-only, out-of-band." >&2
  exit 3
fi
if [ "$is_drill_db" != 1 ]; then
  echo "[restore-drill] REFUSING --apply: target db '$dbname' is not a drill/test DB (need *drill*/*restore*/*_test)." >&2
  exit 3
fi
for bin in psql pg_restore gunzip; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[restore-drill] error: '$bin' not on PATH." >&2; exit 4; }
done

echo "[restore-drill] applying restore into LOCAL $dbname ..."
if [ "$DUMP" != "$plain_dump" ]; then gunzip -kf "$DUMP"; fi
psql "postgres://fikirtive:fikirtive@$host:5432/postgres" -c "DROP DATABASE IF EXISTS \"$dbname\";"
psql "postgres://fikirtive:fikirtive@$host:5432/postgres" -c "CREATE DATABASE \"$dbname\";"
pg_restore --no-owner --no-privileges -d "$TARGET_URL" "$plain_dump"
echo "[restore-drill] reconcile (compare against prod's same-night counts):"
psql "$TARGET_URL" -c 'select count(*) as credit_ledger_rows from "CreditLedger";'
psql "$TARGET_URL" -c 'select count(*) as credit_account_rows from "CreditAccount";'
echo "[restore-drill] drill complete. A restore that matches prod row counts = the backup is real."
