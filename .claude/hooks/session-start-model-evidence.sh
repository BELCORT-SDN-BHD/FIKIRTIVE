#!/bin/sh
# SessionStart — turn the model-identity ritual into something the harness does.
#
# It prints the exact command that reads the identity out of this session's own
# transcript, so the check costs one paste instead of being remembered. It never
# reaches the network, never decides whether the identity is acceptable (the
# allowed set is whatever the Founder's current instruction says), and always
# exits 0. No absolute machine paths: $HOME and $CLAUDE_PROJECT_DIR only.

if [ "${FIKIRTIVE_HOOKS_OFF:-}" = "1" ]; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
transcript_dir="$HOME/.claude/projects/$(printf '%s' "$project_dir" | tr -c 'A-Za-z0-9' '-')"

cat <<EVIDENCE
[FIKIRTIVE] 开工核身份(项目法第 15 条)。平台会静默降级模型,自称不算证据。
本会话转录目录:$transcript_dir
读最近一条 model 字段(转录目录内最新的 .jsonl):
  grep -ho 'model":"[^"]*' \$(ls -t $transcript_dir/*.jsonl | head -n 1) | tail -n 1
合法模型集合以 Founder 的现行指令为准,不写死在此。核出的身份与之不符 → 停止新决策,
如实上报,等 Founder 亲自切换。判断留编排者,取证/写码/查询派 worker。
EVIDENCE

exit 0
