#!/bin/sh
# Lock 2 — commands nobody in this project may run (project law, clauses 1, 2, 8),
# plus the shell-shaped hole in the orchestrator write lock (clause 13).
#
# PreToolUse hook for Bash. exit 0 = allow, exit 2 = block.
#
# This file is only the wrapper: kill switches, the node check, and the exit-code
# contract. The decision lives in bash-guard.mjs next to it, because deciding needs
# clause splitting and argv parsing rather than grep — see the header there.
#
# Fail-open by construction (see pretooluse-write-guard.sh): no node, unreadable
# payload, or any unexpected exit status from the decider means allow. Only an explicit
# exit 2 blocks. GitHub-side rulesets and .githooks/pre-push remain the real gate.

if [ "${FIKIRTIVE_HOOKS_OFF:-}" = "1" ]; then
  exit 0
fi

command -v node >/dev/null 2>&1 || exit 0

hook_dir="$(CDPATH= cd -P -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)" || exit 0
decider="$hook_dir/bash-guard.mjs"
[ -f "$decider" ] || exit 0

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0

printf '%s' "$payload" | CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}" node "$decider"
status=$?

[ "$status" = "2" ] && exit 2
exit 0
