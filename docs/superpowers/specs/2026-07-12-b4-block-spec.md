# B4 · 发布 L1（Reminder-assisted + Direct）+ Meta 通电族 · 块 spec（v0.5 对齐）

> 2026-07-12。epoch `claude-20260712-03`。工位=SPEC-B4（worker 作品，署名工位）。
> 性质：**冻契约不冻实现**——本 spec 冻结的是发布 L1 闭环的**接口形状与语义**（六态/四锁/授权闸/媒体契约/签名代理/单一动作层/reconcile 铁律/X 计费缝），实现行号可继续演进（媒体 id 补链、FB recent-posts reconcile 等在途工程不构成移动靶）。
> **v0.4 历史状态**：原冻结 PR 走四权闭环并同步 04-B4；其中「本 PR 不碰矩阵/旧手工账」只描述当时起草 PR，不是后续对齐的限制。
> **2026-07-16 v0.5 / D-038 对齐（Blueprint v2.12/#334）**：保留下文 v0.4 的发布机械安全合同；以本附录取代「块内 mock 绿即可完成发布」和「只有 Direct 才算发布」的旧执行含义。Reminder-assisted 与 Direct 是两种可独立 release-certified 的真实发布模式，任一模式只对其已验证范围作真陈述；两者都不得凭 mock 或计划状态冒充已发布。
> **v0.5 merge provenance**：Founder 已合并这次 alignment revision；它同步 B4 矩阵而未改产品代码、schema 或六级状态。执行前仍须 live-query current GitHub/main，不能只凭本文日期判断现状。
>
> - **Reminder-assisted**：排期后生成冻结 posting pack（媒体/copy/账号/时间/模式）；持久 in-app task 默认到点前 15 分钟提醒、到点一次 follow-up、逾期 30 分钟标 `Missed`；用户可从同一任务下载、复制、打开目标 app、重排或跳过，再自行发布。另设**独立 opt-in** 的 email reminder；reminder channel、时间、时区与 quiet-hours 例外随 request 一次呈现。它与 Customer Email marketing 的 purpose、consent 和退订分开，但共用可扩展 notification seam，为未来 FIKIRTIVE→merchant channels 留口；关闭 Marketing Email/某站外通知不删除站内任务事实。Browser Push/SMS/WhatsApp 商家提醒本期仍 Coming soon。状态必须区分 `Merchant confirmed` 与 `Platform verified`，后者只能来自平台可验证回执。
> - **Direct**：唯一正向授权是当前 mode 下的精确 post 或精确 batch，payload/hash 漂移即失效；account/global switch 只能负向暂停，不能授予未来发布，也不能把历史 Reminder/DRAFT 队列静默转换为 Direct。Otto 与人工入口消费同一 ApprovalRequest/动作层。
> - **独立放行门**：同一 release SHA 覆盖支持矩阵；自动化/mock 契约层 + 内部 UI/device 层 + 受控真实 email/Meta 层逐层起证；重复/错账号/错内容/错时间窗/越权/错误状态或回执等 hard-zero 缺陷为 0。Reminder-assisted 与每个 Direct channel × post type 分开认证；没有商家考试，但未过真实层的模式只能诚实标未放行。完整商业 Phase‑1 仍须与内容、Customer Engagement CRM 及 UIUX/user-flow 总门共同通过（总计划「七·甲」）。
> **v0.2 闭合 codex BR1（BLOCK，五项全实）**：①三处失实改正——共享编排指向改 `packages/core/src/meta-publish.ts:126`（`publish.ts` 只是队列契约）；「零 per-channel worker 分叉」降准为闭集分发实况（`publish.ts:356` if/else + `schedule-draft.ts:12` 闭集），E4-14/E4-16 施工合同随之改写；proxy matcher「精确排除」改正为**无边界前缀**（`proxy.ts:73`，`/api/media/pubfoo` 会被放行），边界断言列入 B4 施工验收项。②**debt-70 改判（当时 approved outcome，采 codex 替代方案）**：撤回 ACCOUNT_SECURITY 豁免提案，改 **gated skill 清偿**（`free/write/external` → `deriveNeedsApproval`〔`skill.ts:66`〕自动 true——人仍逐次亲手确认，Otto 不自批、闸不失义、**零豁免、不触修宪**）；debt-71~74 契约冻全（三元组/port/handler/测试命名/debt-72 退 DRAFT 不变式）。③9 行真硬化（逐行点名 tool 名+cost/effect/reach+归域）。④锚表两修（X 档位映射冻结+GRILL-VERDICTS:215 原文+方向断言；Meta 官方锚改逐关口判定表，A1 显式留 TBD-B4 实测槽）。⑤真实发帖边界统一（块内验收=mock/夹具级零真实外部写；测试账号真发=外部测试阶段单列 §六.2，前置 Founder 授权）。
> **v0.3 处置 codex BR1-R2 中段线索（复审任务因 codex 网络停摆取消；两条未确认线索经工位对代码核实——均属实）**：①**E4-14 触点清单补排期 UI 硬编码**——`OttoSchedule.tsx` 六处渠道字面量分支（ChannelIcon :86/:95、默认渠道 :287、composer 回退 :405、筛选 chips :434-435、类型断言 :1123/:1135、caps 文案二元 ternary :1199）入触点⑦；契约6 闭集触点 4→5 处，UI 收敛=CHANNEL_META 数据驱动。②**通用审批卡链缺口**——`ottoApprove` 匹配器硬过滤 `toolName !== "generate"`（`otto-actions.ts:697`），非 generate 的 needsApproval 中断**卡出不来、批不动=闸有名无实**；**不推翻 gated-skill 方案**（派生律 fail-closed 成立：中断只 pause、不误执行），通用审批卡链（渲染+匹配泛化+恢复+测试）补进 debt-70 施工触点（§五 5.1·附）。
> **v0.4 闭合 codex BR1-R3（BLOCK(3)，其余四点+线索②全 CLOSED）**：①**E4-10 假挂靠改正**——`propose-meta-action` 动作枚举只有 `pause|resume|set_budget|reschedule`（`propose-meta-action.ts:27-29`），调不到 `setAdsAutonomy`/`setAdsWritesPaused`（`meta-write-actions.ts:8/:21`），parity-manifest:192-193 是字面映射非真对等——E4-10 Otto skill 列改**施工合同**（扩枚举加 `set_autonomy`/`set_writes_paused` 或新建 gated skill，二择归施工工位；验收=Otto 真实触达+审批闸+测试）。②**G4 锚照实码改正**——单图→`/photos`（url+caption）、无媒体→`/feed`（message+link）（`meta-publish.ts:214-228`+测试 `:175-190`，工位复核与 codex 行号相符）；顺检 G1 照实码精化（轮播子图无 caption）、G3 补 2xx-无-id→ambiguous。③**触点计数残留同步**——spec E4-16 行 + 对应 GitHub task/PR evidence ⑫.4「4 处」→「5 处」，全文 grep 防漏。
> **基线**：本 spec 逐断言对 `main@45fb27f7`（`45fb27f7c36e71a36a1af1854af852343cb08e58`）核实。L1 施工图 `docs/superpowers/specs/2026-07-10-l1-meta-organic-publish-lighting.md` 的基线是 #213（`08759711`）时代——本 spec 的**第一工序（§一 差额核证）** = 把施工图逐断言对齐今日 main，冻结的是**已建成的真契约**而非图纸承诺。
> 人话：排期区「草稿→排期→审批→真的发到 IG/FB」这条闭环，#227/#229/#230/#231/#233 已把它从桩点亮为真能力。本 spec = 把这条闭环的**规则**冻死（后面谁改都不许把安全阀拆了），并把 5.5 条还没建的新行（X 发布、广告工作台、分享预览、审批请求、渠道 schema、时段种子）的施工合同定清楚。

---

## 一、差额核证（第一工序 —— spec 的地基）

> 方法：取 L1 施工图（基线 #213）每条关键断言，对 `main@45fb27f7` 逐条核实，产出偏差表。**判定列**三值：`成立`（图纸=实况）、`成立·Δ`（实况已建，但与图纸有增量/更保守/落点差/降准，Δ 说明）、`未建/在途`（图纸承诺尚未落地）。用 CodeGraph/gbrain 优先定位代码；证据列给 `文件:行`。
> **一句话结论**：矩阵 04-B4 对 E4-01~E4-13 标 `integrated` 的**存量现状经核实为真**（发布链已建成、契约测试已升级为「未授权即拒发」）；差额集中在四处——三重锁→四重锁（#230）、媒体代理 A/B→**选定 B**、reconcile 比图纸**更保守**（confirmed-live 仍 NEEDS_ATTENTION）、**平台可插拔=方向性缝而非现状**（渠道分发今为 IG/FB 闭集 if/else，加 X 非「零核心改动」）。E4-14（X 发布）**代码里无任何实现**，是本块唯一「schema→真 adapter」的从零新建。

| # | L1 施工图断言（出处） | 实况（main@45fb27f7） | 证据 文件:行 | 判定 |
|---|---|---|---|---|
| A01 | 排期区 3 视图 + Composer + `ScheduledPost`/`ScheduledPostMedia`/`PublishAttempt` 数据模型 + 状态机 + 审批闸已全部通电（§一.1） | 全部在。3 视图 plan/calendar/queue + Composer；三表 + 状态机 + owner-scoped 审批 | `apps/web/components/otto/OttoSchedule.tsx:151,300-347`；`packages/db/prisma/schema.prisma:1176`（PublishAttempt）；`packages/core/src/schedule-state.ts:15-49` | 成立 |
| A02 | 缺的**只有一件**：`publish: notImpl` 换真实现 + 发布 worker（§一.1，#227） | 已建成。**共享编排 = `packages/core/src/meta-publish.ts`**（`publishInstagram`:126 / `publishFacebook`，IG create→poll→media_publish 全逻辑在此）；web 侧 `meta-publish-adapter.ts` 与 worker 侧 `jobs/publish.ts` 都驱动它；`packages/core/src/publish.ts` **只是队列契约**（PUBLISH_QUEUE/policy 常量，非编排） | `packages/core/src/meta-publish.ts:126`；`apps/worker/src/jobs/publish.ts:29-34`（import `@fikirtive/core/server`）；`apps/web/lib/channels/meta-publish-adapter.ts`；`packages/core/src/publish.ts:11,46-59` | 成立·Δ（`meta-shared.ts:15 notImpl` **仍在**，但只服务 analytics 桩 `fetchAccountInsights`/`listPublishedPosts`/`fetchPostInsights`，**非 publish**——发布路径已是真实现） |
| A03 | 发布管线渠道无关、零 per-channel worker 分叉，加平台=加 adapter 不改核心（§一.2/§五单一动作层/蓝图 E4-16 缝） | **降准**。单一动作层**成立**（web adapter 与 worker 驱动同一 `meta-publish.ts` 编排，六态/四锁/授权闸核心确为渠道无关层）；但「零 per-channel worker 分叉」**不成立**：worker `realExecute` 是 `if (channel==="instagram") … else publishFacebook` 硬分支；排期核心 `SCHEDULE_CHANNELS` 为 **IG/FB 闭集**（测试明确拒非成员）；Otto skill 参数 `z.enum(["instagram","facebook"])` 同闭。**加 X ≠ 只加 adapter**——需改 worker 分发 + validator 闭集 + skill enum + 客户端镜像（触点清单见 §三 契约8） | `apps/worker/src/jobs/publish.ts:356-366`；`packages/core/src/schedule-draft.ts:12-17`；`packages/otto/src/skills/schedule-posts.ts:24`；`apps/web/lib/channels/channel-meta.ts:15-37` | 成立·Δ（**降准**：单一动作层真；「零核心改动可插拔」是缝的方向而非现状——E4-16 验收改写见 §三 契约8） |
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
| A18 | 媒体公网 URL 策略：A（presigned）vs B（签名代理路由），荐 B（§四C，标「待施工 plan / founder 知情定」） | **选定 B**。`/api/media/pub/[token]` 路由 + `signMediaToken`(HMAC ownerId+key+exp) + `MEDIA_PROXY_SECRET`；未设→verify 返 null→全部 404 fail-closed。**会话墙排除**：`proxy.ts` matcher 对该路由的排除现为**无边界前缀** `api/media/pub`（负向前瞻内无尾斜杠/锚定）——`/api/media/pubfoo` 这类同前缀路由也会被放行出会话墙，与注释「scoped to exactly /api/media/pub/*」不符。**补边界断言（`api/media/pub/` 带斜杠或正则锚定）+ 回归测试 = B4 施工验收项**（见 §三 契约5） | `apps/web/app/api/media/pub/[token]/route.ts`；`apps/worker/src/jobs/publish.ts:204-291`；`apps/web/proxy.ts:73` | 成立·Δ（图纸 A/B 决策项**已定 B**；**发现实况缺陷**：matcher 前缀无边界——列施工验收项，非本 PR 修） |
| A19 | JPEG 转码落点：发布时按需 vs 生成时预备，荐发布时（§四C） | **选定发布时**。`transcodeToJpeg`（worker ffmpeg，抽单帧 mjpeg）仅当字节 sniff ≠ image/jpeg 才转 | `apps/worker/src/jobs/publish.ts:181-192,284-285` | 成立·Δ（决策已定=发布时按需，如荐） |
| A20 | 六态设计：成功/无权限/平台拒绝/超时/部分/恢复，每态 fail-closed（§三） | 成立。7 状态映射 6 结局；handler 逐态实现，含轮播「不存在物理半发」注释（防「补发半张」误设计） | `packages/core/src/schedule-state.ts:15-39`；`apps/worker/src/jobs/publish.ts:5-26,470-568` | 成立 |
| A21 | E4-08 媒体契约 Δ 闭合：#229 mime 白名单确定性拒绝 + #231 三入口前置拦截 + #233 存储字节 sniff 验真（**双层**） | **Δ 闭合**。pass 1a=client-mime 白名单（#229，非 image/* → mediaContractRefused → NEEDS_ATTENTION）；pass 1b=字节 sniff 验真（#233，`classifyImageBytes` 且须 == 存储 mime，storage read fail=retryable 非 verdict）；#231=UI/schedule 层三入口前置 `IG_IMAGE_ONLY_ERROR` | `apps/worker/src/jobs/publish.ts:229-277`；`apps/web/lib/schedule-actions.ts:208`；`schedule-service` `IG_IMAGE_ONLY_ERROR` | 成立（双层=pass 1a + pass 1b；前置=#231；三者齐，判非 FAILED 而 NEEDS_ATTENTION 语义正确） |
| A22 | App Review 递件：4 organic scope（`instagram_content_publish`/`pages_manage_posts`/`instagram_basic`/`pages_read_engagement`）进同一 consent（§六，#219） | 工程侧已建（#219 PR-L1a）。scope 串 + canPublish 派生 + 连接层已合；**过审=外部钥匙未到**（founder 侧递件+商业验证在等） | `#219` merge；`apps/web/lib/meta-oauth.ts:47`；矩阵 E4-13 | 成立（工程侧备齐；外部位见 §六 二分清单） |
| A23 | E4-14 X/Twitter 发布（判决「要」+ 1cr/4cr 定价，隔离 adapter） | **代码里无任何 X 实现**。`channel-meta.ts` 仅 instagram/facebook；无 twitter/x adapter/publishX；且接入触点非零（A03 降准） | grep `twitter\|x adapter` 全库零命中；`apps/web/lib/channels/channel-meta.ts:15-37` | 未建（施工合同见 §三 契约8；计费碰 💰 见 §六.4） |

**差额核证收口**：23 条断言，21 条 `成立`/`成立·Δ`（发布 L1 闭环已建成、契约测试已升级、E4-08 双层闭合），1 条 `成立·Δ 部分`（A17 FB reconcile 在途），1 条 `未建`（A23 X adapter）。其中 **A03 为降准**（单一动作层真；「零核心改动可插拔」是缝的方向非现状），**A18 附实况缺陷发现**（matcher 前缀无边界，列施工验收项）。**无一条与矩阵/宪法/L1 图纸不可调和**——四处 Δ（四锁/媒体代理 B/reconcile 更保守/可插拔降准）均为图纸决策项已闭合、实况更保守、或图纸愿景与现状的诚实落差，方向一致，非冲突。故本块冻结对象（§三）= 冻结**已建成的真契约** + 定清 5.5 条新行施工合同（工作量如实入批次）。

---

## 二、范围与矩阵行映射

B4 块（`docs/archive/route-b/matrix/04-B4.md`）**20 行**：14 存量（`integrated`/`implemented`，经 §一 核实为真）+ 0.5（E4-14 X，`schema`→真 adapter）+ 5 新建（B0-27/28/29/30/103）。本 spec 对每行硬化 `人工入口/Otto skill/权限花费闸/测试/报告` 五列的 TBD-B4；明示排除：Ads 写执行契约归 Ads 域（本块只承 App Review 重验 + 与发布共享的 kill-switch/impersonation 闸对齐，不重开 ads 写编排）。

### 2.1 存量 14 行 —— 起证清单（每行：锚断言测试 + 六态证据 + 双执行差额）

> 「起证」= 行已建成（§一 核实），块验收不是重建而是**立证**：①锚断言测试绿（对标锚可判定）②六态证据留档（块内=mock/夹具级；活体=外部测试阶段，§六.2）③双执行差额清零（parity-debt 该行族清偿，见 §五）。Otto skill 列一律给 **tool 名 + cost/effect/reach + 归域**（B9 契约1 域闭集）。

| 功能ID | 能力（简） | 人工入口（硬化） | Otto skill（硬化） | 权限/花费闸 | 测试（起证） | 报告 |
|---|---|---|---|---|---|---|
| E2-07 | Meta 写执行（v1 ACTION_CARD/v2 BUILD_CARD） | ads 区卡片 Approve 按钮 + server action | `propose-meta-action`（free/write/internal，`ads-analytics` 域；已注册——propose 建卡→人批→`runApprovedPlan` 执行；parity-manifest:194-195 已挂此 skill） | Meta OAuth scope 门 + kill-switch（`adsWritesPaused`） | `meta-write-actions` reconcile/divergence 既有测试 + App Review 重验 | 对应 GitHub task/PR exact-head evidence |
| E4-01 | 排期区 3 视图 + Composer（账号/媒体复用/时区/first comment） | 排期区（plan/calendar/queue）+ Composer | 起草=`schedulePosts`（free/write/internal，`schedule` 域，已注册）；管理面=debt-71~74 四新 skill + 审批=debt-70 gated skill（**三元组/port/命名全表见 §五**） | 无门（纯 UI + $0 composer，只复用已生成媒体） | `OttoSchedule` 渲染 + composer 校验测试；六态 statusPill 映射 | 对应 GitHub task/PR exact-head evidence |
| E4-02 | ScheduledPost/PublishAttempt/ScheduledPostMedia 数据模型 | n/a（数据层） | n/a | DB 约束（partial-unique/position unique） | `publish-attempt-uniqueness.test.ts`（四用例）+ schema 迁移测试 | 对应 GitHub task/PR exact-head evidence |
| E4-03 | 防双发 exactly-once（**四重**幂等） | n/a | n/a | DB partial-unique（P2002 skip）+ Lock4 UNCONFIRMED | `publish.test.ts` + `publish-doublepost.test.ts`（redelivery/重启不双发） | 对应 GitHub task/PR exact-head evidence |
| E4-04 | L1a 连接能力层（typed handle/$0/fail-closed，#219） | 连接区（OAuth 连/断） | n/a（连接绑定=既有 `ACCOUNT_SECURITY` 豁免，parity-manifest:176/178——身份/凭据生命周期，正当类义） | `canPublish` DEFAULT false，仅两 scope 实授才 true | `meta-actions.test.ts`（canPublish 派生三用例） | 对应 GitHub task/PR exact-head evidence |
| E4-05 | L1b 发布链（PUBLISH_QUEUE/scheduler/adapters/签名代理/幂等/reaper-reconcile） | n/a（worker） | n/a | 多重 fail-closed（各件） | `publish.test.ts` + `core/publish.test.ts`（policy）+ `meta-publish` 编排测试 | 对应 GitHub task/PR exact-head evidence |
| E4-06 | 签名媒体代理（Plan B：HMAC token + `/api/media/pub/[token]`，不开桶） | n/a | n/a | `MEDIA_PROXY_SECRET` 未设→全 404 fail-closed；**matcher 边界断言=施工验收项（契约5）** | `app/api/media/pub/__tests__/route.test.ts` + **新增 matcher 边界回归**（`/api/media/pubfoo` 必须进墙） | 对应 GitHub task/PR exact-head evidence |
| E4-07 | 单一发布动作层（IG create→poll→publish + carousel + first comment；FB /photos·/feed） | n/a（worker 与人工按钮共用 `meta-publish.ts` 同一编排） | n/a | adapter fail-closed 闸（E4-04） | `publishInstagram`/`publishFacebook` 契约测试（core 层） | 对应 GitHub task/PR exact-head evidence |
| E4-08 | 媒体契约双层（非 JPEG 拦截 Δ） | 排期/批准入口三处前置（#231） | n/a（行为语义） | 无（语义闸）；双层=client-mime 白名单 + 字节 sniff | `publish-media-contract.test.ts` + `schedule-actions` IG_IMAGE_ONLY 测试 | 对应 GitHub task/PR exact-head evidence |
| E4-09 | Meta OAuth 连接/断开/data-deletion | 连接区 UI + 路由 | n/a（既有 `ACCOUNT_SECURITY` 豁免——OAuth 绑定/断连=凭据生命周期，parity-manifest:176/178） | OAuth env；disconnect server action | 连接/断开/data-deletion 既有测试 | 对应 GitHub task/PR exact-head evidence |
| E4-10 | Ads 自治开关（Ask/Auto）+ ads kill-switch | 广告区开关 | **施工合同（v0.4 改正——既有挂靠是假对等）**：`propose-meta-action` 动作枚举只有 `pause\|resume\|set_budget\|reschedule`（`propose-meta-action.ts:27-29`），**调不到** `setAdsAutonomy`/`setAdsWritesPaused`（`meta-write-actions.ts:8/:21`）——parity-manifest:192-193 只是字面映射非真对等。施工=**扩展 propose-meta-action 动作枚举加 `set_autonomy`/`set_writes_paused` 两动作（沿用其审批/闸形态）或新建 gated skill，二择由施工工位按枚举扩展成本定**；验收=Otto 可真实触达该两动作+审批闸+测试 | `adsAutonomy`(ASK 默认)+`adsWritesPaused`；断连即 reset | ads kill-switch 既有测试 + **新增 Otto 真实触达两动作的对等测试**（v0.4 验收） | 对应 GitHub task/PR exact-head evidence |
| E4-12 | Meta 写 v1/v2（pause/resume/reschedule）+ App Review | 广告区卡片 | `propose-meta-action`（free/write/internal，`ads-analytics` 域；propose→人批→执行，同 E2-07） | kill-switch + impersonation 闸 | `meta-write-actions` 既有测试 + App Review 重验 | 对应 GitHub task/PR exact-head evidence |
| E4-13 | OAuth 4 organic-publish scope（App Review 待批） | 连接区 consent | n/a（同 E4-09，ACCOUNT_SECURITY 既有豁免） | Meta App Review（外部钥匙）；未过→scope 不授→canPublish=false | scope 串测试 + 外部测试阶段 QA（§六.2） | 对应 GitHub task/PR exact-head evidence |
| E4-16 | 平台可插拔（adapter 缝） | n/a | n/a | 蓝图扩展缝——**现状降准**（A03）：渠道分发今为闭集触点 5 处（含排期 UI，v0.3） | **B4 施工验收=触点收敛为登记式**（契约8）；X 接入即活体验证 | 对应 GitHub task/PR exact-head evidence |

### 2.2 新建 5.5 行 —— TBD-B4 逐列硬化

> 「5.5」= 5 条 B0 新行 + 0.5（E4-14 X，schema 已在、adapter 从零）。每行硬化：人工入口 / Otto skill（**tool 名+三元组+归域**）/ 权限花费闸 / 测试 / 报告。**出生即配双执行器 + parity 登记**（缝 9 铁律，宪法 7）。

| 功能ID | 能力 | 人工入口（硬化） | Otto skill（硬化） | 权限/花费闸 | 测试 | 报告 |
|---|---|---|---|---|---|---|
| **B0-27** | 广告构建工作台（人工建 campaign 草稿 $0/PAUSED） | A′ 页 `ads/builder`（切片6）：建草稿全 PAUSED、$0，启用另走闸 | `propose-ad-build`（free/write/internal，`ads-analytics` 域；已注册 `propose-ad-build.ts:129-132`——起草 BUILD_CARD；执行走审批） | build=$0；启用走 Meta 写闸 + App Review（隔离于 organic 发布） | builder 草稿 $0/PAUSED 契约测试 + 「不启用即不写 Meta」测试 | §④/§⑫ |
| **B0-28** | 单帖分享预览页（无席位链接式外审） | A′ 页 `schedule/share-preview`（切片5）：token 链接对外只读 | **新** `sharePostPreview`（free/write/internal，`schedule` 域）——铸造分享 token（内部写一行 token 记录，不写外部平台）；needsApproval=false（派生律） | 分享 token 权限边界（**mock 风险 14/18：token 写死**——冻结：token=HMAC(ownerId+postId+exp)，服务端铸造/校验，越权静默 404） | 分享 token owner 隔离测试 + 过期/越权 404 测试 | §⑧/§⑫ |
| **B0-29** | ApprovalRequest 最小版（kind=PUBLISH，payload hash 绑定，审批后漂移即失效） | 排期区 Approve（复用 approveScheduledPost，**不许自建第二套审批**） | **同 debt-70 gated skill**（§五）：Otto 的 `approveScheduledPost` skill 每次调用先产 approval 卡（needsApproval=true 派生），**人点卡=同意本体**；ApprovalRequest 行承载卡 payload 的 hash 绑定——skill 与人工按钮消费**同一** ApprovalRequest，无第二套 | payload hash 绑定：批准的是冻结 payload，媒体/文案漂移即 hash 变→失效重批 | ApprovalRequest hash 绑定 + 漂移失效测试 + 「skill 与按钮同一审批对象」断言 | §④/§⑧ |
| **B0-30** | ChannelConnection 通用渠道连接 schema（kind 开放串 + 加密 token） | n/a（数据层；Meta 日后择机迁入） | n/a | kind=开放串（非闭集 enum，house style）；token 加密列（照 MetaConnection.accessTokenEnc） | schema 迁移测试 + 加密列非明文断言 | §⑧/§⑩ |
| **B0-103** | 冷启动时段种子表（最佳发帖时段种子，A/S 区） | 排期 composer 时段建议（读种子表） | **新** `suggestPostTimes`（free/read/internal，`schedule` 域）——读种子表经 ctx port（B9 契约5 读对等，不直连 Prisma）；needsApproval=false | n/a-静态种子（$0） | 种子表读取 + 无写路径测试 | §③/§⑧ |
| **E4-14** | X/Twitter 发布（判决「要」+ 1cr/4cr，隔离 adapter） | 排期 composer 加 X 渠道 | 起草仍经 `schedulePosts`（channel enum 扩 X——触点②）；**无独立 X 发帖 skill**（发布永远经审批管线，A04 原则） | **X 发布分档计费「不带链接=1cr / 带链接=4cr」走缝3 reserve→settle + 审批公式；变真必过 money-safety-review**（§六.4；档位映射冻结见 §四 X 锚） | X adapter 发布契约测试 + 计费 reserve→settle 幂等测试 + 档位映射方向测试（§四） | §④/§⑨/§⑪ |

**E4-14 施工合同（工作量如实——A03 降准的施工化，接 X 需触碰的核心触点清单）**：
① `packages/core/src/schedule-draft.ts:12-17` `SCHEDULE_CHANNELS` 闭集 + `SCHEDULE_CHANNEL_CAPS` 扩成员（现测试明确拒非 IG/FB——测试同步改）；② `packages/otto/src/skills/schedule-posts.ts:24` `z.enum(["instagram","facebook"])` 扩 X；③ `apps/worker/src/jobs/publish.ts:356-366` per-channel 分发扩分支（或收敛为分发表，见契约8 验收）；④ `apps/web/lib/channels/channel-meta.ts` 客户端镜像加 X；⑤ X adapter 本体 + 连接层（优先落 B0-30 ChannelConnection）；⑥ 计费缝3 reserve→settle（唯一 money 触点）；⑦ **排期 UI 渠道硬编码（v0.3 补，BR1-R2 线索核实属实）**——`apps/web/components/otto/OttoSchedule.tsx` 六处渠道字面量分支：`ChannelIcon` if/if 内联 glyph（`:86/:95`，新渠道无图标）、`openNew` 默认渠道回退 `?? "instagram"`（`:287`）、composer 渠道回退 `["instagram","facebook"]`（`:405`）、渠道筛选 chips 闭集（`:434-435`）、`as "instagram" | "facebook"` 类型断言（`:1123/:1135`）、caps 文案**二元 ternary**（`:1199`——非 IG 一律显示 "Single feed image"，X 会显示错文案）——X 接入须逐处扩展，或收敛为 `CHANNEL_META` 数据驱动（图标/文案/筛选全从 meta 表来，契约6 收敛验收）。（旁证：northstar 原型层 `_kit.tsx:74` `NsChannel` 已含 `"x"`——设计早已预期，工程层未跟上。）**此非「零核心改动」——工作量如实入批次。**

**TBD-B4 硬化收口**：20 行的 `人工入口/Otto skill/权限花费闸/测试/报告` 五列全部硬化——Otto skill 列**无一行只写「归 X 域」**：或点名已注册 skill（`propose-meta-action`/`propose-ad-build`/`schedulePosts`）、或点名新 skill 全三元组（`sharePostPreview`/`suggestPostTimes`/debt-70~74 五件套见 §五）、或 n/a 附既有豁免出处/数据层理由。**无一行残留裸 TBD-B4。**

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
- fail-closed：`MEDIA_PROXY_SECRET` 未设→verify 返 null→全部 404。TTL 冻结为**接口常量**（`MEDIA_TTL_MS`，须 cover Meta 异步拉取窗，A5 实测定下限，founder ack 可调）。
- **会话墙排除边界（v0.2 改正 + 施工验收项）**：`proxy.ts:73` matcher 对本路由的排除现为**无边界前缀** `api/media/pub`——`/api/media/pubfoo` 等同前缀路由也会被放行出会话墙（与注释「scoped to exactly /api/media/pub/*」不符）。**冻结语义：排除范围必须 = 恰好 `/api/media/pub/*`（[token] 路由），不多一寸**。**B4 施工验收项：①matcher 补边界（`api/media/pub/` 带斜杠或正则锚定）②回归测试断言 `/api/media/pubfoo` 进墙、`/api/media/pub/<token>` 放行。**

### 契约 6 · 单一发布动作层（宪法 7，E4-07）+ 渠道分发现状与收敛验收（E4-16）
- **冻结（现状即真）**：worker 与人工按钮**不各写一套发布逻辑**——都经 `packages/core/src/meta-publish.ts`（`publishInstagram`:126 / `publishFacebook`）同一编排；六态/四锁/授权闸核心为渠道无关层。
- **降准记录（v0.2，A03；v0.3 补 UI 层）**：「零 per-channel worker 分叉/加平台只加 adapter」**不是现状**——渠道分发今为闭集触点 **5 处**（worker if/else `publish.ts:356-366`、`SCHEDULE_CHANNELS` 闭集 `schedule-draft.ts:12`、skill `z.enum` `schedule-posts.ts:24`、客户端镜像 `channel-meta.ts`、**排期 UI 硬编码分支** `OttoSchedule.tsx:86-95,287,405,434-435,1123-1135,1199`〔v0.3，明细见 §二 E4-14 触点⑦〕）。
- **E4-16 验收（改写）**：B4 施工把上述 5 触点**收敛为登记式扩展点**（闭集常量/分发表一处改；**UI 层由 `CHANNEL_META` 数据驱动**——图标/caps 文案/筛选 chips 全从 meta 表来，不留 per-channel ternary；六态/四锁/授权闸核心不分叉）；**X 接入（E4-14）即此收敛的活体验证**——验收断言=「X 落地 diff 中，核心编排/锁/闸文件零语义改动」。

### 契约 7 · reconcile 保守铁律（六态⑥，§四F）
- reconcile **只用 GET**（幂等，不能双发）；**永不在结局不明时乐观重发**。
- IG：即使 container `status_code=PUBLISHED` 也 →NEEDS_ATTENTION（container id ≠ 帖 media id，不盲 stamp 错引用〔M2〕，留人确认/补链）——媒体 id 补链是**在途工程**，不构成移动靶。
- FB：无 creationId，recent-posts 匹配是 **future work**；当前悬空 FB attempt 一律 NEEDS_ATTENTION（永不盲 /feed 重发）。
- reaper 分「可证未发」（IG creationId=null→FAILED 可重试，恢复 pre-D2 行为）vs「歧义」（→UNCONFIRMED，Lock4 冻住）。

### 契约 8 · X 接入施工合同 + 计费断言（E4-14，形状冻结·实现随排产）
- **冻结形状**：X 与 IG/FB 共用同一发布 worker/六态/四锁/授权闸（契约6 核心层）；接入=走契约6 收敛后的登记式扩展点。**触点清单（如实）**=§二 2.2 E4-14 施工合同 ①-⑦（闭集/enum/分发/镜像/adapter+连接层/计费缝/**排期 UI 硬编码**〔v0.3〕）——**非「零核心改动」，工作量如实入批次**。
- **计费断言（碰 💰）**：X 发布分档「**不带链接=1cr / 带链接=4cr**」（GRILL-VERDICTS:215 方案 A 拍板，founder 已裁），走**缝3 reserve→settle + 审批公式**；数字进 config 层（宪法 5）；**变真必过 `money-safety-review`**（义务写进 E4-14 行 + §六.4）。档位映射方向冻结见 §四 X 锚（映射不可倒置）。计费点是本块**唯一** money 触点（organic IG/FB 发布 $0）。

---

## 四、对标锚清单（§六 水准判官格式）

> 阈值可判定；并排截图打分法一句话：**同旅程截图我方 vs 锚品并排，逐关口打「平齐/超过/未及」三档，未及即开待裁条目**。

| 锚 | 版本 | 关键旅程 | 通过阈值 |
|---|---|---|---|
| Buffer | 2026-07 | 排期→（审批）→发布 队列旅程 | 三视图 + Composer 账号/时区/媒体复用不逊于 Buffer 的 Queue/Calendar；六态状态回显（尤其失败原因人话可见）平齐或超过 |
| Later | 2026-07 | 视觉排期 + 媒体校验前置 | IG 媒体校验（#231 三入口前置 + 非 JPEG 拦截）在**排期时**即拦（不到发布才失败）——对标 Later 的媒体预检，平齐或超过 |
| Hootsuite | 2026-07 | 多账号审批流 + 失败恢复 | 审批闸（人工 approve）+ 恢复态（NEEDS_ATTENTION 人话 + 重排）对标 Hootsuite 的 approval workflow；**不双发**是我方硬承诺（四锁），锚品无此级别公开保证 |
| Meta 官方发布语义 | Graph API（v21.0，文档级） | **逐关口判定表（G1-G7，见下）**——每关口给预期请求/预期响应字段/允许结果的可判定语句 | 每关口按下表判定；A1 配额生效值=显式 TBD-B4 实测槽（非循环表述） |
| **X adapter（E4-14 单列锚）** | X API（2026-07） | X 排期→发布 + **分档计费** | X 走契约6 收敛后扩展点（收敛验收=核心零语义改动）；**档位映射冻结（见下）**；发布语义对齐 X API 官方；money-safety-review 过 |

### Meta 官方锚 · 逐关口判定表（G1-G7）

> 每关口 = 预期请求 → 预期响应字段 → **允许结果（可判定语句）**。假设台账 A1/A5/A6/A7 各挂对应关口的「TBD-B4 待实测填数」槽；A2（Stories 贴纸）/A3（PPA）/A4（Review 时长）非请求关口，留台账（§七）。

| 关口 | 预期请求 | 预期响应/字段 | 允许结果（可判定） |
|---|---|---|---|
| G1 IG 容器创建 | 单图：`POST /{ig-id}/media`（`image_url`+`caption`）；轮播子图：（`image_url`+`is_carousel_item="true"`，**无 caption**）；轮播父容器：（`media_type=CAROUSEL`+`children=<子id 逗号串>`+`caption`）——`meta-publish.ts:135-156`（v0.4 照实码精化） | 含 `id`（creation_id） | id 返回→进 G2；任一子容器失败→整帖 abort（⑤a，此刻零发布）；确定性错误→六态③人话映射；**媒体拉取窗**：签名 URL TTL 须 cover Meta 异步拉取——TTL 下限=**TBD-B4 待实测填数**（A5 槽；现值 `MEDIA_TTL_MS=2h` 宽松默认） |
| G2 容器轮询 | `GET /{creation-id}?fields=status_code` | `status_code` | `FINISHED`→进 G3；`IN_PROGRESS` 超执行 deadline→六态④；`ERROR`/`EXPIRED`→六态③；**视频转码时长/失败形态=TBD-B4 待实测填数**（A6 槽，反推 deadline 取值） |
| G3 IG 发布 | `POST /{ig-id}/media_publish`（`creation_id`） | 含 `id`（media id） | **单次原子**（轮播无物理半发，禁「补发半张」）；id 返回→六态①；**2xx 无 id→ambiguous**（`meta-publish.ts:183-185`）；请求已发无回执→六态⑥ UNCONFIRMED（Lock4） |
| G4 FB 发帖（v0.4 照实码改正） | **单图（mediaUrls≥1，取第一张）**：`POST /{page-id}/photos`（`url`+`caption`）；**无媒体（文字/链接帖）**：`POST /{page-id}/feed`（`message`＋可选 `link`）——`meta-publish.ts:214-228`；FB `maxMediaCount=1` 无轮播；均用 **page token** | 含 `id` | id→六态①；**两路 2xx 无 id 均→ambiguous**（may already be live，实码逐路显式）；**无原生幂等键**→任何歧义一律 UNCONFIRMED（契约7，永不盲重发）；测试佐证 `meta-publish.test.ts:175-190`（/photos 带 caption、/feed 带 link 逐断言） |
| G5 发布配额 | `GET /{ig-id}/content_publishing_limit` | `quota_usage`/config | **生效值=TBD-B4 待实测填数**（A1 槽：官方 50/100 同页自打架，未定）；adapter `rateLimitPer24h:25` 保守恒低于两说；超限→拒发给人话 |
| G6 first comment | `POST /{ig-media-id}/comments`（`message`） | 含 `id` | best-effort：失败**不改变**发布成功判定（帖已发出，六态①不回退） |
| G7 page/IG 解析 | `GET me/accounts?fields=id,name,access_token,instagram_business_account{id}` | `access_token` + `instagram_business_account.id` | 缺 page token→六态②（非己 page 拒）；IG 目标缺 business id→确定性拒；**Page 权限（CREATE_CONTENT）无权形态=TBD-B4 待实测填数**（A7 槽：admin vs 受限 Page 对测，错误映射到六态②人话） |

### X 锚 · 档位映射冻结（E4-14 计费）

- **判决原文**（GRILL-VERDICTS-2026-07-03:215，founder 方案 A 拍板）：「发推不带链接 = **1 显示 credit/条**；带链接 = **4 显示 credits/条**。founder："可以的，要算好就行"。口径确认：**1 USD = 10 显示 credits**。数字进 config 层（宪法 5）。」
- **档位映射（冻结）**：`不带链接 → 1cr`；`带链接 → 4cr`。
- **实现方向断言（冻结，映射不可倒置）**：①判档=**服务端确定性检测**（帖文含 URL/链接实体——正则/entity 级，非模型判断，宪法 10）；②**带链接的帖永不按 1cr 计**（倒置=漏计费，测试断言死）；③边界含糊（短链、裸域名、跳转文案）**就高判 4cr**（不可倒置的操作化——就高细则随冻结上报 founder ack）；④数字进 config 层（宪法 5），毛利以 costing 核算为准。
- **测试义务**：档位映射方向测试（带链接样本集永不产出 1cr 计费行）+ reserve→settle 幂等（缝3）+ money-safety-review 过审（§六.4）。

> 联验归属：Otto 话术全绿（每功能块）归 **B11 联验**（sonnet 级，宪法 10）；本块只冻锚 + 阈值，不在本 PR 打分。

---

## 五、债清偿协议（缝 9 棘轮，`parity-debt.md` B4 行族）

> B4 行族债 = debt-70~74（`E4-01` 归属，`schedule-actions` 五动作）。三态语义 `skill / exempt(四类闭集) / todoSkill`（B9 契约3 冻结）。**债只降不升**（棘轮）；新增豁免类别=修宪。四类闭集（`parity-manifest.ts:15`）= **ADMIN · VISUAL · MONEY_IN · ACCOUNT_SECURITY**。
> **v0.2 改判（当时 approved outcome，采 codex 替代方案）**：debt-70 撤回 v0.1 的 ACCOUNT_SECURITY 豁免提案，改 **gated skill 清偿**。**处置结果：5 条债全部 skill 清偿，零豁免，四类闭集未动，不触修宪**（v0.1 的「豁免超闭集=停手」条件自然满足）。

### 5.1 debt-70 · `approveScheduledPost` → gated skill（v0.2 改判）

- **撤回豁免的理由**：ACCOUNT_SECURITY 现有成员**全是身份/凭据生命周期**（sign-out `parity-manifest.ts:79`、OAuth 绑定/断连 `:176/:178`）；「内容级外部写的同意闸」与之**不同类**——硬塞=稀释类义。且宪法层面外部写本就有正道：**「外部写照旧过审批」**（BLUEPRINT 边界条款），不需要豁免来保护闸。
- **改判方案（冻结）**：`approveScheduledPost` 配**真 skill**，三元组 `cost:'free', effect:'write', reach:'external'` → 按派生律 `deriveNeedsApproval`（`packages/otto/src/skill.ts:66`：`cost==="spend" || (effect==="write" && reach==="external")`）**自动 needsApproval=true**——非人工标注，是机器派生，改不掉、绕不开。
- **为何不是「Otto 自批」（闸不失义的论证，冻结进 skill 文档）**：
  1. needsApproval=true ⇒ skill 每次调用**先产 approval 卡**，不执行；**人点卡确认 = 同意本体**（Meta 政策 1.7 的「明确同意」正是这次点击）——与人工在排期区点 Approve 按钮是**同一动作层**（同 `approveScheduledPost` server action、同 owner-scoped CAS、同 B0-29 ApprovalRequest hash 绑定对象）。
  2. Otto 得到的是**「代提审批请求」的手**，不是**「代人同意」的权**——同意永远出自人的点击；Otto 不能绕卡直批（派生律机器闸 + 测试钉死）。
  3. 宪法 7「Otto 可操作人能操作的 100%」由此成立（人能点 Approve，Otto 能**替你把 Approve 卡端到面前**）；宪法 4「external write → needsApproval」同时成立。双宪法同时满足，零豁免。
- **skill 契约（冻结）**：tool 名 `approveScheduledPost`；域 `schedule`（B9 契约1）；port `ctx.schedule.approve`（**新增**）；handler `packages/otto/src/skills/approve-scheduled-post.ts` + `.test.ts`。**测试三断言**：①未确认不执行（先出卡，卡未批零写）②确认后经同一 server action（owner-scoped CAS + 状态机 + 媒体校验一个不少）③Otto 无任何绕卡路径（needsApproval 派生断言）。

### 5.1·附 · 通用审批卡链（v0.3——BR1-R2 线索②核实属实，debt-70 施工触点补全）

> **现状证据（对 main@45fb27f7 核实）**：今日的 SDK 中断审批链是 **generate 专用**——
> ① `ottoApprove` 的 interruption 匹配器**硬过滤** `if (toolName !== "generate") return false;`（`apps/web/lib/otto-actions.ts:697`）——任何非 generate 的 needsApproval 中断永远匹配不上，人点了也只会得到 "That card isn't awaiting approval."；
> ② 双批兜底同为 generate 专用（GenJob `cowork:<cardId>` 幂等键查询，`otto-actions.ts:707-714`）；
> ③ 卡渲染=OttoPlanCard 的 parked spend 路径（`OttoChatStream.tsx:123-125`——「Card ids the run paused on (needs_approval) — drives OttoPlanCard's parked vs. proposed spend path」；`:250` needs_approval→pendingCardIds），无非 generate 类 write/external 中断的通用卡分支。
> **判定**：此发现**不推翻 gated-skill 方案**——`deriveNeedsApproval` 派生律本身 fail-closed 成立（非 generate 中断会 pause 运行、**不会误执行**）；但审批卡渲染不出、`ottoApprove` 批不动 ⇒ **skill 造出来闸有名无实**。故「通用审批卡链」列为 debt-70 的**硬性施工触点**（不建即债不清）。

**施工触点（debt-70 施工合同追加，冻结）**：
1. **通用审批卡渲染**：非 generate 类 needsApproval 中断的通用卡（渲染 skill 人话名〔TOOL_STEP_LABELS，B9 契约4〕+ 参数摘要 + 确认/拒绝按钮），接进 `OttoChatStream`/`OttoConversation` 的 needs_approval 分支——generate 卡（OttoPlanCard spend 路径）保持专有渲染不动。
2. **`ottoApprove` 匹配泛化**：匹配器从「只认 generate」泛化为「认注册表中 needsApproval=true 的 skill 名闭集」；generate 专有逻辑（cardId 绑定 + GenJob `cowork:` 双批兜底 + spend 语义）保留为 generate 分支；`approveScheduledPost` 分支用 **scheduledPostId 绑定 + B0-29 ApprovalRequest payload hash** 作等价幂等锚（双批=hash 已消费即拒，同 M2 精神）。
3. **恢复链**：approve→resume 走同一 `withLlmBudget` 计量（resume 轮的 LLM 成本照计）；free skill **无 spend 语义**（不碰钱路、不建 GenJob）；恢复轮**全量装载**兼容（B9 契约5·附·1：approve 轮必须装载原 tool 所在域——恢复轮全量装载天然满足，交叉引用不复述）。
4. **测试清单追加**：①通用卡渲染测试（非 generate 中断出卡、含人话 label）②非 generate approve→resume→执行链测试（确认后 server action 真执行、owner-scoped）③拒绝路径测试（拒后零写、run 干净收尾）④双批测试（同一 ApprovalRequest hash 第二次 approve=幂等拒）⑤generate 路径回归（泛化不碰 generate 分支语义——money-safety 邻接，评审时按 `money-safety-review` 过一遍 spend 路径未动）。

### 5.2 debt-71~74 · 契约冻全（三元组 / port / handler / 测试）

> **port 现状**：`OttoContext.schedule` 今**仅有 `draft` 一个 port**（`packages/otto/src/context.ts:200-202`）。**需新增 port 清单（5 个）**：`approve` / `cancel` / `update` / `list` / `listTargets`——全部 web 注入、owner-closed、skills 永不直连 prisma/schedule-service（single-action-layer 规则，同 draft port 注释）。

| 债号 | skill tool 名 | cost/effect/reach（needsApproval 派生） | ctx port（新增） | handler + 测试命名 | 关键测试断言 |
|---|---|---|---|---|---|
| debt-70 | `approveScheduledPost` | free / write / **external** → **true**（自动） | `ctx.schedule.approve` | `approve-scheduled-post.ts` + `.test.ts` | 见 5.1 三断言 |
| debt-71 | `cancelScheduledPost` | free / write / internal → false | `ctx.schedule.cancel` | `cancel-scheduled-post.ts` + `.test.ts` | 状态机合法转移（DRAFT/SCHEDULED/NEEDS_ATTENTION/FAILED→CANCELLED，终态拒）；owner-scoped |
| debt-72 | `editScheduledPost` | free / write / internal → false | `ctx.schedule.update` | `edit-scheduled-post.ts` + `.test.ts` | **冻结不变式：实质编辑（文案/媒体/渠道/目标/时间）必退 DRAFT 并清 approvedAt**——`schedule-actions.ts:236-240` 现状（re-consent gate：material edit on SCHEDULED → `status=DRAFT, approvedAt=null`）**冻为契约**，skill 走同一 server 路径天然继承；测试断言编辑后必重批才回队 |
| debt-73 | `listScheduledPosts` | free / read / internal → false | `ctx.schedule.list` | `list-scheduled-posts.ts` + `.test.ts` | 读对等走 port 不直连 Prisma（B9 契约5）；owner 隔离 |
| debt-74 | `listPublishTargets` | free / read / internal → false | `ctx.schedule.listTargets` | `list-publish-targets.ts` + `.test.ts` | ads-only 连接（无 page scope）返回空集；owner 隔离 |

**处置收口**：5 条债全处置——**5 skill（1 gated external-write + 2 写 + 2 读），零豁免**。四类闭集未动，不触修宪停手条件。skill 出生即带 `domains`（B9 契约1 出生纪律）+ TOOL_STEP_LABELS（B9 契约4）+ parity-manifest 行由 `todoSkill` 转 `skill`（**基线只能由对应 task-linked 收口 PR 修改，执行者须持覆盖该文件的 `ACTIVE` ownership claim 并满足 current GitHub authority**；B9 契约3——本 spec 只冻契约，不碰 manifest）。**debt-70 的债清判定（v0.3 硬化）：skill 落地 ∧ 通用审批卡链（5.1·附 四触点）落地 ∧ 测试清单全绿——三者齐才算清**（只建 skill 不接卡链=闸有名无实，不得转 `skill` 态）。

---

## 六、花钱与外部边界

### 6.1 施工 PR 内部验证 —— mock/夹具级，零真实外部写

- **organic IG/FB 发布 = $0**（媒体复用已付费成片，发帖不向 Meta 付费）——不走记账缝、不触 money-safety（除 E4-14 X 计费，见 6.4）。
- **施工 PR 的内部验证 = mock/夹具级契约测试，零真实外部写**：六态/四锁/授权闸/媒体契约/kill-switch/未授权拒发全部由测试夹具立证（`registry.test.ts` 未授权即拒发、`publish.test.ts` 六态、`publish-doublepost.test.ts` 不双发、`publish-media-contract.test.ts` 媒体双层、`meta-actions.test.ts` canPublish 派生、`media/pub/route.test.ts` 代理 404）。**这只能证明代码层可进入下一层验证，不能证明 Reminder 或 Direct 已放行。**

### 6.2 Release certification —— 受控真实链路是必需层

- **定义**：测试账号真发→IG/FB 可见的一切活动（六态活体证据〔尤其②③⑥〕、App Review 屏录素材、G1-G7 关口的 TBD-B4 实测填数〔A1/A5/A6/A7〕）与受控真实 reminder email 均归 release certification 的真实链路层。它们不进入普通施工 PR，但**是对应模式从 sandbox-verified 走到 release-certified 的必要证据**。
- **前置 = Founder 授权**：外部测试阶段开跑前，在对应 current GitHub task 向 Founder 获取测试账号真发范围并 live-verify；未查询即 `Unknown`，不读取静态 dossier。此前块内只有 mock/夹具。
- 真实花费：organic 真发本身 $0；若外部测试涉及任何真实付费（开发者账户/商业验证周边），逐笔问 founder（宪法 2）。
- **认证单位**：Reminder-assisted 单独一张证据表；Direct 按 channel × post type 单独一格。所有格锁在同一 release SHA；未验证格保持未放行，不借相邻格推定。
- **hard-zero**：重复发布、错账号、错内容/媒体、错计划时间窗、未经精确授权、历史队列被模式切换、失败却显示成功、`Merchant confirmed` 冒充 `Platform verified`、email 未 opt-in/退订后仍发，任一出现即对应格不通过。

### 6.3 App Review 二分清单（材料施工期=Q4 细化，本 spec 只输出二分状态）

| 项 | 工程侧（已备/可办） | founder 侧（等） |
|---|---|---|
| 4 organic scope 进 consent | ✅ 已建（#219 scope 串 + canPublish 派生） | — |
| data-deletion 回调 | ✅ 已有（`api:meta/data-deletion.POST`，parity 登记 ACCOUNT_SECURITY） | — |
| 每权限 1080p 屏录（该权限具体动作，非泛介绍） | ☐ **外部测试阶段**办（真发演示=排期→审批→发出→IG/FB 可见；**前置=founder 授权**，§六.2） | — |
| Meta 测试账号 + test Page + test IG business account | ☐ 可办（app 后台建 test users，让审核员亲手复现——**通过命门**；真发部分归外部测试阶段） | — |
| Business Verification（商业验证） | — | ☐ 等（BELCORT 实体，营业执照；越早越好，几天到几周） |
| 接受 Platform Onboarding Terms / Advanced Access 申请发起 | — | ☐ 等（有权限实体身份发起） |
| 隐私政策 URL / app 图标 / 用途说明 | ✅/☐（隐私政策既有；用途说明须与实际发布一致） | ☐ 确认（1.4 别夸大） |

### 6.4 E4-14 X 计费点（碰 💰）

- X 发布分档「**不带链接=1cr / 带链接=4cr**」（GRILL-VERDICTS:215 方案 A，founder 已拍板）走**缝3 reserve→settle + 审批公式**；档位映射方向冻结（§四 X 锚：映射不可倒置、含糊就高、确定性判档、数字进 config 层）。这是本块**唯一** money 触点。
- **义务（写进 E4-14 行）**：X adapter 变真时，PR 期**必过 `money-safety-review`**（typed genRequest 门 / reserve→settle 幂等 / idempotencyKey dedup）；本 spec 冻结此义务，不在本 PR 建 X 计费代码。

---

## 七、假设台账

> 承接 L1 §七 A1-A7（官方文档自相矛盾/登录墙/存疑），补 B4 块级假设。**动工可按保守假设建；实测填数一律归外部测试阶段（§六.2，前置 founder 授权）**；每条给实测法。A1/A5/A6/A7 同时挂 §四 G 表对应关口的 TBD-B4 槽。

| # | 假设/存疑 | 依据/现状 | 验证法（外部测试阶段） |
|---|---|---|---|
| A1 | 24h 发布配额 50 还是 100 | 官方同页自打架（§四 G5 槽） | 连真 IG 调 `GET content_publishing_limit` 看生效值；adapter `rateLimitPer24h:25` 保守，实测只为确认无更低隐藏墙 |
| A2 | Stories 互动贴纸支持度 | 官方未逐条确认 | 测试账号试各贴纸参数；本块 Stories 按 `reminder`（提醒人手发），贴纸自动化不在本块 |
| A3 | PPA 是否仍是 IG 发布前置 | 官方页未正面确认 | App Review 前后用 test Page 走一遍看是否被要求 PPA |
| A4 | App Review 时长 | 官方只保证「一周内」 | 以 Meta 后台状态为准，规划按一周（别按 2-3 天承诺 founder） |
| A5 | IG 图片公网 URL 拉取窗口 | Meta 异步拉媒体滞后无官方数字（§四 G1 槽） | 真发布测容器 create→FINISHED 实际耗时，反推 `MEDIA_TTL_MS` 下限（现 2h 是宽松默认，留足余量） |
| A6 | 视频/Reels 转码失败率与时长 | 官方转码，形态没给（§四 G2 槽） | 测几条真视频，确认六态④超时阈值（`PUBLISH_EXECUTION_DEADLINE_MS`）合理 |
| A7 | FB 主页发帖需 `CREATE_CONTENT` | 官方口径明确（§四 G7 槽） | admin 权 Page vs 受限 Page 对测，确认错误映射到六态②人话 |
| B4-01 | IG media 补链（container id → 帖 media id）方案 | 契约7：现 confirmed-live 也 NEEDS_ATTENTION（不盲 stamp container id） | 排产 IG 补链切片时，用 `/media` correlated lookup 实测能否可靠回帖 media id；坐实前保持保守（NEEDS_ATTENTION 留人补链） |
| B4-02 | FB recent-posts reconcile 可靠性 | 契约7：FB reconcile future work，现悬空一律 NEEDS_ATTENTION | 排产 FB reconcile 时，用内容/时间窗匹配实测误配率；不达标则维持保守 |
| B4-03 | X 发布语义 + 档位计费幂等 | E4-14 schema→adapter，缝3 reserve→settle，档位映射已冻（§四） | X adapter 建成时 money-safety-review + reserve→settle 幂等契约测试 + 档位方向测试；就高细则 founder ack |
| B4-04 | B0-28 分享 token 权限边界（mock 风险 14/18：token 写死） | 本 spec 冻结 token=HMAC(ownerId+postId+exp) | 越权/过期 token → 404 契约测试；不留写死 token |

---

## 八、冻结条件与状态

- **版本状态**：v0.4 是历史机械合同；v0.5 已经由 Founder-merged alignment revision 纳入现有计划。实际 merge/head 仍从 GitHub live-query。版本历史：
  - **v0.1 骨架**：§一 差额核证（23 断言对 main@45fb27f7 立证）+ §二 20 行 TBD 硬化 + §三 八契约冻结对象 + §四 对标锚 + §五 债 5 条处置 + §六 三无边界 + §七 假设台账。
  - **v0.2 闭合 codex BR1（BLOCK，五项全部核实属实）**：①**三处失实改正**——A02 共享编排指向改 `packages/core/src/meta-publish.ts:126`（`publish.ts`=队列契约）；A03「零 per-channel worker 分叉」降准为闭集分发实况（`publish.ts:356` if/else、`schedule-draft.ts:12` 闭集、`schedule-posts.ts:24` z.enum、`channel-meta.ts` 镜像），E4-14/E4-16 施工合同随之改写（触点清单如实入批次，契约8/契约6）；契约5「matcher 精确排除」改正为**无边界前缀**（`proxy.ts:73`，`/api/media/pubfoo` 会放行），补边界断言+回归测试列入 B4 施工验收项。②**debt-70 改判（当时 approved outcome，采 codex 替代方案）**——撤回 ACCOUNT_SECURITY 豁免提案（现有成员全是身份/凭据生命周期，内容级外部写同意闸不同类；宪法「外部写照旧过审批」是正道），改 gated skill 清偿：`free/write/external` → `deriveNeedsApproval`（`skill.ts:66`）自动 needsApproval=true，人点卡=同意本体，Otto 不自批、闸不失义、**零豁免、不触修宪**；debt-71~74 契约冻全（三元组/5 新 port/handler/测试命名；debt-72 冻「实质编辑退 DRAFT 清 approvedAt」不变式，`schedule-actions.ts:236-240` 现状入契）。③**9 行真硬化**——E2-07/E4-10/E4-12 点名 `propose-meta-action`（free/write/internal，ads-analytics）、B0-27 点名 `propose-ad-build`、B0-28 新 `sharePostPreview`、B0-103 新 `suggestPostTimes`（均全三元组+归域）；E4-01/B0-29 随 debt-70 新方案重写；E4-14/E4-16 随①改写。④**锚表两修**——X 锚冻档位映射「不带链接=1cr/带链接=4cr」（GRILL-VERDICTS:215 原文引用）+实现方向断言（映射不可倒置、含糊就高、确定性判档）；Meta 官方锚改 G1-G7 逐关口判定表（预期请求/响应字段/允许结果可判定），A1/A5/A6/A7 显式留 TBD-B4 实测槽。⑤**真实发帖边界统一**——块内验收=mock/夹具级（零真实外部写）；测试账号真发→IG/FB 可见=外部测试阶段（§六.2 单列，前置=Founder 授权，归 sandbox-verified 阶段执行）；spec 与对应 GitHub task/PR evidence 三处矛盾全消。
  - **v0.3（codex BR1-R2 中段线索经工位核实处置——复审任务因 codex 网络停摆取消，两条未确认线索逐条对代码核实，均属实）**：①**E4-14 触点⑦补排期 UI 硬编码**——`OttoSchedule.tsx` 六处渠道字面量（ChannelIcon `:86/:95`、默认渠道 `:287`、composer 回退 `:405`、筛选 chips `:434-435`、类型断言 `:1123/:1135`、caps 文案二元 ternary `:1199`），契约6 闭集触点 4→5 处、E4-16 收敛验收加「UI 由 CHANNEL_META 数据驱动」；旁证 northstar 原型 `_kit.tsx:74` 已含 `"x"`。②**通用审批卡链补进 debt-70 施工触点（5.1·附）**——核实 `ottoApprove` 匹配器硬过滤 `toolName !== "generate"`（`otto-actions.ts:697`）、双批兜底 GenJob 专用（`:707-714`）、卡渲染仅 OttoPlanCard spend 路径（`OttoChatStream.tsx:123-125,250`）；不推翻 gated-skill 方案（派生律 fail-closed：中断只 pause 不误执行），但补四硬性施工触点（通用卡渲染/匹配泛化〔approveScheduledPost 用 scheduledPostId+ApprovalRequest hash 幂等锚〕/恢复链 withLlmBudget+全量装载/五项测试清单含 generate 回归）+ **debt-70 债清判定硬化**（skill∧卡链∧测试三者齐才算清）。
  - **v0.4（闭合 codex BR1-R3——BLOCK(3)，其余四点+线索②全 CLOSED；三项均先复核实码再改）**：①**E4-10 假挂靠改正**——核实 `propose-meta-action` 动作枚举仅 `pause|resume|set_budget|reschedule`（`propose-meta-action.ts:27-29`），`setAdsAutonomy`/`setAdsWritesPaused`（`meta-write-actions.ts:8/:21`）不可触达，parity-manifest:192-193=字面映射非真对等；E4-10 Otto skill 列改施工合同（扩枚举加 `set_autonomy`/`set_writes_paused` 沿用其审批/闸形态，或新建 gated skill——二择由施工工位按枚举扩展成本定；验收=Otto 真实触达两动作+审批闸+对等测试），不再宣称既有挂靠已覆盖。②**G4 锚照实码改正**——工位复核 `meta-publish.ts:214-228`（与 codex 行号相符，不停手）：单图（mediaUrls≥1 取第一张）→`POST /{page-id}/photos`（url+caption）；无媒体→`POST /{page-id}/feed`（message+可选 link）；两路 2xx 无 id→ambiguous；测试佐证 `meta-publish.test.ts:175-190`。顺检 G1-G7 防同型错：G1 照实码精化（单图 caption 在容器、轮播子图无 caption、父容器 media_type=CAROUSEL+children，`meta-publish.ts:135-156`）、G3 补「2xx 无 id→ambiguous」（`:183-185`）；G2/G5/G6/G7 复核无误。③**触点计数残留同步**——spec §2.1 E4-16 行与 对应 GitHub task/PR evidence §⑫.4 两处「4 处」→「5 处」，全文 grep 确认零残留。
  - **v0.5（D-038）**：新增 Reminder-assisted + Direct 双模式、通知 seam、精确授权与独立真实放行门；同步矩阵/current GitHub evidence，但不改产品、不迁状态。
- **冻结走四权闭环**（#254 §一.2）：双顾问签核 + 异族复审 + 机器闸 + 非作者合并。v0.4 原冻结 PR 已完成当时的 04-B4 迁级；v0.5 alignment revision 未迁任何六级状态。
- **冻结时随契约上报 founder 的 founder-only 单列项**：①X 档位判定的**就高操作化细则**（短链/裸域名/跳转文案一律判带链接=4cr——多计费方向，founder ack；档位本身已拍板 GRILL:215，无需再裁）；②接口常量（`MEDIA_TTL_MS`/`PUBLISH_STALE_MS`）founder ack（现值已冻，可调需一处改）；③5 个新 `ctx.schedule` port + 5 新 skill 出生（缝1 登记 + B9 出生纪律，冻结 ack 时明示清单）。
- **开放问题（v0.2 处置）**：
  1. IG media 补链方案（契约7 B4-01）→ **保守闭合**：坐实前 confirmed-live 也 NEEDS_ATTENTION，不盲 stamp；补链是在途工程不阻塞冻结。
  2. FB reconcile recent-posts（契约7 B4-02）→ **保守闭合**：现一律 NEEDS_ATTENTION（永不盲重发），可靠性达标后再放开。
  3. debt-70 豁免类别边界（v0.1 遗留）→ **闭合（v0.2）**：当时 approved outcome 采 codex 替代方案——gated skill 清偿，撤豁免提案，零豁免零修宪；不再是待裁项。
  4. proxy matcher 边界（v0.2 新发现）→ **施工验收项闭环**：冻结「恰好 `/api/media/pub/*`」语义，matcher 补边界 + 回归测试入 B4 施工验收（契约5）。

> 与既有法冲突处（矩阵行义/宪法/L1 施工图不可调和）：**本 spec §一 核证未发现不可调和冲突**——四处 Δ 均为图纸决策项已闭合、实况更保守、或图纸愿景与现状的诚实落差（A03 降准），方向一致。v0.1 唯一待裁项（debt-70 类别边界）按 v0.2 当时 approved outcome 闭合；执行前仍须核验 GitHub supersedes。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
