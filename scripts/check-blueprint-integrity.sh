#!/usr/bin/env bash
# 宪法防篡改闸(2026-07-04)。docs/BLUEPRINT.md 是"不可改"文件(仅 founder 经第七章
# 流程修订)。此前没有任何机器检查它未被动过 —— 一个跑偏的 agent 可以改宪法把自己
# 要做的事"合法化"再推 main。这道闸让宪法改动"可见":宪法的 sha256 存在
# scripts/blueprint.sha256,CI 每次重算比对,不符即 FAIL。
#
# 这不是"防不可改"(tamper-PROOF),是"改必留痕"(tamper-EVIDENT):founder 授权的
# 真修订,运行 scripts/update-blueprint-hash.sh 更新哈希 —— 那会在 diff 里留下一个
# 名叫 blueprint.sha256 的单行改动,founder 扫一眼 PR 列表就看得见,而不是埋在大 diff
# 里的一处静默宪法篡改。GPT goal-mode 等不读 .claude/ 的 agent 也照样被这道 CI 拦。
set -euo pipefail
cd "$(dirname "$0")/.."

STORED_FILE="scripts/blueprint.sha256"
BLUEPRINT="docs/BLUEPRINT.md"

if [[ ! -f "$STORED_FILE" ]]; then
  echo "[blueprint-integrity] FAIL: $STORED_FILE 缺失 —— 无法校验宪法完整性。" >&2
  exit 1
fi

# shasum(macOS) 与 sha256sum(Linux/CI) 二选一。
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$BLUEPRINT" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$BLUEPRINT" | awk '{print $1}')"
fi
stored="$(tr -d '[:space:]' < "$STORED_FILE")"

if [[ "$actual" != "$stored" ]]; then
  echo "[blueprint-integrity] FAIL: docs/BLUEPRINT.md 与记录的哈希不符。" >&2
  echo "  记录: $stored" >&2
  echo "  实际: $actual" >&2
  echo "" >&2
  echo "  宪法是'不可改'文件。若这是 founder 授权的第七章修订:" >&2
  echo "    运行 bash scripts/update-blueprint-hash.sh 更新哈希,并在 PR 注明 [BLUEPRINT-AMEND]。" >&2
  echo "  若你不是在做授权修订 —— 停手,还原 docs/BLUEPRINT.md,报告 founder。" >&2
  exit 1
fi

echo "[blueprint-integrity] OK: 宪法未被动过($stored)。"
