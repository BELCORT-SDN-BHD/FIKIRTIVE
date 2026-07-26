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
    process.stdout.write(file + "\n" + transcript + "\n");
  } catch {
    process.exit(3);
  }
});
' 2>/dev/null)" || exit 0

file_path="$(printf '%s\n' "$parsed" | head -n 1)"
transcript_path="$(printf '%s\n' "$parsed" | head -n 2 | tail -n 1)"
[ -n "$file_path" ] || exit 0

# A worker's transcript lives under <session>/subagents/. Workers must be able to
# write — this branch is the whole point of the design, so it comes first.
case "$transcript_path" in
  */subagents/*) exit 0 ;;
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
紧急放行:FIKIRTIVE_ORCH_WRITE_OK=1;停用全部 hook:FIKIRTIVE_HOOKS_OFF=1。
BLOCKED
exit 2
