# 登录门（照 Linear 模型）规格书（S1）

> 状态: 草稿
> 批准: （冻结时填）https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1260 Founder 评论「S1 批准 sign-in.md」(YYYY-MM-DD)
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
   - `/login`（唯一的门；任何需要登录的深链都转到 `/login?from=<原地址>`，登录后回原地址；`from` 经 `apps/web/lib/safe-redirect.ts` 的 `sanitizeCallbackURL` 只接受站内相对路径）。
   - 邮件里的登录链接：打开 `/login`，邮箱与码预填（码放在 URL 片段 `#` 里，不进服务器日志、不随 Referer 外泄），商家按一次 Continue。
   - `/signup` → 永久转到 `/login`（旧链接不能断）。`/forgot-password`、`/reset-password` → 下线（转到 `/login`）。
   - Google Cloud 端：OAuth 用户端「FIKIRTIVE」已是「正式发布 · 对外」，production 与 staging 两条回跳网址已登记（2026-09-08 实查）。
3. **四态：空、加载、错误、成功各长什么样？**
   - 空：登录页两扇门。若「暂停新注册」开关打开，页顶多一条横幅：「New signups are paused right now. Existing accounts can still log in.」
   - 加载：按钮文案变 Sending… / Signing in… / Redirecting…（沿用现有）。
   - 错误：码错或过期 →「That code didn't work. Check the email or send a new one.」；一小时内第 6 次要码 →「Too many codes requested. Try again in an hour.」；Google 取消或失败 → 回登录页并提示「Google sign-in didn't complete. Try again or use email.」。被撤销的邮箱、暂停期间的陌生邮箱：页面反应与「码错」完全一致，不说明原因（防枚举）。
   - 成功：进 callbackURL 或首页。首登与老用户看到的是同一个首页，没有新手引导页（Founder 2026-09-08 裁决：不抄 Linear 的引导页）。
4. **数据从哪来、写到哪去？**
   - better-auth 自带表（`BetterAuthUser` / `BetterAuthAccount` / `BetterAuthSession` / `BetterAuthVerification`，`packages/db/prisma/schema.prisma`）。
   - 「注册即邀请」沿用 #543：第一次成功登录（两扇门都算）把邮箱写进 `AllowedEmail`（status active，invitedBy 标明来源门），`revoked` 行永不复活（`skipDuplicates`）。
   - 首登副作用沿用现有 `convergeIdentity`（`apps/web/lib/better-auth/server.ts` user.create.after）：建 User／工作区／成员关系；两扇门必须产生一模一样的结果（SIGNIN-A10）。
   - 密码凭据退役：`BetterAuthAccount` 中 `providerId = "credential"`（better-auth 给密码凭据的固定标记，`better-auth/dist/api/routes/password.mjs:154`）的行由一条 prisma 迁移删除（零正式用户，Founder 2026-08-01；只影响测试账号），fresh-database 验证通过。
5. **碰不碰钱路？** 不碰。若现有首登有赠送额度，它的幂等键必须只认用户身份、不认登录方式（SIGNIN-A10 覆盖）；本规格不新增、不修改任何计费。
6. **权限与租户边界是什么？**
   - 租户身份只来自服务端会话；回跳地址只接受站内相对路径（`apps/web/lib/safe-redirect.ts`，现有）。
   - 门的判定顺序（两扇门一致）：① `SIGNUPS_PAUSED` 打开且邮箱从未登录过 → 拒；② `AllowedEmail.status = revoked` → 拒；③ 其余放行并建账号。`FOUNDER_ADMIN_EMAILS` 的超管种子逻辑不变。
   - 撤销：操作员把某邮箱标 `revoked` 后，两扇门都进不来（会话层的既有 fail-closed 检查不动）。
7. **参考对照：抄哪家？**
   - Linear 登录流（同一扇门、Google／Email 登录链接＋手输码、无密码）：https://mobbin.com/flows/2b9e0315-3654-482e-b877-f8da3736939f
   - Notion（先发码、验证后才能设密码，本规格不做密码）：https://mobbin.com/flows/7a12675f-80fc-4608-9feb-7ec412cf55c5
   - Slack（Google／Apple 或 6 位码，密码只是次要路径）：https://mobbin.com/flows/73ce2adc-fbee-4d1d-a200-6997380b12b5
   - 三家共同点：先证明邮箱是你的，才允许任何凭据存在。
8. **胃口：轻／中／重挡，为什么？**
   - 重挡：碰登录边界，且退役一套实现（密码门）。
   - 胃口两天（含测试与 E2E 旅程）。超过就先砍「邮件里的登录链接」，只留 6 位码（Linear 的「Enter code manually」本来就是等价路径），其余不砍。
9. **Otto 怎么协助这个功能？** 不适用（登录发生在 Otto 之前）。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| SIGNIN-A1 | 一个从未出现过的邮箱：登录页按 Continue with email，收邮件，手输 6 位码 | 直接进产品；账号与工作区已建立；全程没有出现第二个页面叫注册 |
| SIGNIN-A2 | 一个从未出现过的 Google 账号：按 Continue with Google，选账号 | 直接进产品；账号与工作区已建立 |
| SIGNIN-A3 | 先用码登录过的邮箱，改用同邮箱的 Google 登录；再反过来 | 进的是同一个账号、同一个工作区；数据库里只有一个用户、一个工作区 |
| SIGNIN-A4 | 走访 `/signup`、`/forgot-password`、`/reset-password`，并查看登录页 | 三个地址都回到 `/login`；登录页没有密码框、没有 Forgot password；对公网请求 `/sign-up/email`、`/sign-in/email`、`/forget-password`、`/reset-password`、`/change-password`、`/set-password` 一律 404 |
| SIGNIN-A5 | 点邮件里的 Log in 按钮 | 登录页打开、码已填好，按一次 Continue 即登录；同一封邮件的链接第二次点无效；15 分钟后无效 |
| SIGNIN-A6 | 打开「暂停新注册」开关（`SIGNUPS_PAUSED=1`）后：陌生邮箱按 email、陌生 Google 按 Google；老用户照常登录 | 页顶横幅说明暂停；陌生人两扇门都进不来、不建账号、不寄码；老用户正常进入 |
| SIGNIN-A7 | 操作员把某邮箱标 revoked，该邮箱分别走两扇门 | 都进不来；页面反应与输错码一模一样，不说明原因 |
| SIGNIN-A8 | 同一邮箱一小时内要 6 次码；拿一个码连错 4 次 | 第 6 次被拒并提示一小时后再试；第 4 次要求重新发码；对陌生邮箱与老邮箱的响应时间与文案一致 |
| SIGNIN-A9 | 查数据库 | `BetterAuthAccount` 里 `providerId = "credential"` 的行数为 0；fresh database 跑完全部迁移无错 |
| SIGNIN-A10 | 用同一份测试脚本分别经 Google 与码建两个新账号 | 工作区名规则、赠送额度（如有）、`emailVerified = true`、AllowedEmail 记录形状一模一样，只差来源门标记 |
| SIGNIN-A11 | 走查登录页与全部公网 auth 端点，尝试用任何方式设置密码 | 没有任何途径能建立密码；上线闸 GATE-A8 的攻击顺序从此不可能 |
| SIGNIN-A12 | 端到端旅程：陌生邮箱收码登录 → 生成一张图 → 登出 → 同邮箱 Google 登录 | 看到刚才那张图；始终是同一个工作区 |

## 3. 不做（非目标）

- **SAML SSO、Passkey**：Linear 的另外两个按钮。企业客户的身份提供商在 beta 没人用得上；触发条件＝第一家要求 SSO 的付费商家出现。
- **新手引导页**：不抄 Linear 的 Welcome／邀请同事流程；首登直接进产品（Founder 2026-09-08）。触发条件＝Founder 另立规格。
- **密码作为次要选项**（Slack 式）：不做；触发条件＝Founder 明示。
- **操作员邀请流**：`AllowedEmail` 的 invited 状态与后台邀请页维持现状，不在本规格内改。
- **邮箱变更流**：维持关闭（`CLOSED_EMAIL_OTP_PATHS`）。
- **登录审计、会话管理页**：不在本规格。

## 4. 异议栏

- **最大风险：码门对陌生人打开＝对外寄信面打开。** 任何人都能让我们往任意邮箱寄登录码。现有防线：每邮箱每小时 5 封（`apps/web/lib/better-auth/sender.ts:21`）、每个码最多试 3 次（`apps/web/lib/better-auth/server.ts:427`）、每来源限流。仍建议上线前在 Resend 侧设每日发信量告警（登记 DEFERRED，不在本规格）。Linear／Slack 同样对外开码门，这是行业常态而非我们独有。
- **实现差异（已选）**：Linear 的邮件链接点开即登录；本规格改为「链接打开登录页、码预填、按一次 Continue」。理由：企业邮箱的安全扫描器会预先打开邮件里的链接，「点开即登录」会被扫描器消耗掉甚至替它登录；多按一次的代价换来链接不会被机器人用掉。若 Founder 坚持一模一样，改回即可，验收表 A5 相应改写。
- **去密码＝账号安全等于邮箱安全**：这是 Linear 的既有取舍；我们没有比 Linear 更强的理由保留密码。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|

## 6. 改签记录

- 2026-09-08 起草前：Founder 先裁四条（只开 Google／Google 登入并作废未验证密码／一个开关关所有门／首登直进产品），同日改令「直接和 Linear 一模一样，不用那么麻烦」，并选「两扇门，去掉密码」。本稿按后者；「一个开关关所有门」与「首登直进产品」两条保留，其余两条因密码下线而作废。#1260 票面同步改题。
