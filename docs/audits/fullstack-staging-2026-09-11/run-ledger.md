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
- 在**全新标签页**打开该链接：六格码**已填好**，只有一个 `Continue with login code`（**第 3 轮更正**：这张截图完整显示了那个六位一次性登录码，已从产出中移除；改用文字记录 —— **邮件链接打开登录页、六格已预填，码值已脱敏不留**）；按一次即登录，进的是同一个 `id=Cw7acC6L…`。读完 hash 后地址栏里的 `#email…&code…` 被**清掉**。
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

> **更正（第 6 轮，2026-09-11 W3 追加；上面那一句原文一字不改）**：那一句里的「**302**」**超出本节回执** —— 上面代码块里记下来的是**最终状态 200** 加 `redirects=1`（`/signup 200 -> …/login (redirects=1)`，另两条同形），**跳转本身的状态码没有记**（301／302／307／308 分不出来）。本轮能证的是：**三个地址各跟随一次重定向、落在 `/login`**。判定不受影响（`SIGNIN-A4` 的验收句要的是「三个地址都回到 `/login`」，这一点有逐字回执），但引用处的措辞已按这个口径改：见 `coverage-matrix.md` 的 `SIGNIN-A4` 行与 `R2-06 FRONT-A2` 行。**下一轮补法**：`curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' <url>`（不跟随重定向），把第一跳的状态码抄进本节。
- 登录页全貌见 `01-login-page-no-password.png`：没有密码框、没有 Forgot password、没有任何「设置密码」入口。
- `SIGNIN-A4` → **PASS**；`SIGNIN-A11` 前半（任何方式都建不起密码）→ **PASS**。
- `SIGNIN-A9` 前半（`BetterAuthAccount.providerId='credential'` 行数为 0）→ **PARTIAL（待后端取证）**：要 W2 跑 `SELECT count(*) FROM "BetterAuthAccount" WHERE "providerId"='credential';`，期望 0。
- `frontend-baseline §5 2026-09-10（FRONT-A2 退役）`的 `?from=/create` 落点：用 `/login?from=/create` 走码门 → 登录后**落在 `/create`**（实测，见下条 R2-03 记录）→ **PASS**。

> **更正（第 5 轮，2026-09-11 W3 追加；上面那一句原文一字不改）**：那一句里的「见下条 R2-03 记录」**指不到东西** —— 本文件 `§R2-02 / R2-03` 那一节记的是 Google 门与码门进同一账号，**没有任何一句写到 `?from=/create` 的落点**；全目录也没有第二处现场记录（可复跑：`/usr/bin/grep -rn 'from=/create' .`，只命中判定行与引用，**没有一条现场回执**）。也就是说这个落点**只有一句断言，没有可核的现场**：既没抄回登录后的地址栏原文，也没有页面文本或截图。按「证据不足就往下改判、不往上凑」的规矩，`R2-06 §5 2026-09-10（FRONT-A2 退役）`整行由 **PASS 降 PARTIAL** —— **已做**：三个地址各 302→`/login`、七端点 GET/POST 全 404、`credential` 计数 0（本节上面三条都有逐字回执）；**未做／无回执**：`?from=/create` 登录后的落点。判定与计数见 `coverage-matrix.md` 该行与「汇总计数」节、`report-round2.md` §2／§3／§11.4。**下一轮补法**：用 `/login?from=/create` 走一次码门，把登录后**地址栏原文**抄进本文件。

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

---

## R2-05 暂停新注册 / 限流（SIGNIN-A6 / A8；A7 撤销见后）

### SIGNIN-A8 限流 —— PARTIAL（两句通过，一句不兑现）

**① 第 6 次被拒并提示一小时后再试 —— 通过。** 用一个全新邮箱 `tools+r2rl20260911@belcort.com`，`Continue with email` 一次 + `Send again` 五次：
- 第 2–5 次：页面每次都出 `A new login code was sent.`
- **第 6 次**：`Too many codes requested` / `Too many codes requested. Try again in an hour.` （逐字）

**② 对陌生邮箱与老邮箱的响应时间与文案一致 —— 通过。** 同一段脚本里连测两个地址，测的是「点下去 → 页面出现 Check your email」的真实耗时（每 50ms 轮询 DOM）：
- 陌生 `tools+r2x20260911@belcort.com`：**1304 ms**
- 已有账号 `tools+r2a20260911@belcort.com`：**1142 ms**
- 两句文案逐字同形：`We sent a temporary login code to <邮箱>.`
差 162 ms、同一量级，页面无任何「这个邮箱存在／不存在」的线索。

**③ 第 4 次要求重新发码 —— 不兑现（登记 FSE-201，P2）。** 对夹具 A 连续输 4 个错码：
- 第 1、2、3、4 次**同一句**：`Code not accepted` / `That code didn't work. Check it and try again, or send it again.`
- 第 4 次之后再输**那封邮件里真正的码** → 仍被拒（同一句话）。说明**服务端确实在 4 次之后把这个码作废了**，但**页面从头到尾没有改口**：商家看到的仍是「你可能打错了，检查一下」，而真相是「这个码已经死了，必须重发」。
- 点 `Send again` 拿新码 → 一次即进（恢复路径本身是通的）。
- 判定：机器行为对、**商家可见的那句话不对**；规格 A8 写的是「第 4 次**要求重新发码**」。

### SIGNIN-A6 暂停新注册 —— PASS（Google 半边受夹具限制）

staging 配置改动（Founder 2026-09-11 当次授权，改动与还原全记在此）：

| 时间(UTC) | 动作 | 命令 | 结果 |
|---|---|---|---|
| 12:22:17 | 新增 `SIGNUPS_PAUSED=1`（原值形状：**该键此前不存在**） | `railway variable set SIGNUPS_PAUSED=1 -p … -e staging -s web` | `{"keys":["SIGNUPS_PAUSED"],"set":true}`；触发重新部署，12:23:02 一度 502，12:23:11 恢复 `ok:true`，`build.sha` 仍 `2a96750e` |
| 12:25:57 | **删除** `SIGNUPS_PAUSED`（还原成原值形状＝不存在） | `railway variable delete SIGNUPS_PAUSED -p … -e staging -s web` | `{"deleted":true,"key":"SIGNUPS_PAUSED"}` |
| 12:29:08 | 删除**不会**自动重启容器（横幅在删后 3 分钟仍在），故手动重放同一次部署 | `railway redeploy -p … -e staging -s web -y` | 部署 `5418e589-eabf-4b16-b572-fe1d1513164a`；12:30:04 起横幅消失、`ok:true`、`build.sha=2a96750e` |
| 12:30 | 还原核对 | `railway variables … --json` | `SIGNUPS_PAUSED present: False`，变量总数回到 **51**（与改动前一致）；截图 `04-login-banner-restored.png` 与改动前的 `01` 同尺寸同内容 |

观察到的行为（暂停期间）：
1. **页顶横幅**（截图 `03-login-paused-banner.png`），逐字：`New signups are paused right now. Existing accounts can still log in.` —— 两句都在（关门 + 老商家照进）。
2. **陌生人码门**：输 `tools+r2p20260911@belcort.com` → 页面照样显示 `We sent a temporary login code to …`（**刻意与正常路径长得一样，防枚举**），但 **Gmail 里搜 `to:tools+r2p20260911@belcort.com` 零结果 ⇒ 真的没寄码**；随后输任意码 → `Code not accepted`，会话为 `null` ⇒ **进不来、不建账号**。
3. **老用户**：同一时刻用夹具 A（已有账号）走码门 → 收到码（20:24 那封）→ 一次即进 `Home · Fikirtive`，会话 `email=tools+r2a20260911@belcort.com` ⇒ **老用户不受影响**。
4. **Google 门那半边（陌生 Google 账号在暂停期被拒）**：本机只有 `tools@belcort.com` 一个 Google 身份且它是老账号 → **NOT RUN（无陌生 Google 夹具）**。

### SIGNIN-A7 后台撤销 —— 待做（安排在登录门收尾时用一个一次性账号，不用夹具 A，避免把第二租户弄坏）

---

## 夹具调整与账号说明（Creation 系列改在 `tools@belcort.com` 上跑）

夹具 A 余额 0（见「重大现象 A」），跑不了真引擎。Creation 全部条目改用 `tools@belcort.com`（测试号，起始余额 **9,999,903.2 credits**）。跨租户条目用夹具 A 当第二租户。
浏览器面板只有一个 cookie jar ⇒ **两个账号不能同时在线**；跨租户条目安排在最后统一做。

## R2-07 产品身份正路（PRODID-A1 / A2 / A5 + FRONT-A10）

UTC 2026-09-11T12:33–12:40。

- **Brand 侧的产品编辑器在 `/brand/records`**（`/brand` 五节页没有产品分区；`/brand/records` 的文件头自己写明这是过渡页，由 Knowledge base / Audiences 指过来）。该页 `Your products` 分区 → `Add product` 表单字段：`Name *`、`Price`、`Description`、`Selling angle`、`Link`、`Tags`、`Category` —— **表单里没有主图一格**，主图是建完之后卡上的 `Add image · from Library`。规格 PRODID-A1 的动作写的是「名字、主图、价格」，主图这一格因此是**建后补**，不是同一张表单，照实记。
- 建了 `R2 Coral Tumbler 20260911 / RM 79` → 卡上出现 `You added / Updated Sep 11`。
- **Library → Elements → Products** 立刻出现同一件：`R2 Coral Tumbler 20260911 · 0 linked images`。→ PRODID-A1 商家可见半边 **PASS**；`BrandRecord.entityId = Entity.id` 待 W2 查表（**PARTIAL**）。
- **PRODID-A5**：Library 元素详情面板全文只有 `R2 Coral Tumbler 20260911 / Products · 0 linked images / No image saved for this element yet. / Remove from Library / Close` —— **价格、卖点、分类三个编辑入口一个都没有** → **PASS**。
- **PRODID-A2 前半**：画布输入 `@R2` → 菜单 `References / Results for "R2" / R2 Coral Tumbler 20260911 / **Product**` —— 来源标签逐字是 `Product` → **PASS**；`approvedEntities` 指同一 Entity id 待 W2（**PARTIAL**）。
- **FRONT-A10（前两句 + 改判后的第三句）**：空 `@` 菜单原文＝`Recent / Recently updated in your workspace / <生成结果> Generation · / <画布> / R2 Coral Tumbler 20260911 Product / Xinyi Official avatar · Read only / Rahman Official avatar · Read only / Arjun Official avatar · Read only / BROWSE BY TYPE Products Characters Official avatars Locations Media`。三类来源（生成结果 / 产品 / 官方演员）都在、都来自服务器；Official avatar 条目**能被真正选入并送进引擎**（见 R2-11 的确认卡逐字写出 `Xinyi (person)`）⇒ 不是假条目。**PASS**（`referenceRefs` 存真实 id 待 W2）。

## R2-11 FL-03 官方演员 + 商品 → 视频（正路）—— 关键证据

UTC 2026-09-11T12:38–12:45。账号 `tools@belcort.com`。

1. 先在同一张画布上生成一张商品图（`@R2 Coral Tumbler 20260911` + 一句话）：确认卡原文 `🪸 1 image 1728 × 2304 · 3:4 · 1 image` / `1 credit` / `Generate · 1 credit` → 批准 → **约 10 秒出图**，节点自动变成 `Image … v1`，Otto 收尾句 `Made 1 image · 1 credit.`（**无需手动刷新**）。Generation id `01M287HQC2P1E33C6CDKJXJV04`。
2. 再 `@Xinyi`（官方演员）+ `@` 选上一步那张**生成图**，一句话要 5 秒 720p 无声视频。Otto 回话逐字：

   > `Since @Xinyi is a cast member, her reference photos and the tumbler's entity reference go straight to the video engine — no starting picture needed. One step!`

   → **没有「先合成首帧再动画」那一步**（R2-20 / :162④ 的正面证据）。
3. 确认卡逐字：`🎬 1 video` / `9:16 · 5s · 720p · No sound · Uses 3 of your reference photos` / `11 credits` / `Reference names sent to the engine: Xinyi (person). R2 Coral Tumbler reusable travel mug, standing upright, c…` / `Generate · 11 credits`。→ **两张参考直接进引擎**、卡上点名了引用来源。
4. 批准（12:41:27Z）→ 节点 `Video Rendering… / Otto is making this — you can keep working / Billed only when it finishes` → **约 3 分钟**后 `Video … v1`、Otto 收尾句 `Made 1 video · 11 credits.`（**无需手动刷新**）。Generation id `01M287S996PCX2FEGWHTDGJP95`。
5. 产物真伪（在页面内取字节，**不记录任何签名链接**）：
   - 视频：HTTP 200、`content-type: video/mp4`、**3,228,579 字节**、magic `00 00 00 20 66 74 79 70 69 73 6f 6d`（`ftypisom` ＝ 合法 MP4）、`videoWidth×videoHeight = 720×1280`、`duration = 5.041667` 秒 —— 与卡面「5s · 720p · 9:16」一致。
   - 商品图：HTTP 200、`image/jpeg`、**161,363 字节**、magic `ff d8 ff e0 … JFIF`、`1728×2304` —— 与卡面「1728 × 2304 · 3:4」一致。
6. 钱路（商家可见）：批准前 9,999,897.7 → 预扣后 Billing 正文 `On hold 11 credits held`、可用 9,999,886.7 → 完成后 `Made 1 video · 11 credits`。**一次预扣、一次结算**，金额与卡面一致。ledger 三行（reserve/settle、无残留 hold）待 W2 查表。

判定：`§5 :162（FSE-001 正路）` **PASS**（商家可见面）；`CREATE-A10` 第一场景 **PASS**（不触发人脸拦截、引用落盘可查待 W2）；第二场景与自动放大／拒绝文案两张小图见后（时间与预算允许时补）。

## R2-15 variation 真实交付（上轮门槛 A3）—— PASS（商家可见面）

UTC 2026-09-11T12:46。对上面那张商品图点 `Create variations` → 弹窗逐字：`Make another one like this? Cost: 1 credit. No charge until you confirm.` + `Images 1` + `Shape 3:4` + `From <完整的 sentPromptText 原文>` → `Generate · 1 credit` → **约 1 分钟内**出新节点 `01M2882PXJX2DYTZNRTH4KD6ZZ`，Otto 收尾 `Made 1 image · 1 credit.`
产物字节：HTTP 200、`image/jpeg`、**146,870 字节**、magic `ff d8 ff e0`、`1728×2304`。
→ **拿到可用产物**。账本 reserve/settle 各一行待 W2。

## R2-18 完整下载字节 —— PASS（字节层面）

三个产物都在页面内实拉字节核过（见上）：MP4 3,228,579 字节可解析出 5.04 秒 / 720×1280；两张 JPEG 161,363 / 146,870 字节、1728×2304。**不是只触发了 download 事件**。
（`Download` 按钮本身的落盘行为：浏览器面板沙箱禁止下载，按钮点击无法在本机产出文件 —— 这是工具侧限制，不作应用判定。）

## R2-13 余额广播（FSE-010）—— FAIL 一格（登记 FSE-202，P2）

两个标签页同一账号：tab-1 画布、tab-2 停在 `/billing` 不再手动刷新。
- tab-1 花掉 1 credit（variation 预扣）后：tab-2 处于**后台隐藏**状态时数字不动（12:46:44、12:47:20 两次读都是 9,999,886.7）；
- 把 tab-2 **切到前台**后 6 秒内，**侧栏余额自动变成 9,999,885.7**（与 tab-1 一致）⇒ 广播这一半**是通的**，不需手动刷新。
- **但同一屏上**：`Available balance` 正文仍是 **9,999,886.7 credits**、`On hold` 仍写 `11 credits held`（那笔 11 credits 的视频早已结算）、`Spend history` 仍是 `Video Held … -11`、`46 entries` 没变。
- 即：**同一个 Billing 页面上，侧栏与正文给出两个不同的余额（9,999,885.7 vs 9,999,886.7）**。规格 fb:202 的原话是「侧栏余额……即与 **Billing 正文**、DB 一致」——这一格**不成立**。
- 登记 **FSE-202**（P2）。

## R2-19 · FRONT-A12 第①②段 —— PASS

**① 夹具地址不可达**（同一部署 commit 2a96750e，staging 是 `next build` 产物）：
- 未登录（curl `-L`）：五个地址 **全部 302 → `/login?from=…`**。
- **已登录**（在页面内用同一会话 `fetch`，跟随重定向）：`/product-patterns`、`/product-patterns/canvas`、`/design-system`、`/design-system/patterns`、`/design-system/tokens` —— **五个全是 HTTP 404**，正文是 `This page could not be found`，无一渲染出夹具页。
**② 商家面无夹具数据**：从 `apps/web/design-system/patterns/*/fixtures.ts` 抄出 12 个特征串（`Aisyah`、`Rizal`、`Sales Aug 2026`、`Six-second lookbook`、`Weekend tea launch`、`Workshop carousel`、`Cordial bottle reference`、`Storefront walkthrough`、`Coffee ritual video`、`Brand guideline v4`、`Warm family gathering scene`、`Storefront location reference`），逐串在 `/`、`/create`、`/library`、`/brand`、`/settings`、`/billing`、`/profile` 七面搜 → **唯一命中是 `/library` 里的 `Aisyah`**，而 `Aisyah` 是**官方演员库真人物**（`packages/core/src/actor-library.ts`、`gen-failure.ts` 都以她为例），不是夹具泄漏 ⇒ **零夹具命中**。
**③ 写入失败有反馈、不假成功**：安排在 R2-09（同名占位恢复那条路）一起做。

---

## R2-24 Creation⑥ 分镜挂 Library 图 —— ① PASS，②③⑤ BLOCKED（工具限制）

UTC 2026-09-11T12:50–12:56。让 Otto 出一张 3 镜分镜（两镜带演员直接出片、一镜纯商品）。

Otto 的计划原文（关键两句）：

> `Shots 1 & 3 are made in one step each (Xinyi's reference photos go straight to the video).`
> `Shot 2 needs a starting picture first, then animates — two steps, but the storyboard handles it.`

分镜卡（**Otto 刚交出、一分钱没花过的草稿卡**）上的按钮逐个抄下：每镜 `Move up / Move down / Edit shot / Delete shot`，另有 `Add shot`、`Generate all first frames (1)`、`Make all videos (2 clips)`。
- **`Add image` 只出现在第 1、3 镜**（两个直接出片的镜头）；第 2 镜（纯商品、要先合成首帧的那一镜）**没有** `Add image`。
- 第 1 镜那一格的说明逐字：`Library images` / `Add image` / `Goes straight to video — the cast and product photos are its references, so there is no first frame to make or pay for.`
→ **R2-24 ①「入口第一手就在」PASS**；**④「带不上车即拒」的商家可见半边**＝根本不给入口（比「写入即拒」更靠前的 fail closed），**PASS（UI 层）**；服务端 `setShotReferences` 的点名拒绝与跨租户拒绝（⑤）**未测**。
- 点 `Add image` → 弹出 `Library images / Pick an image this shot should use as a reference`，列出 8 个候选（生成结果与上传，各带来源标签 `Generation · <画布名>`、`Upload · Library`）。**选取这一步做不下去**：浏览器面板的合成点击落不到弹层选项上（JS `.click()`、完整 pointer 序列、键盘 ArrowDown/Enter 四种方式都试过，弹层关闭但没有芯片落到镜头上）。同一套 JS 点击在**普通按钮**上一直有效（`Generate`、`Create variations`、`Add image` 本身都点得动），所以这是**弹层选项的工具侧限制**，不是应用缺陷 —— 判 **BLOCKED**，不判 FAIL。
- 因此 ②（挂图进报价材料）、③（逐张取下）、⑤（跨租户构造）**BLOCKED**，建议下一轮用真实鼠标或自动化旅程补。

## R2-14 上传 / 理解费用（FSE-009 / :169）—— PASS，附一条时序观察

UTC 2026-09-11T12:52–12:56。用画布 composer 的图片引用入口上传（文件名照 Founder 令加前缀）：
- `r2-20260911-upload-normal.jpg`（1200×1600，两次）
- `r2-20260911-tiny-80px.jpg`（80×107）

Library → Uploads 立刻出现，几十秒后卡片标题从文件名变成**自动理解出来的描述**（`A plain white vertical rectangle centered against a gradient background` / `A plain vertical white oval shape centered against a gradient background`）⇒ 自动理解真的跑了。

费用行（资产详情 `Where this came from` 那一段）：
- **理解还没结算时**：`Cost: no credits charged`
- **理解结算之后**（重新打开同一张）：`Cost: 0.1 credits`（**一行合计、不拆行**）
- Billing 正文对应行：`Understanding — Sep 11, 8:54 PM -0.1`
→ `:169（FSE-009）` **PASS**。
**时序观察（不当 bug，登记备查）**：上传后到理解结算之间那几十秒，详情页写的仍是 `no credits charged`，而这笔钱随后一定会收 —— 商家在这个窗口看到的是「免费」。建议 S5 裁是否改成「正在理解，费用稍后结算」。

## R2-23 Creation① 尺寸闸 —— 两条路都**没有**在付费前拒绝（登记 FSE-204，P1 候选）

UTC 2026-09-11T12:56–13:02。素材：`r2-20260911-tiny-80px.jpg`，**短边 80 px（<100）**。

**路 ①（图生图 / 编辑）**：`@tiny` + 「用这张参考做一张白底商品图」→ 确认卡逐字 `1 image 1728 × 2304 · 3:4 · 1 image · Uses your attached image` / `1 credit` / `Image Base image / Image Reference` / `Generate · 1 credit` —— **卡上没有任何尺寸提醒**。批准 → **生成成功**、`Made 1 image · 1 credit.`、真扣 1 credit。
**路 ②（视频起始帧）**：同一张 80×107 图 + 「5 秒 720p 无声、商品旋转」→ 确认卡逐字 `1 video 9:16 · 5s · 720p · No sound · **Starts from your image**` / `11 credits` / `Image Starting frame` / `Generate · 11 credits` —— 同样**没有尺寸提醒、没有放大披露、没有拒绝**。批准 → 进入 `Rendering…`（结果见下条补记）。

对照 plan §2.3 的判定口径（:162 残留①、:176⑥）：短边 <100 的图应当在**付费前**被诚实拒绝，且**拒绝文案要说出这张图现在多大**（门槛按能否放大分岔 100 / 300）。本轮在两个入口上都**没有出现任何拒绝或披露**。
未验到的另一半：短边 100–300 的「自动放大 + 独立一行披露句」（:176④）。因为路①路②都没触发任何披露句，下一步应先弄清尺寸闸到底挂在哪条入口上（可能只挂「商品参考进视频」而不挂「起始帧」与「图生图」）—— 这需要后端取证（哪条路调用了 `reference-budget` / 尺寸闸），故 **FSE-204 先标「假说待后端确认」**，严重度候选 P1（「付费前尺寸闸唯一一份、没有一条入口绕得过去」是本条验收的正文）。

---

## R2-12 编辑 / retry（:163①②③、CREATE-A12 片段）

UTC 2026-09-11T13:03–13:06。素材＝上一条那次**真实失败**的视频任务（80px 起始帧被供应商弹回）。

**失败态本身（顺带证 FSE-005）**：节点自动变成 `Video / That didn't finish / You weren't charged.`，Otto 那一行同时变成 `Failed / That generation didn't go through — you can try again.` + 一个 `Edit and retry` 按钮 —— **不需手动刷新**，Current turn 与 Conversation 同步。

**:163①（输入框非空时点 Edit and retry）—— PASS**
- 先在输入框打 `half typed sentence I do not want to lose`，再点 `Edit and retry`：
  - 输入框内容**一字未动**（前后逐字相同）；
  - 屏幕上出现逐字提示：`Kept what you're typing — that earlier message wasn't put back. Clear the box and press Edit and retry again.`
- 清空输入框再点一次：原消息**连同引用芯片**一起放回 —— `@r2-20260911-tiny-80px.jpg Make a 5 second 720p video, no audio, of this product rotating slowly on a white table.`，上一句提示**自动消失**。

**:163②（`retry-source` 一行 + 独立 Remove）—— 未复现（登记 FSE-205，P2）**
- 恢复出草稿后，全页搜 `[data-slot="retry-source"]` **找不到该元素**；页面上也没有任何「Retrying: "…"」字样；输入框旁只有引用芯片自己的 `Remove image`。
- 代码侧（部署版本内）`OttoChatStream.tsx:1299` 的渲染条件是 `restoredDraft?.sourceMessageId`；本轮走的是**失败卡上的 Edit and retry**，若该路径不带 `sourceMessageId`，这一行就永远不出现。**这是假说，须后端／代码取证**（W2 或下一轮）。判 **PARTIAL（未复现，路径待确认）**，不直接判 FAIL。

**:163③（`References kept: … + N more`）—— NOT RUN**：需要同时挂「有名字的」与「手动挂的无名件」两种引用；本轮引用件数不足以构造，未执行。

**CREATE-A12 片段**：variation 弹窗里把 `sentPromptText` **整句摊开给商家看**（见 R2-15 记录），与卡面批准的稿子是同一串；`Regenerate` 按钮在资产详情页存在（`Regenerate · 1 credit`），本轮未按（避免重复花钱）。逐字一致与 `routeReason` 有值须 W2 查表 ⇒ **PARTIAL**。

**:170（FSE-012 报价版本）—— NOT RUN**：需要在同一张卡上「数量 1→2 期间抢提交旧报价」，要两个标签页对同一张卡做竞态；本轮工具侧点击限制下无法可靠构造，未执行。

---

## R2-17 花费上限 cap（多入口）—— PASS 两个入口，PARTIAL（四缺二 + 并发未做）

staging 设置改动（商家自己的设置，不是环境变量；改动与还原都记在此）：

| 时间(UTC) | 动作 | 结果 |
|---|---|---|
| 13:08 | Billing → `Set a cap` → 填 `1` → `Save` | 服务器端 `spendCapCredits: 1`（刷新后输入框仍显示 1） |
| 13:12 | 还原：输入框改 `0` → 按钮变 `Remove cap` → **二次确认弹窗** `Remove Otto's spend cap? / Actions above 1 credits are currently refused before charging.` → 弹窗里再按一次 `Remove cap` | 服务器端 `spendCapCredits: 0`、页面回到 `No cap set` ⇒ **已还原** |

（记一笔：第一次我只点了外层 `Remove cap` 就去读结果，误以为「移除无效」。实为**两步确认**设计，`SettingsPage.tsx:208` 的 AlertDialog。不是缺陷。）

cap=1 时的两个入口：
1. **Library 动作**（资产详情 `Animate · 11 credits`）→ 逐字：`Couldn't complete this action` / `Paused by your spend cap — this needs 11 credits and your cap is 1 credit per action. Raise the cap in Billing & credits to run it.`；余额 `9,999,875.5` **前后一字不差**（零扣费）。
2. **画布确认卡**（`Generate · 11 credits`）→ 同一句逐字提示贴在卡上；余额 `9,999,872.2` **前后一字不差**（零扣费）。
- 未做：**Otto 主动提议**、**分镜**两个入口，以及**并发两次提交**（工具侧点击限制 + 时间）⇒ 整条标 **PARTIAL**。
- 小观察（不当 bug）：Library 那颗按钮被 cap 拒绝后，标签变成 `Failed — retry?` —— 「被自己的上限挡下」被显示成「失败」，措辞可议，留 S5。

---

## R2-22 盯项③「先合成首帧再动画」—— 现象取证完成（零花费生成，零账本行）

UTC 2026-09-11T13:14。在真实对话里**明说**要两步：`First make me one composite first frame of Xinyi holding the coral tumbler, then use that frame to animate a 5s video. Do it in those two steps.`

Otto 的回应逐字（关键段）：

> `Actually, I'd steer you away from that plan — here's why: a composite image made here can't be used as a person in a video. The video engine would treat it as a product reference, not as Xinyi, and her identity would drift or be ignored. You'd pay for the picture and still not get the result you want.`
> `The good news: @Xinyi + the tumbler in one video step is exactly what our engine is built for.`

结果：**没有出卡、没有 GenJob、没有任何生成类账本行**（只有这一轮对话本身的 2.2 credits）。⇒ 「产品面发不出这个组合」这一现象**成立**。首帧即参考名额是否仍为 0 属代码常量（`packages/core/src/reference-budget.ts`），由 W2 或代码取证。**按 plan §1.1 不下供应商接受度结论。**

---

## R2-20 盯项①—— PASS（带演员的镜头），附一条必须让 Founder 看见的现象

- 带演员的请求：Otto 逐字说 `no starting picture needed. One step!`（R2-11）。
- 商家明说要两步时：Otto **劝退并解释**（R2-22）。
- **但是**：在**分镜**里，对一个**纯商品、没有人物**的镜头，Otto 的计划仍然写：`Shot 2 needs a starting picture first, then animates — two steps, but the storyboard handles it.`，分镜卡上也确实有 `Generate all first frames (1)` 这颗按钮。
  → 「先合成首帧再动画」这条路**在无人物镜头上仍然存在且被主动提议**。Founder 2026-09-08 的原话是「合成 first frame 的 idea 可以移除了，没有必要」——这句话是只针对**带演员**的场景，还是针对全部场景，**本轮不替 Founder 解释**：现象照录，留 S5 裁（登记 FSE-208，严重度暂记 P2 / 待裁）。

---

## R2-19 刷新 / 深链 —— 刷新 PASS；跨租户深链**静默新建**（登记 FSE-207）

- **刷新**：画布刷新后 5 个节点、余额、失败节点状态全部保留（`nodes 5 → 5`）。小观察：`Conversation` 计数从 34 变成 29（直播态计数与持久化计数口径不同），不影响内容。
- **跨租户深链（:172④）**：用**第二租户**（`tools+r2f20260911@belcort.com`，新建于 13:17）打开租户 A 的画布地址 `…/create/canvas?project=canvas_c878814e-493e-4e03-9119-6a430ebcde11`
  → 地址被**静默换成一个全新的 project**（`…?project=01M289WJEET9N9H30NB2ENYPW6`），页面是一张**空白新画布**，**没有任何拒绝提示**。
  → 好消息：**没有泄漏**（租户 A 的节点、提示词、余额一个字都没出现）。
  → 坏消息：规格 :172④ 要的是「整卡 **fail closed**、**零写入**、**不静默回退造新对象**」—— 现状是**静默造了一个新对象**。登记 **FSE-207**。

## R2-10 租户隔离（PRODID-A9 读路）—— PASS（读路），写路 PARTIAL

第二租户登录后逐面查：
- `/library`（生成历史与上传）：**查无**租户 A 的任何字样（`R2 Coral Tumbler` / `tiny-80px` / `upload-normal` 三串全 0 命中）
- `/library?view=elements`：**查无** `R2 Coral Tumbler`
- `/brand/records`：**查无** `R2 Coral Tumbler`
- 直接构造指向 A 的 `entityId` 写入（A9 后半）：**未执行**（需绕过产品面构造 server action）⇒ **PARTIAL**，建议 W2 用只读查表 + 代码取证补。

## SIGNIN-A16 大小写归一 —— PASS（商家可见半边）

在登录页输入 `Tools+R2F20260911@Belcort.com`（混合大小写）→ 页面回执与随后会话里的邮箱都是**全小写** `tools+r2f20260911@belcort.com`，账号 `id=AFturvzxL31tPie07geeH5sZMFpObTqv`。
`AllowedEmail` 是否**只有一行小写**、两次登录是否同一 `userId` ⇒ W2 查表（本轮只登录了一次大小写混写的形态）⇒ 整条标 **PARTIAL**。

## R2-08 / R2-09 产品编辑与删除矩阵

- **PRODID-A4（Brand → Library 方向）PASS**：Brand 页 `Actions → Edit` 把名字改成 `R2 Coral Tumbler RENAMED` → Library `Elements → Products` **同步显示新名字**，**只有一行**（没有第二份）。
- **PRODID-A4（Library → Brand 方向）NOT RUN**：Library 元素详情面板**没有改名入口**（只有 `Remove from Library` / `Close`），本轮无法从 Library 侧改名。换主图方向同理未做（Brand 侧是 `Add image · from Library`，Library 侧无对应编辑）。
- **PRODID-A6 四格**：
  - ① **Brand 删 → Library 消失**：**做不了** —— Brand 页产品菜单只有 `Edit / Choose image / Archive`，**没有删除**。
  - ①′ **Archive 的现象（新发现）**：归档后 Brand 页写 `Archived (1) — hidden from Otto`，但 **Library Elements 仍然列着它**，而且**画布 `@` 菜单仍然搜得到、仍可选入**（`@RENAM` → `R2 Coral Tumbler RENAMED / Product`）。「hidden from Otto」这句话与实际不符 ⇒ 登记 **FSE-206**。（已 `Unarchive` 还原。）
  - ② / ④ **恢复方向**：**没有恢复入口**（Library 删除后既无 Undo 提示，也没有回收站视图）⇒ 本轮 **NOT RUN（无入口）**。
  - ③ **Library 删 → Brand 消失**：**PASS**。Library 元素面板 `Remove from Library` → 二次确认逐字 `Remove from library? / This moves "R2 Coral Tumbler RENAMED" out of Library. It won't show up on a Canvas, in pickers, or in search anymore.` → 确认后 Library 变 `No products yet`，**同时 Brand 页也查无此物**。
  - **已生成的成片不动**：删除后画布上的三张图与两段视频节点仍在（刷新后仍在）⇒ 符合规格。
- **PRODID-R2 / R8 / R6 / R9、删整件产品的字节保留**：本轮未逐条构造（无封面图、无同名占位冲突）⇒ **NOT RUN**。
- **FRONT-A12 第③段（写入失败有反馈、不假成功）**：原计划靠 PRODID-R8 那条同名占位路取证，因未构造 ⇒ **NOT RUN**。

## R2-16 取消语义 —— PARTIAL（未见取消入口）

三次真实的长任务（两段视频、一次 variation）渲染期间，节点上的控件逐字只有：`Otto is making this — you can keep working` / `Billed only when it finishes` / `Check again` —— **没有 Stop / Cancel 控件**。按 plan 口径「产品面无 Stop 控件就照实记『无取消入口』，不写成功能失败」⇒ 记 **无取消入口**（PARTIAL，待 Founder 裁是否要做）。

## R2-03 两扇门合并 —— 最后重查后仍 NOT RUN

13:20 重查：PR **#1349 仍 OPEN**、issue **#1320 仍 OPEN**，`/api/health` 的 `build.sha` 仍是 `2a96750e`（未变）。
- `SIGNIN-A12`（端到端旅程）⇒ **NOT RUN（未部署 + 无陌生 Google 夹具）**。
- `SIGNIN-A3` 的商家可见半边已在 R2-02 段取证（同一邮箱两扇门进同一账号、同一工作区）⇒ **PARTIAL**（库里「只有一个用户、一个工作区、两条 provider 同 userId」待 W2）。

---

## 本轮上传的素材清单（Founder 令：前缀 `r2-20260911-`、走完列清单、不删）

| 文件名 | 尺寸 | 落点 | 备注 |
|---|---|---|---|
| `r2-20260911-upload-normal.jpg` | 1200×1600 | 租户 `tools@belcort.com` 的 Library Uploads | 上传了**两次**（第一次是探路），两份都保留 |
| `r2-20260911-tiny-80px.jpg` | 80×107 | 同上 | R2-23 尺寸闸用 |

另外本轮**生成**的资产（未删除）：商品图 `01M287HQC2P1E33C6CDKJXJV04`、视频 `01M287S996PCX2FEGWHTDGJP95`、variation 图 `01M2882PXJX2DYTZNRTH4KD6ZZ`、白底编辑图（`Replace background.`）、一条失败的视频任务（未产出、未收费）。
本轮**新建**的账号：`tools+r2a20260911@belcort.com`（夹具 A）、`tools+r2f20260911@belcort.com`（第二租户）；另有两个只收过码、**没有建成账号**的地址：`tools+r2rl20260911@belcort.com`（限流用）、`tools+r2x20260911@belcort.com`、`tools+r2p20260911@belcort.com`（暂停期用）。产品记录 `R2 Coral Tumbler RENAMED` 已在 R2-09 的③格里被删除（那是验收动作本身）。

---

## §4 预算表 —— 逐笔登记（替代文首的空表，以此表为准）

换算式（常量名见文首）：`USD = displayed × INTERNAL_PER_DISPLAY / CREDITS_PER_USD`。账号 `tools@belcort.com` 起始余额 **9,999,903.2**，收尾余额 **9,999,870.0**。

| # | 时间(UTC) | 条目 | 动作 | 入口 | 产物 / GenJob | 报价(displayed) | 实扣(displayed) | 结果 |
|---|---|---|---|---|---|---|---|---|
| 1 | 12:35 | R2-07 | Otto 对话（问比例） | 画布 | — | ≤4 预扣 | 2.3 | 用 2.3 退 1.7 |
| 2 | 12:37 | R2-07 | Otto 对话（确认 3:4）＋铸卡 | 画布 | — | ≤4 预扣 | 0.8 | 用 0.8 退 3.2 |
| 3 | 12:37 | R2-07/11 | **生成商品图** | 确认卡 | `01M287HQC2P1E33C6CDKJXJV04` | 1 | 1 | 成功，`Made 1 image · 1 credit.` |
| 4 | 12:40 | R2-11 | Otto 对话（演员+商品铸卡） | 画布 | — | ≤4 预扣 | 1.4 | 用 1.4 退 2.6 |
| 5 | 12:41–12:45 | R2-11 | **生成视频 5s/720p** | 确认卡 | `01M287S996PCX2FEGWHTDGJP95` | 11 | 11 | 成功；`On hold 11 credits held` → 结算 |
| 6 | 12:46 | R2-15 | **variation 出图** | 节点 `Create variations` | `01M2882PXJX2DYTZNRTH4KD6ZZ` | 1 | 1 | 成功 |
| 7 | 12:50 | R2-24 | Otto 对话（3 镜分镜） | 画布 | — | ≤4 预扣 | 3.4 | 用 3.4 退 0.6 |
| 8 | 12:54 | R2-14 | 自动理解（上传） | 上传 | — | 0.1 | 0.1 | Billing 行 `Understanding — -0.1` |
| 9 | 12:57 | R2-23 | Otto 对话（80px 图生图铸卡） | 画布 | — | ≤4 预扣 | ~1.8 | — |
| 10 | 12:58 | R2-23 | **生成白底图（80px 参考）** | 确认卡 | `Replace background.` 节点 | 1 | 1 | 成功（**没有触发尺寸闸**） |
| 11 | 13:00 | R2-23 | Otto 对话（80px 起始帧视频铸卡） | 画布 | — | ≤4 预扣 | ~1.6 | — |
| 12 | 13:01–13:04 | R2-23 | **视频（80px 起始帧）** | 确认卡 | 失败任务 | 11 | **0** | `That didn't finish / You weren't charged.` **全额不收费** |
| 13 | 13:10 | R2-17 | Otto 对话（大理石桌视频铸卡） | 画布 | — | ≤4 预扣 | ~2.2 | — |
| 14 | 13:11 | R2-17 | 触发 cap 拒绝 ×2（Library / 画布） | 两处 | — | 11 | **0** | 两次都零扣费 |
| 15 | 13:14 | R2-22 | Otto 对话（明说要两步） | 画布 | — | ≤4 预扣 | 2.2 | 被劝退，**零 GenJob** |

**合计（商家侧扣费）**：`9,999,903.2 − 9,999,870.0 = 33.2 displayed credits`
**换算**：`33.2 × INTERNAL_PER_DISPLAY / CREDITS_PER_USD = USD 3.32`
**占 Founder 批准额度（USD 20）**：**16.6%** —— 远低于 80% 停手线。
**供应商成本快照（`spentUsd`）**：应用侧记录，本轮**未取**（属后端只读取证，W2 在 `backend-evidence.md` 补；退款不等于供应商账单为零 —— 第 12 行那次失败的视频，商家侧为 0，供应商侧是否产生成本必须另查）。
