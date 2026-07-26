#!/bin/sh
# Lock 1 — the orchestrator does not write code (project law, clause 13).
#
# PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit.
#   exit 0 = allow, exit 2 = block and hand stderr back to the model.
#
# This file is only the wrapper: kill switches, the node check, and the exit-code
# contract. The decision lives in write-guard.mjs next to it — see the header there for
# why reading two payload fields back by LINE POSITION was a hole in both directions.
#
# Fail-open by construction (same rule as pretooluse-bash-guard.sh): no node, unreadable
# payload, or any unexpected exit status from the decider means allow. Only an explicit
# exit 2 blocks. A governance hook must never be the reason a session cannot work.

if [ "${FIKIRTIVE_HOOKS_OFF:-}" = "1" ] || [ "${FIKIRTIVE_ORCH_WRITE_OK:-}" = "1" ]; then
  exit 0
fi

command -v node >/dev/null 2>&1 || exit 0

hook_dir="$(CDPATH= cd -P -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)" || exit 0
decider="$hook_dir/write-guard.mjs"
[ -f "$decider" ] || exit 0

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0

printf '%s' "$payload" | CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}" node "$decider"
status=$?

[ "$status" = "2" ] && exit 2
exit 0
