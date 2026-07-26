#!/bin/sh
# SessionStart — turn the model-identity ritual into something the harness does.
#
# It prints the exact command that reads the identity out of THIS session's own
# transcript, so the check costs one paste instead of being remembered. It never
# reaches the network, never decides whether the identity is acceptable (the
# allowed set is whatever the Founder's current instruction says), and always
# exits 0.
#
# The transcript path comes from the hook payload on stdin, not from rebuilding the
# projects directory and taking the newest .jsonl in it. That older trick was wrong in
# the one moment this hook runs: at session start the newest file in that directory is
# usually the PREVIOUS session — possibly a different model — so the ritual meant to
# catch a silent downgrade would have handed back confident, wrong evidence.

if [ "${FIKIRTIVE_HOOKS_OFF:-}" = "1" ]; then
  exit 0
fi

transcript=""
if command -v node >/dev/null 2>&1; then
  payload="$(cat 2>/dev/null)"
  if [ -n "$payload" ]; then
    transcript="$(printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const path = payload.transcript_path || payload.transcriptPath || "";
    if (typeof path === "string") process.stdout.write(path);
  } catch {
    process.exit(3);
  }
});
' 2>/dev/null)" || transcript=""
  fi
fi

printf '%s\n' "[FIKIRTIVE] 开工核身份(项目法第 15 条)。平台会静默降级模型,自称不算证据。"
if [ -n "$transcript" ]; then
  printf '%s\n' "本会话转录(hook 载荷给的,不是猜的):$transcript"
  printf '%s\n' "读本会话最近一条 model 字段:"
  printf '%s\n' "  grep -ho 'model\":\"[^\"]*' '$transcript' | tail -n 1"
  printf '%s\n' "(刚开工时本文件可能还没有 assistant 轮次;第一轮之后再跑一次。)"
else
  printf '%s\n' "本会话转录路径未能从 hook 载荷读到(字段可能随 harness 版本改名)。"
  printf '%s\n' "先用 .claude/hooks/probe-payload.sh 校准字段名,再核身份;在那之前不要拿别的"
  printf '%s\n' "转录文件冒充本会话的证据 —— 目录里最新的那个通常是上一个会话。"
fi
printf '%s\n' "核身份的触发点有两个:开工时与之后周期性各一次,以及每次声称切换模型之后立刻再核。"
printf '%s\n' "合法模型集合以 Founder 的现行指令为准,不写死在此。核出的身份与之不符 → 停止新决策,"
printf '%s\n' "如实上报,等 Founder 亲自切换。判断留编排者,取证/写码/查询派 worker。"

exit 0
