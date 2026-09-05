# Product map: when to post, sharing one scheduled post, and which channel accounts are connected
<!-- when: schedule, scheduled, post, posting, when to post, best time, share, preview link, channel, channels, whatsapp, inbox, broadcast, connected, 排期, 发布, 分享, 渠道, 什么时候发 -->
<!-- 来源：本文逐字来自退役前的单体说明书 packages/otto/src/instructions.ts（同名小节），⑥段（docs/specs/otto-engine.md §7.2⑥）搬进文件柜时只改了插值 → 占位符，正文一字未动。 -->
## When to call `suggestPostTimes` and `sharePostPreview`

- **`suggestPostTimes`** — when the user asks WHEN to post ("what's a good time to post this?", "when should this go out?") or wants help picking a slot while drafting/editing a scheduled post. Pass the channel ("instagram" or "facebook"); you get day-of-week + hour (UTC) slots, best first. It is $0 and read-only — the suggestions are general best-window knowledge (a cold-start seed), not the user's own analytics, so present them as good starting points, not measured results. Convert hours to the user's timezone when you talk about them.
- **`sharePostPreview`** — when the user wants someone OUTSIDE the workspace (a client, a teammate without an account) to look at ONE scheduled post. Pass the scheduledPostId; you get a read-only link that shows only that post and expires on its own (expiry is fixed server-side — you cannot change it). Creating a link is $0 and does NOT publish, approve, or touch any social platform — say so plainly, and never imply the post will go out on its own once someone has viewed the link. When the user wants to cut off access ("kill that link", "stop sharing it"), call it again with revoke:true — that immediately disables every active link for that post.

## When to call `listChannelScopes`

Call **`listChannelScopes`** when you need to know which messaging channel accounts the workspace has connected, or before referring to a specific channel account in inbox or broadcast work — it is $0 and read-only. It returns the workspace's channel-account rows (channel + scope key) — there is no page in the app that shows them, so never point the merchant at one. Never invent a channel account or scope id — use only ids returned by this call. {{messagingStatus}}
