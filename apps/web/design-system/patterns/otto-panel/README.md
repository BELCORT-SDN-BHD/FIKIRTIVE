# Otto panel

本目录是非 Canvas 页面 Otto panel layout、geometry、open / close / docked state、conversation
composition 与 interaction contract 的唯一实现。普通产品页面只能通过这里暴露的 mount / controls 使用它，
不能再建立另一套右侧 AI drawer 或 page-specific chat。

Canvas 是唯一已批准 carve-out：`../canvas/` 拥有 floating project conversation + History 的空间结构；
两种 surface 必须共享 Otto brand、conversation parts 与业务 action，不能复制第二套 LLM、generation 或
money action。`panel-surface.ts` 已保证 Canvas 不再同时挂 docked panel。

Conversation data、server actions 与 account state 仍由 app / domain 层拥有；本 pattern 只组合它们。

## Current design work

- [`cloudflare-flow-audit.md`](cloudflare-flow-audit.md)：Cloudflare Ask AI 全 flow 审计、Fikirtive 映射与 proposed mini spec。
- [`references/cloudflare-ask-ai/`](references/cloudflare-ask-ai/README.md)：Mobbin 截图证据；只作 reference，不拥有 token 或实现。

Founder 已于 2026-08-28 批准 proposed mini spec；当前实现进入 Founder 视觉与 interaction 验收，
尚未接入真实 LLM、analytics API、persistence 或 production `/` route。
