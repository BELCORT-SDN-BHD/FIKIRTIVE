# L1 发布链点亮施工图 —— Meta organic publish 从桩点亮为真能力(spec)

> **性质**:施工图层(蓝图金字塔最下层)。把排期区已通电的 UI/数据模型接上**真的发布 worker**,让「草稿 → 排期 → 审批 → 真的发到 IG/FB」这条闭环第一次跑通;同时把递 Meta App Review 的路铺好。这是「一条真闭环先通」的**第 2 环**、也是全盘**外部等待最长的前置项**(App Review 约一周,商业验证另算)。
> **走的缝**:渠道缝(`docs/review/EXPANSION-SEAMS.md` Seam 4,Meta 为范本)+ 队列缝(Seam 6,发布 worker)+ 租户缝(Seam 5)+ parity(Seam 9)。**不碰钱路**——organic 发布本身 $0(媒体复用已付费成片,发帖不向 Meta 付费),所以不走记账缝、不触 money-safety。
> **状态:待 founder 过目后动工。本文件只是图纸,不含任何代码。** 一切真实 Meta 验证花费(本 spec 几乎无——organic 发布免费;唯一可能的真实开销是商业验证/开发者账户相关,若有,逐笔问 founder,宪法 2)。
> **基线**:origin/main @ #213(08759711)。平台事实基线 = `docs/superpowers/specs/`(本目录)+ 平台真相总台账 2026-07-10(Meta/IG/FB 两页)。

## 名词对照(人话)

| 术语 | 人话 |
|---|---|
| organic publish | 「自然帖」发布 —— 不花钱投放的普通帖子(对比广告区的 paid ads);发到 IG feed / Reels / Stories / 轮播、FB 主页 |
| Meta App Review | Meta 的人工审核:我们的 app 想用「发帖」这类高权限,必须录演示视频提交,Meta 审核员亲手测过才发钥匙;官方口径「提交后**一周内**出结果」 |
| 权限(permission / scope) | 用户授权时勾的一项项能力,如 `instagram_content_publish`(替我发 IG 帖)。App Review 批的就是这些 |
| Business Verification(商业验证) | Meta 要求以公司实体身份验明正身(营业执照等),是拿高权限的**前置**,和 App Review 并行但独立 |
| media container(媒体容器) | IG 发帖是两步:先把「一张图 + 文案」创建成一个容器(拿到 creation_id),再调「发布」把容器发出去。容器是幂等锚点 |
| 公网可达 URL | Meta 服务器要能自己去下载我们的媒体 → 媒体必须挂在一个**公网能访问的网址**上(IG 不吃文件直传,图片只吃 JPEG) |
| PublishAttempt | 一次发布尝试的记录行;`state=APPLYING` 的 partial-unique 索引保证「一个帖同时只有一个 worker 在发」(防双发) |
| kill-switch | 一键停用全部 organic 发布的开关(照 Meta 连接的 `adsWritesPaused` 造一个 `organicPublishPaused`) |

---

## 一、目标

1. **点亮排期区的最后一里。** 排期区的 3 视图 + Composer + `ScheduledPost`/`ScheduledPostMedia`/`PublishAttempt` 数据模型 + 状态机 + 审批闸**已全部通电、$0 建成断电**(#123/#129,`docs/superpowers/specs/2026-07-03-schedule-uifirst-slice-design.md`)。今天缺的**只有一件**:把 `apps/web/lib/channels/instagram.ts` / `facebook.ts` 里的 `publish: notImpl` 换成真的发布路径,并配一个发布 worker 驱动它。本 spec = 这一件的施工图。
2. **发布管线平台可插拔,不是 Meta 专用的。** 发布 worker、防双发、审批、六态、配额全部写在**渠道无关层**;IG/FB 只是第一批插上的 adapter。X(`2026-07-07-x-publishing-design.md`)已论证同一条管线接 X;本 spec 论证它接 Meta。TikTok/Lazada/Shopee 未来用**同一条 worker**(加 adapter,不改核心)—— 这正是蓝图第六章「发布基建必须平台可插拔」的判决,也是边界四层表把「排期发布与广告」划进**本体负责**的落地(BLUEPRINT v2.11 §边界四层表,行 47)。
3. **双模照旧**(宪法 7)。人工在排期区全操作;Otto 用既有 `schedulePosts` skill 起草(只建 DRAFT,$0),经人工审批后 worker 才发布。**Otto 永不直接持有「发帖」技能**——发布永远经 `ScheduledPost` 审批管线,这就是 Meta 的 propose→approve→execute 模式在发布域的形态。
4. **fail-closed 是底线。** 桩点(`meta-shared.ts:notImpl` 抛「not implemented」)今天由 `__tests__/registry.test.ts` 的契约钉着(「organic publish adapters fail closed until the publish worker/App Review slice lands」)。本 spec **不废除这条契约,而是把它升级**:点亮后,`publish()` 在「App Review 未过 / 权限未授 / kill-switch 开」时仍必须**拒绝**(返回 error,而非真发),契约测试同步改写为「未授权即拒发」(见 §八)。

---

## 二、平台事实核查 —— Meta/IG/FB organic 发布(2026-07-10 核实)

> 来源 = 平台真相总台账 2026-07-10(Meta 一份研究覆盖 IG+FB),官方口径已核实。技术名词第一次出现带白话。

**IG 发布面(能干什么)**:发单图/视频到 Feed、发 Reels、发 Stories、发轮播(最多 10 张,轮播在配额里算 1 帖);读评/回评/隐藏删评/开关评论;查当天配额用量(`GET content_publishing_limit`)。

**IG 的三条硬约束(直接决定架构)**:
- ❌ **IG 没有原生定时发布**——不能像 FB 那样传未来时间戳让 IG 到点自己发。要排期就得**我们自建定时器**到点调发布接口(排期区正是这么设计的,`SCHEDULE_CHANNELS=["instagram","facebook"]` 干净,对得上)。→ 架构 §四A 沿用自建 scheduler。
- ❌ **不能直接上传文件**——IG 只吃「公网能访问的媒体网址」,图片**只支持 JPEG**。我们的成片存 R2(私有、content-addressed),发 IG 前必须有一个**公网可达网址** + 必要时 JPEG 转码。→ 架构 §四C「媒体公网 URL 策略」是本 spec 的核心决策项。
- ❌ **未经账号主人同意就自动代发**(政策 1.7)。→ 与我们的审批闸天然对齐(§四E)。

**FB 发布面**:发主页帖(`POST /page/feed`);✅ **原生排期**`scheduled_publish_time`(未来 **10 分钟–75 天**);读评回评同 IG 一套权限。发帖人须在该主页有 `CREATE_CONTENT` 权限。

**Meta 红线(会被封/整单拒)**:
- **1.7 同意**:代发前必须拿到明确同意。
- **2.7 禁互动造假**(买卖赞/评/粉)——管到相邻的「请评/唤回」功能(不在本 L1 范围,但发布 worker 不得被将来这类功能借道)。
- **App Review 可及性**:**审核员测不到你申请的功能 = 整单被拒**。→ §六演示物料必须让 Meta 审核员用测试账号**亲手复现**整条发布。
- **3.a.vii**:功能实质变化要重审。

**权限(以官方名为准,本 L1 要新增的)**:
- `instagram_content_publish` —— IG 发帖(**本 L1 的核心新权限**)。
- `pages_manage_posts` —— FB 主页发帖(**本 L1 的核心新权限**)。
- `instagram_basic` —— 解析 page → IG business account、读 IG 账号基本信息(发布前置)。
- `pages_read_engagement` —— 读主页/帖子互动(发布回执 + 未来读评)。
- 已有(`meta-oauth.ts:buildAuthorizeUrl` 当前请求):`ads_read, ads_management, pages_show_list, business_management`。→ §六把新权限并进同一 consent。

**当前代码现状(核实)**:
- `apps/web/lib/meta-oauth.ts:50` 的 scope 串**尚无发布权限**——只有 ads + pages_show_list + business_management。
- `apps/web/lib/meta-pages.ts:listPages` 拉 `me/accounts?fields=id,name`——**没取 page access token,也没取 `instagram_business_account`**。发布 worker 需要这两样(见 §四B)。
- `MetaConnection`(`schema.prisma:1056`)有 `canWrite`/`canManagePages` 两个能力布尔 + `adsWritesPaused` kill-switch;**没有** `canPublish`——本 L1 要加(§四B)。

---

## 三、六态设计(全图先设计律 —— trial 口径,每态都先画好)

> 发布是外部世界的写操作,失败形态比读多得多。**先把六种结局全部设计出来**(store 状态 / UI 呈现 / 回执记录 / 重试策略),再谈架构。fail-closed 原则贯穿:**任何不确定的结局都不许「乐观当成功」,宁可停在 NEEDS_ATTENTION 让人来看,也不静默、不盲重发。** 六态映射到既有状态机(`packages/core/src/schedule-state.ts`)——不新增状态,只定义每个已有状态在发布路径上的语义。

| # | 结局 | ScheduledPost.status | PublishAttempt.state | UI 呈现(statusPill) | 回执记录 | 重试策略 |
|---|---|---|---|---|---|---|
| ① | **成功** | `PUBLISHING`→`PUBLISHED`(终态) | `APPLIED` | 「Published」绿标 + 外部帖链接(可点开看真帖) | `ScheduledPost.metaPostId` + `PublishAttempt.metaPostId` 同置;`finishedAt` | 无(终态,出度为空) |
| ② | **无权限**(App Review 未过 / 用户未授 `instagram_content_publish`/`pages_manage_posts` / token 过期 / 连接被撤) | `SCHEDULED`→`NEEDS_ATTENTION`(**不进 PUBLISHING**,发布前置校验就拦) | 无(未尝试)或 `FAILED` | 「Needs attention」黄标 + 人话:「连接需要重新授权才能发布」/「等 Meta 审核通过」 | `lastError`=人话原因 | **人工重连/等 App Review** 后 `NEEDS_ATTENTION`→`SCHEDULED` 重新入队;worker 不自动重试(重试也没权限) |
| ③ | **平台拒绝**(确定性硬失败:文案超限 / 媒体非 JPEG / 公网 URL 不可达 / Meta 政策拦 / 主页无 CREATE_CONTENT) | `PUBLISHING`→`FAILED` | `FAILED` | 「Failed」红标 + 人话原因 + 「编辑后重排」按钮 | `lastError`=映射后的人话;`PublishAttempt.error`=sanitize 后的 Meta 原文(经 `apps/worker/src/redact.ts`,不泄 token/签名 URL) | **不自动重试**(重发结果一样);owner 编辑内容后 `FAILED`→`SCHEDULED`(状态机已允许) |
| ④ | **超时/瞬时**(IG 媒体容器处理卡 `IN_PROGRESS` 超时 / 网络超时 / Meta 5xx / 限流 429) | `PUBLISHING` 内**有限重试**;超上限→`NEEDS_ATTENTION` | 重试期 `APPLYING`;放弃→`FAILED` 或留 `APPLYING` 待 reaper | 重试期「Publishing」;超上限「Needs attention」 | `lastError`=「Meta 暂时没响应,已暂停,可重试」 | **有限次退避重试**(queue policy 显式 `retryDelay`+`retryBackoff`,Seam 6 铁律);超上限**不静默失败**→`NEEDS_ATTENTION` 让人决定 |
| ⑤ | **部分成功**(轮播半张:多张子图有的建成容器、有的失败) | 见下「分两种」 | 见下 | 见下 | 见下 | 见下 |
| ⑥ | **恢复**(worker 崩溃/redelivery,发布中断,结局不明) | 停在 `PUBLISHING` + 悬空 `APPLYING` | `APPLYING`(悬空) | 「Publishing」(短暂)→ reaper 判定后转态 | reconcile 结论写 `lastError` | **reaper + reconcile**:先查 Meta 端到底发没发,发了→补 `PUBLISHED`,没发→`NEEDS_ATTENTION`;**永不盲重发** |

**⑤ 部分成功(轮播半张)—— 拆成两种,分别 fail-closed**:
- **⑤a 发布前的部分**(子容器建了一半就失败):IG 轮播是「N 张子图各建一个 container → 建一个 carousel container 引用它们 → **一次** media_publish 把整组发出」。**发布调用之前**任何子容器失败 → **整帖 abort**,`FAILED`,回执记「第 k 张媒体建容器失败」。**此刻 Meta 上什么都没发**(publish 还没调)→ 安全,无「半张真的发出去了」的可能。owner 修好那张媒体后重排。
- **⑤b 发布调用后的歧义**:carousel container 的 **media_publish 是单次原子调用**——Meta 要么整组发、要么不发,**不存在「轮播只发出去 3 张」**。真正的风险是这次调用**发出去但我们没收到回执**(网络在 Meta 提交后断了)→ 退化为**⑥恢复**(reconcile 判定),不是真的「半张」。→ **结论:IG 轮播不存在「链上真的只发一半」的物理结局;所谓部分成功要么是安全的前置 abort(⑤a),要么是需要 reconcile 的歧义(⑥)。** 这条要写进 worker 注释,防将来有人误设计「补发剩余半张」的错误恢复逻辑(那会双发)。

**六态的一句话总纲**:成功→终态留链接;无权限→停在门口不硬闯(fail-closed);平台拒绝→硬失败给人话不重试;超时→有限退避后停在 NEEDS_ATTENTION 不静默;部分→前置失败安全回滚 / 后置歧义走恢复;恢复→先查真相再决定,永不盲重发。**这六态覆盖了「结局不明」的每一种,且每一种的默认都是「停下让人看」而非「乐观继续」。**

---

## 四、架构

### 四A · 一条自建 scheduler + 一个发布 worker(Seam 6)

- **调度**:自建 scheduler(worker 侧定时扫 `ScheduledPost WHERE status='SCHEDULED' AND approvedAt IS NOT NULL AND scheduledAt<=now()`,走 `@@index([status, scheduledAt])` 已建的索引)→ 原子 claim → `boss.send(PUBLISH_QUEUE,{scheduledPostId})`。**IG 无原生排期,自建定时器是唯一正确解**(平台真相 C10;别有人以后「优化」成去找 IG 原生排期参数——不存在)。FB 侧虽有 `scheduled_publish_time`,但**我们保持一条 scheduler 路**(单一代码路径,照 X spec「排期+立即发=同一条路」),FB 原生排期作为**可选优化**留档不入本期。
- **队列 policy(Seam 6 铁律)**:`PUBLISH_QUEUE`/`PUBLISH_DLQ`/`PUBLISH_QUEUE_POLICY` 定义在 `packages/core`,**web(`queue.ts:getBoss`)与 worker(`index.ts`)两处用同一 policy 对象**;`retryLimit` + **显式 `retryDelay`**(pg-boss 默认 retry_delay=0 会让 `retryBackoff` 变哑弹→瞬时重试风暴)+ `expireInSeconds` **长于**最慢一次合法发布(IG 容器处理可能几十秒,取足够余量)+ `deadLetter`。
- **worker handler**:幂等;`PUBLISHED` 短路;**原子 claim** = 插入 `PublishAttempt(state='APPLYING')`,靠 partial-unique 索引(`PublishAttempt_one_applying_per_post`,`packages/db/src/publish-attempt-uniqueness.test.ts` 已钉)保证一个帖只有一个 worker 在发;`retryCount>=LIMIT` 决定 `FAILED` vs 回退重试;`sanitizeError` 一切持久化/回抛的错误。
- **reaper**(Seam 6 第 6 步,发布持有用户可见状态,必配):5 分钟扫悬空 `APPLYING`(cutoff 必须 > queue expire),执行 §四F 的 reconcile。

### 四B · 渠道 adapter 落 publish(Seam 4)—— 点亮 notImpl

- `instagram.ts` / `facebook.ts` 的 `publish: notImpl` → 真实现,签名不变(`publish(ownerId, target, post): Promise<{externalId}|{error}>`,`types.ts:40` 已定)。worker 拿 `getChannel(post.channel).publish(...)` 驱动,**零 per-channel worker 分叉**。
- **新增能力布尔 `MetaConnection.canPublish`**(照 `canWrite`/`canManagePages`):`true` 仅当 Meta 实授 `instagram_content_publish`+`pages_manage_posts`。`completeMetaConnect`(`meta-actions.ts:25-26`)加一行 `canPublish = grantedScopes.includes("instagram_content_publish") && grantedScopes.includes("pages_manage_posts")`。**additive migration**(加一列,默认 false,不破现网)。
- **新增 kill-switch `MetaConnection.organicPublishPaused`**(照 `adsWritesPaused`):worker 执行时刻检查,开了就拒发(已排期的也发不出)。
- **page access token + IG business account 解析**:`listPages` 扩为(server-only,token 永不离服务器)`me/accounts?fields=id,name,access_token,instagram_business_account{id}`。发布用 **page access token**(不是 user token)。FB 发帖用该 page token;IG 发帖先 `page.instagram_business_account.id` 拿到 IG business id,再对它调发布接口。
- **token 解密进 worker**:`token-encryption` 现在 `apps/web/lib`;发布 worker 也要用 → 抽到 packages 层共用(web 不许被 worker 反向 import),落位在施工 plan 定(与 X spec 同一笔技术债,可合并处理)。
- **发布两步(IG)**:①create media container(单图:`POST /{ig-id}/media` 带 `image_url`/`video_url`+`caption`;轮播:每张子图 `is_carousel_item=true` 建容器,再建 `media_type=CAROUSEL` 父容器 `children=[...]`);②poll 容器 `status_code`(视频/Reels 需转码,轮询 FINISHED)→ ③`POST /{ig-id}/media_publish` 带 `creation_id`。**`creation_id` 存进 `PublishAttempt`**——它是恢复(§四F)的幂等锚点。first comment(IG 支持,FB 不支持,`SCHEDULE_CHANNEL_CAPS` 已编码)= 发布成功后对 `metaPostId` 再发一条评论。
- **发布一步(FB)**:`POST /{page-id}/feed` 带 `message`+`link`/`attached_media`,用 page token。

### 四C · 媒体公网 URL 策略(决策项 —— present options,待施工 plan / founder 知情定)

IG 只吃**公网可达**媒体 URL,图片**只吃 JPEG**;我们的成片在 R2 私有桶(content-addressed,`u/<ownerId>/<sha256>.<ext>`)。三个选项:

| 选项 | 做法 | 优点 | 代价/风险 |
|---|---|---|---|
| **A. R2 presigned GET(短 TTL)** | 发布时对该媒体签一个短命(如 1h)只读 URL,交给 Meta 去拉 | 无新路由;最少代码 | TTL 必须 cover Meta 异步拉取窗口(容器处理可能滞后);签名 URL 短暂暴露该单个对象;**JPEG 转码另解** |
| **B. 签名媒体代理路由(荐)** | 一个公开路由 `/api/media/pub/<token>`,`token`=HMAC(ownerId+sha256+exp),服务端校验后**流式回**字节;可在流上按需 JPEG 转码 | 不开公共桶(守租户铁幕);owner-scoped 签名;转码可内联;URL 语义稳定 | 需建路由 + 转码接线;流量过我们的 web/edge |
| **C. 公共 R2 子路径** | 把媒体放公共桶 | 零签名开销 | ❌ **否决**——泄露租户媒体,违反宪法 6 铁幕 |

- **推荐 B**:签名代理路由 + 短命 HMAC token,守住铁幕;JPEG-only 用**转码**解决(见下)。**但这是工程决策,标「待施工 plan 定,founder 知情」**——A 更省事、B 更干净,取舍点在「是否愿意为一条发布路径建一个公开代理路由」。
- **JPEG 转码(必须)**:IG 图片只吃 JPEG,我们的 generation 可能是 PNG/webp。转码落点两选:①**发布时**(worker/代理路由现转,省存储、每次算)②**生成时**(成片落库时预备一份 JPEG 派生,省发布延迟、费存储)。**推荐①发布时按需转**(排期是低频动作,不值得为它给每张成片存双份)。视频/Reels 走 Meta 转码(我们只需给可达 URL),不在此列。

### 四D · 幂等(同帖不双发)—— 三重锁

1. **`ScheduledPost.metaPostId` 一经写入永不重发**:worker claim 时若该列非空 → 短路(已发过)。
2. **`PublishAttempt` partial-unique(一个帖至多一个 APPLYING)**:两 worker 抢同一 due 帖,只有一个 insert 赢,另一个 P2002 跳过(`publish-attempt-uniqueness.test.ts` 已钉四个用例)。
3. **Meta 侧 `creation_id`**:IG 的 media_publish 对同一 `creation_id` 重复调用,Meta 侧会拒/幂等——存进 `PublishAttempt.creation_id`(新增列)让恢复能「用同一容器再确认一次而非重建重发」。FB `/feed` 无原生幂等键 → 靠锁 1+2 + 恢复期查询兜底(§四F)。

### 四E · 审批闸(external write → needsApproval,宪法 4)

- **发布 = effect:write ∧ reach:external → needsApproval = true**,没有旁路。
- **审批点 = 人工在排期区点 `approveScheduledPost`**(写 `approvedAt`,`schedule-actions.ts:240` 已实现且已做 owner-scoped 校验:target 必须属于 owner 自己的连接、须有媒体、须过状态机)。Otto 的 `schedulePosts` 只建 DRAFT($0、`approvedAt=null`);DRAFT→SCHEDULED 必须人手过审批动作;worker 只发 `SCHEDULED` 且 `approvedAt` 非空的帖。
- **「审批在前、执行在后」不是绕闸**——与宪法 4 例外②(routine 预授权)同理:授权在前,worker 执行在后,kill-switch(`organicPublishPaused`)兜底。**这也正是 Meta 政策 1.7「代发前先同意」与我们 `needsApproval=write∧external` 的天然对齐**(平台真相 C10;代客户发帖本就是外部写,必过审批闸)。
- **v2.10 释宪附则⑦对齐**:我们作为**消费方**调 Meta 官方 Graph API 发布,**不在「对外 MCP」禁区**(宪法 8 禁的是外部 agent 操作我们的城;Meta OAuth 回调/inbound 是收信与授权回执)——合法通道,别误判违宪。

### 四F · 恢复 / reconcile(⑥ 态的落地)

worker 崩溃/redelivery 留下悬空 `APPLYING` 时,reaper 触发 reconcile,**先查真相再决定**:
- **IG**:用 `PublishAttempt.creation_id` 查该容器状态 / 或查该 IG 账号最近 media 是否已含此帖 → 已发:补 `metaPostId` + `PUBLISHED`(APPLIED);未发且容器仍在:**可安全地对同一 creation_id 再调一次 media_publish**(Meta 幂等语义);状态不明:`NEEDS_ATTENTION` 让人看。
- **FB**:无 creation_id,查该 page 最近 posts 是否已含(按内容/时间窗匹配)→ 命中补 `PUBLISHED`;不命中 `NEEDS_ATTENTION`(**不盲重发**,因为 `/feed` 无幂等键,盲重发=双发风险)。
- **铁律**:reconcile **永不在「结局不明」时乐观重发**;宁可 `NEEDS_ATTENTION`。这与六态 ⑤b/⑥ 的设计闭环。

---

## 五、Parity(Seam 9)—— action ↔ skill 登记,Otto 可代劳同一动作层

- **发布走既有审批管线,不新增「Otto 发帖」skill**:Otto 的写面永远是「$0 起草(`schedulePosts`)→ 人工审批 → worker 执行」。这保持 `schedulePosts`(free/write/internal,已注册)是 Otto 在发布域的唯一入口。
- **`parity-manifest.ts` 现状清账**(核实,行 230-236):
  - `schedule-service.draftScheduledPost` → `schedulePosts` ✅
  - `schedule-actions.createScheduledPost` → `schedulePosts` ✅
  - `schedule-actions.approveScheduledPost` → 当前 `todoSkill`(注:「waits on the publish worker and gated external-write skill」)。**本 L1 落地时**:approve 保持人工审批语义;若要 Otto 对等「代人审批发布」需专门的 gated skill——**但审批=消费/外部写的最后一道人闸,建议保持人工**(照 X spec:审批是人手动作),此 `todoSkill` 可维持或转 `ACCOUNT_SECURITY` 邻类的显式说明,由 founder/总审查员定。
  - `cancelScheduledPost`/`updateScheduledPost`/`listScheduledPosts`/`listOwnerTargets` 当前 `todoSkill`——本 L1 **不强制**清这几笔(它们是「管理排期」skill 的债,与发布点亮解耦);但 CI(`scripts/check-parity.sh` / `pnpm lint:parity`)会继续钉着不许漏登记。
- **新增 server action / 读面若出现**(如「重排失败帖」`retryScheduledPost`、发布回执读面),**出生即登记 parity**(配 skill、四类豁免之一、或 `todoSkill` 债务),否则 CI 硬拦。**读的对等**:发布状态/回执(metaPostId/lastError)是人可见面 → 配 free/read skill(Otto 不做瞎子操作员,宪法 7)。
- **单一动作层**:worker 与人工按钮**不各写一套发布逻辑**——都经渠道 adapter `publish()` 同一实现(`generate`→`startGen` 范本的发布域版本)。

---

## 六、App Review 递件清单(外部等待最长,第 1-2 天就得提交)

> 这是全盘外部等待最长的前置项。清单分「谁办」两种人:**founder**(公司实体/KYC/接受平台条款/商业验证材料)、**工程**(改 app 配置/录演示/写可复现 demo/提交)。**并行去排队,不等一项办完再办下一项。**

**① 要申请的 permission(官方名)**:
- `instagram_content_publish`(IG 发帖)
- `pages_manage_posts`(FB 主页发帖)
- `instagram_basic`(解析 IG business account)
- `pages_read_engagement`(读发布回执/互动)
- (已在申请中:`pages_show_list`、`business_management`;`ads_*` 属广告区,同一 app 同一 consent)

**② 前置(founder 侧)**:
- **Business Verification(商业验证)**:以 BELCORT 实体验明正身(营业执照等)——拿高权限的**前置**,与 App Review 并行但独立,官方「可能几天到几周」。**越早提交越好。**
- 接受 Platform Onboarding Terms;确认 app 的 Advanced Access 申请由有权限的实体身份发起。

**③ 演示物料(工程侧)——「审核员测不到=整单拒」是最大雷**:
- **每个申请的 permission 录一段 1080p 屏录**,展示**该权限具体启用的动作**(不是泛泛介绍产品):`instagram_content_publish` → 展示「排期一条 IG 帖 → 审批 → 真的发出 → IG 上看到」整条;`pages_manage_posts` → 同理 FB。
- **一个 Meta 测试账号 + 测试 Page + 测试 IG business account**(app 后台可建 test users),让 **Meta 审核员亲手用它复现整条发布**。**这是通过与否的命门**——demo 环境必须让审核员从连接 OAuth 到看见帖子发出去,一步不缺、可复现。
- 隐私政策 URL、app 图标、data-deletion 回调(**已有**:`api:meta/data-deletion.POST`,parity 已登记 ACCOUNT_SECURITY)。
- app 用途说明(与实际发布功能一致,别夸大——1.4 别骗人 / 1.6 守文档)。

**④ 时间线(现实预期)**:
- **第 1-2 天**:改 `meta-oauth.ts` scope 串加四权限 + 备齐演示 → 提交 App Review + 发起商业验证。
- **约一周**:App Review 出结果(官方「一周内」是唯一官方原文;网传「2-3 天」是搜索摘要,**不采信**)。
- **并行、可能探头出去等**:商业验证(几天到几周)。
- **过审后**:app 切 Advanced Access,用户重连时勾到发布权限 → `canPublish=true` → 排期区横幅自动关、存量 `SCHEDULED` 帖自动开始发(切片 2 无需再迁移,数据模型已建全)。

---

## 七、假设台账(还没坐实的,逐条写「上线前如何实测」)

> 这些都是官方文档自相矛盾 / 登录墙 / 存疑的点。**动工可先按保守假设建,但上线前必须用真号实测坐实**;每条给出实测方法。

| # | 假设/存疑 | 现状 | 上线前如何实测 |
|---|---|---|---|
| A1 | **24h 发布配额 50 还是 100?** | 官方同一页自打架(专门端点写默认 50,总览页写 100) | 连一个真 IG business account,调 `GET /{ig-id}/content_publishing_limit` 看当前生效值;我们 adapter 侧 `rateLimitPer24h:25` 已远低于两者,**保守取 25 安全**(`instagram.ts` 已编码),实测只为确认不撞更低的隐藏墙 |
| A2 | **Stories 是否支持互动贴纸**(投票/提问/倒计时/链接贴纸)、发布后能否查 | 官方未逐条确认,存疑 | 用测试账号对 `media_type=STORIES` 试各贴纸参数;本 L1 **Stories 先按 `autoPublishable="reminder"`**(`instagram.ts:23` 已把 reel/story 判为 reminder——即提醒人手发,不自动发),**贴纸自动化不在 L1**,坐实前不承诺 |
| A3 | **PPA(Page Publishing Authorization)是否仍是 IG 发布前置** | 官方页面没正面确认或否认,可能是历史遗留术语 | 提交 App Review 前后,用测试 Page 走一遍发布,看是否被要求 PPA;若是,写进用户连接引导 |
| A4 | **App Review 时长** | 官方原文只保证「一周内」;「2-3 天」只在搜索摘要 | 以实际提交后 Meta 后台状态为准,**规划按一周**,别按 2-3 天承诺 founder |
| A5 | **IG 图片公网 URL 拉取窗口** | Meta 异步拉媒体,滞后多久没官方数字 | §四C 定 TTL 前,用真发布测容器从 create 到 FINISHED 的实际耗时,反推 presigned/签名 URL 的 TTL 下限(留足余量) |
| A6 | **视频/Reels 转码失败率与时长** | 官方转码,时长/失败形态没给 | 测几条真视频,确认 §三④「容器 IN_PROGRESS 超时→NEEDS_ATTENTION」的超时阈值取值合理 |
| A7 | **FB 主页发帖需 `CREATE_CONTENT`**(该 user 在该 page 的权限) | 官方口径明确「无此权限发不了」 | 连接时检查/提示;实测用一个 admin 权限的 Page vs 一个受限 Page,确认错误映射到人话(六态②「无权限」) |

---

## 八、验收 / 规模 / 接线点

**验收(可执行 / 可点击)**:
- **本地三关**(CI 不可用时的复现配方 `docs/runbooks/local-ci.md`):`check`(lint+typecheck)/`test`(vitest,含新加的发布 worker 测试)/`web-build`(next build)全绿。
- **契约测试升级**(`apps/web/lib/channels/__tests__/registry.test.ts`):现有「organic publish adapters throw /not implemented/」用例**改写**为「未授权即拒发」——`publish()` 在 `canPublish=false` / `organicPublishPaused=true` / token 过期时返回 `{error}`(不真发);授权且允许时才走真路径。**fail-closed 契约不废除,只升级**(§一.4)。
- **防双发测试**(已有 `packages/db/src/publish-attempt-uniqueness.test.ts` 四用例绿)+ **新增 worker 测试**:redelivery/重启不双发(claim 短路 + APPLYING 锁 + metaPostId 短路)、reconcile 不盲重发。
- **浏览器 QA**(过审后,用测试账号):一条真帖走完 `DRAFT`→(人工审批)→`SCHEDULED`→`PUBLISHING`→`PUBLISHED`,IG/FB 上可见,`metaPostId` 落库、外部链接可点开;六态各留一条证据(尤其②无权限、③平台拒绝、⑥恢复)。
- **kill-switch**:`organicPublishPaused=true` 后已排期帖被拒发,人话提示。
- **配额**:per-org `rateLimitPer24h:25` 超限被拒,给人话提示。

**规模估算**:
- 每帖发布 = 1-3 次媒体容器 create(轮播 N 张)+ 轮询(视频/Reels)+ 1 次 publish + 可选 1 次 first comment。都是 Graph API 调用,**$0**(organic 免费)。
- 媒体转码(JPEG,§四C)= 每帖每张图一次,发布时按需,低频(排期是低频动作)。
- worker 负载:排期发布是稀疏事件(不是高吞吐 job),`batchSize:1` 足够;reaper 5 分钟一扫。
- **不碰钱路**:无 reserve/settle,无 money-safety-review(除非将来 organic 也收「代发服务费」——那时才走记账缝,本 L1 不涉及)。

**与排期区(已有 UI)的接线点**:
- **横幅**:排期区顶部「自动发布待 Meta 审核通过后开启」横幅——过审 + `canPublish=true` 后**自动关**(读连接能力布尔驱动,不硬编码)。
- **状态回显**:六态经 `schedule-view.ts:statusPill` 已有的 pill 呈现(`PUBLISHING`/`PUBLISHED`/`NEEDS_ATTENTION`/`FAILED`/`CANCELLED` 全已映射,行 112-123)——**无需新 UI 组件**,只需 worker 正确写状态。
- **live reflection(宪法 11)**:发布态变化要秒级反映到界面(worker 写库 → 排期区推送/短轮询刷新);「后台已发出而界面还显示 Publishing」按缺陷处理。
- **审批动作**:`approveScheduledPost` 已实现且已 owner-scoped,worker 只消费其产出——**接线零改**。

---

## 九、PR 切片 / 风险

**PR 切片**(小批提交,每片独立可审):
1. **PR-L1a 连接能力扩展($0,可先合)**:`meta-oauth.ts` scope 加四权限 + `completeMetaConnect` 派生 `canPublish` + `MetaConnection` 加 `canPublish`/`organicPublishPaused` 两列(additive migration)+ `listPages` 扩取 page token/IG business id(server-only)+ parity 登记。**这片不发布任何帖,纯连接层**,可在 App Review 结果前先合。
2. **PR-L1b 发布 worker 通电**:`PUBLISH_QUEUE` 全套(Seam 6:policy/原子 claim/reaper)+ `PublishAttempt.creation_id` 列 + IG/FB adapter `publish()` 真实现 + 媒体公网 URL 策略(§四C 定案)+ JPEG 转码 + 六态落地 + 契约测试升级。**token-encryption 抽包**(与 X spec 合并处理)。
3. **PR-L1c(过审后)**:切 Advanced Access + 横幅自动关 + 浏览器 QA 全六态证据。

**风险表**:

| 风险 | 缓解 |
|---|---|
| **审核员测不到 = 整单拒**(最大雷) | §六③ demo 环境让审核员用测试账号**亲手复现**整条发布,一步不缺 |
| IG 只吃公网 JPEG URL | §四C 签名代理路由 + 发布时 JPEG 转码;TTL 由 A5 实测定 |
| 轮播「半张」误设计成「补发剩余」= 双发 | §三⑤ 写死:IG 轮播 media_publish 原子,不存在物理半发;禁「补发半张」恢复逻辑 |
| worker 崩溃留悬空 APPLYING → 双发或卡死 | §四F reconcile:先查 Meta 真相再决定,永不盲重发;reaper cutoff > queue expire |
| FB `/feed` 无幂等键 → 恢复期盲重发双发 | §四D 靠 ScheduledPost.metaPostId + PublishAttempt 锁 + §四F 查最近 posts 兜底;不命中→NEEDS_ATTENTION 不盲发 |
| token 过期/连接撤销时发布 | 六态② fail-closed:发布前置校验拦,NEEDS_ATTENTION 提示重连,不硬闯 |
| 配额撞墙(50 vs 100 未定) | adapter `rateLimitPer24h:25` 保守;A1 实测确认无更低隐藏墙 |
| App Review 卡住/被拒 | 数据模型已建全、UI 已通电、$0 断电运营——**过审是唯一钥匙,不阻塞其余建设**;被拒按 Meta 反馈补 demo 重提 |
| token-encryption 抽包引入 web↔worker 循环依赖 | 抽到 packages 层,web 不许反向 import worker(施工 plan 定落位) |

---

**结尾**:本 spec 为图纸,待 founder 过目后动工(蓝图第五章)。**待拍板/待定项**:①媒体公网 URL 策略 A/B(§四C,荐 B);②JPEG 转码落点 发布时/生成时(§四C,荐发布时);③approve 是否给 Otto 对等 skill 还是永久人工闸(§五,荐人工);④商业验证材料与 App Review 提交由 founder 亲自发起(§六,越早越好)。**外部等待最长——App Review 约一周 + 商业验证另算,第 1-2 天就该提交。**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
