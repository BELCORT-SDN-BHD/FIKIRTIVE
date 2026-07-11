# B0 板块报告 · 发布契约与覆盖矩阵

> 按执行合同 §七 十四节标准编制；B0 是治理文档块（零产品代码），不适用的节如实标注而非省略。
> 人话对照：「覆盖矩阵」= 把『全城要建什么』冻成一张逐条可查的清单；「发布契约」= 这张清单怎么算数、状态怎么升级的规则书。

## ① 块 ID / PR / 最终 SHA / 认证日期

B0 · PR =（本 PR，合并后回填号）· 分支 `claude/route-b-b0-release-contract` · 编制日 2026-07-12 · epoch `claude-20260712-03`。

## ② 批准范围 + 明示排除 + 映射

- 范围 = 执行合同 §一（B0 定义，Sol 阻断 #1 的解）；来源穷举六件套全部处理（蓝图/宪法/九缝/MASTERPLAN/A′ 65 页/缺失大陆前五/MATRIX-V0 121 行）。
- 明示排除 = 本块不写任何产品代码（硬约束 1）、不给行填工程细节列（归属块 spec-ready 时硬化）、不做四 thesis 重打分。
- 映射 = MASTERPLAN→矩阵行逐条在 `coverage-audit/adjudication.json`；宪章 §二 → `matrix/OUT.md` 出程清单。

## ③ 功能清单（非页面清单）

**204 能力行**（111 存量 + 93 新增）+ 26 留痕。块分布与每源覆盖统计见 `B0-CONTRACT.md` §六（签署对象）。

## ④ 双执行矩阵

B0 本身无用户面（n/a）。**但矩阵为全城每行强制了双执行器两列**（人工入口 + Otto skill），84 条对等债逐条挂行（`parity-debt.md`），每块验收=债清零——这是宪法 7 在本程的机器化。

## ⑤ 对标锚

n/a（治理文档块无品类对标）。水准判官机制已入合同 §一：`spec-ready` 必须含对标锚清单，无锚不开工。

## ⑥ 全旅程证据

n/a（无 UI）。等价物 = 双向机器校验：`node scripts/route-b-matrix-check.mjs` 全绿（ID 唯一/无空白格/闭集/84 债闭合/145 条 MISSING 裁决闭合），已接 CI。

## ⑦ 测试全家桶可重跑链接

`node scripts/route-b-matrix-check.mjs`（本地即跑）；CI job `checks` 已加同一步。

## ⑧ schema / ownerId / 审计 / 同意 / 秘密

零 schema 变更、零代码路径变更。顾问证据包过脱敏检查（无密钥值）；凭据相关递延项照 CREDENTIAL-INVENTORY 不变。

## ⑨ 成本 / 延迟 / margin / 监控 / 回滚

本块真实花费 $0（无供应商调用）。agent 用量：舰队 5 员 ~49 万 subagent tokens + 顾问 2 次调用。回滚 = revert 本 PR（纯文档+一行 CI）。

## ⑩ 上下游契约 + 外部位状态 + 通电步骤

- 下游：B1-B13 每块 spec 必须引用其矩阵文件并在块 PR 里迁移自己行的六级状态（合同 §一 迁移规则表）。
- 外部位：外部等待钥匙已入 `DEPENDENCY-STATUS.md` 外部等待位表（Meta/WABA/EasyStore/GBP/短链域/Sentry——对应供给清单 A/B 节）。
- 通电步骤：n/a（B0 不通电）。

## ⑪ 异族评审

- 分解方案：SOL ultra 首轮 `incomplete: empty output`（session `019f5214`，留痕）→ fallback **Fable max complete**（方案 D 全采纳，`coverage-audit/advisor-b0-plan/`）。
- 产物复审：SOL ultra 两次尝试均 `unavailable: capacity`（codex 额度触顶，events 原文为证）→ 按协议 fallback **Fable max（complete）**：裁定「有条件可签，置信 88%」，四条件（迁移损伤/校验器盲洞/💰计数口径/证据链收口）已全部修复闭环（D-013）；111 存量行迁移保真逐格比对 PASS。同族闭环风险已披露——**跨族复审可在 codex 额度恢复后补跑，是否等待请 founder 一句话**。provenance 在 `coverage-audit/advisor-b0-review/`。
- 代码级异族评审：n/a（零产品代码）；CI 一行 + 校验脚本随 PR 评审。

## ⑫ 已知限制与待裁（没有写「无」）

1. 存量 111 行的 `人工入口/测试/报告` 多为 `TBD-Bn` 占位——这是合同明文的设计（归属块 spec 时硬化），不是漏填。
2. 归块是控制面单判（规则在决策日志 D-004），复审与 founder 签署可推翻；错位风险由「归块=签署对象」条款兜底。
3. 待裁 R-001~R-008（`RISKS-PENDING.md`）：X 归 B4、A/B 分叉出处、AEO 翻案、竞品透视出处、Telegram、分市场定价、增长实验形态、报表引擎壳处置——全部为隔离项，不阻塞开工。
4. 沉浸城 65 页中 6 页（aeo/competitors 等）能力按 OUT-deferred 留壳，founder 改判即回表。
5. H1 九缝 / OM1 off-main 两分片未逐行入矩阵（缝=横切条款 CC-SEAMS；off-main=A′ 策略已裁），若 founder 要求逐缝立行可增补。
6. **判决全集（GRILL/DECISION-INVENTORY）为经由 V0 与 MASTERPLAN 的二阶覆盖**，未作为独立源逐条扫（复审 memo 判断点 5 披露）；harmony-0x 设计文档同为引用侧覆盖。若任一单条判决被两层都漏，B1-B13 块 spec 对锚时是下一道网。

## ⑬ 录像时间码 + founder 10 分钟自查脚本

无录像（文档块）。**Founder 自查脚本（10 分钟）**：
1. 打开 `docs/ops/route-b/B0-CONTRACT.md`——你应该看到：六级+第0级状态表、签署的四件事、计数总账（204 行/26 留痕/四源覆盖表）。
2. 打开 `matrix/INDEX.md` 点进任意一块（如 `08-B8.md`）——你应该看到：每行有人话能力名+批准来源+闸；Campaign/CRM/口碑/QR 等你拍过板的东西都在。
3. 打开 `matrix/OUT.md`——你应该看到：每条「不在本程」都有理由和出处（TikTok/Agency/市政厅v2/手机App/宪法8 清单……），没有凭空消失的承诺。
4. 终端跑 `node scripts/route-b-matrix-check.mjs`——你应该看到 `✅ 校验全绿`。
5. 打开 `RISKS-PENDING.md`——8 条待裁，每条有默认选项；有异议圈出来即可。

## ⑭ 定稿后 delta

（合并后触碰本块任何签署对象=重认证；delta 记录从此处追加。）
