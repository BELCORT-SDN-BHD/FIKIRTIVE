# Round 2 覆盖矩阵（coverage-matrix）

> 每个 `R2-xx` × 验收编号／登记行一行。判定值：**PASS／PARTIAL／FAIL／NOT RUN／BLOCKED**。
> 「需查表才能定」的一律先记 **PARTIAL（待后端取证）**，要查什么写在 `run-ledger.md` 对应段与本表「待查」列 —— 后端取证由 W2 写进 `backend-evidence.md`。
> 依据：`plan.md` §2 与 §3.5 对账表（§2 挂出的每个编号在本表都有一行）。走查者：W1。部署 `2a96750e`（web／worker 同版）。
> **本表是覆盖记录，不是 GO/NO-GO 结论**；结论由 `report-round2.md` 合成。

## Preflight

| 项 | 判定 | 证据 |
|---|---|---|
| P0-1 版本对齐 | PASS | ledger §0 P0-1：`build.sha=2a96750e`，web/worker 同 commitHash，`/api/ready ready=true migrations=applied` |
| P0-2 前置票 15 张 | PARTIAL | 14 张已合并并在 `2a96750e` 祖先链；**#1320／PR #1349（登录门⑤）仍 OPEN** → 相关条目 NOT RUN |
| P0-3 环境边界 | PASS | staging 桶 `fikirtive-staging` ≠ production `fikirtive-production`（**第一轮 ENV-01 本轮不成立**）；`E2E_GOOGLE_DOOR_STUB` 未武装 → Google 门结论有效；`backup=missing` 照录 |

## 登录门（`docs/specs/sign-in.md` §2）

| 条目 | 编号 | 判定 | 证据指针 | 待查（W2） |
|---|---|---|---|---|
| R2-01 | SIGNIN-A1 | **PASS** | ledger §R2-01①；截图 `01-login-page-no-password.png`；会话 `Cw7acC6L…`、`emailVerified=true`、`name=""` | `BetterAuthUser`／`Membership` 各一行 |
| R2-01 | SIGNIN-A5 | **PARTIAL** | 预填＋一次即进 PASS（截图 `02-magic-link-code-prefilled.png`）；同链接第二次点 PASS（`Code not accepted`）；**15 分钟过期未测** | — |
| R2-01 | SIGNIN-A16 | **PARTIAL** | 混合大小写 `Tools+R2F20260911@Belcort.com` 登录 → 全程小写、建号成功（ledger §SIGNIN-A16） | `AllowedEmail` 只有一行小写；两次大小写登录同一 `userId` |
| R2-02 | SIGNIN-A2 | **NOT RUN** | 无陌生 Google 账号（Founder 未提供夹具 B，禁止自建账号） | — |
| R2-02 | SIGNIN-A14 | **NOT RUN** | 三种失败 + state 族三次都需要 Google 门可反复操作；本机只有一个已授权 Google 身份，取消授权／撤销后无法复原 | — |
| R2-02 | SIGNIN-A13 | **NOT RUN** | staging 造不出「Google 报邮箱未验证」的账号（plan 已预告大概率如此） | — |
| R2-03 | SIGNIN-A3 | **PARTIAL** | 同一邮箱 `tools@belcort.com` 先 Google 后码门 → 同一 `userId=pZMe1PRZ…`、同一工作区（ledger §R2-02/03） | `BetterAuthUser` 一行、`Organization`／`Membership` 一套、`BetterAuthAccount` 两条来源同 `userId` |
| R2-03 | SIGNIN-A12 | **NOT RUN** | PR #1349 未上线（13:20 重查仍 OPEN、sha 未变）＋ 无陌生 Google 夹具 | — |
| R2-04 | SIGNIN-A4 | **PASS** | 三地址 302→`/login`；七端点 GET/POST 全 404（ledger §R2-04 原文） | — |
| R2-04 | SIGNIN-A11（前半） | **PASS** | 登录页无密码框／无 Forgot password／无设密码入口 + 七端点 404 | — |
| R2-04 | SIGNIN-A9（前半） | **PARTIAL（待后端）** | 商家面无任何密码入口 | `SELECT count(*) FROM "BetterAuthAccount" WHERE "providerId"='credential'` 期望 **0** |
| R2-05 | SIGNIN-A6 | **PASS**（Google 半边 NOT RUN） | 横幅逐字（截图 `03-login-paused-banner.png`）；陌生人**不寄码**（Gmail 零结果）、任意码被拒、零建号；老用户照进；还原后截图 `04-login-banner-restored.png` | 暂停期是否真无 `BetterAuthUser` 新行 |
| R2-05 | SIGNIN-A7 | **NOT RUN** | 后台 Revoke access 未执行（为不破坏第二租户，计划放收尾，时间不足） | — |
| R2-05 | SIGNIN-A8 | **PARTIAL** | 第 6 次 `Try again in an hour.` PASS；陌生 1304ms vs 老 1142ms、文案同形 PASS；**第 4 次那句不兑现 → FSE-201** | — |
| R2-06 | SIGNIN-A10 | **PARTIAL** | 工作区名为空 PASS、`emailVerified=true` PASS；**赠金一笔无法用 `+tag` 夹具验证**（归一化键判定同一收件箱已领，属 A17 正确行为） | `CreditLedger` 是否存在 `signup:<orgId>`；登录审计各一行；`AllowedEmail` status active |
| R2-06 | SIGNIN-A17 | **PARTIAL** | 反向正面证据：`tools+r2a…` 与 `tools+r2f…` 两个新号都**没有**拿到赠金（归一化后同一收件箱），说明幂等键按去 `+tag` 算 —— 与规格一致；**上限 50／第 51 个／Sentry 告警未测**（未授权批量开号） | `SignupGrantClaim` 行 |
| R2-06 | SIGNIN-A15 | **NOT RUN** | 需人为制造建号中途失败（断库连接），未获授权也未执行 | — |

## 产品身份（`docs/specs/brand-product-identity.md`）

| 条目 | 编号／登记行 | 判定 | 证据指针 | 待查（W2） |
|---|---|---|---|---|
| R2-07 | PRODID-A1 | **PARTIAL** | Brand 新增 → Library Products 同一件出现（ledger §R2-07）。**注**：Brand 新增表单**没有主图一格**，主图是建完后 `Add image · from Library` | `BrandRecord.entityId = Entity.id` |
| R2-07 | PRODID-A2 | **PARTIAL** | `@` 菜单来源标签逐字 `Product`、可选入并进入生成 | 生成谱系 `approvedEntities` 是否同一 Entity id |
| R2-07 | PRODID-A3 | **NOT RUN** | Library「新建元素 → 产品」反向路未走（Library 元素面板只有 Remove/Close，未找到新建入口） | — |
| R2-07 | PRODID-A7 | **NOT RUN** | 「对 Otto 说记下产品 X」＋「理解提取不确认」两步未执行（时间） | — |
| R2-07 | PRODID-R4 | **NOT RUN** | 该工作区原本 `No products yet`，没有「存量无价签产品卡」可挑 | 是否存在无价签存量 product 行 |
| R2-07 | FRONT-A10 | **PARTIAL** | 三类来源（生成结果／产品／官方演员）都在同一个 `@` 菜单、都来自服务器；官方演员可选入并被引擎逐字点名（`Xinyi (person)`）⇒ 非假条目 | `ChatMessage.referenceRefs` 存真实 id；该 id 在 `Entity` 表 `type='CHARACTER'` |
| R2-08 | PRODID-A4 | **PARTIAL** | Brand 改名 → Library 同步、只有一行（PASS）；**Library 侧无改名／换主图入口**，反向未测 | 是否只有一行 Entity |
| R2-08 | PRODID-A5 | **PASS** | Library 元素面板逐字只有 `Remove from Library` / `Close` —— 价格／卖点／分类三格入口一个都没有 | — |
| R2-08 | PRODID-R6 / R9 | **NOT RUN** | 「只改价格／归档／换封面／撤销 Otto 改动后名字与封面不被写回」四条未逐条构造 | — |
| R2-09 | PRODID-A6 | **PARTIAL** | ③ Library 删 → Brand 消失 **PASS**（二次确认文案逐字已录）；成片不动 **PASS**；① Brand 无删除入口（只有 Archive）；②④ **无恢复入口** | `Entity.deletedAt` / `BrandRecord.deletedAt` |
| R2-09 | PRODID-R8 | **NOT RUN** | 未构造「名字槽位被占」的冲突 | — |
| R2-09 | PRODID-R2 | **NOT RUN** | 产品从未挂过封面图，无「唯一一张照片」可删 | — |
| R2-09 | §5「两个删除方向不清扫封面字节」 | **NOT RUN** | 同上（无封面字节） | 删整件产品后 `ReferenceImage`／存储对象是否仍在 |
| R2-10 | PRODID-A9 | **PARTIAL** | 读路 **PASS**：第二租户在 Library／Elements／Brand 三面**零命中**租户 A 的任何字样；写路（构造 `entityId` 写入）未执行 | 跨租户写入是否被数据库约束拒绝 |
| R2-10 | PRODID-A10 | **NOT RUN** | 「建／改／删各一次后余额与账本零新增」未单独取证（本轮同期有付费动作，不能干净归因） | 这三次动作期间 `CreditLedger` 零新行 |
| — | PRODID-A8（中间那句） | **PARTIAL（纯后端）** | 商家面无法取证 | `SELECT count(*) FROM "BrandRecord" WHERE kind='product' AND "entityId" IS NULL` 期望 0 |

## Creation（`docs/specs/creation-engine.md`）

| 条目 | 编号／登记行 | 判定 | 证据指针 | 待查（W2） |
|---|---|---|---|---|
| R2-11 | §5 :162（FSE-001 正路） | **PASS** | 官方演员＋商品图两张参考**直接出片**；Otto 逐字 `no starting picture needed. One step!`；确认卡 `Uses 3 of your reference photos` + `Reference names sent to the engine: Xinyi (person). …`；成片可播（MP4 3,228,579 字节 / 720×1280 / 5.04s） | `GenJob` 一条 DONE、引用字段、`CreditLedger` 一 reserve 一 settle、无残留 hold |
| R2-11 | CREATE-A10 | **PARTIAL** | 第一场景不触发人脸拦截、引用在卡面可查；**第二场景未跑**（时间/预算取舍），跨场景同脸按规格归 Founder 判 | 引用落盘（`referenceRefs`／`approvedEntities`） |
| R2-11 | §5 2026-09-09（自动放大） | **NOT RUN** | 未备 100–300 档的真实商品照 | — |
| R2-11 | §5 :176④ | **NOT RUN** | 同上（没有触发放大披露的样本） | — |
| R2-11 | §5 :176⑥ | **FAIL（现象）** | 短边 80 的图在两个入口都**没有**出现任何拒绝文案（见 FSE-204） | 尺寸闸挂在哪条路径 |
| R2-12 | §5 :163① | **PASS** | 非空输入框不被覆盖 + 逐字提示 `Kept what you're typing — that earlier message wasn't put back. Clear the box and press Edit and retry again.`；清空后再点真放回、提示自动消失 | — |
| R2-12 | §5 :163② | **PARTIAL（未复现）** | 全页查无 `[data-slot="retry-source"]`，见 FSE-205（路径待确认） | 失败卡重试路径是否写 `sourceMessageId` |
| R2-12 | §5 :163③ | **NOT RUN** | 未构造「有名字 + 无名件」混合引用 | — |
| R2-12 | §5 :170（FSE-012） | **NOT RUN** | 数量 1→2 的竞态提交在工具限制下无法可靠构造 | — |
| R2-12 | CREATE-A1 | **PARTIAL** | 每一次生成都先出确认卡、卡上有价、`No charge until you confirm`（variation 弹窗逐字）；「两条提交路前置报价数字相同」未对照 | — |
| R2-12 | CREATE-A12 | **PARTIAL** | variation 弹窗把 `sentPromptText` 整句摊开；未按 Regenerate | `sentPromptText` 与批准稿逐字一致、`routeReason` 有值 |
| R2-13 | §5 :164 / :173（FSE-005） | **PASS（本轮样本）** | 失败任务出现时节点与 Otto 行**同时自动**转 Failed（`That didn't finish / You weren't charged.`），无需手动刷新；成功任务同理 | 「合成后原商品节点消失」那一症状本轮无合成路样本 |
| R2-13 | §5 fb:202（FSE-010） | **FAIL 一格** | 侧栏广播通；**同屏正文余额不同步（差 1 credit）** → FSE-202 | DB 余额与两个显示值对照 |
| R2-13 | CREATE-A11 相邻样本 | **PARTIAL** | 有两轮纯规划（问比例、劝退两步方案）**未产生任何 GenJob** | `OttoTurnTrace.toolCalls` 是否为空 |
| R2-14 | §5 :169（FSE-009） | **PASS** | 结算后 `Cost: 0.1 credits` 一行合计、不拆行、不写 no credits charged；Billing 行 `Understanding — -0.1`。附时序观察 FSE-203 | — |
| R2-14 | FRONT-A5 | **NOT RUN** | 搜索／收藏／筛选未逐项执行（时间） | — |
| R2-14 | FRONT-A6 | **NOT RUN** | collection 增删未执行 | — |
| R2-14 | FRONT-A7 | **NOT RUN** | 「Use in canvas」未执行 | — |
| R2-14 | §5 fb:203（FSE-011 Profile 邮箱空白） | **NOT RUN** | 未打开 Profile 页复现 | — |
| R2-15 | §5 2026-09-10（variation 真实交付） | **PASS（商家可见）** | `Create variations` → `Cost: 1 credit. No charge until you confirm.` → 产出 `01M2882PXJX2DYTZNRTH4KD6ZZ`，JPEG 146,870 字节 / 1728×2304 | 一 reserve 一 settle、reserved 归 0 |
| R2-16 | §5 取消语义 | **PARTIAL（无取消入口）** | 三次长任务渲染期间控件只有 `Check again`，无 Stop/Cancel | — |
| R2-17 | §5 cap 多入口与并发 | **PARTIAL** | 两个入口（Library 动作、画布确认卡）都**明确拒绝且零扣费**，文案逐字含所需与上限；Otto 主动／分镜两个入口与并发未做 | 被拒时零新 `GenJob`、零新账本行 |
| R2-18 | §5 完整下载字节 | **PASS（字节层面）** | MP4 3,228,579 字节（`ftypisom`，5.04s，720×1280）、JPEG 161,363 / 146,870 字节（`ff d8 ff e0`，1728×2304）。`Download` 按钮落盘受浏览器沙箱限制未验 | — |
| R2-19 | §5 :172④ | **FAIL** | 跨租户深链被**静默换成新画布**、无提示、有写入（无泄漏）→ FSE-207 | 是否真的新建了 project 行 |
| R2-19 | FRONT-A12 | **PARTIAL** | ①五个夹具地址**已登录**下全 404、未登录 302→`/login`（PASS）；②六面夹具串**零命中**（PASS）；③「写入失败有反馈不假成功」**NOT RUN** | — |
| R2-20 | §5 :162④ | **PASS（带演员）** | 带演员镜头一步到位、明说要两步时被劝退；**无人物镜头仍提议两步** → FSE-208（口径待 Founder 裁） | — |
| R2-21 | §5 :172⑥（接续＋直接出片同开） | **NOT RUN** | 未跑（时间；预算尚余 83%） | — |
| R2-22 | §5 :162 残留③ | **PASS（现象取证）** | 产品面发不出「首帧＋演员」组合：Otto 逐字劝退、**零卡零 GenJob 零账本行**；按 plan §1.1 不下供应商接受度结论 | 首帧即参考名额是否仍为 0（`reference-budget.ts`） |
| R2-23 | §5 :162 残留① | **FAIL（现象）／根因待确认** | 80px 图在「图生图 base」与「视频 starting frame」两个入口都**未在付费前被拒**；图生图**成功并扣 1 credit**，视频走到供应商才失败（全额不收费、失败文案不说原因）→ FSE-204 | `Asset.width/height` 是否有真值；尺寸闸挂在哪条路径 |
| R2-24 | CREATE-A2 | **PARTIAL** | 「不直接出片的镜头」**根本没有 Add image 入口**（比写入即拒更早的 fail closed，PASS）；服务端点名拒绝与跨租户 `setShotReferences` **未测** | 被拒时 `CreditLedger` 零新行、零新 `GenJob` |
| R2-24 | §5 :178 | **PARTIAL** | ① 草稿卡上 `Add image` 第一手就在（两个直接出片镜头都有）**PASS**；②③⑤ **BLOCKED**（浏览器面板合成点击落不到弹层选项，四种方式均试过） | 镜头 `referenceGenerationIds`、`GenJob.videoOptions.referenceGenerationIds` |

## 前端基线（`docs/specs/frontend-baseline.md`）

| 条目 | 编号／登记行 | 判定 | 证据指针 |
|---|---|---|---|
| R2-06 | §5 2026-09-10（FRONT-A2 密码半段退役） | **PASS** | 七端点 404 + 登录页无密码入口；`/login?from=/create` 登录后**落点正确**（进 `/create`） |
| R2-19 | FRONT-A12 | 见上表 | — |
| R2-13 | §5 fb:202 | 见上表（FAIL 一格） | — |
| R2-14 | §5 fb:203 | **NOT RUN** | — |

## 汇总计数（本表 46 行判定）

| 判定 | 条数 |
|---|---|
| PASS | 14 |
| PARTIAL | 17 |
| FAIL | 4（:176⑥／fb:202 一格／:172④／:162 残留① 现象） |
| NOT RUN | 10 |
| BLOCKED | 1（R2-24 ②③⑤，工具侧） |

**提醒**：plan §5.2 第 1 条写明「A1–A6 任何一条未通过**或未执行**（NOT RUN／BLOCKED 都不是通过）」即触发 NO-GO 判据。本表只给覆盖事实，结论留 `report-round2.md`。
