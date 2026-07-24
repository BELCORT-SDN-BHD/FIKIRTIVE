# FIKIRTIVE《大局观现状地图 + 偏差与升级清单》

> 档案截点：2026-07-24  
> 档案性质:快照档(见 [README.md](README.md) 刷新约定)——过档案截点后仅作历史证据,现状以 live 查询与权威层为准。
> 读者：Founder Nicks，以及以后每一位 AI / human collaborator  
> 性质：历史与现状的决策输入，不是新的产品裁决，不替 Founder 决定

## 0. 先看结论

FIKIRTIVE 的终局没有变：它是一座给中小商家的世界级 ALL-IN-ONE 营销与营收增长平台；每栋楼都必须是人可以完整操作的真工具，Otto 再用同一套动作层操作全城。第一期不是“先卖一个半成品”，而是三个支柱一起真实成立：品类一流内容、真正可用的发布、完整 Customer Engagement CRM。（源：`docs/BLUEPRINT.md` §一、§二第 7 条、§六；Founder Resolution #334；PR #337；`docs-doctrine.md`）

到 2026-07-24，项目已经拥有相当深的工程地基：创作 Canvas、生成与分镜链、Brand memory、排期草稿、Meta 分析、credits/Stripe、租户模型、Otto skill framework，以及 CRM C1–C7 的 schema / engine / UI 主体都已经进入 `main`。（源：PR #60、#92、#97、#103、#114、#116、#123、#128、#129、#131、#361–#422；commits `ca913d7`、`04c006e7`、`83946443`、`660efe0e`、`29d01de1`、`9dcf8078`、`44d28497`；`git-spine.md`）

但“代码合并”不能等于“产品完成”。当前最大的事实是：创作质量还没有以 Blueprint 的五关证明达到品类一流；发布仍有真实渠道/App Review/可用模式的断点；CRM 大量路径仍是模拟 provider 或受 production-apply gate 约束，WhatsApp 真连接和真发送尚未由 digest 证明通电。因此第一期三支柱尚不能按 Blueprint 宣布完成。（源：`docs/BLUEPRINT.md` §六；issue #359 item 12、item 29；issue #424；PR #337；`issues-361-453.md`；`git-spine.md`）

历史里还有三类必须由 Founder 看一眼的偏差：Otto 到底是“AI 营销员工”还是不带营销定语的“平台操作员”；“Grok 那种体验 / Apple / 丝滑 / 品类一流”仍有一些不可验收的形容词；商家数据的删除、保留、导出与证据链规则在不同 carrier 上还没有一张统一矩阵。（源：`docs/BLUEPRINT.md` §一、§六；issue #356、#405、#437；`transcript-wt-orchestration-50ba3d-current.md`；`transcript-main-7fcd6fd4.md`）

### 本文怎样判断“建成”

- **已合并代码**：进入 `main`，但不代表生产可用。（证据口径：`git-spine.md`、`issues-*.md`）
- **模拟 / 断电**：schema、engine 或 UI 已有，但 provider 是模拟的、外部权限未批，或 production apply 未放行。（证据口径：issue #359 item 12、item 29；`issues-361-453.md`）
- **真实可用**：真实用户能走完、外部效果真实发生、费用和回执可核对，并通过 Blueprint 的质量门。（验收口径：`docs/BLUEPRINT.md` §六；Founder Resolution #334）
- **Gap 大**：终局或第一期关键闭环尚未真实成立；**Gap 中**：核心可用，但标杆深度或关键闭环缺失；**Gap 小**：主要剩统一、打磨或文书收口。本尺度是本档案的分析标尺，不是 Founder 裁决。

### 证据边界

本档案只依据指定的 18 份 digest 与 live `docs/BLUEPRINT.md`。GitHub 号段 #1–#453 与 763 个 commit 的 digest 是完整号段/主干摘要，但 transcript digest 多数只提取 Founder-authored turns，不是原始会话的逐字全副本；两个 worktree 目录没有 `.jsonl`，部分选项内容只剩“选 B”而没有菜单原文，早期被删或未落盘的会话也无法从本材料恢复。（源：`issues-1-90.md` 至 `issues-361-453.md` 的 source notes；`git-spine.md`；`transcript-main-rest.md`；`transcript-wt-small-batch.md`；`transcript-wt-serene-swartz.md`）

---

# Part 1｜现状地图

## 1. Otto

### VISION

Otto 是 FIKIRTIVE 的差异化层，不是拿来遮住薄弱工具的聊天壳。用户可以完全不用 Otto，亲手使用每栋楼；也可以让 Otto 通过 skills、共享动作层、读对等、上下文桥和审批闸操作全城。Otto 的动作要在 UI 秒级反映，coral 只代表 Otto；新能力永远是 `defineOttoSkill`，不是第二个 app。（源：`docs/BLUEPRINT.md` §一、§二第 3/4/7/10/11 条、§四）

Blueprint 的现行首发叙事仍把 Otto 写成“精明能干的 AI 营销员工”；2026-07-23 的后续 Founder 原话则是「使用 skill 来协助用户就好，加多一个营销的那个有点不必要」，并将英文身份改向 “FIKIRTIVE's operator — the platform's hands”。这两层尚未在同一权威文本里完全对齐。（源：`docs/BLUEPRINT.md` §六；issue #359 记录；`issues-271-360.md`；`transcript-wt-orchestration-50ba3d-current.md`）

### BUILT TODAY

- 2026-07-04 的 Blueprint 快照记录 25 个注册 skills：生成、prompt mastery、品牌记忆、research、视觉参考、分镜、Meta 诊断、排期草稿和产品 URL 建档等；此后又加入 CRM/Workflow 的 read/draft skills，所以“25”只能当旧快照，最新精确数量在 digest 中是 Unknown。（源：`docs/BLUEPRINT.md` §三区划图；PR #118、#123、#124、#128、#422）
- `defineOttoSkill` factory、registry、禁止 skill 直碰 spend 的 fence、共享 action layer 与 Parity Manifest hard gate 已建；新 action 没有 skill 或合法豁免会被 CI 拦。（源：PR #28、#131、#180；commit `30d837a0`；`docs/BLUEPRINT.md` §四第 1/9 缝；`git-spine.md`）
- Otto 已能研究、读品牌与产品、生成图/视频、制作分镜、起草排期、分析 Meta 广告，并读/草拟 C7 workflow；真实花费走 credits reserve→settle/refund，失败不应双扣。（源：PR #83、#91、#114、#118、#123、#124、#128、#131、#420、#422；`issues-91-180.md`；`issues-361-453.md`）
- 上线前测试发现的“0 credits 时第一轮空白死路”已由 #431 追踪并在 #448 修复；生成失败却显示 “Generation started” 的诚实层问题由 #430/#449 修复。（源：issue #430、#431；PR #448、#449；`issues-361-453.md`；commit `4049323d`）

### EXPLICITLY DEFERRED

- O-04 品牌记忆自养、O-07 绩效周报、O-10 诊断卡到“复刻/换角度”真实生成接线仍待建；最后一项会触碰 spend，历史明确要求独立 PR。（源：`docs/BLUEPRINT.md` §三区划图；PR #128；`issues-91-180.md`）
- C7 的 `archiveWorkflowDefinition`、`activateRoutine`、`killRoutine`、`reauthorizeRoutine` 被记为 human-only 债，Founder 原话为「批+4债(61→65)」；skill 排在后面。（源：issue #359 checkpoint；`issues-361-453.md`）
- Otto 全能力 prompt engineering 仍是 open issue #437；竞争研究数据端口 #379、趋势/搜索数据源 #380，以及趋势响应式内容重造 #397 都被放进 #359，触发条件是第一个消费它们的 skill 排期，并且 #397 还有原创性/平台关系 gut-check。（源：issue #359；issues #379、#380、#397、#437；`issues-271-360.md`；`issues-361-453.md`）
- 手机 App 被定义为未来纯 Otto-chat / routine 审批面，未进入当前施工波次。（源：`docs/BLUEPRINT.md` §六；`transcript-main-7fcd6fd4.md`；`docs-doctrine.md`）

### GAP SIZE：大

Otto 已有“手”和一批真技能，但尚未做到“全城所有能力都有读写对等、上下文对等、审批后可执行到底”。尤其 CRM 真渠道、Campaign 全闭环、发布真链和 C7 激活动作仍断开，所以不能把 Otto 描述成已经能 100% 操作当前产品。（判断依据：`docs/BLUEPRINT.md` §二第 7 条；issue #359；PR #422；`issues-361-453.md`）

---

## 2. 创作 / Canvas

### VISION

创作区要把 Higgsfield 的营销成品导向、LTX 的分镜、Canva 的民用易用与 Brand Kit、Adobe GenStudio 的品牌约束、Grok Imagine 的 canvas 交互手感合在一起；胜负手是“贴链接→产出能用的广告”、SEA 语境和生成后的下一公里。（源：`docs/BLUEPRINT.md` §六对标地图）

第一期“品类一流内容”必须同时过理解、判断、手艺、采用、证据五关。Provider 成功、文件可打开、单测通过或偶然一张最好样片，都不能冒充完成。（源：Founder Resolution #334-5~7；PR #337；`docs/BLUEPRINT.md` §六）

### BUILT TODAY

- Canvas 已有无限画布、项目/多对话、图片与视频节点、4 变体、成本确认、i2v/t2v、多参考图、整段参考视频、抽帧、DetailPanel、crop、失败恢复与付费卡防误删。（源：PR #48–#60、#84、#85、#88、#89、#92、#97、#129；`issues-1-90.md`；`issues-91-180.md`）
- “做个广告→分镜→看图确认→出片”链已完成刨根问底、prompt mastery、分镜卡、首帧闸与视频闸；部分 shot 可以执行，缺首帧的 shot 会跳过而不是拖死整批。（源：PR #83、#91、#99、#111、#114；`issues-91-180.md`）
- My Stuff、History/Library、Templates、Discover、Brand memory 和产品 URL 建档已与创作面连接；Discover 被安全地改成 BELCORT 静态 inspiration，而不是跨租户社区 feed。（源：PR #59、#103、#124、#129；`issues-1-90.md`；`docs/BLUEPRINT.md` §三区划图）
- Route-B 后续落了 Canvas/Factory/Storyboard/Home/Ideas/Media editor/Asset viewer 七页壳，并逐批接 Otto skills；历史也诚实记录过 shell-to-real debt，而不是把壳当成全部完成。（源：commits `a11dd368`、`cd549c6f`、`6c7fc5d9`、`356fa583`、`d4cbfea2`、`62360aac`；`git-spine.md`）

### EXPLICITLY DEFERRED

- Factory 第一期仍是 Coming soon；Blueprint 明说第一期的文案、图片、短视频、Pack、Storyboard 都要过五关，但 digest 没有一份“品类一流证据包”证明已通过。（源：`docs/BLUEPRINT.md` §六；Founder Resolution #334；`docs-doctrine.md`）
- Grok parity GOAL 的 Phase 2/3 仍有版本、主页、并行、规模和 Otto 对等债；历史已把“字面 100% 复制 Grok”改成“100% 创作画布交互手感”。（源：`docs/superpowers/plans/2026-07-06-otto-grok-parity-GOAL.md`，经 `docs-doctrine.md` 摘要；`transcript-main-7fcd6fd4.md`）
- #437 的 Seedance/Seedream 全能力 prompt skill 尚未完成；provider 名称已定为商业机密，用户只能看到能力和结果，不能看到后端型号。（源：issue #437；Founder Resolution #436；PR #454；`issues-361-453.md`）
- Otto 身份与 prompt integration 已记录进 #359，并并入 #437 的实现范围；digest 未给它一个单独 item 编号，本文不补造编号。（源：issue #359；issue #437；`transcript-wt-orchestration-50ba3d-current.md`）

### GAP SIZE：大

功能数量已经丰富，但第一期的关键不是“能生成”，而是“稳定地产出老板可直接采用的营销成品”。现有 digest 证明了工具链，不证明五关的重复性质量，因此距离首发内容支柱仍是大 gap。（判断依据：Founder Resolution #334；`docs/BLUEPRINT.md` §六）

---

## 3. Campaign

### VISION

Campaign 必须是独立对象，不升格成含糊的 project；终局包括目标、受众、预算、内容/渠道编排、UTM、归因和 campaign 级报告。Founder 的原始体验是：Otto 研究趋势，在几小时内设计好跨几天或几个月的专业 campaign，老板看清总价和取舍后一次批准。（源：`docs/BLUEPRINT.md` §六；Founder 原话见 `transcript-main-7fcd6fd4.md`、`transcript-wt-handoff-1ec82f.md`）

### BUILT TODAY

- B8 已完成 Campaign+CRM 的设计全图，Founder 在 #296 清掉 12 个决定槽，并确认 campaign pack 与总价页属于一期可卖形态。（源：issue #296；`issues-271-360.md`）
- C2a Campaign zero-spend base 已进入 `main`；C2b spend-confirmation 面也已建立，并在 #430/#449 修正 0-balance、失败标题和费用确认的诚实性。（源：commit `0613e961`；issues #351、#395–#398、#430；PR #449；`git-spine.md`；`issues-361-453.md`）
- Campaign 与 CRM/Broadcast、Schedule、Analytics 各自已有物理组件，但 digest 没有证明“一个 Campaign 对象从研究→内容→发布/投放→回执→归因”已由同一真实对象贯通。（源：`issues-271-360.md`；`issues-361-453.md`；`docs/BLUEPRINT.md` §六）

### EXPLICITLY DEFERRED

- 客户 tags / custom fields 被 Founder 列为上线前补齐项；归因 E5-06/07 wiring 被放进 #359，完成前 UI 必须诚实显示 `attribution_unavailable`。（源：issue #359；Founder 2026-07-23 四项 Campaign/CRM 裁决；`issues-271-360.md`）
- 趋势研究数据端口 #379、趋势搜索 #380、趋势响应式内容 #397 都在 #359；没有这些，就不能把“Otto 自动找趋势并重造 campaign”写成今天已经可用。（源：issue #359；issues #379、#380、#397；`issues-361-453.md`）
- 自动化 recipes/playbooks 被放到上线后的第一批；Campaign planner 的批量生成、排期和闭环 routine 阶段在 transcript 中也明确未完成。（源：issue #359；`transcript-main-940bfbd9.md`；`transcript-wt-mid-batch.md`）

### GAP SIZE：大

当前更像“Campaign 对象/页面/确认地基”，不是 Founder 描述的专业 campaign 员工闭环。研究、内容生产、真实发布、真实回执和归因至少有三段尚未接通。（判断依据：`docs/BLUEPRINT.md` §六；issue #359；issues #379/#380/#397）

---

## 4. CRM 六大件

Blueprint 要求第一期达到 respond.io 类别与体验完整度，而不是三行 SMB-lite；唯一必须真实上线的顾客渠道是 WhatsApp。第一期不进入 Salesforce Companies/Deals/Forecast/Quotes/发票收款/完整售后工单深度，也不预建假的 Salesforce 骨架。（源：Founder Resolution #334-14~16；PR #337；`docs/BLUEPRINT.md` §六）

| 六大件 | VISION | BUILT TODAY | EXPLICITLY DEFERRED / 断电 |
|---|---|---|---|
| 1. Identity / Consent / Contacts | 联系人可从对话、广告、CSV、手工、connector 进入；同意/拒发有可重放证据链，商家是数据主人。（源：`docs/BLUEPRINT.md` §六；issue #356） | Consent ledger 的 closed writers、fold/replay、projection 与 Contacts list/profile/import 已合并。（源：PR #361–#366；commits `83946443`、`1f8d8f26`；`git-spine.md`） | 客户记录合并在上线版明确不做；未来也只能商家手动确认。处置/erasure 工具、字段级加密/BYOK 在 #359 延后。（源：issue #359；Founder 2026-07-23 裁决；`issues-271-360.md`） |
| 2. Segments / Lifecycle | 动态 segments、lifecycle 状态与触达资格要成为同一顾客画像的可操作层。（源：`docs/BLUEPRINT.md` §六） | Dynamic Segments 已合并；C7 也建立 workflow/lifecycle carriers。（源：commit `04c006e7`；PR #418、#420；`git-spine.md`） | tags / custom fields 是上线前缺口；更深的 lifecycle recipes 放到上线后第一批。（源：issue #359；`issues-271-360.md`） |
| 3. Inbox / Conversation | WhatsApp-first 的共享收件箱、历史、搜索、分派、人/Otto 接手；售前营销属于本体，售后 service desk 明确交接。（源：`docs/BLUEPRINT.md` §一边界四层表、§六） | C4a contract 与 C4b 六 carrier、Inbox UI 已合并；一期只做 team-level “Needs reply”，不做 per-member unread cursor。（源：PR #368–#381；`issues-361-453.md`） | 真实 WhatsApp 自助连接最终改判为 Meta Cloud API + Embedded Signup；#359 item 29 取代 Gupshup。真连接未由 digest 证明上线。（源：issue #301；issue #359 item 29；`issues-271-360.md`） |
| 4. Broadcast / Eligibility | 合法群发必须同时检查 permission、suppression、frequency 等资格，STOP 在发送瞬间硬拦。（源：issue #356；`issues-271-360.md`） | C5 的四轴 eligibility engine、Broadcast workbench 与模拟 provider execution 已合并。（源：PR #382–#394；commits `2c3f1d89`、`07ca184e`、`29d01de1`；`issues-361-453.md`） | Provider 是 simulated，`SEND_PATH_UNAVAILABLE` 全域封死；真外发不能从现有 digest 视为已完成。（源：`issues-271-360.md`；`issues-361-453.md`） |
| 5. Receipts / Reports | 每次外发都要有可核对回执、reconciliation、honest unknown 与报告；商家拥有数据。（源：issue #405；`docs/BLUEPRINT.md` §六） | C6 schema、reconciliation engine 与 honest-unknown delivery report UI 已合并。（源：PR #399–#413；commits `9dcf8078`、`6378279e`、`9a17412e`、`f2adffac`；`git-spine.md`） | 真 provider 不存在时只能显示 unknown；reply-rate attribution、terminal-state 选择、commerce carrier 等仍在 #405 §14 / #359 清单。（源：issue #405 §14；`issues-361-453.md`） |
| 6. Workflows / Routines | 可组合 trigger×condition×action，规则是人看得懂、改得动的数据；人和 Otto 操作同一引擎，激活仍需人授权。（源：Founder 2026-07-22 裁决；issue #414；`transcript-wt-orchestration-07ae75.md`） | 七个 workflow carriers、规则引擎、模拟执行、kill switch、journey monitor、UI 与 Otto read/draft skills 已合并。（源：PR #415、#418、#420、#422；commits `287fdde3`、`fabb61c4`、`44d28497`；`git-spine.md`） | UI commit 本身标记 `[DRAFT·待债批]`；archive/activate/kill/reauthorize 的 skill parity 债仍在 #359，真外部 action 也未通电。（源：commit `44d28497`；issue #359；`git-spine.md`；`issues-361-453.md`） |

### CRM 的共同断电点

即使 C1–C7 代码都已进 `main`，#359 item 12 仍被多次引用为 production-apply gate：生产数据库应用与备份 cadence 仍是 Unknown；C4b/C5/C6/C7 都不能因为 schema/engine/UI 合并就声称生产已上线。（源：issue #359 item 12；issue #405；`issues-361-453.md`）

#359 还明确延后了租户内细分 RBAC/隐私操作角色（等“团队协作+市政厅 v2”）、商家处置/erasure 工具与 enterprise 字段级加密/自管密钥；这些不是当前 C1–C7 已完成范围。（源：issue #359；Founder Resolution #356；`issues-271-360.md`）

### GAP SIZE：大

CRM 的“形”已经相当完整，但 respond.io 级产品的决定性事实是真 WhatsApp、自助连接、真实收发、回执与日常操作。当前主要是 provider-neutral code + simulated execution；它是优秀地基，不是已可售的完整 Customer Engagement CRM。（判断依据：`docs/BLUEPRINT.md` §六；issue #359 item 12/29；`issues-361-453.md`）

---

## 5. 排期 / 发布

### VISION

发布区对标 Buffer 三视图与 Metricool，但必须比它们多一条“创作车间直接进排期”的路。Blueprint v2.12 明确：Reminder-assisted 可以独立成为一期放行模式；Direct publish 只能按真正通过的 channel×post type 逐格点亮，提醒、权限到达或旧 queue 都不能冒充已发布。（源：`docs/BLUEPRINT.md` §六；Founder Resolution #334-8~10；PR #337）

### BUILT TODAY

- Buffer 式 Plan+Queue / Calendar / Queue 三视图、Composer、账号/媒体选择、时区、first comment、`ScheduledPost`、媒体连接表与 `PublishAttempt` 防双发已建；Otto `schedulePosts` 只起草 DRAFT，复用已经付费的媒体是 $0。（源：PR #123、#129；`docs/BLUEPRINT.md` §三区划图；`issues-91-180.md`）
- L1 Meta organic publish 基建、IG 媒体契约前置校验与 double-post 恢复修复曾经历事故重建，相关代码已合并但按历史记录仍受 App Review / 开关约束。（源：PR #215–#233；commit `09cd9060`、`64d43701`、`8a1c73e8`；`git-spine.md`）

### EXPLICITLY DEFERRED

- Direct Meta 仍要等 `instagram_content_publish`、`pages_manage_posts` 等真实权限；TikTok/Shopee/Lazada 只应按 adapter 增加，不改核心。（源：`docs/BLUEPRINT.md` §三区划图、§六）
- Digest 没有一份最终证据证明 Reminder-assisted 的完整用户流已经在最新主干真实走通；因此它只能记为“获准的放行形态”，不能记成“已验可用”。（源：Founder Resolution #334；`issues-271-360.md`；`issues-361-453.md`）
- X auto-posting 曾被 Founder 视为重要，但后续 Route-B 判决把 X 死链拆除；现有 digest 没有新的正式上线记录。（源：`transcript-main-940bfbd9.md`；PR #298；`issues-271-360.md`）
- 指定 digest 没有暴露一个专属于 Schedule Direct publish 的 #359 item 编号；外部权限断点有 Blueprint/PR 证据，但本文不把它伪装成已编号台账项。（源：`docs/BLUEPRINT.md` §三、§六；PR #215–#233；`issues-271-360.md`）

### GAP SIZE：大

排期工作台可用，发布地基也在，但第一期支柱要求的是“用户真的能按被支持的方式发出去”。在 Reminder-assisted 未有完整实证、Direct publish 又断电的情况下，gap 仍大。（判断依据：`docs/BLUEPRINT.md` §六；Founder Resolution #334）

---

## 6. 分析

### VISION

分析区以 Metricool 的 SMB 分析深度和 HubSpot 归因为参照；FIKIRTIVE 的胜负手是 Otto 主动洞察，以及真实投放结果反哺下一轮创作和 Campaign。（源：`docs/BLUEPRINT.md` §六对标地图）

### BUILT TODAY

- Meta ad-account KPI、reach 图、平台切换器、per-ad performance、赢家/输家分类和 Otto 诊断卡已建。（源：PR #116、#117、#128；`docs/BLUEPRINT.md` §三区划图）
- 诊断只和账户自身历史均值比较；ROAS 缺失就 abstain，每个结论带 source、period、fetch time，不假造行业 benchmark。（源：PR #128；`issues-91-180.md`）
- TikTok/Shopee/Google/WhatsApp 目前在早期快照中只是占位；Meta organic 与历史全量在当时仍受 App Review 或后续接线约束。（源：`docs/BLUEPRINT.md` §三区划图）

### EXPLICITLY DEFERRED

- O-10 的“诊断→Recreate/Try angle→真实生成”接线明确延后，因为会碰 spend。（源：PR #128；`issues-91-180.md`）
- E5-06/07 attribution wiring 在 #359，完成前显示 `attribution_unavailable`；reply-rate attribution methodology 也在 #405 §14 延后清单。（源：issue #359；issue #405 §14；`issues-271-360.md`；`issues-361-453.md`）
- 多平台真实数据、organic 全量、跨 Campaign 归因和 Metricool 级历史深度没有完成证据。（源：`docs/BLUEPRINT.md` §三区划图、§六；`docs-doctrine.md`）

### GAP SIZE：大（终局）；中（当前 Meta 诊断面）

Meta 单平台已经有可信的读与解释，但“全渠道大局观→建议→重造→发布→结果再学习”的循环没有闭合。（判断依据：`docs/BLUEPRINT.md` §六；PR #128；issue #359）

---

## 7. 资产 / 品牌

### VISION

资产区要达到 Canva Brand Kit 的易用度和 Adobe Brand Intelligence 的约束力，并进一步做到品牌记忆从用户批改中自养、每次生成自动校验品牌一致性。（源：`docs/BLUEPRINT.md` §六对标地图；O-04、C-08）

### BUILT TODAY

- Brand memory v2 已有六个 tab、living collections、BrandKit/BrandRule、产品档案与 Shopify-tag 式分类；产品 URL 可以用确定性 $0 路径预填草稿。（源：PR #52、#103、#113、#124；`issues-1-90.md`；`issues-91-180.md`）
- My Stuff、History/Library、Templates、Discover 已统一或挂上导航；Library 从 project-scoped 改为 owner-global，失败任务可恢复。（源：PR #129、#170；`docs/BLUEPRINT.md` §三区划图；`issues-91-180.md`）

### EXPLICITLY DEFERRED

- O-04 品牌记忆自养与 C-08 生成时品牌校验仍未见完成记录。（源：`docs/BLUEPRINT.md` §三区划图、§六）
- Feed import、persistent undo、offer-expiry reminder、generation-as-picker-source 等在 Brand memory v2 PR 中明确 out of scope。（源：PR #103；`issues-91-180.md`）
- 指定 digest 未证明 O-04/C-08 已进入 #359；Part 2 B5 因此只建议补登，不把建议写成既有台账事实。（源：issue #359 摘要；`issues-271-360.md`；`docs/BLUEPRINT.md` §三）

### GAP SIZE：中

资产存放、品牌资料和产品建档已经有可用主体；真正拉开差距的“越改越懂品牌”和“生成前后自动校验”仍缺。（判断依据：`docs/BLUEPRINT.md` §六；PR #103）

---

## 8. 计费

### VISION

商业结构是 seats + credits 双轨：功能全开，档位卖规模；MYR 为主货币并按市场差异定价；每个收费点毛利率至少 45%，目标 45–50%；通道费走独立账道，永不混进 credits；永远不卖 unlimited。开发/验证的每笔真实 provider spend 逐笔问 Founder，产品内用户花费则走审批公式与账本。（源：`docs/BLUEPRINT.md` §二第 2–5 条、§六）

### BUILT TODAY

- Credits ledger 已有 grant / reserve / settle / refund、幂等键和 exactly-once/fail-closed 约束；新 org 有 100 free credits，Account 可看余额与消费记录。（源：PR #11、#24、#37、#66、#131；`issues-1-90.md`；`docs/BLUEPRINT.md` §三区划图）
- Stripe MYR credit packs 与 webhook 已建；Otto turn、图、视频等成本已进入账本和 admin cost 视图。（源：PR #22/#25、#66、#131；`issues-1-90.md`；`issues-91-180.md`）
- 2026-07-04 costing 固化过 image、5s/10s video、reference video 和 Otto LLM 价格，10s video 当时正好压在 45% 地板；B10 margin gate 后续进入 CI。（源：PR #109、#131、#132；commit `d3f5cacd`；`issues-91-180.md`；`git-spine.md`）
- #430/#449 修复确认页“余额不可见、失败却显示成功”的钱路诚实问题；#453 仍记录一个已收费 video 缺 `taskId` 时错误类型不符合 `chargedError` 的 P3 money-adjacent bug。（源：issue #430、#453；PR #449；`issues-361-453.md`）

### EXPLICITLY DEFERRED

- Seat subscription、Stripe Phase 4、分市场价、credits rolling cap 的最终数字、channel-fee 第二账道，都没有完成证据。（源：`docs/BLUEPRINT.md` §六；`docs-doctrine.md`）
- BytePlus 资源包余量告警被 Blueprint 标为 P1 必做；历史警告是资源包用完会静默跳裸价，10s 毛利可能从 45% 降到 13%，但 digest 未见完成记录。（源：`docs/BLUEPRINT.md` §六；`docs-doctrine.md`）
- 商家数据 backup 付费 add-on 与 enterprise tier 曾被提出，但尚未定价或形成正式产品 spec。（源：`transcript-wt-mid-batch.md`；`transcript-wt-small-batch.md`）
- 指定 digest 未给 BytePlus 余量告警一个 #359 item 编号；Part 2 B8 是补登建议，不是既有编号的转述。（源：issue #359 摘要；`issues-271-360.md`；`docs-doctrine.md`）

### GAP SIZE：中偏大

Credits 收银和钱路安全已经很强，但 Blueprint 的利润主场是 Otto labor + seats，后者尚未落地；通道费与全球差异定价也未建。能收 credits 不等于商业模型完成。（判断依据：`docs/BLUEPRINT.md` §二第 5 条、§六）

---

## 9. 治理 / 围栏

### VISION

治理目标不是增加仪式，而是让弱模型也无法静默破坏钱路、租户隔离、Blueprint、Parity 或生产。现行原则包括：不直推 `main`、Blueprint 只走 §7、钱路 exactly-once/fail-closed、ownerId 绝对隔离、真实花费逐笔问、CI unavailable 不算绿、任务 write-set 有 claim、merge 要留下执行者证据。（源：`docs/BLUEPRINT.md` §二、§五、§七；PR #149、#180、#390、#406；`docs-doctrine.md`；`issues-361-453.md`）

### BUILT TODAY

- CI 已有 check/test/web-build/lint 的本地复现规则；schema drift、destructive migration、margin floor、Parity debt ratchet、Blueprint hash、provider secrecy 等已有机器 gate。（源：PR #100、#132、#149、#180、#444/#445、#454；`docs/runbooks/local-ci.md` 经 `docs-doctrine.md`；`git-spine.md`）
- Task ownership、model identity process evidence、evidence-pointer、merge-executor evidence 都已写入项目法或 playbook。（源：PR #390/#391、#404/#406；`issues-361-453.md`）
- Money safety、impersonation 禁写、tenant-scoped `requireOwner` 与 provider-neutral adapter/queue patterns 已成为审查基线。（源：PR #4、#14、#131；`docs/BLUEPRINT.md` §四；`issues-1-90.md`）

### EXPLICITLY DEFERRED / OPEN

- #320 发现 tenant guard 对 `update` / `delete` / `upsert` 存在约 69 个潜在调用点真空；#442 要把 auth guard fence 重写成 AST-level semantic gate，现有 regex 不能证明它声称的 invariant。（源：issue #320、#442；`issues-271-360.md`；`issues-361-453.md`）
- #423 仍有 CI test flakiness；#439–#441 仍有 aborted-transaction recovery、provider connection resolver、concurrent resume race 等开放问题。（源：issues #423、#439–#441；`issues-361-453.md`）
- #359 item 12 的 production backup cadence 仍是 Unknown，production apply 仍受 gate 控制。（源：issue #359 item 12；issue #405；`issues-361-453.md`）
- v2.13 的状态记录冲突：`git-spine.md` 记录 PR #444 已合并为 commit `281794ab`，live `docs/BLUEPRINT.md` 已显示第 9 条墓碑，但修订表仍写“待 founder 终审”；`docs-doctrine.md` 又把它描述成“尚未合并”。事实应按已合并 commit + live 正文理解，文书状态仍待后续权威回填核对。（源：commit `281794ab`；PR #444；`git-spine.md`；`docs/BLUEPRINT.md` §二第 9 条、§七；`docs-doctrine.md`）

### GAP SIZE：中

围栏的广度已经很强，但 tenant mutation 守卫和 auth fence 仍有“规则写了、机器未完全证明”的缺口；production backup/apply 状态也未闭合。这些不一定代表已有真实泄漏，却属于上线前不能含糊的系统性风险。（判断依据：issue #320、#359、#442）

---

# Part 2｜偏差与升级清单

> 使用方法：每项都是 Founder 的一张决策卡。本文只给证据、影响与建议归宿，不替 Founder 选择。

## A. 不符合逻辑 / 决定冲突

### A1｜Otto 的身份：AI 营销员工，还是不带营销定语的平台操作员？【大】

**证据。** Blueprint 的第一期叙事写“AI 营销员工”，并把 Otto 称为“营销界的 Claude Code”；2026-07-23 Founder 后续原话是「使用 skill 来协助用户就好，加多一个营销的那个有点不必要」，并要求身份回到“平台操作员、通过 skill 帮用户、先理解用户要什么”。（源：`docs/BLUEPRINT.md` §一、§六；issue #437 / #359；`transcript-wt-orchestration-50ba3d-current.md`）

**为什么重要。** 这是 onboarding、main prompt、导航文案、销售叙事与能力边界的共同根。两套身份同时存在，会让产品一边只服务 marketing outcome，一边又承诺开放式“任何用户需求”，最终让 skills、QA 与定价不知道按哪一套验收。

**建议归宿：BLUEPRINT §7 修宪提案。** 提案只需让 Founder 选择层级关系，例如“产品卖给商家的是 AI 营销员工；Otto 的底层身份是无营销定语的平台操作员”，或彻底删除营销身份。此处不代选。

### A2｜目标客户是商家，但 Otto 又不能预设用户是商家【大】

**证据。** Blueprint 把住户和第一期客户明确限定为马来西亚已有商品、社媒与老客的中小商家；Founder 2026-07-23 又说「otto 的任务是了解我们的用户需求，然后做出他们要的东西，而不是先判断用户都会是商家，这个是不一定的。」（源：`docs/BLUEPRINT.md` §一、§六；Founder Resolution #334-2；`transcript-wt-orchestration-50ba3d-current.md`）

**为什么重要。** “产品先服务谁”与“模型在每一轮可不可以先入为主”可以兼容，但目前没有一句权威边界把它们拆开。缺这句，Otto 可能过度泛化，也可能把非典型请求硬塞进商家模板。

**建议归宿：Founder Resolution 提案。** 建议 Founder 决定：市场与默认 onboarding 可以 merchant-first；Otto runtime 必须先读当前 org/context，再判断任务，不把 persona 写成不可变事实。

### A3｜研究能力目前像 Otto-only，但宪法说人工面无例外【中】

**证据。** 早期 Founder 原话是「除了好像研究数据那些一定要otto去研究lorh，毕竟如果用户自己研究，用户自己去google了对吧。」；Blueprint 后来明确“人工可完整操作无例外”，并把研究列入本体负责；现状快照主要记录 `researchWeb` / `proposeResearch` Otto skills，没有对应完整人工研究工作台的证据。（源：`transcript-wt-serene-swartz.md`；`docs/BLUEPRINT.md` §一边界四层表、§二第 7 条、§三区划图；PR #118）

**为什么重要。** 这不是“用户要不要自己 Google”的问题，而是付费 seats 与审计能力：人需要查看来源、编辑 research brief、重跑、保存和比较结果，Otto 才不是唯一入口。

**建议归宿：#359 台账项。** 建议登记“Research 人工工作台 + read/write parity”，不改研究由 Otto 代劳的体验优势。

### A4｜生成花费到底是“点 OK 再花钱”，还是“submit 本身就是批准”？【大】

**证据。** Founder 早期硬规则是「点 ok 再花钱」；PR #178/#191 又以“余额即闸”允许 direct image submit 不再弹二次确认；Blueprint 只把 turn metering（Otto LLM/search）列为明确例外，而生成属于 spend action；#430/#449 最新又加强了确认页诚实层。（源：PR #88、#178、#191、#449；`issues-1-90.md`；`issues-91-180.md`；`docs/BLUEPRINT.md` §二第 3/4 条；`issues-361-453.md`）

**为什么重要。** 同一个 Canvas 若有的动作直接烧 credits、有的必须确认，用户很难形成可靠心智；工程也会把“approval event”写在不同层，增加绕闸风险。

**建议归宿：Founder Resolution 提案。** 请 Founder 针对每种 spend surface 选择唯一语义：显式确认页、带明确价格的 submit 即批准，或 routine 预授权；然后写成一张 action→approval matrix。

### A5｜“不硬删证据链”与“商家可删除自己的数据”缺一张 carrier 矩阵【大】

**证据。** #356 裁定 consent/permission 事件是商家资产，平台不代删，第一期只 tag/remind，硬删除会破坏 append-only 证据链；#405 又裁定 delivery receipts 默认 24 个月，商家可调整、关闭、手动删除/导出；Founder 总原则是「商家的 data，商家的权利，我们只是提醒。」（源：issue #356、#405；PR #364；`issues-271-360.md`；`issues-361-453.md`）

**为什么重要。** Consent evidence、联系人主档、消息内容、回执、备份并不是同一种数据。没有 carrier-by-carrier 表，团队会把“商家权利”错误地实现成全部硬删，或把“证据链”错误地扩大成永不删除所有数据。

**建议归宿：Founder Resolution 提案。** 产出一张每类数据的 owner、retention、export、soft-delete、anonymize、hard-delete、backup expiry、legal hold 决策表，再让 schema 跟表走。

### A6｜Provider 保密与对外披露的边界仍有互相矛盾的记录【中】

**证据。** #436 Founder Resolution 要求所有用户可见 UI/error/email/export/API 隐去 Seedance/Seedream/BytePlus，并把 privacy-policy 具名问题留给 Founder；后续 transcript 又记录 Founder 说不做法律权衡、privacy page 改成类别表述；`git-spine.md` 记录 #454 已合并 secrecy fix，但 digest 没有逐面证明 public policy 的最终文字。（源：issue #436；PR #454；commit `50e1ab95`；`issues-271-360.md`；`issues-361-453.md`）

**为什么重要。** 商业机密、用户透明与政策文字必须有一个可审计边界；如果只靠“不要显示名字”，以后换 provider 或发生事故时会再次争论。

**建议归宿：Founder Resolution 提案。** 只决定披露层级：用户操作面不具名；法务/隐私/事故通知按类别、处理目的和地区要求披露到什么程度。本文不作法律结论。

### A7｜v2.13 已合并，但修订表与 digest 仍显示“待终审”【小】

**证据。** PR #444 已由 commit `281794ab` 进入主干，live Blueprint 也已经是第 9 条墓碑；同一文件修订表与 `docs-doctrine.md` 却仍写“待 founder 终审 / 尚未合并”。（源：PR #444；commit `281794ab`；`git-spine.md`；`docs/BLUEPRINT.md` §二第 9 条、§七；`docs-doctrine.md`）

**为什么重要。** 这会让以后 agent 不知道 prompt language 规则到底已退宪还是仍待批。

**建议归宿：#359 台账项。** 在下一次合法 Blueprint amendment 按 §7 的“下一修订回填”规则修正文书，并同步更新 doctrine 摘要；不要为这项单独改宪法内容。

### A8｜“一次建完整座城再上市”与“三支柱第一期”曾经冲突，但已被后法解决【大】

**证据。** 2026-07-11 Route-B Founder 原话是「我要路线乙」「直接把全部function 做和test」；2026-07-15 #334 随后把第一期收敛为内容、发布、完整 CRM 三支柱，PR #337 将其写进 Blueprint，并明确施工波次不等于商业第一期。（源：`transcript-wt-small-batch.md`；Founder Resolution #334；PR #337；`docs/BLUEPRINT.md` §六）

**为什么重要。** 这是历史上最容易复活的 scope confusion：Route-B 是建设方法，不再是“全部终局 feature 都必须等齐才可卖”的商业 gate。

**建议归宿：无需行动存档。** 后来的 Blueprint v2.12 已 supersede 旧解释；本项保留只是防止未来回滚。

### A9｜“只要 direct integration，不做 workaround”与 Reminder-assisted 发布曾冲突，但已被后法解决【中】

**证据。** Founder 2026-07-14 曾说手动过渡“多此一举，我要的是直接接入”；同日正式判决又把提醒式发布列为 v1，后续 #334 / Blueprint v2.12 明确 Reminder-assisted 可独立验收。（源：`transcript-wt-mid-batch.md`；PR #298；Founder Resolution #334；`docs/BLUEPRINT.md` §六）

**为什么重要。** Reminder-assisted 是正式一期模式，不应被误写成失败 fallback；Direct publish 也不能因提醒存在而被永久放弃。

**建议归宿：无需行动存档。** 现行 Blueprint 已给出清楚的双层答案。

### A10｜早期“CI 可以 skip / $25 内不用问 / standing merge delegation”都不再是现行权限【大】

**证据。** 历史 transcript 曾记录「这个阶段skip CI吧」「上限只要在25美金之内，不需问我」和 Route-B standing merge delegation；后续项目法要求 CI unavailable 不是绿、真实开发花费逐笔问、没有 standing merge authority，并增加 merge executor evidence。（源：`transcript-wt-small-batch.md`；PR #254、#390、#406；`docs/BLUEPRINT.md` §二第 2 条；`docs/runbooks/local-ci.md` 经 `docs-doctrine.md`；`issues-361-453.md`）

**为什么重要。** 旧会话授权如果被当成永久 precedent，会直接破坏钱路、CI 与 merge governance。

**建议归宿：无需行动存档。** 后来的项目法已 supersede；档案要保留“旧授权不可复用”的结论。

## B. 历史显示有更好形状，但当前还没完全兑现

### B1｜把“品类一流内容”变成可重复的证据包，而不是最好样片【大】

**证据。** #334 已给五关，并明确最好样片、provider success、文件可开、单测都不算；Founder 2026-07-23 仍问 Canvas 完成时能否匹敌 reference，说明答案尚未被证据关闭。（源：Founder Resolution #334-5~7；`docs/BLUEPRINT.md` §六；`transcript-wt-orchestration-50ba3d-current.md`）

**为什么重要。** 创作是第一期首支柱，也是 credits 最直接的购买理由。没有重复性证据，会把“功能多”误判成“内容好”。

**建议归宿：Founder Resolution 提案。** 请 Founder 批准一份证据协议：覆盖顾客一号与若干不同品类、固定任务集、品牌/渠道约束、可直接采用程度、重复运行稳定性与失败样本；具体阈值由 Founder 单独批准。

### B2｜North Star 的真正教训是“一个连贯 app + 一条共享数据脊柱”，不是多页壳【中】

**证据。** 2026-07-08 Founder 判断 Northstar Immersive「拼凑看起来并不整齐」；审计确认 34/57 routes 是旧 gallery 页面套壳，随后改成先写 `IMMERSIVE-COMPOSITION-BLUEPRINT.md`、共享 Roti Bulan 数据脊柱、再重建。后来的 Route-B 也把 shell-to-real debt 明确记账。（源：`transcript-main-rest.md`；commits `a11dd368` 至 `62360aac`；`git-spine.md`）

**为什么重要。** FIKIRTIVE 的卖点是生态连续性；每页单独漂亮仍可能在跨区任务中断裂。

**建议归宿：无需行动存档。** #424 的全产品 user-flow campaign 已承接这个教训；未来验收必须继续按旅程而不是按页面。

### B3｜CRM 已采用更好的 provider-neutral carriers，但还差 Meta 自助连接的真通电【大】

**证据。** Gupshup 起步方案被 2026-07-21 Founder decision supersede：最终路线是 Meta Cloud API Tech Provider + Embedded Signup，号码和数据属于商家自己的 Business Manager；C4–C7 的 physical contracts 已按 provider-neutral carrier 建好。（源：issue #301；issue #359 item 29；PR #368–#422；`issues-271-360.md`；`issues-361-453.md`）

**为什么重要。** 这个形状同时满足可替换供应商、商家数据权利和零后台搬运；不通电时 CRM 只能演示，不能交付。

**建议归宿：#359 台账项。** 保留 item 29 为 launch-blocking integration，明确以真实 merchant self-connect、真实 inbound/outbound、STOP、receipt 为验收。

### B4｜Meta 诊断已经可信，但“洞察→重造→发布→结果学习”没有闭环【中】

**证据。** #128 已有账户自身均值、带来源诊断；“Recreate/Try angle”到 generate 的 spend 接线被明确延期；attribution wiring 也在 #359。（源：PR #128；issue #359；`issues-91-180.md`；`issues-271-360.md`）

**为什么重要。** 只告诉老板“哪个广告差”仍是报表；自动把真表现变成下一轮更好内容，才是 Otto 的差异化。

**建议归宿：#359 台账项。** 建议将 O-10 remake wiring 与 E5 attribution 合并成一条可验的 learning loop，而不是两个孤立 ticket。

### B5｜品牌记忆已有资料库，但还没成为“越用越懂”的约束引擎【中】

**证据。** Brand memory v2、Product URL ingest 和 BrandRule 已建；Blueprint 对标胜负手仍是 O-04 自养与 C-08 生成时校验，现状快照把它们列为待建。（源：PR #103、#124；`docs/BLUEPRINT.md` §三、§六）

**为什么重要。** 没有反馈学习和生成校验，Brand memory 只是结构化资料，不是护城河。

**建议归宿：#359 台账项。** 以后按“用户修改→候选品牌规则→用户确认→版本化→生成前/后校验”设计，不允许 Otto 静默改品牌事实。

### B6｜租户安全从 regex gate 升级成 AST semantic gate【大】

**证据。** #320 找到 `update/delete/upsert` 约 69 个潜在守卫真空；#442 记录现有 auth fence 有 false-green，无法证明 invariant。（源：issue #320、#442；`issues-271-360.md`；`issues-361-453.md`）

**为什么重要。** Blueprint 把跨租户读写定义为事故；“代码大多有 ownerId”不足以证明所有 mutation 安全。

**建议归宿：#359 台账项。** 将 #320 全量审计、CHECKED_OPS 翻闸和 #442 AST gate 作为同一安全里程碑，不允许拆成“先开 gate、以后再修误报”。

### B7｜C7 的开放式可组合规则形状是对的，但 activation parity 尚未收口【中】

**证据。** Founder 要求“聪明且开放”，历史把它命名为 composability、extensibility、declarative rules engine；七 carrier 与模拟 engine 已建，但 activate/kill/reauthorize 等 Otto parity 债仍在 #359。（源：issue #414；PR #418/#420/#422；issue #359；`transcript-wt-orchestration-07ae75.md`）

**为什么重要。** 若 workflow 只能看/草拟，Otto 还不是完整操作员；若 Otto 可静默激活，又违反审批信任阶梯。

**建议归宿：Founder Resolution 提案。** 请 Founder 明确“Otto 可调用动作”与“必须由人完成授权事件”的分界，然后把 skill parity 和 audit receipt 一次收口。

### B8｜BytePlus 资源包告警是小功能、大财务保护【中】

**证据。** Blueprint 明列 P1 必做，历史 costing 指出 10s video 在资源包内约 45% 毛利，资源包耗尽跳裸价可能降至 13%；digest 未见完成记录。（源：`docs/BLUEPRINT.md` §六；`docs-doctrine.md`）

**为什么重要。** 它不会改善 demo，却能防止产品在用户增长时越卖越亏，正符合“margin 赚倍率、不赚浪费”。

**建议归宿：#359 台账项。** 在任何真实规模 generation 前完成余额/套餐余量监控、阈值告警与 fail-closed 售价复核。

## C. 对标与形容词要 sharpen

### C1｜把“Grok 那种体验”拆成可验收的七个词【大】

**证据。** Founder 多次说「我要的就是grok 那种的体验」，也具体提到 canvas、stateful、Projects/history、选中资产继续生成、`Type to imagine` 与整体连贯；历史同时明确拒绝字面复制 Grok 的 unlimited、外部 MCP 和整个产品边界。（源：`transcript-main-7fcd6fd4.md`；`transcript-main-940bfbd9.md`；PR #70–#73、#178/#191；`docs-doctrine.md`）

**为什么重要。** “像 Grok”无法直接测试，也会诱发复制不符合 FIKIRTIVE 宪法的功能。

**建议归宿：Founder Resolution 提案。** 建议让 Founder 逐词确认：  
1. **Stateful**：project、history、assets、selection 重开仍连续；  
2. **Direct**：在选中对象旁就能继续创作，不绕页面；  
3. **Contextual**：“把这个改成 9:16”能解析“这个”；  
4. **Continuous**：chat、canvas、history 是同一条工作流；  
5. **Visible**：Otto 动作秒级 live reflection；  
6. **Recoverable**：付费任务失败可理解、可恢复、不丢卡；  
7. **Bounded**：保留 credits、审批、租户隔离与 FIKIRTIVE 自己的产品边界。  
这些是提案词，不是本档案替 Founder 定案。

### C2｜“Apple”不够：应拆成 Apple craft、Stripe SaaS clarity、Headspace warmth【中】

**证据。** Blueprint §11 只写质感标杆 Apple；Founder 后来明确说 Apple 不是 SaaS tool 的完整参照，并说「我认为stripe 那种概念也很适合，我很喜欢」，同时历史设计方向多次提到 Headspace / “mindspace” feeling。（源：`docs/BLUEPRINT.md` §二第 11 条；`transcript-main-7fcd6fd4.md`；`transcript-main-940bfbd9.md`；`transcript-wt-serene-swartz.md`）

**为什么重要。** Apple 可以约束 craft，却不能独自回答 dense table、filters、bulk actions、billing、permission 与 empty states 怎么做。

**建议归宿：BLUEPRINT §7 修宪提案。** 不必删除 Apple；可请 Founder 决定是否把标杆拆成“Apple 的精致与物理感 + Stripe 的 SaaS 信息清晰 + Headspace 的人性温度”，并保留 Analytics 屏为内部 gold standard。

### C3｜“respond.io 级 CRM”要变成六大件 acceptance matrix【大】

**证据。** Blueprint 已列 Contacts/Segments/Inbox/Broadcast/Workflows/Receipts 等类别，但当前 C1–C7 大量为模拟 execution；Founder 仍在 2026-07-23 补 tags/custom fields、auto-reply、merge、recipes 四个 parity 决定。（源：`docs/BLUEPRINT.md` §六；issues #361–#422；issue #359；`issues-271-360.md`）

**为什么重要。** “页面数量相同”不是 parity；真实渠道、搜索/分派、STOP、资格、回执、重试、权限、Otto parity 才是体验完整度。

**建议归宿：Founder Resolution 提案。** 建议将本文 CRM 六大件表升级成逐行验收矩阵，每行至少含 human flow、Otto flow、真实 provider、error/recovery、tenant/privacy、receipt 六列。

### C4｜“品类一流”要从形容词变成五关的可重复阈值【大】

**证据。** #334 已说明五关与反例，但没有在 digest 中看到 Founder 批准的数字门；Blueprint 也说详细数字门由对齐后的计划承接，不能静默降低。（源：Founder Resolution #334；PR #337；`docs/BLUEPRINT.md` §六）

**为什么重要。** 没有阈值，任何团队都能拿一张最好样片宣称“world-class”。

**建议归宿：Founder Resolution 提案。** 让 Founder 一次批准样本规模、商家/品类覆盖、直接采用率、允许的偏好修改范围、品牌错误容忍与 repeatability；数字不应由本档案发明。

### C5｜“丝滑、零学习曲线、无 AI slop”要落成旅程级检查【中】

**证据。** Blueprint 的零学习曲线三查是 Otto 一键入口、人工面自解释、一次会话见成果；Founder 的 QA 原话又要求不只看通不通，还看合理性、实用性、设计与最终效果，并坚持上线前完整 UIUX user-flow test。（源：`docs/BLUEPRINT.md` §二第 11 条；issue #424；`transcript-main-7fcd6fd4.md`；`transcript-wt-orchestration-07ae75.md`）

**为什么重要。** “slop”是评语，不是 gate；同一页漂亮也可能在登录→建品牌→出内容→批准→发布→看回执的旅程中断裂。

**建议归宿：Founder Resolution 提案。** 建议确认五个可观察词：**一眼懂、一步有下一步、不中断上下文、错误说人话并可恢复、一次会话见真成果**；再让 #424 按真实旅程逐项留证。

### C6｜“专业 Campaign”要拆成九件可核对交付物【大】

**证据。** Founder 要的是 Otto 研究趋势并设计跨数日/月 campaign；Blueprint 要独立对象、预算、编排、UTM、归因与报告；现状只有 base/确认地基和分散模块。（源：`transcript-main-7fcd6fd4.md`；`docs/BLUEPRINT.md` §六；commit `0613e961`；PR #398/#449）

**为什么重要。** 没有交付物清单，“专业”会退化成一段 AI 文案或 calendar mock。

**建议归宿：Founder Resolution 提案。** 可请 Founder 逐项确认：目标、受众、证据化 research、核心创意、channel/content plan、预算与总价、审批信封、真实执行 receipts、归因与下一轮建议。

### C7｜“Metricool 最强 / 全渠道大局观”要按层级点亮【中】

**证据。** 当前只有 Meta account/per-ad 分析是真实主面，其他平台早期是占位，归因仍在 #359；Blueprint 却用 Metricool 和 HubSpot attribution 作终局标杆。（源：PR #116/#117/#128；issue #359；`docs/BLUEPRINT.md` §三、§六）

**为什么重要。** 若没有 channel×metric×history×attribution 覆盖表，“Analytics 已完成”与“Meta diagnostics 已完成”会被混写。

**建议归宿：#359 台账项。** 建议建立逐平台点亮矩阵：数据接入、历史深度、organic/paid、campaign attribution、Otto insight、remake loop；未通电格一律显示 Coming soon / unavailable。

---

# 3. 建议 Founder 的查看顺序（只是排队，不是裁决）

1. **A1 Otto 身份**：它会影响 prompt、onboarding、销售叙事和所有 skill 的边界。（证据：`docs/BLUEPRINT.md` §一、§六；issue #437）
2. **A4 生成审批语义**：它直接碰钱路与用户信任。（证据：PR #88、#191、#449；`docs/BLUEPRINT.md` §二第 3/4 条）
3. **A5 数据 carrier 矩阵**：它会决定 CRM schema、privacy tools、backup 和删除行为。（证据：issue #356、#405、#359）
4. **C4 品类一流证据门**：它决定创作支柱何时真的可卖。（证据：Founder Resolution #334；PR #337）
5. **C3 respond.io 六大件矩阵**：它决定 CRM 是否真的达到第一期终点。（证据：`docs/BLUEPRINT.md` §六；PR #361–#422）
6. **C1 Grok 七词**：它决定 Canvas 是“像”还是“可验收地达到那种体验”。（证据：PR #70–#73、#191；`transcript-main-7fcd6fd4.md`）

---

# 4. 一句话状态

FIKIRTIVE 已经不是“只有愿景的原型”：它有真实 Canvas、Otto skill/action 地基、credits/Stripe、Meta diagnostics、Schedule 工作台和 CRM C1–C7 主体；但它也还不是 Blueprint 定义的可售第一期，因为内容质量证据、真正发布、真实 WhatsApp Customer Engagement CRM 三条仍未同时闭环。（源：`git-spine.md`；`docs/BLUEPRINT.md` §六；Founder Resolution #334；issue #359；issue #424）

最重要的下一步不是再加更多页面，而是把已经决定的三支柱各自变成“真实、可重复、有回执”的闭环，同时请 Founder 先解决 Otto 身份、生成审批与数据生命周期三张大决策卡。（分析依据：`docs/BLUEPRINT.md` §六；Part 2 A1/A4/A5）
