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
| B0 产物复审 memo | `coverage-audit/advisor-b0-review/` | 待复审后回填 |
| 校验脚本运行记录 | PR 描述贴 `node scripts/route-b-matrix-check.mjs` 输出 | 全绿才递 |
