# B4 · 发布 L1 + Meta 通电族 · 块 spec（v0.1——冻结候选）

> 2026-07-12。epoch `claude-20260712-03`。工位=SPEC-B4（worker 作品，署名工位）。
> 性质：**冻契约不冻实现**——本 spec 冻结的是发布 L1 闭环的**接口形状与语义**（六态/四锁/授权闸/媒体契约/签名代理/单一动作层/reconcile 铁律/X 计费缝），实现行号可继续演进（媒体 id 补链、FB recent-posts reconcile 等在途工程不构成移动靶）。
> **状态：冻结候选（freeze candidate）——冻结走四权闭环（双顾问签核+异族复审+机器闸+非作者合并），依 #254 §一.2。本 PR 只起草+开 PR，不自称已冻结、不迁行、不碰矩阵/五本账/产品代码。** spec-ready 迁移随**冻结 PR**（04-B4 相关行随冻结迁级）。
> **基线**：本 spec 逐断言对 `main@45fb27f7`（`45fb27f7c36e71a36a1af1854af852343cb08e58`）核实。L1 施工图 `docs/superpowers/specs/2026-07-10-l1-meta-organic-publish-lighting.md` 的基线是 #213（`08759711`）时代——本 spec 的**第一工序（§一 差额核证）** = 把施工图逐断言对齐今日 main，冻结的是**已建成的真契约**而非图纸承诺。
> 人话：排期区「草稿→排期→审批→真的发到 IG/FB」这条闭环，#227/#229/#230/#231/#233 已把它从桩点亮为真能力。本 spec = 把这条闭环的**规则**冻死（后面谁改都不许把安全阀拆了），并把 5.5 条还没建的新行（X 发布、广告工作台、分享预览、审批请求、渠道 schema、时段种子）的施工合同定清楚。

---

## 一、差额核证（第一工序 —— spec 的地基）

> 方法：取 L1 施工图（基线 #213）每条关键断言，对 `main@45fb27f7` 逐条核实，产出偏差表。**判定列**三值：`成立`（图纸=实况）、`成立·Δ`（实况已建，但与图纸有增量/更保守/落点差，Δ 说明）、`未建/在途`（图纸承诺尚未落地）。用 CodeGraph/gbrain 优先定位代码；证据列给 `文件:行`。
> **一句话结论**：矩阵 04-B4 对 E4-01~E4-13 标 `integrated` 的**存量现状经核实为真**（发布链已建成、契约测试已升级为「未授权即拒发」）；差额集中在三处增量——三重锁→四重锁（#230）、媒体代理 A/B→**选定 B**、reconcile 比图纸**更保守**（confirmed-live 仍 NEEDS_ATTENTION）。E4-14（X 发布）**代码里无任何实现**，是本块唯一「schema→真 adapter」的从零新建。

| # | L1 施工图断言（出处） | 实况（main@45fb27f7） | 证据 文件:行 | 判定 |
|---|---|---|---|---|
| A01 | 排期区 3 视图 + Composer + `ScheduledPost`/`ScheduledPostMedia`/`PublishAttempt` 数据模型 + 状态机 + 审批闸已全部通电（§一.1） | 全部在。3 视图 plan/calendar/queue + Composer；三表 + 状态机 + owner-scoped 审批 | `apps/web/components/otto/OttoSchedule.tsx:151,300-347`；`packages/db/prisma/schema.prisma:1176`（PublishAttempt）；`packages/core/src/schedule-state.ts:15-49` | 成立 |
| A02 | 缺的**只有一件**：`publish: notImpl` 换真实现 + 发布 worker（§一.1，#227） | 已建成。web 侧 `meta-publish-adapter.ts` + worker 侧 `publish.ts` + 共用编排 `publishInstagram`/`publishFacebook`（`@fikirtive/core/server`） | `apps/worker/src/jobs/publish.ts:1-698`；`apps/web/lib/channels/meta-publish-adapter.ts`；`packages/core/src/publish.ts` | 成立·Δ（`meta-shared.ts:15 notImpl` **仍在**，但只服务 analytics 桩 `fetchAccountInsights`/`listPublishedPosts`/`fetchPostInsights`，**非 publish**——发布路径已是真实现） |
| A03 | 发布管线渠道无关，IG/FB 只是 adapter，零 per-channel worker 分叉（§一.2/§五单一动作层） | 成立。worker `realExecute` 经 `publishInstagram`/`publishFacebook` 同一编排；`ChannelId` = 开放串非闭集 | `apps/worker/src/jobs/publish.ts:356-367`；`apps/web/lib/channels/types.ts:3` | 成立 |
| A04 | Otto 永不直接持有发帖技能；`schedulePosts` 只建 DRAFT、$0、`approvedAt=null` | 成立。skill `cost:free/effect:write/reach:internal`，只经 `ctx.schedule.draft`，从不发布 | `packages/otto/src/skills/schedule-posts.ts:75-92` | 成立 |
| A05 | fail-closed：App Review 未过 / 权限未授 / kill-switch 开 / token 过期 → `publish()` 拒发（返回 error 不真发）（§一.4） | 成立。`authorize()` 依次校验 canPublish/organicPublishPaused/status/token 过期，任一不满足返回人话拒绝→NEEDS_ATTENTION | `apps/worker/src/jobs/publish.ts:138-153` | 成立 |
| A06 | 契约测试同步改写为「未授权即拒发」（不废除 fail-closed，只升级）（§八） | 成立。`registry.test.ts` 已从「throw not implemented」改写为「跑真授权闸，未授权返回 {error}、不抛、不调 Meta」逐 adapter 用例 | `apps/web/lib/channels/__tests__/registry.test.ts:3-4,48-77` | 成立 |
| A07 | IG 无原生排期 → 自建 scheduler 扫 due（§四A） | 成立。`scanDuePublishPosts` 扫 `SCHEDULED ∧ approvedAt≠null ∧ scheduledAt≤now ∧ metaPostId=null` | `apps/worker/src/jobs/publish.ts:676-697` | 成立 |
| A08 | 队列 policy：`retryDelay>0`（防瞬时重试风暴）+ `retryBackoff` + `expire` 长于最慢发布 + `deadLetter`（Seam 6 铁律，§四A） | 成立。`PUBLISH_QUEUE_POLICY` 定义在 packages/core，web/worker 共用同一对象 | `packages/core/src/publish.ts:46-59`；`packages/core/src/publish.test.ts:20-27`；`apps/web/lib/queue.ts:40-41` | 成立 |
| A09 | reaper 扫悬空 `APPLYING`，cutoff 必须 > queue expire（§四A） | 成立。`reapStalePublishAttempts`，`PUBLISH_STALE_MS=10min` > `expireInSeconds=300s` | `apps/worker/src/jobs/publish.ts:61-64,619-668` | 成立·Δ（图纸写「5 分钟扫」，实况 cutoff=**10min**，注释显式要求 > queue expire——比图纸更宽的安全边界） |
| A10 | 新增 `MetaConnection.canPublish`，仅当 Meta 实授 `instagram_content_publish`+`pages_manage_posts` 才 true（additive migration，§四B） | 成立。`completeMetaConnect` 派生 canPublish=两 scope 皆授；单授/仅 ads legacy 均 false | `apps/web/lib/meta-actions.ts:28-33`；`apps/web/lib/__tests__/meta-actions.test.ts:137-167` | 成立 |
| A11 | 新增 kill-switch `MetaConnection.organicPublishPaused`（照 `adsWritesPaused`）（§四B） | 成立。执行时刻 `authorize()` 拒 + scheduler `scanDue` 预过滤，双重断电 | `apps/worker/src/jobs/publish.ts:145,678` | 成立 |
| A12 | page access token + IG business account 解析（`listPages` 扩取 `access_token,instagram_business_account{id}`，§四B） | 成立。落在 **worker 侧** `resolvePage`（web 不能被 worker 反向 import 的边界所致），page token 永不离服务器 | `apps/worker/src/jobs/publish.ts:155-177` | 成立·Δ（落点=worker `resolvePage` 而非 web `listPages`；边界原因，语义等价） |
| A13 | token-encryption 抽包共用（web 不许被 worker 反向 import，§四B/§九） | 成立。已抽到 `@fikirtive/token-crypto`（`decryptToken`+`signMediaToken`），worker 直接 import | `apps/worker/src/jobs/publish.ts:28` | 成立 |
| A14 | 幂等**三重锁**：①metaPostId 短路 ②PublishAttempt APPLYING partial-unique ③IG creationId 存 attempt（§四D） | 三锁全在，**且加第四锁**（#230）。Lock1=metaPostId 短路；Lock2=APPLYING partial-unique；Lock3=creationId 存于 media_publish 前；**Lock4=UNCONFIRMED 歧义槽**——任一 UNCONFIRMED attempt 存在则拒发（NEEDS_ATTENTION，零 Meta 调用） | `apps/worker/src/jobs/publish.ts:394-400,429-440,348-354,407-427`；`schema.prisma:1176-1200`（state 增 `UNCONFIRMED`） | 成立·Δ（**三重→四重**，矩阵 E4-03 注已记「Δ#230 加 Lock 4」；PublishAttempt.state additive 增 UNCONFIRMED，partial-unique 谓词 `state='APPLYING'` 不受影响） |
| A15 | 审批点=人工 `approveScheduledPost`（写 approvedAt，owner-scoped）；worker 只发 `SCHEDULED ∧ approvedAt≠null`（§四E） | 成立。`approveScheduledPost` owner-scoped（target 属己、须有媒体、过状态机）；`scanDue` 硬性 `approvedAt:{not:null}` | `apps/web/lib/schedule-actions.ts:240`；`apps/worker/src/jobs/publish.ts:687` | 成立 |
| A16 | reconcile「先查真相再决定，永不盲重发」（§四F，六态⑥） | 成立**且更保守**。`reconcileAttempt` 只用 GET（幂等）；reaper 分「可证未发」(IG creationId=null→FAILED 可重试) vs「歧义」(→UNCONFIRMED) | `apps/worker/src/jobs/publish.ts:580-668` | 成立·Δ（图纸 §四F 写「IG 已发→补 metaPostId+PUBLISHED」；实况**即使 container confirmed-live 也 → NEEDS_ATTENTION**——container id ≠ 帖 media id，不盲 stamp 错引用〔M2〕，留人确认/补链） |
| A17 | FB 恢复：查最近 posts 是否已含→命中补 PUBLISHED，不命中 NEEDS_ATTENTION（§四F） | 部分。FB 无 creationId；recent-posts 匹配标注为 **future work**；当前**悬空 FB attempt 一律 NEEDS_ATTENTION**（永不盲 /feed 重发） | `apps/worker/src/jobs/publish.ts:579,595`（IG-only reconcile 分支）| 成立·Δ（FB recent-posts reconcile **在途/未建**，当前一律 fail-closed 到 NEEDS_ATTENTION——比图纸更保守，无双发风险） |
| A18 | 媒体公网 URL 策略：A（presigned）vs B（签名代理路由），荐 B（§四C，标「待施工 plan / founder 知情定」） | **选定 B**。`/api/media/pub/[token]` 路由 + `signMediaToken`(HMAC ownerId+key+exp) + `MEDIA_PROXY_SECRET`；未设→全 404 fail-closed；proxy matcher 精确排除该路由 | `apps/web/app/api/media/pub/[token]/route.ts`；`apps/worker/src/jobs/publish.ts:204-291`；矩阵 E4-06 注 | 成立·Δ（图纸留 A/B 决策项，实况**已定 B**——决策已闭合，本 spec 冻结 B 契约） |
| A19 | JPEG 转码落点：发布时按需 vs 生成时预备，荐发布时（§四C） | **选定发布时**。`transcodeToJpeg`（worker ffmpeg，抽单帧 mjpeg）仅当字节 sniff ≠ image/jpeg 才转 | `apps/worker/src/jobs/publish.ts:181-192,284-285` | 成立·Δ（决策已定=发布时按需，如荐） |
| A20 | 六态设计：成功/无权限/平台拒绝/超时/部分/恢复，每态 fail-closed（§三） | 成立。7 状态映射 6 结局；handler 逐态实现，含轮播「不存在物理半发」注释（防「补发半张」误设计） | `packages/core/src/schedule-state.ts:15-39`；`apps/worker/src/jobs/publish.ts:5-26,470-568` | 成立 |
| A21 | E4-08 媒体契约 Δ 闭合：#229 mime 白名单确定性拒绝 + #231 三入口前置拦截 + #233 存储字节 sniff 验真（**双层**） | **Δ 闭合**。pass 1a=client-mime 白名单（#229，非 image/* → mediaContractRefused → NEEDS_ATTENTION）；pass 1b=字节 sniff 验真（#233，`classifyImageBytes` 且须 == 存储 mime，storage read fail=retryable 非 verdict）；#231=UI/schedule 层三入口前置 `IG_IMAGE_ONLY_ERROR` | `apps/worker/src/jobs/publish.ts:229-277`；`apps/web/lib/schedule-actions.ts:208`；`schedule-service` `IG_IMAGE_ONLY_ERROR` | 成立（双层=pass 1a + pass 1b；前置=#231；三者齐，判非 FAILED 而 NEEDS_ATTENTION 语义正确） |
| A22 | App Review 递件：4 organic scope（`instagram_content_publish`/`pages_manage_posts`/`instagram_basic`/`pages_read_engagement`）进同一 consent（§六，#219） | 工程侧已建（#219 PR-L1a）。scope 串 + canPublish 派生 + 连接层已合；**过审=外部钥匙未到**（founder 侧递件+商业验证在等） | `#219` merge；`apps/web/lib/meta-oauth.ts:47`；矩阵 E4-13 | 成立（工程侧备齐；外部位见 §六二分清单） |
| A23 | E4-14 X/Twitter 发布（判决「要」+ 1cr/4cr 定价，隔离 adapter） | **代码里无任何 X 实现**。`channel-meta.ts` 仅 instagram/facebook；无 twitter/x adapter/publishX | grep `twitter\|x adapter` 全库零命中；`apps/web/lib/channels/channel-meta.ts:15-37` | 未建（schema→真 adapter，本块从零新建；计费碰 💰 见 §六） |

**差额核证收口**：23 条断言，21 条 `成立`/`成立·Δ`（发布 L1 闭环已建成、契约测试已升级、E4-08 双层闭合），1 条 `成立·Δ 部分`（A17 FB reconcile 在途），1 条 `未建`（A23 X adapter）。**无一条与矩阵/宪法/L1 图纸不可调和**——三处 Δ（四锁/媒体代理 B/reconcile 更保守）均为**图纸决策项已闭合或实况比图纸更保守**，方向一致，非冲突。故本块冻结对象（§三）= 冻结**已建成的真契约** + 定清 5.5 条新行施工合同。

---

## 二、范围与矩阵行映射

B4 块（`docs/ops/route-b/matrix/04-B4.md`）**20 行**：14 存量（`integrated`/`implemented`，经 §一 核实为真）+ 0.5（E4-14 X，`schema`→真 adapter）+ 5 新建（B0-27/28/29/30/103）。本 spec 对每行硬化 `人工入口/Otto skill/权限花费闸/测试/报告` 五列的 TBD-B4；明示排除：Ads 写执行族（E2-07/E4-10/E4-12）随 B4 App Review 重验但**写执行契约归 Ads 域**（本块只冻其与发布共享的 kill-switch/impersonation 闸对齐，不重开 ads 写编排）。

### 2.1 存量 14 行 —— 起证清单（每行：锚断言测试 + 六态证据 + 双执行差额）

> 「起证」= 行已建成（§一 核实），块验收不是重建而是**立证**：①锚断言测试绿（对标锚可判定）②六态证据留档（尤其②无权限/③平台拒绝/⑥恢复）③双执行差额清零（parity-debt 该行族清偿，见 §五）。

| 功能ID | 能力（简） | 人工入口（硬化） | Otto skill（硬化） | 权限/花费闸 | 测试（起证） | 报告 |
|---|---|---|---|---|---|---|
| E2-07 | Meta 写执行（v1 ACTION_CARD/v2 BUILD_CARD） | ads 区卡片 Approve 按钮 + server action | 归 Ads 域（propose→approve→execute）；本块不新增发帖 skill | Meta OAuth scope 门 + kill-switch（`adsWritesPaused`） | `meta-write-actions` reconcile/divergence 既有测试 + App Review 重验 | B4-REPORT §④/§⑧ |
| E4-01 | 排期区 3 视图 + Composer（账号/媒体复用/时区/first comment） | 排期区（plan/calendar/queue）+ Composer | `schedulePosts`（起草 DRAFT）；管理面 skill 见 §五 debt-71~74 | 无门（纯 UI + $0 composer，只复用已生成媒体） | `OttoSchedule` 渲染 + composer 校验测试；六态 statusPill 映射 | B4-REPORT §④/§⑥ |
| E4-02 | ScheduledPost/PublishAttempt/ScheduledPostMedia 数据模型 | n/a（数据层） | n/a | DB 约束（partial-unique/position unique） | `publish-attempt-uniqueness.test.ts`（四用例）+ schema 迁移测试 | B4-REPORT §⑧ |
| E4-03 | 防双发 exactly-once（**四重**幂等） | n/a | n/a | DB partial-unique（P2002 skip）+ Lock4 UNCONFIRMED | `publish.test.ts` + `publish-doublepost.test.ts`（redelivery/重启不双发） | B4-REPORT §⑧ |
| E4-04 | L1a 连接能力层（typed handle/$0/fail-closed，#219） | 连接区（OAuth 连/断） | n/a（连接=ACCOUNT_SECURITY 域） | `canPublish` DEFAULT false，仅两 scope 实授才 true | `meta-actions.test.ts`（canPublish 派生三用例） | B4-REPORT §⑩ |
| E4-05 | L1b 发布链（PUBLISH_QUEUE/scheduler/adapters/签名代理/幂等/reaper-reconcile） | n/a（worker） | n/a | 多重 fail-closed（各件） | `publish.test.ts` + `publish.ts` 契约测试 + `core/publish.test.ts`（policy） | B4-REPORT §⑦/§⑩ |
| E4-06 | 签名媒体代理（Plan B：HMAC token + `/api/media/pub/[token]`，不开桶） | n/a | n/a | `MEDIA_PROXY_SECRET` 未设→全 404 fail-closed；matcher 精确排除 | `app/api/media/pub/__tests__/route.test.ts` | B4-REPORT §⑧ |
| E4-07 | 单一发布动作层（IG create→poll→publish + carousel + first comment；FB /photos·/feed） | n/a（worker 与人工按钮共用同一 adapter） | n/a | adapter fail-closed 闸（E4-04） | `publishInstagram`/`publishFacebook` 契约测试 | B4-REPORT §④ |
| E4-08 | 媒体契约双层（非 JPEG 拦截 Δ） | 排期/批准入口三处前置（#231） | n/a（行为语义） | 无（语义闸）；双层=client-mime 白名单 + 字节 sniff | `publish-media-contract.test.ts` + `schedule-actions` IG_IMAGE_ONLY 测试 | B4-REPORT §⑥/§⑫ |
| E4-09 | Meta OAuth 连接/断开/data-deletion | 连接区 UI + 路由 | n/a（ACCOUNT_SECURITY） | OAuth env；disconnect server action | 连接/断开/data-deletion 既有测试 | B4-REPORT §⑩ |
| E4-10 | Ads 自治开关（Ask/Auto）+ ads kill-switch | 广告区开关 | 归 Ads 域 | `adsAutonomy`(ASK 默认)+`adsWritesPaused`；断连即 reset | ads kill-switch 既有测试 | B4-REPORT §⑧ |
| E4-12 | Meta 写 v1/v2（pause/resume/reschedule）+ App Review | 广告区卡片 | 归 Ads 域 | kill-switch + impersonation 闸 | `meta-write-actions` 既有测试 + App Review 重验 | B4-REPORT §④ |
| E4-13 | OAuth 4 organic-publish scope（App Review 待批） | 连接区 consent | n/a | Meta App Review（外部钥匙）；未过→scope 不授→canPublish=false | scope 串测试 + 过审后浏览器 QA | B4-REPORT §⑩/§⑬ |
| E4-16 | 平台可插拔（adapter 缝：加新平台改不改核心？） | n/a | n/a | 蓝图扩展缝（ChannelId 开放串） | 加 X adapter（E4-14）即活体验证「零核心改动」 | B4-REPORT §⑩ |

### 2.2 新建 5.5 行 —— TBD-B4 逐列硬化

> 「5.5」= 5 条 B0 新行 + 0.5（E4-14 X，schema 已在、adapter 从零）。每行硬化：人工入口 / Otto skill / 权限花费闸 / 测试 / 报告。**出生即配双执行器 + parity 登记**（缝 9 铁律，宪法 7）。

| 功能ID | 能力 | 人工入口（硬化） | Otto skill（硬化） | 权限/花费闸 | 测试 | 报告 |
|---|---|---|---|---|---|---|
| **B0-27** | 广告构建工作台（人工建 campaign 草稿 $0/PAUSED） | A′ 页 `ads/builder`（切片6）：建草稿全 PAUSED、$0，启用另走闸 | `proposeAdBuild`（`ads-analytics` 域，已在缝1）起草 BUILD_CARD；执行走审批 | build=$0；启用走 Meta 写闸 + App Review（隔离于 organic 发布） | builder 草稿 $0/PAUSED 契约测试 + 「不启用即不写 Meta」测试 | §④/§⑫ |
| **B0-28** | 单帖分享预览页（无席位链接式外审） | A′ 页 `schedule/share-preview`（切片5）：token 链接对外只读 | 归 schedule 域（分享=读对等，free/read 生成分享链） | 分享 token 权限边界（**mock 风险 14/18：token 写死**——冻结：token=HMAC(ownerId+postId+exp)，服务端铸造/校验，越权静默 404） | 分享 token owner 隔离测试 + 过期/越权 404 测试 | §⑧/§⑫ |
| **B0-29** | ApprovalRequest 最小版（kind=PUBLISH，payload hash 绑定，审批后漂移即失效） | 排期区 Approve（复用 approveScheduledPost，**不许自建第二套审批**） | n/a（审批=人闸，见 §五 debt-70） | payload hash 绑定：批准的是冻结 payload，媒体/文案漂移即 hash 变→失效重批 | ApprovalRequest hash 绑定 + 漂移失效测试 | §④/§⑧ |
| **B0-30** | ChannelConnection 通用渠道连接 schema（kind 开放串 + 加密 token） | n/a（数据层；Meta 日后择机迁入） | n/a | kind=开放串（非闭集 enum，house style）；token 加密列（照 MetaConnection.accessTokenEnc） | schema 迁移测试 + 加密列非明文断言 | §⑧/§⑩ |
| **B0-103** | 冷启动时段种子表（最佳发帖时段种子，A/S 区） | 排期 composer 时段建议（读种子表） | 归 schedule 域（读种子=free/read） | n/a-静态种子（$0） | 种子表读取 + 无写路径测试 | §③/§⑧ |
| **E4-14** | X/Twitter 发布（判决「要」+ 1cr/4cr，隔离 adapter） | 排期 composer 加 X 渠道（复用同一发布 worker，加 adapter） | 归 schedule 域（同 schedulePosts 起草，X target） | **X 发布分档计费 1cr/4cr 走缝3 reserve→settle + 审批公式；变真必过 money-safety-review**（见 §六） | X adapter 发布契约测试 + 计费 reserve→settle 幂等测试 + 「零核心改动」活体（E4-16 联验） | §④/§⑨/§⑪ |

**TBD-B4 硬化收口**：20 行的 `人工入口/Otto skill/权限花费闸/测试/报告` 五列全部硬化——存量 14 行落「起证」列（已建成→立证），新建 5.5 行落「施工」列（人工入口页 + 缝1 skill 归域 + 闸 + 测试 + 报告节）。**无一行残留裸 TBD-B4**（Ads 写执行的 Otto skill 显式归 Ads 域=有意归置，非漏填）。

---

## 三、冻结对象（发布 L1 八契约）

> 沿 B9「冻契约不冻实现」：冻的是**接口形状与语义**，实现行号可继续演进。以下八契约冻结后，任何块改发布链**不许侵蚀这些不变式**（侵蚀=CI 红或复审阻断）。

### 契约 1 · 六态语义闭集（`schedule-state.ts` TRANSITIONS）
- `ScheduledPostStatus` 七值闭集（DRAFT/SCHEDULED/PUBLISHING/PUBLISHED/FAILED/NEEDS_ATTENTION/CANCELLED），映射六结局；`TRANSITIONS` 表冻结（缺席组合=非法，终态出度空）。**加/减状态=改此一处**（code-side 常量，无迁移）。
- **每态默认 = 「停下让人看」而非「乐观继续」**（fail-closed 总纲）：无权限→NEEDS_ATTENTION 不硬闯；平台拒绝→FAILED 给人话不重试；超时→有限退避后 NEEDS_ATTENTION 不静默；歧义→UNCONFIRMED（Lock4）；恢复→查真相不盲重发。

### 契约 2 · 四重幂等锁不变式（防双发）
- Lock1（metaPostId 短路，已发不再发）· Lock2（PublishAttempt `state='APPLYING'` partial-unique，一帖至多一 in-flight）· Lock3（IG creationId 存于 media_publish **之前**，reconcile 复查同一容器不重建）· **Lock4（UNCONFIRMED 歧义槽，#230）**：任一 UNCONFIRMED attempt 存在→handler 在任何 claim/Meta 调用**之前**拒发（NEEDS_ATTENTION，零 Meta 调用，可见拒绝非静默 skip）。
- 冻结不变式：**四锁缺一整链断**；PublishAttempt.state 的 `UNCONFIRMED` 值 additive，partial-unique 谓词恒为 `state='APPLYING'`。**轮播不存在物理半发**（IG media_publish 单次原子）——禁「补发剩余半张」恢复逻辑（=双发），写死注释。

### 契约 3 · fail-closed 授权闸（稳态断电）
- `publish()` 前置校验：`canPublish`（两 scope 实授才 true，DEFAULT false）∧ `!organicPublishPaused`（kill-switch）∧ `status≠expired` ∧ token 未过期。任一不满足→人话拒绝→NEEDS_ATTENTION，**零外部调用**。
- scheduler `scanDue` 预过滤 `canPublish ∧ !paused ∧ active`：**App Review 未过→零 owner 授权→zero enqueue→SCHEDULED 帖原地不动（零行为变化）**。这是稳态 fail-closed 的根。

### 契约 4 · 媒体契约双层（`buildMediaUrls`，E4-08）
- pass 1a（#229，client-mime 白名单）：IG 目标下任一 asset `normalizeImageMime(mime)` 非 `image/*`→整帖 `mediaContractRefused`→NEEDS_ATTENTION（**非 FAILED**——素材本身不对，重试无用；语义②非③），在任何 ffmpeg/Graph **之前**。
- pass 1b（#233，字节 sniff 验真）：对将**真正发布**的存储对象读 bounded prefix，`classifyImageBytes` 须（①）判为白名单静态图 **且**（②）== 存储 mime；client mime 会撒谎（真 mp4 冒充 image/png），字节说了算。**storage read 失败 = retryable operational error，非媒体判决**（永不 fallback 信任存储 mime）。
- 转码决策信**字节 sniff 结果**（非 client `ext`）：sniff ≠ image/jpeg 才 `transcodeToJpeg`。
- 前置拦截（#231）：UI/schedule 层三入口 `IG_IMAGE_ONLY_ERROR`，把非图挡在排期/批准之前。

### 契约 5 · 签名媒体代理（Plan B，E4-06，守租户铁幕）
- 冻结 B 方案：`/api/media/pub/[token]` + `signMediaToken(ownerId, key, exp, secret)`（HMAC）；服务端校验后流式回字节。**不开公共桶**（否决 C，违宪法6铁幕）。
- fail-closed：`MEDIA_PROXY_SECRET` 未设→verify 返 null→全部 404；`proxy.ts` matcher 精确排除该公开路由。TTL 冻结为**接口常量**（`MEDIA_TTL_MS`，须 cover Meta 异步拉取窗，A5 实测定下限，founder ack 可调）。

### 契约 6 · 单一发布动作层（宪法 7，E4-07/E4-16）
- worker 与人工按钮**不各写一套发布逻辑**——都经 `publishInstagram`/`publishFacebook`（`@fikirtive/core/server`）同一编排，**零 per-channel worker 分叉**。
- 平台可插拔缝（E4-16）：`ChannelId` = 开放串非闭集；**加新平台 = 加 adapter，不改核心 worker**——E4-14（X）即此缝的活体验证。

### 契约 7 · reconcile 保守铁律（六态⑥，§四F）
- reconcile **只用 GET**（幂等，不能双发）；**永不在结局不明时乐观重发**。
- IG：即使 container `status_code=PUBLISHED` 也 →NEEDS_ATTENTION（container id ≠ 帖 media id，不盲 stamp 错引用〔M2〕，留人确认/补链）——媒体 id 补链是**在途工程**，不构成移动靶。
- FB：无 creationId，recent-posts 匹配是 **future work**；当前悬空 FB attempt 一律 NEEDS_ATTENTION（永不盲 /feed 重发）。
- reaper 分「可证未发」（IG creationId=null→FAILED 可重试，恢复 pre-D2 行为）vs「歧义」（→UNCONFIRMED，Lock4 冻住）。

### 契约 8 · X adapter 隔离缝 + 计费断言（E4-14，形状冻结·实现随排产）
- 冻结形状：X 走**同一发布 worker**（契约 6 缝），隔离 adapter，零核心改动。
- **计费断言（碰 💰）**：X 发布**分档 1cr/4cr**（GRILL X 定价判决），走**缝3 reserve→settle + 审批公式**；**变真必过 `money-safety-review`**（义务写进 E4-14 行 + §六）。计费点是本块**唯一** money 触点（organic IG/FB 发布 $0）。
- 冻结时随契约上报 founder 的 X 计费定档为 founder-only 单列项（PR 说明向 founder 显式点出，D-021/矩阵 E4-14 注）。

---

## 四、对标锚清单（§六 水准判官格式）

> 阈值可判定；并排截图打分法一句话：**同旅程截图我方 vs 锚品并排，逐关口打「平齐/超过/未及」三档，未及即开待裁条目**。

| 锚 | 版本 | 关键旅程 | 通过阈值 |
|---|---|---|---|
| Buffer | 2026-07 | 排期→（审批）→发布 队列旅程 | 三视图 + Composer 账号/时区/媒体复用不逊于 Buffer 的 Queue/Calendar；六态状态回显（尤其失败原因人话可见）平齐或超过 |
| Later | 2026-07 | 视觉排期 + 媒体校验前置 | IG 媒体校验（#231 三入口前置 + 非 JPEG 拦截）在**排期时**即拦（不到发布才失败）——对标 Later 的媒体预检，平齐或超过 |
| Hootsuite | 2026-07 | 多账号审批流 + 失败恢复 | 审批闸（人工 approve）+ 恢复态（NEEDS_ATTENTION 人话 + 重排）对标 Hootsuite 的 approval workflow；**不双发**是我方硬承诺（四锁），锚品无此级别公开保证 |
| Meta 官方发布语义 | Graph API（v21.0，文档级） | IG create-container→poll→media_publish；FB /feed；配额；轮播原子性 | 每步对齐官方文档语义（`content_publishing_limit` 配额、carousel media_publish 单次原子、IG JPEG-only）；假设台账 A1-A7 逐条实测坐实 |
| **X adapter（E4-14 单列锚）** | X API（2026-07） | X 排期→发布 + **分档计费** | X 发布走同一 worker（零核心改动=E4-16 活体）；**计费断言**：1cr/4cr 走缝3 reserve→settle（出处=GRILL X 定价判决）；发布语义对齐 X API 官方；money-safety-review 过 |

> 联验归属：Otto 话术全绿（每功能块）归 **B11 联验**（sonnet 级，宪法 10）；本块只冻锚 + 阈值，不在本 PR 打分。

---

## 五、债清偿协议（缝 9 棘轮，`parity-debt.md` B4 行族）

> B4 行族债 = debt-70~74（`E4-01` 归属，`schedule-actions` 五动作）。三态语义 `skill / exempt(四类闭集) / todoSkill`（B9 契约3 冻结）。**债只降不升**（棘轮）；新增豁免类别=修宪。四类闭集（`parity-manifest.ts:15`）= **ADMIN · VISUAL · MONEY_IN · ACCOUNT_SECURITY**。

| 债号 | action | 现状 | 本 spec 处置 | 处置类别 |
|---|---|---|---|---|
| **debt-70** | `approveScheduledPost` | todoSkill | **显式豁免** —— 处置理由（写死）：**审批是人对 agent 的最后一道人闸；代客户发帖=消费/外部写（Meta 政策 1.7 需明确同意），配 skill 让 Otto 自批=闸失义**。归置 `ACCOUNT_SECURITY`（外部账号写的人工同意闸，L1 §五「ACCOUNT_SECURITY 邻类」出处）。 | **exempt: ACCOUNT_SECURITY**（**边界待裁见下**） |
| **debt-71** | `cancelScheduledPost` | todoSkill | 配 **写 skill**：`cancelScheduledPost`（manage-schedule 写面，`effect:write`，Otto 可代人取消排期） | skill（write） |
| **debt-72** | `updateScheduledPost` | todoSkill | 配 **写 skill**：`editScheduledPost`（manage-schedule 写面，`effect:write`，Otto 可代人改排期） | skill（write） |
| **debt-73** | `listScheduledPosts` | todoSkill | 配 **读 skill**：`listScheduledPosts`（`free/read`，走 ctx port 不直连 Prisma，B9 契约5 读对等；Otto 看同一队列） | skill（read） |
| **debt-74** | `listOwnerTargets` | todoSkill | 配 **读 skill**：`listPublishTargets`（`free/read`，Otto 看可发目标） | skill（read） |

**处置收口**：5 条债全处置——1 豁免（debt-70）+ 2 写 skill（71/72）+ 2 读 skill（73/74）。**豁免归置未超出四类闭集**（ACCOUNT_SECURITY，非新类），故**不触修宪停手条件**。

> **边界待裁（冻结 ack 项，非本 spec 自判）**：debt-70 归 `ACCOUNT_SECURITY` 是 L1 §五「邻类」的采纳——「代外部账号发帖的人工同意闸」与 ACCOUNT_SECURITY 现有成员（OAuth 绑定/断连/sign-out）**语义相邻但非完全同类**。L1 §五明写此归置「由 founder/总审查员定」。本 spec **不自行改判 parity-manifest**（本 PR 不碰五本账），只**提案**归置；类别边界的最终批准 = 冻结四权闭环里 founder/总审查员的一次确认。**若复审判定此归置实为「需第五类（如 HUMAN_CONSENT_GATE）」= 修宪级，停手升 founder**——本 spec 已把该风险显式标出，不越权。

---

## 六、花钱与外部边界（三无纪律）

### 6.1 三无纪律（本块 organic 发布零真实成本）
- **organic IG/FB 发布 = $0**（媒体复用已付费成片，发帖不向 Meta 付费）——不走记账缝、不触 money-safety（除 E4-14 X 计费，见 6.3）。
- **本块零真实发帖**：验收用 **staging + Meta 测试账号沙箱旅程**（test users / test Page / test IG business account）。真号真发只在**过审后**的浏览器 QA（founder 逐笔知情），非本块开发期。
- kill-switch / 未授权拒发 = **契约测试**（非真发验证）：`registry.test.ts`（未授权即拒发）+ `publish.test.ts`（canPublish/paused/token 过期拒发）+ `publish-doublepost.test.ts`（不双发）。

### 6.2 App Review 演示物料 —— 二分清单（工程侧已备 / 等 founder 侧）

> 材料施工期=Q4 细化（外部申请材料建成后一批递交，总计划 Q4）。本 spec 只输出二分状态，不代 founder 递件。

| 项 | 工程侧（已备/可办） | founder 侧（等） |
|---|---|---|
| 4 organic scope 进 consent | ✅ 已建（#219 scope 串 + canPublish 派生） | — |
| data-deletion 回调 | ✅ 已有（`api:meta/data-deletion.POST`，parity 登记 ACCOUNT_SECURITY） | — |
| 每权限 1080p 屏录（该权限具体动作，非泛介绍） | ☐ 可办（过审前用 staging 沙箱录整条：排期→审批→真发→IG/FB 可见） | — |
| Meta 测试账号 + test Page + test IG business account | ☐ 可办（app 后台建 test users，让审核员亲手复现——**通过命门**） | — |
| Business Verification（商业验证） | — | ☐ 等（BELCORT 实体，营业执照；越早越好，几天到几周） |
| 接受 Platform Onboarding Terms / Advanced Access 申请发起 | — | ☐ 等（有权限实体身份发起） |
| 隐私政策 URL / app 图标 / 用途说明 | ✅/☐（隐私政策既有；用途说明须与实际发布一致） | ☐ 确认（1.4 别夸大） |

### 6.3 E4-14 X 计费点（碰 💰）
- X 发布分档 **1cr/4cr**（GRILL X 定价判决）走**缝3 reserve→settle + 审批公式**；这是本块**唯一** money 触点。
- **义务（写进 E4-14 行）**：X adapter 变真时，PR 期**必过 `money-safety-review`**（typed genRequest 门 / reserve→settle 幂等 / idempotencyKey dedup）；本 spec 冻结此义务，不在本 PR 建 X 计费代码。

---

## 七、假设台账

> 承接 L1 §七 A1-A7（官方文档自相矛盾/登录墙/存疑），补 B4 块级假设。**动工可按保守假设建，上线前用真号实测坐实**；每条给实测法。

| # | 假设/存疑 | 依据/现状 | 验证法 |
|---|---|---|---|
| A1 | 24h 发布配额 50 还是 100 | 官方同页自打架 | 连真 IG 调 `GET content_publishing_limit` 看生效值；adapter `rateLimitPer24h:25` 保守，实测只为确认无更低隐藏墙 |
| A2 | Stories 互动贴纸支持度 | 官方未逐条确认 | 测试账号试各贴纸参数；本块 Stories 按 `reminder`（提醒人手发），贴纸自动化不在本块 |
| A3 | PPA 是否仍是 IG 发布前置 | 官方页未正面确认 | App Review 前后用 test Page 走一遍看是否被要求 PPA |
| A4 | App Review 时长 | 官方只保证「一周内」 | 以 Meta 后台状态为准，规划按一周（别按 2-3 天承诺 founder） |
| A5 | IG 图片公网 URL 拉取窗口 | Meta 异步拉媒体滞后无官方数字 | 真发布测容器 create→FINISHED 实际耗时，反推 `MEDIA_TTL_MS` 下限（现 2h 是宽松默认，留足余量） |
| A6 | 视频/Reels 转码失败率与时长 | 官方转码，形态没给 | 测几条真视频，确认六态④超时阈值（`PUBLISH_EXECUTION_DEADLINE_MS`）合理 |
| A7 | FB 主页发帖需 `CREATE_CONTENT` | 官方口径明确 | admin 权 Page vs 受限 Page 对测，确认错误映射到六态②人话 |
| B4-01 | IG media 补链（container id → 帖 media id）方案 | 契约7：现 confirmed-live 也 NEEDS_ATTENTION（不盲 stamp container id） | 排产 IG 补链切片时，用 `/media` correlated lookup 实测能否可靠回帖 media id；坐实前保持保守（NEEDS_ATTENTION 留人补链） |
| B4-02 | FB recent-posts reconcile 可靠性 | 契约7：FB reconcile future work，现悬空一律 NEEDS_ATTENTION | 排产 FB reconcile 时，用内容/时间窗匹配实测误配率；不达标则维持保守 |
| B4-03 | X 发布语义 + 1cr/4cr 计费幂等 | E4-14 schema→adapter，缝3 reserve→settle | X adapter 建成时 money-safety-review + reserve→settle 幂等契约测试；分档定价 founder 终确认 |
| B4-04 | B0-28 分享 token 权限边界（mock 风险 14/18：token 写死） | 本 spec 冻结 token=HMAC(ownerId+postId+exp) | 越权/过期 token → 404 契约测试；不留写死 token |

---

## 八、冻结条件与状态

- **状态：冻结候选 v0.1（freeze candidate）。** v0.1 骨架 = §一 差额核证（23 断言对 main@45fb27f7 立证）+ §二 20 行 TBD 硬化 + §三 八契约冻结对象 + §四 对标锚 + §五 债 5 条处置 + §六 三无边界 + §七 假设台账。
- **冻结走四权闭环**（#254 §一.2）：双顾问签核 + 异族复审 + 机器闸 + 非作者合并。放行后 04-B4 相关行随**冻结 PR** 迁 `spec-ready`（**本 PR 不迁行**，#254 §一.3/§二.5 founder 终验一次过审计索引）。
- **本 spec 属发布链契约/schema 相邻**：debt-70 归类边界（§五 边界待裁）+ E4-14 X 计费定档（§三 契约8）为 founder-only 单列项，冻结 ack 时明示上报，**不在本 spec 自行落地**。
- **冻结时随契约上报 founder 的 founder-only 单列项**：①debt-70 → ACCOUNT_SECURITY 归置的类别边界确认（或判为需第五类=修宪，停手升 founder）；②E4-14 X 发布 1cr/4cr 分档定价；③`MEDIA_TTL_MS` / `PUBLISH_STALE_MS` 等接口常量的 founder ack（现值已冻，可调需一处改）。
- **开放问题（v0.1 处置）**：
  1. IG media 补链方案（契约7 B4-01）→ **保守闭合**：坐实前 confirmed-live 也 NEEDS_ATTENTION，不盲 stamp；补链是在途工程不阻塞冻结。
  2. FB reconcile recent-posts（契约7 B4-02）→ **保守闭合**：现一律 NEEDS_ATTENTION（永不盲重发），可靠性达标后再放开。
  3. debt-70 豁免类别边界（§五）→ **提案 ACCOUNT_SECURITY + 升 founder 确认**：未超四类闭集故不触停手；若复审判需第五类=修宪级，停手报告。

> 与既有法冲突处（矩阵行义/宪法/L1 施工图不可调和）：**本 spec §一 核证未发现不可调和冲突**——三处 Δ 均为图纸决策项已闭合或实况比图纸更保守，方向一致。debt-70 类别边界为**已显式标出的待裁项**（非冲突，是留给 founder/总审查员的一次确认）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
