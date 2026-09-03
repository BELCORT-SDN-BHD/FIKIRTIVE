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

- `Collection` 与 `CollectionItem` 两表（§1 九问 4 已定）：都带 `orgId` 外键与「同一 collection 内同一对象只一行」的唯一约束；删 collection 只删 membership，成员对象留在 Library（A6 明写）。
- **收藏是跨类型的——Founder 2026-09-03 已裁（裁决十）：新建一张统一收藏表**。设计的 Favorites 是把「生成结果」与「上传」混在一起的一个列表（`patterns/library/model.ts` 的 `LIBRARY_VIEWS`），而今天只有 `Generation.favorite` 一列（§1 九问 4 记的现状），上传（`Asset`）无处可存收藏。落法：新建 `Favorite(orgId, subjectType, subjectId, createdAt)` 一张表**不分素材类型**，记「谁收藏了哪个素材」，带 `orgId` 租户约束与 `(orgId, subjectType, subjectId)` 唯一约束；收藏页**一次查询、按时间排**。`Generation.favorite` 施工内一次性回灌进新表，之后只作读时回落。备选「给 `Asset` 补一列、两类各存各的」**已否决**（Favorites 视图会变成两次查询＋应用层合并排序，游标还要各算一套）。这一条原是 §1 九问 4 没覆盖的缺口，已由裁决十补齐。
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

- **Customize home 落库**：`OrgHomeLayout`（`orgId` 唯一、有序的 `componentIds`、`updatedAt`、`updatedById`）——设计的可定制项是 8 个组件 id（`patterns/founder-home/model.ts` 的 `HOME_COMPONENTS`），落的是**顺序 ＋ 勾选**两件事，一行一 org（§1 九问 4 已定「org 级一行」）。入口由具体 capability `Manage home` 判定，不看角色名（A4）。
- **ready 读模型要真实生产者**：`MarketingHealthReadModel`（`apps/web/lib/home-marketing-health.ts`）今天有 not-configured／insufficient／partial／ready 等状态；设计的 ready 版面要 8 个组件各自的数字。**没有真实生产者的组件不出现**（裁决九），不摆空卡、不摆占位数字。
- **partial 单源版面先做**：多数商家开局只连一个渠道，partial 才是常态；先把 partial 单源版面做完整（`MarketingHomeView` 已有 partial 分支），ready 多源版面随生产者逐个点亮。

**依赖**：连接状态五态读模型已接真（§1 九问 4）；Otto 页面上下文 chip 归 Otto 引擎，本段不做（§3「不做」）。

**切片顺序**：① partial 单源版面按设计对齐（**属对齐轮**，不需新后端）→ ② `OrgHomeLayout` 迁移＋Customize home 落库＋capability → ③ ready 版面按真实生产者逐个点亮。

**验收落点**：A3（①③）、A4（②）。

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
