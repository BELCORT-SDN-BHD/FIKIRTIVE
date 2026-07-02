# Otto · Block S 设计 —— 研究/搜索(深度研究报告卡)

**状态:** 设计与创始人对齐(brainstorm 2026-07-03:首用途=深研报告卡、收 credits、provider=免费档可换端口)。方法蓝本 = **Nous Research Hermes Agent 的 web 阅读架构**(2026-06-30 发布:快 60×、省 49×;MIT,借架构)。下一步:分块 writing-plans → Opus SDD → money-review。

**语言约定:** spec 华语;搜索查询/报告正文语言随用户;卡片 chrome 英文。

---

## 0. 在 roadmap 的位置

创作篇(#83→#114)收官后的第二篇。roadmap:创作 ✅ → **搜索/研究(本文件)** → 发布/渠道(卡 Meta App Review)→ 运营/优化。原阻塞「联网搜索缺 API key」由本块解除(创始人注册 Tavily/Brave 免费 key)。

---

## 1. 创始人拍板(2026-07-03 brainstorm)

1. **首用途 = 深度研究报告卡**:用户「帮我研究 X 市场/竞品/趋势」→ Otto 后台跑几分钟 → 结构化报告卡。创作前研究(喂分镜)与品牌自动建脑排后(复用同一批地基)。
2. **收 credits**:「一样扣 credit 就是了」—— 深研任务像 generation 一样走 **提案卡 → 审批 → reserve → 后台执行 → settle 实际** 的既有钱模式。
3. **Provider = 免费方案**:Tavily(主,1000 次/月免费)+ Brave(备,~2000 次/月免费),**可换端口**(零硬编码,同时长 model-driven 哲学);SearXNG 自托管留作规模化逃生舱。创始人提供 key(dev `.env.local` + Railway prod)。
4. **方法 = Nous 三招**:①干净抽取直喂(已有 `fetchAndExtract`);②**页面本地缓存 + 按需分页**(新);③长任务异步、只回摘要(新队列)。越省越好。

---

## 2. 现状地基(2026-07-03 Explore 核实)

- `researchWeb` skill **已注册**(17 skill 之一):`ctx.research.fetchUrl` 半边全通(SSRF 加固、512KB/8s 上限、干净正文);`ctx.research.search?` **端口已声明未接线**(`TODO(G3)` 在 buildOttoContext,apps/web/lib/otto-actions.ts:177-180)。
- 外部**读**不审批(3 字段 gate:free/read/external → ❌),`searchWeb` 本来就是框架 spec 的 worked example。
- `withLlmBudget`(packages/otto/src/meter.ts):LLM 计量 reserve→call→settle(含退款),per-org + per-turn 预算 —— 深研的**扣费引擎直接复用它**。
- 队列:worker 有 6 条(gen/refgen/render/ingest/sweep/caption),**无研究队列** —— S 需新建一条(pg-boss 既有基建)。
- brand-research.ts:onboarding 雏形(抓官网→LLM 抽 facts,不入库)—— 后续块的起点,不在 S v1。

---

## 3. 组件 + gate(3 字段)

| 组件 | 作用 | cost/effect/reach → gate | 花钱? |
|---|---|---|---|
| `ctx.research.search` 接线 + provider 适配器 | Tavily(主)/Brave(备)统一接口:`search(query) → {title, url, snippet}[]`(**只回瘦结果**,Otto 挑着读)| —(端口层)| ❌(免费档) |
| 页面缓存 + 分页(`WebPageCache`)| `fetchUrl` 结果按 URL+hash 缓存(DB 表存干净正文,分页游标);`readPage(url, page?)` 按需翻页 —— Nous 省 49× 的核心 | —(基建)| ❌ |
| `searchWeb` skill(升级现有 researchWeb)| Otto 轮内同步搜+读(轻量研究,创作前顺手查)| free/read/external → 不审批 | ❌(LLM tokens 已随轮计量) |
| `proposeResearch` skill | 刨根问底(requires: goal/topic)后持久化 **RESEARCH_CARD**(研究计划:问题、范围、深度档、预估 credits)| free/write/internal → 不审批 | ❌ $0 |
| 审批 + 执行(server action + **新 research 队列**)| 用户确认 → **reserve 深度档上限** → worker 跑研究循环(搜索→挑页→读缓存页→再搜…→写报告)→ **settle 实际**(withLlmBudget 计量 × margin,≤上限,超则截断收尾)| **spend ⇒ 审批**(用户点确认即审批,同 coworkGenerate 姿势)| ✅ |
| `RESEARCH_REPORT`(卡/报告呈现)| 结构化报告(摘要、发现、来源引用、建议),入聊天流 + 可复用给创作 | —(UI)| ❌ |

**新 ChatMessage kind**:`RESEARCH_CARD` + `RESEARCH_REPORT`(两个加性 enum migration,镜像 STORYBOARD_CARD 先例)。

---

## 4. Money-safety(硬约束,沿创作篇全部纪律)

- **不新建钱原语**:扣费 = 既有 reserve/settle 引擎 + `withLlmBudget` 计量。研究 job 的幂等键 `research:<cardId>` **once-EVER**(镜像 `cowork:<cardId>` 的 GenJob 唯一索引模式;研究卡 1 卡 1 任务,天然一对一,无子卡问题)。
- **上限即闸**:深度档(见 §5)决定 reserve 上限;worker 循环每步计量,**预算耗尽 → 优雅截断**(用已有材料写报告,绝不超扣);settle ≤ reserve,差额退款(引擎既有)。
- **search API 成本**:免费档,$0;端口层做每任务搜索次数上限(按深度档)+ 每 org 日配额(防滥用烧免费额度),超限 fail-closed 报错不降级付费。
- **执行前必审批**:RESEARCH_CARD 显示深度档+预估 credits,用户确认才 reserve(同 generate 的用户点击即审批);不自动触发。
- 全链 SDD + 整支 **money-safety review**(创作篇两轮标准)。

---

## 5. 深度档(定价形状,数值实现时按 meter 定价推导,不拍脑袋)

| 档 | 行为上限(示意) | reserve 形状 |
|---|---|---|
| Quick | ~5 搜索 / ~8 页 / 1 轮综合 | 小额(按 OTTO_DEFAULT_MODEL 计价推导 + margin) |
| Standard(默认) | ~12 搜索 / ~20 页 / 2 轮综合 | 中额 |
| Deep | ~25 搜索 / ~40 页 / 多轮 + 反思 | 大额 |

原则:**报价 = reserve 上限,实扣 = settle 实际**(≤上限);档位参数(搜索/页数/steps 上限)集中一处声明(能力表哲学),UI/校验零硬编码。

---

## 6. 研究循环(worker 内,Nous 姿势)

```
RESEARCH_CARD 审批 → reserve → 入 research 队列
worker:
  规划(goal → 子问题)
  循环(≤档位上限):search(瘦结果) → 挑 URL → readPage(缓存,分页按需)
    → 增量笔记(只留要点,不囤全文 —— 上下文瘦身)
  综合 → RESEARCH_REPORT(结构化 + 来源引用)→ 持久化 + settle
失败/截断:已有材料成报告 + 注明截断;job FAILED → 全额退款(引擎既有)
```

- worker 跑的是**有界工具循环**(只有 search/readPage 两个工具 + withLlmBudget(paid, maxSteps=档位));非交互、无审批中断 —— 简单形态,不复用 @openai/agents 全家桶也可(实现时定,以简为先)。
- 进度:卡片轮询(同 gate① sync 姿势)显示阶段(searching/reading/writing)。

---

## 7. Build 顺序(一次一块,碰钱的靠后)

1. **S1**:search 端口接线(Tavily+Brave 适配器,可换、fallback、配额守卫)+ `WebPageCache` 缓存分页 + `searchWeb` 同步 skill 升级($0;researchWeb 立即变强)。
2. **S2**:`proposeResearch` + RESEARCH_CARD(enum migration ×2 + 渲染,$0;镜像 storyboard F1/F2 节奏)。
3. **S3**:审批→reserve→**research 队列 worker 循环**→settle + REPORT 持久化(**碰钱,money-review 重点**)。
4. **S4**:REPORT 渲染 + 进度轮询 + UI 打磨;指令(何时 proposeResearch vs 轮内 searchWeb)。
5. **S5**:整支 money-safety review(合并前硬门)。

---

## 8. 不在 S v1 / 后续

- 创作前研究自动喂分镜(拿 S1 的 searchWeb 已可轻量做,深度集成排后)。
- 品牌自动建脑(brand-research.ts 升级)。
- SearXNG 自托管逃生舱;x_search(推特情绪,Hermes 有,需 xAI key)。
- 报告导出/分享、定时研究(cron 型)。

## 9. 相关文件

端口:`packages/otto/src/context.ts:80-88`、注入 `apps/web/lib/otto-actions.ts:177-180`;抽取 `apps/web/lib/fetch-extract.ts`;计量 `packages/otto/src/meter.ts`(withLlmBudget);队列 `apps/worker/src/queues.ts`;幂等索引先例 `packages/db/prisma/migrations/20260617000000_*`(cowork once-EVER);卡先例 `propose-storyboard.*` + STORYBOARD_CARD migration。方法来源:github.com/NousResearch/hermes-agent(MIT;web_search+web_extract、缓存分页、异步子代理)。
