#!/bin/sh
# Lock 2 — commands nobody in this project may run (project law, clauses 1, 2, 8).
#
# PreToolUse hook for Bash. exit 0 = allow, exit 2 = block.
# Orchestrator and workers are treated identically: these actions are wrong for
# every session, not just for one tier.
#
# Fail-open by construction (see pretooluse-write-guard.sh). The matches are
# deliberately blunt: a false block costs one rephrase, a missed force-push to
# main costs history. GitHub-side rulesets remain the real gate; this stops the
# command earlier and cheaper.

if [ "${FIKIRTIVE_HOOKS_OFF:-}" = "1" ]; then
  exit 0
fi

command -v node >/dev/null 2>&1 || exit 0

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0

bash_command="$(printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const input = payload.tool_input || payload.toolInput || {};
    const command = input.command || "";
    if (typeof command !== "string") process.exit(3);
    process.stdout.write(command);
  } catch {
    process.exit(3);
  }
});
' 2>/dev/null)" || exit 0

[ -n "$bash_command" ] || exit 0

matches() {
  printf '%s\n' "$bash_command" | grep -Eq "$1"
}

block() {
  printf '%s\n' "$1" >&2
  exit 2
}

if matches '(^|[^[:alnum:]_.-])git([[:space:]]+[^[:space:]]+){0,4}[[:space:]]+push([[:space:]]|$)'; then
  if matches '(^|[^[:alnum:]_-])main([^[:alnum:]_-]|$)'; then
    block '直推 main 被项目法禁止(第 1 条)。请推到任务分支再开 PR。GitHub 侧 ruleset 同样会拒,此处只是提前止损。'
  fi
  if matches '(^|[[:space:]])(--force|--force-with-lease|--force-if-includes|-f)([[:space:]=]|$)'; then
    block 'force push 被拒:会重写他人已拉取的历史。要改已推提交,追加一个新 commit 或先与 Founder 确认。'
  fi
fi

if matches '(^|[^[:alnum:]_.-])gh([[:space:]]+[^[:space:]]+)*[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
  block '合并权属 Founder 或其明确指派的非作者执行者,session 不得执行;--auto 更是项目法禁令(第 2 条)。'
fi

if [ "${FIKIRTIVE_BLUEPRINT_AMEND:-}" != "1" ] && matches 'update-blueprint-hash'; then
  block 'Blueprint 哈希只在 Founder 的修宪流程里更新(第 8 条)。修宪时由 Founder 设 FIKIRTIVE_BLUEPRINT_AMEND=1。'
fi

exit 0
