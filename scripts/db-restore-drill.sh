#!/usr/bin/env bash
# Recovery drill for the nightly Postgres → R2 backup (P0-1②, verdict 7-1; hardened #794①).
# "没有恢复演练的备份不算备份" — this automates the runbook's manual restore into a
# LOCAL throwaway DB and reconciles the money-truth row counts (CreditLedger /
# CreditAccount) so a dump is proven restorable BEFORE anyone needs it for real.
#
# #794 made the drill a PASS/FAIL instead of a print:
#   - it TIMES the restore and reports the number as RTO (recovery time objective),
#   - --expect-ledger / --expect-accounts turn reconciliation into an assertion, so a
#     dump that restores but comes back short EXITS NON-ZERO instead of printing a
#     number nobody compares,
#   - --json writes a machine-readable result (for CI, for pasting into a ticket).
# Run it against ANY dump file: last night's R2 object, a staging dump, or the
# synthetic one scripts/db-restore-drill-selftest.sh builds on a fresh database.
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
#   Options:
#     --expect-ledger N     fail unless the restored CreditLedger has exactly N rows
#     --expect-accounts N   fail unless the restored CreditAccount has exactly N rows
#     --json <path>         write {rto_seconds, ledger_rows, account_rows, ...} to <path>
set -euo pipefail

APPLY=0
DUMP=""
TARGET_URL="postgres://fikirtive:fikirtive@localhost:5432/restore_drill"
EXPECT_LEDGER=""
EXPECT_ACCOUNTS=""
JSON_OUT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --help|-h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --expect-ledger) EXPECT_LEDGER="${2:-}"; shift ;;
    --expect-accounts) EXPECT_ACCOUNTS="${2:-}"; shift ;;
    --json) JSON_OUT="${2:-}"; shift ;;
    *) if [ -z "$DUMP" ]; then DUMP="$1"; else TARGET_URL="$1"; fi ;;
  esac
  shift
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
#
# P1-1 (judge r1, PRODUCTION RED LINE): the URL body is NOT the connection target.
# libpq lets query params override it, so
#   postgres://u:p@localhost/restore_drill?host=prod.example&dbname=production
# reads `localhost` / `restore_drill` to a naive sed but connects to `prod.example`
# / `production`. hostaddr= and service= redirect too (service= reads a service file
# that can point anywhere). So the guard REFUSES any connection param that can move
# the target, then extracts host/db from the (now trusted) body. No override param
# survives to reach libpq — belt (reject) and braces (the body checks below).
reject_target_override_params() {
  local url="$1"
  local query=""
  case "$url" in *\?*) query="${url#*\?}" ;; esac
  [ -z "$query" ] && return 0
  # whole-key match on the query's key=value pairs; case-insensitive to be safe
  if printf '%s' "$query" | grep -qiE '(^|[?&;[:space:]])(host|hostaddr|port|dbname|user|service)=' ; then
    echo "[restore-drill] REFUSING: connection URL carries a target-override param (host/hostaddr/port/dbname/user/service=)." >&2
    echo "[restore-drill]           libpq would resolve it past the local-only guard. Pass a plain postgres://<user>:<pw>@localhost/<drill-db> with no such params." >&2
    return 1
  fi
  return 0
}

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
# First: no connection param may redirect the target past the host/db checks (P1-1).
reject_target_override_params "$TARGET_URL" || exit 3
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

admin_url="postgres://fikirtive:fikirtive@$host:5432/postgres"

# ── RTO clock ────────────────────────────────────────────────────────────────
# Starts at "I have the dump file" and stops when the restored DB answers a query.
# Deliberately EXCLUDES downloading the object from R2 (network-bound, and the
# founder does that step by hand) — the runbook states the download separately so
# the two numbers are never quietly added or quietly dropped.
started_at="$(date +%s)"

echo "[restore-drill] applying restore into LOCAL $dbname ..."
if [ "$DUMP" != "$plain_dump" ]; then gunzip -kf "$DUMP"; fi
psql "$admin_url" -q -c "DROP DATABASE IF EXISTS \"$dbname\";"
psql "$admin_url" -q -c "CREATE DATABASE \"$dbname\";"
pg_restore --no-owner --no-privileges -d "$TARGET_URL" "$plain_dump"

count_of() {
  psql "$TARGET_URL" -t -A -c "select count(*) from \"$1\";"
}
ledger_rows="$(count_of CreditLedger)"
account_rows="$(count_of CreditAccount)"

rto_seconds=$(($(date +%s) - started_at))

echo "[restore-drill] reconcile (compare against prod's same-night counts):"
echo "[restore-drill]   CreditLedger  rows: $ledger_rows"
echo "[restore-drill]   CreditAccount rows: $account_rows"
echo "[restore-drill] RTO: ${rto_seconds}s (decompress + create + pg_restore + reconcile; excludes downloading the dump)"

if [ -n "$JSON_OUT" ]; then
  printf '{"dump":"%s","target_db":"%s","rto_seconds":%s,"ledger_rows":%s,"account_rows":%s,"finished_at":"%s"}\n' \
    "$DUMP" "$dbname" "$rto_seconds" "$ledger_rows" "$account_rows" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$JSON_OUT"
  echo "[restore-drill] wrote $JSON_OUT"
fi

# ── assertions: a drill that cannot fail proves nothing ──────────────────────
fail=0
if [ -n "$EXPECT_LEDGER" ] && [ "$ledger_rows" != "$EXPECT_LEDGER" ]; then
  echo "[restore-drill] MISMATCH: CreditLedger restored $ledger_rows rows, expected $EXPECT_LEDGER" >&2
  fail=1
fi
if [ -n "$EXPECT_ACCOUNTS" ] && [ "$account_rows" != "$EXPECT_ACCOUNTS" ]; then
  echo "[restore-drill] MISMATCH: CreditAccount restored $account_rows rows, expected $EXPECT_ACCOUNTS" >&2
  fail=1
fi
if [ "$fail" != 0 ]; then
  echo "[restore-drill] DRILL FAILED — this dump does not restore to the expected money truth." >&2
  exit 5
fi

if [ -z "$EXPECT_LEDGER" ] && [ -z "$EXPECT_ACCOUNTS" ]; then
  echo "[restore-drill] drill complete (no --expect-* given, so nothing was ASSERTED —"
  echo "[restore-drill] compare the counts above against prod's same-night numbers yourself)."
else
  echo "[restore-drill] drill PASSED: restored counts match the expected money truth."
fi
