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
- `balance()` —— 当前额度。
- `upNext()` —— 未发出的排期帖(scheduled + draft),home「Up next」用。
- `pendingApprovals()` —— 待办审批队列。
- `recentEvents(n)` —— 最近 n 条事件,最新在前(dock「Just now」条读 `recentEvents(1)`)。
- `chatThreads()` / `connections()` / `rules()` —— 对应镜像的当前值。

## 动作(纯函数:改 store + append event + notify;做一次到处生效)
`spendCredits(n,label,category?)` · `topUp(n)` · `schedulePost(post)` ·
`approveCampaignEntry(id)` · `approveRequest(id, "approve"|"decline")`(approve 花钱生成会真扣额度)·
`connectChannel(id)` · `resolveConversation(id)`(缺联系人则 `ensureContact` → 补建)·
`toggleAutomationRule(id,on)` · `submitAd(payload)` · `ottoWorking(on,label?)` ·
`appendChatMessage(threadId,msg)` · `startChatThread(title?)`。

## 事件流(append-only,`{ type, payload, at:seq, label }`)
`label` 是人话一行(sentence case、英文 UI),dock / 通知直接显示。类型:
`credits_spent` · `credits_topped_up` · `post_scheduled` · `campaign_entry_approved` ·
`approval_settled` · `channel_connected` · `conversation_resolved` · `contact_created` ·
`automation_toggled` · `otto_working` · `otto_idle` · `ad_submitted`。

## 已接线的表面(Wave 1)
- shell:`ottoWorking` 来自 store,不再硬编码 false;dock 在 3 条 hideDock 路由上只
  视觉隐藏、不卸载(保住 dock 内部草稿/消息 state)。
- dock:working 读 context;`chatThreads()[0]` 读/append;「Just now」条读 `recentEvents(1)`。
- otto-chat 全页:与 dock 共读同一份 `chatThreads`(徽标「Dock and this chat share one
  state」因此为真);`?thread` 深链选中初始 thread。
- home:「Up next」读 `upNext()`,「Awaiting approval」读 `pendingApprovals()`。
- composer:`?post` 预填;确认排期调 `schedulePost` → home「Up next」闭环。
