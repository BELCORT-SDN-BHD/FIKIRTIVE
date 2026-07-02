# Otto 研究 · S2(研究卡:proposeResearch + RESEARCH_CARD,$0)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。实现 = Opus;每 task review;S 块整支 money review 在 S5(S2 全 $0)。
> spec = `docs/superpowers/specs/2026-07-03-otto-research-design.md` §3/§5。**蓝本 = storyboard F1/F2**(propose skill + 新 ChatMessage kind + 加性 enum migration + 两渲染器 + DTO 联合),凡同形处照抄其模式与断言强度。

**Goal:** 用户「帮我研究 X」→ Otto 刨根问底(requires: topic/goal)→ 持久化一张 **RESEARCH_CARD**(研究计划:主题、范围、**深度档**、预估 credits、状态=待审批)→ 在两个渲染器里渲染成审批卡。**全 $0**(仅持久化计划,真花钱在 S3 审批后)。同时加 `RESEARCH_REPORT` enum(S3 worker 产出用),本块只加值不产出。

## Global Constraints

- **$0**:proposeResearch 是 `free/write/internal`(不审批,同 proposeStoryboard);仅写 ChatMessage,无 GenJob/reserve。预估 credits 是**展示值**,真 reserve 在 S3。
- **加性 enum migration**:`ChatMessageKind` 加 **两个**值 `RESEARCH_CARD` + `RESEARCH_REPORT`(镜像 STORYBOARD_CARD migration;`ALTER TYPE ... ADD VALUE`;**F4 教训**:ADD VALUE 与 INSERT 不可同事务 —— 本块只 ADD VALUE + 持久化用已存在的值,天然分离)。
- **深度档 = 集中声明**(能力表哲学,同视频时长):`RESEARCH_TIERS`(quick/standard/deep)一处定义搜索/页数/steps 上限 + 定价形状;UI/校验/预估全读它,零散硬编码。
- **owner-scoped 身份仅 session**;zod-first `{error}`。
- 两处 `ChatMessageDTO.kind` 联合(types.ts + dto.ts cast)都补两个新值(同 F2)。
- 每 task:vitest 绿 + `pnpm -r typecheck` + **web build EXIT 0**(动 client 时)。

---

### Task 1: 深度档常量 + payload schema + proposeResearch skill($0)

**Files:** Create `packages/otto/src/skills/propose-research.helpers.ts`(+ `RESEARCH_TIERS` + payload 类型 + `buildResearchCardPayload`)、`propose-research.ts`(skill)、`propose-research.test.ts`;Modify `packages/db/prisma/schema.prisma`(enum +2)、Create migration `2026xxxx_research_kinds/migration.sql`(两条 `ALTER TYPE "ChatMessageKind" ADD VALUE`)、`registry.ts`(20→21)+ `registry.test.ts` + index 导出 + CATALOG regen。

**语义(测试逐条锁):**
1. `RESEARCH_TIERS = { quick: {...}, standard: {...}, deep: {...} }`,每档 `{ label, maxSearches, maxPages, maxSteps, estimatedCredits }`(数值实现时按 meter 定价推导给占位,S3 再校准;**集中一处**)。默认 standard。
2. `researchCardInput`(zod):`topic: string 3..200`、`goal?: string`(刨根问底门)、`tier: enum(quick|standard|deep) 默认 standard`、`questions?: string[] max 8`(子问题,可选)。`requires: [{field:"topic", question}]`(同 proposeStoryboard 的 goal 门)。
3. `ResearchCardPayload`:`{ researchId, topic, goal?, tier, questions: string[], estimatedCredits, status: "planned" }`(researchId 服务端铸;status 生命周期 planned→running→done/failed 由 S3 推进)。
4. `buildResearchCardPayload(input, mintId?)`:纯,盖 researchId + 从 `RESEARCH_TIERS[tier]` 取 estimatedCredits。
5. `proposeResearch` skill:`defineOttoSkill({cost:"free", effect:"write", reach:"internal", requires:[topic]})` → needsApproval false;`execute` 持久化 RESEARCH_CARD ChatMessage(owner-scoped from ctx,无 GenJob,镜像 executeProposeStoryboard);缺 topic → `{needMoreInfo}`。
6. registry 21 名(排序,照 F1);migration 两条 ADD VALUE(镜像 storyboard migration 文件)。

**Steps:** TDD → prisma build + generate → otto 全套 + `pnpm --filter @fikirtive/otto run catalog` → typecheck → commit `feat(otto,db): proposeResearch skill + RESEARCH_CARD/RESEARCH_REPORT kinds + depth tiers (\$0)`。

---

### Task 2: RESEARCH_CARD 渲染(审批卡外观,$0)

**Files:** Create `apps/web/lib/research-card.ts`(防御式 `parseResearchCardPayload`,同 storyboard-card.ts)+ test;Create `apps/web/components/otto/ResearchCard.tsx`;Modify `apps/web/lib/types.ts`(kind 联合 +2)、`apps/web/lib/dto.ts`(cast +2)、`apps/web/lib/otto-ui-messages.ts`(placeholderTextFor 两 case)、两渲染器(OttoConversation + OttoChatStream dispatch 分支)。

**语义:**
1. `parseResearchCardPayload(unknown)` → 视图(topic/goal/tier/questions/estimatedCredits/status;缺失兜底,同 storyboard 防御)。
2. `ResearchCard` 组件:样式镜像 `OttoActionPlanCard`(`.gb` 壳、token 配色、英文 chrome):标题(🔍 topic)、tier 标签、子问题列表、`Estimated N credits` + **状态区**(planned=显示 "Approve & run"(S3 接线,本块先占位禁用 or "Coming in S3" —— **决定**:本块渲染 planned 态 + 一个禁用/占位按钮,真接线 S3;不引入花钱)、running=进度占位、done=链到 REPORT)。
3. 两渲染器 dispatch:`RESEARCH_CARD` → `<ResearchCard>`;`RESEARCH_REPORT` → 占位(S4 做真渲染,本块先友好占位,避免空白)。DTO 两联合 + placeholderTextFor 两 case。
4. `parseResearchCardPayload` 从 `@fikirtive/otto` 导出的 `ResearchCardPayload` 类型派生(同 storyboard,单一真相源)。

**语义硬约束**:本块**不放任何 coworkGenerate/花钱调用**;"Approve & run" 仅占位(onClick 空或禁用 + tooltip "runs in S3")。money-review 在 S5,但 S2 diff 必须 grep 无花钱原语。

**Steps:** TDD(parse helper)→ 组件 + 接线 → web 全套 + typecheck + **build EXIT 0** → commit `feat(otto): render RESEARCH_CARD approval card in both renderers (\$0, run wired in S3)`。

---

### Task 3: 指令 —— 何时 proposeResearch vs 轮内 researchWeb($0)

**Files:** Modify `packages/otto/src/instructions.ts`(研究一节扩充)+ `instructions.test.ts`。

**语义:** 教 Otto 区分:**轻量、顺手查**(创作前查个趋势/竞品事实)→ 轮内直接 `researchWeb`(query→url→page,已 S1 就位);**用户明确要一份研究/报告、或需要多源深挖** → `proposeResearch`(出审批卡,深度档,**要花 credits,先审批**)。刨根问底门(topic 必需)。诚实:proposeResearch 只出计划卡,真跑在用户批准后(S3);别声称已研究。反引号转义;instructions.test 锚定(proposeResearch + "approve"/"credits" + 与 researchWeb 的区分 token)。

**Steps:** TDD 断言 → prose → otto 全套 + typecheck → commit `feat(otto): instructions route deep research to proposeResearch (approval card, \$0 plan)`。

---

## Self-Review

Spec §3(proposeResearch/RESEARCH_CARD 行)+ §5(深度档)覆盖:tier 集中声明 ✅ T1;审批卡渲染 ✅ T2;指令区分 ✅ T3;真花钱明确留 S3(T2 按钮占位)。类型:`ResearchCardPayload`/`RESEARCH_TIERS` T1 定义、T2/T3 消费;两 enum 值 T1 加、S3 用 RESEARCH_REPORT。Money:$0,proposeResearch free/write/internal,无 GenJob;S2 diff grep 无花钱原语(审批按钮占位)。F4 教训:migration 只 ADD VALUE、持久化用既存值,不同事务。

## 相关文件

蓝本:`packages/otto/src/skills/propose-storyboard.{ts,helpers.ts}` + STORYBOARD_CARD migration + `apps/web/lib/storyboard-card.ts` + `apps/web/components/otto/StoryboardCard.tsx`(F2 只读卡)+ `OttoActionPlanCard.tsx`(审批卡样式)。enum 先例:`20260702000000_storyboard_card`。DTO 联合:`apps/web/lib/{types,dto,otto-ui-messages}.ts`。深度档哲学:视频 `GEN_VIDEO_MODEL_OPTIONS`(gen.ts)。
