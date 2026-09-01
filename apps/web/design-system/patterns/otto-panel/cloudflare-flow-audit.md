# Cloudflare Ask AI → Otto flow audit

日期：2026-08-28  
状态：Founder 已验收 implementation；2026-08-28 正式收口。

Founder approval：2026-08-28，批准按本文件 Proposed mini spec 实现。

Founder implementation acceptance：2026-08-28，Founder 已确认 docked、history、fullscreen、copy / feedback、close / reopen flow 可接受。

## 结论

当前 Founder Home prototype 的问题不是颜色或 card polish，而是它绕过了 conversation flow：点击 `Ask Otto` 后直接显示一张静态建议卡，没有 empty state、composer、send、thinking、answer、follow-up、history、fullscreen、copy 或 feedback。

Cloudflare Ask AI 的核心不是「右边有个 drawer」，而是同一条 conversation 在 **docked panel** 与 **fullscreen workspace** 之间连续存在。Dashboard 只是 conversation 的进入背景。

## Cloudflare 的完整可见流程

1. **Global entry**：`Ask AI` 位于 dashboard utility bar；未打开时不占内容宽度。
2. **Docked empty state**：打开后右侧 panel 进入布局，dashboard 同时缩窄而不是被盖住。header 显示 `New conversation`、new、fullscreen、close。
3. **Starter or freeform**：空状态同时提供 contextual starters 与固定底部 composer；starter 只是填入 / 发出第一条用户消息，不跳过 conversation。
4. **Thinking**：发送后先保留 user bubble，再显示单行可见的 processing 状态；composer 仍留在原位。
5. **Structured answer**：回答使用 headings、numbered steps、links 与简短说明，不把所有内容塞进一张 CTA card。
6. **Response utilities**：回答尾部提供 copy、positive / negative feedback 与 support entry；反馈在原位变成 selected state。
7. **Follow-up**：composer 一直固定在底部，用户可在同一 thread 继续问，不需要回到首页重开。
8. **Conversation switcher**：点击 header title 展开 search + recent conversations + `New conversation`；切换后 panel shell 不变，只替换 thread。
9. **Fullscreen**：同一 thread 可切换为专用全屏 conversation；header、answer、composer 与 active thread 全部保留。
10. **Close / return**：close 回到原 dashboard。Mobbin 没有记录 reopen 画面，因此 reopen persistence 需要由 Fikirtive 自己明确定义。

证据：[`references/cloudflare-ask-ai/`](references/cloudflare-ask-ai/README.md)。

## 对 Fikirtive 的取舍

### 直接采用

- Utility-bar entry → docked panel → fullscreen 的主路径。
- Conversation title 兼作 history switcher，不另外占一整页。
- 空状态 starters、固定 composer、visible thinking、structured answer。
- copy 与 feedback 的 inline acknowledgement。
- close / reopen 保留 active thread 与 draft。

### 保留 Fikirtive 差异

- Cloudflare 的 cloud illustration 换成正式 Otto orange mark；不新增第二个 mascot。
- starters 改为小生意 Founder 的 marketing-health 任务，例如 `Explain this change`、`Compare the last 30 days`、`Plan the next action`。
- Otto 不只解释。回答可以提出真正的 marketing action，但任何 credits、预算或外部影响都必须进入已有 review / approval gate，不能从 chat 文字直接执行。
- `Support` 只有在真实 support destination 接通后才显示；prototype 不画一个不能兑现的按钮。

### 不采用

- `AI Playground` 的多列模型对比。它是 Cloudflare 的模型测试产品，不是 Ask AI assistant。
- 当前 prototype 的「点击后直接出现最终建议卡」。它跳过了用户建立信任所需的输入、thinking 与 evidence。
- 在本轮删除既有 floating / resize architecture。它不是 Founder Home flow 的 blocker；先让 primary path 与 Cloudflare 对齐，避免把一次 interaction 修正扩大成 shell migration。

## 当前 implementation gap

| 能力 | Cloudflare | 当前 Founder Home prototype | 判断 |
|---|---|---|---|
| Docked panel, content shrinks | Yes | Yes | 保留 |
| Empty conversation + starters | Yes | No | 缺失 |
| Persistent composer | Yes | No | 缺失 |
| User message → thinking → answer | Yes | No | 核心缺失 |
| Follow-up in same thread | Yes | No | 缺失 |
| Title history dropdown | Yes | No | 缺失 |
| Fullscreen same thread | Yes | No；目前只是 width expand | 语义错误 |
| Copy + feedback state | Yes | No | 缺失 |
| Close / reopen persistence | Not evidenced | No fixture proof | Fikirtive 必须定义 |
| Action review gate | Not applicable | Static CTA only | 必须接 Fikirtive contract |

## Proposed mini spec

### Intent

让 Founder 从 Home 的 `Ask Otto` 进入一条可信、可继续、可切换视图的 marketing conversation；视觉和主要 interaction rhythm 对齐 Cloudflare Ask AI，同时保留 Otto 的 action / approval 责任。

### Acceptance criteria

1. Home closed state 的 `Ask Otto` 打开 docked panel，main content 缩窄且仍可操作。
2. 首屏显示 Otto empty state、3–5 个 contextual starters 与固定 composer。
3. `Recommended next action` 只 seed 一条 prompt；发送后依次显示 user message、thinking、structured answer。
4. 回答完成后可在同一 thread 继续输入 follow-up。
5. header title 打开 searchable recents，并可 new / switch conversation。
6. fullscreen 与 docked 共用同一 active thread、scroll position 与 composer draft。
7. copy 与 feedback 有即时 inline acknowledgement，不用全局 modal。
8. close 后回到原 Home；重新打开恢复 active thread 与未发送 draft。
9. 任何 spend / publish / external change 只显示 review action，不能从 fixture 假装已经执行。
10. prototype 使用 realistic fixture；不接 LLM、analytics API、persistence 或 production `/` route。
11. Dashboard 继续 desktop-only；本轮不设计 Otto mobile flow。
12. 所有 UI copy 使用 English sentence case，并只消费正式 token、primitive 与 Otto brand asset。

### Non-goals

- 不在这一轮修改真实 Otto backend、credits、permission 或 action semantics。
- 不删除现有 panel floating / resize 能力。
- 不建立第二套 chat components；prototype 只组合 `otto-panel` 的正式 state / view parts。
- 不设计 Cloudflare 未提供证据的 error、retry 或 support handoff 细节；这些在 primary happy path 验收后单独补。
