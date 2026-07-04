#!/usr/bin/env bash
# 更新宪法哈希 —— 仅在 founder 授权的第七章修订后运行。见 check-blueprint-integrity.sh。
# 运行它 = 一次显式、可见、单一用途的动作(改 scripts/blueprint.sha256),不是静默篡改。
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum docs/BLUEPRINT.md | awk '{print $1}' > scripts/blueprint.sha256
else
  shasum -a 256 docs/BLUEPRINT.md | awk '{print $1}' > scripts/blueprint.sha256
fi
echo "[update-blueprint-hash] 已更新为 $(tr -d '[:space:]' < scripts/blueprint.sha256)"
echo "记得在 PR 描述/提交信息注明 [BLUEPRINT-AMEND] + 修订理由,并让 founder 亲自合并。"
