# 《愿景融合与 Otto 最优化融合方案》

> 档案截点：2026-07-24  
> 主要读者：Founder Nicks，以及未来每一位 AI / human collaborator  
> 性质：历史综合后的**决策输入**，不是新裁决、不是新路线、不是完成声明  
> 上位依据：live `docs/BLUEPRINT.md`；基础档案：`PROJECT-HISTORY.md`、`FOUNDER-JOURNEY.md`、`BIG-PICTURE-MAP.md`；全量证据：`history-digests/` 18 份 digest

Founder 对本件的原令（2026-07-24，verbatim）：

> 「一定要站在大局观思考。如何尽可能的,把我的vision 最优化,的融合,且otto 也如何最优化的融合。」

## 0. 先给 Nicks 的结论

FIKIRTIVE 现在已经有很多真器官：Canvas、Brand memory、Campaign 地基、Schedule、Meta diagnostics、Contacts、Segments、Inbox、Broadcast、Receipts、Workflows、credits 与治理围栏；但多数器官仍由各自页面、各自对象和各自阶段验收，尚未共同围绕一份 Campaign、一个顾客群、一次批准和一组真实回执工作。（源：`BIG-PICTURE-MAP.md` Part 1；PR #48–#129、#361–#422；commits `0613e961`、`04c006e7`、`44d28497`）

最优融合不是再造第十一个 section，也不是让 Otto 在每页多说几句话。最优形状是：

1. **Campaign 成为业务脊柱**：目标、受众、品牌、内容、渠道、预算、批准、执行、回执、结果都挂在同一 Campaign 上；Campaign 仍是独立对象，不升格成含糊的 Project。（源：`docs/BLUEPRINT.md` §六；`FOUNDER-JOURNEY.md` Part 1 §8 与产品词典「Campaign 对象」）
2. **Otto 成为跨器官操作员**：先理解用户目标，再通过 `defineOttoSkill` 调用与人工按钮相同的 shared action layer（人工与 Otto 共用的动作层）；它不自建旁路，也不预设用户一定是商家。（源：`docs/BLUEPRINT.md` §二第 7 条、§四第 1/9 缝；`FOUNDER-JOURNEY.md` Part 1 §1.5、§2；Founder 2026-07-23 原话见 `transcript-wt-orchestration-50ba3d-current.md`）
3. **Receipt 成为事实脊柱**：内部动作、外部发布、消息送达、回复、订单/付款只读事实与 credits 成本都留下可核对执行回执；没有外部事实就显示 unknown，不用本地成功冒充真实结果。（源：`FOUNDER-JOURNEY.md` Part 1 §4；PR #399–#413；`docs/BLUEPRINT.md` §一四层边界表）
4. **Memory 成为学习脊柱**：品牌修正、受众反应、内容表现和顾客生命周期只形成“建议中的新规则”；涉及品牌事实、顾客处置、花费或外部动作时，仍按各自权限由人确认。（源：`FOUNDER-JOURNEY.md` Part 1 §3、§4；`docs/BLUEPRINT.md` §二第 4、6、7 条）

用一张最小图看，就是：

```text
用户目标
  ↓
Campaign 脊柱（目标 / 受众 / 品牌 / 预算 / 批准）
  ↓
研究 → 创作 → 资产版本 → 排期 / 广告 / CRM 触达
  ↓                                  ↓
外部回执 ← 发布 / 对话 / 回复 / 经营事实只读
  ↓
报告 → Otto 洞察 → 建议更新品牌 / 受众 / 规则 / 下一轮 Campaign
  └──────────────────────────────────────────────↺

全程外围：credits、consent、tenant、approval、idempotency、audit、live reflection
```

本文常用词：**idempotency** 是“同一个动作即使重试也只发生一次”；**reconciliation** 是“拿真实回执核对本地状态”；**attribution** 是“判断结果来自哪次行动”；**lineage** 是“保存一个版本从哪份内容、prompt 或 insight 派生”；**PII** 是个人可识别资料，例如姓名或电话号码；**ROI** 是投入产出；**fail-closed** 是“事实或安全条件不确定时拒绝继续”；**tenant isolation** 是“每位商家的资料绝对隔开”。

这才是“一座城”。如果 Canvas、CRM、Schedule、Reports 各自都很好，但它们不能围绕同一目标互相增强，它们仍然只是并排的好工具。（判断依据：Founder「全部全局观要如何交互，flow要怎样，otto要如何，这些都真的，是我们的护城河」；`transcript-wt-handoff-1ec82f`，2026-07-10 06:43；`FOUNDER-JOURNEY.md` Part 1 §5、§8）

---

# Part 1｜愿景融合：把 sections 变成一个 organism

## 1. 什么叫“融合”，什么不叫

**融合**是前一区的真实产物，自动成为后一区的可靠输入；后一区的真实结果，又能回到前一区改进下一轮。例：一张 nasi lemak 午餐广告不是下载后消失，而是成为 Campaign asset，进入排期，带着同一 tracking identity 发布，收到回执和订单只读事实，再让 Otto 建议下一张图该保留什么、改什么。（提案定义；产品方向依据：`docs/BLUEPRINT.md` §一终局形态、§六对标地图）

**并排**是每一区都有页面和数据，却要老板重复输入目标、重复找素材、重复选顾客、手工解释“这份报告对应哪张广告”。这会违背零学习曲线与“用户带着目标来，不是带着 feature 名来”的方向。（源：`FOUNDER-JOURNEY.md` Part 1 §2.4；`transcript-main-7fcd6fd4.md`，2026-07-09 14:39–14:47）

本文把回路分成三类：

- **已闭合**：指定证据已证明内部动作、状态、失败与回执能走完。
- **部分闭合**：对象或页面已连接，但真实外部效果、反馈回流或 Otto 对等尚未闭合。
- **缺失**：指定证据没有证明存在；不能因为“应该有”就当作已建。

## 2. 今天已经存在、可作为融合地基的回路

| ID | 现有回路 | 今天真实到哪里 | 状态 | 证据 |
|---|---|---|---|---|
| E1 | 商品 / Brand memory → 创作 | Product URL 可用确定性 `$0` 路径预填产品草稿；Brand memory v2、BrandKit/BrandRule、产品分类已能给创作提供上下文。 | 部分闭合；“用户修改→品牌规则自养→生成校验”未闭合。 | PR #52、#103、#113、#124；`BIG-PICTURE-MAP.md` §7 |
| E2 | 意图 → 刨根问底 → prompt mastery → Storyboard → 首帧批准 → 视频 | “做个广告→分镜→看图确认→出片”的创作内环已经有 requires gate、prompt authority、分镜卡、首帧闸与视频闸。 | 当前最完整的产品内工作回路；仍缺五关质量的重复性证据。 | PR #83、#91、#99、#111、#114；`issues-91-180.md` §②；`docs/BLUEPRINT.md` §六 |
| E3 | 创作资产 → Library / My Stuff → Schedule draft | 已付费媒体可以在 Schedule Composer 复用，Otto `schedulePosts` 只起草 DRAFT；Schedule 与 Otto 曾被强制收口到同一 service authority。 | 部分闭合；Reminder-assisted 最新完整走查与真实 Direct publish 未获证明。 | PR #123、#129；`issues-91-180.md` §③、§⑥；`BIG-PICTURE-MAP.md` §5 |
| E4 | Meta 数据 → per-ad 表现 → Otto 诊断 | Meta account / ad 数据可读，Otto 用账户自身历史均值判断赢家/输家，附 source、period、fetch time。 | 读与解释闭合；“诊断→重造→发布→再测”未接。 | PR #116、#117、#128；`issues-91-180.md` §②、§④ |
| E5 | Consent / Contacts → Segments → Broadcast eligibility → 模拟执行 | Consent ledger、Contacts、Dynamic Segments、四轴 eligibility、Broadcast workbench 已进入 `main`。 | 内部规则部分闭合；provider 模拟、`SEND_PATH_UNAVAILABLE`，真触达与回复回流未闭合。 | PR #361–#394；commits `83946443`、`04c006e7`、`29d01de1`；`BIG-PICTURE-MAP.md` §4 |
| E6 | Message state → Receipt / reconciliation → honest-unknown report | C6 已有 delivery event/state、reconciliation engine 与 honest-unknown UI，不把模拟状态冒充 provider 回执。 | 内部诚实回路已建；真实 provider receipt 与 attribution 未闭合。 | PR #399–#413；commits `9dcf8078`、`f2adffac`；issue #405 |
| E7 | Rule draft → simulation → monitor / kill switch | C7 有七类 carrier、声明式规则引擎、模拟执行、journey monitor、UI 与 Otto read/draft skills。 | 部分闭合；activation、reauthorize 与真实 action 仍有 parity 债。 | PR #415、#418、#420、#422；commit `44d28497`；issue #359；`transcript-wt-orchestration-07ae75.md` |
| E8 | 批准 → reserve → provider → settle / refund → 消费记录 | 生成与 Otto turn 的钱路有 ledger、幂等、fail-closed 与失败退款；#430 还证明 UI 误报时 server 仍 zero-charge。 | 安全回路高度闭合；#453 仍有 charged error typing 缺口。 | PR #24、#66、#131、#449；issues #430、#453；`docs/BLUEPRINT.md` §二第 2–5 条 |
| E9 | 人工 action ↔ Otto skill ↔ UI live reflection | `defineOttoSkill`、shared action layer、Parity Manifest hard gate、上下文桥与 live reflection 已成为结构法。 | 平台级骨架存在；不是每一区都已偿还 parity debt。 | PR #28、#131、#180、#192；`docs/BLUEPRINT.md` §二第 7/11 条、§四 |
| E10 | Campaign base → cost / spend confirmation | C2a zero-spend base 与 C2b spend-confirmation 已建，确认页后来补了余额与真实失败理由。 | 只闭合“建立/确认地基”；没有证据证明它已统领创作、排期、CRM、回执和归因。 | commit `0613e961`；PR #398、#449；`BIG-PICTURE-MAP.md` §3 |

结论：FIKIRTIVE 不是从零开始融合。它已经有动作层、钱路、Consent、Receipt、Campaign object 和几条内部链；真正欠缺的是**让这些链共享同一个业务身份，并让结果返回上游**。（分析依据：E1–E10；`docs/BLUEPRINT.md` §一终局形态）

## 3. 缺失的跨区强化回路

下表中的 nasi lemak 档主只是帮助 Nicks 看见实际效果的例子，不是把 Otto 写死成商家 persona；Otto runtime 仍须先理解当前用户与 context，不能先假定对方是谁。（原则源：Founder 2026-07-23 原话；`FOUNDER-JOURNEY.md` Part 1 §1.5、R3）

### 3.1 Connect phase 之前就能闭合的回路

| ID | 缺失回路与缺失证据 | 融合后给档主什么 | 最小可行融合步 | 服务的 Founder 主题 |
|---|---|---|---|---|
| M1 | **Campaign 脊柱**：Campaign、Canvas、Schedule、CRM、Analytics 各有主体，但没有证据证明同一 `campaignId` / 版本贯穿研究→内容→受众→排期→回执→归因。（源：`BIG-PICTURE-MAP.md` §3；`docs/BLUEPRINT.md` §六） | 档主只说“下周午餐要多卖 30 份”，以后每张图、每组顾客、每次批准和每份报告都自动归到这一目标，不再重复解释。 | 先不碰外部连接：建立一份 versioned Campaign Brief，给 Canvas asset、Schedule draft、Segment selection、cost quote 全部挂同一 campaign / objective / audience snapshot。 | 「全部全局观要如何交互」与“不要半桶水”（`FOUNDER-JOURNEY.md` Part 1 §5、§8） |
| M2 | **品牌修正学习环**：Brand memory / BrandRule 已建，但 O-04 自养与 C-08 生成校验仍列待建。（源：`docs/BLUEPRINT.md` §三、§六；`BIG-PICTURE-MAP.md` B5） | 档主说“我的 sambal 要像家里煮的，不要 luxury look”，确认一次后，下一批图和文案都遵守；Otto 不会静默改掉品牌事实。 | 每次用户偏好修改先生成 `BrandRuleCandidate` 提案；用户确认后版本化，生成前检查 context、生成后出 brand-check receipt。 | 实力是信任引擎、商家数据权利、不监守自盗（`FOUNDER-JOURNEY.md` Part 1 §2.4、§3、§7） |
| M3 | **CRM audience → 创作**：Contacts / Segments 与 Canvas 都已建，但没有证据证明一个 Segment snapshot 能进入 Campaign Brief 与 prompt context。（源：PR #361–#366；commit `04c006e7`；issue #437） | 同一个午餐优惠可以对“Dormant office customers”和“VIP family buyers”生成不同 angle，而不是一张图发给所有人。 | 在 tags/custom-fields station 定义 audience snapshot contract；#437 只读取明确选择的 snapshot，生成 channel / audience-aware prompt，不把 customer PII 塞进 provider prompt。 | 开放式 Otto、商家数据权利、品类一流五关（`FOUNDER-JOURNEY.md` Part 1 §1.5、§3、§4.4） |
| M4 | **内容复用 / 适配环**：Assets 与 Schedule 可复用媒体，但没有证据证明 master creative 能保留 lineage 并自动派生不同 channel / ratio / copy 版本。（源：PR #123/#129；Grok parity 余项见 `docs-doctrine.md`） | 档主批准一张主视觉后，Otto 可提案 IG 4:5、Story 9:16、WhatsApp 文案和 reminder 版，不必重做四次。 | 给每个派生 asset 保存 parent asset、Campaign、channel spec、prompt version 与 approval state；所有派生花费先合并报价。 | 效率良心、Grok 的 direct/contextual/continuous 手感（`FOUNDER-JOURNEY.md` Part 1 §5.2、§9） |
| M5 | **Research 人工/Otto 对等环**：Otto 有 `researchWeb` / `proposeResearch`，但指定证据没有完整人工 research workspace；这与人工面无例外存在张力。（源：PR #118；`BIG-PICTURE-MAP.md` A3；`docs/BLUEPRINT.md` §二第 7 条） | 档主可以让 Otto 查 Bangsar 午餐趋势，也能亲手查看来源、改 brief、排除错误资料、保存结论。 | 先做 read-first Research Brief / Sources / Findings 人工面；Otto 与人写同一对象，结论必须带 source 与时间。 | 双 100%、有根据不捏造（`FOUNDER-JOURNEY.md` Part 1 §2、§4.2） |
| M6 | **跨区 context / history 环**：上下文桥已入宪，但指定证据没有证明 Campaign、Canvas selection、Schedule、Contact、Report 在跨页后仍保留同一任务上下文。（源：`docs/BLUEPRINT.md` §二第 7 条；Founder 曾认为 History/Project 方案“不是最佳解答”，见 `transcript-main-7fcd6fd4.md` 2026-07-09 05:41–05:51） | 档主从报告点“改进这张”回 Canvas 时，Otto 知道“这张”是哪一版、属于哪个 Campaign、面对哪一群顾客。 | 建一个只存引用的 `WorkContext`：campaign、selected asset version、audience snapshot、channel、source insight；所有 section 与 Otto turn 共用。 | 零学习曲线、live reflection、一个 ecosystem（`FOUNDER-JOURNEY.md` Part 1 §2.3–2.4、§8.2） |
| M7 | **成本 → Campaign 预算 / 结果环（内部半环）**：credits 消费可查，但没有证据证明 cost 能按 Campaign、asset version、channel 与 outcome 聚合。（源：PR #131；`BIG-PICTURE-MAP.md` §8） | 档主看到的不是“花了 14 credits”，而是“午餐 Campaign 花了 42 credits；哪些资产已生成、哪些待发布”；外部 ROI 未接前仍诚实写 unknown。 | 所有 spend ledger entry 增加可审计的业务引用，不改价格逻辑；Campaign cost report 只汇总已发生成本，不伪造收入。 | 计费透明、效率良心、诚实未知（`FOUNDER-JOURNEY.md` Part 1 §4、§9） |
| M8 | **Workflow 提案 → 模拟 → 人类授权环**：C7 能读/草拟/模拟，但 activate / kill / reauthorize 等 skill parity 债仍在 #359。（源：issue #359；PR #422；commit `44d28497`） | 档主说“每周五准备下周菜单内容”，Otto 先展示会做什么、最多花多少、影响哪些渠道；老板批准后才激活。 | 先明确哪些是 Otto 可调用的 shared action、哪些是 human-only authorization event；每次 activation 生成 scope / budget / fingerprint / simulation receipt。 | 信任阶梯、一个 request 一次批准、composability（`FOUNDER-JOURNEY.md` Part 1 §2.5；R10、R17） |

### 3.2 必须等 connect phase 或真实外部事实的回路

| ID | 缺失回路与阻塞证据 | 融合后给档主什么 | 最小可行融合步 | 服务的 Founder 主题 |
|---|---|---|---|---|
| M9 | **Schedule → 真实发布 → receipt → reconciliation**：Schedule / PublishAttempt 与 L1 基地已建，但 Direct publish 仍受 channel permissions / App Review；Reminder-assisted 最新完整实证也未在 digest 中闭合。（源：PR #123/#129/#215–#231；`BIG-PICTURE-MAP.md` §5） | 档主不再问“到底发了吗”；系统明确显示 prepared、reminded、published、failed 或 unknown，并能重试而不双发。 | Connect 前先完成 Reminder-assisted 真实走查；Connect 后逐个 channel×post type 点亮 adapter，使用幂等 execution 与 opaque receiptRef。 | 诚实、exactly-once、三支柱发布门（`FOUNDER-JOURNEY.md` Part 1 §4、§8.5） |
| M10 | **Inbox → Contact / Consent → Segment → reply / Lifecycle**：C4–C7 carriers 已建，但 Meta Embedded Signup 真连接与真实收发未获证明；Gupshup 已被 #301 supersede。（源：issue #301；#359 item 29；PR #368–#422） | 新 WhatsApp 询价自动成为联系人，STOP 立即挡住，未回复进入 Needs reply，成交或沉默再更新 lifecycle；号码与数据仍属于商家。 | 以 #301 / #359 item 29 完成 merchant self-connect；先证明一条 inbound、一个 consent event、一次 human reply、一个 receipt，再扩自动化。 | 商家数据权利、WhatsApp-first、真闭环（`FOUNDER-JOURNEY.md` Part 1 §3.3、§8.5） |
| M11 | **Segment → Broadcast → reply → next-best action**：eligibility 与 workbench 只有 simulated provider；真实 reply 回流和 Otto auto-reply 被放到 connect phase。（源：PR #382–#394；Founder 2026-07-23 四项裁决见 `issues-271-360.md`） | 档主选择“90 天没回来但没有 STOP 的顾客”，批准一次促销，看到发送、回复、拒发和下一步，不误触不该联系的人。 | 真连接后先做小批次、正向批准、四轴 eligibility、receipt/reconcile；Otto 只草拟回复，自动回复另走 Founder 已定的 connect-phase gate。 | 合法唤回、一个 request 一次批准、商家数据权利（`FOUNDER-JOURNEY.md` Part 1 §3、§8.5） |
| M12 | **真实结果 → Attribution → Insight → 重造**：Meta diagnosis 已可信，但 O-10 remake wiring 与 E5 attribution 在 #359；回复率方法也在 #405 §14。（源：PR #128；issue #359；issue #405 §14） | 档主看到“办公午餐视频带来最多 WhatsApp 询问”，点一次让 Otto 保留 hook、换 offer，再排下一轮；没有对照就只说相关，不说增量。 | 把 insight 绑定 source asset / Campaign / time window；“Recreate”先生成变体提案与 cost quote，批准后才 `generate`，再挂回新 asset version。 | 有根据不捏造、洞察反哺、品类一流（`FOUNDER-JOURNEY.md` Part 1 §4.2、§5、`BIG-PICTURE-MAP.md` B4） |
| M13 | **经营事实只读 → Campaign ROI → 下一轮预算**：Blueprint 允许读取订单/付款/退款等事实，但当前 connector 与 E5 attribution 未闭合。（源：`docs/BLUEPRINT.md` §一四层边界表；issue #359；`BIG-PICTURE-MAP.md` §6） | 档主能看到“这个 Campaign 花了多少、带来多少可核对订单”，而 FIKIRTIVE 不碰商家的钱、不自建订单账本。 | Connect phase 只接 read-only facts，保存 source / fetchedAt / opaque ref；匹配规则不确定时显示 unattributed，不自动宣称因果。 | 四层责任边界、诚实未知、商家数据权利（`FOUNDER-JOURNEY.md` Part 1 §1.4、§3、§4） |
| M14 | **趋势 → Campaign → 创作 → 发布 → pattern library**：#379 数据端口、#380 搜索/趋势、#397 趋势响应式内容均延后，且有 spend / originality / platform relationship gate。（源：issues #379、#380、#397；#359；`issues-361-453.md`） | 档主可以说“看看 KL 最近什么早餐内容在起量，做成我的版本”，但系统保留原创线，不复制别人。 | 到首个消费 skill 排期时才执行 #379/#380；先输出有来源的 research brief，#397 必须经过既有 gut-check 和原创约束再接创作。 | 借鉴先行、不捏造、开放式 Otto（`FOUNDER-JOURNEY.md` Part 1 §1.5、§4.2、§5.5） |
| M15 | **顾客回复 → FAQ / offer / content learning**：Inbox、Brand memory 与 Canvas 都存在，但指定证据没有证明高频售前问题能回流为经商家确认的品牌/商品知识与创作题材。（源：PR #103、#368–#381；`docs/BLUEPRINT.md` §一售前本体边界） | 十个人都问“有 vegetarian sambal 吗”，Otto 建议新增 FAQ、商品字段或一条解释内容；档主确认后才成为正式事实。 | Connect 后做 aggregate insight，不把单一顾客内容直接写入 Brand memory；每条知识变化都经过商家确认与版本留痕。 | 商家数据权利、品牌自养、实力是信任引擎（`FOUNDER-JOURNEY.md` Part 1 §2.4、§3） |
| M16 | **请评 → 推荐 → 复购 → CRM**：B8 有口碑/推荐设计，Blueprint 要请评、推荐、复购与唤回；但指定证据没有真实 build 闭环，请评与奖励还必须永久分线。（源：PR #212；B8 docs 索引见 `docs-doctrine.md`；`docs/BLUEPRINT.md` §一、§六） | 吃完的顾客可收到合法请评；推荐和奖励各自独立；好评、推荐和再次购买成为 lifecycle 信号，而不是孤立活动。 | Connect 后先做两条独立 workflow：请评不附奖励；推荐奖励不以评价为条件；每条都过 consent、eligibility、receipt。 | 请评与奖励永久分离、合法复购、Customer Engagement 完整度（`FOUNDER-JOURNEY.md` Part 1 §10、产品词典 D） |

## 4. 当前最明显的「并排放着，而不是融合着」

| 并排点 | 为什么现在仍算并排 | 最小融合方向 |
|---|---|---|
| Campaign 与 Canvas | Campaign base / spend confirm 已建，Canvas 也能生成，但没有证据证明一个 Campaign Brief 统领每个 asset version。（源：commit `0613e961`；PR #48–#114；`BIG-PICTURE-MAP.md` §3） | 先统一 Campaign Brief、asset lineage、approval fingerprint。 |
| Campaign 与 CRM | Campaign 与 Contacts/Segments/Broadcast 各自存在，tags/custom fields 又是上线前缺口。（源：issue #359；Founder 2026-07-23 裁决） | Audience snapshot 成为 Campaign 的版本化输入。 |
| Campaign 与 Schedule | Schedule 能选媒体、起草 DRAFT，但未证明 draft 自动承接 Campaign objective、audience、version 与总价。（源：PR #123/#129） | Schedule item 必须引用 Campaign + approved asset version。 |
| Campaign 与 Reports | C6 report、Meta diagnostics 与 Campaign 还没有一条共同 attribution spine。（源：PR #128、#399–#413；issue #359） | Receipt / insight 一律回挂 Campaign 与 execution。 |
| Brand memory 与用户批改 | Brand memory 已是资料库，但改图/改文案后的偏好不会自动形成可确认的 BrandRule candidate。（源：`docs/BLUEPRINT.md` O-04/C-08；`BIG-PICTURE-MAP.md` B5） | “修改”与“记住”分开；后者明确确认、版本化。 |
| Analytics 与 Creation | 诊断卡知道哪支广告差，但 Recreate / Try angle 没接真实生成。（源：PR #128；`issues-91-180.md` §⑥） | Insight → remake proposal → cost approval → child asset。 |
| Schedule 与 Publish | 工作台和 PublishAttempt 在，真实 channel effect 与 receipt 不在同一已验链。（源：`BIG-PICTURE-MAP.md` §5） | Reminder-assisted 先验真；Direct publish 逐格通电。 |
| CRM C1–C7 与真实顾客渠道 | 六大件的形已齐，provider 大量模拟，Meta self-connect / production apply 未获证明。（源：#359 item 12/29；`BIG-PICTURE-MAP.md` §4） | 先用一位 merchant、一条号码、一条 inbound/outbound 证明真闭环。 |
| Workflows 与真实动作 | 规则、模拟、monitor 在；activation / reauthorization parity 与真 action 断开。（源：PR #420/#422；issue #359） | 人类授权事件与 Otto shared action 的边界一次定清。 |
| Credits 与经营结果 | 消费记录知道花了多少，不知道这笔成本属于哪个 Campaign / asset / outcome。（源：PR #131；`BIG-PICTURE-MAP.md` §8） | Ledger entry 挂业务引用；外部 ROI 不可得时写 unknown。 |
| Otto 的零散 skills 与“一个员工做到底” | Otto 已有许多局部 skills，但 Campaign、CRM 真渠道、发布、回执、归因、C7 activation 未形成一个可审计 run。（源：`BIG-PICTURE-MAP.md` §1） | 不是造 mega-skill；用一个 run plan 编排多个小 skill，共享 Campaign context 与 audit envelope。 |

---

# Part 2｜Otto 最优化融合

## 5. 双 100% 评分方法

“双 100%”不是说每个入口都必须由 Otto 代替人，而是：**凡是 FIKIRTIVE 能做的经营动作，人类界面与 Otto 都应有符合各自职责的完整路径；两边调用同一 shared action layer，看到同一状态，遵守同一门禁。** Admin、充值/订阅等 money-in、账户安全和纯视觉微操作属于已明文例外，Otto 不代做反而是正确。（源：`docs/BLUEPRINT.md` §二第 7 条、§四、§七）

本文用以下四档描述 Otto **今天已获证据证明的能力**，不是给团队打分：

- **Operator（3）**：能经 `defineOttoSkill` 调用 shared action，完成该区当前允许的完整内部动作；需要批准时停下来等人，动作、失败与结果可追。
- **Advisor（2）**：能读取、解释或起草，但不能完成最终动作，或最终动作本来就被 connect / 权限 / 人类批准挡住。
- **Bystander（1）**：Otto 在附近有上下文或零散能力，但指定证据没有证明它能对该区的核心对象采取有效行动。
- **Absent（0）**：指定证据没有证明该区存在 Otto skill。若该区依法是 human-only，则标为“正确缺席”，不算产品债。

“3”也不等于终局 100%。例如 Otto 能在 Canvas 内完成生成，不代表它已能把同一 Campaign 一路带到顾客回复与收入事实。终局只在**人工面、Otto 面、真实外部效果、receipt/reconcile 四者都成立**时才算 100%。（原则源：`docs/BLUEPRINT.md` §二第 4/7/11 条；`FOUNDER-JOURNEY.md` Part 1 §2）

## 6. Otto 今日逐区盘点

| Section / 经营职责 | 人工面今天 | Otto 今天 | Otto 档位 | 为什么不是更高 | 证据 |
|---|---|---|---:|---|---|
| Research / 市场研究 | 没有证据证明完整人工 Research workspace | 可 `researchWeb`、`proposeResearch`，能给来源式研究输入 | **Operator（局部）3** | Otto 先于人工面，违反“人工与 Otto 都完整”的终局；研究结论也尚未成为 Campaign versioned input | PR #118；`BIG-PICTURE-MAP.md` A3；`docs/BLUEPRINT.md` §二第 7 条 |
| Canvas / 创作 | 从 requirement、prompt、storyboard、首帧到 video 的内部链较强 | 有生成、编辑、storyboard、video 等创作 skill，并走同一动作/钱路 | **Operator 3** | 尚缺 Grok-parity 五关的重复性质量证据，也未证明结果贯穿 Campaign→真实发布→结果回流 | PR #48–#114、#129；`docs/BLUEPRINT.md` §六；`docs-doctrine.md` |
| Assets / Brand / Product memory | Brand memory v2、Library、BrandKit/Rule、商品预填存在 | 能取得/使用资料并帮助创作；未证明能把用户批改安全地变成确认后的长期规则 | **Advisor 2** | O-04 自养与 C-08 生成校验仍待建；不能静默“记住”商家偏好 | PR #52、#103、#113、#124；`docs/BLUEPRINT.md` §三、§六 |
| Campaign | C2a base 与 C2b spend-confirmation 已建 | 指定证据没有端到端 Campaign captain skill | **Bystander 1** | 没有一条 Otto run 把 objective、research、assets、audience、schedule、cost、receipt 串成同一 Campaign | commit `0613e961`；PR #398、#449；`BIG-PICTURE-MAP.md` §3 |
| Schedule | 人工可用 Schedule Composer；媒体可复用 | `schedulePosts` 只建立 DRAFT | **Advisor 2** | Reminder-assisted 最新完整实证与 Direct publish 均未闭合 | PR #123、#129；`BIG-PICTURE-MAP.md` §5 |
| Direct publish | L1 / PublishAttempt 地基存在；真实能力按 channel×post type 受权限约束 | 指定证据没有可用的真实发布 operator | **Absent / connect-blocked 0** | 未获得真实 channel effect 与 opaque provider receipt 前，不能称为 operator | PR #215–#231；`docs/BLUEPRINT.md` §六 |
| Ads | 人工可读 Meta account / ads；write/build path dormant | 能诊断、起草，广告写操作未开放 | **Advisor 2** | 读与解释有证据，真实 write/launch 受权限、connect 与 spend gate 阻塞 | PR #64、#65、#116、#117、#128；`BIG-PICTURE-MAP.md` §6 |
| Analytics / Insights | 有 Meta diagnostics 与 C6 报告表面 | 能解释 Meta 表现并附 source / period / fetchedAt | **Advisor 2** | O-10 remake 与 E5 attribution 未接，不能从 insight 做到可追的下一轮 | PR #116、#117、#128；issues #359、#405 |
| Contacts / Consent | Contacts、Consent ledger、lifecycle groundwork 已建 | 指定证据没有 Contact / Consent 核心 Otto skill | **Absent 0** | 无法证明 Otto 能通过 shared action 查人、解释联系资格或提案更新 | PR #361–#366；`BIG-PICTURE-MAP.md` §4 |
| Tags / Custom fields / Segments | Dynamic Segments 已有；tags/custom fields 是上线前待办 | 指定证据没有完整 Otto audience operator | **Bystander 1** | Segment carrier 存在，不等于 Otto 已能安全组合、预览、版本化 audience snapshot | commit `04c006e7`；issue #359；Founder 2026-07-23 裁决见 `FOUNDER-JOURNEY.md` |
| Inbox / Needs reply | 内部 workbench / state 已建，真实渠道未通 | 指定证据没有真实 inbox/reply Otto skill；auto-reply 被明确放到 connect phase | **Absent / connect-blocked 0** | 没有真实 inbound/outbound、consent 与 receipt 闭环 | PR #368–#381；issue #301；Founder 2026-07-23 裁决见 `issues-271-360.md` |
| Broadcast | 人工可准备、预览 eligibility 与模拟执行 | 指定证据没有真实 Broadcast operator | **Absent / connect-blocked 0** | provider 是模拟，`SEND_PATH_UNAVAILABLE`；不能把准备好说成已发送 | PR #382–#394；commit `29d01de1` |
| Receipts / Reports | delivery state、reconciliation、honest-unknown UI 已建 | Otto 没有获证据证明能按 Campaign 对账、解释 unknown 并启动安全补救 | **Bystander 1** | 内部 receipt spine 有了，但真实 provider receipt、attribution、next action 未闭合 | PR #399–#413；issue #405；`BIG-PICTURE-MAP.md` §4 |
| Workflows / Routines | Rule Builder、simulation、monitor、kill switch 等表面已建 | 有 read/draft 类 skills | **Advisor 2** | activate、kill、reauthorize 与真实 action 的 parity / authorization 仍列 #359 | PR #415、#418、#420、#422；commit `44d28497`；issue #359 |
| Reviews / Referrals / Repeat | 有 B8 设计与宪法方向，未证明完整 build | 指定证据没有 Otto skill | **Absent 0** | 请评、推荐、奖励、复购必须先有分线 workflow 与真实 CRM / channel effect | PR #212；`docs-doctrine.md`；`docs/BLUEPRINT.md` §一、§六 |
| Commerce facts / Attribution | Blueprint 只允许 read-only 经营事实；当前未证明 connector 闭合 | 指定证据没有可用 Otto operator | **Absent / connect-blocked 0** | 订单、付款、退款事实与 Campaign attribution 尚未接；不能捏造 ROI | `docs/BLUEPRINT.md` §一四层边界表；issues #359、#405 |
| Billing / Credits 解释 | 人工可充值、订阅、看余额/消费；生成钱路 fail-closed | Otto 有 turn/生成花费的安全底层，但没有证据证明完整账单解释 skill；不得代做 money-in | **Bystander 1；money-in 正确缺席** | 最优上限是解释与导航，充值/订阅确认永远 human-only | PR #131、#449；`docs/BLUEPRINT.md` §二、§七 |
| Account security / Admin | 人工或 staff-only | Otto 不代做 | **正确缺席** | 宪法明文例外，不应为追数字而补 skill | `docs/BLUEPRINT.md` §二第 7 条、§四、§七 |

最弱、且最影响整体价值的不是 Canvas，而是 **Campaign、CRM 真触达、Receipts/Reports 的行动化、跨区 context**。创作今天像一台强发动机，但 transmission（把动力传到整台车的传动系统）还没有完整接到客户与结果。（综合依据：上表；`BIG-PICTURE-MAP.md` §1、§3–§6）

## 7. Otto 的统一最优执行形态

### 7.1 不造 mega-skill，造一个可审计 run

最优 Otto 不是一支无所不能、内部不可见的“大 skill”。它应把一个自然语言目标拆成多个小而明确的 `defineOttoSkill`，每支 skill 只能调用 shared action layer；一个 run 共享同一 Campaign 与 `WorkContext`。（提案；结构依据：`docs/BLUEPRINT.md` §二第 7/11 条、§四）

每个 run 的固定 audit envelope（审计信封：把“谁、为何、批准了什么、实际发生什么”装在一起）建议包含：

1. **Intent**：商家原话、当前 section、selected object、Campaign objective；不从行业或名字猜 persona。
2. **Facts**：读取的 Brand/Product/Audience/Channel 状态，source 与 fetchedAt；不确定就标 unknown。
3. **Plan**：将调用哪些 skills / actions、会创建或改变什么、哪些只是草稿。
4. **Cost / external effect quote**：FIKIRTIVE credits、channel fee、预算上限分别列出；不得混称。
5. **Human gate**：凡真钱、credits 消耗、外部发送/发布、workflow activation 或敏感数据影响，按有效规则取得正向确认。
6. **Execution**：同一个 intent 使用幂等键，调用 shared action；重试不重复收费、不双发。
7. **Live reflection**：人工 UI 与 Otto 立即看到同一 authoritative state。
8. **Receipt / reconcile**：保存 opaque provider ref、结果、失败分类与 unknown；绝不伪造成功。
9. **Learning proposal**：只提出 `BrandRuleCandidate` / audience / workflow 改进，另由商家确认，绝不静默改长期记忆。

最低审计字段建议为 `ownerId`、run/session ID、campaign ID、skill 名与版本、action、input hash、context references、approval fingerprint、ledger reservation/settlement、provider opaque ref、result state、timestamps。字段名是提案；所服务的现行法律是 owner isolation、context bridge、ledger exactly-once、receipt/reconciliation 与 provider secrecy。（源：`docs/BLUEPRINT.md` §二第 2–4/7/11/13–14 条；`FOUNDER-JOURNEY.md` Part 1 §2.5、§4）

### 7.2 最弱 sections 的具体最优融合

下列 skill / action 名都是**方案名，不是现有能力声明**。每条都保留 open-ended 原则：Otto 先理解眼前商家、目标和现有资料，不把 nasi lemak 例子写进 runtime persona。（原则源：Founder 2026-07-23 原话；`FOUNDER-JOURNEY.md` Part 1 §1.5、R3）

#### A. Campaign captain：先把整件事变成一件事

**商家说：**「Otto，下周帮我在 Bangsar 多卖 30 份午餐，预算最多 200 credits，先让我看完整计划。」

**Otto 做：**

1. `understandCampaignGoal` 读取现有 Brand/Product、地区、时间、可用 channels；缺目标或关键资料才追问。
2. `researchWeb` 只产出带来源的 findings；写入 versioned Campaign Brief，不冒充事实。
3. `proposeAudienceSnapshot` 从经确认的 tags/custom fields/segments 产出人数、eligibility 与 PII-safe 摘要。
4. `planCampaign` 组合 message angles、所需 assets、schedule、FIKIRTIVE cost、可能的 channel fee 与外部效果。
5. 把**整份 plan**交给商家批准；若实际 scope / cost 改变则重新确认，不拆成无意义小弹窗。
6. 批准后逐项调用既有 creation / schedule shared actions；connect 未开时止于 drafts / reminder，不假装已发布。
7. 每个 asset、schedule item、ledger entry、receipt、report 都回挂同一 Campaign run。

**审计链：** merchant utterance → brief version → source set → audience snapshot → plan/cost quote → approval fingerprint → action receipts → result/unknown → next proposal。

**今天的阻塞：** Campaign spine、audience contract、跨区 context 未获证明；真实触达另受 connect phase 阻塞。（源：commit `0613e961`；issue #359；`BIG-PICTURE-MAP.md` §3）

#### B. CRM win-back operator：把“名单”变成合法、可解释的一次经营动作

**商家说：**「Otto，找出 90 天没回来、可以合法联系的顾客，准备一个午餐优惠，先给我看人数、文案和总费用。」

**Otto 做：**

1. `previewAudience` 通过 owner-scoped shared action 组合 lifecycle、tags/custom fields、consent、channel capability、frequency cap。
2. 冻结一个 versioned audience snapshot；显示 included / excluded 数量及理由，不把名单复制进 prompt provider。
3. `draftCampaignMessage` 结合 Campaign / Brand / offer 生成可编辑 variants。
4. `quoteBroadcast` 分开列 credits 与 channel fee，展示 exact audience、content、schedule。
5. 商家一次正向确认后才创建 execution；connect 未开时只保存 workbench。
6. 真连接后按 snapshot eligibility 再检查、幂等发送、逐条收 receipt；STOP / 无 consent / 频控不合格 fail-closed。
7. replies 回到 Inbox / Needs reply 与 lifecycle；Otto 可提案下一步，auto-reply 继续受 connect-phase Founder gate。

**审计链：** query rule version → snapshot hash → eligibility reasons → message version → cost quote → approval → per-recipient attempt / receipt → reply / lifecycle。

**今天的阻塞：** tags/custom fields 未完成；provider 模拟；Meta self-connect、真 inbox 与 auto-reply 未闭合。（源：PR #361–#394；issue #301；#359 item 29；Founder 2026-07-23 裁决）

#### C. Schedule / Publish operator：把“排好”与“真的发了”分清

**商家说：**「Otto，把我批准的三张图排到下周一、三、五；能直接发就发，不能就准时提醒我。」

**Otto 做：**

1. `checkPublishCapability` 按 channel×post type 读真实 capability，不从“账号已连接”推断能直发。
2. `schedulePosts` 只引用 approved asset versions，展示日期、时区、copy、mode 与批次成本。
3. 一次确认整个 batch；写入 approval fingerprint。
4. Direct adapter 可用则到时幂等执行；不可用则进入 Reminder-assisted，清楚标明需要商家亲手完成哪一步。
5. 保存 prepared / reminded / attempted / published / failed / unknown 与 opaque receiptRef；失败重试不双发。

**审计链：** capability snapshot → batch draft → approval → attempt → provider/reminder evidence → reconciliation。

**今天的阻塞：** Reminder-assisted 的最新完整实证待核；Direct publish 依 channel permissions / App Review。（源：PR #123、#129、#215–#231；`BIG-PICTURE-MAP.md` §5）

#### D. Insight-to-remake operator：报告必须能回到下一次创作

**商家说：**「Otto，告诉我哪条午餐广告真的表现较好，然后做一个保留优点、但换 offer 的版本。」

**Otto 做：**

1. `analyzeCampaignPerformance` 读取 Campaign、asset version、execution、time window 与 source freshness。
2. 数据不足时 abstain；有证据时说明“观察到相关”或“有对照支持”，不把相关说成增量。
3. `proposeRemake` 明确保留 hook / visual / audience 中哪一项、只改变哪一项，并给出理由。
4. `quoteGeneration` 先显示成本；商家批准后才调用现有生成 action。
5. 新 asset 保存 parent、insight、prompt、model 与 approval lineage，再回到 Schedule / test plan。

**审计链：** source/fetchedAt → calculation/version → claim strength → remake delta → quote/approval → child asset → next execution。

**今天的阻塞：** O-10 remake wiring、E5 attribution、回复率方法仍在台账。（源：PR #128；issues #359、#405 §14；`BIG-PICTURE-MAP.md` B4）

#### E. Brand-learning advisor/operator：记住必须是商家批准的“记住”

**商家说：**「Otto，记住我的 sambal 要像家里煮的，不要高级餐厅风；以后每次都先检查。」

**Otto 做：**

1. `proposeBrandRule` 把原话解释成可读 rule candidate，同时保留原话。
2. 展示规则将影响哪些内容、与现有 BrandRule 是否冲突；商家可改、确认或只用于本次。
3. 只有确认后 `acceptBrandRule` 才经 shared action 写入 versioned memory。
4. 每次生成前把适用规则加入 context；生成后 `validateBrandOutput` 给 pass / warning 与理由。
5. 用户再次纠正时创建新版本，不覆盖历史、不从一次编辑猜永久偏好。

**审计链：** source utterance → candidate → conflict check → confirmation → rule version → generation context → validation receipt。

**今天的阻塞：** O-04 self-growing memory 与 C-08 generation validation 尚未闭合。（源：`docs/BLUEPRINT.md` §三、§六；`BIG-PICTURE-MAP.md` B5）

#### F. Workflow routine operator：常驻员工，但不是无限授权

**商家说：**「Otto，每周五准备下周内容，最多花 50 credits，发布前仍给我批。」

**Otto 做：**

1. `draftWorkflow` 把 trigger、scope、budget、outputs、final human gate 写成可读规则。
2. `simulateWorkflow` 用当前资料显示“如果今天运行会发生什么”，包括不足资料与预计成本。
3. 商家明确 `activateWorkflow`；activation 记录版本、范围、上限、expiry 与 approval fingerprint。
4. 到时只在授权范围内准备内容；任何超预算、scope 变化或外部发布都暂停并重新确认。
5. `monitorWorkflow` 显示每次 run；`killWorkflow` 立即阻止新动作；旧授权失效后要 reauthorize。

**审计链：** rule version → simulation → activation/expiry → each run plan → cost/action receipts → monitor/kill event。

**今天的阻塞：** C7 有 carrier / simulation / monitor，但 activate、kill、reauthorize 与真实 action parity 仍待偿还。（源：PR #415、#418、#420、#422；issue #359）

#### G. Trend-to-original-content operator：借鉴事实，不复制别人

**商家说：**「Otto，查 KL 最近起量的早餐内容，告诉我为什么有效，再做成我的原创版本。」

**Otto 做：**

1. `researchTrends` 只读允许的端口，保存 source、time、territory 与限制；无来源就说不知道。
2. `explainPattern` 提炼 hook、format、timing 等 pattern，不下载/复制竞争者成品。
3. `proposeOriginalBrief` 把 pattern 与商家自己的 Brand/Product/Campaign 结合，明确原创差异。
4. 经 gut-check、成本报价与商家确认后调用生成 action；产物保留 source inspiration 与原创变更记录。
5. 发布和结果仍走 Campaign / Schedule / Receipt spine。

**审计链：** source set → pattern claim → originality check → brief/version → quote/approval → asset/execution。

**今天的阻塞：** 数据端口与趋势项 #379/#380 延后到首个消费 skill，#397 还受 originality / platform relationship gate。（源：issues #379、#380、#397；`issues-361-453.md`）

#### H. Billing explainer：最优化不是代替老板花钱

**商家说：**「Otto，解释这次 Campaign 为什么用了 42 credits，带我去充值，但不要替我买。」

**Otto 做：**

1. `explainCampaignCost` 只读 ledger，按 Campaign / asset / action 列已 reserve、settled、refunded 与 unknown。
2. 对照批准时 quote 与实际结果，解释差额；无法归因的旧记录明确写 unallocated。
3. 需要充值时只导航到 Billing，让商家亲自选择并完成 money-in；Otto 不购买、不改订阅。

**审计链：** ledger entries → campaign references → quote/actual comparison → explanation → human-only Billing handoff。

**今天的边界：** money-out 的 ledger 与 fail-closed 已强；money-in / subscription 是人工专属。指定证据没有证明上述完整解释 skill，故这是最优 ceiling，不是现况声明。（源：PR #131、#449；`docs/BLUEPRINT.md` §二第 3/7 条、§七）

## 8. 哪些 Otto 融合最先带来价值

| 顺位 | 融合 | 为什么先做 | 是否 connect-blocked |
|---:|---|---|---|
| 1 | Campaign spine + `WorkContext` + audit envelope | 让已建的 Research、Canvas、Schedule、CRM、cost 与 reports 第一次围绕同一个生意目标；不需等外部 provider 才能开始 | **否** |
| 2 | Tags/custom fields + audience snapshot + Otto preview | 给 CRM 与创作共同的 audience language，也是合法 win-back 的前提 | **部分否**；真实触达要等 connect |
| 3 | #437 context composer / prompt authority | 把 Campaign、Brand、Product、Audience、Channel 变成稳定创作质量输入；直接增强最成熟的 Canvas | **否**；provider spend 仍须 Founder 预授权额度 |
| 4 | Creation experience：asset lineage、Brand learning、content adaptation、Schedule reminder | 先让商家从一句目标得到可批准的一组资产和排期，即使暂时不能直发也有价值 | **大部分否**；Direct publish 是 |
| 5 | Workflow authorization + Otto routine | 让“每周帮我准备”成为受限、可撤销、可查的员工行为 | **内部不阻塞**；真实发送/发布是 |
| 6 | Meta self-connect → 一条 WhatsApp inbound/outbound/reply/receipt | 一旦通电，Contacts、Consent、Inbox、Segments、Broadcast、Reports 六区同时从“形”变成真经营链 | **是** |
| 7 | Direct publish + receipt/reconcile | 把 Schedule 从计划表变成可证明的外部执行 | **是** |
| 8 | Attribution → insight → remake | 让真实结果反哺创作，是长期复利最大的一环；必须先有可靠 execution / receipt / facts | **是** |
| 9 | Read-only commerce facts / trend ports | 可补 ROI 与市场输入，但应在第一条真 loop 稳定后接，避免过早扩大 provider 面 | **是** |

这里的顺序不是另起一条 roadmap；下一部分把它折回 Founder 已确认的 station skeleton。（既有顺序源：Founder 2026-07-23 裁决，汇总于 `FOUNDER-JOURNEY.md` Part 3 与 `BIG-PICTURE-MAP.md` §9）

---

# Part 3｜建议路线：把融合动作折回既有计划

## 9. 先说明：以下全是 decision input

本部分**不改变 Blueprint、不替 Founder 作产品决定、不增加一条平行 roadmap**。它只回答：如果要把前两部分的融合装进现有 station，最小动作应放在哪里、需要什么处置。（现行权威顺序：`docs/BLUEPRINT.md` §七；`PROJECT-HISTORY.md` §A、§H）

处置标签含义：

- **[merge-into-existing-ticket #N]**：建议把验收条件合并进现有 issue，不另开平行工作。
- **[#359 台账]**：建议作为现有 parity / connect / debt ledger 的一项记录；不是现在立即实现。
- **[Founder Resolution]**：涉及用户行为、授权边界、验收或产品方向，须由 Founder 写成 durable GitHub 决议。
- **[修宪]**：与 `docs/BLUEPRINT.md` 身份或永久原则存在冲突，只有 §七流程可改；本文不能改。
- **待核**：指定 archive evidence 不足，进入实现前须查 live issue / PR / current-head code / provider 状态。

## 10. Station 0｜fix batch：先让“真实、安全、可恢复”站稳

既有 skeleton 的第一站不是加融合功能，而是先收完当前 fix batch。指定资料把 #423、#439–#442、#451、#453 列为当前剩余 ordinary fix；#449 与 #452 已作为紧急修复进入历史，但 live terminal state 在本次只读 archive 任务中未重新查询，故任何“现在还开/已关”均待核。（源：`BIG-PICTURE-MAP.md` §9；`PROJECT-HISTORY.md` §H；`issues-361-453.md`）

融合动作建议：

1. **把 tenant identity 做成统一语义门。** #320 与 #442 不应只各修一个表面；Contacts、Segments、Campaign、Schedule、Receipts、WorkContext 的 owner-scoped read/write 都须只取 authenticated `ownerId`，客户端 identity 永不可信。**[merge-into-existing-ticket #320 / #442]**（现行规则：`docs/BLUEPRINT.md` §二第 2 条；历史风险：issues #320、#442）
2. **把钱路、重试、状态真实性作为 audit envelope 的底座。** #423 的 TOCTOU（检查完成后、真正执行前状态被改变的竞态）/ duplicate、#439 invite race、#440 scheduled publish claim、#441 runtime fail-closed、#451 reservation cleanup、#453 charged-error typing 都应各自按原 scope 收口；本文不扩大其 diff。**[merge-into-existing-ticket #423 / #439 / #440 / #441 / #451 / #453]**（源：`issues-361-453.md`；`BIG-PICTURE-MAP.md` §9）
3. **增加一个跨区只读验收视角，不加新功能。** 对同一测试 owner 追踪 `Campaign → action → ledger → result/unknown`，证明没有跨 tenant、双扣、假 success 或丢 receipt；具体实现仍分别归现有 tickets。**[#359 台账]**（服务原则：`docs/BLUEPRINT.md` §二第 2–4/11 条）

**这一站的退出证据提案：** relevant fixes 在 current head 通过各自测试；同一 intent 重试不双写/双扣；所有外部未知保持 unknown；tenant gate 由 authenticated owner 主导。实际 CI、PR 与 claim 状态必须在执行时查 live，本文不作当前绿灯声明。（证据纪律源：repository `AGENTS.md`；`PROJECT-HISTORY.md` §A）

## 11. Station 1｜tags / custom fields：先建共同的“顾客语言”

Founder 已裁定：先完成 tags/custom fields，再进入 #437；user profile 页面不做；CSV 自动推断只考虑，没有批准。（源：Founder 2026-07-23 裁决；`FOUNDER-JOURNEY.md` Part 3 §4；`issues-361-453.md`）

融合动作建议：

1. **统一字段 provenance（来源）与 ownership。** 每个 tag / custom field 要知道是 merchant 手工、CSV、connector、workflow 还是 Otto 提案；未知来源不可被 Otto 当成事实。**[merge-into-existing-ticket：tags/custom-fields 现有 station ticket，编号待核] [#359 台账]**（原则源：`docs/BLUEPRINT.md` §二第 2/13 条、§三）
2. **定义 versioned Audience Snapshot。** Snapshot 至少引用规则版本、人数、eligibility 结果、生成时间与 Campaign，不复制不必要的 PII；之后 Canvas、Broadcast、Reports 读同一 snapshot。**[Founder Resolution]**：确认 snapshot 何时冻结、变更后是否须重新批准。（服务主题：商家数据权利与一个 request 一次批准；`FOUNDER-JOURNEY.md` Part 1 §2.5、§3）
3. **给人工与 Otto 同一组 shared actions。** 人工可创建/编辑/预览 tag、field、segment；Otto 可读取、解释、提案、预览，但 bulk edit / delete / merge 不得因自然语言歧义自动执行。**[#359 台账]**；若要让 Otto 自动打 tag，先 **[Founder Resolution]** 定触发、可撤销、敏感字段与确认规则。（双 100% 原则：`docs/BLUEPRINT.md` §二第 7 条）
4. **先订 retention / deletion / merge 行为，再自动化。** Contact 合并、Consent、Receipt、Campaign snapshot 与旧报告遇到删字段时怎样保留事实，须有单一 data-carrier matrix。**[Founder Resolution]**（现有缺口源：issue #359；principle 源：`docs/BLUEPRINT.md` §二第 13 条）

**这一站给 nasi lemak 档主的可见成果提案：** 他能建立“Office lunch”“Vegetarian interest”“Last order date”，预览“90 天未回来且可联系”人数，并把这份 snapshot 放进一个 Campaign；仍不真发送。（提案；地基证据：PR #361–#366、commit `04c006e7`）

## 12. Station 2｜#437 Otto prompt：把“开放式”落实为 context composer

Issue #437 是 Founder 明确排在 tags/custom fields 之后的 Otto system prompt station；现有议题记录的目标是开放式、model-first、context-aware，并避免把行业例子写成身份假设。（源：issue #437；Founder 2026-07-23 原话；`FOUNDER-JOURNEY.md` Part 1 §1.5、Part 3 §4）

融合动作建议：

1. **把 prompt authority 变成 context composer，不变成一份塞满规则的长 prompt。** 每次 turn 只组装与当前 intent 有关的 Campaign Brief、Brand/Product references、Audience Snapshot 摘要、selected asset、channel capability、credits / approval state。**[merge-into-existing-ticket #437]**（平台基础：PR #91、#180；`docs/BLUEPRINT.md` §二第 7/11 条）
2. **先问缺的，不重复问已有的。** Otto 可从 context 得知“这张”“这群人”“下周一”指什么；如果 Campaign objective 或 permission 不明才追问。**[merge-into-existing-ticket #437]**（零学习曲线与刨根问底：`FOUNDER-JOURNEY.md` Part 1 §2.3–2.4）
3. **PII 与 provider secrecy 双重过滤。** Customer 原始 PII 默认不进模型 prompt；provider 名称、status、metadata 也不出现在用户 API surface。**[#359 台账]**（现行规则：`docs/BLUEPRINT.md` §二第 13–14 条）
4. **prompt change 用任务成功率验，不只看措辞。** 至少用“目标→Campaign 草案”“报告→remake 提案”“audience→内容差异”“缺资料→正确追问/abstain”四类 acceptance；真实 provider 生成花费需 Founder 先批预授权额度。**[Founder Resolution]**：确认测试任务与可接受证据；**[merge-into-existing-ticket #437]**。（spend 法：repository `AGENTS.md`；quality 原则：`docs/BLUEPRINT.md` §六）
5. **解决 Otto 身份层级冲突。** Blueprint 当前写 Otto 是 “AI marketing teammate / ecosystem router”；2026-07-23 Founder 又提出 runtime “personalized AI agent/operator，不是 marketing employee”，两者有潜在身份冲突。本文不替两边选胜者。建议先将事实写成一条 clarification：marketing 是产品职能边界，operator 是交互/执行形态；若这会改变 canonical identity，必须走 **[修宪]**。（冲突源：`docs/BLUEPRINT.md` §一；Founder 2026-07-23 原话，见 `FOUNDER-JOURNEY.md` Part 1 §1.5、R3）

**这一站的退出证据提案：** 同一 merchant 目标在人类入口和 Otto 入口产生同一个 Campaign / shared actions；Otto 不因 “nasi lemak” 假定所有商家；它能引用现有 context、正确停在 money / external gate，并把每一步写进 audit envelope。（提案；服务 `docs/BLUEPRINT.md` §二第 7/11 条）

## 13. Station 3｜creation experience：把强发动机接上 Campaign

既有 station 包含 Grok-parity GOAL；generation 需要的真实 spend 预授权额度仍待 Founder，不能由本文设一个替代 code cap。（源：Founder 2026-07-23 裁决；`FOUNDER-JOURNEY.md` Part 3 §4；repository `AGENTS.md` 非协商安全第 3 条）

融合动作建议：

1. **Campaign-first，不破坏 quick create。** 有明确经营目标时，从 versioned Campaign Brief 进入 requirement / prompt / storyboard；用户只想试一张图时仍可 quick create，稍后再 attach 到 Campaign。**[Founder Resolution]**：确认“何时自动建 Campaign、何时保持独立草稿”的用户行为。（现有对象源：PR #83/#91/#99/#111；commit `0613e961`）
2. **完成 asset lineage 与 adaptation。** master / child asset 保存 Campaign、parent、audience/channel、prompt/model version、approval；一份主创意可提案多个 format，但所有费用合并报价。**[#359 台账]**；若改变现有创作验收，**[Founder Resolution]**。（服务 Grok direct/contextual/continuous：`FOUNDER-JOURNEY.md` Part 1 §5.2）
3. **把 O-04/C-08 变成明确学习环。** 修改不等于永久记忆；Otto 先提 `BrandRuleCandidate`，商家确认后版本化，生成前后分别取 context / validation。**[#359 台账]**；长期记忆自动化边界须 **[Founder Resolution]**。（缺口源：`docs/BLUEPRINT.md` §三、§六）
4. **把 Audience Snapshot 带进创作，但不带原始顾客 PII。** 同一 offer 可对不同 segment 生成不同 angle，结果仍是同一 Campaign 的 child assets。**[merge-into-existing-ticket #437] [#359 台账]**（边界源：`docs/BLUEPRINT.md` §二第 13 条）
5. **把 approved assets 直接送到 Schedule draft。** 保存 channel capability 与 mode；Direct 不可用时清楚进入 Reminder-assisted，不用“scheduled”暗示“会自动发布”。**[#359 台账]**（历史地基：PR #123/#129/#215–#231；issue #440）
6. **将 Grok 七项词义与五关质量写成可复验 acceptance。** Blueprint 已把 conversational editing、prompt mastery、styles、draw、speed、search、storyboard-to-video 与五关列为方向，但 exact parity 到何种程度仍须 Founder 用可观察任务确认。**[Founder Resolution]**（源：`docs/BLUEPRINT.md` §六；`docs-doctrine.md`）
7. **真实 provider 验证必须先获额度。** 提案的最小 spend set：固定 seed / prompt 的图片生成、编辑、storyboard 首帧、video 各若干次，记录质量、延迟、失败、真实 credits 与 refund；次数和上限由 Founder 决定。**[Founder Resolution：预授权额度]**（spend 法：repository `AGENTS.md`；钱路原则：`docs/BLUEPRINT.md` §二第 3–5 条）

**这一站给档主的可见成果提案：** 他说一句 Campaign 目标，Otto 先研究/追问，给一份可编辑计划；批准后生成有 lineage 的内容包、适配渠道、排进 reminder schedule，并明确显示每笔 credits。真实发布与真实顾客结果不在这一站假装完成。（提案；现有能力地基：PR #83–#129）

## 14. Station 4｜connect phase：只把一条闭环通真，再扩渠道

Blueprint 指定 WhatsApp 是第一条 Customer Engagement channel；Meta Embedded Signup 自助连接取代 Gupshup 方向，production enablement 与外部 provider action 仍受 Founder 授权。（源：`docs/BLUEPRINT.md` §一、§六；issue #301；#359 item 29；`PROJECT-HISTORY.md` §E）

建议按依赖顺序做，不以页面数量为成功：

1. **一位 merchant self-connect、一条 WhatsApp inbound / outbound。** 完成 auth / permission、webhook、inbound Contact / Consent、human reply、outbound eligibility、provider receipt、reconcile。**[merge-into-existing-ticket #301] [#359 台账 item 29]**（现有内部地基：PR #361–#413）
2. **先证明 human loop，再让 Otto 入场。** 人工可看/回/停/重试后，Otto 才通过同一 actions 做 audience preview、draft reply、draft broadcast；auto-reply 按 Founder 裁决留在 connect phase 并另过授权。**[#359 台账] [Founder Resolution：auto-reply scope / approval / kill]**（源：Founder 2026-07-23 裁决；`issues-271-360.md`）
3. **Direct publish 逐个 channel×post type 通电。** 每一格都要真实 prepare / attempt / receipt / reconcile 证据；未获权限的格继续 Reminder-assisted，不能把“账号连接”当作“可直发”。**[#359 台账]**（三支柱规则：`docs/BLUEPRINT.md` §六；L1 历史：PR #215–#231）
4. **把 Receipt 回挂 Campaign，再做 attribution。** 先实现 execution truth，再讨论回复率、订单匹配与增量；没有 holdout / causal evidence 就不用 “incremental”。**[merge-into-existing-ticket #405] [#359 台账 E5 / O-10]**（源：issues #359、#405；`BIG-PICTURE-MAP.md` §6）
5. **完成 insight → remake。** 报告上的 “Recreate / Try angle” 调用 shared creation action、先报价后生成、保存 parent insight 与 child asset，再进下一轮 Schedule。**[#359 台账 O-10]**（现有诊断地基：PR #128）
6. **只读经营事实晚于第一条 receipt loop。** 订单/付款/退款 connector 只读、owner-scoped、带 source/fetchedAt；无法匹配就 unattributed，不建立自己的 commerce money path。**[Founder Resolution：首个 read-only connector 与 attribution method] [#359 台账]**（四层边界：`docs/BLUEPRINT.md` §一）
7. **趋势端口按真实消费 skill 拉动。** #379/#380 到首个被批准的 `researchTrends` 才做，#397 再接原创内容；不要为“未来可能用”先扩大 provider / spend 面。**[merge-into-existing-ticket #379 / #380 / #397]**（源：issues #379、#380、#397；`issues-361-453.md`）
8. **最后接请评、推荐、复购。** review request 与 referral reward 必须是两条独立 workflow；两者都过 Consent、eligibility、receipt，并把合法结果回写 lifecycle。**[#359 台账] [Founder Resolution：timing / incentive / channel policy]**（永久分线原则：`docs/BLUEPRINT.md` §一；PR #212）

**这一站的第一个完整成功例提案：**

> 一位 nasi lemak 档主完成 Meta self-connect → 一位有 Consent 的顾客进入 Contact → 老板用同一 Campaign 选择 Audience Snapshot → 批准一条 WhatsApp 午餐 offer → 系统只发一次并拿到真实 receipt → 顾客回复进入 Inbox / Needs reply → 老板回复 → Report 按诚实方法显示送达/回复，未有订单事实就显示 ROI unknown → Otto 提案下一轮内容，但不擅自发送。

这条例子同时验证 Customer Engagement 六区、Campaign spine、Consent、exactly-once、receipt/reconcile、人工/Otto parity 与 honest-unknown；它比“十个页面都能打开”更接近 Founder 要的真闭环。（提案；原则源：`docs/BLUEPRINT.md` §一、§二、§六；`FOUNDER-JOURNEY.md` Part 1 §8.5）

## 15. 不新增 station 的总优先序

| 现有 station | 当站最重要的融合交付 | 解锁的下一站 | 提案 disposition |
|---|---|---|---|
| fix batch | tenant / money / idempotency / truthful state / recovery 底座 | 所有后续融合可安全共享 action | `[merge-into-existing-ticket #423/#439–#442/#451/#453]`、`[#359 台账]` |
| tags/custom fields | Audience Snapshot + provenance + data lifecycle | #437 有可用但 PII-safe 的 audience context；CRM 有合法共同语言 | `[Founder Resolution]`、`[#359 台账]` |
| #437 Otto prompt | open-ended context composer + audit run plan + identity clarification | Otto 可围绕同一 Campaign 编排现有 skills | `[merge-into-existing-ticket #437]`；身份如改变则 `[修宪]` |
| creation experience | Campaign Brief、asset lineage、Brand learning、adaptation、Schedule handoff、Grok quality evidence | Connect 后不需重做上游对象，只把 actions 通真 | `[Founder Resolution]`、`[#359 台账]`、`[Founder Resolution：预授权额度]` |
| connect phase | WhatsApp 真 loop → publish → receipt → attribution → remake → read-only commerce / trends | 形成 creation→customer→result→creation 的复利环 | `[merge-into-existing-ticket #301/#405/#379/#380/#397]`、`[#359 台账]`、必要的 `[Founder Resolution]` |

最关键的时间排序是：**先共享 business identity，再提升 reasoning context，再打磨 creation handoff，最后连接真实 effects。** 如果反过来先连很多 provider，系统会得到更多“并排的真实数据”，却仍不知道它们属于哪个 Campaign、哪次批准和哪条学习。（提案分析；依据：M1、M6、M9–M14）

## 16. 建议由 Founder 依次裁决的少数问题

以下只列会真正改变实现的决定；一次呈现一个即可，避免把 Founder 淹没在选项中。（呈现原则：repository `AGENTS.md`；权威原则：`docs/BLUEPRINT.md` §七）

1. **Otto 身份层级。** “AI marketing teammate” 是 canonical 产品身份，“personalized operator” 是执行形态，是否采用这层解释？若改变 Blueprint identity，走 **[修宪]**。（冲突证据：`docs/BLUEPRINT.md` §一；Founder 2026-07-23 原话）
2. **Campaign 自动建立边界。** 用户只生成一张图时是否自动创建 Campaign，还是保持 independent draft，直到用户说出经营目标？**[Founder Resolution]**
3. **Audience Snapshot 与资料生命周期。** 字段变化、Contact merge/delete、Consent 变化后，已批准 snapshot 如何冻结、失效或重新确认？**[Founder Resolution]**
4. **长期记忆写入。** 哪些修改只能影响本次，哪些必须提案，哪些类型永远不能由 Otto 自动写入？**[Founder Resolution]**
5. **Workflow 授权矩阵。** preparation、credits spend、external publish/send、auto-reply、budget/scope change 各在哪一层需要首次或再次确认？**[Founder Resolution]**
6. **Grok-parity 验收与真实验证额度。** 用哪几项 merchant task 判断“达到”，允许为真实图/视频验证花多少？**[Founder Resolution：GOAL / 预授权额度]**
7. **首个 connect 成功标准。** 是否以第 14 节那条 WhatsApp 单商家闭环为第一 milestone，而不是以多个连接按钮为 milestone？**[Founder Resolution]**

## 17. 明确不建议做的事

- 不另建第二个 Otto、第二个 CRM、第二个 action path 或“Campaign app”；一个 app、一个 Otto、一个 shared action authority。（现行规则：`docs/BLUEPRINT.md` §一、§二第 11 条）
- 不造内部不可审计的 mega-skill；一个 run 编排小 skills，所有副作用回到 shared action。（提案；结构依据：PR #28/#180/#192）
- 不为追“双 100%”让 Otto 代做充值、订阅、账户安全或 staff admin。（现行例外：`docs/BLUEPRINT.md` §二第 7 条、§四、§七）
- 不把“scheduled / sent / published / attributed”写得比 provider 事实更确定；没有 receipt 就 unknown。（现行规则：`docs/BLUEPRINT.md` §二第 4/14 条；issue #440）
- 不把一次顾客回复或一次画面修改静默写成永久 Brand memory；只生成候选，商家确认后生效。（原则源：`docs/BLUEPRINT.md` §三；`FOUNDER-JOURNEY.md` Part 1 §3）
- 不让模型看到完成任务不需要的 Customer PII，不信任 client-supplied `ownerId`。（现行规则：`docs/BLUEPRINT.md` §二第 2/13 条）
- 不在 connect 前把模拟 provider 当作已上线；不为未来想象先接趋势、commerce 或更多渠道。（现状源：PR #382–#413；issues #379/#380）
- 不用本文替代 #359、现有 tickets、Founder Resolution 或 Blueprint amendment；本文是导航与 decision input，不是 authority。（权威顺序：`docs/BLUEPRINT.md` §七；`PROJECT-HISTORY.md` §A）

---

# 证据边界与待核事项

1. **早期 Git 历史缺口。** 指定 digest 说明本地可见 Git 从 2026-06-10 附近开始，早于此的产品过程不能由 commit spine 完整重建；本文不填补不存在的事实。（源：`git-spine.md`）
2. **Transcript 重复与分叉。** 多份 transcript 是 resumed / forked sessions，重复段落不等于多次独立确认；本文优先采用有时间、issue/PR/commit 或 live Blueprint 互证的材料。（源：`transcript-main-7fcd6fd4.md`、`transcript-main-940bfbd9.md`、`transcript-main-rest.md`；`PROJECT-HISTORY.md` 方法说明）
3. **外部 live truth 未在本任务重查。** 用户限定 no git ops、只读指定 archives；因此 current PR/issue state、current-head CI、task claim、deployment、provider permission、Meta review 与 credential 状态均为 **Unknown / 待核**，本文不把 archive 的最后状态冒充 2026-07-24 live state。（约束源：本任务指令；live truth 原则源：repository `AGENTS.md`）
4. **Direct publish / Reminder-assisted。** 既有地基与权限模型有证据，但最新 channel×post type 的真发布矩阵、Reminder-assisted 完整走查与 provider receipts 在指定 digests 中没有闭合，均为 **待核**。（源：PR #123/#129/#215–#231；`BIG-PICTURE-MAP.md` §5）
5. **Otto skill 覆盖数字。** Digests 证明 `defineOttoSkill` / Parity Manifest 与部分 skills，却没有一份经 live code 验证的“每区完整 skill 清单”；Part 2 的 Absent/Bystander 表示“指定证据未证明”，不等于断言代码绝对不存在。（源：PR #180/#192；`BIG-PICTURE-MAP.md` §1）
6. **身份冲突不能靠本文消解。** Blueprint 的 “AI marketing teammate” 与 Founder 后来的 “personalized agent/operator” 原话都保留；在 durable clarification / amendment 前，不应把任一方悄悄改写成另一方。（源：`docs/BLUEPRINT.md` §一；`FOUNDER-JOURNEY.md` Part 1 §1.5）
7. **v2.13 / historical constitution。** 历史资料记录 #444/#445 曾处理 Blueprint v2.13 对齐；本文只以任务要求的 live `docs/BLUEPRINT.md` 为当前 grounding，不从 archive 推定其 live Git/PR 状态。（源：issues #444/#445；`docs-doctrine.md`）

# 给 Nicks 的最终大局图

FIKIRTIVE 最值得守住的不是“有十个 sections”，而是这一个复利：

> 商家说出经营目标 → Otto 理解并建立 Campaign → Research、Brand、Product、Audience 共同塑造原创内容 → 商家看清计划与总价后批准 → Schedule / Channel 真实执行 → Receipt 与经营事实诚实对账 → Report 给有根据的 insight → Otto 提案下一轮，并把经商家确认的学习带回 Brand、Audience 与 Campaign。

这条链没有改变 Blueprint 的四层边界：FIKIRTIVE 仍只做 marketing；CRM 是客户互动；commerce 只读事实；Billing 只负责 FIKIRTIVE 自己的钱。它也没有把 Otto 变成不受控的机器人：Otto 可以成为最强 operator，但商家仍拥有身份、资料、预算、批准、渠道与最终决定。（现行边界与原则：`docs/BLUEPRINT.md` §一、§二、§七；Founder themes：`FOUNDER-JOURNEY.md` Part 1 §1–§5、§8–§10）

因此，本文的核心提案不是“再做更多功能”，而是：

1. 用 **Campaign** 统一业务身份；
2. 用 **shared action + audit envelope** 统一人工与 Otto；
3. 用 **Receipt / reconciliation** 统一“真的发生了什么”；
4. 用 **merchant-confirmed memory** 统一“下一次怎样更好”。

若四者都成立，Creation、Campaign、Schedule、CRM、Reports 与 Otto 才不再是并排的页面，而会成为 Nicks 要的一个 organism。本文到此只提供 decision input；所有带 `[Founder Resolution]`、`[修宪]`、`[#359 台账]` 或 `[merge-into-existing-ticket #N]` 的项目，仍须进入各自现有权威路径。（依据：全文；权威边界：`docs/BLUEPRINT.md` §七）
