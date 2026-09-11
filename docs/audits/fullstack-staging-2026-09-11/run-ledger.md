# Round 2 走查执行记录（run-ledger）

> 本文件是 W1 走查者的**现场记录**，不是结论。判定汇总见 `coverage-matrix.md`，问题见 `findings-catalog.md`，合成报告 `report-round2.md` 由后续 worker 写。
> 范围依据：`plan.md`（一字未改）。执行者：W1（终端 worker）。日期：2026-09-11（UTC）。

---

## §0 Preflight（plan.md §0 三件）

### P0-1 版本对齐 — PASS

`/api/health` 原文（UTC 2026-09-11T11:58:28Z）：

```
{"ok":true,"db":"up","worker":"up","workers":{"worker":"up"},"backup":"missing","migrations":"applied","build":{"sha":"2a96750e","ref":"main"}}
```

`/api/ready` 原文（UTC 2026-09-11T11:58:29Z）：

```
{"ready":true,"db":"up","migrations":"applied"}
```

Railway 部署（project `b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`、environment staging）：

| service | deployment id | status | createdAt (UTC) | commitHash |
|---|---|---|---|---|
| web | 51f973fd-9f25-4928-8d9e-6f42105de442 | SUCCESS | 2026-09-11T11:39:15.367Z | 2a96750eb506f4419d06032494470a8d01d22972 |
| worker | 64417a88-b437-4583-a012-9d84f2eca3a3 | SUCCESS | 2026-09-11T11:39:15.367Z | 2a96750eb506f4419d06032494470a8d01d22972 |

结论：web 与 worker **同版**，且与 `/api/health` 的 `build.sha=2a96750e` 一致；与本走查 worktree 的基准 commit 相同。`"backup":"missing"` 照录（第一轮同现象，不在本轮范围）。

### P0-2 前置票状态 — 14/15 已上线，1 张未合并

`gh issue view` / `gh pr view` 现查（2026-09-11）：

| 票 | 状态 | 对应 PR | PR 状态 | merge commit | 在 2a96750e 祖先链 |
|---|---|---|---|---|---|
| #1310 Google 回调配置 | CLOSED | — | — | — | （配置类，无 PR） |
| #1316 登录门① | CLOSED | — | — | — | 上线（早于 #1347） |
| #1317 登录门② | CLOSED | — | — | — | 上线 |
| #1318 登录门③ | CLOSED | #1347 | MERGED 2026-09-11T04:34:41Z | 32ad40fa | YES |
| #1319 登录门④ | CLOSED | #1345 | MERGED 2026-09-11T11:39:13Z | 2a96750e | YES（即部署版本本身） |
| #1320 登录门⑤ | **OPEN** | #1349 | **OPEN** | — | NO |
| #1321 Brand① | CLOSED | — | — | — | 上线 |
| #1322 Brand② | CLOSED | #1343 | MERGED 2026-09-11T02:46:56Z | d6c5e247 | YES |
| #1323 Brand③ | CLOSED | #1346 | MERGED 2026-09-11T04:51:07Z | bbce50b6 | YES |
| #1324 Creation① | CLOSED | #1341 | MERGED 2026-09-11T04:19:22Z | bce42f89 | YES |
| #1325 Creation② | CLOSED | #1340 | MERGED 2026-09-11T05:26:38Z | 04fe588a | YES |
| #1326 Creation③ | CLOSED | — | — | — | 上线 |
| #1327 Creation④ | CLOSED | — | — | — | 上线 |
| #1328 Creation⑤ | CLOSED | — | — | — | 上线 |
| #1329 Creation⑥ | CLOSED | #1342 | MERGED 2026-09-11T04:08:20Z | 857dcdd0 | YES |

祖先链核对：`git merge-base --is-ancestor <merge-commit> 2a96750e` → 7/7 YES。

**计划表已过期的两行**（plan.md §1.2 记的是写计划当时的状态）：#1340（Creation②）与 #1345（登录门④）计划里写 `OPEN`，现查均已 MERGED 并随本次部署上线 → R2-12 与 R2-05 **可执行**，不标 `NOT RUN（未部署）`。
**仍未上线的一张**：#1349（登录门⑤）OPEN → 按派工口径，R2-03 排到**最后**执行，执行前重查 PR 状态与 `/api/health` 的 sha。

### P0-3 环境边界复述

| 边界 | 现查事实 | 与第一轮的差别 |
|---|---|---|
| 素材存储 | staging `R2_BUCKET=fikirtive-staging`；production `R2_BUCKET=fikirtive-production`；两边 `STORAGE_DRIVER=r2` | **第一轮 ENV-01「与 production 共享素材存储」在本轮已不成立**（两个桶名不同）。Founder 本轮给的共享存储豁免因此用不上；仍照 Founder 令执行：上传文件名一律前缀 `r2-20260911-`、走完列清单、不删任何素材 |
| provider 路由 | `COWORK_PROVIDER=fal`、`COWORK_PAID_PROVIDERS_ALLOWED=true`、`OTTO_DEFAULT_VIDEO_MODEL=seedance-2-mini` | 与第一轮 ENV-02 同形状（付费 provider 已放行＝真引擎会真花钱） |
| 备份 | `/api/health` → `"backup":"missing"` | 与第一轮同（不在本轮范围，照录） |
| `E2E_GOOGLE_DOOR_STUB` | staging web **未设置**（51 个变量里无此键） | plan.md §1.2 口径②满足：Google 门结论不因替身失效，不标 BLOCKED |
| `SIGNUPS_PAUSED` | staging web **未设置**（原值形状＝键不存在；还原＝删除该变量） | A6 需临时新增，走完立即删除还原 |
| 其它 | `AUTH_ENABLED=true`、`NORTHSTAR_PREVIEW=1`、`FIKIRTIVE_ENV_CONTRACT=warn`、`FOUNDER_ADMIN_EMAILS=tools@belcort.com`、`AUTH_ALLOWED_EMAILS` 有四个条目（含 `tools@belcort.com`） | — |

读变量方式：`railway variables -p … -e staging -s web --json`，只取键名与**非密钥**配置值；密钥类变量的值一律未读取、未落盘（临时 json 已 `rm`）。production 只读 `R2_BUCKET`／`STORAGE_DRIVER` 两格用于判 ENV-01，**未做任何写入**。

### 钱路换算口径（Founder 令：写常量名，不写死数字）

`packages/core/src/spend.ts`：`CREDITS_PER_USD`、`INTERNAL_PER_DISPLAY`、`SIGNUP_GRANT_CREDITS`、`displayCredits()`。
换算式：`USD = internalCredits / CREDITS_PER_USD`；`displayed = internalCredits / INTERNAL_PER_DISPLAY`；故 `USD = displayed × INTERNAL_PER_DISPLAY / CREDITS_PER_USD`。
本轮预算上限 USD 20（Founder 2026-09-11 #1330 评论），80% 停手报进度、100% 立停；逐笔登记见文末「§4 预算表」。

---

## 走查流水（按 plan.md §3.2 顺序，R2-03 最后）

（下文按条目追加。截图 `NN-短描述.png`，整屏 `screencapture -x`，视口尺寸逐条记。）

## §4 预算表（每一次花钱的动作一行）

| # | 时间(UTC) | 条目 | 动作 | 入口 | GenJob id | 报价(displayed credits) | ledger reserve | ledger settle/refund | 供应商成本快照(USD) | 结果 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | 尚未发生 | — | — | — | — | — | — | — | — |

累计商家侧扣费：0 displayed credits ＝ USD 0.00（换算式见上）。距 80% 停手线尚远。
### 走查方法说明（两处必须写明的偏差）

1. **截图落盘方式**：`screencapture` 在本机**没有 Screen Recording 权限**，抓出来的整屏只有桌面壁纸、没有任何窗口（已实测两次，`osascript` 同时确认 frontmost 是 Claude）。因此判定截图改用**无头 Chrome 真实渲染**：`Google Chrome --headless=new --window-size=1600,1000 --screenshot=<NN-*.png> <url>`，视口 1600×1000（满足 §3.4 的 ≥1440）。代价：无头一次只能拍「某个 URL 的首屏」，**点开菜单／确认卡／错误提示之后的中间态拍不到**。这些中间态的证据改为 **verbatim 页面文本**（`get_page_text` / `read_page` 原文抄进本 ledger）＋ 后端事实。哪几条判定因此缺图，逐条在 coverage-matrix 注明。
2. **点击方式**：Browser 面板实际显示区是 800×500，页面视口用模拟放到 1600×1000；在这个组合下合成鼠标点击（`computer left_click`，无论按 ref 还是按坐标）**落不到元素上**（实测点了 3 次登录页按钮无反应）。因此交互统一改为在页面里派发 `element.click()`（走的是同一套 React 事件处理器）与 `input` 事件。这是**工具侧**的坐标问题，不是被测应用的缺陷；凡「按钮点不动」一律不写成应用问题。

---

## R2-01 码门（SIGNIN-A1 / A5 / A16）

夹具 A：`tools+r2a20260911@belcort.com`。UTC 2026-09-11T12:08–12:13。视口 1600×1000。

**① 手输 6 位码（SIGNIN-A1）**
- `/login` 只有两个按钮：`Continue with email`、`Continue with Google`；**无密码框、无 Forgot password、无第二个叫注册的页面**（截图 `01-login-page-no-password.png`）。
- 输邮箱 → `Check your email / We sent a temporary login code to tools+r2a20260911@belcort.com.` → 邮件 20:09（MYT）到 Gmail。
- 手输码 → 直接进产品首页（`Home · Fikirtive`）。会话 `get-session` 回：`email=tools+r2a20260911@belcort.com`、`id=Cw7acC6L19JjvXt3NF6mshDxvNwWIqsX`、`emailVerified=true`、`name=""`、`createdAt=2026-09-11T12:09:22.703Z`。
- 判定：**PASS**（账号与工作区当场建立、全程一条路）。

**② 邮件里的 Log in 按钮（SIGNIN-A5 前半）**
- 邮件正文原话：`Sign in to Fikirtive with the code below. <6 位码> Log in — The button opens Fikirtive with this code already filled in — press Continue to finish. This code is valid for 15 minutes.`
- 按钮的 href 形状：`https://web-staging-7901.up.railway.app/login?step=code#email=<urlencoded>&code=<6 位码>`（码走 **URL fragment**，不进服务器请求行）。
- 在**全新标签页**打开该链接：六格码**已填好**，只有一个 `Continue with login code`（截图 `02-magic-link-code-prefilled.png`）；按一次即登录，进的是同一个 `id=Cw7acC6L…`。读完 hash 后地址栏里的 `#email…&code…` 被**清掉**。
- 注意（不是缺陷，但记一笔）：在**已经处于码步骤的旧标签页**里换 hash 再打开，码**不会**被填（组件不重挂载）。真实商家从邮件点进来永远是新标签页，故不登记。
- 判定：**PASS**。

**③ 同一封邮件的链接第二次点（SIGNIN-A5 中段）**
- 用同一个码再提交一次 → 页内红字原文：`Code not accepted` / `That code didn't work. Check it and try again, or send it again.` 未建立任何会话。
- 判定：**PASS**。

**④ 15 分钟后失效（SIGNIN-A5 末段）**
- 需要「发一个码 → 空等 ≥15 分钟 → 再用」。本轮按时间余量安排在最后；若未执行，如实标 `NOT RUN（未安排 15 分钟等待）`，不推定通过。

**SIGNIN-A16（大小写归一）**：需夹具 D 两次登录 + 查 `AllowedEmail` 只有一行小写。见后文。

---

## R2-04 密码面退役（SIGNIN-A4 / A11 前半 / A9 前半）

UTC 2026-09-11T12:15。命令与原文回执：

```
/signup            200 -> https://web-staging-7901.up.railway.app/login (redirects=1)
/forgot-password   200 -> https://web-staging-7901.up.railway.app/login (redirects=1)
/reset-password    200 -> https://web-staging-7901.up.railway.app/login (redirects=1)

/sign-up/email             POST=404  GET=404
/sign-in/email             POST=404  GET=404
/forget-password           POST=404  GET=404
/reset-password            POST=404  GET=404
/change-password           POST=404  GET=404
/set-password              POST=404  GET=404
/request-password-reset    POST=404  GET=404
```

- 三个地址各 **302 → `/login`**；七个公网 auth 端点 **GET 与 POST 都 404**。
- 登录页全貌见 `01-login-page-no-password.png`：没有密码框、没有 Forgot password、没有任何「设置密码」入口。
- `SIGNIN-A4` → **PASS**；`SIGNIN-A11` 前半（任何方式都建不起密码）→ **PASS**。
- `SIGNIN-A9` 前半（`BetterAuthAccount.providerId='credential'` 行数为 0）→ **PARTIAL（待后端取证）**：要 W2 跑 `SELECT count(*) FROM "BetterAuthAccount" WHERE "providerId"='credential';`，期望 0。
- `frontend-baseline §5 2026-09-10（FRONT-A2 退役）`的 `?from=/create` 落点：用 `/login?from=/create` 走码门 → 登录后**落在 `/create`**（实测，见下条 R2-03 记录）→ **PASS**。

---

## R2-02 / R2-03 Google 门（部分，受账号可用性限制）

UTC 2026-09-11T12:15–12:17。

**Google 门本身可用**：登出后按 `Continue with Google` → 浏览器里 Google 已登入 `tools@belcort.com`、**不再出现账号选择或授权页**（此前已授权）→ 直接回到产品首页。会话：`email=tools@belcort.com`、`id=pZMe1PRZdQvlsCID7OEmayF8JiKL1NMt`、`createdAt=2026-07-06T14:58:33.200Z`（**既有账号**，不是新建）。

**同邮箱两扇门 → 同一账号（SIGNIN-A3 的一个方向）**：紧接着登出，用**码门**输 `tools@belcort.com` → 收码 → 登录 → 会话仍是 `id=pZMe1PRZdQvlsCID7OEmayF8JiKL1NMt`、同一个工作区（余额与内容一致）。即 **Google 门与码门进的是同一个账号**，没有造出第二个用户或第二个工作区（商家可见层面）。
→ `SIGNIN-A3` 标 **PARTIAL**：商家可见面通过；`BetterAuthUser` 只有一行、`Organization`／`Membership` 只有一套、`BetterAuthAccount` 有 google 与码门两条来源且 `userId` 相同，这四项要 W2 查表确认。

**SIGNIN-A2（从未出现过的 Google 账号）**：本机浏览器只有 `tools@belcort.com` 一个 Google 身份，且**禁止创建账号**（外部边界）。没有第二个 Google 测试账号 → **NOT RUN（无可用陌生 Google 账号；Founder 未提供夹具 B）**。不得按「Google 门能用」推定通过。
**SIGNIN-A12（端到端：陌生邮箱收码 → 生成图 → 登出 → 同邮箱 Google 登录）**：同一原因 —— 需要一个既是陌生 Google 账号、又能收码的邮箱 → **NOT RUN（无夹具）**；另 PR #1349／票 #1320 本来就未上线（preflight P0-2）。

---

## 重大现象 A：新号开户赠金为 0（影响 SIGNIN-A10，牵动整条创作走查）

夹具 A 登录后：侧栏 `0 credits`；`/billing` 正文 `Available balance 0 credits`、`On hold: Nothing on hold`、`Spend history: No credit activity yet / Your first charge or top-up will appear here with its final amount.`

代码侧解释（`apps/web/lib/auth-guard.ts:300-320`，部署版 2a96750e 内）：开户赠金先抢 `SignupGrantClaim`（主键 `canonicalEmail`），`canonicalGrantEmail()` 会**去掉 `+tag` 与点号**；`tools+r2a20260911@belcort.com` 归一化后就是 `tools@belcort.com`，而该邮箱早已领过 → `claimed.count === 0` → **按规格 SIGNIN-A17 故意不发第二笔**。

两条后果，都必须写进报告：
1. `SIGNIN-A17`「赠金只发给第一个（幂等键按去掉 `+tag` 与点号变体后的邮箱算）」**得到一次真实正向证据**（不是造 3 个变体造出来的，而是本轮夹具天然撞上）。
2. `SIGNIN-A10`「赠金都恰好一笔 `SIGNUP_GRANT_CREDITS`」**本轮用 `tools+…` 系列夹具无法验证** —— 所有夹具邮箱归一化后都是同一个真实收件箱。要验证必须有一个**基址从未注册过**的可收信邮箱（本机只有 `tools@belcort.com` 这一个收件箱）。标 `PARTIAL（夹具限制：无法用 +tag 变体验证开户赠金）`。
3. 连带影响：夹具 A 余额为 0，**跑不了任何真引擎条目**。因此 Creation 系列（R2-11 等）改在 `tools@belcort.com` 账号上跑（该账号余额 9,999,903.2 credits，测试号），夹具 A 改当**第二租户**用于 PRODID-A9／FRONT-A6 的跨租户不可见。这是对 plan §3.1 夹具分工的一处被迫调整，理由如上。

## 环境观察（顺手撞见，非本轮判定）

Gmail 收件箱里有 Railway 告警：`Deployment crashed for worker in FIKIRTIVE!`（19:40 MYT ＝ 11:40 UTC）与 `Deployment crashed for web in FIKIRTIVE!`（19:45 MYT ＝ 11:45 UTC），时间点正好在本次 staging 部署（11:39:15Z）之后。当前 `/api/health` 与 `/api/ready` 都健康、`railway deployment list` 两服务都 SUCCESS，说明**崩溃后已恢复**。登记为观察项，供后端 worker 在日志里核一眼是否留下影响（是否有请求在那两分钟内失败）。
