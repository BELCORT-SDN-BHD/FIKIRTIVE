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
  `conversationsForContactView(contactId)` / `contactsView()` / `contactByIdView(id)` ·
  `isAiPaused(id)`(对话页横幅)· `isResolved(id)`(Resolve 按钮态)· `isInboxContact(id)`
  (CRM「New」chip)· `dealStageOf(dealId, fallback)`(阶段实时值,金额不漂移)·
  `contactEventsFor(id)`(contact-profile「From the inbox」时间线)。
- `adSubmissions()` —— 待审广告事件(广告区 submit 派生;performance 待审 chip + multi-platform「审核中」读它)。
- `creditSpendByCategory()` —— 从 `creditLedger` 派生的分类消费(分析区报表读它,取代手抄常量)。

## 动作(纯函数:改 store + append event + notify;做一次到处生效)
`spendCredits(n,label,category?)` · `topUp(n)` · `schedulePost(post)` ·
`approveCampaignEntry(id)` · `approveRequest(id, "approve"|"decline")`(approve 花钱生成会真扣额度)·
`connectChannel(id)` · `disconnectChannel(id)` · `resolveConversation(id)`(缺联系人则补建 + 记「New」+ 追加时间线)·
`toggleAutomationRule(id,on)` · `addRule({name,when,then})` · `toggleRoutine(id,on)` · `addRoutine({name,cadence,step})` ·
`submitAd(payload)`(payload 带 platform/label,派生「审核中」)· `castTrained(name)`(cast 训练完成落事件流)· `ottoWorking(on,label?)` ·
`appendChatMessage(threadId,msg)` · `startChatThread(title?)` · `setCampaignDraft(draft)`(工作台提交时写)·
`inviteMember(email)`(真 append 一条 pending Editor;team 页 pending chip / 计数由此派生)。
crm-inbox 身份链动作:`sendConversationMessage(id,text)`(append owner 消息 + 人工插手→该会话 AI
暂停)· `setConversationAi(id,paused)`(Otto 自动接管开关,dispatch automation 事件)·
`advanceDealStage(id,current,dir,title)`(阶段推进/回退,金额仍走 dealAmountMyr)·
`ensureContactFromComment(handle,channel,lastSeen,note)`(评论作者身份锚点→补建 CRM 联系人)。

## 事件流(append-only,`{ type, payload, at:seq, label }`)
`label` 是人话一行(sentence case、英文 UI),dock / 通知直接显示。类型:
`credits_spent` · `credits_topped_up` · `post_scheduled` · `campaign_entry_approved` ·
`approval_settled` · `channel_connected` · `channel_disconnected` · `conversation_resolved` ·
`conversation_replied` · `conversation_ai_toggled` · `deal_stage_changed` · `contact_created` ·
`automation_toggled` · `automation_rule_created` · `routine_toggled` · `routine_created` ·
`otto_working` · `otto_idle` · `ad_submitted` · `member_invited` · `cast_trained`。

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

## 已接线的表面(Wave 2 · 钱包统一 + 设置真值)
- nav:余额读 `balance()`,变动时短暂高亮(充值/花费在导航栏可见地跳动)。
- top-up:确认调 `topUp(credits)` → nav / credits 流水 / home 卡片同源跳动;credits 页
  余额 + 流水读 `balance()` / `creditLedger()`。
- channel-wallet:「Add funds」是本地 RM 投放钱(与 credits 两套账,仅此页可见,故用本地
  state 而非共享 store);Add funds / auto reload 均真实生效。
- connections:连接调 `connectChannel`(Meta 一处点亮 IG+FB),断开调 `disconnectChannel`;
  settings「已连 X/N」派生自 `connections()`。
- automation:规则/例程开关调 `toggleAutomationRule` / `toggleRoutine`(跨导航持久);
  「New rule / Draft a rule / New routine」三键开三字段弹窗,调 `addRule` / `addRoutine` 写入列表;
  规则「Answer order questions」的 runsThisWeek 派生自 `aiHandledCount()`。
- onboarding checklist:「Connect a channel」步完成态派生自 `connections()`(kill 手写 defaultDone)。
- onboarding login:提交 → 进度指示 → `router.push` 进产品(注册去引导清单,登录去 create/home;仍无真 auth)。
