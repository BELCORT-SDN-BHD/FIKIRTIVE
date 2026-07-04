# Otto · Block P 设计 —— 运营/优化 = `O-10 效果反哺闭环`(平台专家 · 首发 Meta 专家)

**状态:** 设计与创始人对齐(brainstorm 2026-07-03)+ **已核宪法 v2.3(#109)与 O 区判决卷**。本块 = 宪法点名的 **`O-10 效果反哺闭环`**(判决=**要**,founder"也很重要";建设顺序=**归因/分析先立**)。核宪发现的双模缺口已按 founder 裁定(**方案 A:人工面 + Otto 同建,单一动作层**)整合进本稿。下一步:分块 writing-plans → Opus SDD → money-review。

**语言约定:** spec 华语;知识库正文/引用随源(多为英文);structuredPrompt/卡片 chrome 英文;UI 文案 sentence case(宪法 9)。

**北极星铁律(整块宪法,见 [[grounded-no-fabrication]]):** 一切建议/分析/优化**必须有根据和效果,绝不凭空捏造**。没数据就诚实说没有,不编。

---

## 0. 在 roadmap 的位置 + 蓝图授权

创作篇(#83→#114)+ 研究篇(#118)后的**第四篇 · 运营/优化**第一块。roadmap:创作 ✅ → 搜索/研究 ✅ → 发布/渠道(卡 App Review)→ **运营/优化(本文件)**。

**蓝图授权**:本块 = `O-10 效果反哺闭环`(判决卷 2026-07-03:**要**,founder 升级"也很重要";**"建设顺序仍是归因/分析先立,但判决为要,不是以后"**)。相关判决:`O-07 Otto 绩效面板=要(简版·周报级)`、`G-12 品牌化报告=要(分析区后,Otto 写人话解读)`、`O-04 品牌记忆自养=要`。

**创始人为什么要、要什么形状**(brainstorm 原话):
> 看数据 → 分辨哪个好/哪个坏 → **分析原因**(素材?跑得不够久 / target 错 / budget 不够?)→ 好素材**模仿 recreate 再上**,坏的**换新方向**。

把已建好的**创作链**和 Analytics 接回**闭环**:表现 → 诊断 → 复刻赢家(回 propose/generate)。

---

## 1. 创始人拍板(2026-07-03 brainstorm + 核宪裁定)

1. **切法 = 1+2+3**:①看数据 ②诊断 ③复刻赢家。**不含**第4块(调投放/执行 boost = 写广告,后面做)。
2. **organic 也要**:organic 好也参考 + 建议 boost。App Review **已提交在等**,故「**全部准备好先**」—— 自动读 organic 一起建,**权限门**挡着,审批过 + 商家重连即亮。
3. **不要通用 analyst**:**每平台一个专职专家**(metaExpert 现建;tiktok/shopee 将来各建)。共享管道,专业知识 + 数据适配器每平台专属。
4. **deep research → 真 Meta 专家**:知识源 = **Meta Blueprint 官方认证课纲**(「看有哪些文凭 → 扒各文凭详细学习资料 → 全收 → 变成 meta analyse 的 skill,**也是之后打广告 skill 的基础**」)。做法 = 深研 + 带引用蒸馏。
5. **架构定调**:turn 内同步读(不建后台队列)· 承载面 = **PERFORMANCE_CARD** · **零新钱路**。
6. **【核宪裁定 · 方案 A】双模合规**(founder"和你说的"= 按宪法来不绕人工面):本块**人工面 + Otto 面同建**,走**单一动作层**(逐条读 + 复刻写都是一个 server action,人工按钮和 Otto skill 调同一个)、**读的对等**(逐条表现有人工可见面)、**第九缝 Parity Manifest 登记**。不走豁免、不押他 session 立分析面。**顺序尊重 O-10「分析先立」**:逐条分析面(P1 人工侧)即那个"分析",先立稳,反哺闭环盖其上。

---

## 2. 现状地基(2026-07-03 grounding survey 核实 · 6-agent workflow)

### 2.1 真·可引用(强根据,现成)
- **Meta 广告表现(付费)**:`meta-graph.ts#getAccountInsights` 每回合实时拉(`ctx.metaInsights` 已接)——spend/impressions/reach/frequency/clicks/ctr/cpc/cpm/purchase_roas;逐日序列(`meta-insights.ts#fetchOwnerInsightsSeries`)。**当前只拉账户级**。
- **Meta 广告结构**:`ctx.metaAds.list()`——campaign/adset/ad 的 id/name/effective_status/daily_budget/lifetime_budget/start/stop。**无逐条表现**。
- **Meta 权限真相**:`MetaConnection.scope`(经 debug_token 核**实际** granted)、canWrite/canManagePages/status/adsWritesPaused。已 granted:`ads_read, ads_management, pages_show_list, business_management`。
- **花费账本 + 生成历史**:CreditAccount/CreditLedger、Generation/GenJob(spentUsd 真值),org 可查、逐行不可伪造。
- **引用机制**:研究块 `sourcesRead`→`sources:[{url,title}]` 是唯一已上线「引用防幻觉」路径 —— **P0/P2 引用复用此纪律**。

### 2.2 关键核实:逐条/单帖表现 = 真·可拉,只是未接线
- Graph 是**通用** GET(`metaGraphGet`)。`/insights?level=ad` 得**逐条广告表现**;`creative{image_url,body,title,video_id}` 得**真实素材** —— **都在已 granted 的 `ads_read` 内,不需新 App Review**。当前只做账户级 = **接线缺口,非 Meta 限制**。
- **organic 单帖表现**(IG media / FB page post insights)= 真数据,但需 `instagram_manage_insights` + `pages_read_engagement` → **过 App Review**(与 Analytics「Top Posts」同闸;founder **已提交在等**)。

### 2.3 硬阻塞 / 捏造陷阱
per-post organic(**待 App Review**)· 非 Meta 平台(占位零数据)· purchase_roas 常 null · 超窗口历史趋势 / 审批时数据过期 · 竞品行业均值(无端口,LLM 最爱编)· A/B / 归因 / audience / per-creative(无数据)· gen 质量/SLA 率(schema 不聚合)。

---

## 3. 架构:平台专家 pattern + 双模结构保证(宪法第 7 条)

**不搞通用 analyst。** 每平台 = 专职专家 skill,三样组成:
```
平台专家 = 专业知识库(该平台官方课纲深研蒸馏,带引用)
         + 数据适配器(真表现 + 素材,ctx 端口)
         + 诊断/建议(真数字 ⟂ 引用基准 → 有据结论)
```
共享管道(可复用):PERFORMANCE_CARD 卡体系、复刻单一动作层、专家 skill 骨架、引用纪律。每平台专属:知识库 + 数据端口 + 诊断逻辑。**首发只建 Meta**(唯一有 live 数据);他平台数据源上线后各自建、slot 进同管道。

**双模结构保证(宪法第 7 条,机器/结构强制,不靠自觉)**:
- **单一动作层**:`getAdPerformance`(读)+ `recreateFromWinner`(写)= 各一个 server action;**人工 UI 按钮与 Otto skill 调同一个**(范本 = `generate`→`startGen`←canvas 按钮)。禁两套业务实现。
- **读的对等**:逐条广告表现有**人工可见面**(§4 P1 人工侧),Otto 不做瞎子操作员;反向 Otto 也有对应 read skill。
- **上下文桥**:当前 performance 视图/选中赢家注入每轮对话("复刻这个"里的"这个"可解析)。
- **就地按钮 = Otto 的手(O-12)**:performance 面里的 AI 按钮走同一动作层、同大脑、coral 身份,非第二个匿名 AI。
- **第九缝 Parity Manifest**:新 action(`getAdPerformance`/`recreateFromWinner`)出生即登记 action↔skill 对照(CI 扫描);无登记合并不进去。

---

## 4. 四个子块(一份 spec 锁架构,一次一个 SDD/PR)

> 每子块**人工面 + Otto 面同交付**,共用单一动作层 —— 这是 A 裁定的硬要求,不再"只做 Otto"。

### P0 · Meta 专家知识库(大脑 · 深研蒸馏 · 独立可复用 · 无人工面)
build-time 深研 **Meta Blueprint 认证课纲** → 蒸馏**结构化、带引用**的 Meta 专业知识模块。
- **研究范围**:①Blueprint 有哪些认证(Media Buying/Media Planning/Marketing Science/Creative Strategy/Digital Marketing Associate…)②逐认证的技能域 + **公开**学习/考纲资料(exam study guide、skill domains、Meta Business Help Center、官方 best-practice)。
- **产物**(每条挂 `{url,title,retrievedAt}`):按域组织 —— 竞价/目标/受众/创意 best-practice、**按 objective/行业的基准区间**、算法机制、常见问题→诊断 playbook。
- **形态**:`packages/otto/src/knowledge/meta-expertise.ts` + 源清单;**独立于分析 skill**(也是打广告 skill 地基);可刷新(重跑更新)。
- **build 手段**:builder 用**深研**(free-first:Tavily/Brave 免费档 + 研究块;若需付费深研**先问 founder**,见 [[efficiency-conscience-meaning]])现建,**不从记忆硬写**;蒸馏成事实+引用,**不逐字复制**(版权 + 反漂移)。
- **合宪**:知识冻进确定性数据(**宪法第 10 条:技能为弱模型设计**的范本);**$0 运行时**。

### P1 · 逐条表现:数据端口(Otto)+ 人工明细面(单一 fetch,双消费)
- **单一 fetch**:`getAdPerformance(ownerId, scope)` server action —— `/insights?level=ad`(逐条广告)+ organic(IG media/FB post,**各按真实 granted scope 独立开关**;未 granted → `{status:"pending_permission"}` 哨兵,不报数字)+ 每条 `creative{...}` 真素材。**有界**(top N + 翻页封顶,`metaGraphGetAll`);**截断即在结果里明说**。owner-scoped(requireOwner,**租户铁幕**,不信客户端 org)。
- **Otto 面**:`ctx.metaPerformance` 端口 + `metaAdPerformance` read skill(free/read/external → 不审批)。
- **人工面**:逐条广告表现**明细面**(additive —— **不重写** analytics session 在改的账户级 KPI 组件;新组件/新 section,复用同批 Meta 端口)。**读的对等**由此满足。
- **跨包**:纯逻辑/类型入 `packages/core` 或 web lib;端口经 `buildOttoContext` 注入(镜像 metaInsights/metaAds/research)。

### P2 · metaExpert 诊断 + PERFORMANCE_CARD(人工可见卡 = 共享面)
`metaExpert` skill(`defineOttoSkill{cost:free, effect:write(卡), reach:internal}` → 不审批)。
- 读 P1 真数字 ⟂ P0 知识库**引用基准** → 分**赢家/输家**(指标须**匹配 campaign objective**:转化看 ROAS、引流看 CTR;声明用了哪个指标)。**诊断逻辑确定性**(不让弱模型即兴发挥专家话术,宪法第 10 条)。
- 出 **PERFORMANCE_CARD**:每条标 `来源(Meta level=ad)+周期+抓取时间`;**有据原因分级**(§5);**专家级建议**(挂知识库引用);organic 赢家附「**建议 boost**」标记(推荐可出,**执行留 P4**);**建议按钮引导下一步**(铁律④)。卡是**人工可见面**(人看到诊断、点复刻),= G-12「人话解读」的落地。
- **第八缝(卡片五道缝,五处齐动)**:①`PERFORMANCE_CARD` kind 联合(加性 enum migration,**禁 ADD VALUE + INSERT 同事务**)②占位 ③双渲染器(OttoConversation + OttoChatStream)④注入过滤 ⑤流桥名单。
- **第11条 UIUX**:卡过**设计审**(非只 runtime QA);单一 `.gb`+shadcn;coral 属 Otto;基准 = Analytics 屏。

### P3 · 复刻赢家(单一动作层:人工按钮 + Otto 同调)
`recreateFromWinner(winnerRef)` server action —— **人工按钮**(卡上/明细面)与 **Otto skill** 调**同一个**。
- 取**真实赢家素材**(图+文案当参考)→ 喂进**现成创作链**(seedream/seedance→propose→generate)出新变体。付费赢家、organic 赢家都能复刻。图+文案扎实;**视频受限**(仅缩略图+文案,如实说明)。
- **零新钱路**:走**既有** generate 审批闸(`cowork:<cardId>` 幂等 once-EVER,**money-path 文件零 diff**)。「上」=产出新素材;真投放上线 = P4,本块不含。

---

## 5. 防捏造宪法(写进 skill + instructions + 测试)
1. **每个数字**带 `来源+周期+抓取时间`,否则不准说。
2. **赢家/输家由匹配 objective 的真指标定义**,声明用了哪个指标。
3. **ROAS=null = 该账户没有**,不填 0 不编;缺了弃权。
4. **原因分级**:素材 / 跑太短(`start_time`)/ budget 低(`daily_budget`)= 有真值→可说;**target = 只摆配置当「待验证假设」,绝不断言**;竞品均值 = 知识库有引用才说,否则「没有基准」。
5. **organic 权限门**:scope 未 granted → 返「待权限」,绝不报 organic 数字。**代码就绪 ≠ 数据到位**;上线前明说 organic 活口**未经真 scope 实测**。
6. **知识库反漂移**:每条专家结论挂 `{url,title}`;蒸馏不逐字复制;metaExpert 只用**知识库里有引用的**结论。
7. **硬拦**:A/B、归因、audience/lookalike、per-creative(Meta 未返回)、非 Meta 平台、gen 质量/SLA 率 —— 一律不从别处推。

---

## 6. Money-safety(硬约束,沿创作/研究篇纪律)
- **零新钱原语**,本块**不新建 spend path**:
  - P0 深研 = build-time 一次性,产物静态;运行时 $0。**真实付费深研先问 founder**(宪法 2「问就是上限」)。
  - P1/P2 只读,LLM 推理在**已计量的 Otto turn**(ottoTurn)内。
  - P3 复刻走**既有** generate 闸,幂等 `cowork:<cardId>` once-EVER,**money-path 零 diff**。
- **Graph 只读**:P1 全 GET;不触 write 端点。**Meta"spend" = 商家外部数据(其账户货币),非我方 credits**——不违铁律①(我方 spend 面仍只显 credits)。
- **有界防滥用**:P1 每 turn Graph 调用有上限;不因量大降级/多扣。
- 触及 generate(P3)过 **money-safety-review**;整块整支 review。

---

## 7. 诚实边界(写进 spec + 上线说明)
- **Blueprint 门控内容**:部分课程正文需报名 —— 拿不到;只用**公开官方资料**,知识库注明覆盖边界。
- **版权**:蒸馏成带引用事实/原则,**不逐字复制**、不重建课程。
- **organic 未实测**:无已 granted scope,P1 organic 只能 mock 单测,真 scope 落地前**不宣称可用**。
- **知识库时效**:标 `retrievedAt`,可刷新;用时提示"基于 X 日资料"。
- **视频复刻受限**:仅缩略图+文案。

---

## 8. 宪法合规映射(v2.3 逐条核对)
| 宪法/缝/判决 | 本块如何满足 |
|---|---|
| **第 7 条 双模无例外** | P1/P2/P3 均**人工面 + Otto 面同建**,单一动作层(§3/§4) |
| **第 4 条 审批数学** | metaAdPerformance=free/read/external→不审批;metaExpert=free/write/internal→不审批;recreateFromWinner=既有 generate spend→审批 |
| **第 2 条 钱路神圣** | 零新钱原语;P3 复用既有闸过 money-safety(§6) |
| **第 6 条 租户铁幕** | 全链 requireOwner + ownerId;不信客户端 org(§4 P1) |
| **第 10 条 弱模型** | 专家判断冻进知识库/schema/确定性诊断(§4 P0/P2) |
| **第 11 条 UIUX** | 卡 + 人工面过设计审;单一 .gb;基准=Analytics 屏(§4 P2) |
| **第 9 条 语言** | spec 华语 / prompt 英文 / UI sentence case |
| **第八缝 卡片五道缝** | PERFORMANCE_CARD 五处齐动(§4 P2) |
| **第九缝 Parity Manifest** | getAdPerformance / recreateFromWinner 登记(§3) |
| **O-10 分析先立** | P1 逐条分析面先立,反哺闭环盖其上(§1.6) |

---

## 9. 不撞车(与活跃 Analytics session · A 裁定下的协调)
- Analytics session(#116/#117/#119)拥有**账户级** Analytics 屏(`OttoAnalytics.tsx`、平台切换器、KPI/图、`analytics-view.ts`)。
- 本块人工面 = **逐条广告明细**这一**新层**:新组件/新 section,**additive**,**不编辑**他们在改的账户级组件;复用同批 Meta 端口;需 best-day/delta 就**调**现成 helper 不重实现。
- 单一动作层 + Parity Manifest 保证不出现两套实现。碰 otto-prefill/AnalyticsData 契约先协调。**净:他们建账户级仪表盘,本块加逐条明细 + Otto 反哺,同数据源、加性组件、无重叠重写。**

---

## 10. 分块实现 + 成功判据
| 子块 | 交付 | 成功判据 |
|---|---|---|
| **P0** | Meta 专家知识库(带引用数据模块+源清单) | 覆盖 Blueprint 主认证域;每断言有 `{url,title}`;对抗核实过;单测结构+引用完整;`next build` EXIT 0 |
| **P1** | `getAdPerformance` action + `ctx.metaPerformance` 端口 + `metaAdPerformance` skill + **逐条人工明细面** | 单测:逐条解析、organic 未 granted→待权限、截断明说、素材、owner-scope;人工面 additive 不改账户级组件;Parity 登记;registry/CATALOG 更新;`next build` EXIT 0 |
| **P2** | `metaExpert` skill + `PERFORMANCE_CARD` + 双渲染 + 设计审 | 单测:赢家/输家按 objective、数字带来源、原因分级、ROAS-null 弃权、引用挂载;五道缝齐动;加性 enum migration 独立;设计审证据 |
| **P3** | `recreateFromWinner` action(人工+Otto 同调)→ 创作链 | 单测:赢家素材→propose 入参、图/文案参考、视频受限说明、单一动作层;既有 generate 闸零钱路 diff;money-safety-review 过 |

每子块:fresh subagent 实现 → 逐任务 review → 修 Critical/Important → 整支 review。整块末:whole-block money + 反捏造 + **双模 parity** 终审(创作篇两轮标准)。

---

## 11. 不在本块(明确排除)
- **P4 调投放/执行**:proposeMetaAction 调预算/暂停、**执行 boost**(organic→付费)= 写广告,需 prod 重连 ads_management + money 审。下一块。
- **他平台专家**(TikTok/Shopee/…):无数据源,pattern 就绪后各自建。
- **A/B / 归因 / audience / per-creative / gen-SLA**:无数据,硬拦(§5.7)。
- **打广告 skill 本体**:P0 知识库是其地基,skill 本体不在本块。
- **O-07 绩效周报 / O-04 品牌记忆自养**:相邻但独立判决,不在本块。
