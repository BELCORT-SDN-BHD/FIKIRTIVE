# Otto · Block P 设计 —— 运营/优化(平台专家 · 首发 Meta 专家)

**状态:** 设计与创始人对齐(brainstorm 2026-07-03)。这是 roadmap 第四篇「运营/优化」的第一块。核心 = 把 Otto 从「读数字的通用分析器」升级成「**每个平台各配一个真专家**」,首个专家 = **Meta 专家**,专业知识锚在 **Meta Blueprint 官方认证课纲**上(深研 + 带引用蒸馏)。下一步:分块 writing-plans → Opus SDD → money-review。

**语言约定:** spec 华语;知识库正文/引用随源(多为英文);structuredPrompt/卡片 chrome 英文。

**北极星铁律(整块宪法,见 [[grounded-no-fabrication]]):** 一切建议/分析/优化**必须有根据和效果,绝不凭空捏造**。没数据就诚实说没有,不编。

---

## 0. 在 roadmap 的位置

创作篇(#83→#114)+ 研究篇(#118)收官后的**第四篇 · 运营/优化**第一块。roadmap:创作 ✅ → 搜索/研究 ✅ → 发布/渠道(卡 Meta App Review)→ **运营/优化(本文件)**。

**创始人为什么选这块、要什么形状**(brainstorm 原话提炼):
> 看数据 → 分辨哪个好/哪个坏 → **分析原因**(是素材问题?还是跑得不够久 / target 错 / budget 不够?)→ 好素材就**模仿 recreate 再上**,坏的就**换新方向**。

这把已建好的**创作链**和 Analytics 接回一个**闭环**:表现数据 → 诊断 → 复刻赢家(回到 propose/generate)。

---

## 1. 创始人拍板(2026-07-03 brainstorm)

1. **第一块切法 = 1+2+3**:①看数据 ②诊断 ③复刻赢家。**不含**第4块(调投放/执行 boost = 写广告,后面做)。
2. **organic 也要**:organic 流量好也拿来参考 + 建议 boost 上 ads。App Review **已提交在等**,故「**全部准备好先**」—— 自动读 organic 一起建,用**权限门**挡着,审批过 + 商家重连即亮。
3. **不要一个通用 analyst**:**每个平台一个专职专家**(metaExpert 现建;tiktokExpert/shopeeExpert 将来各建各的)。共享的只是管道,专业知识 + 数据适配器每平台专属。
4. **deep research → 真正的 Meta 专家**:专业知识来源 = **Meta Blueprint 官方认证课纲**——「去看他们有哪些文凭,扒各文凭的详细学习资料,全部收起来,变成 skill for meta analyse(**也是之后打广告 skill 的基础**)」。做法 = 深研 + 带引用蒸馏。
5. **架构定调**(创始人未异议):turn 内同步读(不建后台队列)· 承载面 = 一张 **PERFORMANCE_CARD** · **零新钱路**。

---

## 2. 现状地基(2026-07-03 grounding survey 核实 · 6-agent workflow)

### 2.1 真·可引用(强根据,现成的)
- **Meta 广告表现(付费)**:`apps/web/lib/meta-graph.ts#getAccountInsights` 每回合实时拉(`ctx.metaInsights` 已接线)——spend/impressions/reach/frequency/clicks/ctr/cpc/cpm/purchase_roas。逐日序列(`meta-insights.ts#fetchOwnerInsightsSeries`)。**当前只拉账户级**。
- **Meta 广告结构**:`ctx.metaAds.list()`(`meta-objects.ts`)——campaign/adset/ad 的 id/name/effective_status/daily_budget/lifetime_budget/start_time/stop_time。**无逐条表现**。
- **Meta 权限真相**:`MetaConnection.scope`(经 debug_token 核**实际** granted,不信 requested)、`canWrite`(ads_management)、`canManagePages`、`status`(active/expired)、`adsWritesPaused`。已 granted:`ads_read, ads_management, pages_show_list, business_management`。
- **花费账本 + 生成历史**:CreditAccount/CreditLedger、Generation/GenJob/RefGenJob(spentUsd 真值),按 org 可查、逐行不可伪造。
- **研究引用机制**:研究块 `sourcesRead`→RESEARCH_REPORT `sources:[{url,title}]` 是唯一已上线的「引用防幻觉」路径 —— **P0/P2 的引用直接复用此纪律**。

### 2.2 关键核实:逐条/单帖表现 = 真·可拉,只是未接线
- Graph 接入是**通用**的(`metaGraphGet(token, path, params)`)。同一 `/insights` 端点加 **`level=ad`** 即得**逐条广告表现**;`creative{image_url,body,title,video_id}` 得**真实素材**——**两样都在已 granted 的 `ads_read` 内,不需新 App Review**。当前代码只做账户级,是**接线缺口,非 Meta 限制**。
- **organic 单帖表现**(IG media insights / FB page post insights)= 真数据,但需 `instagram_manage_insights` + `pages_read_engagement` —— **要过 App Review**(与 Analytics「Top Posts」同闸;创始人**已提交在等**)。

### 2.3 硬阻塞 / 捏造陷阱(survey 标注)
per-post organic(**待 App Review**)· 非 Meta 平台(全占位零数据)· purchase_roas 很多账户为 null · 超出已拉窗口的历史趋势 / 审批时数据过期 · 竞品/行业均值(无端口,LLM 最爱编)· A/B / 归因 / audience / per-creative(均无数据)· gen 质量/SLA 率(schema 不聚合)。

---

## 3. 架构:平台专家 pattern

**不搞通用 analyst skill。** 每个平台 = 一个专职专家 skill,由三样组成:

```
平台专家 = 专业知识库(该平台官方课纲深研蒸馏,带引用)
         + 数据适配器(该平台真表现 + 素材,ctx 端口)
         + 诊断/建议(真数字 ⟂ 引用基准 → 有据结论)
```

- **共享管道**(可复用):`PERFORMANCE_CARD` 卡体系、复刻赢家接线(创作链)、专家 skill 骨架(`defineOttoSkill`)、引用纪律。
- **每平台专属**:知识库 + 数据端口 + 诊断逻辑。
- **首发只建 Meta**(唯一有 live 数据的平台)。TikTok/Shopee/Google/WhatsApp 等数据源上线后各自建专家,slot 进同一管道。

---

## 4. 四个子块(一份 spec 锁架构,一次一个 SDD/PR)

### P0 · Meta 专家知识库(大脑 · 深研蒸馏 · 独立可复用)
**做什么**:build-time 深度研究 **Meta Blueprint 认证课纲** → 蒸馏成一份**结构化、带引用**的 Meta 专业知识模块。
- **研究范围**:①Blueprint 有哪些认证(Media Buying / Media Planning / Marketing Science / Creative Strategy / Digital Marketing Associate…)②逐个认证的技能域 + **公开**学习/考纲资料(exam study guide、skill domains、Meta Business Help Center、官方 best-practice 文档)。
- **蒸馏产物**(结构化 · 每条挂 `{url,title,retrievedAt}`):按域组织 —— 竞价/目标/受众/创意 best-practice、**按 objective/行业的基准区间**、算法机制、常见问题→诊断 playbook。
- **形态**:仓库内一个**版本化数据模块**(如 `packages/otto/src/knowledge/meta-expertise.ts` + 源清单),`metaExpert` skill 读它。**独立于分析 skill** —— 也是将来打广告 skill 的地基。
- **build 手段**:我(builder)用**深研**(deep-research skill / Workflow fan-out + 对抗核实)现建,**不从记忆硬写**;蒸馏成事实+引用,**不逐字复制**(版权 + 反漂移)。**可刷新**(重跑更新)。
- **$0 运行时**(build-time 一次性研究,产物是静态数据文件;运行时零研究成本)。

### P1 · metaPerformance 数据端口(眼睛)
**做什么**:新 `ctx.metaPerformance` 端口,turn 内同步、只读、有界。
- **付费逐条**:`/insights?level=ad`(+ ad_id/ad_name)→ 逐条广告真表现;拉每条 `creative{image_url,body,title,video_id}` 真素材。
- **organic 单帖**:IG media / FB page post insights —— **各自按真实 granted scope 独立开关**(`pages_read_engagement` / `instagram_manage_insights`);未 granted → 返回 `{status:"pending_permission"}` 哨兵,**不报数字**。
- **有界**:按花费/时间 top N + 翻页封顶(复用 `metaGraphGetAll` maxPages);**截断即在结果里明说**(不静默丢)。
- **跨包**:纯逻辑/类型入 `packages/core` 或 web lib;端口经 `buildOttoContext` 注入(镜像 metaInsights/metaAds/research 先例)。worker 若需另议(本块运行时在 web turn 内,不必 worker)。

### P2 · metaExpert 诊断 skill + PERFORMANCE_CARD(专家)
**做什么**:`metaExpert` skill(`defineOttoSkill{cost:free, effect:write(卡), reach:internal}` → 不审批)。
- 读 P1 真数字 ⟂ P0 知识库**引用基准** → 分**赢家/输家**(指标须**匹配 campaign objective**:转化看 ROAS、引流看 CTR;Otto **声明用了哪个指标**)。
- 出 **PERFORMANCE_CARD**:每条标 `来源(Meta level=ad)+周期(last_30d)+抓取时间`;**有据的原因分级**(见 §5);**专家级建议**(挂知识库引用);organic 赢家附「**建议 boost**」标记(推荐可出,**执行留 P4**)。
- **新 ChatMessage kind**:`PERFORMANCE_CARD`(加性 enum migration,镜像 STORYBOARD_CARD/RESEARCH_CARD 先例;禁止 ADD VALUE + INSERT 同事务)。

### P3 · 复刻赢家(手 · 复用创作链)
**做什么**:卡上点赢家 → Otto 把**真实赢家素材**(图 + 文案当参考)喂进**现成创作链**(seedreamPrompt/seedancePrompt → propose → generate)出新变体。
- 付费赢家、organic 赢家都能复刻。**图 + 文案**复刻扎实;**视频**复刻受限(仅缩略图 + 文案,如实说明)。
- **零新钱路**:走**已有** generate 审批闸(`cowork:<cardId>` 幂等,once-EVER)。
- 「上」= **产出新素材**;真投放上线 = P4,本块不含。

---

## 5. 防捏造宪法(写进 skill + instructions + 测试)

1. **每个数字**必带 `来源 + 周期 + 抓取时间`,否则不准说。
2. **赢家/输家由匹配 objective 的真指标定义**,Otto 声明用了哪个指标,不含糊。
3. **ROAS=null = 该账户类型没有**,不填 0、不编倍数;缺了**弃权**,不硬给依赖 ROAS 的建议。
4. **原因分级**(核心):
   - 素材 / 跑太短(`start_time`)/ budget 低(`daily_budget`)= **有真值 → 可说**。
   - **target 对不对 = 只摆当前定向配置当「待验证假设」,绝不断言**。
   - 竞品/行业均值 = **知识库有引用才说**,否则「我没有基准」;要具体到本账户就走研究 readSource 真读 + 引用。
5. **organic 权限门**:scope 未 granted → 端口返「待权限」,Otto 绝不报 organic 数字。**代码就绪 ≠ 数据到位**;上线前明说 organic 活口**未经真 scope 实测**(见 §7)。
6. **知识库反漂移**:每条专家结论挂 `{url,title}`;蒸馏不逐字复制;`metaExpert` 只用**知识库里有引用的**结论,不即兴发挥专家话术。
7. **硬拦**:A/B、归因、audience/lookalike、per-creative(若 Meta 未返回)、非 Meta 平台、gen 质量/SLA 率 —— 一律不从别处推。

---

## 6. Money-safety(硬约束,沿创作/研究篇全部纪律)

- **零新钱原语**:本块**不新建任何 spend path**。
  - P0 build-time 深研:一次性开发成本,产物是静态数据;运行时 $0。若用研究块 `proposeResearch` 跑,则走**既有** withLlmBudget 计量,且是 build/一次性,非用户运行时反复扣。
  - P1/P2:只读,LLM 推理在**已计量的 Otto turn**(ottoTurn)内,无独立计量面。
  - P3 复刻:走**既有** generate 审批闸,幂等 `cowork:<cardId>` once-EVER,**money-path 文件零 diff**。
- **Graph 只读**:P1 全 GET(`metaGraphGet`);不触任何 write 端点。
- **有界防滥用**:P1 每 turn Graph 调用有上限;不因量大而降级/多扣。
- 触及 generate 的改动(P3)过 **money-safety-review**(创作篇两轮标准);整块整支 review。

---

## 7. 诚实边界(写进 spec + 上线说明)

- **Blueprint 门控内容**:部分课程正文需报名才看 —— 拿不到。只用**公开官方资料**(考纲/技能域/Help Center/best-practice);知识库注明覆盖边界。
- **版权**:蒸馏成带引用的事实/原则,**不逐字复制** Meta 材料;不重建其课程。
- **organic 未实测**:无已 granted scope,P1 organic 路径**只能 mock 单测**,真 scope 落地前**不宣称可用**(verification-before-completion)。
- **知识库时效**:基准会变;标 `retrievedAt`,可刷新;Otto 用时可提示「基于 X 日资料」。
- **视频复刻受限**:如上,仅缩略图 + 文案。

---

## 8. 不撞车(与活跃 Analytics session)

- Analytics session(#116/#117/#119)拥有 **Analytics 屏幕**(`OttoAnalytics.tsx`、平台切换器、KPI/图、`analytics-view.ts` 展示层)。
- 本块**只建 Otto 技能层**(新 skill + 端口 + 卡 + 知识模块)。**不编辑** `OttoAnalytics.tsx`/`analytics-platforms.ts`/analytics 图表构建器。
- **复用**已接线的 `ctx.metaInsights`/`ctx.metaAds`,不另起并行 analytics fetch;需 best-day/delta 就**调** `analytics-view.ts` 现成 helper(不重实现)。
- 若碰 otto-prefill/AnalyticsData 交接契约,先协调再动。净:analytics 建仪表盘,本块建读同一批 Meta 端口的 agent 专家 —— 不同文件、同数据源、无重叠编辑。

---

## 9. 分块实现 + 成功判据

| 子块 | 交付 | 成功判据 |
|---|---|---|
| **P0** | Meta 专家知识库(带引用数据模块 + 源清单) | 知识库覆盖 Blueprint 主认证域;每条断言有 `{url,title}`;对抗核实通过;单测断言结构 + 引用完整性;`next build` EXIT 0 |
| **P1** | `ctx.metaPerformance` 端口(付费逐条 + organic 权限门 + 素材,有界) | 单测:付费逐条解析、organic 未 granted→待权限哨兵、截断明说、素材拉取;registry/CATALOG 更新;`next build` EXIT 0 |
| **P2** | `metaExpert` skill + `PERFORMANCE_CARD` + 渲染(两 renderer) | 单测:赢家/输家按 objective 指标、数字带来源、原因分级、ROAS-null 弃权、引用挂载;加性 enum migration 独立;instructions 路由测试 |
| **P3** | 复刻赢家(卡→创作链) | 单测:赢家素材→propose 入参、图/文案参考、视频受限说明;走既有 generate 闸零钱路 diff;money-safety-review 通过 |

每子块:fresh subagent 实现 → 逐任务 review(spec+质量)→ 修 Critical/Important → 整支 review。整块末:whole-block money + 反捏造终审(创作篇两轮标准)。

---

## 10. 不在本块(明确排除)

- **P4 调投放 / 执行**:proposeMetaAction 调预算/暂停、**执行 boost**(organic→付费广告)= 写广告,需 prod 重连 ads_management + money 审。**下一块**。
- **其他平台专家**(TikTok/Shopee/Google/WhatsApp):无数据源,pattern 就绪后各自建。
- **A/B / 归因 / audience / per-creative / gen-SLA**:无数据,硬拦(§5.7)。
- **打广告 skill 本体**:P0 知识库是其地基,但 skill 本体不在本块。
