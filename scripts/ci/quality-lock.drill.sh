#!/usr/bin/env bash

# Cancellation drill for the quality machine lock (#855).
#
# What it reproduces: `gh run cancel` kills the runner shell, quality.sh survives
# as an orphan (PPID 1) wedged in a cleanup that never returns, and the machine
# lock is therefore never released. Measured 2026-08-11: a DROP DATABASE sat
# 1h31m, its run held the lock 2h12m, and two CI runs burned their whole timeout
# waiting on a process nobody wanted any more.
#
# The drill asserts BOTH directions, because a lock that is easy to steal is not a
# lock:
#   abandoned  → an orphaned holder past the grace period is cleared (with its
#                children) and the next run gets the machine in seconds
#   attended   → a live holder whose launcher is still there, and an orphan still
#                inside its grace period, are both left strictly alone
# plus the pre-existing rules (free path, dead pid, pid-less corpse) so this change
# cannot quietly loosen them, and the drop watchdog itself.
#
# It runs the REAL code: the block between the `quality-lock library` markers in
# scripts/ci/quality.sh is extracted and sourced, pointed at a throwaway
# QUALITY_LOCK_DIR under mktemp. The real machine lock is never touched, and
# nothing here needs pnpm, node, or Postgres.
#
# Run: bash scripts/ci/quality-lock.drill.sh   (about 90s)
#
# Deliberately NOT wired into quality.sh's gate list: it spawns processes and
# judges them on wall-clock, and a load-sensitive gate on a shared machine is a
# false-red factory — exactly the disease this lock exists to cure. Run it by hand
# whenever the lock library changes.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
quality_sh="$here/quality.sh"
tmp="$(mktemp -d)"

export QUALITY_LOCK_DIR="$tmp/lock"
export QUALITY_ORPHAN_GRACE_SECONDS=2

spawned="$tmp/spawned"
: >"$spawned"
record() { echo "$1" >>"$spawned"; }

drill_cleanup() {
  local pid
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    pkill -P "$pid" 2>/dev/null || true
    kill -9 "$pid" 2>/dev/null || true
  done <"$spawned"
  rm -rf "$tmp"
}
trap drill_cleanup EXIT

# ── load the real lock library ────────────────────────────────────────────────
lib="$tmp/lock-library.sh"
sed -n '/^# >>> quality-lock library/,/^# <<< quality-lock library/p' "$quality_sh" >"$lib"
if [[ ! -s "$lib" ]]; then
  echo "drill: found no 'quality-lock library' block in $quality_sh" >&2
  exit 1
fi
for fn in kill_process_tree run_with_timeout lock_mtime_epoch path_age_seconds \
  holder_is_abandoned_orphan current_lock_is_stale try_steal_stale_lock acquire_quality_lock; do
  if ! grep -q "^${fn}() {" "$lib"; then
    echo "drill: the extracted library defines no ${fn}() — did the markers move?" >&2
    exit 1
  fi
done
# shellcheck source=/dev/null
. "$lib"

# Paranoia, not ceremony: everything below kills processes and deletes
# directories, so prove first that the sourced library is pointed at the
# throwaway path and not at the machine's real lock.
case "$quality_lock_dir" in
  "$tmp"/*) ;;
  *)
    echo "drill: refuses to run against $quality_lock_dir — the drill must never touch the real machine lock" >&2
    exit 1
    ;;
esac

# ── harness ───────────────────────────────────────────────────────────────────
pass=0
fail=0
waiter_pid=""
ok() {
  printf '  ok    %s\n' "$*"
  pass=$((pass + 1))
}
bad() {
  printf '  FAIL  %s\n' "$*" >&2
  fail=$((fail + 1))
}
note() { printf '  ..    %s\n' "$*"; }

reset_lock() {
  rm -rf "$quality_lock_dir" "$quality_steal_arbiter"
  quality_lock_held=""
}

backdate() {
  local path="$1" seconds="$2" stamp
  stamp="$(date -v "-${seconds}S" +%Y%m%d%H%M.%S 2>/dev/null || date -d "-${seconds} seconds" +%Y%m%d%H%M.%S)"
  touch -t "$stamp" "$path"
}

wait_for_file() {
  local path="$1" limit="$2" waited=0
  while (( waited < limit )); do
    [[ -e "$path" ]] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

wait_for_gone() {
  local pid="$1" limit="$2" waited=0
  while (( waited < limit )); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

ppid_of() { ps -p "$1" -o ppid= 2>/dev/null | tr -d '[:space:]' || true; }

# The next run in the queue. `trap - EXIT` because a subshell would otherwise
# inherit drill_cleanup and delete the drill's own workspace when it finishes.
start_waiter() {
  rm -f "$tmp/acquired"
  ( trap - EXIT; acquire_quality_lock >"$tmp/waiter.log" 2>&1; : >"$tmp/acquired" ) &
  waiter_pid=$!
  record "$waiter_pid"
}

# Stands in for a quality run that took the lock and then wedged: it records its
# pid exactly as acquire_quality_lock does, then waits on a child that never
# returns — the hung DROP DATABASE of #855.
cat >"$tmp/holder.sh" <<'HOLDER'
#!/usr/bin/env bash
set -euo pipefail
lock="$1"
ready="$2"
mkdir -p "$lock"
echo $$ >"$lock/pid"
sleep 100000 &
: >"$ready"
wait
HOLDER

cat >"$tmp/hang.sh" <<'HANG'
#!/usr/bin/env bash
set -euo pipefail
sleep 100000 &
echo $! >"$1"
wait
HANG

echo "quality-lock drill: lock dir $quality_lock_dir, orphan grace ${QUALITY_ORPHAN_GRACE_SECONDS}s"

# ── 1. the pre-existing happy path ────────────────────────────────────────────
echo ""
echo "1. a free machine"
reset_lock
acquire_quality_lock >/dev/null
if [[ -d "$quality_lock_dir" && "$(cat "$quality_lock_dir/pid")" == "$$" && -n "$quality_lock_held" ]]; then
  ok "acquire takes the lock and records its own pid"
else
  bad "acquire did not take a free lock"
fi
rm -rf "$quality_lock_dir"
quality_lock_held=""
if [[ ! -d "$quality_lock_dir" ]]; then
  ok "release leaves the path clear for the next run"
else
  bad "release left the lock behind"
fi

# ── 2. pre-existing staleness rules ───────────────────────────────────────────
echo ""
echo "2. the rules that were already there"
reset_lock
mkdir "$quality_lock_dir"
if current_lock_is_stale; then
  bad "a pid-less lock younger than 60s was judged stale"
else
  ok "a pid-less lock younger than 60s is left alone (a holder writes its pid ms later)"
fi
backdate "$quality_lock_dir" 300
if current_lock_is_stale; then
  ok "a pid-less lock older than 60s is a corpse"
else
  bad "a pid-less lock older than 60s was not judged stale"
fi

reset_lock
mkdir "$quality_lock_dir"
sleep 0 &
dead_pid=$!
wait "$dead_pid" 2>/dev/null || true
echo "$dead_pid" >"$quality_lock_dir/pid"
if current_lock_is_stale; then
  ok "a lock whose pid is provably dead is stale"
else
  bad "a dead holder's lock was not judged stale"
fi
start_waiter
if wait_for_file "$tmp/acquired" 15; then
  ok "the next run reclaims a dead holder's lock"
else
  bad "the next run never reclaimed a dead holder's lock"
fi

# ── 3. no friendly fire: an attended holder keeps the machine ─────────────────
echo ""
echo "3. an attended holder (its launcher is alive)"
reset_lock
bash "$tmp/holder.sh" "$quality_lock_dir" "$tmp/ready-attended" &
attended=$!
record "$attended"
if ! wait_for_file "$tmp/ready-attended" 15; then
  bad "the attended holder never took the lock — drill cannot continue"
  exit 1
fi
sleep 3 # older than the 2s grace, so only PPID keeps it safe
if [[ "$(ppid_of "$attended")" == "$$" ]]; then
  ok "the attended holder's PPID is its launcher, not 1"
else
  bad "the attended holder was reparented — this check proves nothing"
fi
if current_lock_is_stale; then
  bad "a live, attended holder was judged stale"
else
  ok "a live, attended holder is never stale, however long it holds"
fi
try_steal_stale_lock >/dev/null || true
if [[ "$(cat "$quality_lock_dir/pid" 2>/dev/null || true)" == "$attended" ]] && kill -0 "$attended" 2>/dev/null; then
  ok "an explicit steal attempt leaves the holder and its lock untouched"
else
  bad "the attended holder lost its lock or its life"
fi
start_waiter
if wait_for_file "$tmp/acquired" 8; then
  bad "the next run barged in while an attended holder was working"
else
  ok "the next run waits instead of barging in"
fi
kill_process_tree "$attended" >/dev/null 2>&1 || true
if wait_for_file "$tmp/acquired" 45; then
  ok "once the holder is gone the waiter picks the machine up on its own"
else
  bad "the waiter never woke up after the holder died"
fi

# ── 4. the cancellation drill itself ──────────────────────────────────────────
echo ""
echo "4. a cancelled run: orphaned holder, wedged cleanup"
reset_lock
# Double fork: the middle shell exits at once, so the holder is reparented — the
# same shape a cancelled CI job leaves behind.
bash -c 'bash "$1" "$2" "$3" >/dev/null 2>&1 &' _ "$tmp/holder.sh" "$quality_lock_dir" "$tmp/ready-orphan"
if ! wait_for_file "$tmp/ready-orphan" 15; then
  bad "the orphan holder never took the lock — drill cannot continue"
  exit 1
fi
orphan="$(cat "$quality_lock_dir/pid")"
record "$orphan"
orphan_ppid=""
waited=0
while (( waited < 10 )); do
  orphan_ppid="$(ppid_of "$orphan")"
  [[ "$orphan_ppid" == "1" ]] && break
  sleep 1
  waited=$((waited + 1))
done
if [[ "$orphan_ppid" != "1" ]]; then
  note "SKIP: this platform reparented the orphan to PPID ${orphan_ppid:-?}, not 1"
  note "      (Linux subreapers do that; the rule targets init reparenting, as on the macOS runner)"
  kill_process_tree "$orphan" >/dev/null 2>&1 || true
else
  ok "a cancelled run's holder survives with PPID 1"
  orphan_child="$(pgrep -P "$orphan" 2>/dev/null | head -1 || true)"
  if [[ -n "$orphan_child" ]]; then
    ok "the orphan owns a wedged child (pid $orphan_child) — the DROP that never returns"
  else
    bad "the orphan has no child; the tree-kill assertion below would prove nothing"
  fi
  quality_orphan_grace_seconds=600
  if current_lock_is_stale; then
    bad "an orphan still inside its grace period was judged abandoned"
  else
    ok "an orphan inside its grace period keeps the machine"
  fi
  quality_orphan_grace_seconds=2
  sleep 3
  if current_lock_is_stale; then
    ok "an orphan past its grace period reads as abandoned"
  else
    bad "an orphan past its grace period was not judged abandoned"
  fi
  start_waiter
  if wait_for_file "$tmp/acquired" 30; then
    ok "the next run has the machine within 30s (before: it starved until its job timeout)"
  else
    bad "the next run is still starving on an abandoned lock"
  fi
  if wait_for_gone "$orphan" 10; then
    ok "the abandoned holder was killed before its lock changed hands"
  else
    bad "the abandoned holder is still alive while another run holds its lock"
  fi
  if [[ -n "$orphan_child" ]]; then
    if wait_for_gone "$orphan_child" 10; then
      ok "its wedged child died with it (no reparented CPU burner left behind)"
    else
      bad "the wedged child outlived its parent — that is the orphan vitest of #855"
    fi
  fi
fi

# ── 5. the drop watchdog ──────────────────────────────────────────────────────
echo ""
echo "5. the timeout that keeps cleanup moving"
status=0
run_with_timeout 30 bash -c 'exit 7' || status=$?
if [[ "$status" == "7" ]]; then
  ok "a command that answers in time returns its own status ($status)"
else
  bad "expected status 7 from a fast command, got $status"
fi
started="$(date +%s)"
status=0
run_with_timeout 2 bash "$tmp/hang.sh" "$tmp/hang.child" || status=$?
elapsed=$(($(date +%s) - started))
if [[ "$status" == "124" ]] && (( elapsed < 25 )); then
  ok "a command that never answers is abandoned after its budget (${elapsed}s, status 124)"
else
  bad "expected status 124 within 25s from a wedged command, got $status after ${elapsed}s"
fi
hang_child="$(cat "$tmp/hang.child" 2>/dev/null || true)"
if [[ -n "$hang_child" ]] && wait_for_gone "$hang_child" 10; then
  ok "its child died too — the tree is killed, not just its root"
else
  bad "the wedged command's child (pid ${hang_child:-?}) survived the timeout"
fi

# ── verdict ───────────────────────────────────────────────────────────────────
echo ""
if (( fail != 0 )); then
  echo "quality-lock drill: $fail of $((pass + fail)) checks FAILED" >&2
  exit 1
fi
echo "quality-lock drill: all $pass checks passed"
