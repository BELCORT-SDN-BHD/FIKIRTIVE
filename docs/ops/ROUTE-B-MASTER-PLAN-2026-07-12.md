# 直建全城 · 总计划 v1.1（#334 / Blueprint v2.12 对齐；Founder 合并本 PR 即生效）

> **冻结记录(founder 原话)**:①范围宪章「照签」(§二提案表即签认版:CRM 最小版真建、Campaign 一期真建、协作/订阅挂壳、TikTok/email/Agency/市政厅v2/手机App 不在本程);②Q1 细化=「A 只收 credits(seats 之后再讨论)」→ 订阅层=壳+Coming soon;③Q4 细化=「材料先办、**受审面就绪就递**」(验证类前置归材料施工期办;递交触发=B4/B5/B6+法务页就绪,不等全城收口);④合并窗口「接受」(每 2-3 周一次法定放行,非产品验收);⑤**email=挂壳 Coming soon**(宪章 email 行由「不在本程」改为「壳」)。
> 另两条通用规则已入 §〇:Q6(≥3 次未达攒批)、Q7(意外 blocker 跳过攒批)。本文件即新总指挥的执行合同。

> 2026-07-12。v0.2 经 Sol(ultra)+ Fable(max)盲审,两脑一致「结构可执行,但五个阻断级问题修复前不得开 loop」。本版全部吸收。
> Provenance:sol memo SHA 见 planreview-sol-out/provenance.json;fable 同;两脑同 prompt 盲审。
> **v0.2 的全部旧句以本版为准;凡与本版冲突的历史文本(含点亮章三处被六裁决 supersede 的条款)以本版 §九 改判表为准。**

> **2026-07-16 对齐修订（D-038）**：Founder 在 #334 逐项重确认产品方向与第一期完成门，并以 PR #337 将 Blueprint v2.12 合入 `main`。本文件仍是原 Route-B 总计划，不另建 roadmap；凡本文件、B4/B8 旧 spec、设计底稿、拆票计划或历史票与本修订冲突，以 #334 Resolution、Blueprint v2.12 与本文件「七·甲」为准。
> **执行边界**：本修订只对齐计划和验收口径，不修改产品、schema、钱路、provider 或 global config。产品继续冻结；#327/#328/#329 保持原 head/diff，不因本计划修订自动恢复施工。
> **当前控制与权限**：本文 2026-07-12 的「新 session / Q5 / 总指挥 / 合并窗口」文字只保留历史 provenance；当前执行与 merge 权限以仓库 `AGENTS.md`、FIKIRTIVE orchestration overlay 和当前 GitHub 票为准。#331 只是一条有界 sanitation coordinator，不是 FIKIRTIVE global control plane，也不取得产品、merge、spend、deployment、Blueprint 或 destructive-cleanup 权限。

## 〇、Founder 七裁决(已并入,方向不复议)

Q1 建/卖两图配对（2026-07-16 再对齐：卖图 = 内容、发布、完整 Customer Engagement CRM 三支柱及生产闸全部通过，不等全城；任何单支柱通过不得局部宣称一期完成） / Q2 最终一次总验收+每块详细报告 / Q3 一次性总批+开跑前收齐已知必需供给 / Q4 验证材料施工期先办、受审面就绪即递 / Q5 新 session 唯一控制面（2026-07-12 历史安排；当前 authority 见上方 D-038 注） / Q6 死磕 100%,≥3 次未达进待裁清单攒批 / Q7 意外 blocker 跳过继续,攒批一次报。

## 一、B0 · 发布契约与覆盖矩阵(Sol 阻断 #1 —— 开 loop 的先决条件)

新总指挥的第一个工单不是施工,是**把「全城」冻结成有限清单**:
- 逐条建立 `功能ID → 批准来源(蓝图/判决/舱单) → 所属块 → 人工入口 → Otto skill → 权限/花费闸 → 测试 → 报告 → 六级状态`;
- 来源穷举:蓝图第六章全部区、MASTERPLAN 全章、A′ 舱单 65 页、MISSING-CONTINENTS 前五、宪法 11 条、九缝;每项要么入块、要么进宪章「不在本程」;
- **六级状态(Sol)**:`spec-ready → code-complete → sandbox-verified → review-submitted → live-verified → release-certified`;「建毕」一词废除;founder 总验收只认最后一级(外部位块的 live-verified 在通电后补)。

## 二、范围宪章(Fable 1a —— founder 签认件,开 loop 前置)

蓝图第六章每区三选一(下为**提案**,founder 可改;签认即冻结,终验以此为界):

| 区 | 提案处置 |
|---|---|
| 创作/资产/排期发布/分析/量测/Customer Engagement CRM/缺失大陆前五 | **按建城图继续真点亮**(B2-B8)；商业一期只认「七·甲」三支柱纵切 |
| Campaign 管理(独立 Campaign 对象+工作台+日历+Broadcast 归组与回执) | **第一期 Customer Engagement CRM 的组成部分**；B8 八行只是底座，不是独立上市点 |
| Customer Engagement CRM | **第一期完整真点亮**：Contact/Identity、导入去重合并、字段/tags、动态 Segments、Lifecycle、Inbox/历史/搜索/分派、Campaign/Broadcast、Workflows、人工/Otto 接手、退订、回执与报告；老客唤回只是内建 playbook |
| 订阅层/席位(宪法 5 双轨) | **壳+Coming soon**；第一期只使用现有 credits 轨，seats 以后另议（Q1 已裁） |
| 团队协作+审批流(租户 RBAC) | **壳+Coming soon**(单商家上市不阻断;宪法 7 债记入宪章) |
| 生命周期自动化(Workflow/旅程/频控) | **第一期 Customer Engagement CRM 批准范围内真点亮**；超出该范围的全城 routine 深化后续继续 |
| TikTok/Lazada/Shopee 顾客渠道、Customer Email marketing、Agency 楼层、市政厅 v2、手机 App | **不阻塞第一期**；Customer Email marketing 与其他顾客渠道各自真验后点亮。FIKIRTIVE→商家的可选发布提醒 Email 属 B4，不等于 Customer Email marketing |
| 账务透明明细(判决「要」纯只读) | **真点亮**(小,B10 并) |

## 三、范围表 v3(修正后)

- **B0** 发布契约与覆盖矩阵(先决)
- **B1** A′ 壳 8 切片(**切片顺序按 lane2 需求重排**:创作七页最先→排期发布→收件箱→回执;Fable 2)
- **B2** 量测 L0(含 QR 第一米,与 B8 线下 QR 并块设计)
- **B3** 创作 L-C(spec 已有)
- **B4** 发布 L1（历史 Direct/Meta 批次已落地；D-038 扩展后的 Reminder-assisted + Direct 尚未 code-complete 或 release-certified。恢复施工后可与 B3 并行起证，不据旧状态提前宣称完成）
- **B5** Customer Engagement Inbox + 顾客渠道 L2（第一期只要求 WhatsApp 真上线；Gupshup 是首 adapter，不是核心依赖；核心按可替换 channel contract）
- **B6** 统一回执 L3 + 经营事实 connector seam（EasyStore 仅可选只读 adapter；无 EasyStore 也不阻塞核心 CRM）
- **B7** Customer Engagement Lifecycle / Broadcast / Workflows（老客唤回=内建 playbook；商家定名单，平台执行已知 STOP/退订/DND/供应商硬限制）
- **B8** 缺失大陆前五(**修正:线下 QR/口碑/Marketplace 站内/link-in-bio/WhatsApp Status**;GBP 归并行泳道薄试;口碑内置「请评×奖励永久分离」)+ Campaign 与 Contact/Segment **底座切片**。原 B0-51～61 不再代表完整商业一期；完整 CRM 是 B5/B6/B7/B8+B2 的跨块产品支柱，映射见「七·甲」。
- **B9** 引擎横切:上下文桥+分域装载**先行并冻结引擎接口**;**84 条对等债与 Otto 契约随块清**(每块完成=该块 parity 清零,禁新增债的闸即刻上);B11 从「最后建」降为「最后只验」(Sol 阻断 #4 / Fable 倒退警告)
- **B10** 安全带全量(P0 六项全:补 P0-1 备份收尾+Neon window、P0-5 parity 盲区、毛利地板数值 gate、BytePlus 余量告警、R2 迁移=founder 排期)
- **B11** 全城联验(golden journeys 逐块生长、夜跑;**Otto 联验写死生产档模型 sonnet 级**——宪法 10,用 Fable 测 Otto = 质量幻觉)
- **B12** 收钱三闸 + 真实 Stripe 收款记录
- **B13** 发射台(Fable 1c):生产割接(env 对账/迁移重放/备份+回滚/域名 SSL webhook/烟测)+ 监控告警 + **法务面(隐私政策/ToS/数据删除回调——Meta App Review 硬前置,施工期完成文本、founder 批)** + PDPA 姿态
- **横切两块(Sol)**:数据信任合规(RBAC/tenant/审计/同意/保留删除导出/防注入/Otto 权限边界——含审计遗留:Otto 外部内容防注入标注)与生产运营就绪(SLO/DLQ 消费者/告警/成本与 ≥45% 数值证明)——并入 B10/B13 验收维度,不另立块。

## 四、顺序 v3(吸收两脑修正)

1. **B0 + 宪章签认 + 供给收齐 + 控制面 fencing**(第一周)
2. B10 关键安全 + B9 引擎接口冻结 + B2 数据契约(事件/身份/同意)
3. **先闭合 R-010，再重排 B8 设计全图**：#314 已落 schema 与 B2 v1.2 冻结契约在 ContactIdentity 唯一键、consent 存证、Campaign UTM 三处互斥；D-038 不替 Founder 选择 schema。相关施工须先经一张独立 Founder-approved schema alignment 明确逐项真源与迁移策略；在此之前保留已证底座，但不得从旧 11 行拆票计划恢复施工。冲突闭合后再补齐完整 Customer Engagement CRM 的跨块覆盖与验收映射
4. 纵向切片施工:每块 = UI+后台+人工入口+Otto skill+测试+报告**一次完成**(双执行器出生即配,Sol 阻断 #4 的根治)
5. B4 Reminder-assisted 可先独立验收；Direct Meta 按 channel × post type 单独通电。B5/B6/B7 依统一 connector/channel contract 汇成完整 CRM，不以 EasyStore 到位为前提
6. 三支柱在同一 release SHA 通过「七·甲」→ **冻结第一期 application-ready RC** → founder 递审批次(见 §八)→ 等待期跑 B11 联验/B12 非 live 部分/报告汇编/割接演练
7. 外部位到达 → 只重验受影响能力格 → 冻结最终 RC → **founder 一次第一期产品总验收**(验收期间禁止合并)；全城其余板块继续后续建设，不把第一期验收冒充全城完工

## 五、治理模型(Sol 阻断 #2 的解——推荐项,founder 确认)

- 「最终一次验收」= **一次产品验收**,不是「founder 只出现一次」。founder-only / disputed 合并（schema/钱路/治理/生产等）可集中进预排窗口；普通、可逆 PR 仅在 `AGENTS.md` 当前 delegated-merge 条件全部成立时由非作者执行，不占 Founder 排程，也不设 auto-merge / merge watcher。本 D-038 计划修订本身是 Founder-only。外部递交一坐(Q4);终验一坐。中途绝对零接触的替代方案(integration branch 数月分叉)已评估为高风险次优,不推荐。
- **待裁清单准入(Sol)**:只收「下游不建立在其上」的隔离项;涉共享契约/钱/tenant/安全/品牌/申请材料/发布范围的问题**不得挂起攒批**，立即停在该决定前并呈 Founder；不由 coordinator 代裁。
- **总指挥 = 办公室不是会话(Fable)**:epoch+租约+单写者 fencing;五本账(范围矩阵/依赖状态/决策日志/风险待裁/证据清单)全在 repo;**每 N 块换届 + 第 1 块末尾故意换届演练**(冷恢复证明:新 session 仅凭 repo 状态可接任);block owner / 异族 reviewer / integrator / merger 四权分离,总指挥实质编辑过的 diff 不得由其合并。
- **advisor 降级协议**照状态账范式写死(2026-07-11 incident 先例)。

## 六、水准判官(Fable TL;DR 5 / Sol #6)

每块 spec 先冻结**对标锚清单**(对标对象+版本+关键旅程+通过阈值+并排截图打分法);效果过堂对锚评;「≥3 次尝试」= 三种有证据的不同方案(非机械重试),受时间+信封约束;无锚不开工。

## 七、板块报告标准(两脑合并,= 终验讲解稿同构)

十四节:①块 ID/PR/最终 SHA/认证日期 ②批准范围+明示排除+映射(MASTERPLAN/宪法/缝) ③**功能清单非页面清单** ④双执行矩阵(人工路径+Otto 话术逐条,含设置/异常/取消/花费确认) ⑤对标锚三栏(平齐/超过/未及→链待裁) ⑥全旅程证据(happy/empty/loading/denied/failure/retry/mobile) ⑦测试全家桶可重跑链接 ⑧schema/ownerId/审计/同意/秘密 ⑨成本延迟 margin 监控回滚 ⑩上下游契约+外部位状态+通电步骤 ⑪异族评审 P0/P1=0 ⑫已知限制待裁(没有写「无」) ⑬录像时间码+截图+**founder 10 分钟自查脚本**(终验日=跑脚本非读散文) ⑭定稿后 delta(触碰即重认证)。
**合集三层(Sol)**:一页 release cockpit → 数条跨块 golden journey 演示 → 十二+份详细报告附件。报告**随块定稿、增量投递给 founder(只读不需批)**,终验=确认不是发现日。

## 七·甲、商业第一期 release contract（#334 / Blueprint v2.12）

### A. 三支柱与现有块的唯一映射

- **产品本体**：FIKIRTIVE 是商家可亲手使用的营销与增长平台；Otto 是在平台内使用同一套真实工具的 AI 营销员工，不是第二套 app 或绕过平台的聊天壳。第一期目标是马来西亚已有商品/素材、社媒账号与顾客基础、但没有完整营销团队的老板/极小团队；Saranghaeyo 是顾客一号，不是永久行业边界。
- **工作承诺**：Otto 应像精明能干的员工一样先理解商家、目标和限制，想清策略、清单、总价与关键取舍，再让老板对一个 request 一次批准并执行到底；过程、接手、真实状态、成果、费用与 receipt 可见。诚实是安全底线，不是降低判断力、执行力或结果质量的借口。

| 商业支柱 | 现有 Route-B 承载 | 完成解释 |
|---|---|---|
| 品类一流的营销内容 | B3 创作/资产 + B9 Otto 引擎 + B11 纵向联验 | 文案、图片、短视频、Pack、Storyboard 同时过理解/判断/手艺/采用/证据五关；Factory 第一期 Coming soon |
| 真正可用的发布 | B4；Reminder-assisted 由 E4-01/E4-05/B0-28/B0-29 的排期、通知投递 seam、冻结 posting pack、提醒任务与精确批准承载；Direct organic publish 由 E4-02～09/E4-13/E4-16/B0-29/B0-30 的数据、锁、动作层、OAuth/scope 与 adapter seam 承载（E2-07/E4-10/E4-12 的 Ads 写不属于本支柱映射） | 两种模式独立放行；Reminder 不外发，Direct 只按已真验 channel × post type 点亮 |
| 完整 Customer Engagement CRM | B8 B0-51～61（Campaign+Contact/Identity+Segment 底座）+ B5 B0-31（Inbox/历史/搜索/分派）、B0-32/33（WhatsApp template/发送护栏）、B0-38（人工-Otto 接手）、B0-40/98（Workflows/营业时间原语）+ B7 B0-43～49（Broadcast/permission/抑制/频控/Workflow/Lifecycle）+ B6 B0-41/42（统一回执/可选经营事实 connector）+ B2 量测/报告 | 上述已批准 feature 的并集才是第三支柱；B0-34/35/36/37/39、B0-50/99 等其他旧行不因相邻归块自动变成 Phase‑1 必做，任何单块、旧「CRM 三行」或老客唤回 playbook 都不能独立宣称完成 |

### B. 内容与 UIUX 完成门

**内容任务与稳定性**

- 冻结 20 个真实商家任务 = 5 种交付（文案、单图、短视频、Pack、Storyboard）× 4 个马来西亚交互带（English 清楚 brief、华语不完整 brief、Bahasa 含品牌/优惠/渠道约束、rojak 模糊引用或修改），其中 10 常见、5 边缘、5 对抗；Factory 不入列。固定 credits、时间与允许步骤，所有候选、重试、费用和淘汰结果都保留。
- 20 个任务各跑一次，6 个关键非确定任务各再跑两次，共 32 次完整运行。价格、商品、优惠、品牌硬规则、人物/商品/logo 身份、合规声明、商家/受众范围、未授权花费/外部动作、跨商家资料与完成状态必须 32/32 无 material 错误；出现一次整门不通过。
- A=可原样使用；B=只需选版本、裁切、标点、长短或个人偏好级微调，不能改事实、offer、核心 concept、hook、CTA、主文案、构图、镜头或重生成；其余为 C。主任务至少 18/20 为 A/B 且至少 14/20 为 A；每种交付至少 3/4 为 A/B，每个语言/交互带至少 4/5 为 A/B，6 个关键任务各 3/3 为 A/B。
- 每任务先与同 provider、同素材/预算、直接 raw brief 且无 Otto 策划的结果盲比，再与按交付类型锁定版本的具名品类强者盲比。3 名未参与制作的评审随机左右、多数票；对 raw brief 至少胜 16/20；对品类锚至少 16/20 胜或平且至少胜 10/20；任何实售交付类型不得 majority-loss。
- 3 家非 Founder、符合目标画像的商家各以自己品牌独立完成 3 个真实任务，共 9 个并覆盖五种交付；三家都实际采用/导出/发布至少一件，至少两家随后以自己的真钱购买或复购 credits。不得由 Founder/BELCORT 暗中救稿；真实 provider/竞品/评审/商家花费执行前逐笔呈预算请批。

**UIUX / user-flow journeys**

1. 新商家登录 → 说目标 → 带入品牌/商品 → 方案 → 一次批准 → 首个有用成果 → 采用/导出，在一次会话完成。
2. 回访商家给清楚 brief，Otto 直接理解、计划、执行，不要求选择 model/Skill/prompt/摄影参数。
3. 不完整华语/Bahasa/rojak 指令先用已有事实和可见默认，只在结果或风险真正改变时问一个紧凑问题。
4. Pack/Storyboard 多项工作一次看清完整清单、精确总价与取舍；一个 request 只有一个真正批准，逐项进度、部分结果和最终费用对得上。
5. 商家用自然语言继续修改，也能进 Canvas/同一人工工具改同一对象；人碰哪个对象 Otto 让出哪个，不覆盖人工作业、不乱停其他安全工作。
6. 离页、进 Canvas/Library、刷新、断线重连后仍是同一任务/scope/approval/余额/对象/进度，不重复执行、扣费或丢稿。
7. 缺资料、低余额、validation、provider 429/5xx/timeout、worker 延迟/stuck、拒绝或过期批准都有诚实的 Needs you/Working/安全停止与 retry/cancel/reconcile 路径。

- 每条用同一 release SHA、固定 tenant/fixtures 和预期状态，在 1280px desktop 与 390px mobile 各跑一次，共 14 次且 14/14 通过。canonical path 上 P0/P1、未解释 console error、broken route/deep link、dead end、假/丢状态、跨页矛盾、刷新丢任务、重复批准/动作/扣费、未授权 spend、假 Done、错误退款说法均为 0。
- 点击后 <100ms 有可感反馈；>300ms 有保形 skeleton 或真实状态；约 10s 未完成时说明正在做什么；后台变化秒级反映，SSE 不可用时同 cursor fallback ≤4s。最终结果、实际 credits、采用/导出、修改、人工接手和 receipt 都在任务上下文可找到。
- 复用同 3 家 × 3 任务：三家首次均零教程、零 moderator rescue/代操作；至少 8/9 自主走到采用或导出；三家均能独立修改、选版本、人工接手、停止/恢复并看懂费用与 receipt。任何 facilitator 救场留在分母并判失败。
- desktop 7/7 全键盘；检查 320/390/680/1280px、200% zoom、400% reflow；真实商家运行至少含一台真实 iPhone Safari 和一台真实 Android Chrome。按现行 44px touch、36px pointer、24px 绝对最小 target、对比度、focus、reduced-motion 规则；automated accessibility Critical/Serious=0。读屏实际覆盖 validation、批准、Otto thinking、生成进度、成功、低余额、provider failure、cancel/retry 八类事件，每事件只宣布一次。
- 冻结首次、计划/批准、Working/live reflection、成果/修改、失败/恢复 5 状态 × desktop/mobile 共 10 个可交互 checkpoint；3 名独立评审盲比至少 8/10 胜或平、至少 5/10 明显胜，计划/批准、成果、失败/恢复不得 majority-loss。机械、a11y、商家门全绿后才进入 Founder UAT。
- 每次证据包含 release SHA、fixture/商家/任务版本、browser/OS/device/viewport、完整录屏/截图、console/network、当轮 context、计划/批准、DB/object/ledger/receipt 断言、a11y/读屏记录、结果、缺陷与 rerun；失败永远留在分母，局部通过不得宣称整站 WCAG 合规。

### C. 发布产品合同与完成门

- Reminder-assisted = 持久站内待办 + 商家单独 opt-in 的 Email 叫回 + 同一冻结 posting pack；pack 提供下载、复制、打开平台、重排与跳过。默认提前 15 分钟、到点最多再提醒一次、30 分钟后标 `Missed` 并停止。必须区分 `Merchant confirmed` 与 `Platform verified`，提醒送达永不冒充已发布。
- reminder channel、时间、时区及 quiet-hours 例外随 request 一次呈现；内容、目标、时间、模式或费用等实质变化使旧批准与旧提醒失效。旧 `notifyEmail=true` 不等于 publication-reminder opt-in。共享通知底座只共享事件/adapter/偏好/去重/deep link/receipt 接缝，不共享 purpose 或许可；关闭 Marketing Email/某站外通知不得删除站内任务事实或伪造送达。Browser Push/SMS/WhatsApp 商家提醒本期仍 Coming soon。
- Direct publish 的唯一正向授权是逐帖或精确批次对具体账号/身份、受众、内容、时间、渠道与总价的批准。账号层只保留负向 `Pause direct publishing`；解除不得补发过时 queue，权限到达不得转换历史 reminder/queue。
- 同一 release SHA 把所有声称支持的 `channel × post type × mode` 列成完整矩阵，automated/mock、内部 UI/真机、受控真实 Email/Meta 三层证据分开；没有商家人数/任务数考试，也不能把 mock 次数冒充真实送达率或 adoption。
- Reminder-assisted 单独验证 schedule → 站内 task → 可选 Email → posting pack → Merchant confirmed，以及 edit/cancel/reschedule、时区、quiet hours、退订、过期登录、wrong-owner 拒绝、Missed/skip 与失败恢复；自有测试邮箱核真实投递/动作 receipt，Reminder 路径断言绝不调用 Meta。
- Direct Meta 按准备开放的每个 `channel × post type`，至少向自有测试 Page/IG business account 发一条受控真实帖子，核对 external ID、permalink、platform read-back、目标账号、素材顺序与文案；另验 token/scope、限流、失败重试、ambiguous response、暂停和恢复。
- 团队在 desktop、真实 iPhone、真实 Android 与 keyboard/VoiceOver 跑完批准、提醒/deep link、posting pack、Missed/reschedule/skip、故障恢复核心 journey；P0/P1、错误状态、不可达主操作为 0。
- hard-zero：0 未授权/跨租户外写、0 错账号、0 重复真实发布、0 静默换 mode、0 cancel/edit 后继续动作、0 假 Published、0 blind retry、0 Email 未 opt-in/退订后继续发送。任一出现，对应格不放行。Reminder-assisted 与 Direct Meta 分别验收、分别放行；本计划不授权任何当前真实外写。

### D. Customer Engagement CRM 完成门

1. **功能全**：Contact/Identity、导入去重合并、标准/自定义字段、tags、动态 Segments、Lifecycle、Inbox/历史/搜索/分派、Campaign/Broadcast、Workflows、人工/Otto 接手、退订、回执与报告全部真实实现；无 mock、空按钮或隐藏人工步骤。
2. **流程通**：导入/整理联系人 → 分群/Lifecycle/Inbox → Campaign/Workflow → 精确批准/发送 → 回复/STOP/退订 → 回执/报告，在 desktop/mobile 端到端成功且错误可恢复。
3. **体验好**：主要 UIUX/user flow 清楚、丝滑、无死路，同任务走读达到 respond.io 同类水平；不另设固定商家人数考试，pilot 只用于采用与优化。
4. **真实且安全**：第一期只要求 WhatsApp 一条顾客渠道完整真实上线；0 跨租户/错联系人、0 未批准或重复发送、0 STOP/退订绕过、0 受众静默漂移、0 假回执。Customer Email marketing 与其他顾客渠道各自真验后点亮，不阻塞第一期。

### E. 商家自主与 provider-neutral 硬边界

- 商家确认联系人来源、关系、权限与 campaign 名单；平台不因缺少原始凭证自动缩名单，也不把导入/下单/EasyStore 字段虚构成 consent。已知 STOP/退订、DND/block 与 provider 硬限制必须 fail closed 抑制。
- Contact/Campaign/outbound/receipt 使用 FIKIRTIVE 统一模型；CSV、EasyStore、Shopify、POS、CRM、BSP、Email/SMS 等只经统一 connector/channel seam 接入。新增或替换 adapter 不得分叉 core schema、UI 或 Otto workflow。
- Gupshup 是第一期 WhatsApp 首 adapter，EasyStore 是可选只读 adapter；两者都不是产品身份或 release 前置。provider 变化不得偷换已批准动作或重复外写，必须有 contract tests、能力/健康状态、幂等/去重、对账、统一 receipt 与回滚路径。
- 第一期开口不建 Companies/Deals/Forecast/Quotes/发票收款/完整售后 ticketing，也不预建假 Salesforce 骨架；未来进入 Salesforce 深度须另走 Founder 产品决定。

### F. 单一完成判定

三支柱全部通过本节门槛，再通过 B10/B11/B12/B13 的适用 production、安全、回滚与 live-fact 闸，才可请求 Founder 判定第一期完成。provider 成功、单测、schema、mock、精选样片、提醒送达、单块 `release-certified` 或 PR 合并都不能代替；sanitation 完成与产品第一期完成也互不冒充。

## 八、Q1 / Q4 已裁口径

- **Q1**：第一期使用已 LIVE credits 轨；席位订阅继续留壳，另议。收钱门是「七·甲」三支柱与 production gate，不是全城所有块完成，也不是任一单块完成。
- **Q4**：Meta 商业验证、GBP API 申请、Cloud API 测试号、Stripe test 演练等验证类前置归材料，施工期先办；B4/B5/B6 相关受审面与法务页就绪即递，不等全城收口。外部尾巴按真实平台状态报告，不承诺固定审核时长。

## 九、改判表(治理卫生,Fable 1g——防数月后旧文翻案)

| 旧条款(已批文件) | 改判 | 依据 |
|---|---|---|
| 点亮章五关「founder 15 分钟亲点」 | → 每块报告+自查脚本,founder 终验一次 | Q2 |
| 点亮章「过关才点下一环」串行律 | → 三道并行+六级状态 | 乙裁决 |
| R5 D5 收钱条件句(一单元成立即可收) | → 建完才收 | Q1 |
| 「建完才收」(§〇 Q1/上行) | → 建/卖两图配对:建城图管宽度(全城照建),卖图管深度——内容、发布、完整 Customer Engagement CRM 三支柱到齐并通过「七·甲」+ production gate 后才可对顾客一号开收,**不等全城** | #334 Resolution + Blueprint v2.12（#337） |
| 防呆闸(≥3 需求物证) | → founder 解除(informed) | 乙裁决 |
| v0.2「外部申请第一周递出」 | → 材料施工期/递交按 §八 Q4 细化 | Q4 |

## 十、《Founder 前置供给清单》终版结构(合并 Sol §四 + Fable §4 + FIK-1 五项)

交接包内单独成文(`FOUNDER-SUPPLY-MANIFEST`),每项:所有者/位置/权限范围/有效期/已实测/续期法;密钥值不入文。类目:法人与品牌资料 / 法务文本(隐私/ToS/删除回调——founder 批)/ 完整账号矩阵(GitHub/Railway/Cloudflare/Stripe/Sentry/Meta BM/WABA/Google/BytePlus,含角色与 ID；EasyStore 等 commerce connector 仅在实际采用时加入)/ **WABA 专用新电话号** / WhatsApp 首 adapter 的账号与迁移/替换资料（当前 Gupshup，不写进核心身份）/ 可选 EasyStore adapter 真验载体 / L0 短链域购买 / 2FA 与不可委托动作预案 + **「账号开通半日」预约**(集中处理验证码/KYC,把中途索取压成一坐)/ 测试身份与真实样本包（含自有 Reminder Email 收件与发送 identity）/ 生产权限(env/迁移/回滚/告警接收)/ 每项真实花费的独立估算与逐笔批准（不设 blanket 信封）/ Stripe live 测试规则 / 发布商务输入(价格/credits/退款/上市域名)/ 质量裁量(对标锚+待裁 SLA)/ 外部申请权限表 / Founder-only/disputed 合并窗口。**加一条 founder 快速通道**:仅用于不可预见的平台补件(目标是「无可预见的中途索取」,不是假装外部世界不会出新要求)。

## 十一、交接包清单(定稿后打包)

本计划 v0.3(founder 签认后)+ 范围宪章(签认版)+ FOUNDER-SUPPLY-MANIFEST + FINAL-REPORT-STANDARD(交付合同)+ MATRIX-V0 + 全部 evidence + 状态账终局(#238)+ A′ 舱单 + CREDENTIAL-INVENTORY + 机器清理余项(第二组)+ 递延池 + 双顾问两份 memo 原文。
`.orchestration/` 全部入库走 PR(M5 最高优先发现)。
