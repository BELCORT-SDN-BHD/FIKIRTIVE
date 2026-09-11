# Round 2 后端只读证据（backend-evidence）— 2026-09-11

> 本文件由 **W2（终端 worker，只读取证）** 写。W2 没有触发任何生成、没有改数据库、没有部署、没有改变量、没有跑迁移、没有删任何素材。所有商家侧操作由 W1 完成（现场记录见 `run-ledger.md`）。
> 时间一律 UTC。本轮取证窗口 **2026-09-11T12:00:00Z 起**（W1 走查 12:08–13:20Z）。
> 方法与第一轮 `docs/audits/fullstack-staging-2026-09-08/backend-evidence.md` 同形：Railway CLI 显式 `-p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s web|worker|Postgres`；数据库连接信息**只在进程内解析后直接喂给 psql**，未回显、未落盘、未进本文件；连接强制 `default_transaction_read_only=on`、`statement_timeout=10000`，只跑 `SELECT`／`COUNT`。
> 本文件不含任何密码、令牌、连接串、签名媒体链接或 session 数据。
> CodeGraph: not used — W2 在自己的 worktree，按项目规则用 `/usr/bin/grep`、`git show <deployed sha>:<path>` 与直接读文件。

---

## §0 查询方法与版本身份

- Railway CLI `5.20.0`，已认证；当前 worktree 未 link，所有查询显式带 project／environment／service。
- **数据库身份核对（只比形状，不看值）**：`web.DATABASE_URL`、`worker.DATABASE_URL`、`Postgres.DATABASE_URL` **三者逐字相同**（同主机 `postgres.railway.internal:5432`、同库 `railway`、同用户）；W2 走的是同一实例的公网代理入口（`Postgres.DATABASE_PUBLIC_URL`，同库同用户、口令长度一致）。因此本文件查到的就是 web／worker 正在用的那一个 staging 库。（本机陷阱「双 Postgres 抢 5432」在这里不适用：连的是远端代理主机，不是 127.0.0.1 的本地库。）
- 源码取证一律 `git show 2a96750e:<path>`，不用当前 checkout 冒充部署源码。

### P0-1 复核：部署版本（含一条 W1 之后发生的变化）

| service | deployment id | status | createdAt (UTC) | commitHash |
|---|---|---|---|---|
| web | `51f973fd-9f25-4928-8d9e-6f42105de442` | REMOVED | 11:39:15.367Z | `2a96750e…` |
| web | `13b32ba7-62d2-4c89-8153-06672ebcd8db` | REMOVED | 12:22:17.358Z | `2a96750e…`（W1 设 `SIGNUPS_PAUSED` 触发） |
| web | `5418e589-eabf-4b16-b572-fe1d1513164a` | SUCCESS | 12:29:06.841Z | `2a96750e…`（W1 还原后手动 redeploy） |
| **web** | `3226d107-aa5e-4902-8468-7c59a4ca030b` | **BUILDING**（13:29Z 时） | **13:25:45.893Z** | **`b30b7b6f…`** |
| worker | `64417a88-b437-4583-a012-9d84f2eca3a3` | REMOVED | 11:39:15.367Z | `2a96750e…` |
| **worker** | `e264bb4a-4e04-4369-8cf1-bdd2701617ff` | **SUCCESS** | **13:25:45.893Z** | **`b30b7b6f…`** |

**必须让编排者知道的一件事**：`13:25:45Z`（W1 收工之后）**PR #1349 已合并并触发新部署**，commit `b30b7b6f…`（提交信息逐字：`Merge pull request #1349 … [登录门⑤] SIGNIN-A12 端到端旅程`）。截至 `13:29:17Z`：worker 已在 `b30b7b6f`（SUCCESS），web 仍在跑 `2a96750e`（`/api/health` 的 `build.sha=2a96750e`，新构建 BUILDING）。
⇒ ① W1 整段走查（12:08–13:20Z）**完整落在 `2a96750e` 上，web/worker 同版**，本轮结论不受影响；② 从 13:25Z 起 staging **不再是 W1 走查的那个版本**，也短暂处于 web/worker 不同版的状态 —— 下一轮任何复跑必须重做 preflight 版本对齐，不得引用本轮的 `2a96750e`。

### 环境边界补一条（W1 没查到的）

web 启动日志逐字：`[env-contract] 1 problem(s) with the web environment: • SENTRY_DSN is required in production but is not set`（因 `FIKIRTIVE_ENV_CONTRACT=warn` 只告警不拦）。
⇒ **staging 没有配 Sentry**。因此 `SIGNIN-A17` 里「第 51 个触发 Sentry 告警」那半句在 staging 上**根本无法验证**（不是漏做，是环境里没有那条告警通道）。

### W1「环境观察」里那两封 Railway 崩溃告警

采样 `51f973fd`（11:39Z 那次 web 部署）的部署日志全文：迁移 `No pending migrations to apply.` → `Next.js 16.2.9 / ✓ Ready in 282ms` → 一条 `[env-contract]` 告警 → `Stopping Container` / `SIGTERM`（即被 12:22 那次变量改动触发的新部署替换）。日志里**没有**请求级 5xx 或业务异常。告警与容器替换时间吻合，但**日志缺失不能单独证明那两分钟没有请求失败** —— 只能说采样日志里查不到影响。

---

## §1 钱路：一次预扣、一次结算、零残留（本轮最硬的一组事实）

窗口内 `CreditLedger`（`orgId='founder'`）共 **32 行、16 个 refId**。逐 refId 的不变式检查（SQL 直接找违例）：

```
每个 refId 必须满足：RESERVE 恰好 1 条 且 (SETTLE + REFUND) 恰好 1 条 且 reservedDelta 合计 = 0
违例行数：0
```

`GenJob` 与账本的对账（5 个 job 全覆盖）：

| GenJob | kind | status | RESERVE | SETTLE | REFUND | spent | spentUsd | billedUnits |
|---|---|---|---:|---:|---:|---|---:|---:|
| `01M287HP540PBATYQY1WP84ZGK` | IMAGE seedream | DONE | 1 | 1 | 0 | t | 0.035 | 1 |
| `01M287S820V8HZ49Z6RPHP61Q1` | VIDEO seedance-2-mini | DONE | 1 | 1 | 0 | t | 0.3803821875 | 108900 |
| `01M2882NQZMF73DB8HQFR7V567` | IMAGE seedream（variation） | DONE | 1 | 1 | 0 | t | 0.035 | 1 |
| `01M288R9AFTCEB6BBS5YJBJ8EM` | IMAGE seedream（80px 图生图） | DONE | 1 | 1 | 0 | t | 0.035 | 1 |
| `01M288VJS12BBT536TZF5T0S01` | VIDEO seedance-2-mini（80px 起始帧） | FAILED | 1 | **0** | **1** | f | — | — |

- 失败那一条：`13:00:06.841Z` RESERVE −110／+110 hold，`13:02:28.048Z` **REFUND** +110／−110 hold，**没有 SETTLE** ⇒ 「全额不收费」是真的，且只退一次。
- **没有**任何 refId 出现二次结算、结算后退款、退款后结算或残留 hold。
- 收尾 `CreditAccount`（orgId=founder）：`balance = 99,998,700` internal、**`reserved = 0`**、`updatedAt = 13:15:43.088Z`。

### 与 W1 现场数字的对账

窗口内 `sum(balanceDelta) = −332` internal、`sum(reservedDelta) = 0`。
按 `packages/core/src/spend.ts` 的常量（`INTERNAL_PER_DISPLAY`、`CREDITS_PER_USD`）：`−332 internal = −33.2 displayed credits = USD 3.32`。
**与 W1 现场算出来的 33.2 displayed / USD 3.32 逐字相符**（W1：9,999,903.2 → 9,999,870.0）。占 Founder 批准额度 USD 20 的 **16.6%**。

三类花费的机器口径（合计 332 internal）：

| 类别 | 条数 | internal | displayed |
|---|---:|---:|---:|
| Otto 对话（`otto-stream:*`，`OttoTurnTrace.settledInternal` 同源） | 8 轮 | 189 | 18.9 |
| 生成（4 条成功 job；失败那条净 0） | 5 条 | 140 | 14.0 |
| 自动理解（`understanding:*`） | **3 笔** | 3 | 0.3 |

> **对 `run-ledger.md` §4 预算表的一处修正**：理解费是 **3 笔各 0.1**（三次上传各一笔：两张 `upload-normal`、一张 `tiny-80px`），W1 表里只登了 1 笔。总额不受影响（33.2 仍然对得上），逐笔行的归类需以本表为准。

### 供应商成本快照（`spentUsd`，W1 未取，本节补）

`0.035 + 0.3803821875 + 0.035 + 0.035 = **USD 0.4853821875**`（四条成功 job）。失败那条 `spentUsd = null`。
理解侧：`AssetUnderstanding` 三行 `priceInternalSnapshot = 1`（＝商家侧 0.1 credit），`UnderstandingSpendDay(2026-09-11) = 3260 in / 140 out / 3 calls`；**没有** USD 列。
Otto 对话侧：`OttoTurnTrace` 记 `modelId=claude-sonnet-4-6`、`steps`、`toolCalls`、`settledInternal`，**没有** token／USD 回执。
⇒ 与第一轮同一条限制照旧成立：**本轮拿不到可核对的「供应商实际账单」**，不得用商家 credits 或模型默认单价冒充供应商成本；失败那条视频虽然商家全额退款，但供应商侧是否产生成本本轮**无法证明为零**（见 §3 的三次提交）。

---

## §2 登录门逐条查表

### 2.1 三个夹具账号的落库事实

| 邮箱 | `ba_user.id` | `emailVerified` | `name` | `createdAt` | canonical `User.id` | `Organization` | `Membership` |
|---|---|---|---|---|---|---|---|
| `tools@belcort.com` | `pZMe1PRZ…` | t | `tools` | 2026-07-06 14:58:33.200 | `cmr9cigeu0000…` | `founder`（Founder） | owner／active，**1 条** |
| `tools+r2a20260911@belcort.com` | `Cw7acC6L…` | t | **空** | 2026-09-11 12:09:22.703 | `cmtwwya8300…` | `org_cmtwwya8300…`（name 空） | owner／active，**1 条** |
| `tools+r2f20260911@belcort.com` | `AFturvzxL…` | t | **空** | 2026-09-11 13:17:43.678 | `cmtwze6ki00…` | `org_cmtwze6ki00…`（name 空） | owner／active，**1 条** |

- 三个账号**各恰好 1 个 org、1 条 membership**（`count(distinct orgId)=1`、`count(*)=1`）。
- 工作区名为空 ⇒ `SIGNIN-A10`「不替商家瞎起名」那一句 **成立**。

### 2.2 SIGNIN-A9 前半（密码彻底退役）—— PASS

```
SELECT count(*) FROM ba_account WHERE "providerId"='credential';   →  0
SELECT count(*) FROM ba_account WHERE password IS NOT NULL;        →  0
全库 providerId 直方图：google = 1（仅此一行）
```
⇒ 库里**一条口令凭据都没有**，连 `password` 列都全为 NULL。W1 的「七个端点全 404 ＋ 页面无密码入口」在库侧得到闭合。

### 2.3 SIGNIN-A16 大小写归一 —— 库侧三项全对

```
ba_user   中 email <> lower(email) 的行数          → 0
AllowedEmail 中 email <> lower(email) 的行数        → 0
AllowedEmail 里 tools+r2f20260911@belcort.com      → 恰好 1 行，全小写，status=active
```
W1 输的是 `Tools+R2F20260911@Belcort.com`，落库是全小写单行 ⇒ 归一化在写入路径上生效。
**未做的那半句**：同一邮箱换一种大小写**再登一次**验同一 `userId` —— 本轮只登了一次；不过「造出第二行」这条风险已被上面两个零计数排除。

### 2.4 SIGNIN-A3 两扇门一个工作区 —— 成立，但 plan 的期待口径要改

- `tools@belcort.com` 在 `ba_user` **只有 1 行**（createdAt 2026-07-06），`Organization`／`Membership` **各只有一套**。
- `ba_account` 里该 userId 下**只有 1 行**：`providerId='google'`，`createdAt = 2026-09-10 17:26:25`（**晚于** ba_user 三个月）⇒ Google 是**后来挂到既有账号上**的，不是另起一个用户。
- **口径修正**：plan §3.2 期待「`BetterAuthAccount` 有 google 与码门两条来源但同一 userId」。**实现上不成立** —— 码门（邮件验证码）**不写 `ba_account` 行**，全库 `ba_account` 至今只有那 1 行 google。A3 的实质（两扇门进同一个用户、同一个工作区）有证据；「两条 provider 行」这条检查项本身站不住，应在下一版 plan 里改掉。

### 2.5 SIGNIN-A6 暂停新注册 —— 机器侧闭合

W1 的暂停窗口 `12:22:17Z ～ 12:30:04Z`：

```
该窗口内新建 ba_user 行数        → 0
该窗口内新建 AllowedEmail 行数   → 0
```
⇒ 「陌生人看到一样的回执但**真的不建号、不寄码**」在库侧得到独立证明（W1 的 Gmail 零结果是另一路证据）。

### 2.6 SIGNIN-A10 / A17 赠金 —— 仍然验不了，但反向证据是硬的

```
两个新 org（org_cmtwwya…／org_cmtwze…）的 CreditLedger 行数 → 0（连 CreditAccount 行都没有）
signup_grant_claim 全表 4 行；其中 canonicalEmail='tools@belcort.com' 的那一行
  orgId = org_cmts923pm00002mptbuoube0j、createdAt = 2026-09-08 05:49:25.486
```
⇒ `SIGNIN-A17`「赠金只发第一个、幂等键按去掉 `+tag`／点号后的邮箱算」拿到**真实正向证据**：本轮两个 `tools+…` 新号归一化后都撞上 2026-09-08 已占住的那把键，于是一分赠金都没发。
⇒ `SIGNIN-A10`「赠金恰好一笔 `SIGNUP_GRANT_CREDITS`」**本轮仍无法验证**（所有夹具归一化后同一收件箱）。要验必须有一个**基址从未注册过**的可收信邮箱 —— 这是夹具问题，不是产品问题。
⇒ 「上限 50／第 51 个／Sentry 告警」除了未授权批量开号之外，还卡在 **staging 没配 `SENTRY_DSN`**（见 §0）。

### 2.7 SIGNIN-A8 限流（机器侧佐证 FSE-201）

`rate_limit_counter` 现存的键（值是计数，不含任何凭据）：

| key | count | expires (UTC) |
|---|---:|---|
| `signincode:addr\|tools+r2a20260911@belcort.com` | 5 | 13:08:58 |
| `signincode:addr\|tools+r2rl20260911@belcort.com` | 5 | 13:18:32 |
| `authmail:tools+r2a20260911@belcort.com` | 5 | 13:08:59 |
| `authmail:tools+r2rl20260911@belcort.com` | 5 | 13:18:34 |
| 另有 `gen:founder`=7、`otto:founder`=8、`upload:founder`=3、`signup:site`=1、单 IP 一条 | | |

⇒ 服务端**确实**按「地址 × 错码次数」与「地址 × 发码次数」两把独立计数器限流；`ba_verification` 窗口内 **0 行**（码用完即清）。这把 **FSE-201 定成一条纯文案缺陷**：机器已经作废了那个码，只是页面从第 1 次到第 4 次一字不改。

### 2.8 登录审计 —— 行数对，**租户归属是错的（新发现）**

窗口内 `ActionEvent` 里 `type='auth.signin'` **8 行**，每次登录一行（payload 只有 `{"email": …}`）。但是：

```
SELECT "ownerId", count(*) FROM "ActionEvent" WHERE type='auth.signin' GROUP BY 1;
 →  founder | 26        （全表唯一一个 ownerId）
```

`tools+r2a20260911@belcort.com`（org_cmtwwya…）与 `tools+r2f20260911@belcort.com`（org_cmtwze…）的登录审计行，`ownerId` **也写成 `founder`**。
⇒ **登录审计的租户归属全库写死为 `founder`**：行数与 payload 正确、**没有数据泄漏**（payload 只有邮箱），但按 tenant 查审计会全部落到 founder 名下、别的租户查自己的登录记录会是空。
⇒ 这是一条 **W1 走查看不见、只有查表才会暴露** 的后端问题，登记为 **FSE-209 候选**（严重度建议 P2：审计可追溯性，非隔离破口）。findings-catalog 由编排者决定是否补条目，W2 不擅自改那份文件。

---

## §3 Creation：正路、尺寸闸、失败路

### 3.1 FSE-001 正路（R2-11）—— 后端逐格闭合，**PASS**

GenJob `01M287S820V8HZ49Z6RPHP61Q1`（VIDEO / seedance-2-mini / count 1 / attempts 1 / DONE，12:41:21.740 → 12:43:47.478）：

- `entityIds = {01M265PRD50HWEKX2VFGBCF31Y}`，`approvedEntities = [{"id":"01M265PRD50…","name":"Xinyi","type":"CHARACTER"}]`
- `videoOptions = {"seconds":5,"resolution":"720p","aspectRatio":"9:16","audio":false,"referenceGenerationIds":["01M287JD67YMF69X50VTWQWXMB"]}`
- **`sourceGenerationId = NULL`** ⇒ **没有首帧**：商品图是以 `reference` 身份上路的，不是起始帧。
- 确认卡 `01M287R8W4P0ZJASPYH0C31ZMN` 的 `mediaReferences[0].role = "reference"`（对照 §3.3 那张卡是 `"startFrame"`）。
- 引用落盘：USER 消息 `01M287QGY33GYSJVC5ZPNWFPJ5` 的 `referenceRefs = {official-avatar:01M265PRD50HWEKX2VFGBCF31Y, generation:01M287JD67YMF69X50VTWQWXMB}` —— **两件都是真 id**。
- 那个官方演员 id 在 `Entity` 查得到：`type=CHARACTER`、`name=Xinyi`、`catalogKey=actor-v1-xinyi`、有 `baseAssetId`、**2 张未删除 `ReferenceImage`** ⇒ `FRONT-A10` 第三句「不是假条目」**机器闭合**。
- 账本：一条 RESERVE(−110/+110)、一条 SETTLE(0/−110)、无残留 hold。
- 产物 `Generation 01M287XNRRZ4BMNKQM99V2M412` → `Asset 01M287XNQZJV1YHMDBY4Y5HCHZ`，`video/mp4`、**3,228,579 字节**（与 W1 在页面里实拉的字节数逐字相同）。
- worker 日志（按 job id 筛）：`gen job c13bf87d… start (try 1)` → `[gen] 01M287S820V8HZ49Z6RPHP61Q1: DONE → 1 generations via byteplus`，**一次就成**。

> **一处 ID 口径更正（不是缺陷）**：`run-ledger.md` 里写的 `01M287HQC2P1E33C6CDKJXJV04`／`01M287S996PCX2FEGWHTDGJP95`／`01M2882PXJX2DYTZNRTH4KD6ZZ` 是 **CanvasNode id**（页面上取到的），对应的 **Generation id** 分别是 `01M287JD67YMF69X50VTWQWXMB`／`01M287XNRRZ4BMNKQM99V2M412`／`01M2883T98SCJC5CEATFAEN2NF`。后续引用请用本节的 Generation id。

### 3.2 R2-23 ①「本站生成图尺寸有真值」—— PASS（第一轮的 null 已被修掉）

| Asset | 来源 | mime | 字节 | width×height |
|---|---|---|---:|---|
| `01M287JD5WJQ09T7RC5V48SJWX` | GENERATED | image/jpeg | 161,363 | **1728×2304** |
| `01M2883T92MJG8DTFAXF2DJ4A1` | GENERATED（variation） | image/jpeg | 146,870 | **1728×2304** |
| `01M288SEY2SDNHXNE22NFR6YBB` | GENERATED（80px 图生图产物） | image/jpeg | 143,409 | **1728×2304** |
| `01M288NSRD23RTYYVK1GPAZRX0` | UPLOAD `r2-20260911-tiny-80px.jpg` | image/jpeg | 1,709 | **80×107** |
| `01M287XNQZJV1YHMDBY4Y5HCHZ` | GENERATED 视频 | video/mp4 | 3,228,579 | **NULL/NULL/NULL（含 durationS）** |

⇒ 本站生成的**图片**宽高有真值（第一轮为 null 的那一档已闭合）；**视频资产的宽高与时长仍为 null**（W1 的 720×1280 / 5.04s 来自浏览器解码，不是库里的值）。视频那一档不影响本条验收（尺寸闸只看图片参考），照录。

### 3.3 FSE-204 根因 —— **确认：尺寸闸只挂在「video 卡 × referenceGenerationIds」一条路**

三段硬证据串起来：

1. **库里早就知道它多大**：`[ingest] 01M288NSRD23RTYYVK1GPAZRX0: 80x107`（worker 日志，12:56:57Z 上传即量），`Asset.width=80 / height=107` 落库时间 `12:56:57.357Z` —— **早于**两次付费动作（12:58:18 图生图、13:00:06 视频）。所以这不是「读不出尺寸」那一档。
2. **两张确认卡怎么带的它**：

   | 卡 | `payload.kind` | `sourceGenerationId` | `referenceGenerationIds` | `referenceUpscaleNote` |
   |---|---|---|---|---|
   | `01M288QTS1XC8V1PR1P9NJAY2T`（图生图） | **image** | `01M288GW175…` | `["01M288J21J…","01M288NSRH…（80px）"]` | **无** |
   | `01M288TQE27AF4SP7QF1895BAP`（视频起始帧） | video | **`01M288NSRH…（80px）`** | **无** | **无** |

3. **闸的代码**（`git show 2a96750e:packages/otto/src/skills/reference-upscale-gate.ts`，`applyReferenceUpscaleGate` 函数体内）：

   ```ts
   const videoReferenceIds = payload.kind === "video" ? (payload.referenceGenerationIds ?? []) : [];
   if (videoReferenceIds.length === 0) return { payload };
   ```

   而起始帧那一档在 `propose.helpers.ts` 里写的是 `isI2V ? [{ id: ctx.sourceGenerationId!, role: "startFrame" }]` —— **起始帧走 `sourceGenerationId`，闸不读那一格**。

⇒ 两个入口各自绕过闸的**不同**理由：
- **图生图卡**：`payload.kind === "image"` ⇒ 闸第一行就 return，**整条路从来没进过闸**（哪怕它的 `referenceGenerationIds` 里确实挂着那张 80px 图）。
- **视频起始帧卡**：卡是 video，但那张图在 `sourceGenerationId` 而不在 `referenceGenerationIds` ⇒ `length === 0` ⇒ 闸照样第一行 return。

**⇒ FSE-204 从「假说待确认」升级为「根因已确认」**，且验收正文「付费前尺寸闸唯一一份、没有一条入口绕得过去」在本版**不成立**：闸事实上有三条路，只挂住了其中一条。建议严重度 **P1**（钱路：一条路真扣了 1 credit）。

### 3.4 失败那条视频：供应商说了原因，商家一个字没看到（FSE-204 的另一半）

worker 日志（按 job id 筛，逐字，仅保留非机密部分）：

```
[worker] gen job 0ac3d9fe-… start (try 1) { genJobId: '01M288VJS12BBT536TZF5T0S01' }
generation provider video submit failed: { status: 400,
  detail: '{"error":{"code":"InvalidParameter","message":"Error while downloading image, error:
           expected the width to be at least 300px, but received a 80x107px image instead …"}}' }
[gen] 01M288VJS12BBT536TZF5T0S01: retrying — generation provider video submit failed (400)
…（try 2、try 3 逐字相同的 400）…
[gen] 01M288VJS12BBT536TZF5T0S01: FAILED — generation provider video submit failed (400)
```

三件事：

1. **供应商的原话说得清清楚楚**：`expected the width to be at least 300px, but received a 80x107px image instead` —— 与 `packages/core/src/generation-reference.ts` 里的 `MIN_REFERENCE_IMAGE_SIDE = 300`（可放大档 `MIN_UPSCALABLE_REFERENCE_SIDE = 100`）**是同一个门槛**。我们自己的常量早就写对了，只是没在这条路上被调用。
2. **落库的错误信息把原因丢了**：`GenJob.error = "generation provider video submit failed (400)"` —— provider 那句能救命的话**只活在日志里**，没进数据库，所以商家只能看到「没成功」。这是 W1 记的「失败文案不说原因」的**根因**。
3. **一次永久性输入错误被重投了 3 次**（`attempts = 3`，三次逐字相同的 400，从 13:00:06 拖到 13:02:28 才终态）。第一轮 byteplus 适配器把这类归为 `permanentInputError`；本轮这条 400 **没有**被归入永久错误。商家侧全额退款（spent=false），但三次提交是否在供应商侧产生成本**本轮无法证明为零**。建议一并交 S5。

### 3.5 R2-15 variation / R2-12 CREATE-A12（报价与逐字一致）

- variation job `01M2882NQZMF73DB8HQFR7V567`：`idempotencyKey = canvas:035362ae…`（内容哈希形状），`sourceGenerationId = 01M287JD67YMF69X50VTWQWXMB`，一 reserve 一 settle，产物 `Generation 01M2883T98SCJC5CEATFAEN2NF` / `Asset 146,870 字节 / 1728×2304`（与 W1 页面取到的字节逐字相同）⇒ **真实交付 PASS**。
- **报价 = 实扣**（四张卡逐张核）：

  | 卡 | kind | 卡面 `estimatedCredits` | 账本 RESERVE(internal) |
  |---|---|---:|---:|
  | `01M287G9V67F4YZ941QXE9SKRH` | image | 1 | −10 |
  | `01M287R8W4P0ZJASPYH0C31ZMN` | video | 11 | −110 |
  | `01M288QTS1XC8V1PR1P9NJAY2T` | image | 1 | −10 |
  | `01M288TQE27AF4SP7QF1895BAP` | video | 11 | −110 |

  ⇒ 四张卡**零偏差**（`INTERNAL_PER_DISPLAY` 一致）。
- **CREATE-A12「`sentPromptText` 与批准稿逐字一致」**：
  - 两张卡**整串完全相等**（`card.structuredPrompt = Generation.sentPromptText`，608/608 与 1060/1060，SQL 等值判定为 true）。
  - 第三张（图生图卡）不等长（卡 477 → 送出 578）：但卡上那 477 字**原封不动地整段出现在送出稿里**（`position()` 判定：从第 **102** 个字符起完全一致）。多出来的 101 字是机器加的图位声明前缀 `<Image_1> is the image being edited. <Image_2> is a reference image. <Image_3> is a reference image.`。variation 那条同形（源稿从第 **38** 字起逐字保留）。
  ⇒ **商家批准的那串字一个都没被改**，加的是确定性的图位声明。判 **PASS**，但这一句差异建议在卡面或规格里说明，免得下一轮判官把它读成偏差。
- `routeReason` 在本轮 4 条 Generation 上**全为 NULL**，`finalPromptText` 全为空 ⇒ plan 里「`routeReason` 有值」这一格**不成立**（登记为口径问题，交 S5 裁是要填还是要从验收里去掉）。
- **双击只一条 job**：本轮 W1 未做双击，故**无现场证据**；机器侧可说的只有幂等键形状（`cowork:<messageId>` / `canvas:<内容哈希>`，都可判重）。不写成已验证。

### 3.6 R2-13 / CREATE-A11：纯规划轮 `toolCalls` 为空 —— PASS（一个干净样本）

`OttoTurnTrace`（窗口内 8 轮，全部 `modelId=claude-sonnet-4-6`）：

| refId | steps | toolCalls | settledInternal |
|---|---:|---|---:|
| `otto-stream:01M289QWH14MR2A40XPTC4RNST`（13:15:34，R2-22「明说要两步」那一轮） | 1 | **`[]`** | 22 |
| 其余 7 轮 | 2–4 | `propose` / `seedreamPrompt` / `seedancePrompt` / `describeRefs` / `lookupProducts` / `proposeStoryboard` / `setTitle` | 8–39 |

⇒ 那一轮 **`toolCalls` 为空、零 GenJob、账本只有对话那一笔** ⇒ `CREATE-A11 相邻样本` **PASS**（一个样本）；同时这也是 **R2-22「产品面发不出首帧＋演员那个组合」** 的机器证据（零卡、零 job、零生成账本行）。

### 3.7 R2-17 花费上限 —— 机器侧闭合

- 两次 cap 拒绝发生在 13:11 左右。账本里 **13:06:13.798Z 到 13:15:34.390Z 之间零行**（`SELECT count(*) → 0`），`GenJob` 在 **13:00:06 之后再无新行**（`count → 0`）。
⇒ 「被 cap 拦下 ＝ 零新 GenJob、零新账本行」**成立**（两个入口）。
- 还原核对：`Organization('founder').settings` 现为 `{"spendCapCredits": 0, …}` ⇒ W1 的两步确认移除**已落库**。

### 3.8 R2-24 分镜 —— BLOCKED 的那三格确实零写入；⑤ 只有代码证据

- 窗口内 **`Shot` 表 0 行**、`GenJob.shotId` 全为空 ⇒ Otto 交出的那张分镜草稿卡**还没落成 Shot 行**，所以 `Shot.referenceGenerationIds`（实际存于 `promptDoc`）与 `GenJob.videoOptions.referenceGenerationIds` **本轮没有可查的现场值**。这与 W1 的 BLOCKED 判定一致，并额外证明：那三格**没有产生任何写入、任何扣费**。
- **⑤ 跨租户 `setShotReferences`（未执行，只给代码指针）**：`apps/web/lib/storyboard-actions.ts:144` 起 —— 先 `requireOwner()` 拿服务端 principal（**租户身份只来自服务端，不从入参收**），再 `loadCard(cardId, ownerId)`（别家卡直接 `Card not found.`），任何**新增**的 id 必过 `resolveOwnedReferenceRefs(ownerId, refs)`，`unresolved > 0` 即整次拒绝并逐字回 `Nothing was changed.`。
  ⇒ 这是**代码形状**上的 fail-closed 证据，**不能替代**一次真实跨租户构造。本格维持 **BLOCKED**。

---

## §4 产品身份（Brand ↔ Library）

### 4.1 PRODID-A1 / A4 / A6③ —— 库侧闭合

```
Entity      01M287A4JC1ZC19MDM633HJ6E1  ownerId=founder  type=PRODUCT  name='R2 Coral Tumbler RENAMED'
            createdAt 12:33:06.638   updatedAt/deletedAt 13:14:48.608/.609
BrandRecord 01M287A4JK5NT95CEXHW99EVNR ownerId=founder  kind=product  nameKey='r2 coral tumbler renamed'
            entityId = 01M287A4JC1ZC19MDM633HJ6E1   data.price='RM 79'  origin=manual
            createdAt 12:33:06.644   deletedAt 13:14:48.608
全库 name ilike '%R2 Coral Tumbler%' 的 Entity 行数 → 1（改名后没有造出第二个身份）
```
- **PRODID-A1**：`BrandRecord.entityId = Entity.id`，两行相隔 6 毫秒同批建立 ⇒ **PASS**。
- **PRODID-A4（Brand → Library 方向）**：改名后全库仍**只有一行** Entity ⇒ **PASS**（反向 Library→Brand 仍 NOT RUN：Library 侧无改名入口）。
- **PRODID-A6 ③（Library 删 → Brand 消失）**：两行的 `deletedAt` **是同一个时间戳** `13:14:48.608` ⇒ 一次软删同时盖住两面 ⇒ **PASS**；已生成的 5 个 CanvasNode／对应 Generation `deletedAt` 全为 NULL ⇒ 「成片一行不动」**PASS**。

### 4.2 PRODID-A8 中间那句 —— PASS

```
SELECT count(*) FROM "BrandRecord" WHERE kind='product' AND "deletedAt" IS NULL;              → 1
  其中 entityId IS NULL 的行数                                                                 → 0
再查悬挂：live BrandRecord.entityId LEFT JOIN Entity 查不到对应 Entity 的行数                   → 0
```
⇒ **非草稿 product 行 `entityId` 全非空，且都指向真实存在的 Entity**（唯一那行是第一轮另一个租户的 `e2e coral travel mug`，`entityId = prodid_01M1ZSPT…`，Entity 确实存在 —— 第一轮记的「Brand 产品不进 @Products、没有 Entity」那个缺口，在本版**已经补上了 entityId**）。

### 4.3 PRODID-R4 —— NOT RUN 的理由已被查表坐实

`ownerId='founder'` 的 `BrandRecord kind='product'` 全表**只有本轮建的那 1 行**（且已删）。⇒ 「存量无价签产品卡」**库里根本没有样本**，W1 的 NOT RUN 不是漏做，是不可构造。

### 4.4 FSE-206 根因 —— Archive 只动 BrandRecord，`@` 菜单读的是 Entity

- 库侧：那件产品**整个生命周期里只有 1 次 `entity.update`**（`ActionEvent` 13:14:48.624，就是删除那一次）。W1 在 13:13 前后的 Archive／Unarchive **一次都没有碰过 Entity 行**（Entity.updatedAt 始终是删除那一刻）。
- 代码侧：`apps/web/lib/reference-search.ts` 的 `entityRows()` 查询条件只有 `ownerId` ＋ `deletedAt: null` ＋ `type`，**不读 `BrandRecord.status`**。
- 文案侧：`apps/web/components/otto/memory/ProductShowcase.tsx:575` 逐字 `Archived ({archivedCount}) — hidden from Otto`。
⇒ **FSE-206 根因确认**：归档只改 `BrandRecord.status`，而 Otto 的 `@` 选择器查的是 Entity，两边没有接线。「hidden from Otto」是一句**做不到的承诺**（Founder「说了做不到＝根性缺陷」那一条）。修法二选一（留给 S5）：归档时同步一个 Entity 侧的可见性判据，或把文案改成它真正做到的事。

### 4.5 新发现：产品身份**没有**进入生成谱系（PRODID-A2 后半不成立）

同一条画布上，**产品**与**演员**的待遇不一样：

| 轮次 | USER 消息 | `referenceRefs` | `payload.entityIds` | 卡 `entityIds` | GenJob `entityIds` / `approvedEntities` |
|---|---|---|---|---|---|
| @产品出图（seq 1） | `01M287EKZ62CBWH5N8TTXTEW98` | **空** | `["01M287A4JC1ZC19MDM633HJ6E1"]`（产品 Entity） | **`[]`** | **`{}` / NULL** |
| @演员+@生成图出片（seq 7） | `01M287QGY33GYSJVC5ZPNWFPJ5` | `official-avatar:…`,`generation:…` | `["01M265PRD5…"]`（Xinyi） | `["01M265PRD5…"]` | `{01M265PRD5…}` / `[{Xinyi,CHARACTER}]` |

- 产品那一轮，Otto 调了 `lookupProducts`（`OttoTurnTrace` 12:35:56 那一行逐字可查），把产品**写成了提示词文字**（`sentPromptText` 开头 `R2 Coral Tumbler reusable travel mug, standing upright, …`），但**产品的 Entity id 没有跟到卡面，也没有跟到 GenJob**。
- 服务端**没有**按类型硬过滤（`propose.helpers.ts:942` 的 `=== "CHARACTER"` 只是在**计数**，不是在筛卡面 `entityIds`）⇒ 更像是 `propose` 的入参里就没带上产品 id，而不是被服务端丢掉。**这一点未被完全证死**（没有留存那一次 tool 调用的原始入参），故按证据分级写成「已证：谱系里没有；未证：是谁丢的」。
- 另一处同族现象：seq 1 那条消息的 `referenceRefs` 为**空**（它是从首页 composer 走 `canvas.create-handoff` 进来的第一条），而在画布里敲的 seq 7／17／21 三条都有 `referenceRefs` ⇒ **交接那条路把 typed ref 丢了**。

⇒ 影响验收：`PRODID-A2`「谱系 `approvedEntities` 同一 id」**机器判定为不成立**（菜单来源标签与选入那半句 W1 已 PASS）。登记为 **FSE-210 候选**（建议 P2，直接关系 Founder「有迹可循」那条原则：商家事后无法从成品回溯到那件产品）。同样交编排者决定是否入 findings-catalog。

---

## §5 隔离与深链

### 5.1 PRODID-A9 读路 —— 库侧闭合，写路仍未执行

第二租户 `org_cmtwze6ki00002mloc8n729xj` 在库里的**全部**足迹：

```
Project 1（就是深链那次新建的那张空画布）   GenJob 0   Generation 0   CanvasNode 0
ChatMessage 0   BrandRecord 0   CreditLedger 0   Entity 5（播种的官方演员）   Asset 10（演员参考照）
指向租户 A 画布 canvas_c878814e-… 的非 founder 行数 → 0
```
⇒ 第二租户**一个字节的租户 A 数据都没碰到**，与 W1 三面零命中互证。
写路（拿 A 的 `entityId` 构造写入）**仍未执行**；代码侧可给的指针：`reference-search.ts` 的 Entity 查询按 `ownerId` 收口，`brand-record-actions.ts` 的 Entity 写入 `where` 同时带 `id` 与 `ownerId`（`:284`、`:354`）。**代码形状不能替代一次真实越权尝试**，本格维持 PARTIAL。

### 5.2 FSE-207 深链 —— 「无泄漏、有写入」在库里逐格坐实

| 事实 | 证据 |
|---|---|
| 租户 A 的画布**一个字都没被动** | `Project canvas_c878814e-…` 仍 `ownerId='founder'`，`updatedAt = 12:35:31.204` **＝ createdAt**（深链发生在 13:18，之后没有任何更新） |
| 访问者那边**真的新建了一个对象** | `Project 01M289WJEET9N9H30NB2ENYPW6`，`ownerId=org_cmtwze6ki…`，`name='New canvas'`，`createdAt = 13:18:07.823` |
| 这次新建有审计 | `ActionEvent type='project.create'`，`ownerId=org_cmtwze6ki…`，13:18:07.829 |
| 没有泄漏 | 该租户 CanvasNode／ChatMessage／Generation 全为 0（见 5.1） |

⇒ 规格 `:172④` 要的是「整卡 fail closed、**零写入**、不静默回退造新对象」。现状是：**没有越权读**，但**确实静默造了一个新对象**（写在访问者自己租户内）。**FAIL 判定维持**，性质澄清为「归属正确的多余写入 ＋ 零告知」，不是隔离破口。

---

## §6 FSE-202（余额广播）—— 机器裁定：**侧栏是对的，Billing 正文是错的那一个**

W1 在 `12:46:44Z` 与 `12:47:20Z` 两次读数：侧栏 9,999,885.7 / 正文 9,999,886.7 / 正文 `On hold 11 credits held`。
把账本按时间累进还原出**当时库里的真值**：

| 时刻 (UTC) | 事件 | balance (internal) | = displayed | reserved (internal) |
|---|---|---:|---:|---:|
| 12:43:46.865 | 视频 SETTLE | 99,998,867 | 9,999,886.7 | 0 |
| **12:46:30.687** | **variation RESERVE −10/+10** | **99,998,857** | **9,999,885.7** | **10（= 1 credit）** |
| 12:47:08.089 | variation SETTLE | 99,998,857 | 9,999,885.7 | 0 |

⇒ 在 W1 读数的那两个时刻，**库里的真值就是 9,999,885.7**。
- **侧栏（广播驱动）＝ 正确**；
- **Billing 正文 9,999,886.7 ＝ 落后一笔（差 1 credit）**；
- 正文的 `On hold 11 credits held` **错得更远**：那 110 internal 的视频 hold 早在 12:43:46 就清了，当时真正挂着的是 **1 credit（10 internal）**，12:47:08 之后是 0。
⇒ FSE-202 由「同屏两个数不一致」升级为「**正文那一格是陈旧值、侧栏是对的**」，修哪一边已无歧义：广播只驱动了侧栏，Billing 正文（含 `On hold` 与 `Spend history`）没有订阅。

---

## §7 FSE-205（`retry-source` 那一行不出现）—— 根因链已闭合，并给出可证伪的复现路

只读代码链（全部 `2a96750e`）：

1. `apps/web/lib/turn-reference-draft.ts:212` —— `turnReferenceDraftFromMessage()` **会**写 `sourceMessageId: meta?.durableId ?? message?.id ?? null`。
2. `apps/web/components/otto/OttoChatStream.tsx:610–613` —— `liveRetryDraft()` 的兜底分支把 `sourceMessageId` **写死为 `null`**（直播那一刻手上的 USER 消息只是 `sendMessage({text})` 的乐观回显，没有 metadata）。
3. `apps/web/components/otto/OttoChatStream.tsx:1278–1281` —— 画布上那颗 `Edit and retry` 用的是 `richerTurnReferenceDraft(retryDraftFrom(messages), retryDraft)`。
4. `apps/web/lib/turn-reference-draft.ts:239–241` —— `richerTurnReferenceDraft` **只比「有没有引用」**：消息那份没引用、直播那份有引用时，**返回直播那份**（`sourceMessageId = null`）。
5. `apps/web/components/otto/OttoChatStream.tsx:1299` —— `retrySourceId = restoredDraft?.sourceMessageId ?? null`；为 null 就整行不渲染。
   （`retrySourceNote()` 本身永不返回空串：取不到原话会回 `Retrying an earlier message` —— 所以「那一行没出现」**只可能**是 `sourceMessageId` 为 null。）

W1 的现场正好落在这一格：**失败后没有刷新就直接点了 Edit and retry**，此时 `messages` 里是乐观回显（无 metadata、无引用），而直播草稿有引用 ⇒ 第 4 步选中直播那份 ⇒ 那一行永不出现。
（旁证：那条 USER 消息 `01M288T5X910FDYH4464XJEVRM` 在**库里**是有 `referenceRefs` 的 —— 所以「刷新之后」那条路读得到 metadata。）

**可证伪的复现路（留给下一轮，零花费）**：先刷新页面，再点失败卡上的 `Edit and retry` —— 走 `durableRetryDraft`（`OttoChatStream.tsx:1848–1855`，`turnReferenceDraftFromMessage` 带 `sourceMessageId`），那一行**应当出现**。若刷新后仍不出现，才是另一条根因。
⇒ 判定建议：从「未复现／路径待确认」改为 **PARTIAL（根因已定位，复现条件明确）**，不改判 PASS（`:163②` 的 `Remove` 只清这一格那半句仍未验）。

---

## §8 本轮没能查的、以及不许被读成已验的

1. **供应商实际账单**：只有应用侧 `spentUsd` 快照与 `billedUnits`，没有发票。Otto 对话轮**连 token 回执都没有落库**。不得用商家 credits 或型号默认单价冒充。
2. **失败视频的供应商成本**：三次 400 提交，`spentUsd=null`。`null` **不等于**「已核对供应商零账单」。
3. **双击并发**：本轮无现场双击，幂等键形状不等于并发验证。
4. **跨租户写入**（PRODID-A9 后半、R2-24⑤）：只有代码形状证据，没有真实越权尝试。
5. **登录门 Google 那一族**（A2／A13／A14／A12／A3 的 Google 半边）：夹具不足，库里也没有可查的痕迹可推定。
6. **15 分钟码过期**（A5 末段）：`ba_verification` 窗口内 0 行，看不出过期路径；未执行就是未执行。
7. **本轮之后 staging 已换版**（§0）：本文件的所有代码行号、闸的形状、失败分类，都只对 `2a96750e` 成立；`b30b7b6f` 上必须重验。

---

## §9 本文件用到的查询清单（全部只读）

| # | 目的 | 形状 |
|---|---|---|
| 1 | 连接与只读核对 | `select current_database(), current_setting('transaction_read_only')` |
| 2 | 表清单 | `information_schema.tables` |
| 3 | 列形状（10 张 + 13 张） | `information_schema.columns` |
| 4 | 三个夹具的 `ba_user` | `select id,email,"emailVerified",name,"createdAt" from ba_user where lower(email) in (…)` |
| 5 | 大小写归一 | `count(*) where email <> lower(email)`（`ba_user`、`AllowedEmail` 各一次） |
| 6 | `ba_account` 直方图 / credential 计数 / password 非空计数 | `group by "providerId"`；`count(*) where "providerId"='credential'`；`count(*) where password is not null` |
| 7 | `AllowedEmail` 逐行 | `where email ilike 'tools%belcort.com'` |
| 8 | canonical `User` / `Membership` / `Organization` | 三表 join，按邮箱筛 |
| 9 | 每人 org／membership 计数 | `count(distinct "orgId")`、`count(*)` |
| 10 | `CreditAccount` 快照 | `where "orgId"='founder'` 与按 membership join |
| 11 | 新 org 的赠金 | `CreditLedger` join membership，两个新 org |
| 12 | `signup_grant_claim` | 全表计数 ＋ `canonicalEmail ilike 'tools%'` |
| 13 | `GenJob` 全字段（窗口内） | `where "createdAt" >= '2026-09-11 12:00:00'` |
| 14 | `CreditLedger` 逐行（窗口内） | `where "orgId"='founder' and "createdAt" >= …` |
| 15 | **账本不变式违例扫描** | `group by "refId" having reserves<>1 or settles+refunds<>1 or sum("reservedDelta")<>0` |
| 16 | job ↔ 账本对账 | 每个 job 的 reserve／settle／refund 计数子查询 |
| 17 | `Generation`（窗口内） | 含 `sentPromptText` 长度、`routeReason`、`finalPromptText` 长度 |
| 18 | `Asset`（窗口内） | 含 `width`／`height`／`durationS`／`sizeBytes`／`originalFilename` |
| 19 | `AssetUnderstanding`（窗口内） | 含 `priceInternalSnapshot`／`moneyRefId`／token 数 |
| 20 | `ChatMessage` 非空 `referenceRefs` | `array_length("referenceRefs",1) > 0` |
| 21 | `ChatMessage` 全部 USER 行 | 含 `payload->'entityIds'`／`payload->'sourceGenerationIds'` |
| 22 | `ChatMessage` GEN_CARD payload | `payload->>'kind'`／`sourceGenerationId`／`referenceGenerationIds`／`estimatedCredits`／`referenceUpscaleNote`／`mediaReferences` |
| 23 | 卡面报价 ↔ 账本预扣 | GEN_CARD join GenJob(`idempotencyKey='cowork:'||id`) join CreditLedger |
| 24 | 逐字一致 | `card.structuredPrompt = g."sentPromptText"`；`position(card in sent)` |
| 25 | `OttoTurnTrace`（窗口内） | 含 `toolCalls` 数组长度与原文、`settledInternal` |
| 26 | `Entity` / `BrandRecord` 同步 | 按 name／nameKey 查，含 `entityId`、`deletedAt` |
| 27 | PRODID-A8 | live product 行的 `entityId is null` 计数 ＋ 悬挂 join 扫描 |
| 28 | `Project` / `CanvasNode`（窗口内） | 深链与节点归属 |
| 29 | 第二租户足迹 | 9 张表各一次 `count(*) where ownerId=<org F>` |
| 30 | `Shot`（窗口内） | 0 行 |
| 31 | 暂停窗口写入 | `ba_user`／`AllowedEmail` 在 12:22:17–12:30:04 的计数 |
| 32 | `ActionEvent`（窗口内） | 按 `ownerId`,`type` 分组 ＋ `auth.signin` 逐行 ＋ 全表 `auth.signin` 的 ownerId 分布 |
| 33 | `rate_limit_counter` | 逐行 key／count／过期时间 |
| 34 | `Organization.settings` | cap 还原核对 |
| 35 | `UnderstandingSpendDay` | 近三天 |
| 36 | 余额时间线还原 | 账本累进窗口函数（§6 那张表） |
| 37 | cap 窗口零行 / 13:00 后零 job | 两个 `count(*)` |

Railway 侧：`deployment list`（web／worker 各一次，`--json`）、`logs <deploymentId> -d --lines`（worker 按 job id 筛两次、web 一次全文）、`variables --json`（web／worker／Postgres 各一次，**只取键名与形状，值未落盘未回显**）。
