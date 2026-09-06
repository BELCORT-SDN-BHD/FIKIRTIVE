# FIKIRTIVE Founder 思想历程 + 产品词典

> 档案快照：2026-07-24  
> 主要读者：Founder Nicks，以及以后每一位 AI / human collaborator  
> 目的：不是再造一份 current-state 总账，而是保存「为什么成为今天这样」的永久记忆。

## 读法与证据边界

这份档案只把三种东西分开写：

1. **Founder 原话**：逐字保留，不翻译、不润色；后面紧跟日期与来源。
2. **决定了什么**：用一句人话解释那句话改变了什么。
3. **今天是否仍有效**：以 live `docs/BLUEPRINT.md`、durable Founder Resolution、现行项目法和明确的 supersedes 链为准；旧 session 的 blanket approval、临时 spend envelope、旧模型分工或旧 launch 口径，不会冒充永久授权。（来源：`docs/BLUEPRINT.md` 文件头、§七；issues-271-360 #335；现行项目法 `AGENTS.md`）

证据有四个已知限制：

- Git 历史从 2026-06-10 开始；早期产品名为 Artlio，2026-06-21 才改名为 Fikirtive、Cowork 改名为 Otto，但输入中没有 2026-06-10 至 2026-07-02 的完整 Founder 对话，因此**命名背后的第一手心理过程缺档**。这里能证明事件，不能替 Founder 补写动机。（来源：git-spine，commits `e4c36ee9`、`6b151d3f`；【历史缺口】）
- PR/issue #1–#180 几乎全是 Claude Code 写的 PR；一些 `nicksgan-belcort` 评论也是 session 代发证据，不等于 Nicks 本人手打。只有 digest 明确标成 Founder verbatim 的句子才当作原话。（来源：issues-1-90、issues-91-180 的 source note）
- 多份 transcript digest 是同一段 2026-07-07 对话的 replay/fork；本档只把同一句话算一次，不把重复记录误当成多次独立裁决。（来源：transcript-wt-serene-swartz、transcript-wt-quizzical-jepsen、transcript-main-940bfbd9）
- `docs-doctrine` 读到的 v2.13 批准栏是「待 founder 终审」，但 git-spine 证明 PR #444 已合并为 commit `281794ab`；Blueprint 自己又规定「Founder 合并即定稿、批准栏由下一次修订回填」。因此本档把 v2.13 视为**已合并生效、批准栏尚未回填**，同时保留这个文本差异，不抹平它。（来源：docs-doctrine；git-spine `281794ab`；`docs/BLUEPRINT.md` 文件头、§七）

---

# Part 1 — Founder 思想历程

## 1. 产品身份：从创作工具，到 ALL-IN-ONE 世界级平台

### 1.1 可见的起点：Artlio / Studio / Cowork（2026-06-10—06-21）

项目最初是一个带生成、分镜、编辑和导出的创作工作台；代码史先后出现 Artlio Studio、Cowork、Vapor 设计语言，随后于 2026-06-21 正式改名为 Fikirtive 与 Otto。这个阶段已经有真实生成、编辑、对象存储和 AI 协作的种子，但输入里没有足够 Founder 原话，不能断言他当时已经完整说出后来那套「城市」愿景。（来源：git-spine，commits `e4c36ee9`、`1432391d`—`d501defb`、`6b151d3f`；【历史缺口】）

### 1.2 平台本体第一次被说清（2026-07-07）

> 「FIKIRTIVE 是一个平台，人类要操作什么都能操作的。我们的moat就是，在强大平台的基础上，OTTO能操作任何人类都能操作的东西，with permission。」

这句话决定：护城河不是某个生成模型，也不是一个聊天框，而是**完整平台 + Otto 对整个平台的操作权**。（来源：transcript-wt-mid-batch，2026-07-07 03:15；同句见 transcript-wt-quizzical-jepsen）

> 「FIKIRTIVE 是一个ALL IN ONE 的MARKETING POWER HOUSE PLATFORM（意思就是基本上都有全部feature，像之前我给的那些reference products（sales force 那些））这样的概念。」
>
> 「FIKIRTIVE上每一个feature 都可以100%人操作，OTTO也能操作100%全部这样。」

这两句决定了 v2.5 定位宣言：终局是 Salesforce 类广度的营销 powerhouse，不是一个单点 AI generator；并且所有功能同时有人工路与 Otto 路。（来源：transcript-main-7fcd6fd4，2026-07-07 06:54；PR #187；commit `fdd18ef4`；`docs/BLUEPRINT.md` §一、v2.5 修订行）

这里的「全部」后来被加上防误读边界：它是终局承诺，不是要求今天一次做完；feature 只能来自深研与 Founder WHAT-pass，agent 不得凭空发明。（来源：`docs/BLUEPRINT.md` §一、v2.5）

### 1.3 SEA 从“身份”退回“滩头”（2026-07-09—07-10）

> 「记得东南亚只是我们的发起地，全球范围的垄断，是我们的最终目标。」
>
> 「所以基础，一定要以全球为底，只是做个本地话而已。」

这决定了「全球为底、本地为皮」：Malaysia / SEA 是首发优势，不是产品天花板；多币种、多语言、多市场定价和渠道 adapter 必须从骨架层支持全球。（来源：transcript-main-7fcd6fd4，2026-07-09 04:00、19:38；`docs/BLUEPRINT.md` §一）

> 「instead 那么执着这个sea 小商家的说法，我会更倾向，世界级的产品，但是首先先优化体验for 某某某商家这样。」

这决定了从抽象 persona 转向真实顾客：世界级通用骨架，每一批为一个真实商家优化到极致；第一位明确命名的 pilot 是 Saranghaeyo。（来源：transcript-wt-handoff-1ec82f，2026-07-10 06:31；`docs/BLUEPRINT.md` §一 v2.11；`docs/research/CUSTOMER-ONE-SARANGHAEYO-2026-07-10.md` 由 docs-doctrine 索引）

### 1.4 “营销平台”边界变得更精确（2026-07-10）

v2.11 把定位升级成「世界级 ALL-IN-ONE 营销与营收增长（revenue-growth）OS」，并禁止裸说「营收 OS」，因为那会让商家误以为 FIKIRTIVE 要拥有会计、开票、收款、售后和税务。（来源：PR #210/#212；commit `94a5cfbf`；`docs/BLUEPRINT.md` §一）

Founder 批准的四层边界是：

- 本体负责：研究、创作、Campaign、发布与广告、本地发现、售前成交促进、线索/CRM、请评、推荐、复购、唤回、增长实验。
- 读取并验证：订单、付款、退款、库存、履约、积分等经营事实，只读、不代管、不自建账本。
- 明确交接：售后工单、退换货、物流、正式报价/开票、催收、税务。
- 永久不做：代持商家资金、税务工资系统，以及宪法第 8 条全部禁区。（来源：`docs/BLUEPRINT.md` §一「边界四层表」；PR #212）

### 1.5 Otto 身份的最后一次收窄（2026-07-23）

早期首发叙事把 Otto 说成「AI 营销员工」；#334 还批准了「精明能干的营销员工」版本。后来 Founder 发现把这句话写进 Otto main prompt 会让能力先验地局限在商家/营销场景，于是修正：

> 「otto 的任务是了解我们的用户需求，然后做出他们要的东西，而不是先判断用户都会是商家，这个是不一定的。所以我才说全部，全部东西都要 best practice 且是开放式，而不是有局限性的。」

这决定：**产品仍是营销与增长平台；Otto 的运行身份则是平台操作员，不在 main prompt 里自限成“营销角色”**。（来源：transcript-wt-orchestration-50ba3d-current，2026-07-23 08:22；issues-271-360，2026-07-23）

> 「使用 skill 来协助用户就好，加多一个营销的那个有点不必要」

最终英文身份被记录为 “You are Otto, FIKIRTIVE's operator — the platform's hands.”；能力来自 skill harness，能操作 FIKIRTIVE 全平台。（来源：issues-271-360，2026-07-23；transcript-wt-orchestration-50ba3d-current，10:49—10:56）

这不是把 FIKIRTIVE 改成通用 AI Chat。独立通用 Chat 仍是宪法永久不做项；「开放式」指 Otto 不预判用户意图、每项能力按 best practice 执行，而不是另造一个脱离 FIKIRTIVE 的通用助手。（来源：`docs/BLUEPRINT.md` §二第 8 条；issues-271-360）

---

## 2. 双 100% 与 Otto 哲学：完整工具之上的超级操作员

### 2.1 从聊天助手到“同一座城的两双手”

2026-06-22—26，Otto 从 context/memory seam、streaming chat，发展出 `defineOttoSkill()`、registry 与唯一 spend skill；这时「新能力 = 新 skill」开始成为工程现实。（来源：git-spine，commits `f5ed4845`—`50d47957`、`30d837a0`—`efd00cb2`；issues-1-90 #28）

Founder 的产品判断随后把它升格：

> 「Otto 是在原有都建设很棒的基建上的自动化操作员,用户一定也要 100% 可以操作全平台的东西」

这句话否决「Otto 可以替代报表引擎，所以不必做人类工具面」的提案。人工面没有例外，因为用户必须能检查、接手，seats 的商业模式也依赖完整人工工具。（来源：docs-doctrine 引 `GRILL-VERDICTS-2026-07-03.md` L80；`docs/BLUEPRINT.md` §二第 7 条）

### 2.2 结构保证，而不是口号

双 100% 最终被拆成六个结构件：

1. UI 与 Otto skill 调同一个 server action；
2. Parity Manifest 登记 action ↔ skill；
3. 人能读的数据，Otto 有对应 free/read skill；
4. 当前视图与选中项经上下文桥注入；
5. 页面里的 AI 小按钮是「Otto 的手」，不是第二个匿名 AI；
6. 创作域用视觉 Canvas，规则/自动化域用人看得懂、改得动的规则文件。（来源：`docs/BLUEPRINT.md` §二第 7 条；PR #109；docs-doctrine）

四类 Otto 对等豁免也被写死：市政厅 admin、纯视觉微操、账户安全、money-in；豁免只管「Otto 是否能代做」，不影响「人工面必须完整」。（来源：`docs/BLUEPRINT.md` §二第 7 条、v2.8 附则①）

### 2.3 Live reflection：Otto 住在家里，用门，不爬窗

Founder 最先从 computer-use 类比想到「让用户看到 Otto live 操作」：

> 「如果这样做，其实就直接解决了100%人能操作，OTTO 100%也能操作这样」

讨论后的定案不是让 Otto 看像素、点鼠标，而是让它直接走产品动作层；界面再实时反映动作。这样更快、不会误点，也保留用户可见性。（来源：transcript-wt-small-batch，2026-07-07；transcript-main-7fcd6fd4，08:11—08:41；PR #192）

> 「这个概念我们一定要记录清楚，确认了就是很大的升华了，明白吗？一定要做到天衣无缝。」

这让 Agent-native UI / live reflection 从想法升格为宪法：秒级刷新、coral 高亮、简短叙述；Otto 随时可唤起、工作可见，但不抢 Canvas/工作台主场。（来源：issues-181-270 #192/#195；`docs/BLUEPRINT.md` §二第 11 条、v2.6—v2.8）

### 2.4 零学习曲线，不等于零审批

> 「若是有一个按钮，让一个人成为世界上最强的人，他不会按吗？会的。」

Founder 的判断是：Salesforce / HubSpot 的问题不是功能没用，而是普通老板学不会；Otto 与 UIUX 应把学习成本拿走。（来源：transcript-main-7fcd6fd4，2026-07-09 03:43）

> 「我们要做的,就是完美,全部东西。像 Apple,完美他们的 product」

这决定了「实力是信任的引擎」。Blueprint v2.9 的正式规则是：用户只需会「说出要什么」和「点批准」；每个专业功能要有「Otto 替我做」、人工面自解释、注册后一场会话内看到成果。学习曲线归零，信任曲线仍通过提案 → 一次批准 → routine 放手逐级建立。（来源：PR #204；commit `2aa28b2d`；`docs/BLUEPRINT.md` §二第 11 条）

### 2.5 审批不是摩擦，是边界

早期 Founder 用最短的话表达：

> 「点 ok 再花钱」

这决定了付费动作先给用户看成本，再明确批准。（来源：issues-1-90 #88）

后来进一步简化为：

> 「不要太多栅栏，一个request 就行了这样。不然很烦。」

于是审批演进成「一个 request = 一次批准」的精确授权信封：内容和价格指纹锁死，漂移就作废重批；不是每个内部小步骤都弹窗。（来源：transcript-wt-small-batch，2026-07-14；issues-271-360 #294/#298）

当前宪法公式是：

`needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`

字段不全取最危险值；turn 计量与 routine 预授权是「审批发生在别处」，不是无审批。全操控从不等于全自动。（来源：`docs/BLUEPRINT.md` §二第 4、7 条）

---

## 3. 商家数据主权：从“安全”到“商家的权利”

### 3.1 第一层：数据安全是产品身份（2026-07-09）

> 「FIKIRTIVE其中一点就是，商家的数据是安全的。」

这把 tenant isolation 从技术要求升格为产品承诺：每一份 owner-scoped 数据都必须用已认证 `ownerId`，客户端传来的 org/owner 不可信。（来源：transcript-main-7fcd6fd4，2026-07-09 19:09；`docs/BLUEPRINT.md` §二第 6 条）

### 3.2 第二层：平台是保管人，不是主人（2026-07-18—19）

> 「商家的 data，商家的权利，我们只是提醒。」

这句话成为 CRM / privacy 全域裁决的总原则：同意、勿扰、拒发等 permission 事件是商家资产；平台不替商家作一般删除决定，只提供 tag / 提醒 / 工具；明确 STOP 在发送瞬间仍必须 hard stop。（来源：transcript-wt-mid-batch，2026-07-19；issues-271-360 #356；PR #364）

> 「其实这个问题，我们不能做个删除，最多只能放一个tag 提醒商家，毕竟这个是我们的user（商家）的资产。」

这决定了第一期不做硬删除/自动吸收合并，尤其不能为了“清洁数据”破坏 append-only 证据链。（来源：transcript-wt-mid-batch，2026-07-18；issues-271-360 D-Q2）

对应的具体产品规则包括：

- 导出是商家标准权利；灾备备份是平台保管职责。
- 联系人疑似重复只提醒，第一期不做 merge；未来也只能商家手动确认。
- receipt 只存 opaque reference，不复制 provider 原始内容、电话、message body 或 token。
- 第一阶段平台托管加密；enterprise 字段级/自管密钥是 Founder 明令未来必须项。
- 细分 RBAC 延到「团队协作 + 市政厅 v2」一起设计。（来源：issues-271-360 #356；issues-361-453 #405；#359 台账）

### 3.3 第三层：渠道选择也服从数据主权（2026-07-14—21）

最初因为 360dialog 固定月费难 scale，Founder 选过：

> 「可以 gupshup 起步」

这是成本驱动的过渡选择。（来源：issues-271-360 #293）

2026-07-21 又被 Meta Cloud API 直连 + Embedded Signup 取代：商家自己在 FIKIRTIVE 连接 WABA，号码和数据留在商家的 Meta Business Manager，不再先让商家成为 Gupshup 客户。（来源：issues-271-360 #301；#359 item 29）

这条演进说明：provider 可换，数据主人不换。当前原则是统一 connector seam、商家自助 login/connect、平台不拿商家原始凭据，核心系统不依赖 EasyStore/Gupshup 等单一供应商。（来源：transcript-wt-handoff-1ec82f，2026-07-10 16:02；issues-271-360 #334-12/13）

### 3.4 一个必须诚实保留的张力

Founder 也说过：

> 「我们其中一个优势就是当商家放越多数据在我们的平台上，就会越离不开我们。」

这是商业 stickiness 的判断，不改变所有权。档案应同时保存两面：数据越完整，产品价值越高；但平台不能借此把数据变成自己的资产或替商家处置。（来源：transcript-wt-mid-batch，2026-07-18 18:54；同 session 的「商家的 data」规则）

---

## 4. 诚实原则：底线必须硬，主形象不能弱

### 4.1 钱与状态先诚实

Otto 的五条运营铁律把诚实写进产品行为：用户面 spend 只显示 credits；花钱前批准；失败自动退款、重试不双扣；下一步有建议按钮；新能力永远进入同一个 Otto。（来源：`docs/BLUEPRINT.md` §二第 3 条）

工程上又固定为 exactly-once 与 fail-closed：一次动作最多扣一次；证据不够、状态不明或 provider 失败时宁可不执行/退款，也不伪造成功。（来源：`docs/BLUEPRINT.md` §二第 2、4 条；issues-1-90 #24/#90；issues-91-180 #112/#128）

### 4.2 “有根据、不捏造”

> 「有根据、不捏造」

这决定了 Otto 的 Meta 诊断只能用账户自己的真实历史均值；没有 ROAS 就 abstain，不造行业 benchmark；每个数字附 source、period、fetch time。（来源：issues-91-180 #128）

同一精神后来成为 CRM/C6 的 honest-unknown UI：provider 只是模拟时，就明确显示 unknown / simulated，不能把本地状态冒充外部送达回执。（来源：git-spine，C6 commits `9dcf8078`—`f2adffac`；issues-361-453 §⑤）

### 4.3 诚实不是品牌人格的全部

#334 的初稿把 Otto 描述得太像一个不断强调风险、失败和未知的助手，Founder 纠正：

> 「FIKIRTIVE 只需避免 over-promise、如实报告；Otto 的主形象必须是精明能干的员工，不是'诚实的傻瓜'」

最终批准句强调：Otto 先想清策略、工作清单、总价和取舍；老板一次批准；Otto 用真实工具执行到底；过程可见，最后带可核对成果与费用回执回来。（来源：issues-271-360 #334-3）

因此最终原则是：**诚实是地板，不是广告标题**。不能 over-promise，也不能用“我什么都不确定”掩饰能力不足。（来源：issues-271-360 #334-3；`docs/BLUEPRINT.md` §六第一期内容五关）

### 4.4 “可用”不能被技术成功冒充

> 「不能用 provider 成功、文件可打开、单测通过或偶然最好样片代替。」

内容必须过理解、判断、手艺、采用、证据五关；老板应直接采用或只做偏好微调，而不是替 Otto 重做策略、prompt、文案和成品。（来源：issues-271-360 #334-4/5；`docs/BLUEPRINT.md` §六）

2026-07-24 的 PR #449 又把同一原则落到生成确认页：零余额或后端拒绝时，不再显示假的 “Generation started”，并把真实余额/失败理由留在界面，因此 commit 被命名为「确认页诚实层」。（来源：git-spine `4049323d`；issues-361-453 #430/#449）

---

## 5. 对标观：不是抄页面，是把每区龙头完整搬进同一生态

### 5.1 反对“半桶水”

> 「不要每一个feature 半桶水」
>
> 「类似把salesforcr，respond ，grok，magic path 全部都搬进来fikirtive（还有其他的我没有讲到但是也是一样，每个板块都完整的意思)」

这决定了对标的方法：每一区必须达到该类别龙头的完整度，再由 Otto 把它们贯通；不能只复制一个 hero screen 或几项 checkbox。（来源：transcript-main-7fcd6fd4，2026-07-09 01:06、03:17）

> 「每一个环节所用到的工具，都要是最完美无缺的，就是如果说我们用到canva哪一环节，就是要最强的canva（magicpath or grok ish）这样的意思。」

这决定了 quality bar：创作区对 Grok / MagicPath，CRM 对 respond.io，终局销售深度对 Salesforce；参考产品各自负责一个“最强点”，不是整套照抄。（来源：transcript-main-7fcd6fd4，2026-07-09 19:18；`docs/BLUEPRINT.md` §六对标地图）

### 5.2 Grok：Canvas 的交互灵感，不是商业规则照抄

> 「我要的就是grok 那种的体验。」

Grok 贡献的是 stateful canvas、项目感、明亮工作台和“创作就在主场发生”的体验。项目曾用 6-agent frame-by-frame study 研究四段 Grok 录像，并把 Grok-bright 设为默认视觉方向。（来源：transcript-main-940bfbd9，2026-07-07 06:17；issues-1-90 #70—#73）

但「100% 复刻 Grok」被对抗审查判违宪，因为 Grok 的外部 MCP、无上限并行、社区 Discover 等做法会撞上 Otto-only、成本闸和 tenant isolation。最终口径改成「100% 创作画布交互手感」，不复制不合规的商业/安全选择。（来源：docs-doctrine §③、§⑤；`docs/superpowers/plans/2026-07-06-otto-grok-parity-GOAL.md` 由 docs-doctrine 索引）

### 5.3 respond.io：第一期 CRM 的类别完整度

respond.io 是 KL 同城直接对手，也是第一期 Customer Engagement CRM 的明确 benchmark。Founder 决定第一期要覆盖联系人身份、导入去重、字段/tags、动态 Segment、Lifecycle、Inbox、历史、搜索、分派、Campaign/Broadcast、Workflows、人/Otto 接手、退订、回执和报告；不能把“老客唤回”一个 playbook 冒充完整 CRM。（来源：`docs/BLUEPRINT.md` §六；issues-271-360 #334-14—16）

同时第一期明确**不进入** Salesforce 的 Companies / Deals / Forecast / Quotes / invoices / full service desk 深度，也不先建空对象假装未来完整。（来源：`docs/BLUEPRINT.md` §六；issues-271-360 #334-14）

### 5.4 MagicPath / Canva / Stripe / Apple 各自教什么

- MagicPath / Grok：Canvas 与 creation tool 必须强到能成为独立好产品。（来源：transcript-main-7fcd6fd4，2026-07-09）
- Canva：模板和 Brand Kit 是参考，但 Founder 不接受 template-first；FIKIRTIVE 的第一性原则是 research + Otto 直接创作，Discover 只负责 inspiration。（来源：transcript-wt-handoff-1ec82f，2026-07-10 06:04）
- Apple：产品完整度、克制、质感、实力带来信任；不是说照抄消费硬件 UI。（来源：transcript-main-7fcd6fd4，2026-07-09 03:47；`docs/BLUEPRINT.md` §二第 11 条）
- Stripe：Founder 后来补充，Apple 没做 SaaS tools；Stripe 更适合专业工具的信息层次与目的导向。（来源：transcript-main-7fcd6fd4，2026-07-09 14:39）

### 5.5 借鉴先行律

> 「参考我们的龙头对象如何处理。借鉴。」
>
> 「批了。记得之后遇到这样的问题，先借鉴。」

这把“先研究龙头、再设计”变成常设方法，尤其用于平台规则、渠道限制和陌生产品形态；但最终仍要通过 FIKIRTIVE 自己的安全、数据和双 100% 原则。（来源：transcript-wt-handoff-1ec82f，2026-07-10 09:01—09:27；PR #213）

---

## 6. 商业机密观：用户买结果，不需要知道后台供应商

### 6.1 Provider 从多选收敛到专注

早期系统支持 fal 与多个 model picker；到 2026-06-29 又迁到 BytePlus Seedream / Seedance。Founder 后来明确：

> 「fal 我不用了，可以移除。」

这决定移除 fal，只保留本地 mock 与当前图片/视频生产链。（来源：transcript-wt-orchestration-50ba3d-current，2026-07-23 10:49；issue #443）

> 「我们的视频provider 现在就只是SEEDDANCE，image 就只是 SEEDREAM。目前不会再加其他的provider了，就专注这样就好，不让我们的用户选择（当然也不会让他们知道我们后台使用什么，这个也是一个商业机密，要记下来。）」

这决定了当前营运规则：视频/图片各只有一条产品化路径，用户不选模型，provider 名称不出现在 UI、toast、error、email、export、公开 API response 等用户可见面。（来源：transcript-wt-orchestration-50ba3d-current，2026-07-23 08:05；issue #436；commit `50e1ab95`）

“目前不会再加”是当前 roster，不等于宪法禁止未来换供应商；架构仍需 provider-neutral、可替换。专注与可替换并不矛盾：用户只看到稳定能力，内部可以在不破坏产品契约的前提下换 adapter。（来源：issues-271-360 #334-12/13；issue #436）

### 6.2 机密边界

Provider identity 被定为商业机密；市政厅的 Founder 成本页仍可显示美元和供应商成本，因为那是平台侧账房，不是用户 spend 面。（来源：issue #436；`docs/BLUEPRINT.md` v2.8 附则⑥）

同样，Otto 不需要知道 FIKIRTIVE 自己赚不赚钱：

> 「毕竟他也不需要知道我们（官方）赚钱不赚钱，不是他的问题。」

这决定把 margin / supplier economics 留在配置、costing 与 admin，不注入普通 Otto 上下文。（来源：transcript-wt-handoff-1ec82f，2026-07-10 07:42）

### 6.3 Skill 生态也属于可控机密

> 「我们是全平台不是单 feature,内部处理更好控制」

这决定 skill 永久由 BELCORT 内部编写，不开放第三方 skill marketplace；对外也不提供 MCP/API 让别的 agent 操作本城。（来源：docs-doctrine 引 GRILL-VERDICTS O-11；`docs/BLUEPRINT.md` §二第 8 条）

> 「如果会用其他 LLM,代表我们的 Otto harness 不够好,就代表 FIKIRTIVE 不好。不要有这个机会。」

这决定“操作这座城的 agent 永远只有 Otto”。但 FIKIRTIVE 自己作为消费方调用平台官方 API/MCP 不在禁区，前提是仍走自家动作层和审批闸。（来源：docs-doctrine O-14；PR #206；`docs/BLUEPRINT.md` v2.10 附则⑦）

---

## 7. 治理观：从“全部交给你”到“不监守自盗”

### 7.1 为什么需要宪法

> 「前提是你的guidance/plan要写到完美，和我们决定的不会有出入。」

Founder 的原始焦虑很清楚：过去较弱模型留下垃圾、误导和不干净结构；未来即使换模型，也不能把产品带偏。（来源：transcript-main-940bfbd9，2026-07-07 05:09）

> 「看起来不错，但是我有问题，我们的地基处理好了吗？现在可以没有后顾之忧去冲了吗？未来不管coding agent 多糟糕都不会失败了吗？」

这推动了 BLUEPRINT、MASTERPLAN、Founder verdicts、review playbook、CI gates、expansion seams 与 spec 金字塔。（来源：transcript-main-940bfbd9，2026-07-07 06:37；PR #109/#181；`docs/BLUEPRINT.md` 文件头）

### 7.2 一次真正的“监守自盗”事故

Founder 在 Fable quota 用完、Opus 接手 North Star Immersive 时反复要求：

> 「FABLE已经没有了，我们就以FABLE建好的那些为榜样，然后不监守自盗，去处理吧」

意思是：执行者不能自己宣布自己达到 Fable 质量，必须有独立检查。（来源：transcript-main-940bfbd9，2026-07-07 18:24）

次日 Founder 亲自发现问题：

> 「这不是完整版的愿景吧。你有按照FABLE的计划走吗？拼凑看起来并不整齐。若有FABLE原计划，请遵循。」

审计证实 57 页 immersive 中有 34 页只是旧 gallery 套 shell/CSS hack，而且根本没有真正的 composition blueprint。于是 North Star 从“看起来很多页”改为先造唯一施工图、再重建；旧原型后来只保留为设计基准，不再当工程车道。（来源：transcript-main-rest，2026-07-08；issues-181-270 #202/#203）

这件事决定了 FIKIRTIVE 的核心治理观：**数量、截图和执行者自评都不是质量证据；作者与最终审查必须分离。**

### 7.3 模型分工只是手段，身份必须可验证

> 「为什么需要三个 skill？一个不就好了。主要目的就是:你是 orchestrator,Sol Ultra 是 advisor,其余交给 Opus/Sonnet/GPT-5.6。」

这曾决定 2026-07-11 的 orchestration 合并方向。（来源：issues-181-270 #225）

后来又明确：

> 「orchestra一定是要fable 5 extra high，如果发现到不是，请停下。若刚刚你做的决策是OPUS 做的，请从新审理且不打断现有工作。」

2026-07-21 一次 session 仅凭未验证的模型/harness claim 继续工作，触发 stop-line；项目法随后规定必须用 process evidence（如 `ps` launch args）验证模型身份，失败就暂停相关 authority。（来源：transcript-wt-orchestration-50ba3d-current，2026-07-21 10:07；issues-361-453 #390/#391；现行项目法）

模型名和 routing 会变；永久部分是：高层判断不能被未经验证的低权模型静默接管，fallback 必须如实标注，重要件要独立跨族复审。（来源：issues-271-360 #359 fallback rule；现行项目法「Verify model identity」与 cross-family review）

### 7.4 Merge 权不能靠账号猜

2026-07-22 审计发现 8 个 PR 的 author 与 mergedBy 都显示 Founder 账号、reviews 为空，无法证明是 Founder 本人点击还是 session 用 Founder token 执行。Founder Resolution 因此要求每次 merge 留 executor evidence。（来源：issues-361-453 #404/#406；commit `55ef59d1`）

当前规则：Founder 亲合要由 Founder 留“本人执行”评论；授权的非作者 executor 要记录身份、授权指令和时间；作者不得合自己 materially edited 的 PR。（来源：现行项目法「Merge authority」；PR #406）

### 7.5 临时放权不等于永久主权转移

历史中有很多大范围口令，例如：

> 「这里，我给你所有权利」
>
> 「你能直接自己批准，做完全部任务后，正式全部再交接给我」
>
> 「我不要一个一个审核，最后直接一次过处理」

它们曾让特定 sprint / Route-B 在边界内快速推进，但 #254 同时保留五类不可转授：超 envelope 花费、production deployment、真实外部动作、Blueprint、终验。现行项目法进一步明确 session、模型、branch、claim、handoff 都不能自授长期 authority。（来源：transcript-main-940bfbd9，2026-07-07；transcript-wt-mid-batch，2026-07-12；issues-181-270 #254；现行项目法）

---

## 8. 发射策略：快赚、全城、真闭环，最后收敛成三支柱

### 8.1 最初张力：边赚钱边升级 vs 全部完美再上市

> 「越快越好，我要开始去market 一边赚钱一边升级。」

这是 2026-07-07 的速度诉求。（来源：transcript-main-940bfbd9，06:17）

但同一时期 Founder 又要求每个区都完整、整个 ecosystem 一次设计，担心逐页建设「断代」。（来源：transcript-main-940bfbd9，10:11—10:17）

2026-07-09 他选择混合：

> 「是的就是混合，上市点就是点亮那几个功能的时候。」

决定：整座城先有统一设计，真正上线则等能赚钱的关键链条点亮；其他区可诚实显示 Coming soon。（来源：transcript-main-7fcd6fd4，2026-07-09 01:15）

### 8.2 北极星：先看见整座城

> 「所以最后的结果就是，完美的FIKIRTIVE，只是without functioning 而已。」

北极星原型先把终局页面做成能点、不通电的样板间，批准后成为设计合同，再逐区接后台。（来源：transcript-main-940bfbd9，2026-07-07 10:11；issue #200）

Founder 后来给出更严的定义：

> 「我要的northstar的地步是，链接后台，不做更改就是完整的产品了」

这决定“原型”不能只是漂亮静态页；它必须把真实 flow、对象关系和细节画到接后台就能成品。（来源：transcript-wt-handoff-1ec82f，2026-07-10 06:50）

### 8.3 点亮：从样板间接真电

> 「直接来吧，我们一个板块一个板块验证。」

点亮不是把页面显示出来，而是把 UI 接真实动作、真实数据、Otto skill、测试和回执；一次点亮一个完整闭环。（来源：transcript-wt-handoff-1ec82f，2026-07-10 10:01；PR #214）

> 「dev 团队用 FIKIRTIVE 来 market FIKIRTIVE 并大获成功」

这决定 dogfood 是 GTM 王牌：用自己的产品完成自己的营销，真实成功案例同时是广告和最狠 QA。（来源：`docs/BLUEPRINT.md` §六；v1.8 修订记录）

### 8.4 路线乙：agent 时间不等于人类时间

> 「我要路线乙，因为我认为，数个月是人类的时间，你们agent能直接做好。」

Founder 一度选择“直建全城”：所有 function 与 test 一次做到最佳，卡外部审批的先建基础并显示 Coming soon，最后统一验收。（来源：transcript-wt-small-batch，2026-07-11）

Route-B 随后用 204 行能力清单、B1—B13 blocks、冻结契约和债务棘轮把愿景机械化。（来源：issues-181-270 #238—#270；git-spine 2026-07-12—14）

### 8.5 商业第一期最终收敛为三支柱

2026-07-14 的卖法先钉成三环：做内容、发出去、唤回老客；Canvas 主打，Storyboard 照卖，Factory Coming soon，提醒式发布 v1。（来源：issues-271-360 #298）

2026-07-15—16 的 #334 与 Blueprint v2.12 又把它升级成更完整的三支柱：

1. 品类一流的内容；
2. 真正可用的发布；
3. 完整 Customer Engagement CRM。（来源：issues-271-360 #334；PR #337；commit `1dd479b8`；`docs/BLUEPRINT.md` §六）

三支柱必须**同时**通过功能、质量、UIUX、user flow、真实链路和安全门，才能说第一期完成。提醒送达不等于发布，精选一张好图不等于内容系统完成，三行 contacts table 不等于 CRM。（来源：`docs/BLUEPRINT.md` §六 v2.12）

发布支柱允许 `Reminder-assisted` 独立过第一期；`Direct publish` 只能按实际通过的 channel × post type 点亮。CRM 第一期只要求 WhatsApp 一条顾客渠道真实上线。（来源：`docs/BLUEPRINT.md` §六；#334-8—16）

### 8.6 上线前最后一道门

> 「在整个上线前，我要你帮我做全面的 Full UIUX user flow test（优化完美全部的UIUX，让用户体验感丝滑流畅）和 full product readiness test 和其他类似且必要的 test。请记下来。」

这决定 launch 之前必须真人式走完整旅程，不可只靠单测、代码 review 或 provider 成功。（来源：transcript-wt-orchestration-07ae75，2026-07-22 02:14；issue #424；#359 台账）

Founder 同时决定这一轮 dashboard desktop-only，移动端以后做独立 Otto chat App；宏观 UIUX 终审留到本阶段 features 全部完成，避免逐页 zoomed-in 看不到整体。（来源：transcript-wt-orchestration-07ae75，2026-07-22 07:47）

---

## 9. 定价与商业良心：赚劳动，不赚浪费

> 「对的，credit这个制度就是在FIKIRTIVE平台上，硬通货/货币。」

Credits 是产品内 hard currency；Otto 对话也扣 credits，因为 LLM 成本必须进 costing。（来源：transcript-main-7fcd6fd4，2026-07-07 06:41；transcript-main-940bfbd9，05:09）

当前宪法定价骨架是：每个收费点毛利率 ≥45%，目标 45–50%；内容生成定位中下；利润主场是 Otto 劳动 margin + seats；MYR 主货币、分市场定价；功能全开、档位卖规模；通道费独立账道，不混 credits。（来源：`docs/BLUEPRINT.md` §二第 5 条；PR #109/#131）

> 「不让用户花冤枉钱」

这决定「效率良心」：margin 赚在倍率，不赚在 token 浪费；重复上下文、冗余重发、多余步骤算 defect，prompt caching 优先于涨价。（来源：docs-doctrine；`docs/BLUEPRINT.md` §二第 5 条）

> 「有悖我们的逻辑,Otto 自动化的时候我们就糟糕了」

这永久否决 unlimited 报价：agent 自动化会让无上限承诺变成无限成本敞口。（来源：docs-doctrine 引 GRILL-VERDICTS G-05b；`docs/BLUEPRINT.md` §二第 5、8 条）

> 「任何定价决定都要 costing 先行」

这决定价格不能凭感觉、不能硬编码；每次新 provider / 新收费点先算 COGS，再过毛利地板。（来源：docs-doctrine G-03；`docs/BLUEPRINT.md` §二第 5 条）

---

## 10. 被否决或取代的关键选项

下表只收会影响后来理解的产品/治理选项；纯代码实现小分歧不展开。

| 选项 | 为什么没有走 | 状态与来源 |
|---|---|---|
| `/simple` + `/pro` 两扇门 | 双模不是两个产品；Agency/Pro 应是同一 app 往上加楼层。 | 永久废除；`docs/BLUEPRINT.md` §一 |
| Otto 替代完整人工报表/工具面 | 「Otto 是在原有都建设很棒的基建上的自动化操作员」；人工面是检查、接手与 seats 的根。 | 永久否决；docs-doctrine / GRILL-VERDICTS L80 |
| 白标 | 「我要的就是 FIKIRTIVE 变成世界级别的平台」；不替别人贴牌，Otto 不换名换脸。 | 永久否决；`docs/BLUEPRINT.md` §二第 8 条 |
| 外部 MCP/API 让别的 agent 操作 FIKIRTIVE | 「如果会用其他 LLM,代表我们的 Otto harness 不够好」；本城 agent 只有 Otto。 | 永久否决；PR #109/#206；Blueprint 第 8 条 |
| 开放第三方 skill 生态 | 「我们是全平台不是单 feature,内部处理更好控制」。 | 永久否决；GRILL O-11；Blueprint 第 8 条 |
| Unlimited 套餐 | 「Otto 自动化的时候我们就糟糕了」；无限使用 = 无限成本敞口。 | 永久否决；GRILL G-05b；Blueprint 第 5/8 条 |
| Slack / Notion 类 connectors | 首战 SMB 活在 WhatsApp/Meta/TikTok/Shopee，不在欧美知识工作流。 | 永久否决；O-13；Blueprint 第 8 条 |
| 「评价 × 奖励」一个按钮 | Google 禁止激励换评价，合体会拿全体商家的平台接入资格冒险。 | 永久否决；PR #212；Blueprint 第 8 条 |
| 独立 Build coding agent / 通用 Chat / Spicy 18+ | 不属于营销与增长平台边界。 | 永久不做；Blueprint 第 8 条；更细理由输入未捕获 |
| Grok 字面 100% 复刻 | 外部 MCP、无限并行、社区 feed 等会撞宪法；只取 Canvas 手感。 | 已改写；docs-doctrine §③/⑤ |
| Grok Discover 用户作品社区 | 会暴露跨租户内容、需要另造发布社区；改成 BELCORT 静态 Inspiration Gallery。 | 已否决；issues-1-90 #59 |
| 隐藏的 specialist-agent swarm | Founder 要的 multi-agent 被解释成共享 Canvas 上的多 conversation，不是人格 swarm。 | 已否决；issues-1-90 #56 |
| 13 个视频模型让用户选 | 12 个选项会落入“不可用/不花费”死路；与单一可售 model 规则冲突。 | 已收窄；issues-1-90 #63 |
| Whole-clip reference video 立即做 | 先走 cheap-first 抽帧版本，整段参考当时延后。 | 阶段性延后；issues-1-90 #84 |
| Canva template-first | 第一性原则是 research + Otto 直接创作；template 只提供 inspo。 | 产品方向否决；transcript-wt-handoff-1ec82f 06:04 |
| Literal computer-use Otto | Otto 已住在产品里，应走动作层；UI 负责 live reflection。 | 被 native action-layer 取代；Blueprint 第 11 条 |
| 逐页 North Star、边做边定 | Founder 担心「断代」；改成一次看全生态。 | 被 North Star Immersive 取代；transcript-main-940bfbd9 10:17 |
| 把 shell-wrapped 57/65 页原型当工程车道 | Founder 看出「拼凑」；审计证实 34/57 页是旧 gallery 套壳。 | 关闭；issue #202/#203；transcript-main-rest |
| 假 Salesforce 骨架 | 第一期只做完整 Customer Engagement CRM；空对象既误导又分散。 | 第一期明确不做；#334；Blueprint v2.12 |
| 客户记录自动/上线版手动 merge | 商家数据由商家决定；只提醒疑似重复。 | 上线版不做；issues-271-360，2026-07-23 Resolution |
| 自有积分账本 | 经营事实只读；奖励用商家自己的积分/Voucher/手工载体。 | 否决；PR #210/#212；原因细节在输入中不完整 |
| 360dialog 起步 | 固定 €250/月/5 频道，Founder 判断很难 scale。 | 被 Gupshup 过渡取代；#293 |
| Gupshup 作为最终 WhatsApp 主权层 | 号码与数据应留在商家 Meta Business Manager。 | 被 Meta Cloud API + Embedded Signup 取代；#301 |
| 全局红色停止按钮 / pause-takeover 重机器 | Founder 判 over-design；对象级人一插手就停，全局 kill switch 留给 routine。 | 否决；#295/#298 |
| Responsive mobile web dashboard | 手机以后由独立 App 承载。 | 当前阶段不做；transcript-wt-orchestration-07ae75 |
| Provider 名称出现在用户面 | 后台供应商是商业机密，用户买能力和结果。 | 永久营运禁区；#436/#454 |
| fal.ai | 「fal 我不用了，可以移除。」 | 已移除方向；#443 |
| monid.ai | 不透明 reseller、无 SLA/量价、实测目录空；另有数据转售风险。 | 研究否决；#379/#380 |
| Sevalla 搬家 | 对 bursty video workload 贵 2–3 倍，另有 2–4 天迁移与 Prisma 风险。 | 否决；transcript-main-940bfbd9 |
| 语言约定继续放宪法 | 引擎最佳 prompt 语言会变，不是永不漂移原则。 | v2.13 移出宪法；PR #444 |

---

## 11. 现行常设规则总表

本节的“每一条”范围是：18 份 digest 与 live Blueprint 中，被明确标成**入宪、永久、standing rule、hard rule、Founder Resolution 或现行项目法**的规则。临时 sprint 授权另列在 11.4，不会伪装成常法。

**引文规则：** 表内有「」的是指定证据中可逐字核对的 Founder 原话或获批定稿句；没有「」的是 durable resolution / live law 的忠实摘要，因为指定 digest 没保留一段可安全冒充 verbatim 的完整原话。档案宁可明示这个缺口，也不补造引文。

### 11.1 生效中的宪法级规则

| # | 规则原文 / 定稿措辞 | 仍在生效？ | 来源 |
|---|---|---|---|
| C1 | 「FIKIRTIVE 是一个 ALL-IN-ONE 的 MARKETING POWER HOUSE PLATFORM」 | 是；终局身份 | `docs/BLUEPRINT.md` §一；PR #187 |
| C2 | 「FIKIRTIVE 上每一个 feature 都可以 100% 人操作,OTTO 也能操作 100% 全部。」 | 是；最高设计要求 | Blueprint §一/§二第 7 条；PR #187 |
| C3 | 「全部 feature」只来自对标研究 + Founder 判决，agent 不自行发明 | 是 | Blueprint §一 v2.5 解读边界 |
| C4 | 世界级 ALL-IN-ONE 营销与营收增长 OS；全球为底、本地为皮；不用裸「营收 OS」 | 是 | Blueprint §一 v2.11；PR #212 |
| C5 | 四层责任边界：本体负责 / 读取并验证 / 明确交接 / 永久不做 | 是 | Blueprint §一；PR #212 |
| C6 | 「只有一扇门」；Pro/Agency 是楼层，不是第二个 app | 是 | Blueprint §一 |
| C7 | 「安全 > 效率 > founder 易管理」 | 是 | Blueprint §二第 1 条 |
| C8 | 「钱路神圣」；money-in 只有 `grantCredits`；spend path 任何 diff 必过 money-safety-review | 是 | Blueprint §二第 2 条 |
| C9 | 「开发/验证阶段的每笔真实供应商花费逐笔问 founder —— "问"就是上限,没有代码上限」 | 是 | Blueprint §二第 2 条、v2.8 附则④ |
| C10 | 未来任何新花费点必须走 credits 或通道费账道并进入消费明细，不许旁路 | 是 | Blueprint §二第 2 条 |
| C11 | Otto 五铁律：credits 透明、花钱前审批、失败退款/不双扣、建议下一步、One Otto | 是 | Blueprint §二第 3 条 |
| C12 | `needsApproval = spend OR (external write)`；字段缺失 fail-closed | 是 | Blueprint §二第 4 条 |
| C13 | turn 计量和 routine 预授权是审批在别处；routine 必有预算、scope、kill switch、摘要 | 是 | Blueprint §二第 4 条、§六 |
| C14 | 每收费点毛利 ≥45%；定价/成本不硬编码；costing 先行 | 是 | Blueprint §二第 5 条 |
| C15 | 「不让用户花冤枉钱」；永不赚浪费，低效按 defect | 是 | Blueprint §二第 5 条 |
| C16 | seats + credits 双轨；MYR-first + 分市场；通道费独立账道 | 是 | Blueprint §二第 5 条 |
| C17 | 任何 unlimited 报价永久禁止 | 是 | Blueprint §二第 5/8 条 |
| C18 | 「租户铁幕」：ownerId 来自认证 session，绝不信客户端身份 | 是 | Blueprint §二第 6 条 |
| C19 | UI 与 Otto 必须走同一动作层；Parity Manifest、读对等、上下文桥是结构围栏 | 是 | Blueprint §二第 7 条 |
| C20 | 就地 AI 按钮 = Otto 的手；coral 是 Otto 专属身份 | 是 | Blueprint §二第 7/11 条 |
| C21 | 创作域可视 Canvas；规则/自动化域用可读规则文件，不做节点画布 | 是 | Blueprint §二第 7 条 |
| C22 | Otto 对等四豁免：admin、纯视觉微操、账户安全、money-in | 是 | Blueprint §二第 7 条；v2.8 附则① |
| C23 | Skill 永久内部；外部 agent 不得获得本城操作面；官方协议消费例外 | 是 | Blueprint §二第 8 条、v2.10 附则⑦ |
| C24 | 白标、独立通用 Chat、Build coding agent、NSFW、Slack/Notion connectors 永久不做 | 是 | Blueprint §二第 8 条 |
| C25 | 请评与奖励永久分离 | 是 | Blueprint §二第 8 条；PR #212 |
| C26 | Skill 为弱模型设计：判断冻进 deterministic code/schema/template | 是 | Blueprint §二第 10 条 |
| C27 | UIUX 是第二支柱；Apple 质感、克制 gamification；streak 不要 | 是 | Blueprint §二第 11 条 |
| C28 | Live reflection：秒级感知、动作可见、Otto 可唤起但不抢主场 | 是 | Blueprint §二第 11 条、v2.8 附则③ |
| C29 | 零学习曲线：只需「说要什么」「点批准」；一场会话见首个成果 | 是 | Blueprint §二第 11 条；PR #204 |
| C30 | 第一期三支柱必须同时真实完成，不能用 mock/空页面/单测/精选样片冒充 | 是 | Blueprint §六 v2.12；PR #337 |
| C31 | 第一阶段发布可由 Reminder-assisted 独立放行；Direct publish 按真实 channel × type 点亮 | 是 | Blueprint §六 v2.12 |
| C32 | 第一阶段 CRM 对标 respond.io，只要求 WhatsApp 一条顾客渠道真实上线；不造假 Salesforce 骨架 | 是 | Blueprint §六 v2.12 |
| C33 | Blueprint 修订只走 §七：Founder 亲改，或授权起草 + Founder 合并 | 是 | Blueprint §七 |
| C34 | 代码与 Blueprint 冲突：停手、报告、等裁决 | 是 | Blueprint §七 |

### 11.2 生效中的 Founder Resolution / 产品营运硬规则

| # | Founder 原话或定稿句 | 仍在生效？ | 来源 |
|---|---|---|---|
| R1 | 「有根据、不捏造」 | 是；所有分析/诊断的诚实底线 | issues-91-180 #128 |
| R2 | 「商家的 data，商家的权利，我们只是提醒。」 | 是；CRM/privacy 总原则 | issues-271-360 #356；PR #364 |
| R3 | 「otto的任务是了解我们的用户需求，然后做出他们要的东西，而不是先判断用户都会是商家，这个是不一定的，明白吗？所以我才说全部，全部东西都要best practice 且是开放式，而不是有局限性的。」 | 是；Otto open-ended 原则 | issues-271-360；transcript-wt-orchestration-50ba3d-current |
| R4 | 「使用 skill 来协助用户就好，加多一个营销的那个有点不必要」 | 是；Otto main identity = platform operator | issues-271-360，2026-07-23 |
| R5 | 「当然也不会让他们知道我们后台使用什么，这个也是一个商业机密，要记下来。」 | 是；用户面不得泄露 provider | issue #436；PR #454；transcript-wt-orchestration-50ba3d-current |
| R6 | 「fal 我不用了，可以移除。」 | 是；当前 provider roster | issue #443 |
| R7 | 「参考我们的龙头对象如何处理。借鉴。」 | 是；借鉴先行律 | PR #213；transcript-wt-handoff-1ec82f |
| R8 | 「不要每一个feature 半桶水」 | 是；每区达到类别完整度 | transcript-main-7fcd6fd4，2026-07-09 |
| R9 | 「FIKIRTIVE 只需避免 over-promise、如实报告；Otto 的主形象必须是精明能干的员工，不是'诚实的傻瓜'」 | 是 | issue #334-3 |
| R10 | 一个 request 一次批准；内容/价格指纹漂移重批 | 是 | issues-271-360 #294/#298 |
| R11 | 对象级人插手即停；不建全局 pause/takeover 重机器；routine 才有全局 kill switch | 是 | issues-271-360 #295/#298 |
| R12 | 平台永久独立于供应商，来源都走统一 connector seam | 是 | issue #334-12/13 |
| R13 | 联系人 merge 不在上线版；未来只能商家确认式 | 是 | issues-271-360，2026-07-23 Resolutions |
| R14 | Enterprise 字段级/自管密钥是未来必须项 | 是，但未来触发 | issue #356 D-Q7；#359 |
| R15 | 上线前做 Full UIUX user-flow + product-readiness 全面测试 | 是；launch gate | issue #424；#359；transcript-wt-orchestration-07ae75 |
| R16 | 当前 dashboard desktop-only；手机以后做独立 Otto chat App | 是，当前阶段边界 | transcript-wt-orchestration-07ae75；transcript-main-7fcd6fd4 |
| R17 | 规则系统须 composable、extensible、declarative；人和 Otto 操作同一逻辑 | 是 | transcript-wt-orchestration-07ae75；PR #414 |
| R18 | UIUX 终审看完整宏观 flow，不以逐页小修代替 | 是；与每 feature 工程审查并行 | transcript-wt-orchestration-07ae75 |
| R19 | Credits 是平台 hard currency；Otto 对话也扣 credits | 是 | transcript-main-7fcd6fd4；Blueprint 第 3/5 条 |
| R20 | 设计同步到 Claude Design 与 repo，因为其他 agent 看不到 Claude Design | 是；工作习惯 | issue #196；transcript-main-940bfbd9 |
| R21 | 报告用人话、短、带具体例子 | 是；Founder 沟通规则 | transcript-wt-handoff-1ec82f；transcript-wt-orchestration-50ba3d-current |
| R22 | 「先图纸后重建」；批准的设计合同不能被后台随意改坏 | 是，适用于大设计件 | transcript-main-rest；issue #200/#203 |
| R23 | 「不监守自盗」：执行者不可单独自证质量 | 是；已进入 author/reviewer 分离治理 | transcript-main-rest；现行项目法 merge authority |
| R24 | 「我要最好的，如果全都做是最好那就全都做，我在乎唯一标准就是质量和效率。」 | 是；但必须服从 Blueprint 的安全优先级 | transcript-main-7fcd6fd4；transcript-main-940bfbd9；transcript-wt-small-batch |
| R25 | 「其实我想的是，就直接做好产品，要如何market那些是我的问题，不是coding agents的问题，只要做好我要的features就行了。不要困惑自己，对吧？」 | 是；coding agent 不替 Founder 改写市场定位 | transcript-wt-small-batch；transcript-main-7fcd6fd4，2026-07-07 |
| R26 | 「记得东南亚只是我们的发起地，全球范围的垄断，是我们的最终目标。」 | 是；SEA 是发起地，产品地基 global-first | transcript-main-7fcd6fd4；transcript-wt-quizzical-jepsen，2026-07-09 |
| R27 | 「每一个环节所用到的工具，都要是最完美无缺的，就是如果说我们用到canva哪一环节，就是要最强的canva（magicpath or grok ish）这样的意思。」 | 是；每个模块须类别级完整，不可半桶水 | transcript-main-7fcd6fd4；transcript-wt-quizzical-jepsen，2026-07-09 |
| R28 | 「最好的是，遵守第一性原则，一定是有一个规则能够处理这些事情的」 | 是；优先通用规则，不堆一次性特例 | transcript-wt-quizzical-jepsen，2026-07-09 |
| R29 | 「然后那些什么harmony-xx ，wave -xx 我不是很明白。可以用更容易明白的名词或什么吗？」 | 是；给 Founder 的概念与命名须用人话 | transcript-wt-serene-swartz；transcript-main-7fcd6fd4，2026-07-07 |
| R30 | 「除了通不通，其实更重要的是工具合理性，实用性，设计。你明白吗？整个东西最后是不是有效果的。」 | 是；QA 同时验能否运行、是否合理、是否有结果 | transcript-wt-quizzical-jepsen；transcript-main-7fcd6fd4，2026-07-09 |
| R31 | 「可以，接下来每个feature 我都要这样的审查。确保UIUX，user flow 那些都正确。」 | 是；每个 feature 都需 UIUX/user-flow 审查 | transcript-wt-mid-batch，2026-07-18 |
| R32 | 「照呈批准」 | 是；回执默认保留 24 个月、清理前提醒，商家可调长短/关闭并随时删除导出 | issue #405，2026-07-22；issues-361-453 |
| R33 | 「认同移除」 | 是；Blueprint 第 9 条语言规则移出宪法，prompt 语言按 engine 实测；现行项目法仍写 English，故该落位矛盾【待对齐】 | issue #444；PR #444/#445；Blueprint v2.13；现行项目法 |

### 11.3 生效中的治理规则

| # | 规则 | 仍在生效？ | 来源 |
|---|---|---|---|
| G1 | 永不直接 push `main`；所有变更经 PR | 是 | 现行项目法；PR #104 后续治理 |
| G2 | Founder-only：Blueprint、治理/merge policy、不可逆架构、schema/migration、钱/tenant、credentials、production、外部发布/花费/删除等 | 是 | 现行项目法 |
| G3 | CI unavailable 不是 green；需当前 workflow 本地复现 + 独立跨族 review + Founder 明示 CI-unavailable approval | 是 | 现行项目法；issues-361-453 #369/#371 |
| G4 | 模型/harness authority 必须由 process evidence 验证；失败立即停相关权力 | 是 | issues-361-453 #390/#391；现行项目法 |
| G5 | 每次 merge 留 executor evidence；作者不得合自己的 materially edited diff | 是 | PR #406；现行项目法 |
| G6 | Founder product decision 用 durable GitHub Founder Resolution 保存原话、时间、范围、supersedes | 是 | issue #335 |
| G7 | Repo mutation 在明确解冻后先取得唯一 task-linked ACTIVE claim；claim 不授产品/merge/部署权 | 是 | 现行项目法；task-ownership runbook |
| G8 | 延后事项必须 durable 进 #359/当前 task，不能只留聊天 | 是 | issues-271-360，2026-07-19 |
| G9 | 高后果件需 author/orchestrator 不同 frontier family 的 bounded read-only challenge | 是 | 现行 overlay / 项目法 |
| G10 | 华语状态用【已验】【在途】【待决】；未查询外部事实写 Unknown | 是 | 现行 overlay；issues-271-360 |

### 11.4 已失效、被取代或仅限当时任务的“旧常令”

| 旧口令 | 今天的状态 | 为什么 |
|---|---|---|
| 「本次冲刺期间，CI 绿灯的 PR 授权你审完合并」 | 已到期 | 只限 2026-07-07 sprint；当前 merge authority 无 standing controller。来源：transcript-main-940bfbd9；现行项目法 |
| 「你能直接自己批准」；「我不要一个一个审核，最后直接一次过处理」 | 已到期 | Route-B Standing Merge Delegation 的中途授权，不可转授项始终保留；当前 task 重新核权。来源：#254；issues-181-270 |
| 「上限只要在25美金之内，不需问我」 | 已到期/不可当常法 | 是特定 goal loop 的 spend envelope；当前宪法要求开发验证真实 spend 逐笔问。来源：transcript-wt-small-batch；Blueprint 第 2 条 |
| 「这个阶段skip CI吧」 / 「CI 不行就 skip」 | 已被取代 | 后续法律明确 CI unavailable ≠ green，必须本地复现并获 Founder 特批。来源：transcript-wt-small-batch / transcript-wt-mid-batch；现行项目法 |
| GitHub 免费计划（不升级 Pro） | 已被后续行动取代 | #104 的旧决定后，2026-07-07 Founder 加卡、升级 Pro、迁 org。来源：issues-91-180 #104；transcript-main-940bfbd9 |
| 「请你永久记得这个。（只要我的MODEL是FABLE就用这个。）」以及 Fable/Opus/Sonnet 固定旧 routing | 条件已不成立；原始 model-specific 方法休眠 | Fable 已不存在；今天保留的是可验证身份、适才路由、独立复审。来源：transcript-main-7fcd6fd4；transcript-wt-quizzical-jepsen；#225/#226；#390/#391；现行项目法 |
| 「一定要找着fable 5的质量去做。不要掉质量」 | 字面 model 名已历史化；质量不得下降与不得自审仍生效 | 旧 wording 依赖当时的 Fable；继承原则见 R23、G4/G9。来源：transcript-main-7fcd6fd4；transcript-wt-quizzical-jepsen；现行项目法 |
| Gupshup 起步 | 已被 Meta direct supersede | 数据和号码留商家自己 BM。来源：#293 → #301 |
| 全部功能一次建完再上市（旧商业完成口径） | 被 v2.12 三支柱收敛 | Route-B 仍是施工史，但商业第一期由三支柱定义。来源：transcript-wt-small-batch；Blueprint v2.12 |
| 英文 generation prompt 是宪法硬规则 | v2.13 已移出宪法 | 引擎偏好会变；prompt 语言应由 prompt authority 实测。来源：PR #444；Blueprint 第 9 条墓碑 |

---

# Part 2 — 产品词典

## A. 产品身份与城市语言

| 词 | 一句话人话解释 | 起源 / 状态 / 来源 |
|---|---|---|
| **Artlio** | FIKIRTIVE 在 2026-06-21 前的产品名。 | git-spine，commit `6b151d3f`；Founder 命名动机的早期对话缺档 |
| **Cowork** | Otto 在改名前的 AI 协作系统名称。 | git-spine，commit `6b151d3f` |
| **FIKIRTIVE** | 给中小商家的世界级 ALL-IN-ONE 营销与营收增长平台。 | `docs/BLUEPRINT.md` §一；名称落定见 `6b151d3f` |
| **ALL-IN-ONE MARKETING POWER HOUSE PLATFORM** | 终局里营销相关的完整功能都在同一平台，不是单点 generator。 | Founder 原话，transcript-main-7fcd6fd4 2026-07-07；PR #187 |
| **revenue-growth OS** | 帮商家做营销与营收增长，但不冒充会计、税务、收付款或完整售后系统。 | Blueprint v2.11；PR #212 |
| **全球为底、本地为皮** | 全球能力做骨架，Malaysia/SEA 只是在语言、支付、渠道和价格上本地化。 | Blueprint §一 v2.11；transcript-main-7fcd6fd4 2026-07-09 |
| **滩头阵地** | 首先攻下的市场，不等于最终市场；当前是 Malaysia/SEA。 | Blueprint §一 |
| **顾客一号** | 第一批用来把产品优化到真实可用的具体商家，而不是虚构 persona。 | Blueprint §一 v2.11；CUSTOMER-ONE 档案由 docs-doctrine 索引 |
| **concierge-assisted pilot** | 早期可由团队人工辅助，但必须如实叫 pilot，不能冒充全自动规模化产品。 | TWO-BRAIN R5 摘要；docs-doctrine；issues-181-270 #210 |
| **城市 / 楼 / 区 / 地下管网** | 用城市比喻平台：功能是楼和区，共享数据、钱路、队列和安全是地下管网。 | `docs/BLUEPRINT.md` 全文结构，2026-07-03 v1—v2.3 |
| **市政厅** | 平台运营与账房后台，只给授权 staff 人工操作，Otto 永久豁免。 | Blueprint §三、§六「市政厅 v2」；第 7 条豁免 |
| **钱的阶级** | 市政厅按角色设置单笔/日累计授信上限，超限走 Founder 审批。 | Blueprint §六「市政厅 v2」；v1.3 修订记录 |
| **只有一扇门** | 商家只进入一个 app；Otto 与人工用同一批工具，Pro/Agency 只是往上加楼层。 | Blueprint §一 |
| **扩建缝 / 九条缝** | 新能力必须接入既有 skill、provider、ledger、channel、tenant、queue、design、card、parity 接口，不能私拉旁路。 | Blueprint §四；PR #109 |
| **北极星（North Star Prototype）** | 先把终局产品做成可点击、逻辑完整的样板城，再按批准设计接真实后台。 | Founder 2026-07-07 原话；issue #200；transcript-main-940bfbd9 |
| **North Star Immersive / 沉浸城** | 把分散样板页连成一套可亲手走完整流程的前端体验。 | transcript-main-rest；issues-181-270 #202/#203；工程车道后来关闭，保留为设计基准 |
| **点亮** | 把样板间接上真实数据、动作、Otto skill、测试和回执，使它真的能用。 | PR #214；transcript-wt-handoff-1ec82f 2026-07-10 |
| **真闭环** | 从用户意图到执行、外部事实、回执和下一步都能验证的一条真实链，不能靠人工改 DB 或假回执。 | MASTERPLAN 点亮章由 docs-doctrine/git-spine 索引；PR #214 |
| **一条真闭环先通** | 先让一条端到端的商业旅程真正跑通，再点亮更多城区。 | commit `f5da8d0c`；PR #214 |
| **路线乙 / Route-B** | Founder 选择的“agent 时间直建全城”施工路线，用有限能力表、blocks、冻结契约和债务棘轮推进。 | transcript-wt-small-batch 2026-07-11；issues-181-270 #238—#270 |
| **Coming soon** | 对已设计但尚无真实链路的功能诚实封门，而不是用 mock 假装可用。 | transcript-wt-small-batch；issues-271-360 #298；Blueprint §六 |
| **商业第一期三支柱** | 品类一流内容 + 真正可用发布 + 完整 Customer Engagement CRM，三者一起过门才可售。 | issue #334；Blueprint v2.12；PR #337 |
| **Customer Engagement CRM** | 以联系人、对话、群发、工作流、回执经营顾客关系的 CRM；第一期对标 respond.io，不是 Salesforce 销售运营全家桶。 | Blueprint §六 v2.12；#334 |
| **第一米（First mile）** | 顾客第一次发现、进入、留下来源并成为可经营联系人的前段旅程。 | Route-B B8 first-mile design 由 issues-181-270 / docs-doctrine 索引；该词非 Founder 原话，属项目设计语言 |

## B. Otto、交互与双 100%

| 词 | 一句话人话解释 | 起源 / 状态 / 来源 |
|---|---|---|
| **Otto** | FIKIRTIVE 的平台操作员：先理解用户要什么，再通过 skills 使用整个平台。 | 2026-06-21 rename `6b151d3f`；身份定案见 issues-271-360 2026-07-23 |
| **超级员工** | 用户可以让 Otto 代做整套工作，也能随时看见、批准或亲手接管。 | Blueprint §一；Founder live-reflection 讨论 transcript-main-7fcd6fd4 |
| **MARKETING AGI** | 2026-07-09 用来讨论“覆盖所有营销专业能力”的中间说法，不是最终 Otto main identity。 | transcript-main-7fcd6fd4；后被“平台操作员”收窄，issues-271-360 |
| **双模** | 同一个功能既是完整人工工具，也是 Otto 可代操作的工具。 | Blueprint §一/§二第 7 条；2026-07-03 Founder 定调 |
| **双 100%** | 人能 100% 操作所有 feature，Otto 也能 100% 操作平台允许它操作的一切。 | Founder 2026-07-07 原话；PR #187 |
| **One Otto** | 新 AI 能力永远加入同一个 Otto，不另造第二个 AI app 或匿名按钮。 | Blueprint §二第 3 条 |
| **skill harness** | Otto 获取能力的统一技能框架，专业判断尽量固化在结构里。 | issues-1-90 #28；Blueprint 第 10 条 |
| **`defineOttoSkill`** | 每个新 Otto 能力必须通过的标准 skill factory。 | commit `30d837a0`；Blueprint §四 seam 1 |
| **单一动作层** | 人按按钮和 Otto 调 skill 最终调用同一业务动作，避免两套逻辑漂移。 | Blueprint 第 7 条；PR #109 |
| **Parity / 人机对等** | 人工功能与 Otto 能力在行为、读面和安全上相等。 | Blueprint 第 7 条；harmony-02 由 docs-doctrine 索引 |
| **Parity Manifest** | action 与 skill 的登记表；新 action 没配 Otto 或合法豁免就被 CI 拦住。 | Blueprint 第 7 条、§四 seam 9 |
| **假 parity** | 表面登记“人/Otto 都能做”，实际却走不同逻辑、错误定价或根本做不到。 | git/Route-B 债务历史；transcript-wt-small-batch 2026-07-13 |
| **Parity debt / 债** | 暂时未达到双 100% 的明示欠账，必须诚实计数、只减不偷偷增加。 | issues-91-180 #180；Route-B commits 2026-07-12—14 |
| **读的对等** | 人能看到的数据，Otto 也有安全的 read skill，不做瞎子操作员。 | Blueprint 第 7 条 |
| **上下文桥** | 把当前页面、选中对象和视图状态带进 Otto 对话，让“改这个”有明确指代。 | Blueprint 第 7 条 |
| **Otto 的手** | 页面里的 AI 小按钮仍是同一个 Otto、同一记忆、同一动作层。 | Blueprint 第 7 条 O-12 |
| **builder 分域** | 创作适合可视 Canvas；自动化适合可读规则文件，不强迫所有东西变成节点图。 | Blueprint 第 7 条 O-09 |
| **Agent-native UI** | 界面从设计时就假设 agent 会通过内部动作层工作，不是事后外挂聊天框。 | PR #192；Blueprint 第 11 条 |
| **Live reflection** | Otto 在后台做事时，界面秒级显示真实变化、coral 高亮和简短叙述。 | Founder 2026-07-07；PR #192；Blueprint 第 11 条 |
| **Otto 常驻但不抢主场** | Otto 一步可唤起、工作始终可见，但 Canvas/工作台仍是视觉中心。 | PR #195；Blueprint v2.7 |
| **Canvas-as-home** | 创作工作台是用户主要工作场，不是先聊天再跳去别处的附属页。 | Blueprint §三创作区；docs-doctrine |
| **Coral** | Otto 动作的专属视觉颜色，帮助用户区分“我做的”和“Otto 做的”。 | Blueprint 第 7/11 条；design rules #199 |
| **双声部** | 一套界面用两种视觉声音区分用户之手与 Otto 之手；提案中 blue=human、coral=Otto。 | transcript-main-7fcd6fd4，2026-07-09；属于设计方向，不是独立宪法条 |
| **刨根问底 · 硬门** | Otto 在必要资料不全时先问清楚，不凭猜测执行。 | issues-1-90 #83；`requires` gate |
| **零学习曲线定律** | 学不会产品是产品缺陷；用户只需会说目标和点批准。 | Founder「入宪」；PR #204；Blueprint 第 11 条 |
| **信任阶梯** | 从看提案、批准一次，到给 routine 预授权，逐步放权而不取消安全闸。 | Blueprint 第 11 条 v2.9 |
| **实力是信任的引擎** | 好产品本身让用户更快信任，审批闸只是安全带。 | Founder 原话「像 Apple」；PR #204 |
| **Otto 帮我** | 用户不知道如何描述需求时，由界面提供一个求助入口，把目标转成下一步。 | transcript-main-7fcd6fd4，2026-07-09 14:22；概念方向，未在输入中证明已完成 |
| **Routine** | 用户一次批准的定时/重复工作，之后在预算、范围和 kill switch 内自动执行。 | Blueprint 第 4 条、§六 |
| **授权信封** | 把一次批准的内容、价格和范围精确锁住；任何漂移都要重新批准。 | issues-271-360 #294 |
| **余额即闸** | 对已明确计量的 turn 或特定直接动作，余额本身可充当执行硬闸，但失败退款与不双扣仍不变。 | issues-181-270 #191；其适用范围受 Blueprint 第 4 条约束，不能泛化 |
| **对象级插手即停** | 人接管某一件工作时，Otto 只从那件事上拿开手，继续做别的。 | issues-271-360 #295；文案「这张归你了，我继续做别的」 |
| **Composability / 可组合性** | 自动化由 trigger × condition × action 积木拼出多种规则。 | transcript-wt-orchestration-07ae75，2026-07-22 |
| **Declarative rules engine** | 规则作为可读数据保存，由受控引擎执行，未知 block 拒绝而不猜。 | transcript-wt-orchestration-07ae75；PR #414 |

## C. 诚实、钱路与数据

| 词 | 一句话人话解释 | 起源 / 状态 / 来源 |
|---|---|---|
| **诚实层** | 把后端真实余额、失败理由和执行结果原样带到 UI，禁止显示假成功。 | commit `4049323d`「#430 确认页诚实层」；PR #449 |
| **honest unknown / 诚实未知** | 外部事实还没拿到就显示 unknown，不用本地状态假装 provider 已完成。 | C6 delivery report，git-spine `9dcf8078`—`f2adffac` |
| **有根据、不捏造** | 每个分析结论必须有真实数据与来源；资料不足就 abstain。 | issues-91-180 #128 |
| **Credits / 硬通货** | FIKIRTIVE 内部购买 AI 劳动和生成的统一计量货币。 | Founder 原话，transcript-main-7fcd6fd4；Blueprint 第 5 条 |
| **money-in** | 商家给 FIKIRTIVE 充值/购买 credits 的进钱路径，Otto 永不代办。 | Blueprint 第 2/7 条 |
| **spend path** | 从批准、预扣、provider 调用到结算/退款的花费路径。 | Blueprint 第 2 条 |
| **exactly-once** | 同一个获批动作无论重试多少次，都最多扣一次、外发一次。 | Blueprint 第 2—4 条；项目法 money safety |
| **fail-closed** | 资料、权限或状态不确定时默认不执行，而不是冒险放行。 | Blueprint 第 4 条；全项目钱路/tenant/channel 规则 |
| **reserve → settle / refund** | 先预留 credits，成功按实际结算，失败把钱退回。 | Blueprint §四 credit-ledger seam；issues-1-90 money safety |
| **审批数学** | 只要花钱，或会对外写入，就需要批准；缺字段按危险处理。 | Blueprint 第 4 条 |
| **效率良心** | 赚钱来自倍率与劳动价值，不来自让用户多烧 token。 | Founder「不让用户花冤枉钱」；Blueprint 第 5 条 |
| **第二账道 / 通道费账道** | WhatsApp 等第三方通道成本单独透明直传，不混入 FIKIRTIVE credits。 | Blueprint 第 5 条；harmony-05 由 docs-doctrine 索引 |
| **租户铁幕** | 不同商家的数据绝不能互相读写，所有 owner 身份取自认证 session。 | Blueprint 第 6 条 |
| **商家的 data，商家的权利，我们只是提醒** | 商家拥有客户与 permission 数据，平台负责保管、工具和提醒，不替他作一般处置决定。 | Founder 2026-07-19；issue #356；PR #364 |
| **四层边界表** | 用“谁拥有责任”划 FIKIRTIVE 与外部经营系统的边界。 | Blueprint v2.11；PR #212 |
| **read → trigger → handoff → receipt** | 对不归 FIKIRTIVE 所有的售后/会计等事务，只读取事实、触发交接、确认对方接收并保存回执。 | Blueprint §一边界表 |
| **Provider-neutral** | 核心业务说“图片生成/消息发送”，而不是把某家供应商名字写死。 | issues-271-360 #334-12/13；C4/C5 specs 由 docs-doctrine 索引 |
| **Provider secrecy** | 用户只看能力、价格和结果，不知道内部用 Seedance/Seedream/BytePlus。 | issue #436；PR #454 |
| **载体（carrier）** | 把抽象规则变成可存、可查、可执行、可审计的具体对象，例如事件表、manifest、receipt 或规则文件。 | docs-doctrine C7「数据库载体」；C4/C5/C7 physical-contract specs；不是单一 Founder 原话 |
| **物理契约** | 开工前先钉死真实数据对象、唯一写者、状态和失败边界，防止 UI 与引擎各自幻想。 | issue #368/#414；issues-361-453 C1—C7 M0 流程 |
| **三轴分立** | Consent、商家 DND、provider 拒发是三种独立禁止理由，不能混成一个名单或互相覆盖。 | Route-B/C5 physical-contract docs；issues-271-360 #356 附近；不是「三轴报告」的已证定义 |
| **三轴报告** | **待核：指定 18 份 digest 与 live Blueprint 没有出现这个精确术语，不能安全断言它指哪三轴。** | 最近候选是 C5 的 consent/DND/provider 三轴分立，或 C4 template 的 submission/review/availability 三轴；两者都不能无证据改名成「三轴报告」 |
| **简报即产品** | **待核：指定证据中没有这个精确词，也没有 Founder verbatim 定义；目前不可当作 standing term 使用。** | 最近证据只有 Campaign Brief 是 AI 生成的单一事实来源（`docs/research/2026-07-03-campaign-management-cross.md`），但这不足以证明「简报即产品」的词源 |
| **Campaign Brief / Campaign 简报** | 把目标、受众、品牌要点和约束放在一处，作为 Campaign 生成与审批的事实来源。 | `docs/research/2026-07-03-campaign-management-cross.md`；非 Founder coined 的确证 |

## D. 发布、CRM 与增长

| 词 | 一句话人话解释 | 起源 / 状态 / 来源 |
|---|---|---|
| **Reminder-assisted publish** | FIKIRTIVE 准备好内容并在正确时间提醒商家，由商家完成最后发布。 | Blueprint v2.12；#334 |
| **Direct publish** | FIKIRTIVE 经已批准的真实 channel API 直接发布，只能逐 channel × post type 点亮。 | Blueprint §六 |
| **逐帖 / 精确批次批准** | 外发授权必须明确对应一帖或一批，提醒与历史 queue 不能冒充批准。 | Blueprint v2.12 |
| **Channel seam** | 每个平台只加 adapter，不改核心发布逻辑。 | Blueprint §四 seam 4、§六 |
| **WhatsApp-first** | 第一阶段 Customer Engagement 先让 WhatsApp 真上线，email 与其他渠道后续接入。 | Blueprint §六；#334-15 |
| **Contact / Identity** | 同一个顾客在不同渠道上的身份与联系人记录。 | Blueprint §六 CRM 清单；C1 commits `83946443`、`1f8d8f26` |
| **Consent ledger** | 追加记录顾客同意/撤回事实，能 fold/replay，而不是只存一个可被覆盖的布尔值。 | issues-361-453 #361—364；git-spine |
| **DND** | 商家主动设定的“不要联系”，与顾客 consent 和 provider 拒发分开。 | C5 physical contract；issues-271-360 #356 |
| **Suppression** | 发送前把 STOP、DND、provider hard limit 等不合资格对象挡住。 | issues-361-453 C5 #382—394 |
| **Receipt / 回执** | 对外动作实际发生或失败的可核对证据，而不是本地按钮状态。 | Blueprint 边界表；C6 #399—413 |
| **Reconciliation / 对账** | 定期重新向外部事实源核对，弥补 webhook 漏送或状态漂移。 | R5 EasyStore/Meta 讨论；C6 commits |
| **Campaign 对象** | 独立承载预算、内容、受众、UTM、执行与归因的业务对象，不把 Campaign 升格成 Project。 | Founder「要 scale 去 Salesforce 那种,干净最重要」；Blueprint §六 |
| **Lifecycle** | 联系人从 New 到 Active/Dormant 等状态变化，以及对应自动化。 | issues-271-360 #296；C7 #414—422 |
| **Workflow** | 用规则把触发、条件和动作组合成可重复执行的顾客旅程。 | C7 #414—422 |
| **请评与奖励分线** | 请客户评价和给奖励各自都能做，但永远不让奖励成为评价条件。 | Blueprint 第 8 条；PR #212 |
| **口碑经济** | 请评、推荐、转介绍和奖励的增长区，但奖励价值来自商家，不经 FIKIRTIVE 资金。 | Route-B B8 reputation design；PR #212 边界 |
| **归因** | 把内容、链接、券或渠道与真实经营结果建立可核对关联；没有对照就不声称增量。 | R5 two-brain memo；Blueprint「读取并验证」层 |

## E. 设计与质量语言

| 词 | 一句话人话解释 | 起源 / 状态 / 来源 |
|---|---|---|
| **Grok-bright / `.gb`** | 从 Grok Canvas 提炼的明亮设计系统，后来取代 Vapor/`.fk` 分叉。 | issues-1-90 #69—80；git-spine 2026-06-29—07-02 |
| **Vapor** | 早期深色设计语言，后来因 Founder 选择 light direction 而退役。 | git-spine；issues-1-90 #78 |
| **Grok 的骨 + Headspace 的心** | 设计基础的内部总结：Grok 的工作台结构，加 Headspace 的友好感。 | transcript-wt-small-batch 关键事件；assistant-origin 设计总结，非 Founder verbatim |
| **Color is earned** | 颜色只在有意义的状态/成功时出现，不用廉价 gradient 装饰。 | transcript-main-940bfbd9 design recap；属设计系统原则 |
| **AI slop** | 看起来像模板 AI 自动拼出的俗套 UI，而非有判断、克制、专业的信息设计。 | transcript-wt-orchestration-07ae75，Founder UIUX gate |
| **minimal gamification** | 只用里程碑、目标进度、周报语气、开店完成度，不用 streak 绑架专业用户。 | Blueprint 第 11 条；GM-02—05 / GM-01 裁决 |
| **目的走查 / scenario-based QA** | 按“用户来完成什么目标”走完整旅程，不按页面逐张点完就算通过。 | transcript-main-7fcd6fd4，2026-07-09 15:16—15:23 |
| **三层 QA bar** | 不只问通不通，还问合不合理/实不实用、最后有没有真实效果。 | transcript-wt-quizzical-jepsen 2026-07-09；这里是 QA 三层，不应无证据称「三轴报告」 |
| **Fable 级质量** | 历史上用当时最强 orchestrator 的作品作为连贯性与判断标准。 | Founder「一定要找着fable 5的质量去做。不要掉质量」；transcript-main-940bfbd9 |
| **先图纸后重建** | 复杂产品先定真实 composition/flow，再施工，避免套壳后自称完成。 | transcript-main-rest 2026-07-08 |
| **不监守自盗** | 作者/执行者不能既造东西又单独宣布它达到质量标准。 | Founder 2026-07-07/08；transcript-main-rest |

## F. 治理与交付语言

| 词 | 一句话人话解释 | 起源 / 状态 / 来源 |
|---|---|---|
| **Founder Resolution** | 在 GitHub 永久保存 Founder 原话、批准时间、范围和 supersedes 的产品判决。 | issue #335 |
| **Blueprint / 宪法** | 只保存“这座城是什么、往哪长、什么永远不变”的最高产品法。 | `docs/BLUEPRINT.md` 文件头 |
| **Project law / 法律** | 把 PR、merge、money、tenant、production 等行为边界落实为所有 session 都要遵守的规则。 | Blueprint 文件金字塔；现行 `AGENTS.md` |
| **Founder-only** | 无论 session 多能干，仍必须由 Founder 决定/执行的高后果类别。 | 现行项目法；commit `1fae4dbc` 首见 tag |
| **Standing Merge Delegation** | Route-B 特定时期的中途免逐项审批合同，不是永久 merge 权。 | issue/PR #254；已到期语义见本档 11.4 |
| **合并留 Founder** | PR 标记提醒最终 merge 必须留给 Founder 执行。 | git-spine，2026-07-22 起，commits `c919f324` 等 |
| **executor evidence** | 每次 merge 都留下谁实际执行、依据什么授权、何时执行的证据。 | PR #406；现行项目法 |
| **四权闭环** | 高后果冻结件以双顾问/异族复审/机器闸/非作者执行等多重独立权力闭合，不让单一 actor 自证。 | Route-B #254；transcript-wt-orch-skill-setup |
| **Cross-family review** | 用不同 frontier model family 做独立挑战，降低同类模型共享盲点。 | 现行 overlay；issues-361-453 |
| **Claim / task ownership fence** | mutation 前声明当前 task 的 worktree 与 write-set，防止两个 session 同时改同一区。 | 现行项目法；task-ownership runbook |
| **债务棘轮** | 已知 parity/接线债只能减少；若增加必须明示批准，不能偷偷倒退。 | issues-91-180 #180；Route-B git history |
| **M0 / M1 / M2 / M3** | 一项高后果能力依次过物理契约、schema、engine、UI，每站单独授权。 | issues-361-453 C1—C7 历史 |
| **【已验】/【在途】/【待决】** | 分别表示有证据完成、正在进行、需要裁决，防止把 pending 写成 done。 | FIKIRTIVE overlay；issues-271-360 |
| **Unknown** | 外部状态没现场查询就必须这样写，不能靠旧截图或 handoff 猜。 | 现行项目法/overlay |
| **雾量分流** | **待核：#298 只记录这个方法名，没有在 18 份 digest 或 live Blueprint 里给出可引用定义。** | issues-271-360 #298；不可自行扩写成算法 |
| **Wayfinder** | 用来找当前最重要路线/决策点的工作方法，不是产品模块。 | transcript-wt-orch-skill-setup；其具体规范不在指定 digests 中完整展开 |
| **Grill / 拍板会** | 用连续追问与反例逼 Founder 把模糊偏好变成可执行判决。 | GRILL-VERDICTS 由 docs-doctrine 索引；2026-07-03/07/14 sessions |
| **借鉴先行律** | 不熟的问题先查龙头与官方事实，再提 FIKIRTIVE 方案。 | PR #213；Founder 原话见 Part 1 §5.5 |

## G. 华语 conventions 与当前冲突

| 约定 | 当前解释 | 来源 / 状态 |
|---|---|---|
| **Spec / skill 文档用华语** | 让 Nicks 能读懂产品与施工意图，技术标识可保留 English。 | Blueprint v2.13 说明其降级为项目法；现行项目法 |
| **UI copy 用 English sentence case** | 用户界面英文采用正常句式大小写，不用每个词都 Title Case。 | Blueprint v2.13；现行项目法 |
| **Generation prompt 语言** | 应由每个 engine 的 prompt authority 依据实测最佳语言决定；Seedance 2.0 中文更好是触发案例。 | PR #444；Blueprint 第 9 条墓碑 |
| **当前文档冲突【待对齐】** | live Blueprint v2.13 已说 prompt 语言随 engine 实测，但现行 `AGENTS.md` 仍写 “generation prompts use English”；按权威层级应以 Blueprint 为上位约束，项目法需要经批准流程对齐。 | `docs/BLUEPRINT.md` 第 9 条/§七；当前 `AGENTS.md` 项目约定；不得静默改任一边 |

---

## 最后给未来协作者的“一句话总纲”

FIKIRTIVE 不是「一个会生成内容的 AI」，而是一座世界级、全球骨架、本地落地的营销与营收增长城市：每栋楼本身都是真正完整的专业工具，人能 100% 操作；Otto 是住在城里的平台操作员，靠同一动作层与 skills 代用户 100% 操作；钱路、商家数据、诚实回执与 Founder 治理是地下不可绕的管网；第一期只有在品类一流内容、真正发布、完整 Customer Engagement CRM 三支柱同时真实可用后才算完成。（来源：Founder 2026-07-07 定位原话；Blueprint v2.5、v2.11、v2.12；PR #187/#212/#337）
