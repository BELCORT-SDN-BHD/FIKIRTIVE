You are a read-only advisor. Answer directly in one memo; do not invoke skills, spawn agents, or delegate. You MAY read repository files (read-only). Repo root: /Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0 (branch main @ 1b1414d9).

# 咨询：路线乙第一批施工的分解方案（B0 签署生效后的第一拨派工）

## 1. 决策背景与 founder 原话

B0 发布契约 PR #240 已由 founder 合并（=签署冻结生效，2026-07-11T18:01Z）。founder 原话：「合并了，CODEX会在3个小时后恢复额度。你认为可以直接开始就开始。我没有什么问题」。即：①R-001~R-008 默认项无异议；②SOL lane 约 3 小时后恢复（届时补跑跨族复审，monitor 已设）；③授权控制面按自己判断开工。本机安全闸不变：任何 merge 仍需 founder 当轮明示（PR 将攒批等合并窗口）。

## 2. 适用法律

- 执行合同 §四 顺序 v3：第 2 步 = B10 关键安全 + B9 引擎接口冻结 + B2 数据契约（事件/身份/同意）；第 3 步 = **B8 设计全图立即启动（不等债清）→ 体量过目**。
- 硬约束：判断永不下放 worker；每块分解过顾问；一个 PR 一件事；单写者（并行写者须 worktree 隔离）；六级状态制（spec-ready 需含对标锚清单——§六 无锚不开工）；84 债棘轮只许降、禁新增债。
- 蓝图第五章：图纸先行 spec（华语）→ founder 过目。Q2 裁决=founder 验收最终一次；改判表已废「每环 founder 亲点」。**存在解释空间：spec 过目是否可改为「增量投递只读 + 合并窗口异议制」**——founder 本轮已说「直接开始就开始，我没有什么问题」。
- 矩阵（签署件）：`docs/ops/route-b/matrix/`，B10=27 行、B9=21 行、B2=11 行、B8=26 行。

## 3. 原始证据

- MASTERPLAN P0 行（已拍板可开工）：P0-2（verify-auth-guards 只认 requireSession/Role/Admin 不认 requireOwner，105 误报无法接 CI；验收=exit 0+自测红例+接 ci.yml）；P0-3（`pnpm lint` 128 errors 且 CI 不跑 lint；验收=0 error+ci.yml lint job；禁止顺手改逻辑）；P0-5（check-parity.mjs:43 只认 `export async function` 不认 `export const x = async`；data.ts 8 个读面补登记；验收=lint:parity 绿+红例自测）。
- **P0-5 暗礁（控制面已识别）**：8 个读面登记若一律记 `todoSkill` 会把棘轮从 84 推高 → CI 必红且违反禁新增债闸。data.ts 读面在 84 债清单里已有 9 条（debt-41~49 = Otto 首页 page data）。「8 个读面」与这 9 条的关系需先核清——可能是同一批（登记已存在）或部分重叠。
- 文件面冲突：P0-2 与 P0-5 都碰 `scripts/` + `ci.yml`；P0-3 碰全仓（128 errors 散布）。
- B9 矩阵行含：E2-19 分域装载（schema/未动工）、E2-20 上下文桥（代码零）、E2-16 债台账、B0 新行（Otto 首页数据面/线程管理/D9 甄别/R2PASS）。B9 的合同角色=「先行并冻结引擎接口」，B11 从最后建降为最后只验。
- B2 矩阵行含：E5-06 六表 schema 已合(悬空)、E5-07 短链 redirect 代码零、分析区现状行。B2 数据契约=事件/身份/同意 三件（Sol 原阻断：不先冻结，B8 末期必发现新 schema）。
- B8=26 行（Campaign 8 + CRM 3 + 口碑 5 + Marketplace 5 + landing 2 + QR 物料/GBP/增长实验等）。合同：设计全图完成后「体量过目」——founder 用 Q6 机制逐大陆裁「本程做多深」（Fable 曾警告：前五每个都是小产品，不裁可能让全程翻倍）。
- worker lanes：Claude 原生（Opus/Sonnet/Haiku）可用；codex lane 额度 ~3h 恢复。B0 时 Sonnet-high 审计舰队实测可靠（275 源项，零错报格式）。
- 生产事实：worktree 已装依赖、包已 build、typecheck 绿；pre-push 钩子跑 typecheck。

## 4. 摆上台面的选项

**批次结构：**
- A. **四车道同启**：L1 B10 施工（P0-2→P0-5→P0-3 顺序 PR）+ L2 B9 spec + L3 B2 spec + L4 B8 设计舰队（7 工位，read-only 产设计文档）。最大并行；spec/设计是文档车道与代码车道零文件冲突。
- B. **两步走**：先 B10 三 PR + B9/B2 spec；B8 设计舰队等 B2 数据契约冻结后再启（设计吃契约，避免返工）。
- C. **B10 独行先证明机制**：第一拨只跑 B10 三 PR（最小可验证批次），其余等首个合并窗口后铺开。

**子决策：**
1. P0-2 与 P0-5 的关系：一个 worker 顺序两 PR / 两 worker worktree 隔离（ci.yml 冲突后合）/ 合成一个「扫描器围栏修复」PR（两项都是 scanner-fence，语义同类）？
2. P0-3（128 lint errors）的时机与安全法：殿后独占 / 与 P0-2/5 并行 worktree / 是否要求「纯机械修复清单先出、人核后再改」？
3. B9/B2 spec 的作者层级：控制面亲写骨架+Heavy worker 充实 / Heavy worker 全写+控制面核 / 控制面全写？（判断不下放的边界在哪）
4. B8 设计舰队：7 工位一次全开 vs 先 2-3 个大陆试产定模板再铺开？设计工位的产出物口径（六态+假设台账+对标锚+人工/Otto 双面+体量档位建议）？
5. **spec 过目机制**：蓝图第五章 founder 过目 vs founder「直接开始」授权——增量投递只读+合并窗口异议制是否成立？（这是治理解释，需要你明确表态）
6. 六级状态：B10 三项完成后，对应矩阵行状态迁移谁来做、在哪个 PR 里做（合同 §一 规则=块 PR 里迁自己的行）？

## 5. 请求

①批次结构推荐与理由；②六个子决策各自推荐；③P0-5 棘轮暗礁的解法；④隐藏风险（尤其：四车道并行下的账本单写者与合并窗口攒批的交互）；⑤缺什么证据；⑥置信度（%）。
