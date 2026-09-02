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
| 2026-09-03 | **Otto 仍然告诉商家 `/create#templates` 有一个 Templates 区段**（`packages/otto/src/skills/recommend-templates.ts:67` 的 `TEMPLATES_SELF_SERVE`）。新壳的 `/create` 只挂 Otto 入口与画布历史，那个区段已经不渲染 —— 这句话今天是假的。本 PR 只把重定向表里的死锚点撤了（零可见变化），改 Otto 的说法是一次商家可见的文案改动，留给 Founder 定：改成「让 Otto 直接帮你做」，还是把 Templates 区段接回 `/create`。 |  |

## 6. 改签记录

- 无

## 7. S2 施工稿（设计阶段产出；S1 正文 §0–§6 一字未动）

> S2 状态: 已批准
> S2 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1131 Founder 评论「S2 批准 frontend-baseline.md」(2026-09-02)

### 7.0 范围与本场拍板（Founder 2026-09-02）

- **纯合并段先行、今天做**：只解冲突、不加功能，过全套机器验收与 Founder 视觉验收；Creation 引擎批 I 与之并行（写集互斥见 creation-engine.md §8.4）。
- **合并规则**（侦察实证 9 文件 10 块）：钱的行为以 main 为准——冲突块里 main 侧的业务逻辑与披露文案一字不改、取价函数不改；页面长相以分支为准——JSX 骨架、className、组件选型、`design-system/` symlink 基座照收。需要判断的只有一件：把 main 的钱字按原相对位置挂回分支的新布局（标签之后/选择器之前、确认按钮同排、输入框正下方）。
- **机器验收**：main 带入的四个 AST 级围栏（`understanding-disclosure.test.ts` 写点计数表、`money-a10-search-disclosure`、`money-a5-credits-never-expire`、`understanding-quote-copy`）＋全量 apps/web 测试＋typecheck＋production build＋e2e。写点计数若因重构改变＝需 Founder 签字的改动，不得顺手改数字。
- **分支占用**：`codex/uiux-frontend` 被 Founder 的 4232 工作树占用，施工开新分支 `claude/frontend-baseline-merge`（从 `origin/codex/uiux-frontend` 起，merge `origin/main`）。
- **评审夹具路由**：`/product-patterns/*` 与 `/design-system/*` 今天无守卫；纯合并段即加生产构建 `notFound()`（FRONT-A12），不等后段。
- **零迁移、零新环境变量、lockfile 无冲突**（侦察实证）：合并后 `pnpm install --frozen-lockfile` 直接可用；需跑的迁移只有 main 带来的 `20260901150000_understanding_billing_snapshot_and_paused_balance`。

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

### 7.2 本地起动（纯合并段收尾即跑）

新 worktree → `merge origin/main` → 解冲突 → 从主检出复制 `.env.local` 与 `apps/web/.env.local`（只复制，不改值）→ `pnpm install --frozen-lockfile` → `pnpm --filter "./packages/*" build` → `prisma migrate deploy` → `next dev`；worker 同起。Founder 用主检出已有账号登录走 Create → Canvas → Library。
