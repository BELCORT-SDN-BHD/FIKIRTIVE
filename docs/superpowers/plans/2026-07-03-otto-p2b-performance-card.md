# Otto P2b · metaExpert 诊断 skill + PERFORMANCE_CARD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** 建 `meta-expert` skill —— 读逐条广告真表现(P1a `ctx.metaPerformance`)→ 跑 `diagnosePerformance`(P2a,账户相对 + KB 引用)→ 持久化一张 **PERFORMANCE_CARD**(founder 已批 mockup `~/Desktop/fikirtive-p2b-performance-card-mockup.png`)在聊天流里,把"看数据→分好坏→析原因"变成用户能看的卡。$0 只读诊断(无审批、无 spend)。

**Architecture:** 完全镜像 RESEARCH_CARD 范式:skill 在 execute 里**直接 `prisma.chatMessage.create`** 写卡行(`text:""`,payload 承载诊断),无新 ctx port。**五道缝对同步持久化卡只需动 3 处**:①`ChatMessageKind` 加性 enum migration ②web TS union ③双渲染器(OttoConversation + OttoChatStream);placeholder(=text:"")、history 注入过滤(卡从不进 RunState.history)、流桥 allowlist(同步卡不走 data-tool-propose)**均无需改**。PERFORMANCE_CARD 是**结果卡**(诊断已同步算好),纯展示——无审批/轮询/spend(比 RESEARCH_CARD 简单)。**objective 拿不到**(MetaAdObject 无该字段)→ skill 用 grounded 启发式:`ads 有任一 ROAS 非空 → objective="conversions"`(ROAS 存在即转化目标的真证据),否则 undefined(默认 CTR)。

**Tech Stack:** TS(otto skill + web 卡)· vitest · Prisma(加性 enum,F4 纪律:ADD VALUE 独立,不与 INSERT 同事务)· `.gb`+shadcn · 无新依赖。

## Global Constraints

- **$0 只读,零 spend:** 诊断只读 `ctx.metaPerformance`(P1a,已 $0);写卡=普通 ChatMessage row(镜像 proposeResearch);**money-path 文件零 diff**,无 reserve/settle/generate。
- **反捏造(spec §5,硬):** 卡上一切数字/结论来自 P2a 引擎(账户相对、无外部基准、创意挂 KB 真引用、非创意=data-gap 诚实、ROAS-null 弃权);卡渲染**忠实透传**引擎输出,不新增/篡改任何数字或断言;来源戳 + basis + 诚实页脚常显。
- **宪法 8(卡片五道缝):** 三处齐动(enum/union/双渲染);另三处确认无需改并在 review 复核。
- **宪法 11 UIUX:** 卡过设计审(比对已批 mockup + Otto 卡风格);单一 `.gb`;coral=Otto 身份。
- **租户:** skill 用 `ctx.orgId`/`ctx.threadId`(never 参数);卡 owner-scoped。
- **F4 迁移纪律:** enum ADD VALUE 独立 migration,绝不与 INSERT 同事务。
- **语言:** 卡 UI 英文 sentence case;skill description 英文;本 plan 华语。
- **构建闸:** `pnpm --filter @fikirtive/otto build` + `pnpm --filter @fikirtive/web build` EXIT 0;`pnpm --filter @fikirtive/otto test`(全套,skill 增注册)全绿。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `packages/db/prisma/schema.prisma` | `ChatMessageKind` 加 `PERFORMANCE_CARD` | 改 |
| `packages/db/prisma/migrations/20260703030000_performance_card/migration.sql` | `ALTER TYPE ADD VALUE 'PERFORMANCE_CARD'`(独立)| 建 |
| `packages/otto/src/skills/meta-expert.helpers.ts` | `PerformanceCardPayload` 类型 + `buildPerformanceCardPayload()` 纯工厂 | 建 |
| `packages/otto/src/skills/meta-expert.ts` | `metaExpertSkill`(读 metaPerformance→diagnose→prisma 写卡)| 建 |
| `packages/otto/src/registry.ts` | 注册 metaExpertSkill(22→23)| 改 |
| `packages/otto/src/registry.test.ts` | 期望清单 +meta-expert +计数(22→23)| 改 |
| `packages/otto/src/skills/CATALOG.md` | 重生成 | 改(生成)|
| `apps/web/lib/types.ts` | ChatMessageKind union +`"PERFORMANCE_CARD"` | 改 |
| `apps/web/lib/performance-card.ts` | `parsePerformanceCardPayload()`(client-safe,建 stamp/truncatedNote)| 建 |
| `apps/web/components/otto/PerformanceCard.tsx` | 卡组件(纯展示诊断)| 建 |
| `apps/web/components/otto/OttoConversation.tsx` | MessageRow 加 `PERFORMANCE_CARD` 分支 | 改(一处)|
| `apps/web/components/otto/OttoChatStream.tsx` | 加 `PERFORMANCE_CARD` WidgetRow 分支 | 改(一处)|
| `docs/design-refs/2026-07-03-performance-card-mockup.html` | 已批设计参考 | 建 |

---

### Task 1: enum migration + TS union + payload 工厂/解析(纯,TDD)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`(enum)、`apps/web/lib/types.ts`(union)
- Create: `packages/db/prisma/migrations/20260703030000_performance_card/migration.sql`
- Create: `packages/otto/src/skills/meta-expert.helpers.ts` + `apps/web/lib/performance-card.ts`
- Test: `packages/otto/src/skills/meta-expert.helpers.test.ts` + `apps/web/lib/performance-card.test.ts`

**Interfaces:**
- Consumes: P2a `AdVerdict`/`PerformanceDiagnosis`(`@fikirtive/otto`,已导出);P1b `RANGES`(web,建 stamp)。
- Produces(otto helper):
  - `type PerfCardAd = { adId: string; imageUrl: string | null; isVideo: boolean }`
  - `type PerformanceCardPayload = { datePreset: string; fetchedAt: string; truncated: boolean; metricUsed: string; basis: string; note: string | null; verdicts: AdVerdict[]; ads: PerfCardAd[] }`
  - `function buildPerformanceCardPayload(input: { diagnosis: PerformanceDiagnosis; datePreset: string; fetchedAt: string; truncated: boolean; ads: PerfCardAd[] }): PerformanceCardPayload` —— 纯组装(把引擎输出 + 展示元数据打包)。
- Produces(web parse):
  - `type PerformanceCardView = { stamp: string; basis: string; metricUsed: string; note: string | null; truncatedNote: string | null; winners: PerfRow[]; losers: PerfRow[]; neutral: PerfRow[] }`(`PerfRow` = verdict + creative 合并的展示行)
  - `function parsePerformanceCardPayload(payload: unknown): PerformanceCardView` —— 防御式解析(镜像 `parseResearchCardPayload`):建 `stamp="Meta · "+rangeLabel(datePreset)+" · fetched "+fmtDate(fetchedAt)`(按 `RANGES.preset` 查,复用 P1b 逻辑),`truncatedNote`,按 verdict 分 winners/losers/neutral,ads 按 adId join creative。坏 payload → 空视图不崩。

- [ ] **Step 1: failing tests**(两个 test 文件,断言:工厂透传引擎输出零篡改;解析建 stamp/分组/join creative/坏输入不崩)。参照 P1b `per-ad-view` 的 rangeLabel(按 preset)+ fmtDate(ISO slice,tz-safe)。
- [ ] **Step 2: run → FAIL**(`pnpm --filter @fikirtive/otto exec vitest run src/skills/meta-expert.helpers.test.ts` + `pnpm --filter @fikirtive/web exec vitest run lib/performance-card.test.ts`)。
- [ ] **Step 3: 实现** —— schema enum 加 `PERFORMANCE_CARD`;migration SQL 单行 `ALTER TYPE "ChatMessageKind" ADD VALUE 'PERFORMANCE_CARD';`(独立,F4);types.ts union 追加;两个 helper(工厂纯透传;解析防御式,坏字段回退空)。
- [ ] **Step 4: run → PASS** 两包测试。
- [ ] **Step 5: commit** `feat(otto): P2b — PERFORMANCE_CARD enum/migration + payload factory + parse helper`

---

### Task 2: `meta-expert` skill(读→诊断→写卡)+ 注册 + CATALOG

**Files:**
- Create: `packages/otto/src/skills/meta-expert.ts`
- Modify: `packages/otto/src/registry.ts` + `registry.test.ts` + `CATALOG.md`(生成)
- Test: `packages/otto/src/skills/meta-expert.test.ts`

**Interfaces:**
- Consumes: `ctx.metaPerformance.getAds`(P1a)、`diagnosePerformance`+`META_EXPERTISE_KB`(P0/P2a)、`buildPerformanceCardPayload`(Task 1)、`prisma`(镜像 propose-research 直接 import)、`defineOttoSkill`。
- Produces:
  - `metaExpertSkill = defineOttoSkill({ name:"meta-expert", cost:"free", effect:"write", reach:"internal", description, parameters, execute })` → `needsApproval=false`。
  - `metaExpertInput = z.object({ datePreset: z.enum(["last_7d","last_14d","last_30d","last_90d"]).default("last_30d") })`。
  - `executeMetaExpert(input, runContext)`:①`ctx.metaPerformance` 缺 → `{message: NOT_CONNECTED}`;②`res=getAds(datePreset)`,`"notConnected"|"needsReconnect" in res` → NOT_CONNECTED;③`objective = res.ads.some(a=>a.metrics.purchaseRoas!=null) ? "conversions" : undefined`;④`diag = diagnosePerformance(res.ads.map(a=>({adId:a.adId,adName:a.adName,metrics:a.metrics})), META_EXPERTISE_KB, objective?{objective}:undefined)`;⑤`payload = buildPerformanceCardPayload({diagnosis:diag, datePreset:res.datePreset, fetchedAt:res.fetchedAt, truncated:res.truncated, ads:res.ads.map(a=>({adId:a.adId, imageUrl:a.creative?.imageUrl??null, isVideo:!!a.creative?.videoId}))})`;⑥`prisma.chatMessage.create({data:{ id:newId(), threadId:ctx.threadId, ownerId:ctx.orgId, role:"AGENT", kind:"PERFORMANCE_CARD", seq:max+1, text:"", payload }})`(镜像 propose-research 的 seq 取法);⑦return `{cardId, summary}`(简短 summary 供 Otto 口头引出卡,如"I've laid out which of your ads are winning and which need attention.")。

- [ ] **Step 1: failing test**(mock `ctx.metaPerformance` + `prisma`;断言:free/write/internal→needsApproval=false;notConnected→message;有数据→调 diagnosePerformance + prisma.create 写 kind:"PERFORMANCE_CARD"+text:""、payload.verdicts 来自引擎;ROAS 启发式:有 ROAS→objective conversions)。
- [ ] **Step 2: run → FAIL**
- [ ] **Step 3: 实现** skill(镜像 propose-research.ts 结构 + meta-insights.ts 的 ctx-port 读法)。
- [ ] **Step 4: 注册** registry.ts + 更新 registry.test.ts 期望清单(加 "meta-expert",计数 22→23,标题)+ `pnpm --filter @fikirtive/otto run catalog`。
- [ ] **Step 5: run** `pnpm --filter @fikirtive/otto test`(**全套**,含 registry)全绿 + `pnpm --filter @fikirtive/otto build` + `pnpm --filter @fikirtive/web build` EXIT 0。
- [ ] **Step 6: commit** `feat(otto): meta-expert skill — diagnose per-ad performance → PERFORMANCE_CARD (\$0, KB-grounded)`

---

### Task 3: `PerformanceCard` 组件 + 双渲染器接线

**Files:**
- Create: `apps/web/components/otto/PerformanceCard.tsx`
- Modify: `apps/web/components/otto/OttoConversation.tsx`(MessageRow 一分支)+ `apps/web/components/otto/OttoChatStream.tsx`(一 WidgetRow 分支)

**Interfaces:**
- Consumes: `parsePerformanceCardPayload`(Task 1)。
- Produces: `PerformanceCard({ payload }: { payload: unknown })` 纯展示组件(无审批/轮询)。

- [ ] **Step 1: 实现组件**(忠于已批 mockup:Otto 云头 + 标题 + basis"ranked against your own account average" + 来源戳;Working-well 区=winners(Top performer chip + metric 相对句 + Recreate 按钮**present-inert**,P3 接线);Needs-attention 区=losers(Underperforming chip + 创意 grounded 句 + **KB 引用链接**(reasons.citations[0],`rel="noopener noreferrer"`)+ data-gap 引用块 + Make-fresh/Try-angle 按钮 inert);诚实页脚)。`.gb` token 忠于 mockup + per-ad 面板。
- [ ] **Step 2: 双渲染接线** —— OttoConversation.tsx MessageRow 加 `if (m.kind === "PERFORMANCE_CARD") return <…><OttoAvatar/><PerformanceCard payload={m.payload}/></…>`(镜像 RESEARCH_CARD 分支,:567 邻近);OttoChatStream.tsx 加 `if (kind === "PERFORMANCE_CARD") return <WidgetRow…><PerformanceCard payload={m.metadata?.payload}/></WidgetRow>`(镜像 :886 分支)。
- [ ] **Step 3: build 闸** `pnpm --filter @fikirtive/web build` EXIT 0(client 组件不拖 server-only;只 import parse helper + 类型)。
- [ ] **Step 4: commit** `feat(otto): PerformanceCard component + dual-renderer wiring (5-seam card, design-approved)`

---

### Task 4: 整片 P2b 终审($0 + 反捏造透传 + 五道缝完整 + 设计审)

> orchestrator 派 fresh reviewer + runtime QA 说明(worktree 无 env,live 留合并后,同 P1b)。

- [ ] **Step 1: Money:** 全链 skill 只读 metaPerformance + 写普通 ChatMessage row(镜像 proposeResearch);无 reserve/settle/generate/写端点;money-path 零 diff。
- [ ] **Step 2: 反捏造透传:** 卡渲染的 verdict/metric/reason/citation **逐一来自 P2a 引擎输出**,组件不新增/篡改数字或断言;basis"account average"、来源戳、诚实页脚、data-gap、ROAS-null 都在;引用链接指向 payload 里的真 KB url。
- [ ] **Step 3: 五道缝:** enum 加性 migration(F4 独立)+ TS union + 双渲染器**都在**;确认 placeholder(text:"")、history 注入过滤(卡不进 history)、流桥(meta-expert 不入 CARD_TOOL_NAMES,同步卡)**确无需改**且未误改。
- [ ] **Step 4: 设计审:** 比对已批 mockup(`docs/design-refs/2026-07-03-performance-card-mockup.html`)+ Otto 卡/per-ad 风格;`.gb` 一致;registry 全套绿。
- [ ] **Step 5:** Critical/Important → fix subagent;全清 → P2b done。⚠️ live runtime QA(卡真渲染)留合并后 founder 在 env'd checkout 验(worktree 无 env,同 P1b/#74 前例)。

---

## Self-Review

**1. Spec coverage:** spec §4 P2「metaExpert 诊断 + PERFORMANCE_CARD(五道缝五处齐动)」→ Task 1(enum/union/payload)+ Task 2(skill 读→诊断→写卡)+ Task 3(组件+双渲染)+ Task 4(终审);宪法 8 卡缝、宪法 11 设计审、反捏造透传 → 各 Task。赢家/输家标 + 有据原因 = 引擎(P2a)透传;复刻按钮 present-inert(P3 接线)。✅
**2. Placeholder scan:** 无 TBD;objective 启发式=明示决策(ROAS 存在=转化真证据);五道缝"三改三不改"= 已核实(勘查报告),非偷懒;registry 全套必跑(吸取 P1a 教训)。
**3. Type consistency:** `AdVerdict`/`PerformanceDiagnosis`(P2a)→ `PerformanceCardPayload`(Task1 otto)→ `parsePerformanceCardPayload`→`PerformanceCardView`(Task1 web)→ 组件(Task3);`ctx.metaPerformance.getAds` 返回(P1a)→ skill 消费(Task2);kind `"PERFORMANCE_CARD"` 贯穿 enum/union/skill/双渲染。✅
