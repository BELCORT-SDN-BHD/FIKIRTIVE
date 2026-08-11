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

# The drop runs on the exit path, and on the exit path a hang is not a slow drop —
# it is a machine-wide outage. Cleanup never reaches the lock release, the run
# becomes an abandoned holder of the machine mutex, and every later run starves on
# it (#855, measured 2026-08-11: one DROP sat 1h31m, its run held the lock 2h12m,
# two CI runs died waiting). So the drop is bounded three times over:
#   - Postgres aborts the statement itself (statement_timeout). DROP ... WITH
#     (FORCE) waits on other backends, and on a loaded machine that wait has no
#     ceiling of its own.
#   - node exits hard on error instead of setting process.exitCode: an errored
#     client is still connected, and an open socket keeps the event loop — and the
#     whole cleanup — alive forever.
#   - a pure-bash watchdog kills the process tree if anything UPSTREAM of the
#     statement is what wedged (connect, pnpm, node startup).
# Every budget is far below the job budget on purpose: an abandoned drop costs one
# stray database, a wedged drop costs the machine.
quality_drop_timeout_seconds="${QUALITY_DROP_TIMEOUT_SECONDS:-60}"

drop_local_database_now() {
  FIKIRTIVE_TEST_DB="$local_database" pnpm --filter @fikirtive/db exec node -e '
    const { Client } = require("pg");
    const target = process.env.FIKIRTIVE_TEST_DB;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = "/postgres";
    (async () => {
      const client = new Client({
        connectionString: url.toString(),
        connectionTimeoutMillis: 15000,
      });
      await client.connect();
      await client.query("SET statement_timeout = 30000");
      await client.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
      await client.end();
    })().catch((error) => {
      console.error(`quality: failed to drop isolated test database: ${error.message}`);
      process.exit(1);
    });
  '
}

# run_with_timeout lives in the lock library below — defined later in the file,
# resolved at call time, which is inside the EXIT trap.
drop_local_database() {
  run_with_timeout "$quality_drop_timeout_seconds" drop_local_database_now
}

# >>> quality-lock library ─────────────────────────────────────────────────────
# Everything between these two markers is extracted verbatim and sourced by
# scripts/ci/quality-lock.drill.sh, which exercises it against a throwaway
# QUALITY_LOCK_DIR. Keep this block free of anything that needs the database, the
# network, or an installed workspace: the drill has to be able to run the real
# code on a machine where nothing is built.

# ── process identity ──────────────────────────────────────────────────────────
# A pid does not identify a process. Pids are recycled, and on a machine that
# starts services all day the process wearing a recycled pid may be something
# important — so "the pid in the lock file is alive" is not evidence that the
# holder is alive. Every judgment below pairs the pid with the process's start
# time, and a mismatch reads as "the holder is gone", never as "the holder is
# here". Resolution is one second, which is far finer than a pid can wrap.
process_start_signature() {
  ps -p "$1" -o lstart= 2>/dev/null | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//' || true
}

# Gone means gone: not running at all, or a zombie. Zombies matter because
# `kill -0` succeeds on them and no signal will ever move them — treating one as
# "still alive" would park a killer in a loop it can never leave.
process_is_gone() {
  local pid="$1" state
  kill -0 "$pid" 2>/dev/null || return 0
  state="$(ps -p "$pid" -o state= 2>/dev/null | tr -d '[:space:]' || true)"
  case "$state" in
    Z*) return 0 ;;
    *) return 1 ;;
  esac
}

# The pid and every live descendant, children before parents. Order matters:
# killing a parent first hands its children to pid 1, which is how #855 also left
# a vitest burning CPU for two hours after its run was cancelled.
collect_process_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    collect_process_tree "$child"
  done
  if ! process_is_gone "$pid"; then
    echo "$pid"
  fi
}

# Kill a tree within a fixed budget and PROVE the whole tree is gone — not just
# its root. Each pass re-enumerates, because a snapshot taken before the first
# signal misses anything forked after it; escalates TERM → KILL after three
# passes; and returns 0 only when a final enumeration comes back empty.
#
# The residual is honest and bounded: a process forked after the LAST enumeration
# is not seen here. That is why the caller never treats "kill succeeded" as
# permission to act — it re-verifies the lock generation afterwards (see
# try_steal_stale_lock), so a survivor can cost a wasted steal but never a lock
# held twice.
kill_process_tree() {
  local root="$1" budget="${2:-12}"
  # Never aim at init, at "the whole process group" (pid 0), or at ourselves.
  if [[ ! "$root" =~ ^[0-9]+$ ]] || (( root <= 1 )) || [[ "$root" == "$$" || "$root" == "${BASHPID:-}" ]]; then
    return 1
  fi
  local started signal victims victim passes
  started="$(date +%s)"
  signal=TERM
  passes=0
  while :; do
    victims="$(collect_process_tree "$root")"
    [[ -z "$victims" ]] && return 0
    for victim in $victims; do
      kill -"$signal" "$victim" 2>/dev/null || true
    done
    (( $(date +%s) - started >= budget )) && break
    sleep 1
    passes=$((passes + 1))
    (( passes >= 3 )) && signal=KILL
  done
  [[ -z "$(collect_process_tree "$root")" ]]
}

# macOS ships no GNU `timeout` and CI must not depend on Homebrew being on PATH,
# so the watchdog is pure bash: run the command in the background, poll once a
# second, kill its whole tree when the budget is spent. Returns the command's own
# status, or 124 (timeout(1)'s convention) when the budget ran out. Polling with
# `kill -0` is safe because bash reaps background children as they exit, so a
# finished child stops being visible while `wait` still reports its status.
#
# EVERY wait here is bounded, and that is the point: a bare `wait` on a process
# that survived SIGKILL (stuck in the kernel) never returns, so the watchdog meant
# to unstick cleanup would become the next hang. If a process will not die we say
# so loudly, abandon it, and carry on to the lock release. Leaking one process is
# litter someone can kill by hand; an unreleased machine lock starves every later
# run until a human notices (#855).
run_with_timeout() {
  local seconds="$1"
  shift
  local status=0 waited=0 reaped=0 child
  "$@" &
  child=$!
  while (( waited < seconds )); do
    if process_is_gone "$child"; then
      wait "$child" || status=$?
      return "$status"
    fi
    sleep 1
    waited=$((waited + 1))
  done
  kill_process_tree "$child" || true
  while (( reaped < 5 )); do
    if process_is_gone "$child"; then
      wait "$child" 2>/dev/null || true
      return 124
    fi
    sleep 1
    reaped=$((reaped + 1))
  done
  echo "quality: process $child survived SIGKILL — abandoning it so cleanup can finish" >&2
  disown "$child" 2>/dev/null || true
  return 124
}

# One machine, one Postgres: two overlapping quality runs starve each other into
# false reds (hook timeouts in packages/db — measured repeatedly on this repo), so a
# run first takes a machine-wide mutex. mkdir is atomic; the identity written inside
# makes a crashed, recycled or abandoned holder detectable (see
# current_lock_is_stale for the four staleness rules).
# Fixed /tmp on purpose, NOT $TMPDIR: a mutex only works if every party resolves the
# same path, and on macOS TMPDIR differs between launchd services (the CI runner) and
# user shells (local runs) — an env-dependent lock path would quietly stop excluding.
quality_lock_dir="${QUALITY_LOCK_DIR:-/tmp/fikirtive-quality.lock}"
quality_lock_held=""

# The lock records a three-part identity, not a pid: the pid, the pid's start
# time, and a generation token unique to this run. The pid alone answers "is
# something alive at that number"; the start time answers "is it still the same
# something"; the token answers "is this still the same LOCK". Every steal and
# every release checks the parts it needs, because a mutex that can be handed to
# the wrong run is not a mutex.
quality_lock_token="$$.$(date +%s).${RANDOM}${RANDOM}"

# How long an ORPHANED holder may keep the machine before waiters treat its lock
# as abandoned. See holder_is_abandoned_orphan for why orphan ≠ dead.
quality_orphan_grace_seconds="${QUALITY_ORPHAN_GRACE_SECONDS:-120}"

# The staleness rules, all four, are spelled out at current_lock_is_stale.
#
# STEALING IS NOT "judge, then mv": between a waiter's staleness judgment and its
# mv, the path may already hold someone else's brand-new live lock, and mv moves
# whatever is there NOW, not the incarnation that was judged. So the steal happens
# inside a tiny arbiter mutex and RE-DERIVES staleness in there: under the arbiter
# no other stealer can interleave, and a fresh holder's lock re-reads as alive (or
# as too young) and is left alone. The one path that cannot finish inside a
# millisecond — clearing an abandoned orphan — leaves the arbiter to do the
# killing and re-enters to re-verify the generation, so the critical section stays
# short in every case. A corpse ARBITER (stealer killed inside the ms-long
# critical section) is deliberately NOT auto-recovered — see the note in
# try_steal_stale_lock; runs keep waiting and print the manual recovery line.
quality_steal_arbiter="${quality_lock_dir}.arbiter"

lock_mtime_epoch() {
  # BSD stat first, GNU stat second — and trust neither blindly: GNU stat -f
  # writes a filesystem report to stdout before failing, so anything that is not
  # a pure integer is discarded rather than fed into arithmetic.
  local raw
  raw="$(stat -f %m "$1" 2>/dev/null)"
  if [[ ! "$raw" =~ ^[0-9]+$ ]]; then
    raw="$(stat -c %Y "$1" 2>/dev/null)"
  fi
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    echo "$raw"
  else
    echo ""
  fi
}

path_age_seconds() {
  local mtime
  mtime="$(lock_mtime_epoch "$1")"
  if [[ -z "$mtime" ]]; then
    echo 0
  else
    echo $(( $(date +%s) - mtime ))
  fi
}

lock_field() {
  cat "$quality_lock_dir/$1" 2>/dev/null || true
}

# The third staleness rule, and the only one that judges a LIVE process (#855).
# A cancelled CI job leaves quality.sh running but reparented to pid 1: its
# launcher is gone, so nobody will ever read its result, and if it is wedged in
# cleanup (the incident: a DROP DATABASE that sat 1h31m) it will never release the
# lock either. "Provably dead" never fires for such a holder, so before this rule
# every later run simply waited until its own job timeout killed it — the machine
# was starved by a process no one wanted any more.
#
# PPID 1 is the honest signal that the holder was abandoned rather than merely
# slow, and the grace period is what keeps the rule from being a race: the holder
# must ALSO have owned the machine longer than the grace period, so a run that is
# reparented milliseconds before finishing is left alone. This rule is only ever
# reached after the holder's identity has been confirmed (see
# current_lock_is_stale), so a recycled pid can never be mistaken for an orphan.
#
# Unaffected, verified: the runner chain (launchd → runner → step shell) and any
# run under tmux/screen keep a live launcher, so they never read as orphans.
#
# ACCEPTED COST: a run with no launcher of its own — `nohup`, `disown`, a
# background job whose parent shell exits, or quality.sh started directly by
# launchd — is orphaned from birth and therefore reads as abandoned once past the
# grace period; it can be killed and its lock taken. That trade was made
# knowingly: those shapes are indistinguishable from a cancelled run, and a
# machine starved for hours is the worse failure. Every steal names the pid it
# killed, and QUALITY_ORPHAN_GRACE_SECONDS raises the bar if such a run must
# survive longer.
holder_is_abandoned_orphan() {
  local holder="$1" ppid
  ppid="$(ps -p "$holder" -o ppid= 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$ppid" == "1" ]] || return 1
  (( $(path_age_seconds "$quality_lock_dir") > quality_orphan_grace_seconds ))
}

# Why the verdict is a reason and not just a boolean: only ONE of these describes
# a process that is still running, and therefore only one of them may lead to a
# kill. Handing a single "stale" bit to the stealer is how a recycled pid would
# get an unrelated service killed.
quality_stale_reason=""

# Returns 0 if the CURRENT lock at $quality_lock_dir is stale, and records why in
# quality_stale_reason:
#   pidless  no pid at all and older than 60s — a corpse from the mkdir window
#   dead     the recorded holder is provably gone
#   reused   the recorded pid is alive but is a DIFFERENT process now, so the
#            holder itself is gone. The stranger wearing its pid is not ours to
#            touch, which is exactly what this reason exists to say.
#   orphan   the holder is genuinely alive, genuinely abandoned (PPID 1), and has
#            held the machine past the grace period
# A live holder whose identity cannot be established at all is never judged:
# unverifiable means wait, not kill.
current_lock_is_stale() {
  local holder age recorded live
  quality_stale_reason=""
  holder="$(lock_field pid)"
  if [[ -z "$holder" ]]; then
    age="$(path_age_seconds "$quality_lock_dir")"
    if (( age > 60 )); then
      quality_stale_reason="pidless"
      return 0
    fi
    return 1
  fi
  if process_is_gone "$holder"; then
    quality_stale_reason="dead"
    return 0
  fi
  recorded="$(lock_field identity)"
  live="$(process_start_signature "$holder")"
  if [[ -z "$recorded" || -z "$live" ]]; then
    return 1
  fi
  if [[ "$recorded" != "$live" ]]; then
    quality_stale_reason="reused"
    return 0
  fi
  if holder_is_abandoned_orphan "$holder"; then
    quality_stale_reason="orphan"
    return 0
  fi
  return 1
}

# The generation of the lock we judged, captured under the arbiter so it can be
# re-checked under the arbiter later.
quality_target_token=""
quality_target_pid=""
quality_target_identity=""
quality_target_mtime=""

capture_lock_generation() {
  quality_target_token="$(lock_field token)"
  quality_target_pid="$(lock_field pid)"
  quality_target_identity="$(lock_field identity)"
  quality_target_mtime="$(lock_mtime_epoch "$quality_lock_dir")"
}

# True only if the directory at the path is still the exact lock we judged. `mv`
# moves whatever is there NOW, so between judging and moving, the path may have
# been released and re-taken by a run that is perfectly healthy — a different
# generation wearing the same name. The token settles it; the creation time
# settles the sliver where a brand-new lock has not written its token yet.
lock_generation_unchanged() {
  [[ -d "$quality_lock_dir" ]] || return 1
  [[ "$(lock_field token)" == "$quality_target_token" ]] || return 1
  [[ "$(lock_mtime_epoch "$quality_lock_dir")" == "$quality_target_mtime" ]]
}

# True when the holder we judged is provably gone: either the process is gone, or
# its pid is now worn by a different process (which means ours ended).
target_holder_is_gone() {
  [[ -n "$quality_target_pid" ]] || return 0
  process_is_gone "$quality_target_pid" && return 0
  [[ "$(process_start_signature "$quality_target_pid")" != "$quality_target_identity" ]]
}

enter_steal_arbiter() {
  mkdir "$quality_steal_arbiter" 2>/dev/null
}

leave_steal_arbiter() {
  rmdir "$quality_steal_arbiter" 2>/dev/null || rm -rf "$quality_steal_arbiter"
}

# Move the judged lock out of the way, then delete it. Only ever called with the
# arbiter held and the generation freshly verified.
reclaim_lock_directory() {
  local graveyard="${quality_lock_dir}.stale.$$"
  if mv "$quality_lock_dir" "$graveyard" 2>/dev/null; then
    echo "quality: reclaimed stale lock"
    rm -rf "$graveyard"
  fi
}

try_steal_stale_lock() {
  # A corpse arbiter (a stealer killed inside this ms-long critical section) is NOT
  # auto-recovered: any "judge age, then remove the shared path" here would recreate
  # the exact cross-generation race this arbiter exists to prevent, one level down —
  # and there is no deeper mutex to hide behind. The trade is deliberate: dying
  # inside a window this narrow is vanishingly rare, and the failure mode is loud
  # (every run prints the manual recovery line below until a human clears it),
  # while the common corpse — a dead quality RUN — is still recovered automatically.
  if [[ -d "$quality_steal_arbiter" ]] && (( $(path_age_seconds "$quality_steal_arbiter") > 60 )); then
    echo "quality: steal arbiter has been held for >60s — if no stealer process is alive, recover manually with: rm -rf $quality_steal_arbiter" >&2
  fi
  if ! enter_steal_arbiter; then
    return 1  # another stealer is arbitrating — just go back to waiting
  fi
  if ! current_lock_is_stale; then
    leave_steal_arbiter
    return 0
  fi
  if [[ "$quality_stale_reason" != "orphan" ]]; then
    # dead / reused / pidless: the holder is already gone, so there is nothing to
    # kill and nothing to wait for. Judge and move inside the same critical
    # section, exactly as this function has always done.
    reclaim_lock_directory
    leave_steal_arbiter
    return 0
  fi
  # An abandoned orphan is the one case that needs a KILL, and killing takes
  # seconds — for a deep tree, many of them. Holding the arbiter across that would
  # trade a millisecond-long critical section for a multi-second one, and a
  # stealer cancelled inside it leaves a corpse arbiter that policy says only a
  # human may clear. So the arbiter is released for the killing and re-entered for
  # the decision:
  #   in  → judge, record the generation      (milliseconds)
  #   out → kill the abandoned tree, bounded  (seconds, arbiter free)
  #   in  → re-verify, then move              (milliseconds)
  capture_lock_generation
  local target="$quality_target_pid"
  leave_steal_arbiter
  echo "quality: lock holder pid $target is an orphan (PPID 1) past ${quality_orphan_grace_seconds}s — clearing it before taking the lock"
  if ! kill_process_tree "$target"; then
    # A lock held by a process we could not stop is not ours to give away.
    # Non-zero sends the caller back to its 30s wait instead of spinning on a
    # steal that cannot succeed.
    echo "quality: could not kill abandoned holder pid $target — NOT stealing its lock; recover manually with: kill -9 $target && rm -rf $quality_lock_dir" >&2
    return 1
  fi
  echo "quality: cleared abandoned holder pid $target and its children"
  if ! enter_steal_arbiter; then
    return 1
  fi
  # The cross-generation check, and the reason the kill is not enough on its own:
  # the holder's own cleanup runs as it dies and removes ITS lock, after which any
  # third run can take the freed path atomically without ever consulting this
  # arbiter. That run's lock is live, healthy, and none of our business — proving
  # the old holder is dead says nothing about who owns the path now.
  if lock_generation_unchanged && target_holder_is_gone; then
    reclaim_lock_directory
  else
    echo "quality: the lock changed hands while the abandoned holder was cleared — standing down"
  fi
  leave_steal_arbiter
  return 0
}

acquire_quality_lock() {
  while true; do
    if mkdir "$quality_lock_dir" 2>/dev/null; then
      # Flag before the writes: the EXIT trap is already installed, so a death in
      # this window still removes the lock instead of leaving a corpse. Identity
      # is written BEFORE the pid so that "a pid is present" always implies "its
      # identity is present" — a reader must never see a pid it cannot verify.
      # ACCEPTED RESIDUAL: a signal landing between the mkdir syscall and the
      # token write leaves a token-less lock that cleanup declines to remove (it
      # releases only what it can prove is its own — see cleanup_quality_run).
      # bash cannot fuse a syscall and a file write into one atom, so the cost is
      # a bounded stall (worst case ~90s: the 60s pid-less age threshold plus one
      # 30s poll), which is the price of never deleting somebody else's lock.
      quality_lock_held=1
      printf '%s\n' "$quality_lock_token" > "$quality_lock_dir/token"
      process_start_signature "$$" > "$quality_lock_dir/identity"
      echo "$$" > "$quality_lock_dir/pid"
      return 0
    fi
    if current_lock_is_stale; then
      # A failed steal (arbiter busy or corpse-arbiter policy) must NOT skip the
      # wait: with a corpse main lock AND a corpse arbiter this branch would
      # otherwise spin hot and flood the log. One steal attempt per 30s is plenty.
      if ! try_steal_stale_lock; then
        sleep 30
      fi
      continue
    fi
    local holder
    holder="$(lock_field pid)"
    echo "quality: another quality run (pid ${holder:-starting}) holds this machine — waiting 30s"
    sleep 30
  done
}
# <<< quality-lock library ─────────────────────────────────────────────────────

# Single EXIT trap for both responsibilities: bash keeps only one, so the database
# drop and the lock release live in one function. Each step is guarded so no step
# can abort the function under `set -e` — the lock release must run even when the
# database drop fails (Postgres down, run SIGTERMed mid-create, ...) and, since
# #855, even when the drop does not fail but simply never answers: the drop is
# time-bounded, so this function always reaches the release below. Leaving a stray
# database is litter (its name is unique to this run); leaving the machine locked
# is an outage.
cleanup_quality_run() {
  if [[ -n "$local_database" && "${FIKIRTIVE_KEEP_TEST_DB:-}" != "1" ]]; then
    drop_local_database || echo "quality: test-database drop failed or timed out after ${quality_drop_timeout_seconds}s — leaving $local_database behind and releasing the machine anyway" >&2
  fi
  # Release only what we can prove is ours. If our lock was already reclaimed —
  # we were judged abandoned and cleared, and someone else now owns the path — a
  # blind `rm -rf` here would delete a live run's lock and put two runs on the
  # machine at once. Same reasoning as the steal side, opposite direction.
  if [[ -n "$quality_lock_held" ]]; then
    if [[ "$(cat "$quality_lock_dir/token" 2>/dev/null || true)" == "$quality_lock_token" ]]; then
      rm -rf "$quality_lock_dir" || true
    else
      echo "quality: this run's machine lock was already reclaimed by another run — leaving the current holder alone" >&2
    fi
  fi
}

# CI and local runs take the same path on purpose — there used to be a
# GITHUB_ACTIONS branch that skipped database creation because GitHub-hosted
# runners got a fresh dockerized Postgres per run. On a self-hosted runner that
# assumption silently inverts: reusing one long-lived database across PRs loses the
# fresh-database guarantee. One path, per-run database, force-dropped on exit.
# Trap goes on BEFORE the lock so cleanup runs on every exit path (with the one
# accepted residual noted at the mkdir site: a signal inside the mkdir→flag window
# leaves a corpse for the >60s rule instead). Cleanup no-ops on whatever was not
# yet acquired. At this point local_database is still "" — cleanup only releases
# the lock. The name is validated BEFORE it is assigned to local_database, so the
# FORCE-drop in cleanup can never see an unvalidated name (FIKIRTIVE_TEST_DB=
# fikirtive must die at the validation, not reach DROP DATABASE — that is the dev
# database).
trap cleanup_quality_run EXIT
acquire_quality_lock
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
