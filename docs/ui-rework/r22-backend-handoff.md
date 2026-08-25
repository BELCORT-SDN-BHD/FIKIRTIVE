# R22 frontend → backend handoff

> 状态：2026-08-25 shared worktree contract 草案。  
> 目标：让 R22 visible surfaces 只呈现 server 能证明的事实。本文不宣称下列缺口已实现；“当前可复用”与“backend 必补”分开记录。

## 全局硬约束

### Tenant 与权限

- tenant 只能来自已认证 server principal。任何 client `ownerId`、`orgId`、workspace label、role name 或 deep-link resource ID 都不是授权证据。
- 每次 list/detail/mutation/deep link 都必须用 `ownerId + resourceId + deletedAt/status` 重新约束；关系查询也必须约束关系两端的 tenant。
- 权限检查具体 capability 与 resource scope；角色只是 capability 集合。响应至少能区分 `UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`UNAVAILABLE`，但对客户端不得泄漏另一个 tenant 的资源是否存在。
- staff impersonation 只允许已批准的只读能力；spend、approve、publish、disconnect、member/role、support submit 等 mutation 默认 fail closed。

### Idempotency、money 与外部副作用

- 每个 mutation 接收稳定的 logical `actionId`，服务端从 principal、action kind、resource 与 material hash 派生幂等键；客户端不能直接提交数据库 idempotency key。
- 同 key + 同 material 返回原结果；同 key + 不同 material 返回 conflict；数据库唯一约束是最终防线。
- reserve、settle、refund 与 ledger 只有一个权威事务路径。价格必须在 commit 前显示，并在 server 对比 `expectedCredits`；价格变化时拒绝旧批准，不自动按新价扣费。
- publish、provider mutation、ticket submit、notification fan-out 等外部副作用必须保存 attempt/receipt。超时或未知结果进入 `UNCONFIRMED/UNKNOWN`，禁止盲重试造成重复发送。
- 所有未知 capability、provider permission、target、price、freshness 或 ownership 都 fail closed；unknown 不得降级成 empty、disconnected、success、read、sent、published 或 `0`。

### 统一 read state

每个 route reader 应返回可判别状态，而不是用 `[]`、`null` 或 catch fallback 混合语义：

```ts
type ReadState<T> =
  | { state: "loading" } // client state only
  | { state: "ready"; data: T; asOf: string; nextCursor?: string | null }
  | { state: "empty"; asOf: string }
  | { state: "error"; code: string; retryable: boolean; requestId?: string }
  | { state: "permission" }
  | { state: "unavailable"; capability: string };
```

- `empty` 只能来自一次成功且有权限的读取。
- retry 必须重放同一 read 或同一 logical mutation；不得以清空 UI 假装恢复。
- list 使用稳定 keyset cursor；cursor 必须绑定 tenant、filter 与排序，不能跨 workspace 重用。
- `success` mutation 返回 canonical resource version、receipt/action ID 与 `idempotent`，让 UI 能安全 refresh/reconcile。

## Surface contracts

### Auth 与 account gates

**当前可复用**

- `/login`、`/signup`、`/verify-email`、`/forgot-password`、`/reset-password` 保留现有 Better Auth session/action seam，并统一使用 R22 gate shell。
- 非 production 显式 fixture 已能独立呈现 loading、validation、rate-limit、provider error、expired、used、no-access、unknown 与 retry；这些状态不会调用真实 provider，也不冒充 production receipt。

**Backend 必补**

- 所有 sign-in/sign-up/OTP/resend/recovery action 返回 typed result：`success|validation|rate_limited|provider_error|expired|used|no_access|unknown`，并带可公开 request/receipt ID；不能把 transport error折成 invalid credentials。
- OTP 与 reset token single-use、expiry、attempt cap、resend cooldown和session rotation必须由server约束；refresh或并发submit不能重用已消费 token。
- return path只能来自server允许的same-origin route allowlist；登录前deep link恢复时重新鉴权resource，不把client `from`当授权。
- provider/mail delivery保存attempt/receipt。timeout进入unknown并先查receipt；不得重复发OTP、reset mail或创建重复account。

**状态合同**

- gate loading时不显示“email sent”或“signed in”；unknown不得退成error或success。
- no-access与not-found对外不泄漏另一个tenant/member是否存在；reauth成功后只恢复原已授权意图。
- fixture状态矩阵不是provider E2E。production完成必须覆盖真实delivery、rate limit、expired/used、Back、refresh、deep link与session isolation。

### Onboarding

**当前可复用**

- frontend已实现R22的单一路径：workspace → website/brand facts → channel → publishing routine → first post。完整成功/失败fixture只存在于非production显式 `?fixture=r22`，并按active workspace隔离。
- production现有workspace/profile、manual memory与Meta authorize seams保留；缺少能力的步骤显示truthful unavailable，不用“backend未接”删掉页面或CTA。

**Backend 必补**

- `OnboardingDraft` canonical contract：principal/workspace、currentStep、workspaceName、brand source、reviewed facts/fonts/colors、channel connection ref、routine draft、first-post draft、version、updatedAt。
- website ingest必须是durable job：`startBrandIngest(actionId,url)` → queued/fetching/extracting/review/failed/unknown；URL validation、redirect/SSRF防护、content provenance与retryability由server提供。
- routine save调用与Routines相同action层，不建立onboarding-only workflow；channel connect引用canonical provider connection；first-post generation调用与Canvas/Otto相同quoted generation action。
- `completeOnboarding(actionId, expectedVersion)`只能在server确认required steps满足后返回完成，不相信client checkbox或step query。

**状态合同**

- 每一步独立 loading/error/permission/unknown/retry；前一步失败不能把后一步标完成。
- brand facts在用户review/save前为draft；generation unknown先查原job/receipt，不重复扣费。
- Back、refresh、deep link恢复server draft version；workspace switch清除旧tenant draft/cache并重读。

### Projects

**当前可复用**

- `/create` 已有 owner-scoped `getProjects`、project title create、canonical project/thread deep link 与明确的 production read error；fixture 才提供 R22 的确定性 My/Shared/All 数据。
- project brief 已在 frontend 收集 goal、voice、audience、language、format 与 context，但这些字段当前只是 draft，不冒充已持久化。
- Mobbin 完整证据为 Jasper Projects `f5df65ec-f233-458b-b469-7df93d6af91d` 与 Create project `5bf9cf01-e343-4f91-b9e0-f25d10545b7e`；R22 仍决定最终可见 UI。

**Backend 必补**

- canonical `ProjectBrief`：projectId、goal、voiceRef、audienceRef、language、format、context/source refs、version、updatedBy、updatedAt；引用的 Otto IQ resource 必须同 tenant 且调用者可读。
- `listProjects({scope: "mine"|"shared"|"all", query, cursor})` 返回 owner、visibility、lastModified、authorized actions；scope 是 server filter，不相信客户端 owner/workspace ID。
- `createProject(actionId, draft)`、`updateProjectBrief(actionId, projectId, expectedVersion, patch)`、share/unshare/archive actions；每个 mutation 返回 canonical resource version。
- Shared/All 需要独立 membership/share model 与 resource capability，不能把 owner list 换 tab 后重复显示。

**状态合同**

- loading、permission、error、empty 与 populated 分开；读取失败不能显示 Jasper 式 “No projects found”。
- create title 成功但 brief save 失败时，UI 必须显示 project 已创建、brief 未保存的可恢复状态，不能回滚成“全部成功”。
- workspace switch 清空旧 cursor/cache，并以新 principal 重读；deep link 每次重新验证 project 与 thread 的 tenant 关系。

### Otto IQ

**当前可复用**

- `/brand?tab=...` 已有 R22 hub/panes、owner memory read/CRUD 与 fixture；production 不把 generic memory rows 伪装成 URL/file ingest 或专用 schema。
- fixture五类add flow、edit/delete与loading/empty/error/permission/unknown均已实现；fixture resource ID与updatedAt确定，不以当前时间制造新身份。unknown/permission不显示context name/count/source。
- Mobbin 完整证据为 Jasper IQ `0f6eea06-b833-4732-87fa-c20ea68a7a8b`、Brand Voice states `65040017-bcb5-4f33-8b6f-8a75e11e85cd` 与 15-screen Add Brand Voice `7ca28ebb-6b19-41ee-9dc0-0c27938f922b`。

**Backend 必补**

- typed resources：BrandVoice、Audience、KnowledgeSource、StyleGuide、VisualGuideline；共享基础字段为 tenant、visibility/scope、status、source provenance、version、createdBy/updatedBy、timestamps，不用一个无类型 text row 冒充全部。
- source ingest 分开接 pasted text、URL 与 file。`startIngest(actionId, kind, source)` 返回 durable job；URL fetch/file scan/extract/generate/review 各有真实 stage、progress、retryability 与 receipt。
- minimum-input validation、quota/limit、visibility/access、best-use tags、source list、editable generated result 与 freshness 都由 server canonical response 提供。
- `listIqResources(kind,cursor)`、`getIqResource(id)`、`updateIqResource(actionId,id,expectedVersion,patch)`、archive/delete/export；export 与 delete 必须使用真实 job/receipt。

**状态合同**

- empty、quota、permission、processing、ready、failed 与 retrying 独立；processing 时不能把未完成资料用于 generation。
- source fetch 或 extraction 失败保留 draft 与已验证 source metadata；retry 复用同一 logical ingest action，避免重复收费或重复资源。
- generated result 在用户 review/save 前保持 draft；success 必须返回 canonical version。cross-workspace source、resource 与 cache 硬隔离。

### Notifications

**当前可复用**

- frontend 已有 fixture list、All/Unread、mark-all、dismiss、deep link 与 `loading/empty/unavailable/error/permission/unknown/ready` 可见状态；unknown 不暴露 unread count/title，也不推断 empty。
- 当前 schema 没有 Notification 或 Reminder model；production route 与 drawer 因此明确 unavailable。

**Backend 必补**

- owner-scoped notification event/read-state store：`id`、`ownerId`、event kind、server-authored resource reference、occurredAt、readAt、dismissedAt、provenance/receipt。
- `listNotifications({cursor, filter})`、`getUnreadCount()`、`markNotificationRead(actionId,id)`、`markAllRead(actionId,through)`、`dismissNotification(actionId,id)`。
- deep link 不能存任意 client href；server 以 event kind + authorized resource 生成 destination，打开时再次鉴权。
- channel master + event preference matrix；关闭 master 后不得继续显示事件可送达。delivery attempt 要有 queued/sent/failed/unknown receipt，不能把 in-app read 当 email delivered。

**状态合同**

- loading：保留上一份已验证 unread count 或画 skeleton，不显示 `0`。
- empty：成功读到 0 条；read history 与无事件分开。
- error：不能显示 “all caught up”；提供同 read retry。
- success：mark one/all 只改 read state，不删除 history；并发新事件不得被旧 `markAllRead` 错标。
- permission：不泄漏 unread count 或标题；返回申请 capability 的真实出口。

### Help 与 support

**当前可复用**

- production 有真实 support mailto、Connections、Terms/Privacy 出口；fixture 有 article search/detail/no-result 与 opt-in route/workspace context。
- fixture support已经完整呈现 draft、validation、review、submitting、error、same-request retry、unknown reconcile、queued、waiting-human、closed、refresh和direct-link，使用稳定 `fixture-support-1`。该实现只定义frontend contract，不表示真实ticket存在。
- 当前仍没有 versioned help corpus、server search 或 support ticket lifecycle；production明确unavailable，mail client出口不标submitted。

**Backend 必补**

- versioned article corpus：locale、product version、published status、updatedAt、stable slug；只索引已发布内容。
- `searchHelp({query,locale,productVersion,cursor})` 与 `getHelpArticle(slug,version)`；未发布/无权限按 not-found 处理。
- support draft/submit：context 字段逐项 consent；conversation、files、logs 默认不附带。`submitSupportRequest(actionId,draftVersion)` 必须幂等，并返回 ticket ID 与真实 `queued|submitted` receipt。
- ticket lifecycle 至少区分 draft、submitting、queued、waiting-human、closed、failed、unknown；打开 email client 不是 submitted。

**状态合同**

- empty 只表示 search 成功但无匹配；corpus unavailable 与搜索错误必须单列。
- permission 适用于内部/tenant 限定文章或 ticket；公共文章不得依赖 workspace role。
- retry ticket submit 必须复用同 actionId，未知结果先查 receipt，不能重复发 ticket。

### Settings

**当前可复用**

- `getMyAccount`：owner-scoped workspace identity、balance、recent ledger。
- `getAccountViewData`：settings readable 标记、per-channel state、单次 Meta read、credit shelf。
- `setOwnerSetting("spendCapCredits", ...)`、profile/workspace rename actions、Meta connect/disconnect、billing top-up exit 已有真实 seam。
- R22 Settings 当前用 `/settings?section=...`；只有 `/settings/connections` 有独立 route。
- fixture section read 已区分 loading/error/permission/unknown；mutation error/conflict/unknown 保留原值，并以同一前端意图重试。production 不把这些 local state 当 server receipt。

**Backend 必补**

- 每 section 独立 read/mutation capability：personal preferences、profile、security sessions、connected accounts、members、roles/capabilities、workspace general、notifications、connections、billing/invoices、domains。
- member list/invite/update/revoke、session list/revoke、domain add/verify/remove、workspace timezone/language/defaults 当前不能用静态文案代替。
- role mutation 输入应是 capability set + scope，不因角色名字本身允许/拒绝。
- notification section 依赖同一 notification preference store；不能另造 Settings-only fake state。

**状态合同**

- section reader 可部分成功，但每块必须携带自己的 state；一个失败不能把其他块默认成空值。
- save 显示 pending，成功后回 canonical version；conflict 要提示 reload/merge；permission 不能显示可点 save。
- billing balance/ledger/shelf unreadable 时不显示 0、空历史或“暂无可购买”；top-up receipt 与 webhook credit 必须 exactly-once。

### Routines

**当前可复用**

- `customer-workflow-gateway` 已从 authenticated membership 解析 principal，检查 `workflow.read`，并暴露 list/get/create draft/activate/kill/reauthorize/revisions/runs 等 service seam。
- 当前 R22 production UI 只接 `listRoutines`，现有 schema 字段映射 status、authorization 和 monthly cap；cadence/topic/channel/usage/slots/activity 多数仍为 unknown。
- fixture list read 已区分 loading/empty/error/permission/unknown；create/edit/pause/resume/delete/activity 使用确定性 fixture identity/time，error/conflict/unknown 不先改 row，safe retry 只应用一次。

**Backend 必补**

- R22 publishing-routine adapter：cadence + timezone、topic/brief、authorized channels/targets、approval policy、auto-publish、period credit cap、next slots。
- UI edit/pause/resume/create 必须接现有 lifecycle service 或明确的新 adapter；不能只改 client rows。
- run/activity contract：run ID、definition revision、authority snapshot、planned slot、credit quote/reserve/settle/refund、external attempt/receipt、actor、timestamps、failure/unknown reason。
- “2 hours before reminder”与“slot 时 skip”只有服务端 policy + scheduler + delivery receipt 都存在时才能成为 production copy。

**状态合同**

- empty = authorized list success and zero routines；permission/error 不能显示 “No routine yet”。
- activate 前重新验证 authorization hash、channel target、cap 与 revision；失配 fail closed。
- kill/pause 是幂等 mutation；已停再停返回原状态。未知 run outcome 不算 completed。

### Campaign

**当前可复用**

- owner-scoped `listCampaigns/getCampaign` 与 plan/project/post/generation/broadcast aggregate 已存在。
- `proposeCampaign` 使用 server-issued signed proof，重复相同 draft 可返回 idempotent；campaign entry 与 lifecycle mutations已有 owner gates。
- frontend fixture已将list的loading/empty/error/permission/unknown/mixed与ready分开；create error/unknown保留同一draft并safe retry，fixture ID为deterministic，不使用时间戳冒充稳定identity。

**Backend 必补**

- list card aggregate 要定义 ready/rendering/queued/drafted 的真实来源和优先级；不能仅用 plan-entry approved 推断 generation ready。
- 若 R22 create flow 要“一次创建 campaign + project + 跳 Canvas”，需要一个事务/可恢复 saga action；两个 client actions 不能留下半个 campaign。
- Campaign approval 与 generation spend 的 approval identity、price quote、lease、dispatch receipt 必须统一；Approvals 页面不得另造第二个决策对象。

**状态合同**

- loading/empty/error/permission 分开；单个 campaign not-found 不泄漏其他 tenant 是否拥有它。
- create/update/transition/delete/grouping 都返回 canonical version + idempotent；material conflict 要拒绝旧 proof。
- partially dispatched campaign 要显示 mixed/unknown，不能把某些 rows 成功概括成全成功。

### Approvals

**当前可复用**

- R22 fixture包含Needs review/Approved/Sent back、filter、selection、bulk cost、reason、approve/reject/supersede/cancel/undo，以及独立read loading/empty/error/permission/unknown。
- mutation error/unknown保持原list不变；retry核对同一个decision并只应用一次。permission state不暴露title、count或cost。production继续显示unified feed unavailable。

**Backend 必补**

- canonical `ApprovalRequest`：tenant、resource kind/id/version、proposal material hash、actor/provenance、exact quote、deadline/policy、status、decision、resolution、createdAt/updatedAt。
- `listApprovalRequests(filter,cursor)`、`decideApproval(actionId,id,expectedVersion,decision,reason?)`、bulk decision、undo/supersede/cancel与receipt lookup；Campaign、Generation与Schedule必须引用同一decision identity。
- bulk action要么返回逐项canonical result，要么提供明确atomic contract；部分成功必须显示mixed，不得回滚UI成全成功或全失败。
- approve涉及generation/publish时重新验证capability、price、connection target与material version；unknown receipt进入needs-attention，禁止盲重试收费或发布。

**状态合同**

- read error/permission/unknown不显示empty、zero count或zero cost。
- mutation pending期间同resource controls inert；same actionId + same material replay原result，不同material conflict。
- undo只有server policy允许且外部副作用尚可安全逆转时返回成功；否则显示canonical不可撤销原因。

### Meta connection 与 provider boundary

**当前可复用**

- 现有 contract 已区分 disconnected、needs reconnect、transient provider error、connected；Schedule targets 按 channel 携带 `ok|unreadable|blocked`；Analytics 是 read-only Meta ad-account insights。
- connect/disconnect、target validation、approve-time recheck 与 impersonation block 已存在。

**Backend 必补**

- 所有消费者共享一份 canonical connection snapshot：connection ID、provider account、capabilities、target list、`asOf`、token health、blocker；Home/Settings/Schedule/Analytics 不各自解释。
- OAuth state 必须绑定 authenticated principal、tenant、return path、nonce 与 expiry；callback 不接受 client ownerId。token/secret 不进入 browser payload/log。
- provider read 要区分 not connected、permission revoked、rate limit/transient、partial accounts、stale cache；provider write 必须持久化 attempt/receipt/unknown。

**状态合同**

- Analytics/Schedule 读取时 unauthorized 不能降级 notConnected/empty。
- transient 不能提示 reconnect；needsReconnect 不能用 retry 假装修复。
- disconnect 成功后 schedule 保留历史但所有 publish capability fail closed；并发 publish/approve 要用 connection/version gate。

### Global Search

**当前可复用**

- static route registry 与 Settings destinations 在 client；`loadGlobalSearchProjects` 通过 `requireOwner()` + `getProjects(ownerId)` 读取 owner projects，并允许 project read error 时保留静态导航结果。

**Backend 必补**

- 若扩展到 campaign、asset、notification、help，必须做 owner/capability-aware federated search；每种结果只返回 display-safe 摘要与 server-authored destination。
- project search 增加 normalized query、rank、keyset cursor、result version；不能把整 tenant 数据先下发再过滤。
- partial sources 要返回 per-source state；静态 route ready 不得掩盖 project source permission/error。

**状态合同**

- empty = 所有被请求 source 成功且无结果；partial/error/permission 单列。
- deep link 打开时重新鉴权；搜索结果本身不是 resource capability。
- Search 是 read-only，无 mutation idempotency；最近搜索等写入若未来加入，另设 owner-scoped actionId。

### Library

**当前可复用**

- `getGenerationHistory` 是 owner-scoped、soft-delete aware 的 keyset pagination，支持 prompt search 与 `favoriteOnly`，并验证 storage object 存在。
- 当前 R22 page 已接 pagination/filter/error、Canvas project deep link 和 incomplete job separation。
- fixture read 已区分 loading/empty/error/permission/unknown；unknown 不显示 asset、count 或 empty，retry 去掉失败 state 后重读同一 workspace。

**Backend 必补**

- favorite/star mutation：`setLibraryFavorite(actionId,generationId,favorite,expectedVersion)`；当前只有 read field，没有这页的写动作。
- 明确 storage missing、generation processing、generation failed、permission 与 read transport error 的分类；storage missing 不能静默让整个成功页看似完整。
- 若支持跨 project/shared library，建立显式 share/capability relation；绝不只凭 asset ID。

**状态合同**

- empty 只来自 generation query 与 storage resolution 都成功且无 item；partial missing 要携带 warning/count。
- cursor 绑定 owner/filter/search；换 workspace 或 filter 后作废。
- favorite mutation 幂等，conflict 返回 canonical value；Canvas deep link重新验证 project ownership。

### Analytics

**当前可复用**

- `getAnalytics` 通过 authenticated principal 在 DB principal context 中读取 Meta ad-account aggregate/series，区分 notConnected、needsReconnect、transientError、ready/empty；无 spend。
- fixture另行覆盖permission、unknown、stale、partial；unknown不渲染metric或empty，也不错误引导reconnect，而是核对同一workspace read。
- 真实指标是 Reach、Engagement、Spend、Sales (est.) 与 7/30/90/365/all provider ranges，不是 R22 prototype 的 organic post analytics。

**Backend 必补**

- 统一 `permission` 与 `asOf/source/account/currency/timezone`；当前 action auth error 会返回 notConnected，语义需收紧。
- 如果产品决定做 organic top posts/link clicks/28-day compare，另建 provider adapter、post identity mapping、metric provenance 与 retention；不能重命名 ad metrics 冒充。
- mixed currency 与 partial account failure 要逐账户呈现或拒绝聚合；estimated sales 必须显示来源/方法。

**状态合同**

- loading 保留 period selection；empty 只表示 provider 成功返回无活动。
- stale/partial/transient/permission/reconnect 分开；retry 原 range，不静默切 30d。
- ready 返回 `asOf`、source 和 supported ranges；不存在的 per-post permission 显示 unavailable，不画假 Top posts。

### Schedule

**当前可复用**

- create/update/approve/cancel/list/targets 已有 owner scope；media 必须是 owner generation；material edit 撤销 consent；approve 用 status + `updatedAt` CAS，阻止 stale approval；UNCONFIRMED publish attempt 阻止再次批准；impersonation mutation fail closed。
- human UI 与 Otto schedule draft 共用 `draftScheduledPost`；schedule draft 为 $0，复用已付费 media。
- frontend在channel未连接时仍保留 `New post`，允许建立明确held draft；fixture read error/permission/unknown与empty分开，save error/unknown保留同一draft并safe retry，且不调用provider。

**Backend 必补**

- `listScheduledPosts` 必须改成 discriminated state；当前未认证返回 `[]`，无法可靠区分 empty/permission/error。
- create/update/cancel 增加稳定 actionId 与 canonical version；重复双击/网络重试不能产生两条 draft 或覆盖新内容。
- list/row 返回 provider target snapshot、connection `asOf`、publish attempt/receipt、unknown reason；UI 的 held/publishable 文案只读这些事实。
- reminder policy 若进入产品，必须依赖 Notification contract，而不是 Schedule 本地 timer 文案。

**状态合同**

- empty week 与 empty entire schedule 分开；filter empty 不能覆盖全局 error。
- approve 的 stale、missing target、unreadable connection、permission、UNCONFIRMED、provider unavailable 分开显示。
- external publish exactly-once：unknown receipt 进入 needs-attention，不自动重新发布；cancel/approve 与 worker transition 使用同一状态机/CAS。

### Non-Canvas Otto

**当前可复用**

- production panel 按打开/深链加载 owner project/thread seed，支持 history、stream、新会话、rename/pin/delete 与 quick chips；fixture 明确不发送 conversation/action。
- durable approval/generation cards与现有 cowork/gen actions已有稳定 card/action identity 和部分 exactly-once money guard。

**Backend 必补**

- 所有 stream 与 tool invocation 保存 tenant/project/thread/card/action identity、capability、input hash、status、receipt；重连必须从 durable event 续，不重跑付费或外部动作。
- route context 只能提供可验证 resource refs；模型不能把 client copy 当授权。tool action 在执行点重新 require principal/capability/ownership。
- thread/project delete 的影响清单由 server canonical impact 生成；跨 workspace history/seed/cache 必须硬隔离。

**状态合同**

- loading/empty/error/retry/permission/streaming/completed/cancelled/unknown 分开；断流不等于 action failed。
- 付费 proposal 显示 exact quote；批准后 price/material/version mismatch fail closed。
- feedback、rooms/fullscreen 只有真实 persistence/support contract 存在时才标成功。

### Canvas

**当前可复用**

- entry 从 session principal 选 owner project/thread；无权 deep link canonicalize 到 owned resource，不采用 client ownerId。
- Canvas node reads owner/project scoped；paid image composer先读 exact quote/model shapes，生成 stable `actionId`，server 派生 idempotency key并校验 `expectedCredits`；durable job/card更新 UI。
- generation reserve/settle/refund、DB unique constraint、failed/cancelled semantics已有真实基础。
- fixture route read 已区分loading/error/permission/missing/unknown；非ready状态隐藏project title/menu、saved claim和conversation content。fixture send unknown保留同一job receipt供核对，不先扣费或写success。

**Backend 必补**

- Canvas 内嵌 Otto 必须接真实 project/thread conversation stream；当前只是 status copy + thread link list，不能标“同一个 Otto 已接”。
- toolbar/action contracts：select/move/resize/pan、box select、star、arrange、undo/redo、upload/link attachment、share、export。每个会写数据或产生文件的动作都要 canonical mutation/receipt；当前仅 zoom 与 paid image generation 有真实行为。
- node position/selection save 要 version/CAS；offline/unknown save 不能显示 “Saved”。share 要授权记录、expiry/revoke；export 要 job/receipt，不以点击按钮算完成。

**状态合同**

- board loading、empty、error、permission、partial node/storage failure、queued/generating/done/failed/cancelled/timeout/unknown 分开。
- generation retry：同 logical action 先查原 job/receipt；若明确 terminal failed/cancelled 且已退款，新的用户意图才生成新 actionId。
- balance refresh 来自 ledger settlement；UI 初始 balance unreadable 时不显示 0，也不允许绕过 exact-price preflight。

## Backend 完成定义

每个 surface 只有同时满足以下证据才可从 parity matrix 的 gap 移除：

1. schema/migration/约束与 fresh-database 验证；涉及现有数据时有可解释 migration。
2. 双租户 read/detail/mutation/deep-link tests；伪造 owner/resource/role 均 fail closed。
3. capability + resource-scope permission matrix；impersonation 的只读/禁止 mutation 测试。
4. mutation idempotency：same-key same-material replay、same-key different-material conflict、并发唯一约束、unknown outcome reconciliation。
5. money/external action：reserve/settle/refund/ledger、price mismatch、provider timeout/duplicate callback、UNCONFIRMED receipt tests。
6. loading/empty/error/retry/success/permission/unavailable 的 frontend behavior tests；error 绝不退成 empty/success。
7. production fixture fence test；production build 中显式 fixture 不能触发假写或假成功。
8. 对应 R22 viewport screenshot + production-state E2E；视觉证据不能替代 contract tests，contract tests 也不能替代视觉证据。
