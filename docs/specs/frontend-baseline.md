# 前端基线规格书（S1）

> 状态: 已冻结 · v1
> 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1128 Founder 评论「S1 批准 frontend-baseline.md」(2026-09-02)
> 规格前缀: FRONT（验收编号 = FRONT-A1、A2…，全仓不得与其他规格撞前缀）

<!--
本规格的对象是 PR #1117（分支 codex/uiux-frontend，head c8ae482c）交付的前端基线。
Founder 2026-09-02 裁决（本对话原话要旨）：「做 UIUX 时完全按我对 beta 的构想设计，
所以要让后端服务这个最新的前端版本」；Library、Brand、@ 引用选择器、登录旅程全部接真实后端，
不藏、不用 fixture 冒充；过闸方式＝写一页规格、Founder 签字。
同日两问拍板：Brand 深度＝存真记录＋人工维护＋Otto 读得到；登录测试环境＝本地＋一把 Resend 测试 key。
设计层的权威仍是分支上 apps/web/design-system/ 的已批准 pattern 与 acceptance 记录；本规格不重开设计，
只定「后端服务前端」的验收口径。取证：本规格引用的行号均对分支 head c8ae482c。
-->

## 0. 一句话

把 Founder 按 beta 构想设计的前端（PR #1117）合进主干，并让后端真实服务它：商家在新前端每个入口看到的都是自己店的真数据、真权限、真扣费；这套界面就是 beta 出售的界面。

## 1. 九问（S1 grill 的答案；Founder 2026-09-02 拍板）

1. **商家做什么动作、看到什么结果？** 登录 → Home 看到自己店的真实状态（连接五态之一）→ Create 画布与 Otto 对话（现有真能力，新壳）→ Library 找到生成结果与上传、收藏、建 collection、送进画布 → Brand 五个分区写品牌事实，Otto 对话读得到 → Settings / Billing 改名、连接、看余额充值（现有真能力，新壳）→ 在 Otto 输入框打 `@` 从真实对象里挑参考。每一步的空、加载、错误、成功都来自服务器；没有真实能力的按钮不出现。
2. **入口在哪里？（列全，含深链）** 正式路由：`/`、`/analysis`、`/create`、`/create/canvas`、`/library`、`/library/editor`、`/brand`、`/profile`、`/settings`、`/settings/connections`、`/billing`、`/login`（含 `?from=` 安全回跳）、`/signup`、`/verify-email`、`/forgot-password`、`/reset-password`。评审夹具路由 `/product-patterns/*`、`/design-system/*` 不是商家入口，生产构建不得可达。钱引擎新增的 `/admin/reconcile` 在分支上不存在（分支基于 a32790b8），合并时必须保留。Campaign / Schedule / CRM 路由维持 #850 裁决（beta 期藏门），不因本规格回到范围。
3. **四态：空、加载、错误、成功各长什么样？** 各面 essential states 已在设计文档定义并获 Founder 验收（Home 五态 read model：`information-architecture/frontend-convergence-phase-2-home-spec.md`；Library 六态：`patterns/library/backend-handoff-contract.md`；引用选择器六态：`information-architecture/frontend-convergence-phase-5-reference-picker-spec.md`；Auth 中性错误：`patterns/auth/access-journey-spec.md`）。本规格只加一条硬规则：四态全部由服务器真相驱动——不用假延时、静态 credits、浏览器临时状态或成功 toast 冒充持久化、权限、扣费与完成（`governance/frontend-integration-handoff.md:39`）。
4. **数据从哪来、写到哪去？**
   - **Library**：读 `Generation`（`favorite` 列已有）、`Asset`（上传）、`Entity`（产品等四类）；现有 `getGenerationHistory` / `finalizeCandidateUploads` / `setFavorite` / `createCanvasNode` 沿用。**新建** `Collection` 与 `CollectionItem` 两表（带 `orgId`、唯一约束、迁移）。Elements 用现有 `Entity` 四类；Clothes 与 Official avatar 两类是 Creation 引擎演员库的产物，本规格不建（见「不做」）。
   - **Brand**：五分区（Brand voice / Audiences / Knowledge base / Style guide / Visual guidelines，`patterns/brand/README.md` §5）落到现有 `BrandRecord` / `Memory` 表与 `brand-record-actions.ts`（save / delete / restore）、`memory-actions.ts`（add / update / delete）；每条记录带「谁改、何时改」（施工时核对列，缺则迁移加列）；Otto 经现有 `getBrandContextText` 读取，施工时核对五分区都进这段文本。
   - **Home**：连接状态五态 read model 已接真（`MarketingHealthReadModel`）；**新建** workspace 级 Home 布局持久化（org 级一行，迁移）与 `Manage home` capability 检查；多来源 aggregate 带 freshness 由真实数据函数提供（可复用 #1087 / #1088 的函数族方案）。Otto 页面上下文读取器归 Otto 引擎。
   - **@ 引用选择器**：**新建**统一 reference search（服务端动作：租户内、分页、类型化 ID + 来源），覆盖 `Generation` / `Asset` / `Entity`；发送的消息保存真实引用 ID（施工时核对 `ChatMessage` 的引用字段，缺则加列）。Official avatar 类别随 Creation 引擎点亮。
   - **Auth**：Better Auth 现有能力（邮箱密码、邮件验证码、Google 条件登录、注册、验证、忘记/重置）；本地环境接一把 Resend 测试 key 跑真实邮件。
   - **分支自带的四处 server 改动**（`governance/frontend-baseline-handoff.md:46-55`：会话分页读取、软删除/恢复、Library 去重、Otto 导航指令）逐项对照 main 复审并补行为测试；分支未新增 schema/migration。
5. **碰不碰钱路？** 不新增计费点、不改价格。风险是合并回退：9 处冲突全在钱引擎两天前改过的文件（账单页、素材面板、Otto 聊天流、模板弹层、加素材弹层、剪辑台）。规则：钱的行为以 main 为准，页面长相以 #1117 为准；钱引擎规格验收表 14 条在新前端上重跑（A1）。幂等键不适用（无新扣费）。
6. **权限与租户边界是什么？** 一切读写走 `requireOwner()` 服务端 principal；客户端不提交 `ownerId` / `orgId`（`patterns/library/backend-handoff-contract.md:36-40`）。新表带 `orgId` 约束与双租户测试；collection、reference search、Home 布局、Brand 记录跨租户不可见；`Manage home` 用具体 capability 判定，不看角色名。
7. **参考对照：抄哪家？** 设计文档已引用并经 Founder 逐面视觉验收：Brand 走 Jasper IQ 式五分区（`patterns/brand/README.md:3`「Founder approved and frozen 2026-08-30」）；Auth（`patterns/auth/access-journey-spec.md:102`）；引用选择器（phase-5 spec:3，2026-09-02「ok 这个版本可以很棒」）；Home / Create / Settings 的 acceptance 记录各有 Founder 句。本规格不重开设计。
8. **胃口：轻／中／重挡，为什么？** 重挡：三张新表迁移、登录租户旅程、837 文件合并。分段施工（S2 定切法与写集互斥表）：先纯合并过全套测试与 Founder 视觉验收，再接 Library / Brand / @ / Home。
9. **Otto 怎么协助这个功能？** Otto 面板是新壳的一部分（现有能力）；Brand 记录进 Otto 上下文（A9）；`@` 引用进 Otto 对话（A10）；Otto 知道商家正在看哪一页（page-context reader）归 Otto 引擎，不在本规格。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| FRONT-A1 | （工程演示）新前端合入主干后，重跑钱引擎规格验收表全部 14 条 | 全部通过；`/admin/reconcile`、账单页「Credits don't expire」、上传入口价目小字、聊天搜索成本提示等钱引擎交付面在新壳上仍在 |
| FRONT-A2 | 商家在本地测试环境用邮箱注册、收验证码、登录；再走一次忘记密码 | 收到真实验证码邮件并完成验证；从 `/login?from=/create` 登录后回到 `/create`；重置邮件可用、新密码能登录；错误提示不泄露该邮箱是否存在 |
| FRONT-A3 | 两个租户各自登录看 Home | 各自看到自己店的真实连接状态（五态之一）与「Continue creating」真实画布；对方的数据永不出现 |
| FRONT-A4 | 商家调整 Home 布局后刷新、换浏览器再登录 | 布局仍在（服务器持久化，不是浏览器存储）；没有 `Manage home` capability 的成员看不到该入口 |
| FRONT-A5 | 商家在 Library 看生成历史与上传，按提示词搜索、按收藏筛选、点收藏 | 列表与筛选结果来自服务器；收藏后刷新仍收藏 |
| FRONT-A6 | 商家新建 collection，加入一个生成结果与一个上传，移除一项，删除 collection | 每步刷新后仍成立；另一租户看不到该 collection；删除后其成员对象仍在 Library |
| FRONT-A7 | 商家在 Library 对一个生成结果点「Use in canvas」 | 当前项目画布出现该节点，节点归属当前项目与租户 |
| FRONT-A8 | 商家在 Brand 五个分区各写一条记录，编辑、删除、恢复 | 刷新仍在；每条显示谁改的、何时改的；恢复后内容完整 |
| FRONT-A9 | 商家写完一条 Brand 记录后，在画布问 Otto 一个与之相关的问题 | Otto 的回答用到该记录内容；（工程侧）该轮上下文可查到该记录 |
| FRONT-A10 | 商家在 Otto 输入框打 `@`，选一个最近对象或按类型搜到的对象后发送 | 列表来自服务器（最近用过 + 生成结果 / 上传 / 产品分类搜索）；消息记录保存该对象的真实 ID，可回链；Official avatar 类别在演员库交付前不出现假条目 |
| FRONT-A11 | 商家在新壳的 Settings 改个人显示名与工作区名，在 Billing 看余额并进充值 | 改名刷新仍在；余额、冻结额、充值包与结账走现有真能力；plan / payment method / invoice 这类无契约的控件不出现 |
| FRONT-A12 | （工程演示）用生产构建访问 `/product-patterns/*` 与 `/design-system/*` | 不可达（404 或仅 dev）；商家面任何页面不出现夹具数据；任何写入失败都有错误反馈，不出现「假成功」 |
| FRONT-A13 | （工程演示）跑分支自带四处 server 改动的行为测试（会话分页、软删除恢复、Library 去重、Otto 导航指令） | 在非生产数据库上权限、恢复、分页各自通过；与 main 对照无回退 |
| FRONT-A14 | Founder 在登录态走 Home → Create / Canvas → Library → Brand → Settings → Auth 六面 | 视觉与交互与已批准的设计文档一致；差异逐条登记 §5，不当场改方向 |

## 3. 不做（非目标；写明为什么和触发条件，防「遗漏」误会）

- **不做 Otto IQ 自动摄取、审核状态、版本对比**：Founder 2026-09-02 裁决 Brand 深度＝存真记录＋人工维护＋Otto 读得到；自动化三件归 Otto 引擎。触发条件：Otto 引擎 S2 纳入。
- **不建 Official avatar 与 Clothes 目录**：它们是 Creation 引擎演员库（五人组＋九套造型 preset）的产物，本规格建了就是第二套来源。触发条件：Creation 引擎交付后在 `@` 与 Library 点亮，不改本规格验收。
- **不做 Otto 页面上下文读取器**（Home 的 Otto context chip）：需要 Otto loop 消费页面上下文，归 Otto 引擎；在此之前 chip 不显示「已附上」的假状态。触发条件：Otto 引擎施工。
- **不做 subscription plan / payment method / invoice**：无后端契约，按设计文档不显示。触发条件：钱引擎 §5 登记后另立规格。
- **不重开设计**：已批准 pattern 不改；任何 UX 变化先让 Founder 看过，登记 §5。
- **不让 Campaign / Schedule / CRM 回到 beta 范围**：维持 #850 裁决。
- **不动价格与计费**：钱引擎已归档。触发条件：钱引擎 §5。
- **不做第二套组件基座**：Base UI 切换随本规格上主干；base-ui-switch.md 碑文里「商家可见视觉零变化」口径由 Founder 2026-09-02 裁决取代为「按 beta 构想设计、逐面验收」（A14）。
- **不做基础设施变更**（Vercel 搬迁等）：维持 2026-08-29「维持丙」裁决。

## 4. 异议栏（AI 必填）

- 最大风险：**合并把钱引擎刚交付的行为悄悄回退**。这是 837 文件、+46,740 / −16,167 的合并，9 处冲突全在钱引擎 48 小时内改过的文件。对策：A1 把「钱引擎 14 条重跑」列为第一条验收；施工先纯合并（不加功能）过全套测试与 Founder 视觉验收，再接功能。第二风险：本规格的接线部分像三个小引擎（collection、reference search、Home 持久化），估算两周级，若与 Otto / Creation 施工并行，共用文件冲突会重演——S2 必须画写集互斥表，谁后合并谁解冲突。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-09-03 | Connections 页的 **WhatsApp 行随新壳消失**。旧壳 Messaging 分区里有一行 WhatsApp，写着 "Not available yet"、零按钮（`MessagingRow`，PR #1139 前的 `components/otto/OttoConnections.tsx`）；新壳按已批准的 Settings pattern 重画成「先管已连服务，Add connection 才进 discovery」，整个 Messaging 分区连同那一行退场。产品事实没变（今天仍然没有任何一条连接消息渠道的路），变的是商家还看不看得到「WhatsApp 暂时连不上」这句话。待 Founder FRONT-A14 过目：要不要在 Add connection 弹层里把它作为一条 Unavailable 服务列回来。 |  |
| 2026-09-03 | **前门不再承诺「做东西与发布都要你先点头」**。换壳前登录页写着 "nothing gets made or published until you approve"，围栏 `public-copy-honesty-791.test.ts` 正向钉着它；新的登录/注册页只剩身份表单，全仓这句承诺只剩审批卡自己（`components/otto/OttoApprovalCard.tsx`）与 `packages/core/src/schedule-draft.ts`。反向禁令（不许说成「凡花钱都先经你点头」）本 PR 已补回并覆盖登录/注册两面；**正向那一句要不要回到前门是产品决定**，等 Founder 拍板。 |  |
| 2026-09-03 | **Otto 仍然告诉商家 `/create#templates` 有一个 Templates 区段**（`packages/otto/src/skills/recommend-templates.ts:67` 的 `TEMPLATES_SELF_SERVE`）。新壳的 `/create` 只挂 Otto 入口与画布历史，那个区段已经不渲染 —— 这句话今天是假的。本 PR 只把重定向表里的死锚点撤了（零可见变化），改 Otto 的说法是一次商家可见的文案改动，留给 Founder 定：改成「让 Otto 直接帮你做」，还是把 Templates 区段接回 `/create`。 | 2026-09-03 Founder 裁决（裁决九）：**删掉那句话**——它是假话；Templates 区段不接回 `/create`，Otto 改说「让 Otto 直接帮你做」。**落地**：PR #1148 → main `93b72293` |
| 2026-09-03 | **Founder 令：生产界面严格按 UIUX 设计（design-system/patterns 各面 Reference 组件与夹具）走**；非逼不得已（例如设计里没有、必须新增的东西）不得偏离；任何新增或改动都须遵守前端规则（PR #1117 交接的 SSOT 与接线规范）。触发＝2026-09-03 Founder 在主干 d24079b5 走 `/create` 与 `/create/canvas`，发现生产路由仍渲染旧组件（`ImmersiveCanvasEntry` / Ask Otto 侧栏），与设计夹具（`CanvasReference` / `CreateWorkspaceReference`）不一致。处置＝先做逐面对照审计（设计夹具 vs 生产路由，并排截图＋差异分级＋工程量），再按面接线；Canvas/Create 接线不在 §7.1 现有八段内，作为新段「⑨ Canvas/Create 按设计接线」待审计后估算与 Founder 批准；接线顺序 Canvas 优先。 | 2026-09-03：审计已结案（见下一行），Founder 同日出九项裁决，§7 据此修订（新增第⑨段与各段施工细则） |
| 2026-09-03 | **逐面对照审计结案**（设计夹具 `apps/web/design-system/patterns/*` 的 Reference 组件对生产路由，逐面并排走查）。结论分三级：①**外壳一模一样**——应用外壳（导轨、顶栏、Otto 面板骨架）设计与生产一致；②**只差一处**——登录页品牌标破图（候选根因：`apps/web/next.config.ts` 没开 `images.dangerouslyAllowSVG`，而 `FikirtiveMark` 用 `next/image` 取 `/brand/f-app-icon-coral.svg`；施工时坐实，不当结论用）；③**结构不同**——Create 起步页与 Settings/Billing（页面在，但版面与组件不是设计那套）；④**没接线**——Home、Canvas、Library、Brand、@ 引用选择器（设计里的版面与控件在生产上不存在，或接的是旧组件） | 2026-09-03（审计结论采信，据此出九项裁决） |
| 2026-09-03 | **裁决一 · 顺序**：「对齐轮」（不依赖新后端：画布对齐、Create/设置换皮、素材库接现有资产、@ 小片、登录破图、面包屑）与「四大块」（首页仪表盘、素材库全套含收藏与合集、品牌五节＋草稿流、@ 引用统一）**并行**开工，不排队 | 2026-09-03 |
| 2026-09-03 | **裁决二 · 账单页**：按设计的排版与组件重画，但**保留主干已交付的三条花钱披露**（花费上限、自动理解、网页搜索——钱引擎验收 A5／A9／A10 的商家可见面）；设计里的「Plan & payment」（套餐、付款方式、发票）在后端有对应对象之前**不显示、也不放占位** | 2026-09-03 |
| 2026-09-03 | **裁决三 · Brand 分区**：按设计五节（Brand voice／Audiences／Knowledge base／Style guide／Visual guidelines）；主干旧壳的「你的产品」「你的优惠」两节**并入 Knowledge base**（迁移映射，数据不丢）；Otto 读取口径不变（仍经 `getBrandContextText`，五节全进） | 2026-09-03 |
| 2026-09-03 | **裁决四 · Brand 保存安全模型**：按设计的五步链「加来源 → 抽取 → 生成草稿 → 预览效果 → 确认保存」，商家确认之前不落正式记录；预览要调模型，那笔小额成本按钱引擎自动理解的计费口径（钱引擎验收 A9：披露先于扣费、按动作时刻价目、我方故障重试不重复计费）在预览前披露 | 2026-09-03 |
| 2026-09-03 | **裁决五 · Create 起步页**：去掉主干自加的可见标题行「Create with Otto」（含 Otto 头像与副标题）与「Nothing paid starts before you confirm the exact credits in Canvas.」一句，完全按设计（h1 `Create` → composer → Canvas history）。证据：`apps/web/components/canvas/NorthstarHome.tsx:36-53` 对 `apps/web/design-system/patterns/canvas/CreateWorkspaceReference.tsx:44-63`（设计里 "Create with Otto" 只是 `aria-label`，屏幕上没有这一行） | 2026-09-03 |
| 2026-09-03 | **裁决六 · 画布两个控件不显示**：设计夹具里的 Frame select（右侧工具条第二枚）与 撤销／重做（右下角）在生产上没有对应功能，本轮**不显示**——宁可少一个控件，也不做点了没反应的假按钮。证据：夹具 `CanvasReference.tsx:421-422` 两处都是 `toast.info` 占位 | 2026-09-03 |
| 2026-09-03 | **裁决七 · 剪辑拼接不属阶段一**：阶段一只要「Edit this clip」改片入口可用；多片剪辑与拼接留到后续，不进本轮范围 | 2026-09-03 |
| 2026-09-03 | **裁决八 · 上传照片 Regenerate**：维持拒收，但**先把拒绝提示改成人话**（如 "Uploads can't be regenerated yet. Try Animate or Edit instead."）；图生图（i2i）能力归 Creation 引擎增强层，排进 `creation-engine.md` §8.2 批 II，请求形状接上后再开放。同条已回写 creation-engine.md §5 的 2026-09-03 行 | 2026-09-03 |
| 2026-09-03 | **裁决九 · 通用原则**：生产界面严格按设计走；设计里没有、而生产必需的东西（空态、错误态、钱披露）按一条规矩处理——**无契约的控件不出现，有契约的内容按设计的样式呈现**。另：Otto 话术里「Create 页有 Templates 区段」这句删除（见本表同日 Templates 行） | 2026-09-03 |
| 2026-09-03 | **裁决十 · 收藏存法**（回应 §7.3② 的报告项）：**新建一张统一的收藏表**——不分素材类型，记「谁收藏了哪个素材」，带租户约束；收藏页一次查询、按时间排。备选「给 `Asset` 补一列、两类各存各的」**否决**（那样 Favorites 视图要两次查询＋应用层合并排序，游标还要各算一套） | 2026-09-03 |
| 2026-09-03 | **裁决十一 · Brand 六→五节映射全表**（回应 §7.3④ 的报告项）：Founder 同意四条建议对应——about→Brand voice、customers→Audiences、look→Visual guidelines、rules→Style guide；产品／优惠→Knowledge base 已由裁决三点名。六节映射至此**全表已裁**，施工照落，不再有待确认项 | 2026-09-03 |
| 2026-09-03 | **⑨ 段下一刀「起步页参考契约」**：PR #1151（Create 起步页对齐，第⑨段）核实——Create 起步页 composer 的「+ Add context」（Upload image / Choose from Library / Add URL）本轮**不显示**，按已冻结的裁决九「无契约的控件不出现」处置。根因：起步页没有把参考带进画布的通道——`createCanvasConversation` 的 handoff 只落 `{prompt, threadId}`（`apps/web/lib/canvas-entry-actions.ts:87`）；夹具 `design-system/patterns/canvas/CreationComposer.tsx` 的上传回调只是 `onReferenceChange(file.name)`（:101 附近），不真上传（PR #1151 报告「设计有、生产暂不显示」表；证据已核）。登记为第⑨段下一刀，施工内容与工程量见 §7.3「⑨ 下一刀」小节 | |
| 2026-09-03 | **Otto 前厅（`OttoFrontDoor`，画布 Otto 覆盖层入口，`apps/web/components/canvas/CanvasOttoOverlay.tsx`）没有上传能力**：PR #1150（Canvas 表面按 pattern 对齐，state OPEN，未合并）只给 `OttoChatStream` 的 composer 加了「Add context」——已核 `gh pr diff 1150 --name-only` 只改了 `apps/web/components/otto/OttoChatStream.tsx`；`apps/web/components/otto/OttoFrontDoor.tsx` 里没有任何上传 / Add context 相关代码（已核，main 现状）。登记为 Otto 引擎面的待接线项，触发＝`otto-engine.md` S2 排进去（本条不改 `otto-engine.md`） | |
| 2026-09-03 | **⑤ 段租户列名措辞订正**：PR #1156（Home 仪表盘，已合入 main `9f966663`）落成 `ownerId` 而非 §7.3⑤ 原文字面写的 `orgId`——运行时租户守卫（`packages/db/src/tenant-guard.ts:71-74`）的 `scopeWhere`/`scopeCreateData` 注入的是字面列名 `ownerId`；`OrgHomeLayout` 模型实际字段是 `ownerId String @unique`（`packages/db/prisma/schema.prisma:1371`，`tenant-guard.ts:54-59` 已把它登记为 `TENANT_MODELS`）。已按此把 §7.3⑤ 与 §7.3② 中描述唯一约束的「orgId」措辞改成「租户列（本仓库为 `ownerId`）上有唯一约束」等对应表述，与本仓库既有约定一致——只有 `CreditAccount`／`CreditLedgerEntry`／`RefundJournal` 三张钱表按 `tenant-guard.ts:62-96` 例外用字面 `orgId`，其余租户表一律 `ownerId` | 2026-09-03：措辞已按此改，本行即落地记录 |
| 2026-09-03 | **评审原型 per-goal 版面 vs 生产 org 级一行**（PR #1156 报告「与评审原型的一处已知分歧」，登记未裁）：评审原型 `FounderHomeReference` 给每个 business goal 各存一份版面顺序；规格 §1 九问 4 与 §7.3⑤ 把落库口径定成「org 级一行」，生产上一个工作区只有一份顺序、三个 goal 共用，goal 仍决定「没保存过时」的推荐模板。按规格施工，差异已由 PR #1156 登记；是否回到 per-goal，等 FRONT-A14 走查时 Founder 定夺 | |
| 2026-09-03 | **画布卡片媒体井比例**：PR #1150（Canvas 表面按 pattern 对齐，state OPEN，未合并）报告「已登记的形状差异」——夹具的卡是「媒体井 + 42px 页脚」的竖长卡；生产沿用每张卡自己**持久化**的尺寸（默认 320×320）；`apps/web/lib/canvas-node-size.ts` 的 `canvasMediaNodeSize` 只在尺寸仍是默认值（`isDefaultCanvasMediaNodeSize`）时才按媒体比例重排，商家一旦拖动过尺寸即持久化、不再跟媒体比例走（已核代码），卡看上去偏方、图会略小。若 Founder 要求媒体井严格等于图片比例，需把页脚高度作为 chrome 纳入 `canvas-node-size.ts` 的尺寸计算。登记待 FRONT-A14 走查定夺 | |
| 2026-09-03 晚 | **裁决十二 · 画布卡下方那条改写输入条退场**：被选中的卡片下方浮出的 `NodeRemakeComposer`（Evolve —— 改写提示词再出一张）**去掉**；改写走卡上操作条的 **Edit with Otto**（把这张卡交给 Otto 接着改），能力不丢。触发＝第⑨段（Canvas 对齐）施工者把它列为「保留待裁」，Founder 当晚裁定去掉。**连带**：那条输入条里的**每卡形状选择器**一并消失（已批准的设计里卡上没有形状选择器）——「Create variations」从此交付**这张卡自己记着的那一格形状**，商家要换形状在创作输入条里选；价钱与「先确认再收钱」的承诺改挂在按钮自己的 tooltip/title 上，一格没缩水。**落地**：PR #1150（`ImageNode.tsx` / `VideoNode.tsx` / `FlowCanvas.tsx` / `globals.css`，`NodeRemakeComposer.tsx` 删除；围栏 `front-a14-canvas-alignment.test.ts`「FRONT-A14: no second input bar under a picked card」） | 2026-09-03 晚 Founder 裁决 |
| 2026-09-03 晚 | **裁决十三 · Otto 输入框下两行计费说明维持常驻**：不改成「按需披露」。口径以钱引擎规格 MONEY-A10（Founder 2026-09-02 裁决）为准，第⑨段派工书里那句「按需披露」作废。**落地**：PR #1150 保持原样并加围栏（`money-a10-search-disclosure.test.ts`） | 2026-09-03 晚 Founder 裁决 |
| 2026-09-04 | **Otto 侧栏默认改为收起**：全局 Otto 面板默认收起；仅当①这一页有活动对话，或②商家上次留着开着时才展开。**取代** `docs/specs/wave2-shell.md` Q3-A「面板首开后记忆」（首开默认开，之后按存档；Founder 2026-08-18 裁决）——该规格已「已交付 · 归档」，原文原样保留、不改，新口径记在本行。触发＝Codex 只读走查 QA-CRE-006：清空存储的全新会话里，存档记着的旧「开」在别的商家面上自动弹开，吃掉了 Create 极简页半屏（`/create` 本身已由 #1165 从面板挂载表移除，但那不解决「面板带着旧状态到处弹开」这条根因）。**实现**：唯一改动是 `panel-state.ts` 的 `defaultOttoPanelState()`——`open` 字段从「按视窗宽度算，≥1024px 开」改成恒为 `false`。「商家上次留着开着」（`parseOttoPanelState` 读到持久化的 `open:true`）与「这一页有活动对话」（深链强开 `?otto=1`，`OttoPanelShell` 的 `forceOpenSignal` 盖过存档）两条覆盖路径是既有机制，原样不动；「这一页有活动对话」这一条以深链信号近似（见下方追认）。**假设**（状态层拿不到更干净的判据）：「活动对话」取的就是既有的深链强开信号——面板体的会话数据（`activeThreadId`/消息）本来就要等面板真的开了才取数（见 `OttoPanelHost.tsx` 顶部「取数按面板开合来」），开之前没有更早、更干净的信号可读；`?otto=1` 已经是这套代码里唯一「这次到访确实带着一个 Otto 会话」的预取信号，不是新引入的会话状态。**Founder 2026-09-04 追认**（判官 #1168 P2-2 指出这是近似不是原意：商家在 Library 有进行中的对话、离开再回来面板不展开；`?otto=1` 不带 thread 也强开）：追认现状为近似口径；真信号「本页有进行中的 Otto 对话即展开」登记待下一轮，不占本轮 4 小时。**落地**：PR #1168（分支 `claude/otto-panel-default-collapsed`，叠在 #1165 之上）；测试以 `FRONT-A14` 命名，覆盖四态（首次访问收起 / 活动对话展开 / 存档开着展开 / 存档关着＋活动对话仍展开）—— `otto-panel-state.test.ts`（纯函数默认值）、`otto-panel.test.ts`（Shell 首帧收起、损坏存档退回收起）、`otto-panel-mount.test.ts`（挂进真壳的四态一组，外加窄屏守卫改钉、r3 竞态因首帧不再默认开而随之消灭）。 | 2026-09-04 Founder 裁决（经 orchestrator 决策提示下达）；落地见本行 PR |
| 2026-09-04 | **第⑨段真机走查落修:画布选中与覆盖层四条**(Codex QA-CRE-002／QA-CRE-008,真 Chrome 走 main `e622bec6` 的生产构建,1440×900;单测当时全绿而浏览器里是坏的)。**找到什么**:①选中一张卡按 Delete／Backspace 屏幕上什么都不发生;②Shift 多选本身是通的(实测 React Flow 记得住两张、描边与真选中一致、「2 selected」条也出来),坏的是键盘对这一组一样使不上劲;③「Fit to screen」把画摆在固定覆盖层底下(实测 Fit 之后一张视频卡 45%、另一张 32%、文字卡 42% 被压住),点视频卡落在 Otto 输入框的披露句上 —— 视频没被选中、上一张图的操作条还留着(走查记的「视频卡选不中」就是这一幕);④一张失败卡 320×320 站在 320×180 的正常卡旁边,把工作区往覆盖层里顶。**改了什么**:①②键盘接到**已有的那两个确认框**上(单张 `pendingDeleteId`、多张批量框),不新开删除路,「还在生成、删了不退款」那句警告一个字都绕不过去;③`fitView` 从对称的标量 `padding: 0.22` 改成**量出来的四边安全区**(`apps/web/lib/canvas-fit-padding.ts`;覆盖层清单含 Otto 当前轮卡／输入框／对话条／画布工具条纵列／模式条／缩放簇,同 `lib/canvas-otto-dock.ts` 那条「量、不写死」的规矩);④停下来的卡收成正常卡外形(`lib/canvas-node-size.ts` 的 `canvasTerminalNodeSize`)。围栏:`front-a15-canvas-selection.test.ts`(真 FlowCanvas)与 e2e 旅程 `17-canvas-selection.spec.ts`(真 `click()`)。**假设两条**:㈠已批准夹具 `CanvasReference.tsx:470` 的删除键是**不问就删**,生产上保留现有确认框 —— 夹具没有钱路,生产有在飞的付费卡;㈡夹具没有给失败卡另一个尺寸,「正常卡外形」按走查那块板上出好的卡取 16:9(高度从既有的 `DEFAULT_CANVAS_MEDIA_NODE_SIDE` 算出,不是另写一个数)。**PR**:#1172 | |
| 2026-09-04 | **文字便签的键盘删除只在光标不在它文本框里时成立(待裁)**。文字卡的输入框铺满整张卡的内里(`TextNode.tsx` 的 `Textarea` 是 `h-full`,外圈只剩 `.cv-node-frame-text` 的 11px／12px 内距),所以点卡的中间＝光标进框,这时按 Backspace 就该是退格,不是删卡 —— 键盘删卡的护栏(不在输入框里才算)照此正确地不动作。今天可走的路有两条:点那圈 11px 的边把卡选中(光标不进框)、或用框选圈住它,再按 Delete;卡上本来也有自己的Delete 按钮。已批准夹具在这一点上和生产一致:`CanvasReference.tsx:470` 的删除键只作用在 artifacts 上,便签(sticky／reference)本来就不吃这个键。**建议**(需 Founder 拍板,因为它改的是已通过表面的编辑模型):照 Figma／Miro／tldraw 的老规矩 —— 单击选中、双击才进文字编辑。本票不动,登记待裁。 | |
| 2026-09-04 | **画布卡的「对话色环」看起来就是选中框(待裁)**。每张卡按它所属对话拿一个颜色,画成一圈 2px 的`boxShadow`(`FlowCanvas.tsx` 的 `boxShadow: 0 0 0 2px convoColor(threadId)`,调色板里 `#e2725b` 这一格是砖红／粉,和 Otto 珊瑚几乎同色)。一块板通常只有一条对话,于是**每张卡都戴着同一圈珊瑚色**,而真正被选中的那张画的是已批准夹具的「墨色细边＋淡墨光晕」(`CanvasReference.tsx`:`border-foreground ring-2 ring-foreground/15`)。两者在屏幕上的强弱正好反过来 —— 这就是 Codex 走查写的「好几张卡同时描着粉边,却没有真的多选」。取证:`scratchpad/qa-canvas/after-13-variations-price-tooltip.png`(四张卡全戴珊瑚环,只有中间那张是选中的)。已批准夹具里没有对话色环这件东西。**三条路请 Founder 择一**:㈠撤掉色环(照夹具);㈡把对话颜色挪到卡上那颗「Image／Video」小标签上,边框只留给选中;㈢保留现状。本票不动 —— 撤或挪都是已通过表面的可见改动。 | |
| 2026-09-04 | **Create 起步页 Canvas history 三小点**（Codex 只读 E2E QA-CRE-006 §4.1，`docs/audits/creation-e2e-2026-09-04.md`，三条原话：① history 是旧到新不是「最近活动优先」；② history 仍出现「New project」，与已批准词汇「Canvas，不叫 Project」冲突；③ 很长的 prompt 直接成为 history title，缺可扫描的名称策略）。**① 最新在前**：`getProjects`（`apps/web/lib/data.ts:58-63`）排序改 `pinnedAt desc nulls last` → `updatedAt desc`（原是 `createdAt asc`）；`Project.updatedAt` 是 Prisma `@updatedAt`，rename／pin-unpin／`editJson` 保存都会碰它，今天近似「最近活动」；**假设待下一轮**：单纯生成／对话（不改名不存 editJson）目前不触达它，`canvas-actions.ts`/`otto-canvas-turn.ts` 等画布写入路径不在本轮写集，touch `updatedAt` 排下一轮。**② 不叫 project**：单一源头新增 `apps/web/lib/canvas-title.ts`——`DEFAULT_CANVAS_NAME="New canvas"`／`LEGACY_DEFAULT_CANVAS_NAMES`（"New project"／"New campaign"／"Untitled Project"／"My First Project"）；`actions.ts` 的 `DEFAULT_PROJECT_NAMES` 改为从此文件组装（`actions.ts:111-118`），`getOrCreateDefaultProject` 的建号默认名改用 `DEFAULT_CANVAS_NAME`（`actions.ts:186`附近）；起步页 `CreateWorkspace.tsx` 用 `formatCanvasTitle`/`canvasDisplayName` 做**显示层**映射（不迁移数据）；`createProject` 自身的空名兜底与「New project」canonicalize 分支本轮**未改**（该路径无生产调用者传字面量，改动会牵动约 10 条既有 mock 测试且不在 Codex 指出的起步页范围内，风险/收益倒挂，登记留后）；存量行的数据库迁移登记为下一轮。**③ 长标题可扫描**：`canvas-title.ts` 的 `truncateCanvasTitle`——首行优先、在 56 字符上限内优先取第一句、否则按词边界截断加省略号、去首尾引号与空白；`CreateWorkspace.tsx` 历史行用 `formatCanvasTitle(project.name)` 显示、`title={canvasDisplayName(project.name)}` 放完整名做 tooltip；根因未动：`canvas-entry-actions.ts:22` 的 `canvasName()`（起步页发消息建 Canvas 时的存库名）与 `otto-canned-starters.ts:112` 的 `newThreadTitle()` 都只做 80 字符裸截断、无词边界，本轮按写集边界只做显示层截断，存库侧的截断策略统一是下一轮候选。**grep 结果**（`apps/web/app`、`apps/web/components` 商家可见文案里的 project/Project）：起步页/Canvas 历史范围内的已处理；范围外仍存在且**本轮未动**——`campaign-confirm-page.tsx`／`campaign-detail-page.tsx`（Campaign 分组「project」，独立域）、`TenantDetail.tsx`（admin 内部页 "Projects" 指标）、`QuickBrief.tsx`／`OttoMemory.tsx`／`BrandRecordRemovalDialog.tsx`（Otto Brief／Memory 文案）、`EditDesk.tsx`（剪辑桌内部变量名）、`otto-nav-model.ts`（导航模型 kind 值）。**测试**：新单测 `canvas-title.test.ts`（16 条，`FRONT-A15` 命名）、新真库测试 `get-projects-recent-first.test.ts`（2 条，`FRONT-A15` 命名，真 Postgres 验证排序）；`default-project-actions.test.ts` 随 ② 同步改了两条既有断言（建号默认名、reuse 查询的 `name: in` 列表）。**验收编号口径**：§2 冻结验收表没有专门对应「history 排序/命名/截断」这条；沿用 §7.1 表内已把「Create 起步页」全段钉在 `FRONT-A15`（工程演示，设计对照）的既有安排，测试名里带 `FRONT-A15`——不完全贴合 FRONT-A15 原文字面（原文是控件对照，不是排序/命名契约），本行即是这处贴合度的登记，供下次 S5 一并裁定要不要另开一条编号。**落地**：本行对应 PR（分支 `claude/create-history-recent-first`）。 | |
| 2026-09-04 | **Codex 只读走查 QA-CRE-FE9-005（P1，画布的 New conversation 造出找不回的对话）**：画布 dock header 上那颗 `New conversation` 按下去会清掉当前 thread 并把它从 URL 上摘掉，而**画布没有 thread list / switcher** —— 旧对话写得进、找不回，只能靠浏览器 Back（证据：`NorthstarCanvasWorkspace.tsx:202-206` 清 active thread／pending first／references 并 replace URL；`OttoChatStream.tsx:1003-1031` 画布里始终渲染这颗键；Codex 截图 `creation-e2e-fe9c70bd/10-new-conversation-no-history.png`，报告 `docs/audits/creation-e2e-fe9c70bd-2026-09-04.md` Stage 7）。本行属类型①中途想法，验收编号沿用现有 FRONT-A 表（FRONT-A15「画布控件与已批准设计一致」，不发明新编号） | **Founder 2026-09-04 07:05 裁决：beta 先收掉画布里的「New conversation」**，一张画布就是它那一条按时间的 Conversation；**多对话切换列表登记下一轮**（Codex 给的另一条出路——补齐 switcher／标题／排序／active state／deep link——不在本轮 4 小时内）。**落地（本 PR）**：只拿掉画布那一支的渲染与它的接线，不加任何开关（M4：用「不渲染」实现，不引入 `BETA_*`）——`OttoChatStream.tsx` 的 `canvasLayout` dock header 里那个动作块删除，`CanvasOttoOverlay.tsx` 与 `NorthstarCanvasWorkspace.tsx` 不再传 `onNewConversation`（不留传进去没人用的死参数）。**侧栏 Otto 面板照旧有这颗键**：那一面有自己的 `OttoThreadList`，旧对话找得回，所以收的是画布、不是把能力一刀切掉；服务端多 thread 能力与既有数据一格未动，已有的多对话仍可经深链打开。行为测试（验收编号逐字）：`apps/web/lib/__tests__/canvas-single-conversation.test.ts`（逐块读真源码：画布那一支没有这颗键／侧栏那一支必须还有／画布两处接线不再传这个 prop——把能力一刀切掉会让第二条当场变红）；真浏览器那一头由既有旅程守着（`e2e/journeys/14-canvas-toolbar-reachable.spec.ts` 直接操作这个 dock header，16／17 走画布）。**假设**：画布的 dock header 此刻只在有 active thread 时才渲染，所以没有现成旅程能种出「画布上没有这颗键」的浏览器断言；本轮用逐块源码判据＋既有旅程保绿代替，若下一轮补 switcher 时会连同种子一起补上 |
| 2026-09-04 | **Creation 冲刺收尾 · 前端基线侧登记两条**：① Otto 侧栏 `?otto=1` 近似读法（#1168）判官 P2-1：r3 `pendingSelectRef` 修法（开→关→再开，深链 select 不许被吞）现无测试守，待补；② 旅程 15 `FRONT-A4 — a customized Home survives a reload and a fresh browser`（`e2e/journeys/15-home-layout-persists.spec.ts:67`）在干净主干 5bdfdec6 本机连跑三次全红（Save 后空态句先出现、`page.reload()` 后消失），CI 上间歇绿——与 Creation 无关，值得单开一票查 Home 定制的跨刷新持久；③ FRONT-A15 住在 `frontend-baseline.md` §7 S2 施工稿（该节标「待 Founder 再次批准」），不在 §2 冻结验收表；#1105／#1168／#1178 都这样挂，待 S5 裁。 | 登记；待排期 |
| 2026-09-04 | **出片弹窗里打的字看不见（矩阵走查 P1-a）**。**现象**：画布底栏 → `Video` → 在提示词框打字，字不可见（DOM 里值确实存在）；矩阵 worker 在本机 3310 生产构建实测 `.mention-input .tiptap` 计算色 `rgb(246,247,249)`、弹窗底 `rgb(255,255,255)`，对比度约 1.05 比 1。**根因**：`MentionInput` 是**一个**组件挂在多个面上，字色却写死成 Vapor 深壳前景 `--fg-1`（`#f6f7f9` 近白，主干 `globals.css:364`；提示语同病，写死 `--fg-3`）。近白只在深色面上对，于是每个浅色面各自把字色补回来一次——画布底栏 `.gb .al-promptbar .tiptap`、素材面板 `.gb .cv-detail .tiptap`。t2v 弹窗把 `<MentionInput>` 裸挂在（Animate 弹窗用的是普通 `Input`，不受影响） `DialogContent` 上（`FlowCanvas.tsx` 的 `canvas-t2v-…`），既不是底栏也不是面板，没有人给它补——白底白字。**修法（单一源头）**：组件按所在面拿语义字色——`.mention-input .tiptap` 改 `var(--foreground)`、提示语改 `var(--muted-foreground)`；两处按面补丁随之删掉，原地留一句注释说明为什么不再抄第二份。深色主题免费跟上（`.dark .gb` 把同一个 token 重指到浅色字）。**未动并登记**：`.al-promptbar .tiptap`（`globals.css:340-356`）是既存死码——它和 `.mention-input .tiptap` 命中同一个元素、特异性相同又排在前面，连 `min-height` 与 `font-size` 早已被后者盖掉；本轮按最小改动不碰。**测试**：`apps/web/lib/__tests__/front-a14-canvas-alignment.test.ts` 新增三条 `FRONT-A14` 命名——① 字色与提示语必须是语义 token；② 按 `.gb` 两个主题的 token 字面量算真实对比度，弹窗面（`--popover`）上打的字与提示语都不低于 4.5 比 1（把 token 改回 `--fg-1` 当场算出 1.07 比 1 变红，与走查实测同一回事）；③ 禁止再出现按面覆盖的 `.tiptap` 字色补丁。**编号口径**：走 §2 冻结表 `FRONT-A14`（六面走查「视觉与交互与已批准的设计文档一致」，画布面）；Creation 引擎规格自己那一族验收编号不在本文件里出现——前缀全仓唯一（M2），本条是前端基线的面级视觉缺陷，不跨规格借编号。**落地**：本行对应 PR（分支 `claude/video-dialog-prompt-color`）。 | |
| 2026-09-04 | **Codex staging 只读审计两条 P2 小活**（`docs/audits/creation-staging-product-avatar-video-2026-09-04.md`）。① Version and evidence boundary：`/api/health` 不报 commit sha，审计结论没法绑定到具体部署——`build:{sha,ref}` 已加进响应，取自平台注入的 env（Railway 优先，Vercel 后备），本机/未注入即 `null`，绝不现取 git；worker 启动横幅同一对 helper 补 `sha=`。② LIB-STG-P2-005：Library 素材按钮的 accessible name 曾是整段生成提示词、有时重复两遍，读屏逐格朗读、语音控制失灵——单一源头 `lib/library-item-a11y.ts`（首句或 60 字符按词截断＋去重＋媒体类型），`CanvasLibraryPicker.tsx` 与主网格 `StuffLibrary.tsx` 共用；整段提示词仍经 `title` 属性保留，视觉 caption 未改。均属轻改（无商家可见价格/权限/数据变化）。**落地**：本行对应 PR（分支 `claude/health-sha-and-a11y-names`）。 | |
| 2026-09-04 | **旅程 15 `FRONT-A4` 的红是旅程自己的等待写错了，不是 Home 定制没落库**（本文件 §5 同日「Creation 冲刺收尾」行第②条登记的那一票，本行是它的落地）。**定性**：③ 测试时序，商家可见行为零变化。**证据**：本机干净主干复现一次红（`fikirtive_home15_test`，端口 3474，CI 同配方生产构建），红时数据库 `OrgHomeLayout` 里那一行**已经写进去了**（`componentIds={}`、`hiddenIds={marketing-health}`），所以写入路径是好的；Playwright trace 里 `/` 上有两个不同的 server action，Save 那一个（`next-action` 尾号 `…53ca5cbe3d`）状态是 **-1 = 被中断**——点 Save 在 9628ms、`page.reload()` 在 9667.8ms，中间只有 39ms，旅程自己把这次保存打断了。**根因**：`MarketingHomeView.tsx` 主区渲染的是 `customizing ? draft : components`，面板还开着时屏幕上是**草稿**；所以「Save 之后空态句可见」在取消勾选那一瞬间就已经为真，`saveHomeLayout` 就算什么都不做它也过——这两条断言既没有验证保存，也没有拦住旅程去刷新。行落库比刷新晚一步，刷新读到的是保存前的版面，旅程把这件事读成了持久化缺陷。**修法**：只改旅程的等待方式，不动产品代码——两处 Save 之后各加一句「等 Customize home 面板消失」（`saveDraft` 是先 `await saveHomeLayout(...)` 再 `setCustomizing(false)`，面板消失＝服务端已经返回 ok＝行已落库；不加 sleep、不加固定超时）。**变异验证**：临时让 `writeHomeLayout` 不写，重建生产构建后旅程照样红，而且红得更早更准（第 78 行，数据库 0 行）——改完的旅程仍然抓得住真的持久化坏掉。**为什么以前 CI 绿本机红**：这是一场竞速，谁快谁赢；CI 跑手空闲时保存赶在刷新前落库，本机四个 agent 共用、负载 10 以上时赶不上。CI 今天红在第 87 行（第二次 Save 之后那次刷新）是同一个根因的第二处，两处一起修。**落地**：本行对应 PR（分支 `claude/home-layout-persist`），写集只有旅程文件与本行 | |
| 2026-09-04 | **画布首屏摆板改读同一份覆盖层安全区（三处同源修补）**——旅程 17 `FRONT-A15` 间歇红的根因。**① 两份留白**：修前 `<ReactFlow fitView fitViewOptions={{ padding: 0.22 }}>` 在挂载时按对称百分比摆一次，「每个项目摆一次」的 effect 再按 #1172 的安全区（`lib/canvas-fit-padding.ts`）摆第二次，谁最后落地取决于时序；修后挂载那一份删除，摆位只剩 `fitPadding()` 一个来源。**② 安全区没算卡自己的操作条**：`canvasFitPadding` 顶边在让开覆盖层之外再空出 `CANVAS_NODE_TOOLBAR_REACH`（卡上操作条 offset 22 + 高 32 = 54px；三张卡的 `NodeToolbar offset` 改为从这一处读，高度来源 `icon-xs`=`size-8`=32px）。**③ 安全区看不见门厅那张 Otto 卡**：画布左上角那张 280px 的 Otto 卡有两副面孔——还没开对话是 `OttoFrontDoor`、开了对话是 `OttoTurnCard`，而覆盖层清单只认后者的 `aria-label="Otto current turn"`，于是**商家还没开口的那一次**左边一寸不让；修后两副面孔各挂同一个记号 `CANVAS_OTTO_CORNER_ATTR`（`data-canvas-otto-corner`，与底部输入框 `CANVAS_OTTO_DOCK_ATTR` 同一条规矩），清单改读记号。**④ 首屏那一次不再做动画**（`fitBoard(0)`；手动「Fit to screen」仍是 220ms）：开画布的第一眼没有「从哪里来」可言，而那 160ms 里板上的卡还在移动，手已经伸出去的那一下会落空——探针实测同一次拖动里卡从 x=316 挪到 x=368，框选一张都没圈到。**复现数据**（本机生产构建 1440×900，e2e 探针）：顶栏 y=0…48、画板 y=48…900、门厅卡 x=16…296 / y=64…172；修前顶边只留 24px，最上排卡摆在 y=72、x=256，卡上操作条落在 y=18…50 全在画板外，`elementFromPoint` 在 Download 键正中取到 `<header class="… h-12 …">`，而在卡外 24px 起手框选取到的是门厅卡的表头；修前 5 次留了记录的预跑全红（3 次第⑤步、2 次第①步）。修后顶边 78px、左边 320px，最上排卡 y=126 / x=316，操作条 y=72…104 全在画板内、命中的是按钮本身；旅程 17 在合过主干的生产构建上连跑 10 次全绿（修 ①②③ 之后仍有 1/5 红在第①步，加 ④ 才收干净）。**商家可见变化**：首屏与「Fit to screen」摆出来的画整体下移 54px、右移到门厅卡之外，画略小；左下右三边的既有让位口径不变。**本轮不做（登记）**：卡被商家自己拖到画板顶上时，它的操作条一样会伸出画板被顶栏盖住——那要操作条自己翻到卡下面，不在本票。**落地**：本行对应 PR（分支 `claude/canvas-first-fit-safe-area`）；围栏 `apps/web/lib/__tests__/front-a15-canvas-selection.test.ts` 新增四条（首屏与手动读同一份留白／挂载处不再自带第二份留白／操作条不伸出画板／两副面孔都挂着记号），变异实证：把 `padding: 0.22` 加回挂载处、或把操作条高度改成 0，对应条即红。 | |
| 2026-09-04 | **Codex 全 beta 审计 P1-012（发布身份）**：staging 没有不可变的发布标识，工程师没法证明一次修复到底在哪次部署上验的（本条来自派工书转述——本 worktree 的 `docs/audits/` 下没找到对应审计文件，取证止于此，不假造路径）。上一条（同日、上一行）的 `/api/health` `build:{sha,ref}` 只报了 web 这一侧；本行**新增只读端点 `/api/build-info`**——`web:{sha,ref,startedAt}`（复用 `lib/health.ts` 的 `buildInfo`，同一对 `commitShaFrom`/`shortSha`，不另起一套）、`worker:[{role,sha,at}]`（每一班还活着的 `WorkerHeartbeat` 各一行，**不带** `configFingerprint`——那一格的比对纪律留在鉴权后的 `lib/deploy-fingerprint.ts` admin 面）、`migrations:{latest,appliedAt}`（`_prisma_migrations` 最新一条成功记录的迁移**id**，只取时间戳前缀，人写的描述后缀不外泄，读不到就 `null`）；匿名可读，但**不是** `/api/health` 那份「只报状态词、不报时间戳」的零数据契约——本端点如实报三个时间戳（`web.startedAt`/`worker[].at`/`migrations.appliedAt`），因为这几个时间戳本身就是「哪次部署」这句话要核对的东西（`lib/auth-wall-ledger.ts` 新增 `api/build-info` 精确豁免，`proxy.ts` 的 matcher 字面量同步再生成）。账号菜单（`design-system/patterns/application-shell/navigation/MerchantAccountMenu.tsx`，`components/navigation` 是它的 symlink 别名）底部加一行紧凑版本号 `Build <8 位 sha>`（本机无 sha 显示 `Build local`），点击复制 `/api/build-info` 的完整链接，该项 `aria-label` 单独描述动作（复制链接），可见文案不变；sha 由服务端 `buildInfo(process.env)` 经 `getMyAccount()` 既有的顺风车下传，菜单自己不发请求，不为一个 env 读取白付两次 DB 查询；纯读、不改导航结构，属 FRONT-A14「六面走查」覆盖的外壳一部分。判官四轮已裁：P1-1（时间戳/契约措辞/迁移 id 脱敏）、P2-2（aria-label）、P2-3（去客户端 fetch）均已落修，此处登记为最终状态；PR 描述已去掉「轻改」勾选句（账号菜单多了一行可见文案+点击 toast，非零商家可见行为变化）。**落地**：本行对应 PR（分支 `claude/build-info-release-identity`）。 | |
| 2026-09-04 | **Library 换壳三条（PR #1152）**：① **失败生成任务卡随旧 OttoStuff 退场**——已批准 pattern 的 LibraryAsset 无 status 字段、Generation history 只收成品；失败与「你没被扣费」仍在出事的画布卡上持久可见（`packages/core/src/canvas-card-status.ts`），但跨画布的失败总表没有了，待 Founder 裁：保持现状 vs 给 Library 补「Needs attention」入口。② **Elements 新增设计未画的 Brand marks 栏**（BRANDMARK 可创建，不画就永远看不见也删不掉），待 FRONT-A14 裁长期归属。③ **官方演员「不可删」是本仓自认假设**（Founder 2026-08-30 只写不能修改 identity），`lib/actions.ts:687-693` fail closed，待追认。④ 旧 OttoStuff 面的八个围栏测试改为只护组件，tidy 下一循环。另：搜索同时匹配上传文件名（上传行没有提示词可搜），占位符随之改成如实的「Search prompts or file names」（Founder 2026-09-05 裁，轻改）。 |  |
| 2026-09-04 | **侧栏 Otto 串到无关画布对话（Codex 全 beta 审计 P1-010）**。**现象**：商家在 `/billing` 展开侧栏 Otto，面板自动摊开的是一条画布对话「Professional Male Model Image」——他不是在这里开的、与这一页无关，而且面板上一个字都没写这段对话属于别处。**根因**：面板「打开时接着聊哪一条」的判据是「这个 project 里最近更新的那一条」（`apps/web/lib/otto-panel-seed.ts` 的 `openThreadId`），而那个 project 来自 `getOrCreateDefaultProject()` —— 与商家从哪一页展开面板毫无关系；画布对话与侧栏对话从来没有被分开登记过，面板没有依据只续自己那一批。**规则（本轮落地）**：① 开始写 `ChatThread.surface`（#879 step 1 预埋的列，nullable，此前零写入方，**不加迁移**）——画布那一侧开的登记 `canvas`（Create 画布入口、剪辑入口、`/otto` 前门），侧栏面板自己开的登记 `panel`；来源一律过服务端一道闸（`coerceThreadSurface`），认不出来的落回 `canvas`，客户端自报不原样落库。② 面板无深链打开时**只在 `surface='panel'` 的对话里**选最近一条；一条都没有就不预选，面板画新对话态，商家发出第一句时才建线程并登记 `panel`。深链 `?thread=` 照旧（商家自己点名的到达，画布对话经它打开不受影响）；画布对话只在从会话列表显式点选时打开。③ 面板头部接回一行**范围**标签：`Workspace · <页面名>` / `Canvas · <画布名>`。措辞守判官 r1 [P2] 的裁定——只说这段对话归谁，不说 Otto 看得见这一页（服务端至今没有任何读者读 `surface`/`subjectRef`），所以不写「On this page:」、不摆「停止使用本页作为上下文」那颗叉、不设 `contextAttached`；会话列表里画布那几条带 `Canvas` 来源标签。④ **老线程诚实登记**：本轮之前的每一行 `surface` 都是 `null`，无法回溯它当初从哪个门开的，一律按画布读——面板不再自动续它们（代价：商家要去列表里点一下；换来的是面板不再摊开别处的上下文）。**测试**（逐字含 `FRONT-A14`）：`otto-panel-seed.test.ts`（选择规则四条＋既有深链契约全绿）、`otto-panel-scope.test.ts`（挂载：/billing 打开不载画布对话、范围标签两态、反向钉「不许出现 On this page」、列表来源标签）、`otto-thread-surface.test.ts`（真库 `fikirtive_panelctx_test`：`surface` 真写真读、老行为 `null`、两租户不互见、服务端校验闸）。变异：把选线程规则改回「project 最近一条」⇒ `otto-panel-seed.test.ts` 6 条红；把 `data.ts` 的 `surface: true` 拿掉 ⇒ 真库那条红。**未做**：`ChatMessage.surface` 的语义（#879 step 2 的上下文装配）不在本轮；没有 workspace 级线程这个新概念，线程仍按 project 分组。**判官复审落修（同一轮）**：⑤ **点开即被改标**（P1-1）：`getCoworkThreadPage`（点开一条对话走的读路）没取 `surface`，取回来顶掉列表里正确的行 ⇒ 商家点一下自己的工作区对话就被标成 Canvas。补 select，并把 `dto.ts` 的 `ChatThreadDTOInput.surface` 从可选改必填——漏 select 从此是 tsc 错误（改必填当场点名三条读路），不是线上现象。⑥ **老行不冒充画布**（P2-1）：新增 `isCanvasThread`，界面上说出口的话（列表徽章、头部）只标确知是画布的；`null` 老行来路无法回溯，什么都不标；自动续接仍用 `isPanelThread`，行为零变化。⑦ **turn 接口不再兼任线程来源**（P2-2）：`coworkTurnRequest.surface` 是 #879 step 1 的**页面位置**字段（自测值 `campaign`），与线程来源只是重名；两扇 turn 门改为写死 `canvas`（面板永远先经 `createEmptyCoworkThread` 建线程），`ChatMessage.surface` 的原始值写入不动。⑧ **镜像同修**（P2-3）：画布 `selectImmersiveThread` 也按 project 取最新一条、不看来源——商家在侧栏聊完再开 Create，画布续的是侧栏对话。加 `!isPanelThread` 过滤（排的是「确知是面板的」，老行照旧被续，零降级）。⑨ **头部横条改成只在带新信息时画**（P2-4）：只有打开的是确知的画布对话才写 `Canvas · <画布名>`；工作区对话与老行一行都不画（`panelScopeLabel` 零调用者，删除）。**待 Founder 裁**：常驻 `Workspace · <页面名>` 横条要不要，请在 FRONT-A14 走查时定；接回来时 `panelContextSubject` 与围栏都还在。⑩ 参照页 `ApplicationShellReference` 改用同一个 formatter、不再传 `contextAttached`；「 · 」分隔符归并到 `panel-page.ts` 的 `formatPanelScope` 一处。 | 登记；本轮已落地，待 S5 |
| 2026-09-05 | **⑨ Canvas／Create 按设计接线第二刀**（第一刀＝覆盖层与工具条让位 PR #1144，第三批＝节点五图标／composer 两项／280px 历史 PR #1150／#1151，均已在主干）。**本刀做了两件**：① **卡片页脚补上「版本」栏** —— 版本＝这张卡在它那次付费按下里的 1-based 位置（`batchIndex + 1`，经 `canvasRecordedFacts` 读，`components/canvas/nodes/CanvasNodeFooter.tsx` 的 `canvasCardVersion`），也就是夹具给一轮四张卡标的 v1…v4；**不新增任何字段**，排队中的卡不说版本、删掉同批另一张也不会让这张改号（#603 T4 关掉的自造身份类），没记录就不画。第一刀把这一栏记成「没有诚实来源」，本行取代那条登记。同时卡名改走单一命名源 `apps/web/lib/canvas-title.ts` 的 `truncateCanvasTitle`，与 Canvas history 行断在同一个词边界，完整名仍在 `title=`。② **设计对照测试收成集合比对** —— 新 `apps/web/lib/__tests__/front-a15-design-parity.test.ts`（19 条，测试名逐字带 FRONT-A15）把夹具与生产两边的控件**整套读出来比集合**，既有的 FRONT-A14 各条是逐颗点名、对「多长出一颗没人写过断言的键」不敏感；变异已实证：加第六颗键红、把 Animate 改名红、把版本序号 +1 改成 +2 红。起步页那半边加进既有 `create-design-parity.test.tsx`。**本刀未做、连同理由**：（甲）**起步页「+ Add context」仍不渲染** —— 把引用带进画布要改 `apps/web/lib/canvas-entry-actions.ts` 的 handoff payload，该文件不在 §7.4 第⑨段写集内，且正被线程来源那一刀改、类型化引用形状要等引用选择器段合入；按裁决九「无契约的控件不出现」维持不渲染，施工内容与工程量见 §7.3「⑨ 下一刀 · 起步页参考契约」，依赖解除后即为下一刀。（乙）**composer 的计费说明没有改成按需披露** —— §7.1 ⑨ 写的是「改为按需披露（不是常驻一行）」，但已交付的钱引擎规格 `docs/specs/money-engine.md` 里 Founder 2026-09-02 那两条披露裁决（上传理解与聊天搜索）原话都是**常驻**一行价目小字、且「披露先于扣费」，主干还有一条围栏测试专门守着它不被对齐设计悄悄改成按需（`front-a14-canvas-alignment.test.ts`「钱披露不因对齐设计而缩水」）。两份已批准文件在这一点上对不上，且改动落在钱路披露上，**本刀不动、原样留着**，请 Founder 裁：维持常驻（推荐，钱面披露越早越安全）／改按需并同步修订钱引擎规格那两行。**与夹具的差异（逐条）**：① 卡不是钉死的 4:5 方框，而是按真实媒体比例收（`canvasMediaNodeSize`）——一张 4:5 的出片正好落成夹具那个形状，一段 16:9 的视频不被硬塞成竖版，测试里两个方向都钉住了；② 上传那一项文案是「Upload image or video」而不是夹具的「Upload image」，因为这个选择器真的也收视频；③ 夹具 ⋯ 菜单的 Share selected output 与 Duplicate 不出现（rule ①，无服务端动作）；④ 夹具的 Add URL 不出现（同上，全仓唯一按网址导入是 Otto 自己一轮里调的工具）；⑤ 对话历史的宽度与最大高度已按夹具（280px／260px，实测截图 `qa-i1/03`），但行内仍是聊天气泡、不是夹具那种「一行一轮：状态点＋提示词＋状态词＋一行回话」的紧凑行——改这个要动 `components/otto/OttoChatStream.tsx` 的消息渲染，紧挨着两条常驻钱披露，且不在第⑨段写集的四个目录内，本刀不动、登记待裁；⑥ 夹具没有的空态与错误态用设计系统自己的原语呈现（生产必需）。**落地**：本行对应 PR（分支 `claude/canvas-create-design-wiring-2`） | |

## 6. 改签记录

- 无

## 7. S2 施工稿（设计阶段产出；S1 正文 §0–§6 一字未动）

> S2 状态: 已批准
> S2 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1131 Founder 评论「S2 批准 frontend-baseline.md」(2026-09-02)
> S2 修订: 2026-09-03 增补（第⑨段、FRONT-A15、§7.3 各段施工细则、§7.4 写集互斥表）——**待 Founder 再次批准**，开工闸见 §7.5

### 7.0 范围与本场拍板（Founder 2026-09-02）

- **纯合并段先行、今天做**：只解冲突、不加功能，过全套机器验收与 Founder 视觉验收；Creation 引擎批 I 与之并行（写集互斥见 creation-engine.md §8.4）。
- **合并规则**（侦察实证 9 文件 10 块）：钱的行为以 main 为准——冲突块里 main 侧的业务逻辑与披露文案一字不改、取价函数不改；页面长相以分支为准——JSX 骨架、className、组件选型、`design-system/` symlink 基座照收。需要判断的只有一件：把 main 的钱字按原相对位置挂回分支的新布局（标签之后/选择器之前、确认按钮同排、输入框正下方）。
- **机器验收**：main 带入的四个 AST 级围栏（`understanding-disclosure.test.ts` 写点计数表、`money-a10-search-disclosure`、`money-a5-credits-never-expire`、`understanding-quote-copy`）＋全量 apps/web 测试＋typecheck＋production build＋e2e。写点计数若因重构改变＝需 Founder 签字的改动，不得顺手改数字。
- **分支占用**：`codex/uiux-frontend` 被 Founder 的 4232 工作树占用，施工开新分支 `claude/frontend-baseline-merge`（从 `origin/codex/uiux-frontend` 起，merge `origin/main`）。
- **评审夹具路由**：`/product-patterns/*` 与 `/design-system/*` 今天无守卫；纯合并段即加生产构建 `notFound()`（FRONT-A12），不等后段。
- **零迁移、零新环境变量、lockfile 无冲突**（侦察实证）：合并后 `pnpm install --frozen-lockfile` 直接可用；需跑的迁移只有 main 带来的 `20260901150000_understanding_billing_snapshot_and_paused_balance`。
- **施工顺序（2026-09-03 修订，据 §5 同日「裁决一」）**：「对齐轮」与「四大块」**并行**，不排队。每一段一个独立 PR、一位独立判官（跨厂复审，同族不算）；写集互斥表见 §7.4——第⑨段的写集与 ②③④⑤⑦ 的目录**分开列**，并行才不会互相解冲突。哪些段今天就能动、哪些段要等 Founder 再批一次，见 §7.5。

### 7.1 施工切段

| 段 | 内容 | 验收行 |
|---|---|---|
| ① 纯合并 | 上述规则解 9 处冲突；`globals.css` 保留分支 symlink、把 main 的改动搬进 `design-system/foundations/globals.css`；`.claude/CLAUDE.md` 两边都留；夹具路由加守卫；四处 server 邻接改动逐条对照 main 复审并补行为测试 | A1、A12、A13 |
| ② Library | `Collection`/`CollectionItem` 迁移；Elements 用现有 Entity；收藏、搜索、Use in canvas 接真 | A5、A6、A7 |
| ③ 引用选择器 | 统一 reference search（租户内、分页、类型化 ID＋来源）；消息保存真实引用 ID；Official avatar 类别经 `catalogKey` 官方角色点亮（creation-engine.md §8.1③） | A10 |
| ④ Brand | 五分区落 `BrandRecord`/`Memory`；谁改/何时改列；`getBrandContextText` 覆盖五分区 | A8、A9 |
| ⑤ Home | 布局持久化（org 级一行，迁移）＋`Manage home` capability；多来源 aggregate 带 freshness | A3、A4 |
| ⑥ Auth | 本地接 Resend 测试 key；注册/验证码/回跳/重置旅程 | A2 |
| ⑦ Settings/Billing | 新壳上复核现有真能力；无契约控件不出现 | A11 |
| ⑧ Founder 验收 | 六面登录态走查；差异登记 §5 | A14 |
| ⑨ Canvas/Create 按设计接线（2026-09-03 新增） | **已合入**：摘掉白底覆盖层、工具条让位（PR #1144，main `52a93a4a`）。本段要做的：卡片 4:5 与「名称／版本」页脚；节点操作条收敛为设计的 5 个图标（Edit with Otto／Create variations／Animate／Download／More actions——Download 与 Share 后端已有能力，本段补齐挂上）；composer 补「+ Add context」三选（Upload image／Choose from Library／Add URL）并把计费说明改为**按需披露**（不是常驻一行）；对话历史收成 280px 紧凑列表；Create 起步页文案／几何／发送键／焦点环按设计，「+ Add context」接线（据裁决五去掉「Create with Otto」标题行与「Nothing paid starts…」句）。**不显示**：Frame select 与 撤销／重做（裁决六，无对应功能）。**不在本段**：付费确认收回 Otto 状态卡的 needs-confirmation 状态机——那条触钱路，另立小规格再动 | A14、A15 |

**§7.1 新增验收行**（S1 §2 的验收表冻结不动；本行由 2026-09-03 的 §7 修订引入，随本次 S2 修订一并呈批，S5 时与 §2 各行同等对待）：

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| FRONT-A15 | （工程演示）跑 Canvas 与 Create 两面的设计对照测试 | 两面渲染出的控件集合与设计夹具（`design-system/patterns/canvas/CanvasReference.tsx`、`CreateWorkspaceReference.tsx`、`CreationComposer.tsx`）逐控件一致：节点操作条 5 个图标、composer 的「+ Add context」三选、卡片 4:5 与「名称／版本」页脚、Create 起步页没有「Create with Otto」标题行与「Nothing paid starts…」句；裁决六点名不显示的两个控件（Frame select、撤销／重做）两边都不出现 |

### 7.2 本地起动（纯合并段收尾即跑）

新 worktree → `merge origin/main` → 解冲突 → 从主检出复制 `.env.local` 与 `apps/web/.env.local`（只复制，不改值）→ `pnpm install --frozen-lockfile` → `pnpm --filter "./packages/*" build` → `prisma migrate deploy` → `next dev`；worker 同起。Founder 用主检出已有账号登录走 Create → Canvas → Library。

### 7.3 2026-09-03 对照审计后的施工细则（②③④⑤⑦ 增补；⑨ 的细则写在 §7.1 表内）

审计法：设计夹具（`apps/web/design-system/patterns/*` 的 Reference 组件与 fixtures）对生产路由逐面并排走查；结论三级（外壳一致／结构不同／没接线）与九项裁决见 §5 的 2026-09-03 各行。下面每段写四件：**要建的后端对象与迁移 / 依赖 / 切片顺序 / 工程量**。工程量是一人日估算，含测试与判官落修，不含等 Founder 走查的时间。

#### ② Library（估 3–4 天）

**后端对象与迁移**

- `Collection` 与 `CollectionItem` 两表（§1 九问 4 已定）：都带租户列（本仓库为 `ownerId`）外键与「同一 collection 内同一对象只一行」的唯一约束；删 collection 只删 membership，成员对象留在 Library（A6 明写）。
- **收藏是跨类型的——Founder 2026-09-03 已裁（裁决十）：新建一张统一收藏表**。设计的 Favorites 是把「生成结果」与「上传」混在一起的一个列表（`patterns/library/model.ts` 的 `LIBRARY_VIEWS`），而今天只有 `Generation.favorite` 一列（§1 九问 4 记的现状），上传（`Asset`）无处可存收藏。落法：新建 `Favorite(ownerId, subjectType, subjectId, createdAt)` 一张表**不分素材类型**，记「谁收藏了哪个素材」，带租户列（本仓库为 `ownerId`）约束与 `(ownerId, subjectType, subjectId)` 唯一约束；收藏页**一次查询、按时间排**。`Generation.favorite` 施工内一次性回灌进新表，之后只作读时回落。备选「给 `Asset` 补一列、两类各存各的」**已否决**（Favorites 视图会变成两次查询＋应用层合并排序，游标还要各算一套）。这一条原是 §1 九问 4 没覆盖的缺口，已由裁决十补齐。
- **生成历史改游标分页读模型**：设计的 History 是按时间分组（Today／Yesterday／Earlier this month）的长列表；今天 `getGenerationHistory` 一次性取。改成 `(createdAt, id)` 复合游标的服务端分页，分组在读模型里算好（时区按 org 设置），前端不算日期。
- **Uploads 独立身份**：Uploads 视图读 `Asset`，不混进生成历史；两条列表各自的游标互不影响。
- **Elements 只读**：Products／Characters／Locations 读现有 `Entity`；Official avatars 由 Creation 引擎的 `Entity.catalogKey` 点亮（creation-engine.md §8.1③）；Clothes 在演员库造型 preset 交付前**整格不出现**，不摆空态占位（裁决九）。

**依赖**：Official avatars 一格依赖 Creation 批 I 的 `catalogKey` 迁移（施工时核对它是否已在 main）；其余无新依赖。

**切片顺序**：① 游标分页读模型＋History／Uploads 两视图（**属对齐轮**，只接现有资产，今天可动）→ ② 收藏表与 Favorites 视图 → ③ `Collection`／`CollectionItem` 与 Collections 视图 → ④ Use in canvas 复核（现有 `createCanvasNode` 沿用）。

**验收落点**：A5（①②）、A6（③）、A7（④）。

#### ③ 引用选择器（估 2–3 天）

**今天的事实**：`@` 有**两套实现**，而且两套都只认 `Entity`——画布用 TipTap 的 `MentionInput`（`apps/web/components/MentionInput.tsx`，建议项类型写死成 `EntityDTO["type"]`），Otto 前门与聊天用纯文本的 `activeMentionQuery` ＋ `OttoMentionPopover`（`apps/web/components/otto/OttoFrontDoor.tsx:23,144-145`，前端内存 `filter`）。设计要七种类型（product／character／official-avatar／location／clothes／generation／upload，见 `patterns/reference-picker/model.ts`）。

**要建的后端对象**

- **统一 reference search**：一个服务端动作，租户内、按类型过滤、游标分页，返回**类型化 ID**（`{type, id}`，不是裸字符串）与来源标签，覆盖 `Generation`／`Asset`／`Entity` 三个源。两套 UI 先收口到这一个数据源，再收口成一个组件。
- **消息保存真实引用 ID**：施工时核对 `ChatMessage` 的引用字段，缺则加列（迁移）；发送后可从消息回链到那个对象（A10 明写）。

**依赖**：② 的生成／上传读模型（类型化 ID 与游标从那里来）；Official avatar 一类依赖 Creation 的 `catalogKey`。

**切片顺序**：① 服务端 reference search＋类型化 ID（后端，可与 ② 并行起步，联调排在 ② 第①刀之后）→ ② 两套 `@` UI 收口成一个组件（**这一刀里的「@ 小片」外观对齐属对齐轮**）→ ③ 消息落引用 ID 与回链。

**验收落点**：A10。

#### ④ Brand（估 4–5 天）

**分节映射（六 → 五）**：生产今天是 Founder 2026-07-02 批的六节（`packages/core/src/memory-sections.ts` 的 `SECTIONS`），设计是五节（`patterns/brand/model.ts` 的 `BRAND_SECTIONS`）。

| 生产旧节 | 设计新节 | 依据 |
|---|---|---|
| About the brand（about） | Brand voice | **Founder 2026-09-03 裁决十一** |
| Your customers（customers） | Audiences | **Founder 2026-09-03 裁决十一** |
| Your products（products） | Knowledge base | **Founder 2026-09-03 裁决三点名** |
| Your offers（offers） | Knowledge base | **Founder 2026-09-03 裁决三点名** |
| Look & feel（look） | Visual guidelines | **Founder 2026-09-03 裁决十一** |
| Do & don't（rules） | Style guide | **Founder 2026-09-03 裁决十一** |

六条映射**全表已裁**（产品／优惠 → Knowledge base 出自裁决三，其余四条出自裁决十一），施工照落，没有待确认项。迁移只改「这条记录归哪一节」，**不删任何行**；`sectionForCategory` 的 LEGACY 表同批扩写，旧 category 字符串继续解析得出新节。

**要建的字段与迁移**（设计的 `ContextRecord` 要 source／sourceDetail／status／usage／history，今天一个都没有）

- `updatedById`（谁改的）：A8 要求每条显示「谁改的、何时改的」。今天 `Memory.source` 与 `BrandRecord.source` 只有 `'otto' | 'user'` 两个值——答得出「是不是 Otto 改的」，答不出「是谁」；`updatedAt` 已有。两张表各加一列。
- `origin` ＋ `originDetail`（设计的 source／sourceDetail：手写／来自某个网址／来自某份上传）：与上面的 `source` 不是一回事，**不复用同一列**。
- `contextStatus`（设计的 Ready／Draft／Processing）：今天 `BrandRecord.status` 是 `'active' | 'archived'`（归档语义），两套语义**不复用同一列**。
- 改动史：新建一张 revision 表（带 `orgId` 与租户约束）。今天只有 `deletedAt` ＋ restore，答不出「改过什么」。
- `usage`（这条记录被哪些面用到）：**由读模型算，不落列**——落列就会与真相不同步。

**草稿流动作链（裁决四）**：`addSource → extract → draft → preview → confirmSave` 五个服务端动作。确认之前只写 `contextStatus='Draft'` 的行；`getBrandContextText` 只取 `Ready`，草稿因此永远进不了 Otto 上下文。`preview` 要调模型，那笔小额成本按钱引擎自动理解的计费口径（验收 A9：披露先于扣费、按动作时刻价目、我方故障重试同一素材同一阶段只计一次）在**点预览之前**披露。

**依赖**：钱引擎自动理解计价（已在 main，商家可见面见 `apps/web/app/billing/page.tsx:207`）。

**切片顺序**：① 五节映射＋迁移（数据先落位）→ ② 谁改／何时改与 revision 表 → ③ 草稿流五动作＋预览披露 → ④ `getBrandContextText` 覆盖五节的行为测试。

**验收落点**：A8（①②③）、A9（④）。

#### ⑤ Home（估 3–4 天）

**后端对象与迁移**

- **Customize home 落库**：`OrgHomeLayout`（租户列（本仓库为 `ownerId`）上有唯一约束、有序的 `componentIds`、`updatedAt`、`updatedById`）——设计的可定制项是 8 个组件 id（`patterns/founder-home/model.ts` 的 `HOME_COMPONENTS`），落的是**顺序 ＋ 勾选**两件事，一行一 org（§1 九问 4 已定「org 级一行」）。入口由具体 capability `Manage home` 判定，不看角色名（A4）。
- **ready 读模型要真实生产者**：`MarketingHealthReadModel`（`apps/web/lib/home-marketing-health.ts`）今天有 not-configured／insufficient／partial／ready 等状态；设计的 ready 版面要 8 个组件各自的数字。**没有真实生产者的组件不出现**（裁决九），不摆空卡、不摆占位数字。
- **partial 单源版面先做**：多数商家开局只连一个渠道，partial 才是常态；先把 partial 单源版面做完整（`MarketingHomeView` 已有 partial 分支），ready 多源版面随生产者逐个点亮。

**依赖**：连接状态五态读模型已接真（§1 九问 4）；Otto 页面上下文 chip 归 Otto 引擎，本段不做（§3「不做」）。

**切片顺序**：① partial 单源版面按设计对齐（**属对齐轮**，不需新后端）→ ② `OrgHomeLayout` 迁移＋Customize home 落库＋capability → ③ ready 版面按真实生产者逐个点亮。

**验收落点**：A3（①③）、A4（②）。

#### ⑨ 下一刀 · 起步页参考契约（估 1–2 天；2026-09-03 §5 登记）

**现状与证据**：Create 起步页 composer 已按设计对齐（PR #1151），但「+ Add context」（Upload image / Choose from Library / Add URL）本轮**不显示**，按裁决九「无契约的控件不出现」处置。根因：起步页没有把参考带进画布的通道——`createCanvasConversation` 的 handoff 只落 `{prompt, threadId}`（`apps/web/lib/canvas-entry-actions.ts:87`）；夹具 `design-system/patterns/canvas/CreationComposer.tsx` 的上传回调只是 `onReferenceChange(file.name)`（:101 附近），不真上传（PR #1151 报告「设计有、生产暂不显示」表）。

**要建的接线**

- **handoff payload 加引用字段**：`canvas-entry-actions.ts` 的 `createCanvasConversation` 写入的 `payload`（今天是 `{prompt, threadId}`）扩成带引用列表的形状，类型化 ID 沿用 ③ 引用选择器的 `{type, id}` 形状，不裸存字符串。
- **画布侧消费**：新会话第一轮要把这些引用挂上去，不能只挂 prompt——落点在画布落地代码（PR #1150 合入后的节点/composer）。
- **起步页 Upload image / Choose from Library 接线**：Upload image 走现有 `finalizeCandidateUploads`，但起步页此刻还没有 `projectId`（PR #1151 报告已指出）；Choose from Library 复用 Library 页自己的挑选动作（画布侧的 Otto composer 已经在用同一动作，见 PR #1150 报告）。
- **Add URL 仍不接**：全仓唯一的按网址导入是 `ctx.mediaImport.fromUrl`（`apps/web/lib/otto-media-port.ts:207`），是 Otto 自己一轮里调的工具，没有 composer 能调的 server action；触发条件不变——出现客户端可调的按网址导入动作。

**依赖**：PR #1150（Canvas 表面按 pattern 对齐）合入 main——画布侧的消费逻辑要挂在合入后的节点/composer 代码上。

**工程量**：估 1–2 天（人日，含测试）。

**验收落点**：A14；A12（起步页不出现假按钮的围栏，PR #1151 已落）不变。

#### ⑦ Settings/Billing（估 2 天）

- **外壳级对齐**：Settings 四节（Profile／General／Connections／Billing & credits）在导航权威源里已经有（`packages/core/src/navigation.ts` 的 `SETTINGS_SECTIONS`）；生产上四节是四个独立路由页，设计是「左轨 ＋ 右侧内容」的一体内壳。本段做外壳，不动各节自己的能力。
- **去卡片化裸表单**：生产用 `Card`／`CardHeader`／`CardTitle` 包每一块（`apps/web/app/settings/page.tsx:27-30`），设计是 `<section>` ＋ 一条 `divide-y` 边框行列表、没有 Card；按设计改。
- **Connections 真实厂牌 logo**：设计的 `WorkspaceConnection` 带 `icon`（`patterns/settings/model.ts`），生产今天没有厂牌图形。补真实 logo 资产，走 `apps/web/design-system/brand/` 的资产路径，不散落进 `public/`。
- **Billing 按裁决二**：按设计两节的排版与组件重画，但**保留主干三条花钱披露**——余额卡与「Credits don't expire」（`apps/web/app/billing/page.tsx:131`）、Spend cap（`app/billing/SpendCapCard.tsx`）、Auto-understanding（`:207`）、Web search in chat（`:227`）。设计的「Plan & payment」（付款方式、发票）**整节不出现**，也不放占位（§3「不做 subscription plan / payment method / invoice」原本就这么写）。

**依赖**：无新后端对象——这正是本段能整段进对齐轮的原因。

**切片顺序**：① 外壳＋去卡片化（**属对齐轮**）→ ② Connections logo → ③ Billing 重画，并补一道「四条披露仍在位」的围栏测试。

**验收落点**：A11。

### 7.4 写集互斥表（并行开工的前提；谁后合并谁解冲突）

| 段 | 写集（目录／文件） |
|---|---|
| ⑨ Canvas/Create | `apps/web/components/canvas/`、`apps/web/components/start-something/`、`apps/web/app/create/`、`apps/web/components/otto/panel/` |
| ② Library | `apps/web/app/library/`、`apps/web/components/library/`（新建）、`apps/web/lib/data.ts` 的历史读取段、prisma（Collection／CollectionItem／收藏 迁移） |
| ③ 引用选择器 | `apps/web/components/MentionInput.tsx`、`apps/web/components/otto/OttoMentionPopover.tsx`、`apps/web/lib/otto-mentions.ts`、新建的 reference-search 服务端动作、prisma（ChatMessage 引用列） |
| ④ Brand | `apps/web/app/brand/`、`apps/web/components/brand/`、`packages/core/src/memory-sections.ts`、`apps/web/lib/brand-record-actions.ts`、`apps/web/lib/memory-actions.ts`、prisma（Brand 各列与 revision 表） |
| ⑤ Home | `apps/web/app/(home)/`、`apps/web/components/home/`、`apps/web/lib/home-marketing-health.ts`、prisma（OrgHomeLayout 迁移） |
| ⑦ Settings/Billing | `apps/web/app/settings/`、`apps/web/app/profile/`、`apps/web/app/billing/`、`packages/core/src/navigation.ts` |
| 交集与规矩 | `packages/db/prisma/migrations/` 各段目录名不同即不冲突，但 `schema.prisma` 只有一份——后合并的那段负责重贴自己的 model 并重跑迁移校验。`apps/web/design-system/` 对所有段**只读**：任何段都不得改夹具去迁就实现（裁决九） |

### 7.5 批准与开工闸（本次 §7 修订）

- 本次 §7 修订（第⑨段、FRONT-A15、§7.3、§7.4）**需 Founder 在本 PR 评论「S2 批准 frontend-baseline.md」再次批准**，各段方可开工。
- **已放行的例外**：裁决一里的「对齐轮」中**不涉及新后端对象**的项目——⑨ Canvas/Create 接线、Create 与设置换皮（⑦ 的第①②刀）、素材库接现有资产（② 的第①刀）、@ 小片外观（③ 第②刀的对齐部分）、登录破图、面包屑——Founder 2026-09-03 裁决一已放行，不等本次批准。
- **原先要回呈的两件，Founder 2026-09-03 已裁**（§5 裁决十、十一），施工照落，不再是待确认项：①Favorites 跨类型收藏 = **新建一张统一收藏表**（不分素材类型、租户约束、收藏页一次查询按时间排；「给 `Asset` 补一列」否决）；②Brand 六节→五节映射**全表落定**（about→Brand voice、customers→Audiences、look→Visual guidelines、rules→Style guide、产品／优惠→Knowledge base）。
- **不在本次修订范围**：付费确认收回 Otto 状态卡的 needs-confirmation 状态机（触钱路，另立小规格）；剪辑拼接（裁决七，不属阶段一）。
