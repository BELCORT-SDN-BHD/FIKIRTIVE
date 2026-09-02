#!/usr/bin/env bash

# SessionStart 注入(手册配套①):把 docs/specs/ 各规格的状态行打进每场开场上下文,
# 让任何 session 一睁眼就知道现在有哪些规格、各在什么阶段——不靠会话记忆转述。
# 这是只读工具,永远 exit 0:hook 失败不该挡任何人干活。

set -u
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0

echo "── docs/specs/ 规格状态(开场注入)──"
found=0
for f in docs/specs/*.md; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  [ "$base" = "TEMPLATE.md" ] && continue
  status="$(grep -m1 -E '^>?[[:space:]]*状态(:|：)' "$f" 2>/dev/null || true)"
  printf '%s — %s\n' "$base" "${status:-状态行缺失(M2 会红)}"
  found=1
done
[ "$found" = 1 ] || echo "(暂无规格。产品改动前先走 S1,模板在 docs/specs/TEMPLATE.md)"
exit 0
