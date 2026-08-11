#!/usr/bin/env bash

# Cancellation drill for the quality machine lock (#855).
#
# What it reproduces: `gh run cancel` kills the runner shell, quality.sh survives
# as an orphan (PPID 1) wedged in a cleanup that never returns, and the machine
# lock is therefore never released. Measured 2026-08-11: a DROP DATABASE sat
# 1h31m, its run held the lock 2h12m, and two CI runs burned their whole timeout
# waiting on a process nobody wanted any more.
#
# It asserts every direction, because a lock that is easy to steal is not a lock:
#   abandoned   an orphaned holder past the grace period is cleared (with its
#               children) and the next run gets the machine in seconds
#   attended    a live holder whose launcher is still there, and an orphan still
#               inside its grace period, are both left strictly alone
#   recycled    a lock whose pid was reused by an unrelated process never gets
#               that process killed
#   contested   if the dying holder's own cleanup frees the path and a third run
#               takes it, the stealer stands down instead of taking a live lock
# plus the pre-existing rules (free path, dead pid, pid-less corpse) so this change
# cannot quietly loosen them, and the drop watchdog itself.
#
# It runs the REAL code: the block between the `quality-lock library` markers in
# scripts/ci/quality.sh is extracted and sourced, pointed at a throwaway
# QUALITY_LOCK_DIR. The real machine lock is never touched, and nothing here needs
# pnpm, node, or Postgres.
#
# Run: bash scripts/ci/quality-lock.drill.sh            (about 2 minutes)
#      QUALITY_DRILL_TMPDIR=./.drill-tmp bash scripts/ci/quality-lock.drill.sh
#          — for sandboxes where mktemp is unavailable. The workspace is created
#            inside that directory, and the lock path is still verified to live
#            inside the workspace before anything is killed or deleted.
#
# Deliberately NOT wired into quality.sh's gate list: it spawns processes and
# judges them on wall-clock, and a load-sensitive gate on a shared machine is a
# false-red factory — exactly the disease this lock exists to cure. Run it by hand
# whenever the lock library changes.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
quality_sh="$here/quality.sh"

if [[ -n "${QUALITY_DRILL_TMPDIR:-}" ]]; then
  mkdir -p "$QUALITY_DRILL_TMPDIR"
  drill_root="$(cd "$QUALITY_DRILL_TMPDIR" && pwd)"
  tmp="$drill_root/quality-lock-drill.$$"
  rm -rf "$tmp"
  mkdir -p "$tmp"
else
  tmp="$(mktemp -d)"
fi

export QUALITY_LOCK_DIR="$tmp/lock"
export QUALITY_ORPHAN_GRACE_SECONDS=2

# ── load the real lock library ────────────────────────────────────────────────
lib="$tmp/lock-library.sh"
sed -n '/^# >>> quality-lock library/,/^# <<< quality-lock library/p' "$quality_sh" >"$lib"
if [[ ! -s "$lib" ]]; then
  echo "drill: found no 'quality-lock library' block in $quality_sh" >&2
  exit 1
fi
for fn in process_start_signature process_is_gone collect_process_tree signal_if_identified \
  kill_process_tree sweep_identified_subtree run_with_timeout lock_mtime_epoch \
  lock_inode_number path_age_seconds lock_field read_lock_snapshot lock_matches_snapshot \
  holder_is_abandoned_orphan snapshot_is_stale current_lock_is_stale \
  reclaim_lock_directory reclaim_if_snapshot_unchanged try_steal_stale_lock \
  acquire_quality_lock; do
  if ! grep -q "^${fn}() {" "$lib"; then
    echo "drill: the extracted library defines no ${fn}() — did the markers move?" >&2
    exit 1
  fi
done
# shellcheck source=/dev/null
. "$lib"

# Paranoia, not ceremony: everything below kills processes and deletes
# directories, so prove first that the sourced library is pointed at the drill's
# own workspace and not at the machine's real lock. The comparison is between
# RESOLVED PHYSICAL paths (`pwd -P`), not strings: a symlink, a `..`, or a
# /tmp → /private/tmp indirection makes a string prefix say "inside" about a
# directory that physically is not, and the check exists precisely for the case
# where the path is not what it looks like.
lock_parent_physical="$(cd "$(dirname "$quality_lock_dir")" 2>/dev/null && pwd -P)" || lock_parent_physical=""
workspace_physical="$(cd "$tmp" && pwd -P)"
if [[ -z "$lock_parent_physical" || "$lock_parent_physical" != "$workspace_physical" ]]; then
  echo "drill: refuses to run against $quality_lock_dir" >&2
  echo "drill: it resolves to ${lock_parent_physical:-<unresolvable>}, which is not the drill workspace $workspace_physical" >&2
  exit 1
fi

# ── process bookkeeping ───────────────────────────────────────────────────────
# Every spawned process is recorded WITH its start signature, and cleanup kills
# only on an exact match. By the time cleanup runs a recorded pid may belong to
# something else entirely, and a drill that hunts stale pids with a bare `pkill`
# would be committing the very sin it exists to catch.
spawned="$tmp/spawned"
: >"$spawned"
tab="$(printf '\t')"

record() { printf '%s\t%s\n' "$1" "$(process_start_signature "$1")" >>"$spawned"; }

drill_cleanup() {
  local pid identity current
  while IFS="$tab" read -r pid identity; do
    [[ -n "$pid" ]] || continue
    current="$(process_start_signature "$pid")"
    [[ -n "$current" && "$current" == "$identity" ]] || continue
    kill_process_tree "$pid" "$identity" >/dev/null 2>&1 || true
  done <"$spawned"
  rm -rf "$tmp"
}
trap drill_cleanup EXIT

# ── harness ───────────────────────────────────────────────────────────────────
# Every check is counted, including the ones a platform makes impossible. A drill
# that quietly performs fewer checks than it claims is worse than no drill, so the
# tally is reconciled against expected_checks at the end and a skip can never be
# reported as a pass.
# 3 (free machine) + 5 (pre-existing rules) + 3 (recycled pid) + 5 (attended)
# + 7 (cancellation) + 4 (orphan cross-generation race) + 5 (dead-branch race)
# + 3 (watchdog)
expected_checks=35
pass=0
fail=0
skip=0
waiter_pid=""

ok() {
  printf '  ok    %s\n' "$*"
  pass=$((pass + 1))
}
bad() {
  printf '  FAIL  %s\n' "$*" >&2
  fail=$((fail + 1))
}
skipped() {
  local count="$1"
  shift
  printf '  SKIP  %s (%s checks)\n' "$*" "$count"
  skip=$((skip + count))
}

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
    process_is_gone "$pid" && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

ppid_of() { ps -p "$1" -o ppid= 2>/dev/null | tr -d '[:space:]' || true; }

wait_for_orphaning() {
  local pid="$1" limit="$2" waited=0
  while (( waited < limit )); do
    [[ "$(ppid_of "$pid")" == "1" ]] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# The next run in the queue. `trap - EXIT` because a subshell inherits
# drill_cleanup and would otherwise delete the drill's own workspace on its way
# out.
start_waiter() {
  rm -f "$tmp/acquired"
  ( trap - EXIT; acquire_quality_lock >"$tmp/waiter.log" 2>&1; : >"$tmp/acquired" ) &
  waiter_pid=$!
  record "$waiter_pid"
}

# ── fixtures ──────────────────────────────────────────────────────────────────
# The holder takes the lock through the REAL acquire_quality_lock, so what it
# leaves behind carries a real token and a real identity. mode=cleanup gives it
# the shape of the production script: on the way out it releases its own lock,
# which is the window a third run can slip into.
cat >"$tmp/holder.sh" <<'HOLDER'
#!/usr/bin/env bash
set -euo pipefail
lib="$1"
ready="$2"
mode="${3:-plain}"
# shellcheck source=/dev/null
. "$lib"
acquire_quality_lock >/dev/null
# mode=cleanup wears production's shape exactly: the release hangs off EXIT, not
# off TERM, and it only removes a lock whose token is still its own. EXIT is the
# load-bearing part — a tree kill takes the children first, so this shell most
# often dies by its `wait` returning, not by catching a signal.
if [[ "$mode" == "cleanup" ]]; then
  trap 'if [[ "$(cat "$quality_lock_dir/token" 2>/dev/null || true)" == "$quality_lock_token" ]]; then rm -rf "$quality_lock_dir"; fi' EXIT
fi
sleep 100000 &
: >"$ready"
wait
HOLDER

# A third run that wants the machine and takes it the instant the path is free.
# It spins on the bare atomic mkdir rather than calling acquire_quality_lock,
# because acquire polls every 30s and would lose a race it is not trying to win.
# What is under test is the STEALER's behaviour towards a lock that appeared while
# it was busy, not the waiter's scheduling.
cat >"$tmp/competitor.sh" <<'COMPETITOR'
#!/usr/bin/env bash
set -euo pipefail
lib="$1"
ready="$2"
# shellcheck source=/dev/null
. "$lib"
while true; do
  if mkdir "$quality_lock_dir" 2>/dev/null; then
    printf '%s\n' "$quality_lock_token" >"$quality_lock_dir/token"
    process_start_signature "$$" >"$quality_lock_dir/identity"
    echo $$ >"$quality_lock_dir/pid"
    break
  fi
  sleep 0.05
done
: >"$ready"
sleep 100000
COMPETITOR

cat >"$tmp/hang.sh" <<'HANG'
#!/usr/bin/env bash
set -euo pipefail
sleep 100000 &
echo $! >"$1"
wait
HANG

spawn_orphan() {
  # Double fork: the middle shell exits at once, so the holder is reparented — the
  # same shape a cancelled CI job leaves behind.
  bash -c 'bash "$1" "$2" "$3" "$4" >/dev/null 2>&1 &' _ "$tmp/holder.sh" "$lib" "$1" "${2:-plain}"
}

echo "quality-lock drill: workspace $tmp, orphan grace ${QUALITY_ORPHAN_GRACE_SECONDS}s"

# ── 1. the pre-existing happy path ────────────────────────────────────────────
echo ""
echo "1. a free machine"
reset_lock
acquire_quality_lock >/dev/null
if [[ -d "$quality_lock_dir" && "$(lock_field pid)" == "$$" && -n "$quality_lock_held" ]]; then
  ok "acquire takes the lock and records its own pid"
else
  bad "acquire did not take a free lock"
fi
if [[ "$(lock_field token)" == "$quality_lock_token" && "$(lock_field identity)" == "$(process_start_signature "$$")" ]]; then
  ok "the lock carries this run's generation token and start signature"
else
  bad "the lock is missing its identity"
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
if current_lock_is_stale && [[ "$quality_stale_reason" == "pidless" ]]; then
  ok "a pid-less lock older than 60s is a corpse"
else
  bad "a pid-less lock older than 60s was judged ${quality_stale_reason:-not stale}"
fi

reset_lock
mkdir "$quality_lock_dir"
sleep 0 &
dead_pid=$!
wait "$dead_pid" 2>/dev/null || true
echo "$dead_pid" >"$quality_lock_dir/pid"
if current_lock_is_stale && [[ "$quality_stale_reason" == "dead" ]]; then
  ok "a lock whose pid is provably dead is stale"
else
  bad "a dead holder's lock was judged ${quality_stale_reason:-not stale}"
fi
start_waiter
if wait_for_file "$tmp/acquired" 15; then
  ok "the next run reclaims a dead holder's lock"
else
  bad "the next run never reclaimed a dead holder's lock"
fi
# `mv dir existing-dir` moves it INSIDE, so a reused graveyard name would report a
# successful reclaim while leaving the lock exactly where it was.
leftovers="$(find "$tmp" -maxdepth 1 -name 'lock.stale.*' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$leftovers" == "0" ]]; then
  ok "the reclaim left no graveyard behind"
else
  bad "$leftovers graveyard directories survived the reclaim"
fi

# ── 3. a recycled pid is not a holder ─────────────────────────────────────────
echo ""
echo "3. a lock whose pid was recycled into an unrelated process"
reset_lock
mkdir "$quality_lock_dir"
bash -c 'sleep 100000' &
stranger=$!
record "$stranger"
printf '%s\n' "not-our-token" >"$quality_lock_dir/token"
# A start time that cannot possibly be the live process's, paired with a pid that
# is very much alive: exactly what pid recycling looks like from the outside.
printf '%s\n' "Thu Jan  1 00:00:00 1970" >"$quality_lock_dir/identity"
echo "$stranger" >"$quality_lock_dir/pid"
backdate "$quality_lock_dir" 300
if current_lock_is_stale && [[ "$quality_stale_reason" == "reused" ]]; then
  ok "the lock reads as a corpse, because its real owner is gone"
else
  bad "a recycled-pid lock was judged ${quality_stale_reason:-not stale}"
fi
try_steal_stale_lock >"$tmp/steal-reused.log" 2>&1 || true
if ! process_is_gone "$stranger"; then
  ok "the unrelated process wearing that pid was NOT killed"
else
  bad "an unrelated process was killed for merely reusing the pid"
fi
if [[ ! -d "$quality_lock_dir" ]]; then
  ok "the corpse lock was reclaimed anyway"
else
  bad "the corpse lock was left in place"
fi
kill_process_tree "$stranger" >/dev/null 2>&1 || true

# ── 4. no friendly fire: an attended holder keeps the machine ─────────────────
echo ""
echo "4. an attended holder (its launcher is alive)"
reset_lock
bash "$tmp/holder.sh" "$lib" "$tmp/ready-attended" &
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
  bad "a live, attended holder was judged $quality_stale_reason"
else
  ok "a live, attended holder is never stale, however long it holds"
fi
try_steal_stale_lock >/dev/null 2>&1 || true
if [[ "$(lock_field pid)" == "$attended" ]] && ! process_is_gone "$attended"; then
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

# ── 5. the cancellation drill itself ──────────────────────────────────────────
echo ""
echo "5. a cancelled run: orphaned holder, wedged cleanup"
reset_lock
spawn_orphan "$tmp/ready-orphan" plain
if ! wait_for_file "$tmp/ready-orphan" 15; then
  bad "the orphan holder never took the lock — drill cannot continue"
  exit 1
fi
orphan="$(lock_field pid)"
record "$orphan"
if ! wait_for_orphaning "$orphan" 10; then
  skipped 7 "this platform reparented the holder to PPID $(ppid_of "$orphan"), not 1 — Linux subreapers do that; the rule targets init reparenting, as on the macOS runner"
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
    bad "an orphan still inside its grace period was judged $quality_stale_reason"
  else
    ok "an orphan inside its grace period keeps the machine"
  fi
  quality_orphan_grace_seconds=2
  sleep 3
  if current_lock_is_stale && [[ "$quality_stale_reason" == "orphan" ]]; then
    ok "an orphan past its grace period reads as abandoned"
  else
    bad "an orphan past its grace period was judged ${quality_stale_reason:-not stale}"
  fi
  start_waiter
  if wait_for_file "$tmp/acquired" 30; then
    ok "the next run has the machine within 30s (before: it starved until its job timeout)"
  else
    bad "the next run is still starving on an abandoned lock"
  fi
  if wait_for_gone "$orphan" 15; then
    ok "the abandoned holder was killed before its lock changed hands"
  else
    bad "the abandoned holder is still alive while another run holds its lock"
  fi
  if [[ -n "$orphan_child" ]]; then
    if wait_for_gone "$orphan_child" 15; then
      ok "its wedged child died with it (no reparented CPU burner left behind)"
    else
      bad "the wedged child outlived its parent — that is the orphan vitest of #855"
    fi
  else
    skipped 1 "no wedged child to follow"
  fi
fi

# ── 6. the cross-generation race ──────────────────────────────────────────────
# This orphan has the shape of the real script: killing it runs its cleanup, which
# frees the path. A third run is spinning on that path and takes it the moment it
# opens. The stealer must notice that the lock it judged is not the lock that is
# there now and stand down — proving the old holder is dead says nothing about who
# owns the path now.
echo ""
echo "6. the holder's cleanup frees the path and a third run takes it"
reset_lock
spawn_orphan "$tmp/ready-racer" cleanup
if ! wait_for_file "$tmp/ready-racer" 15; then
  bad "the racing holder never took the lock — drill cannot continue"
  exit 1
fi
racer="$(lock_field pid)"
record "$racer"
if ! wait_for_orphaning "$racer" 10; then
  skipped 4 "this platform does not reparent orphans to pid 1"
  kill_process_tree "$racer" >/dev/null 2>&1 || true
else
  bash "$tmp/competitor.sh" "$lib" "$tmp/ready-competitor" &
  competitor=$!
  record "$competitor"
  sleep 3 # past the grace period; the competitor is spinning on the locked path
  if [[ "$(lock_field pid)" == "$racer" ]]; then
    ok "the competitor is shut out while the orphan still holds the lock"
  else
    bad "the competitor got in before the race even started"
  fi
  try_steal_stale_lock >"$tmp/steal-race.log" 2>&1 || true
  if wait_for_file "$tmp/ready-competitor" 15; then
    ok "the third run took the path the instant the dying holder freed it"
  else
    bad "the third run never got the lock — the race did not happen"
  fi
  if [[ "$(lock_field pid)" == "$competitor" ]] && ! process_is_gone "$competitor"; then
    ok "the lock now belongs to the third run, alive and unharmed"
  else
    bad "the third run's lock was taken: lock pid $(lock_field pid), competitor $competitor"
  fi
  if grep -q "standing down" "$tmp/steal-race.log"; then
    ok "the stealer saw a different generation and stood down"
  else
    bad "the stealer did not stand down: $(tr '\n' ' ' <"$tmp/steal-race.log")"
  fi
  kill_process_tree "$competitor" >/dev/null 2>&1 || true
fi

# ── 7. the dead-branch race ───────────────────────────────────────────────────
# The interleaving a review probe caught in the previous round, replayed step by
# step rather than raced for, because a race you cannot schedule is a test you
# cannot trust:
#
#   B reads the lock (A holds it) → A exits and releases → C takes the free path
#   → B checks A and finds it dead → B reclaims … C's lock.
#
# Every one of those steps is true. The conclusion is not: "the holder I judged is
# dead" is a fact about a process, and reclaiming is an act on a path. The gate
# below is what makes B stop — and it is the same function the real steal calls,
# on the same snapshot the real steal takes.
echo ""
echo "7. the holder dies between the reading and the reclaim"
reset_lock
bash "$tmp/holder.sh" "$lib" "$tmp/ready-a" cleanup &
holder_a=$!
record "$holder_a"
if ! wait_for_file "$tmp/ready-a" 15; then
  bad "holder A never took the lock — drill cannot continue"
  exit 1
fi
# B's one and only read of the lock.
read_lock_snapshot
if [[ "$quality_snapshot_pid" == "$holder_a" && -n "$quality_snapshot_token" ]]; then
  ok "the snapshot names holder A ($holder_a)"
else
  bad "the snapshot names ${quality_snapshot_pid:-nobody}, expected $holder_a"
fi
# A exits normally: its cleanup releases the lock, exactly as production does.
kill_process_tree "$holder_a" "" >/dev/null 2>&1 || true
wait_for_gone "$holder_a" 15 || true
# C takes the free path. It never consults the arbiter, and it does not have to.
bash "$tmp/competitor.sh" "$lib" "$tmp/ready-c" &
holder_c=$!
record "$holder_c"
if wait_for_file "$tmp/ready-c" 15; then
  ok "holder C took the freed path without asking anyone"
else
  bad "holder C never got the lock — the interleaving did not happen"
fi
# B, still holding its original snapshot, now judges A — and A really is dead.
if snapshot_is_stale && [[ "$quality_stale_reason" == "dead" ]]; then
  ok "B's snapshot judges A dead (reason: dead) — every step so far is true"
else
  bad "B's snapshot judged ${quality_stale_reason:-not stale}, expected dead"
fi
if reclaim_if_snapshot_unchanged >"$tmp/dead-race.log" 2>&1; then
  bad "B reclaimed the path — that is C's lock: $(tr '\n' ' ' <"$tmp/dead-race.log")"
else
  ok "B stood down: $(tr '\n' ' ' <"$tmp/dead-race.log")"
fi
if [[ "$(lock_field pid)" == "$holder_c" ]] && ! process_is_gone "$holder_c"; then
  ok "C still holds its lock, alive and unharmed"
else
  bad "C lost its lock: lock pid $(lock_field pid), C is $holder_c"
fi
kill_process_tree "$holder_c" "" >/dev/null 2>&1 || true

# ── 8. the drop watchdog ──────────────────────────────────────────────────────
echo ""
echo "8. the timeout that keeps cleanup moving"
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
if [[ "$status" == "124" ]] && (( elapsed < 30 )); then
  ok "a command that never answers is abandoned after its budget (${elapsed}s, status 124)"
else
  bad "expected status 124 within 30s from a wedged command, got $status after ${elapsed}s"
fi
hang_child="$(cat "$tmp/hang.child" 2>/dev/null || true)"
if [[ -n "$hang_child" ]] && wait_for_gone "$hang_child" 10; then
  ok "its child died too — the tree is killed, not just its root"
else
  bad "the wedged command's child (pid ${hang_child:-?}) survived the timeout"
fi

# ── verdict ───────────────────────────────────────────────────────────────────
echo ""
total=$((pass + fail + skip))
if (( total != expected_checks )); then
  echo "quality-lock drill: accounting is off — $pass passed + $fail failed + $skip skipped = $total, expected $expected_checks" >&2
  echo "quality-lock drill: a check disappeared without saying so; treat this as a failure" >&2
  exit 1
fi
if (( fail != 0 )); then
  echo "quality-lock drill: $fail of $expected_checks checks FAILED ($pass passed, $skip skipped)" >&2
  exit 1
fi
if (( skip != 0 )); then
  echo "quality-lock drill: $pass checks passed, $skip SKIPPED on this platform (of $expected_checks) — NOT a full pass"
  exit 0
fi
echo "quality-lock drill: all $expected_checks checks passed"
