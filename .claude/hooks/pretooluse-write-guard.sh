#!/bin/sh
# Lock 1 — the orchestrator does not write code (project law, clause 13).
#
# PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit.
#   exit 0 = allow, exit 2 = block and hand stderr back to the model.
#
# Fail-open by construction: an unreadable payload, an unknown JSON shape, a
# missing node binary or any repository-resolution failure exits 0. A governance
# hook must never be the reason a session cannot work. The payload field names
# (tool_input.file_path, transcript_path) move between harness versions — run
# .claude/hooks/probe-payload.sh once per upgrade and re-check them.

if [ "${FIKIRTIVE_HOOKS_OFF:-}" = "1" ] || [ "${FIKIRTIVE_ORCH_WRITE_OK:-}" = "1" ]; then
  exit 0
fi

command -v node >/dev/null 2>&1 || exit 0

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0

parsed="$(printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const input = payload.tool_input || payload.toolInput || {};
    const file =
      input.file_path || input.filePath || input.notebook_path || input.notebookPath || "";
    const transcript = payload.transcript_path || payload.transcriptPath || "";
    if (typeof file !== "string" || typeof transcript !== "string") process.exit(3);
    // The trailing sentinel is load-bearing: command substitution strips trailing
    // newlines, so without it an EMPTY transcript line vanishes and line 2 reads back
    // as the file path — which made an absent transcript_path look like a top-level
    // session and blocked the write.
    process.stdout.write(file + "\n" + transcript + "\n.\n");
  } catch {
    process.exit(3);
  }
});
' 2>/dev/null)" || exit 0

file_path="$(printf '%s\n' "$parsed" | sed -n '1p')"
transcript_path="$(printf '%s\n' "$parsed" | sed -n '2p')"
[ -n "$file_path" ] || exit 0

# No transcript field = no tier evidence = allow. This line is the difference between
# a tripwire and an outage: the tier test below reads whoever is NOT a worker as the
# orchestrator, so a renamed payload field would otherwise block every worker in the
# project at once. Blocking on absent evidence is the one failure this hook must not
# have (see README, "fail-open 是刻意的").
[ -n "$transcript_path" ] || exit 0

# A worker's transcript is a file sitting DIRECTLY inside a <session>/subagents/
# directory (observed shape: .../<session-uuid>/subagents/agent-<id>.jsonl). Anchor on
# that, not on a bare "/subagents/" substring: a config directory that merely contains
# the word (CLAUDE_CONFIG_DIR=/tmp/subagents/...) would otherwise hand every top-level
# session a worker's write permission. Workers must be able to write — this branch is
# the whole point of the design, so it comes first, and it stays generous: either the
# transcript is a leaf of subagents/, or it carries the agent- prefix.
case "$transcript_path" in
  */subagents/*)
    subagent_leaf="${transcript_path##*/subagents/}"
    case "$subagent_leaf" in
      */*)
        case "${subagent_leaf##*/}" in
          agent-*) exit 0 ;;
        esac
        ;;
      *) exit 0 ;;
    esac
    ;;
esac

# Resolve the nearest existing ancestor directory of the target path.
dir="$file_path"
case "$dir" in
  */*) dir="${dir%/*}" ;;
  *) dir="." ;;
esac
[ -n "$dir" ] || dir="/"
while [ ! -d "$dir" ]; do
  case "$dir" in
    */*) dir="${dir%/*}" ; [ -n "$dir" ] || dir="/" ;;
    *) dir="." ; break ;;
  esac
done
[ -d "$dir" ] || exit 0

common_dir() {
  (
    CDPATH= cd -P -- "$1" 2>/dev/null || exit 1
    resolved="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 1
    CDPATH= cd -P -- "$resolved" 2>/dev/null || exit 1
    pwd -P
  )
}

# Same Git common directory = this repository, main checkout or any linked
# worktree under .claude/worktrees/. Anything else (memory files, scratchpads,
# another repository) is outside the fence and stays writable.
target_repo="$(common_dir "$dir")" || exit 0
[ -n "$target_repo" ] || exit 0
project_repo="$(common_dir "${CLAUDE_PROJECT_DIR:-$PWD}")" || exit 0
[ -n "$project_repo" ] || exit 0
[ "$target_repo" = "$project_repo" ] || exit 0

cat >&2 <<'BLOCKED'
编排者无写权——判断留编排者,写码派 worker(Founder 令)。
本次被拦的是仓库内文件写入;仓库外(记忆、scratchpad)不受限。
紧急放行只能在启动 Claude Code 时给进程环境,Bash 工具里 export 无效
(hook 继承的是 CLI 进程的环境,不是某次 Bash 调用的):
  FIKIRTIVE_ORCH_WRITE_OK=1 claude   # 只解写锁
  FIKIRTIVE_HOOKS_OFF=1 claude       # 停用全部 hook
BLOCKED
exit 2
