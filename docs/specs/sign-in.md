# 登录门（照 Linear 模型）规格书（S1）

> 状态: 已冻结 · v1
> 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1260 Founder 评论「S1 批准 sign-in.md」(2026-09-08)
> 规格前缀: SIGNIN（验收编号 = SIGNIN-A1、A2…，全仓不得与其他规格撞前缀）

## 0. 一句话

登录照 Linear：一个登录页、两扇门——**Continue with Google** 与 **Continue with email**（邮件里一条登录链接＋一个可手输的 6 位码）。陌生人和老用户走同一扇门，第一次来就开好账号；密码注册、密码登录、忘记密码整体下线。商家因此不用记密码，也不会再有「别人先用我的邮箱设了密码」这种事。

## 1. 九问（S1 grill 的答案）

1. **商家做什么动作、看到什么结果？**
   - 打开登录页，看到两个按钮：Continue with Google、Continue with email（下面一个邮箱输入框）。没有密码框，没有「Forgot password?」，没有第二个「注册」页。
   - 按 Google：跳到 Google 选账号 → 回来直接进产品。第一次来的人此刻账号与工作区已经建好，和老用户一样落在首页（或原本要去的深链）。
   - 按 email：输入邮箱 → 页面说「We sent a temporary login code to …」并给一个码输入框 → 邮件里有一个 **Log in** 按钮和一个 **6 位码**。点按钮：登录页打开、码已填好，按一次 Continue 就进去；或者手输 6 位码。第一次来的人此刻账号与工作区已经建好。
   - 举例：商家 Aisha 拿 Gmail 来，按 Google，十秒后已经在画布上；她的同事用公司邮箱，按 email、收码、输码，同样十秒。两个人都没有注册过任何东西。
2. **入口在哪里？（列全，含深链）**
   - `/login`（唯一的门；任何需要登录的深链都转到 `/login?from=<原地址>`，登录后回原地址；`from` 经 `apps/web/lib/safe-redirect.ts` 的 `sanitizeCallbackURL` 只接受站内相对路径）。登录墙本身是 `apps/web/proxy.ts`，由 `AUTH_ENABLED` 开关（生产默认开；非生产须显式 `AUTH_ENABLED=true`）——本地验收必须开着它。
   - 邮件里的登录链接：打开 `/login`，邮箱与码预填（码放在 URL 片段 `#` 里，不进服务器日志、不随 Referer 外泄），商家按一次 Continue。
   - `/signup` → 永久转到 `/login`（旧链接不能断）。`/forgot-password`、`/reset-password` → 下线（转到 `/login`）。
   - Google Cloud 端（外部系统，冻结前由 Founder 或执行者在控制台核一次，不当既定事实）：OAuth 用户端「FIKIRTIVE」发布状态「正式发布 · 对外」，回跳网址含 production 与 staging 两条。2026-09-08 已在 Founder 登录的控制台里看过一次，仓库无法证明。
3. **四态：空、加载、错误、成功各长什么样？**
   - 空：登录页两扇门。若「暂停新注册」开关打开，页顶多一条横幅：「New signups are paused right now. Existing accounts can still log in.」
   - 加载：按钮文案变 Sending… / Signing in… / Redirecting…（沿用现有）。
   - 错误：码错或过期 →「That code didn't work. Check the email or send a new one.」；一小时内第 6 次要码 →「Too many codes requested. Try again in an hour.」；Google 取消、失败、或 Google 报该邮箱未验证 → **回到 `/login`** 并提示「Google sign-in didn't complete. Try again or use email.」。被撤销的邮箱、暂停期间的陌生邮箱：页面反应与「码错」完全一致，不说明原因（防枚举）。**任何拒绝都不得落在 better-auth 自带的错误页或裸 JSON 上**（今天 Google 门的拒绝正是这两种，见 §1.4）。
   - 成功：进 `from` 或首页。首登与老用户看到的是同一个首页，没有新手引导页（Founder 2026-09-08 裁决：不抄 Linear 的引导页）。
4. **数据从哪来、写到哪去？**（下列行号以 main `0e1f2ab3` 为准，2026-09-08 研究员四份事实册交叉核验）
   - better-auth 自带表：`BetterAuthUser` / `BetterAuthAccount` / `BetterAuthSession` / `BetterAuthVerification`（`packages/db/prisma/schema.prisma:1304-1353`）。
   - **码门建号时机**：better-auth 的 `emailOTP` 插件在验码成功那一刻为陌生邮箱建用户，`emailVerified: true`（`better-auth/dist/plugins/email-otp/routes.mjs:404-409`；我们没设 `disableSignUp`，库本来就允许）。今天拦住陌生人的是我们自己的三处名单检查：前门中间件（`apps/web/lib/better-auth/server.ts:307-309`）、寄码钩子（`server.ts:495`）、寄信队列（`apps/web/lib/better-auth/sender.ts:481`）。本规格把这三处的判定统一收窄为「已撤销 → 拒；暂停中且从未登录过 → 拒；其余放行」。
   - **Google 门建号时机**：回调一次请求内完成建号＋建会话（`better-auth/dist/oauth2/link-account.mjs:29-40, :126`）。今天拦住陌生人的是 `databaseHooks.user.create.before` 里的 `assertAllowedEmail`（`server.ts:359`）与 `session.create.before`（`server.ts:375`）。**实现陷阱（两名研究员各自实跑证实）**：数据库钩子里读到的 `ctx.path` 是路由模板字面量 `"/callback/:id"`，不是 `"/callback/google"`；供应商名只能从 `ctx.params.id` 取，缺失时 fail closed。写成 `"/callback/google"` 的判定永远不会触发，而 grep 字符串的测试还是绿的。
   - **Google 账号合并**：`accountLinking: { enabled: true, trustedProviders: ["google"], requireLocalEmailVerified: true }`（`server.ts:86-92`）。码门建的用户 `emailVerified = true`，所以同邮箱之后按 Google 会合并到同一个用户（`link-account.mjs:17-40`），这就是 SIGNIN-A3 成立的机制。密码下线后不再存在「未验证的本地账号」，`account_not_linked` 死胡同随之消失。
   - **Google 的邮箱验证声明今天根本没人看**：`trustedProviders: ["google"]` 让库跳过 `userInfo.emailVerified` 的检查（`better-auth/dist/oauth2/link-account.mjs:20-22`），而 `server.ts:90` 的注释却说它在检查。本规格要求把 `"google"` 从 `trustedProviders` 移除（保留 `enabled` 与 `requireLocalEmailVerified`），让库真的校验该声明，并删掉那句注释。
   - **Google 报 `email_verified: false`**（透传自 `@better-auth/core/dist/social-providers/google.mjs:97`）：按现码会建出一个 `emailVerified=false`、没有租户、也收不到验证信的孤儿用户（`apps/web/lib/better-auth/converge.ts:35` 早退；`emailVerification.sendOnSignUp` 未配置）。本规格要求：**这种 Google 账号一律拒绝并回登录页提示改用 email**（SIGNIN-A13）。Google 现实中何时会给 false 仓库无法验证，按 fail closed 处理。
   - **拒绝如何回到登录页**：今天 `LoginForm.tsx:214-217` 调 `signIn.social` 不传 `errorCallbackURL`，闸 1 的拒绝落在 better-auth 自带错误页（`/api/better-auth/error?error=…`），闸 2 的拒绝是没有 Location 的 403 JSON（研究员端到端探针实测；`gate.ts:10` 抛的 `APIError` 没有 `code` 字段，`callback.mjs:153-156` 的守卫因此不转重定向）。本规格要求传 `errorCallbackURL: "/login"` 并把 `app/login/page.tsx:15-20` 的错误映射改成实际会出现的键（SIGNIN-A14）。
   - 「注册即邀请」沿用 #543：第一次成功登录（两扇门都算）把邮箱写进 `AllowedEmail`（status active，invitedBy 标明来源门；`apps/web/lib/signup-gate.ts:39-46`），`revoked` 行永不复活（`skipDuplicates`）。邮箱归一化必须与 `signup-gate.ts:40` 同款 `trim().toLowerCase()`——`AllowedEmail.email` 没有大小写不敏感的唯一约束（`schema.prisma:850-856`，长期修法挂 #578）。
   - 首登副作用沿用现有 `convergeIdentity`（`server.ts:366` user.create.after → `converge.ts`）→ `bootstrapPersonalOrg`（`apps/web/lib/auth-guard.ts:207`）：确定性 `org_<userId>`、Membership、`grantCreditsTx(SIGNUP_GRANT_CREDITS, idempotencyKey: signup:<orgId>)`、`seedActorLibrary`。赠金一人一次由数据库唯一约束保证（`schema.prisma:909`），与登录方式无关。**工作区名**：现行规则「没收集店铺名的门，工作区就没有名字」（`auth-guard.ts:249-256, :272`）；Google 会把个人姓名带进 `User.name`，若不处理工作区会以人名命名。本规格定：**两扇门首登的工作区名一律为空**，商家在设置页填店铺名（SIGNIN-A10）。
   - **事务事实**：`prismaAdapter` 未开 `transaction`（`server.ts:79`），建号中途失败会留下孤儿 `BetterAuthUser` 行。本规格要求「同一邮箱再试一次能成功、库里只有一个用户」（SIGNIN-A15），不要求原子性。
   - 密码凭据退役：`BetterAuthAccount` 中 `providerId = "credential"`（better-auth 给密码凭据的固定标记，`better-auth/dist/api/routes/password.mjs:154`）的行由一条 prisma 迁移删除（零正式用户，Founder 2026-08-01；只影响测试账号），fresh-database 验证通过。`emailAndPassword.enabled` 改 false，`HOURLY_PUBLIC_DOORS`（`apps/web/lib/public-auth-doors.ts:33-37`）里的密码门一并撤下。
5. **碰不碰钱路？** 只碰赠金的**幂等键**，不碰金额与计费。今天一人一工作区一笔 `SIGNUP_GRANT_CREDITS`（`packages/core/src/spend.ts:582`，键 `signup:<orgId>`），而码门对陌生人打开后，`me+001@gmail.com`、`me+002@gmail.com` 都落进同一个真实邮箱，每个号都能领——1000 个号约等于 25,000 点、约 875 美元的真实供应商花费（审计 [3]，P1）。本规格要求：赠金幂等键改按「归一化邮箱」算（去掉 `+tag`，gmail 去点），再叠一个全站每小时新账号上限＋告警（SIGNIN-A17）。Turnstile 之类的人机验证不在本规格，登记 DEFERRED。验收里的金额一律写常量名，不写死数字。
6. **权限与租户边界是什么？**
   - 租户身份只来自服务端会话；回跳地址只接受站内相对路径（`apps/web/lib/safe-redirect.ts`，现有）。
   - 门的判定顺序（两扇门一致，三处名单检查同一函数）：① `SIGNUPS_PAUSED` 打开且邮箱从未登录过 → 拒；② `AllowedEmail.status = revoked` → 拒；③ 其余放行并建账号。`FOUNDER_ADMIN_EMAILS` 的超管种子逻辑不变。deny-by-default 的口径从「不在名单一律拒」收窄为「未撤销＋未暂停即放行」，撤销仍然绝对。
   - 撤销：操作员把某邮箱标 `revoked` 后，两扇门都进不来，**而且他手上已登录的会话在同一事务里被删除**（照 `apps/web/lib/tenant-actions.ts:54` 的写法）。今天的撤销只删名单不删会话，旧 cookie 还能打 `/api/better-auth/*` 最长 7 天（审计 [5]）。后台的「撤销」按钮今天只认 `status = invited` 的行（`tenant-actions.ts:164`），两扇门写入的都是 `active`，所以必须放宽到 `status ≠ revoked`，否则自助进来的地址永远撤不掉（审计 [6]）。
   - `AllowedEmail` 从此只有两个含义：「已证明拥有该邮箱的人」（两扇门在验证之后才写入）与 `revoked` 黑名单；它不再是邀请名单（审计 [24]）。
   - Google 回调是 GET，不在每小时配额之内（`apps/web/app/api/better-auth/[...all]/route.ts:24` 裸转发）；它由 Google 那关把守，本规格接受。
7. **参考对照：抄哪家？**
   - Linear 登录流（同一扇门、Google／Email 登录链接＋手输码、无密码）：https://mobbin.com/flows/2b9e0315-3654-482e-b877-f8da3736939f
   - Notion（先发码、验证后才能设密码，本规格不做密码）：https://mobbin.com/flows/7a12675f-80fc-4608-9feb-7ec412cf55c5
   - Slack（Google／Apple 或 6 位码，密码只是次要路径）：https://mobbin.com/flows/73ce2adc-fbee-4d1d-a200-6997380b12b5
   - 三家共同点：先证明邮箱是你的，才允许任何凭据存在。
8. **胃口：轻／中／重挡，为什么？**
   - 重挡：碰登录边界（M1 路径地板 `scripts/ci/process-gates.sh:39` 命中 `auth`），且退役一套实现（密码门）。实现 PR 必须引用本规格，不可能走轻改。
   - 胃口两天（含测试与 E2E 旅程）。超过就先砍「邮件里的登录链接」，只留 6 位码（Linear 的「Enter code manually」本来就是等价路径），其余不砍。
   - **上游依赖**：`docs/specs/frontend-baseline.md`（已冻结 · v1）§1 把「邮箱密码、忘记/重置」列为既有 Auth 能力，FRONT-A2 的验收旅程含密码注册与重置。本规格落地会让 FRONT-A2 原旅程不复存在：实现 PR 同时在 frontend-baseline.md §5 变更登记写一行（指向本规格），FRONT-A2 在下次 S5 按本规格 A1/A4 改写；不改冻结正文。
9. **Otto 怎么协助这个功能？** 不适用（登录发生在 Otto 之前）。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| SIGNIN-A1 | 一个从未出现过的邮箱：登录页按 Continue with email，收邮件，手输 6 位码 | 直接进产品；账号与工作区已建立；全程没有出现第二个页面叫注册 |
| SIGNIN-A2 | 一个从未出现过的 Google 账号：按 Continue with Google，选账号 | 直接进产品；账号与工作区已建立 |
| SIGNIN-A3 | 先用码登录过的邮箱，改用同邮箱的 Google 登录；再反过来 | 进的是同一个账号、同一个工作区；数据库里只有一个用户、一个工作区 |
| SIGNIN-A4 | 走访 `/signup`、`/forgot-password`、`/reset-password`，并查看登录页 | 三个地址都回到 `/login`；登录页没有密码框、没有 Forgot password；对公网请求 `/sign-up/email`、`/sign-in/email`、`/forget-password`、`/reset-password`、`/change-password`、`/set-password`、`/request-password-reset` 一律 404 |
| SIGNIN-A5 | 点邮件里的 Log in 按钮 | 登录页打开、码已填好，按一次 Continue 即登录；同一封邮件的链接第二次点无效；15 分钟后无效 |
| SIGNIN-A6 | 打开「暂停新注册」开关（`SIGNUPS_PAUSED=1`）后：陌生邮箱按 email、陌生 Google 按 Google；老用户照常登录 | 页顶横幅说明暂停；陌生人两扇门都进不来、不建账号、不寄码；老用户正常进入 |
| SIGNIN-A7 | 操作员在后台把一个**自助进来**的邮箱撤销（它此时已登录），该邮箱再分别走两扇门 | 后台能撤（不再回「No pending invite」）；他原来的登录下一次请求即失效；两扇门都进不来；页面反应与输错码一模一样，不说明原因 |
| SIGNIN-A8 | 同一邮箱一小时内要 6 次码；拿一个码连错 4 次 | 第 6 次被拒并提示一小时后再试；第 4 次要求重新发码；对陌生邮箱与老邮箱的响应时间与文案一致 |
| SIGNIN-A9 | 查数据库 | `BetterAuthAccount` 里 `providerId = "credential"` 的行数为 0；fresh database 跑完全部迁移无错 |
| SIGNIN-A10 | 用同一份测试脚本分别经 Google 与码建两个新账号 | 工作区名都为空（等商家在设置页填店铺名）、赠金都恰好一笔 `SIGNUP_GRANT_CREDITS`（幂等键 `signup:<orgId>`）、`emailVerified = true`、AllowedEmail 都是 status active，只差来源门标记；登录审计各恰好一行 |
| SIGNIN-A11 | 走查登录页与全部公网 auth 端点，尝试用任何方式设置密码 | 没有任何途径能建立密码；上线闸 GATE-A8 与 #980 的攻击顺序从此不可能 |
| SIGNIN-A12 | 端到端旅程：陌生邮箱收码登录 → 生成一张图 → 登出 → 同邮箱 Google 登录 | 看到刚才那张图；始终是同一个工作区 |
| SIGNIN-A13 | 一个 Google 报「邮箱未验证」的账号按 Google | 回到 `/login` 提示改用 email；数据库里没有为它建任何用户行 |
| SIGNIN-A14 | 让 Google 门失败一次（取消授权、撤销邮箱、暂停期陌生人各一次） | 每次都回到 `/login` 页内提示；从不落在 better-auth 自带错误页，从不出现裸 JSON |
| SIGNIN-A15 | 让首登在建号中途失败一次（例如断开数据库连接），同一邮箱再登录一次 | 第二次成功进入；库里该邮箱只有一个用户、一个工作区、一笔赠金 |
| SIGNIN-A16 | 用 `Aisha@Example.com` 与 `aisha@example.com` 各登录一次 | 同一个账号；`AllowedEmail` 只有一行小写 |
| SIGNIN-A17 | 用 `me+001@gmail.com`、`me+002@gmail.com`…连开 30 个账号（脚本） | 赠金只发给第一个（幂等键按去掉 `+tag` 与点号变体后的邮箱算）；同一小时内全站新账号超过上限（默认 50）后第 51 个进不来并触发 Sentry 告警，老用户登录不受影响 |

## 3. 不做（非目标）

- **SAML SSO、Passkey**：Linear 的另外两个按钮。企业客户的身份提供商在 beta 没人用得上；触发条件＝第一家要求 SSO 的付费商家出现。
- **新手引导页**：不抄 Linear 的 Welcome／邀请同事流程；首登直接进产品（Founder 2026-09-08）。触发条件＝Founder 另立规格。
- **密码作为次要选项**（Slack 式）：不做；触发条件＝Founder 明示。
- **操作员邀请流**：`AllowedEmail` 的 invited 状态与后台邀请页维持现状，不在本规格内改。
- **邮箱变更流**：维持关闭（`CLOSED_EMAIL_OTP_PATHS`）。
- **登录审计、会话管理页、Resend 侧发信量告警**：不在本规格（告警登记 DEFERRED）。
- **`AllowedEmail.email` 的大小写不敏感唯一约束**（#578）：不在本规格；A16 只要求写侧归一化。
- **人机验证（Turnstile）**：不在本规格；触发条件＝A17 的每小时上限被真实流量撞到，或供应商账单出现异常。登记 DEFERRED。
- **会话与撤销基本盘**（登出所有设备、会话绝对上限与过期清理、撤销后的每请求复查、限流计数器故障告警、密钥强度门、验证码门的秒级泄洪闸、陌生人请求预算与地址发信预算解耦）：审计 [4][5][12][14][15][22][23]，另立规格或登记 DEFERRED（见 `docs/DEFERRED.md` D-087 起），本规格只做 A7 那一刀。

## 4. 异议栏

- **最大风险：码门对陌生人打开＝对外寄信面打开。** 任何人都能让我们往任意邮箱寄登录码。现有防线：每邮箱每小时 5 封（`apps/web/lib/better-auth/sender.ts:21`）、每个码最多试 3 次（`apps/web/lib/better-auth/server.ts:427`）、每来源限流。仍建议上线前在 Resend 侧设每日发信量告警（登记 DEFERRED，不在本规格）。Linear／Slack 同样对外开码门，这是行业常态而非我们独有。
- **实现差异（已选）**：Linear 的邮件链接点开即登录；本规格改为「链接打开登录页、码预填、按一次 Continue」。理由：企业邮箱的安全扫描器会预先打开邮件里的链接，「点开即登录」会被扫描器消耗掉甚至替它登录；多按一次的代价换来链接不会被机器人用掉。若 Founder 坚持一模一样，改回即可，验收表 A5 相应改写。
- **去密码＝账号安全等于邮箱安全**：这是 Linear 的既有取舍；我们没有比 Linear 更强的理由保留密码。
- **残余风险（已知、未在本规格修）**：知道某商家邮箱的人，可以在一小时内替他要满 5 个码、再猜错 3 次，让他这一小时进不来（审计 [12]，发信预算按地址计、猜错次数按邮箱计）。Linear／Slack 的码门同样暴露于此；修法（陌生人预算与地址预算分开、猜错次数绑定来访者）登记 DEFERRED，触发条件＝第一个真实商家开始用码门。
- **工作区名取空而不取 Google 姓名**（§1.4）：这是我替 Founder 做的取舍，理由是店铺名≠人名，且与现行 #680 规则一致；Founder 若要「先用 Google 姓名占位」，改 A10 一行即可。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-09-10 | **PR #1336：密码退役之后 `SIGNUPS_PAUSED` 成了一个没人调的开关**。`apps/web/lib/signup-gate.ts` 的 `signupsPaused()` 与 `admitSelfSignup()` 今天全仓零调用点——它们原来只挂在密码注册那扇门上（`lib/better-auth/server.ts` 的 `isSelfSignupPath`，逐字比对 `/sign-up/email`；外加 `/signup` 页顶的暂停横幅），门退役，钩子随之删除。验收 A6 描述的行为因此暂时无处落地，登录门④（#1319）会把它重新接到两扇活门（码门与 Google 门）上。同一段时间里**没有自助注册路径**：`admitSelfSignup` 不再被调用，能建账号的只剩名单内邮箱（`AUTH_ALLOWED_EMAILS` / `FOUNDER_ADMIN_EMAILS` / `AllowedEmail` 里的 active 行），登录门②（#1318）开码门之后恢复。这两件事都是切片顺序造成的中间态，不是行为裁决，写在这里让下一个人不用重新推一遍。 |  |
| 2026-09-10 | **PR #1336：A9 那条删行迁移在本仓库是「合并即执行」**。推 `main` 自动部署，容器每次启动在 serve 之前跑一次 `prisma migrate deploy`（`apps/web/Dockerfile` → `apps/web/scripts/boot.mjs` 的 `runMigrations`），`.github/workflows/` 里没有任何 deploy workflow，也没有 environment required reviewer。链条是 merge → deploy → boot → `DELETE`，中间没有一步等人——所以**Founder 对这一次删除的确认必须发生在合并之前**，否则永远不会发生。`DESTRUCTIVE-OK` 只让 `scripts/check-destructive-migrations.sh` 放行，它过的是 CI 扫描闸，不是批准。 |  |
| 2026-09-10 | **登录门②：A17 的赠金去重键写不进 `CreditLedger`，需要它自己的唯一约束**。§1.5 写「赠金幂等键改按归一化邮箱算」，而 `CreditLedger` 的唯一约束是 `(orgId, idempotencyKey)`（`schema.prisma` `@@unique([orgId, idempotencyKey])`）——`me+001@gmail.com` 与 `me+002@gmail.com` 是两个用户、两个 org，那条约束的**另一半已经不同**，所以幂等键写成什么字符串都拦不住第二笔赠金。落地方式因此是一张新表 `SignupGrantClaim`：主键就是归一化邮箱（`@fikirtive/core` 的 `canonicalGrantEmail`，去 `+tag`、gmail 去点），在开户那笔事务里 `INSERT … ON CONFLICT DO NOTHING`，抢到的 org 发赠金。A10 那句「幂等键 `signup:<orgId>`」原样保留并仍在测试里逐字断言（换那条键会让**每一个既有 org** 下次登录再领一笔）。行为与 A17、A10 逐字一致，改的只是「这条唯一性住在哪张表」。 |  |
| 2026-09-10 | **登录门②：A8 的每小时上限从 `(来访者, 地址)` 改成 `(地址)`**。验收表说「同一**邮箱**一小时 6 次码上限」，而 `signin-code-request.ts` 原来的桶是 `(caller, email)`：换一个出口地址就买回一份新的五次，公布的数字从来不是这道闸执行的数字（真正按地址计的那道在寄信队列里，跑在背景、说不出话）。规则搬到门上、按邮箱计之后，「第 6 次被拒并提示一小时后再试」才有地方说出口。同时 `rate_limited` 从「不许存在的答案」改判为可以说：#678 禁它的理由是「码门只放行名单内的地址 ⇒ 限流 = 有账号」，码门对陌生人打开之后那个等号不成立。关于**地址本身**的两种拒绝（撤销、暂停期陌生人）仍然沉默，页面反应与「码错」一致。 |  |
| 2026-09-10 | **登录门②：`enqueueAuthEmail` 成为地址归一化的唯一上游**。emailOTP 的寄码路由按原样写 verification 的 identifier，而验码路由自己 `toLowerCase()`——一个大写地址会铸出一个永远验不掉的码。以前靠每个调用者先小写（请求路径确实做了），队列下游三处读同一个地址却各有各的归一口径。归一化因此落在进队列那一刻，一次，对所有调用者（A16）。 |  |
| 2026-09-10 | **登录门②：A10 的「工作区名为空」改为不再读 `User.name`**。#680 的实现是 `workspaceName = User.name`，对码门是空串所以一直看起来对；Google 门会把**个人姓名**写进那个字段，同一段代码给同一件事写出两种结果。§1.4 已拍板「两扇门首登的工作区名一律为空」，实现改成常量空串（`auth-guard.ts`）。落点在 `apps/web/lib/auth-guard.ts` —— 它不在 #1317 票面写集的文件清单里，但票面明写要交付 A10/A17，而这两条的唯一落点就是 `bootstrapPersonalOrg`；改动限于两处（工作区名、赠金前的 claim 判定）。 |  |
| 2026-09-10 | **登录门②：邮件验证链（`/verify-email` 与 `sendVerificationEmail`）在密码退役后仍然无人可达**（登录门① 判官 P2，本片未退役，按票面要求登记）。现状核对：`emailVerification.sendVerificationEmail` 仍配在 `lib/better-auth/server.ts`，`app/verify-email/` 页面仍在，`sender.ts` 的 `verify-email` 队列分支仍在；而**没有任何产品路径会触发它**——密码注册退役之后 `sendOnSignUp` 未配置，码门与 Google 门建号时 `emailVerified` 直接为 true。`HOURLY_PUBLIC_DOORS` 里那道 `/send-verification-email` 因此也守着一扇没人走的门。不在本片退役的理由：它跨 `app/verify-email/**` 与 `lib/email/**` 的多处，属于清理而非本片验收，且退役与否会影响 A9/A11 的围栏面。建议由登录门⑤（端到端旅程）或一张独立整理票处置：要么整条退役，要么写明它未来的用途（例如商家改邮箱）。 |  |
| 2026-09-10 | **PR #1336：Auth 设计夹具仍含密码屏，生产已退役**。`apps/web/design-system/patterns/auth/AuthAccessJourneyReference.tsx` 还画着密码屏、「Use password instead」「Forgot password?」与「Create an account」，生产侧这三样已随本 PR 退役，夹具与生产因此分歧。夹具改动归设计治理（`apps/web/design-system/governance/frontend-integration-handoff.md`），不在本切片的写集内，待下次设计侧同步；它在 A11 源码围栏里是具名白名单（那两处 `setPassword(...)` 调用全是 React `useState` 的 setter，一行都碰不到 Better Auth）。 |  |
| 2026-09-11 | **登录门④：后台那颗「撤销」按钮还没换到新动作上**。本片把撤销的领域动作落在 `apps/web/lib/signup-gate.ts` 的 `revokeEmailAccess`（谓词 `status ≠ revoked`，名单翻面与切断会话同一笔事务），操作员入口是 `apps/web/app/admin/access-actions.ts` 的 `revokeMerchantAccess`（`requireRole("tenants","mutate")` ＋ 审计行）。**后台界面上那颗按钮仍然调旧的 `revokeTenantInvite`**，所以在界面上撤一个自助进来的地址仍会回「No pending invite for that address.」。差的是两处：`components/admin/AdminDashboardV2.tsx` 换一个 import，`lib/tenant-actions.ts` 让 `revokeTenantInvite` 转调新动作（它多守的那条「地址已属于某工作区就别用邀请工具管他」的前置条件，对本动作恰恰是要撤的对象，需一并去掉）。两个文件都不在 #1319 的写集内，故登记而不动手。A7 的服务端半边（撤得掉、会话当场失效、两扇门都拒、双租户）已有真库测试。 |  |
| 2026-09-11 | **登录门④：A6 的「页顶横幅」未落地**。§1.3 要求开关打开时登录页顶挂一条「New signups are paused right now. Existing accounts can still log in.」，落点是 `apps/web/app/login/page.tsx`（文案常量 `SIGNUPS_PAUSED_MESSAGE` 已在 `lib/signup-gate.ts`）。登录页不在 #1319 的写集内（票面明写「Google 那扇的 UI 提示交给③的映射表」），A6 的门那一半（两扇门都拦、不建账号、不寄码、老用户照进）已有真库测试。建议由登录门③（它本来就要改 `app/login/page.tsx` 的错误映射表）顺手接上。 |  |
| 2026-09-11 | **登录门④：`FOUNDER_ADMIN_EMAILS` 仍然先于数据库，与「撤销仍然绝对」有张力**。本片把 `AUTH_ALLOWED_EMAILS` 的短路拆掉了（判官在登录门② 抓到的那一刀：环境名单命中就不查撤销，于是写在那个变量里的地址撤了等于没撤；`lib/signup-gate.ts` 与 `lib/allowlist.ts` 两处同改，负例测试逐字钉住）。**founder 那一条没动**：它是破窗锤，一行数据库记录不该能把部署者锁在自己的产品外面（这条例外自 #543 起就在）。§1.6 写的是「撤销仍然绝对」，字面上不留例外，所以这条张力放在这里等 S5 裁一句：要么承认 founder 例外并写进 §1.6，要么连 founder 也可撤（那就必须同时给一条不经数据库的恢复路径）。 |  |

## 6. 改签记录

- 2026-09-08 起草前：Founder 先裁四条（只开 Google／Google 登入并作废未验证密码／一个开关关所有门／首登直进产品），同日改令「直接和 Linear 一模一样，不用那么麻烦」，并选「两扇门，去掉密码」。本稿按后者；「一个开关关所有门」与「首登直进产品」两条保留，其余两条因密码下线而作废。#1260 票面同步改题。
- 2026-09-08 研究回填：四份事实册（better-auth 语义／现行闸与测试／历史与规格／首登副作用）经独立核验后并入 §1.4，新增 A13–A16。#980 与 GATE-A8 的处置方向由「作废密码」改为「密码整体下线」，#980 待本规格交付后关闭；`docs/DEFERRED.md` 此前并未登记 #980，实现 PR 一并补登记或关闭。
- 2026-09-08 审计回填：登录逻辑审计（6 个角度、99 名 agent、25 条证实／8 条驳回）并入：A7 加撤销删会话与后台可撤 active 行、新增 A17 反刷号、§1.4 加 Google 邮箱验证声明的真检查、§3/§4 登记残余项。25 条中 9 条因密码或注册页下线自然消失、9 条由本规格覆盖、6 条登记 DEFERRED（D-087 起）；开放跳转一条（审计 [11]）作轻改单独修（PR #1262），不进本规格。
