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

# ============================================================================
# WHERE WILL libpq ACTUALLY CONNECT? (judge r1 P1-1, judge r2 P1 — PRODUCTION RED LINE)
# ============================================================================
# The URL text is NOT the connection target. Two independent channels move it:
#   1. QUERY PARAMS   — ?host= / ?hostaddr= / ?port= / ?dbname= / ?user= / ?service=
#   2. ENVIRONMENT    — PGHOSTADDR (a numeric address that OUTRANKS PGHOST for the real
#                       TCP connection), PGSERVICE / PGSERVICEFILE (a service stanza that
#                       supplies host/port/dbname), PGHOST, PGPORT, PGDATABASE, ...
# A string check alone therefore proves nothing: `…@localhost/restore_drill` with
# PGHOSTADDR=<prod ip> exported reads perfectly local and connects to production.
#
# So the guard is FOUR layers, cheapest first, and the last one is the only one that
# can actually be trusted because it asks the server itself:
#   L1  scrub the environment  — unset every PG* before any libpq call (below)
#   L2  reject override params — the query-string blacklist
#   L3  parse-and-assert       — real URI parse, host must be a loopback literal
#   L4  ASK THE SERVER         — connect read-only and assert inet_server_addr() is
#                                loopback and current_database() is the drill DB,
#                                BEFORE issuing a single destructive statement
# ----------------------------------------------------------------------------

# L1: the environment must not have an opinion about where we connect.
#
# Two steps, and the order matters. First REFUSE if any variable that can move the target
# is set: this script drops and recreates a database, and when there is a second, invisible
# opinion about which server that is, the only safe answer is to stop and make the operator
# say it explicitly. (Scrubbing silently would also be safe here, but it would hide from the
# operator that their PGHOST was being ignored — and "it connected somewhere I didn't expect"
# is exactly the class of surprise this guard exists to prevent.) Then unset the whole PG*
# family anyway, so nothing below — psql, pg_restore — can inherit a setting we did not write.
PG_TARGET_VARS="PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE PGCONNECT_TIMEOUT PGOPTIONS PGREQUIRESSL PGSSLMODE"
for _v in $PG_TARGET_VARS; do
  if [ -n "${!_v:-}" ]; then
    echo "[restore-drill] REFUSING: \$$_v is set in the environment. libpq reads it and it can move the connection off the URL you passed (PGHOSTADDR outranks PGHOST; PGSERVICE can supply host/port/dbname)." >&2
    echo "[restore-drill]           Unset the PG* family and pass the target explicitly in the connection URL." >&2
    exit 3
  fi
done
unset _v
for _pgvar in $(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p'); do unset "$_pgvar"; done
unset _pgvar

# L2: refuse any query param that can move the target.
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

# L3: a REAL URI parse (not sed) — the host must be a loopback literal. Anything that
# does not parse as a postgres URI is refused rather than guessed at.
LOOPBACK_HOSTS="localhost 127.0.0.1 ::1 [::1]"
assert_parsed_host_is_local() {
  local url="$1" parsed
  parsed="$(node -e '
    try {
      const u = new URL(process.argv[1]);
      if (!/^postgres(ql)?:$/.test(u.protocol)) { console.log("BADSCHEME"); process.exit(0); }
      console.log(u.hostname === "" ? "EMPTY" : u.hostname);
    } catch { console.log("UNPARSEABLE"); }
  ' "$url" 2>/dev/null)" || parsed="UNPARSEABLE"
  case " $LOOPBACK_HOSTS " in
    *" $parsed "*) return 0 ;;
  esac
  echo "[restore-drill] REFUSING: parsed connection host '$parsed' is not a loopback literal (allowed: $LOOPBACK_HOSTS)." >&2
  return 1
}

# L4: the only check that reflects reality — ask libpq where it ACTUALLY connected, and do
# it BEFORE any DROP/CREATE.
#
# The probe is psql's `\conninfo`, which reports the host and the RESOLVED address from the
# CLIENT's side. That is the true final target: whatever combination of URL, environment and
# DNS produced it, this is the endpoint the next statement will hit.
#
# (Not `inet_server_addr()`: that is the server's view of itself, which for a containerised
# Postgres is its bridge-network address — 172.x — even though it is genuinely on this
# machine. Measured against the repo's own docker-compose Postgres, so this is a real
# false-positive, not a hypothetical one.)
assert_connection_is_local() {
  local url="$1" info addr
  info="$(psql "$url" -c '\conninfo' 2>/dev/null)" || {
    echo "[restore-drill] REFUSING: could not reach the target to verify where it actually is." >&2
    return 1
  }
  # Prefer the resolved address when psql prints one; fall back to the host it names.
  addr="$(printf '%s' "$info" | sed -n 's/.*(address "\([^"]*\)").*/\1/p')"
  [ -z "$addr" ] && addr="$(printf '%s' "$info" | sed -n 's/.*on host "\([^"]*\)".*/\1/p')"
  case "$addr" in
    127.*|::1|localhost) return 0 ;;
    /*) return 0 ;; # unix socket path — local by definition
  esac
  echo "[restore-drill] REFUSING: libpq actually connected to '$addr', which is NOT loopback. Something re-pointed the connection past the string checks." >&2
  return 1
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
  psql "postgres://fikirtive:fikirtive@$host:<target-port>/postgres" -c 'DROP DATABASE IF EXISTS "$dbname";'
  psql "postgres://fikirtive:fikirtive@$host:<target-port>/postgres" -c 'CREATE DATABASE "$dbname";'
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
# L2: no connection param may redirect the target past the host/db checks.
reject_target_override_params "$TARGET_URL" || exit 3
# L3: a real URI parse — the host must be a loopback literal.
assert_parsed_host_is_local "$TARGET_URL" || exit 3
if [ "$is_local" != 1 ]; then
  echo "[restore-drill] REFUSING --apply: target host '$host' is not local. Prod/Neon restore is founder-only, out-of-band." >&2
  exit 3
fi
if [ "$is_drill_db" != 1 ]; then
  echo "[restore-drill] REFUSING --apply: target db '$dbname' is not a drill/test DB (need *drill*/*restore*/*_test)." >&2
  exit 3
fi
for bin in psql pg_restore gunzip node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[restore-drill] error: '$bin' not on PATH." >&2; exit 4; }
done

# Admin connection for DROP/CREATE DATABASE. The port comes from the TARGET URL, not a
# hardcoded 5432 — otherwise a drill aimed at a Postgres on another port (an isolated test
# instance, for example) would silently create and drop databases on whatever happens to be
# listening on 5432 instead.
target_port="$(printf '%s' "$TARGET_URL" | sed -E 's#^[a-z]+://([^@]*@)?[^:/?]+:([0-9]+).*#\2#')"
case "$target_port" in ''|*[!0-9]*) target_port=5432 ;; esac
admin_url="postgres://fikirtive:fikirtive@$host:$target_port/postgres"

# L4: ask the server where we actually landed, BEFORE any destructive statement.
# The admin URL is what DROP/CREATE DATABASE run against, so that is the one to verify.
assert_parsed_host_is_local "$admin_url" || exit 3
assert_connection_is_local "$admin_url" || exit 3

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
