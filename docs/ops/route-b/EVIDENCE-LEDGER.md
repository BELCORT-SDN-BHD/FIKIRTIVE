# 路线乙 · 证据清单（五本账之五）

> 每个一级/二级判断的 advisor provenance 与机器证据登记处。模型自述不算证据。

## B0 批次

| 证据 | 位置 | 说明 |
|---|---|---|
| D7 审计全证据（9 分片+综合+走查+生产事实） | `docs/review/ROUTE-B-EVIDENCE-2026-07-11/` | 121 能力行的原始出处（#239 入库） |
| B0 分解首轮咨询（SOL） | `coverage-audit/advisor-b0-plan/provenance-sol.json` | `incomplete: empty output`（session `019f5214`）——如实留痕 |
| B0 分解首轮咨询（fallback Fable max） | `coverage-audit/advisor-b0-plan/memo.md` + `provenance.json` | complete；方案 D 裁定源 |
| 覆盖审计舰队输出（4 源+delta） | `coverage-audit/audit-*.json` | 每源计数+逐项 verdict |
| MISSING 裁决 | `coverage-audit/adjudication.json` | 机器校验闭合对象 |
| 沉浸城 65 页实测清单 | `coverage-audit/immersive-65-pages.txt` | `git ls-tree origin/claude/northstar-immersive`（SHA `54c1de0b`） |
| B0 产物复审（SOL 两次尝试） | `coverage-audit/advisor-b0-review/provenance-sol.json` | `unavailable: capacity`（codex 额度触顶，events 原文为证）——如实留痕 |
| B0 产物复审（fallback Fable max） | `coverage-audit/advisor-b0-review/` | fallback 复审 memo+provenance（含对抗己方先前建议声明） |
| 换届演练（冷恢复测试） | `coverage-audit/handover-drill.md` | 全新只读 agent 仅凭 repo 恢复状态的问答记录+控制面核对 |
| 校验脚本运行记录 | PR 描述贴 `node scripts/route-b-matrix-check.mjs` 输出 | 全绿才递 |

## B2/B9 冻结循环（R5→R9，D-024）

| 证据 | 位置 | 说明 |
|---|---|---|
| codex R6/R7/R8/R9 判定原文 | PR #253 评论区 + D-024 载明四个 head SHA（`bf6331c7`/`880540b9`/`5930d65d`/`37590da9`） | 每轮钉 SHA 定向复审 |
| R7 后顾问 round one（SOL） | `coverage-audit/advisor-b2b9-freeze-loop/r7-sol-provenance.json` | `incomplete: no progress`——如实留痕 |
| R7 后顾问 round one（fallback Fable max） | 同目录 `r7-fallback-fable-memo.md` + `r7-fallback-fable-provenance.json` | complete；v1.0 结构性重写裁定源（fallback 未冒充 SOL） |
| R8 后顾问 round two（SOL Ultra） | 同目录 `r8-sol-round2-memo.md` + `r8-sol-round2-provenance.json` | complete 0.87；四修修正+契约 3 重开手续+R9 终止条件预冻结 |
| SPEC-4 工位三轮报告 + diff 地图 | PR #253 评论区（issuecomment-4949789283 / -4949842152 / -4949997817 / -4950108762） | 每轮零外溢自检+账行提案 |
| #255 codex R2 PASS 记录缺口 | D-024②如实留痕 | 无独立 provenance；合并授权=启动令+#254+非作者+CI 4/4 |

## B2/B9 冻结（拆分版）与 B3/B4 批0（D-026/D-027）

| 证据 | 位置 | 说明 |
|---|---|---|
| codex SR1（B2 v1.2 拆分复核）判定原文 | PR #253 评论区 + D-026 | PASS 钉 `1a8e0aea`；冻结侧 SHA-256 零变更佐证 |
| 冻结签核（SOL Ultra，#253+#258 双 PR） | `coverage-audit/advisor-freeze-signoff/` | complete 0.93 放行；#254 §三 高后果签核件 |
| B3/B4 分解顾问轮（SOL incomplete 留痕 + fallback Fable memo） | `coverage-audit/advisor-b3b4-batch0/` | fallback complete 0.85（B4 先行/LC-0/两 tranche 锚） |
| codex BR2/BR2-R2/BR2-R3（B3 spec 三轮）判定原文 | PR #258 评论区 | 终判 PASS 钉 `12eeea1f` |
| codex BR1/BR1-R3/BR1-R4（B4 spec）判定原文 | PR #257 评论区 | BR1-R2 网络停摆两线索经工位核实（D-027⑤） |
| W-DELTA 差额核证 + W-ANCHOR 锚取证 | scratchpad 存档（b3-spec-inputs/），关键结论已入 B3 spec §二/§三 | L-C 前提失效发现的原始载体 |
