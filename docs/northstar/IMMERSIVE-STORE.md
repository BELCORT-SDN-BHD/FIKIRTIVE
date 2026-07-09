# 沉浸式共享 store(循环系统)

`apps/web/components/northstar/immersive/_store.ts` —— 北极星沉浸式产品外壳的唯一
共享状态。模块级可变单例 + `useSyncExternalStore` 订阅(pattern 承自 immersive-shell
的 `useReducedMotion`)。种子全部从 `../_mock.ts` 与区级视图派生,不新造品牌事实。

## 铁律(zones 必读)
- 各区一律通过本文件的 hooks/选择器 **read/append**;**永不** 各自 `useState` fork
  一份 `_mock` 数据 —— 那会让同一事实在两屏漂移。
- 纯 client、零后台 import;coral 只属于 Otto;credits 永远是 credits。
- **持久化:无。** 内存单例 —— client 端换路由存活,刷新即重置。这就是 spec
  (`docs/northstar/PROGRAM.md`),不是待办。

## 订阅(hooks)
- `useStore()` —— 订阅整个 store;组件在其后调选择器读当前值,store 变即重渲染。
- `useOttoWorking()` → `{ working, label }` —— shell 注入 context / dock 徽点脉冲读它。

## 选择器(派生读的单一源)
- `balance()` —— 当前额度(导航栏 / home「Credit balance」/ credits / settings 同源读它)。
- `creditLedger()` —— 额度流水(种子 + 本次会话新增行,最新在前;credits 页读它)。
- `scheduledPosts()` —— 全部排期帖(排期区三视图的单一源:base + composer 新排 + campaign 生成)。
- `upNext()` —— 未发出的排期帖(scheduled + draft),home「Up next」用。
- `campaignEntries()` —— 全部 campaign 日历条目(campaign 区 + 排期区 campaign 归组;approve/生成后状态在这里变)。
- `campaignDraft()` —— campaign 工作台交出的草稿(无则 null;proposal-card 读它,缺省回落 NS_CAMPAIGN)。
- `pendingApprovals()` —— 待办审批队列。
- `recentEvents(n)` —— 最近 n 条事件,最新在前(dock「Just now」条读 `recentEvents(1)`;trends「最近 campaign 活动」读它过滤)。
- `chatThreads()` / `connections()` / `rules()` / `routines()` / `teamMembers()` —— 对应镜像的当前值。
- `aiHandledCount()` —— Otto 已自动应答的会话数(automation 规则「Answer order questions」的 runsThisWeek 派生自它,不写死)。
- crm-inbox 身份链读:`conversationsView()` / `conversationByIdView(id)` /
  `conversationsForContactView(contactId)`(合并后从属方的对话并入主联系人)/ `contactsView()`
  (已叠加字段补丁、隐藏已合并者)/ `contactByIdView(id)`(引用已合并 id 回落到主联系人)·
  `isAiPaused(id)`(对话页横幅)· `isResolved(id)`(Resolve 按钮态)· `isInboxContact(id)`
  (CRM「New」chip)· `dealStageOf(dealId, fallback)`(阶段实时值,金额不漂移)·
  `contactEventsFor(id)`(contact-profile「From the inbox」时间线)·
  `contactChangesFor(id)`(档案「Change history」折叠区读的字段变更留痕)·
  `mergeCandidatesView(id)`(合并流程可选的重复候选)· `customSegments()`(店主自建分群列表)。
- `adSubmissions()` —— 待审广告事件(广告区 submit 派生;performance 待审 chip + multi-platform「审核中」读它)。
- `creditSpendByCategory()` —— 从 `creditLedger` 派生的分类消费(分析区报表读它,取代手抄常量)。
- `ottoBehavior()` —— Otto 行为设置(自主级别 / 花费确认阈值 / 勿扰时段);账户 · Otto 行为面写它,dock 读它反映作风。
- `brandPreferences()` —— Otto 从赞/踩学到的品牌偏好(最新在前;资产区 brand-memory「Otto 学到的偏好」区读它,带来源)。

## 动作(纯函数:改 store + append event + notify;做一次到处生效)
`spendCredits(n,label,category?)` · `topUp(n)` · `schedulePost(post)` ·
`approveCampaignEntry(id)` · `approveRequest(id, "approve"|"decline")`(approve 花钱生成会真扣额度)·
`connectChannel(id)` · `disconnectChannel(id)` · `resolveConversation(id)`(缺联系人则补建 + 记「New」+ 追加时间线)·
`toggleAutomationRule(id,on)` · `addRule({name,when,then})` · `toggleRoutine(id,on)` · `addRoutine({name,cadence,step})` ·
`submitAd(payload)`(payload 带 platform/label,派生「审核中」)· `castTrained(name)`(cast 训练完成落事件流)· `ottoWorking(on,label?)` ·
`appendChatMessage(threadId,msg)` · `startChatThread(title?)` · `setCampaignDraft(draft)`(工作台提交时写)·
`inviteMember(email)`(真 append 一条 pending Editor;team 页 pending chip / 计数由此派生)·
`setOttoBehavior(patch)`(账户 · Otto 行为面写自主级别 / 花费阈值 / 勿扰时段;dock 立即反映)·
`setBrandPreference({assetId,assetTitle,source,feedback})`(资产 asset-viewer / library 赞踩 → Otto 学一条偏好;feedback=null 撤销;同资产同来源不重复)。
crm-inbox 身份链动作:`sendConversationMessage(id,text)`(append owner 消息 + 人工插手→该会话 AI
暂停)· `setConversationAi(id,paused)`(Otto 自动接管开关,dispatch automation 事件)·
`advanceDealStage(id,current,dir,title)`(阶段推进/回退,金额仍走 dealAmountMyr)·
`ensureContactFromComment(handle,channel,lastSeen,note)`(评论作者身份锚点→补建 CRM 联系人)。
crm 字段/身份/分群动作(每次改动都进字段留痕):`setContactDnd(id,on)`(consent/勿扰开关,
勿扰者在群发/排期受众选择器里禁用)· `addContactTag(id,tag)` / `removeContactTag(id,tag)` ·
`mergeContacts(primaryId,secondaryId)`(并渠道/标签、累加订单、对话重定向;从属方隐藏)·
`addCustomSegment({name,phrase,rules})`(人话编译成的规则存入)/ `removeCustomSegment(id)`。

## 事件流(append-only,`{ type, payload, at:seq, label }`)
`label` 是人话一行(sentence case、英文 UI),dock / 通知直接显示。类型:
`credits_spent` · `credits_topped_up` · `post_scheduled` · `campaign_entry_approved` ·
`approval_settled` · `channel_connected` · `channel_disconnected` · `conversation_resolved` ·
`conversation_replied` · `conversation_ai_toggled` · `deal_stage_changed` · `contact_created` ·
`automation_toggled` · `automation_rule_created` · `routine_toggled` · `routine_created` ·
`otto_working` · `otto_idle` · `ad_submitted` · `member_invited` · `cast_trained` ·
`contact_field_changed` · `contacts_merged` · `segment_created` · `segment_deleted` ·
`brand_preference_learned`。

## 已接线的表面(Wave 1)
- shell:`ottoWorking` 来自 store,不再硬编码 false;dock 在 3 条 hideDock 路由上只
  视觉隐藏、不卸载(保住 dock 内部草稿/消息 state)。
- dock:working 读 context;`chatThreads()[0]` 读/append;「Just now」条读 `recentEvents(1)`。
- otto-chat 全页:与 dock 共读同一份 `chatThreads`(徽标「Dock and this chat share one
  state」因此为真);`?thread` 深链选中初始 thread。
- home:「Up next」读 `upNext()`,「Awaiting approval」读 `pendingApprovals()`。
- composer:`?post` 预填;确认排期调 `schedulePost` → home「Up next」闭环。

## 已接线的表面(Wave 2 · crm-inbox 身份链)
- inbox-conversation:消息流/联系人读 store;Send 真发(append + 清空 + 滚到底);人工发送即
  暂停该会话 AI,顶部横幅为真;Otto auto-reply 开关 = `setConversationAi`;Resolve = `resolveConversation`。
- inbox-shared:线程/未读计数读 `conversationsView()`,Resolve/回复即刻反映。
- inbox-comments:Post reply → `ensureContactFromComment`,评论作者即刻成为 CRM 联系人。
- crm-contacts / crm-segments:读 `contactsView()`,收件箱补建的联系人带「New」chip 且计入分群。
- crm-contact-profile:身份/对话读 store;「From the inbox」时间线读 `contactEventsFor`;deal 阶段读 `dealStageOf`。
- crm-deals:卡片推进/回退控件写 `advanceDealStage`,分组与三张数据卡读实时阶段;金额恒走 `dealAmountMyr`。

## 已接线的表面(Wave 3 · CRM respond.io 级地板)
- crm-segments:「New segment」人话 → `compileSegmentPhrase` 确定性编译成规则 chip + 实时命中数,
  `addCustomSegment` 存进 store,列表可选可删(`removeCustomSegment`);内建 + 自建同口径过滤。
- crm-contact-profile:多渠道身份卡读 `contactIdentities`;「Merge duplicate」选候选→字段对比→
  `mergeContacts`;标签 X/+ 写 `add/removeContactTag`;consent 开关写 `setContactDnd`;每次改动进
  `contactChangesFor` 的「Change history」折叠区。
- schedule/composer:CRM「Post to this group」带 `?segment=` → 预选受众 chip(内建走 `SEGMENTS`、
  自建走 `customSegments`),勿扰联系人在受众列表里显禁用态、不计入群发人数。

## 已接线的表面(Wave 2 · 钱包统一 + 设置真值)
- nav:余额读 `balance()`,变动时短暂高亮(充值/花费在导航栏可见地跳动)。
- top-up:确认调 `topUp(credits)` → nav / credits 流水 / home 卡片同源跳动;credits 页
  余额 + 流水读 `balance()` / `creditLedger()`。
- channel-wallet(= Channel fees):WhatsApp 会话过路费第二账道(红旗五 / harmony-05),
  透明直传零加价、MYR 实价、Meta 价目可核对;钱包是 store 内**独立 RM slice**
  (`channelWallet()` + `channelWalletAddFunds/SetAutoReload`,与 credits 物理隔离、永不并入
  `creditBalance`;2026-07-09 第四闸修正——早期"用本地 state"的写法导致 Add funds 一离页
  就回滚,已废);Add funds / auto reload 均真实生效且跨页持久。
- settings:Otto 行为面(自主级别 / 花费阈值 / 勿扰时段)调 `setOttoBehavior`,dock 的作风
  提示与勿扰/工作态收起条随之可见变化;例程授权入口深链 automation/routines。
- credits:每行可展开明细卡(类型 / 时间 / 关联对象链接 / 花费前后余额),滚存规则卡(G-03)。
- connections:连接调 `connectChannel`(Meta 一处点亮 IG+FB),断开调 `disconnectChannel`;
  settings「已连 X/N」派生自 `connections()`。
- automation:规则/例程开关调 `toggleAutomationRule` / `toggleRoutine`(跨导航持久);
  「New rule / Draft a rule / New routine」三键开三字段弹窗,调 `addRule` / `addRoutine` 写入列表;
  规则「Answer order questions」的 runsThisWeek 派生自 `aiHandledCount()`。
- onboarding checklist:「Connect a channel」步完成态派生自 `connections()`(kill 手写 defaultDone)。
- onboarding login:提交 → 进度指示 → `router.push` 进产品(注册去引导清单,登录去 create/home;仍无真 auth)。

## 已接线的表面(Wave · 资产/品牌三连接器)
- 一键进画布(连接器 1):Templates / Discover / Library / My-stuff 四页 CTA 全带 `?from=<id>`;
  `assets/_data.ts:resolveCanvasFromSeed(id)` 是「参数与 id 真实存在」的单一源(四张真表派生),
  canvas 挂载时读它预置会话(消费侧由创作区 canvas-page 实现)。
- 生成时校验(连接器 2 · C-08):`assets/_data.ts:brandCheckChips(seedText)` 确定性假规则;
  `create/_create-ui.tsx:SpendConfirmDialog` 生成前渲染 pass/warn 品牌校验 chips(logo 安全区 /
  品牌色偏离),四个创作区花费弹窗一处接线全覆盖。
- 审批学习回灌(连接器 3 · O-04):asset-viewer / library 的赞踩调 `setBrandPreference`,
  brand-memory「Otto 学到的偏好」区读 `brandPreferences()` 显示新条目(带来源)。

## D2 单流 API(F2 循环系统 · 全城 10 个 zone worker 直接可用)

ENDGAME §D2:Otto = **一条连续对话流**(零收纳、零线程管理)。心智 = 你和某个员工的
WhatsApp 单聊 —— 一条时间线,没有「多线程管理」。store 层唯一源是 `state.ottoStream`
(append-only,种子 = `_mock.ts` 的 `NS_OTTO_STREAM` 62 条跨三周历史)。**dock 小窗 /
`/otto` 全屏 / campaign 详情「对话」tab 都是这条流的过滤视图,永不是第二条对话。**

每条消息 = `NsStreamMsg`(继承 `NsOttoStreamMessage`):
`{ id, role: "owner"|"otto", text, at, context: { zone, label, campaignId?, href? }, card?, substeps?, error? }`。
`context` 就是 chip 数据 —— 发生在哪个区 / 哪个 campaign;`href` 有值即可点(深链回现场)。

### 选择器(读同一条流的不同看法)
- `streamFor(filter?)` —— **主选择器**。`filter = { zone?, campaignId? }`;空 filter = 整条流。
  dock 小窗、campaign-tab、区级往来都调它。
- `threadForContext(campaignId?)` —— campaign 详情「对话」tab 用(= `streamFor({campaignId})` 别名;
  语义:找旧对话 = 去那件事的页面看,而不是管理线程)。传空回落全流。
- `streamTail(n)` —— 末尾 n 条(dock 小窗 / 摘要用)。
- `ottoStreamView()` —— 整条流(`/otto` 全屏读它;live append 实时反映)。

### 动作
- `appendToStream({ role, text, context?, card?, substeps?, error? })` —— **唯一 append 入口**。
  不传 `context` 则从当前 `ottoContext()` 派生 chip(zone 走 view 映射,默认 `Studio`;label
  取 `selectedLabel ?? view`)。返回新消息 id、notify。任意区把一条往来落进同一条流用它。
- `OTTO_STREAM_THREAD_ID` —— 单流唯一 thread id 常量(兼容层用;单流里没有第二条)。

### 兼容层(旧 thread API 全部落进同一条流,签名不变)
- `appendChatMessage(threadId, msg)` —— threadId 忽略,`msg` 映射进 `ottoStream`(role user→owner)。
- `askOttoInline(prompt, reply, context?)` —— 就地触点:append owner + otto 两条进流,chip 由 context 派生。
- `startChatThread()` —— 返回 `OTTO_STREAM_THREAD_ID`(「New chat」= 回到这条流,不新开线程)。
- `chatThreads()` —— 把单流包成「一条线程」交给旧的 thread-shaped 消费者(gallery otto-chat);
  单一源仍是 `ottoStream`,只做 owner→user 角色映射。

### 已接线的表面(Wave · D2 单流 + 新壳)
- **nav(D1 新 IA)**:废除 HISTORY 分组 / Projects,组 = 首页 · Studio · Campaigns · 排期 ·
  收件箱 · CRM · 分析 · 资产 · 设置;Balance 钉底;Create(唯一 INK)→ Studio canvas;路由保持现有路径。
- **dock 小窗**:展开 380×520 = `streamFor()` 全流小窗;每条带 context chip,点 chip 深链
  (`/northstar/*` 改写成沉浸式路由);Send 调 `appendToStream`;Maximize2 → `/otto`。
- **`/otto`(+ `/global/otto-chat`)全屏**:原生重建(不再套画廊页)。左 = 这条流(可按 campaign /
  区过滤,composer 调 `appendToStream`) · 右 = 当前 context 摘要(在看什么 · 过滤这条流 ·
  Otto 状态 · 待批深链 · 最近活动 · 余额)。§O3:两路径上 dock 由外壳隐藏,不会两个 Otto 同屏。

## C-C 新原语(f2-primitives)· 全城 10 个 zone worker 直接可用

两件 founder 已批的共享原语,地基已铺(store + 组件 + dock 承接 + 外壳导航器),zone
worker 只需**挂一颗组件**即得完整承接。铁律不变:coral 只属于 Otto;发/花永不由 Apply
触发(Apply 只填字段);冷启动诚实——intents/reply 由你写实,不夸口。

### ①「Otto 帮我」assist(§O7)—— 每个动脑面挂一颗

物理形态 = 一颗 ghost 小钮 + 无眼云 glyph 14px(算一个 coral mark set,§O budget:一面
一颗)。点开 = dock 带 `{zone, entityId, formState}` 上下文自动展开、上方浮出你写的 2-3 个
一键意图 chip(零打字路径永远在)、Otto 回应可带 `Apply` 一键回填本表面。

组件:`components/northstar/immersive/otto-assist.tsx` · `<OttoAssist />`
Props:
- `zone` — `NsOttoZone`(`"Inbox"` / `"CRM"` / `"Campaign"` …);context chip + 单流 zone 归属。
- `entityId?` / `entityLabel?` — 选中/编辑对象;`entityLabel` 进 dock「Looking at」chip。
- `formState?` — 当前表单/选区快照(Otto「看见」的现场;透传给你写的 `intents`/`onApply`,原语不解释)。
- `intents` — `NsAssistIntent[]`(2-3 个):`{ id, label, prompt, reply, apply?, landsOn? }`。
  `label`=chip 文案(祈使 sentence case);`prompt`=落进单流的店主话;`reply`=Otto 的回应(写实)。
  `apply?`=`{ summary, patch }` 有值则回应带 Apply;`landsOn?`=`{ surface, label }` 有值则触发 §8e escort。
- `onApply?(apply)` — Apply 回填:把 `apply.patch` 填回本表面 + 自己 `fire()` 一次 §8a sweep(`useSweep`);**只填字段,店主再亲手发**。

三行接入(收件箱回复框为例):
```tsx
import { OttoAssist } from "@/components/northstar/immersive/otto-assist";
import { useSweep } from "@/components/northstar/immersive/_kit";
const sweep = useSweep(); // 把 sweep.style 挂在被回填的输入框上
<OttoAssist zone="Inbox" entityId={cv.id} entityLabel={cv.subject}
  formState={{ draft, lastCustomerMsg }}
  intents={[
    { id: "reply", label: "Draft a reply", prompt: "Draft a reply to this customer", reply: "Here's a friendly reply that answers their question and nudges the order.", apply: { summary: "Fill the reply box", patch: { draft: "Hi! Yes we have that in stock…" } } },
    { id: "price", label: "Answer the price question", prompt: "What's our price for this?", reply: "Pulled it from your knowledge base — RM12 each, RM60 for a box of six." },
  ]}
  onApply={(a) => { setDraft(String(a.patch.draft ?? "")); sweep.fire(); }} />
```
Store API(dock 已内建承接,zone 一般只用组件;直调见下):`openAssist(owner, ctx, onApply?)`
· `clearAssist(owner?)` · `assistContextView()` · `runAssistApply(apply)`。

### ② 首次直播 escort(§8e)—— 新鲜前台指示带到现场看落地

`escortTo(surface, label)`:仅**新鲜、前台、可执行、工作落在别的表面**的指示才调它,导航
**一次**到 `surface`(沉浸式 href;画廊前缀自动改写)。外壳导航器每个 id 只导一次;**离开
不拉回**(不产生新 id 就不再 push);**返回续播**是结构性的(工作落进 store,回到该面即重读)。
background / routine / re-run 永不调它——那是 dock 徽点的活(§O5)。

zone 一般**不直接调** `escortTo`:在 `OttoAssist` 的意图上写 `landsOn: { surface, label }`,
dock 跑该意图时自动 escort(发送处判定已内建)。示例:
```tsx
intents={[{ id: "plan", label: "Turn this into next week's plan",
  prompt: "Turn last week's best post into next week's plan",
  reply: "Laying out the week on your schedule now — every post stays a draft until you approve.",
  landsOn: { surface: "/northstar-immersive/schedule/calendar", label: "Next week's plan" } }]}
```
需要在非 assist 场景手动带现场(如 home 大动作按钮),直调 `escortTo(surface, label)` 即可;
`currentEscort()` 供外壳导航器读(zone 不用管)。
