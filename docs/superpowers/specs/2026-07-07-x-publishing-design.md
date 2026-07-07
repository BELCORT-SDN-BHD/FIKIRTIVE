# X(Twitter)自动发布 —— 设计 spec(冲刺 B 线,2026-07-07)

> **性质**:施工图层(蓝图金字塔最下层)。依据 = founder 2026-07-07 产品判决:X 采纳为新渠道、用户 OAuth 模式、平台养开发者应用(判决记录「追加判决(2026-07-07 第三批)」②);credits = 平台唯一硬通货(同批③)。
> **走的缝**:渠道缝(`docs/review/EXPANSION-SEAMS.md` Seam 4,Meta 为范本)+ 记账缝(Seam 3)+ 队列缝(Seam 6)+ parity(缝 9)。
> **状态:待 founder 过目后动工。本文件只是图纸,不含任何代码。** 一切真实 X API 花费(含开发验证)逐笔问 founder(宪法 2)。

## 名词对照(人话)

| 术语 | 人话 |
|---|---|
| OAuth 2.0 + PKCE | 用户点"连接 X 账号"跳到 X 官方授权页点同意;PKCE 是防授权码被半路截走的加密扩展,X 强制要求 |
| pay-per-use credits | X 官方的按次计费:BELCORT 先充值进 X 开发者账户,发一条扣一条的钱 |
| COGS | 我们付给 X 的真实成本(成本价) |
| kill-switch | 一键停用全部 X 发布的开关(照 Meta 连接的 adsWritesPaused) |
| refresh token | 长期钥匙:X 的临时钥匙每 2 小时过期,用长期钥匙自动换新,用户不用重连 |

## 一、目标

1. **X = FIKIRTIVE 第一个端到端"真发布"渠道。** 排期区 UI(3 视图 + Composer + ScheduledPost 数据模型 + PublishAttempt 防双发)已通电,但实发布 worker 一直断电等 Meta App Review 钥匙。X 不需要人工 App Review(注册即发钥匙,见 §三),所以 X 能第一个把「草稿 → 排期 → 审批 → 真的发出去」整条管线点亮。
2. **管线是平台可插拔的,不是 X 专用的。** 发布 worker、防双发、审批、配额全部写在渠道无关层;X 只是第一个插上的 adapter。Meta App Review 批复后,FB/IG 用**同一条管线**接入(加 adapter,不改核心)—— 这正是蓝图第六章"发布基建必须平台可插拔"的判决。
3. **双模照旧**:人工可在排期区全操作;Otto 用既有 `schedulePosts` skill 起草(只建 DRAFT,$0),经人工确认后发布。

## 二、事实核查 —— X API 现状(2026-07-07 核实)

> 来源均为 X 官方开发者文档(developer.x.com 现跳转 docs.x.com);第三方背景佐证单独标注。**价格标注"subject to change",落地一律进 config 层(宪法 5)。**

**计费模式(重大变化)**:X 已废除 Free/Basic($200/月)/Pro($5,000/月)档位制,新开发者只有 **pay-per-use**(预充值、按次扣、无月费、无最低消费,console.x.com 购买;买 X API credits 最高返 20% xAI API credits)。旧档位仅存量客户保留。
来源:https://docs.x.com/x-api/introduction 、https://docs.x.com/x-api/getting-started/pricing (官方);档位停售时间 2026-02-06 为第三方报道佐证(postproxy.dev / wearefounders.uk,2026-07-07 检索)。

**按次价格(官方 pricing 页,2026-07-07 核实)**:

| 动作 | 单价(USD) | 备注 |
|---|---|---|
| 发一条贴(不含链接) | **$0.015** | 文字/图/视频同价 |
| 发一条**含 URL** 的贴 | **$0.200** | 13.3 倍!营销贴常带链接,是本 spec 最大的成本地雷 |
| 发回应贴(summoned) | $0.010 | 本期不用 |
| 读贴 | $0.005/条 | 读自己的数据(owned reads)降为 $0.001/条 |
| 读用户 | $0.010/条 | 连接时取 profile 用 |
| 媒体 metadata | $0.005/次 | 可选(alt text 等) |

**速率上限(官方 rate-limits 页)**:`POST /2/tweets` = **每 app 10,000 条/24h(全平台共享)+ 每用户 100 条/15min**;媒体上传 `POST /2/media/upload` = 每 app 50,000/24h,分块上传(initialize/append/finalize)= 每 app 180,000/24h。
来源:https://docs.x.com/x-api/fundamentals/rate-limits

**媒体上传(v2 已齐)**:图 = 简单上传;视频 = 分块 INIT→APPEND→FINALIZE→STATUS 轮询(异步转码 pending→succeeded/failed);拿到 media_id 挂进发贴请求。类别 tweet_image / tweet_gif / tweet_video。
来源:https://docs.x.com/x-api/media/quickstart/media-upload-chunked

**OAuth 2.0 用户授权(官方 authentication 页)**:Authorization Code + PKCE;授权页 `https://x.com/i/oauth2/authorize`,换 token `POST https://api.x.com/2/oauth2/token`;scopes:`tweet.read tweet.write users.read media.write offline.access`;access token **2 小时过期**,带 `offline.access` 才发 refresh token;我们是 confidential client(server 持有 client secret)。
来源:https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code

**接入门槛(官方 getting-access 页)**:console.x.com 用 X 账号注册开发者账户 → 接受协议 → 建 app(名称/描述/用途)→ **即时发凭证,无人工审核期**。合规约束 = X Automation Rules + Developer Policy(违规可被封 app → kill-switch 与状态监控必备)。
来源:https://docs.x.com/x-api/getting-started/getting-access

## 三、用户模式:用户永不需要自己的 API

- **BELCORT 养一个 X 开发者应用**(console.x.com 注册、预充 X API credits)。充值 = 平台级采购 = money-in 性质,founder 亲自操作/批准,Otto 与 agent 永不代办。
- 用户只做一件事:在 Connections 页点「连接 X」→ X 官方授权页 → 同意 → 回来。**用户看不到任何 API key**,与 Meta 连接的体验完全一致。
- X 按次费由 BELCORT 的开发者账户出;对用户的收费用 FIKIRTIVE credits(§五),两边永不直连。

## 四、架构:照抄 Meta 范本(Seam 4),差异点明示

**照抄不动的**:
- **OAuth 路由**:`/api/x/authorize`(requireOwner → `signState(ownerId)` → 授权 URL)+ `/api/x/callback`(requireOwner → `verifyState` → **`verified.ownerId === gate.ownerId`** → server 侧换 token → upsert 连接 → 重定向 connections 视图)。`signState`/`verifyState` 原样复用(HMAC CSRF state,10 分钟 TTL,constant-time 比较)。
- **XConnection 表**(照 MetaConnection):`ownerId @unique` + Cascade FK 显式写进 schema、`accessTokenEnc`/`refreshTokenEnc` AES-256-GCM(token-encryption,永不明文、永不下发客户端)、`scope`、`status`(active/expired/revoked)、**capability 布尔 `canPost`**(仅当 X 真的授了 `tweet.write`+`media.write` 才 true)、**kill-switch `publishPaused`**(true 时 executor 拒绝一切发布)、`tokenExpiresAt`。入 TENANT_MODELS(缝 5)。
- **adapter + registry**:`lib/channels/x.ts` 实现 `Channel` 接口 → `registerChannel(x)`;Connections UI 与排期面吃 registry,零 per-channel UI 分叉。capabilities 按 §二 官方数据填。

**与 Meta 的三个差异(施工要点)**:
1. **PKCE**:authorize 时生成 code_verifier,server 侧与 state 绑定暂存(不下发客户端),callback 换 token 时带上。
2. **短命 token + refresh 轮换**:Meta 是长期 token;X 是 2h + refresh(X 每次刷新会**轮换** refresh token)。发布 worker 执行前若过期先刷新,**新旧 token 原子换写 + 每 org 单飞(防并发刷新竞态)**;刷新失败 → status=expired → 该贴 NEEDS_ATTENTION,提示用户重连。
3. **token 解密要进 worker**:token-encryption 目前在 apps/web/lib;发布 worker 也要用 → 抽到 packages 层共用(web 不许被 worker 反向 import)。具体落位在施工 plan 定。

## 五、成本与收费(costing 先行,宪法 5)

**COGS(每条贴,BELCORT 付给 X)**:不含链接(文字/图/视频)≈ **$0.015–0.02**;含链接 ≈ **$0.205**。记账单位:1 显示 credit = $0.10 = 10 internal。

**毛利地板 ≥45% 下的 N 区间**(售价 ≥ COGS/0.55):

| 贴型 | COGS | N 下限 | 建议区间 | 参考毛利 |
|---|---|---|---|---|
| 不含链接 | ≤$0.02 | 0.4 cr → 最小整数 1 cr | **N ∈ [1, 2] cr** | 1 cr = 80% |
| 含链接 | $0.205 | 3.73 cr → 4 cr | **N ∈ [4, 6] cr** | 4 cr = 48.75%,5 cr = 59% |

**选项 A —— 每条 N credits(分两档)**:不含链接 1 cr / 含链接 4 cr(区间见上表)。链接检测是确定性的(server 在审批时刻扫 caption 里的 URL),报价在确认页明示(宪法 3 计费透明)。
**选项 B —— 计入未来席位**:席位订阅含每月 N 条发布配额(**必须有配额上限 —— "席位含无限发布"直接违反宪法 8 永禁 unlimited**)。但席位档位的 costing 还没闭合,B 现在无处挂。

**推荐:A(分两档),理由**:①credits = 平台唯一硬通货(founder 2026-07-07 判决③),发布是"我们的服务"走 credits 账道 —— X 收的是 BELCORT 应用的费、用户没有自己的 X 账单,不属于宪法 5 的"代收过路费",故不走通道费账道;②X 自己就按条计费,per-post credits 与成本结构同构,毛利可控;③链接贴成本 13.3 倍必须分档传导 —— 摊平会让纯文字贴为链接贴买单,违反效率良心条款;④B 可后置:席位 costing 闭合后把"每月含 N 条"做成营销包装,与 A 不冲突。**——以上标「待 founder 拍板」:A / B / A+B 及 N 的取值由 founder 定,数字一律进 config 层,永不硬编码。**

**dogfood 边界(免费档已不存在)**:X 已无免费档,dogfood 直接烧真钱,但极便宜:每月 100 条纯文字/图 ≈ $1.50–2;若全带链接 ≈ $20。开发/验证期每一笔真实调用照宪法 2 逐笔问 founder。
**"升档触发指标"已失效,替代 = 余量告警**:pay-per-use 没有档可升;照"BytePlus 资源包余量告警"模式做 **X API credits 余量 + 日用量告警**(admin/cost 展示 + worker 定时查,阈值进 config)。余额烧干 = 发布静默失败,这是必备护栏不是可选项。

## 六、每用户配额(app 额度全平台共享)

- X 的 10,000 条/24h 是 **per-app 上限,全体 FIKIRTIVE 租户共享** → 必须有 per-org 配额防止单租户吃光全平台额度。
- **per-org 每日发布配额进 config 层**(RuntimeConfig,key + zod + env fallback):建议默认 **25 条/org/24h**(与 IG adapter 已有的 rateLimitPer24h: 25 同构),admin 可调。超配 → 拒绝排入当日,给出人话提示。
- 平台级:worker 统计当日全平台发布数,逼近 app 上限的 80% 告警(同 §五 告警面)。X 侧 per-user 100/15min 远高于我们的用量,不做额外处理。

## 七、审批语义:人工排期确认即审批

- **发布 = effect:write + reach:external → needsApproval = true**(宪法 4),没有旁路。
- 审批点 = **人工在排期区点确认**(approveScheduledPost,写 approvedAt):Otto 的 `schedulePosts` 只建 DRAFT($0、不可发);DRAFT → SCHEDULED 必须人手过审批动作;worker 只发 SCHEDULED 且 approvedAt 非空的贴。**审批发生在排期确认时刻,worker 之后的执行不是绕闸** —— 与宪法 4 例外②(routine 预授权)同一原理:授权在前、执行在后、kill-switch 兜底。
- 未来 routine 自动发布(每周一研究 trend → 出贴 → 自发)走已定调的 routine 授权模型,不在本 spec 范围。
- kill-switch(XConnection.publishPaused)在 **executor 执行时刻**检查(不是排期时刻)—— 开了开关,已排期的贴也发不出去。

## 八、parity 登记与两段式 skill(照 Meta 写模式)

- **两段式**:$0 起草(Otto `schedulePosts` 扩 channel:"x",建 DRAFT)→ 人工审批(§七)→ worker 执行(PublishAttempt 防双发)。Otto 永不直接持有"发贴"技能 —— 发布永远经 ScheduledPost 审批管线,这就是 Meta 的 propose→approve→execute 模式在发布域的形态。
- **新 server actions 全部登记 parity manifest**(缝 9,CI 硬拦):连接/断开 X、X targets 读取等;读面照"读的对等"配 free/read skill(Otto 不做瞎子操作员)。
- 缝 1 六处登记(registry / registry.test / migration.test / CATALOG / instructions / parity)照施工模板走。

## 九、能力分期

| 期 | 能力 | 要点 |
|---|---|---|
| X1 | 连接(OAuth + XConnection + adapter + Connections UI)| $0,无发布;验收 = 真实连接/断开/重连 |
| X2 | 文字贴发布通电 | 发布 worker(渠道无关核心 + X adapter)、PublishAttempt、配额、kill-switch、收费接线 |
| X3 | 图片贴(简单上传,≤4 图)| media_id 挂贴;媒体来自已付费 Generation(ScheduledPostMedia,不重生成)|
| X4 | 视频贴(分块上传 + STATUS 轮询)| 异步转码失败 → NEEDS_ATTENTION 不双发不静默 |

- **排期 + 立即发 = 同一条路**:立即发就是 scheduledAt=now 的 ScheduledPost,同样过审批、同样走 worker、同样防双发 —— 不开第二条发布路径。
- **防双发**:PublishAttempt 的 partial-unique(每贴至多一个 APPLYING)+ 贴上的外部 id 一经写入永不重发。现有 `metaPostId`/`metaTargetId` 列名是 Meta 专名 → 施工时做**加列式泛化**(externalPostId/targetId 或等价方案,additive migration),不破坏现网数据;方案在施工 plan 定。

## 十、验收 / PR 切片 / 风险

**PR 切片**(小批提交,每片独立可审):
1. **PR-X1 连接件**:XConnection 迁移 + OAuth 路由 + adapter + registry + Connections UI + parity 登记(全 $0)。
2. **PR-X2 发布通电**:publish worker(缝 6 全套:队列 policy/原子 claim/回收器)+ PublishAttempt 接线 + 配额 config + kill-switch + 收费(founder 拍板后的 N)+ 告警。碰钱 → money-safety-review。
3. **PR-X3 图**、**PR-X4 视频**:各自独立。
4. Meta App Review 批复后:FB/IG adapter 的 publish() 补齐,复用同一 worker(验证"加平台 = 加 adapter"成立)。

**验收(可执行/可点击)**:
- 一条真实 X 贴走完 DRAFT→(人工审批)→SCHEDULED→PUBLISHING→PUBLISHED,X 上可见,外部 id 落库;重投递/重启不双发(PublishAttempt 测试绿)。
- OAuth:连接/断开/token 过期自动刷新/refresh 失效提示重连,各一条浏览器 QA 证据。
- kill-switch 开启后已排期贴被拒发;per-org 配额超限被拒;两者均有人话提示。
- 收费:发一条,credits 按拍板价扣,消费明细出现"发布"类目;失败自动退款(状态诚实)。
- 真实验证花费(每条 $0.015–0.20)逐笔问 founder。

**风险表**:

| 风险 | 缓解 |
|---|---|
| 含 URL 贴 $0.20(13.3 倍成本地雷)| 审批页确定性检测 URL + 分档报价;价格进 config 随时调 |
| X 价格"subject to change" | 全部数字 config 层;余量+用量告警;明细留 COGS 快照 |
| X API credits 余额烧干 → 发布静默失败 | 余量告警(§五)+ 发布失败态 NEEDS_ATTENTION,不静默 |
| refresh token 轮换竞态 → 连接失效 | 每 org 单飞刷新 + 原子换写;失败即 expired + 提示重连 |
| app 级 10k/24h 全平台共享 | per-org 配额 + 平台 80% 告警(§六)|
| 违反 X Automation Rules → 封 app | 只发用户明确审批的内容;kill-switch;连接状态监控 |
| 平台侧凭证是单点(一个 app 服务全租户)| client secret 只进 env/secret 管理;泄露预案 = 换钥匙 + 全量 token 失效重连 |

---

**结尾:本 spec 为图纸,待 founder 过目后动工**(蓝图第五章第 1 条)。待拍板项:①收费选项 A/B 与 N 的取值(§五);②per-org 默认配额数字(§六);③BELCORT X 开发者账户注册与首笔充值(founder 亲自,金额 founder 定)。
