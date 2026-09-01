# Product patterns

Patterns 是由正式 primitives 组成、会跨多个页面重复的产品交互结构。它们可以拥有 layout 与 UI
state，但不能复制业务 action、route label、token 或 primitive。

- `application-shell/`：导航 rail、utility bar 与 account entry。导航数据仍由
  `@fikirtive/core/navigation` 唯一拥有。
- `founder-home/`：Founder-approved desktop Home、goal template、可选 component registry、
  reference evidence 与交互 prototype。真实 analytics 计算与配置持久化不属于 design pattern。
- `otto-panel/`：Otto dock、panel geometry、open/close/dock state 与 panel composition。
- `canvas/`：Founder-approved full-screen creation workspace spec、Stitch spatial evidence、Grok Imagine interaction-parity evidence 与
  fixture-only review prototype。真实 LLM、generation spend、persistence 与 production route 不属于 pattern。
- `library/`：Library screen architecture、Generation history、Uploads、Favorites、Collections、Elements 与 media detail 的
  Founder review spec。对象归属与 route hierarchy 仍由 information architecture 唯一拥有。
- `brand/`：Brand / Otto IQ 的五个 context sections、统一 list → detail / create pattern、Mobbin evidence 与
  Founder-selected review fixture。真实 ingestion、persistence、CRM / commerce sync 与 production `/brand` 不属于 pattern。
- `settings/`：Founder-approved beta Settings 的 Personal / Workspace scope、Profile、General、Connections 与 Billing & credits screen spec。
  Schedule、publishing defaults、publishing approvals 与 generic Automation 不属于 beta pattern。
- `reference-picker/`：Founder-approved Otto `@` Reference picker 的 visual states、selection、removable tokens 与 keyboard review fixture。
  Production unified search、typed ID resolution 与 provenance persistence 不属于 pattern。
- `schedule/`：未来唯一 publishing Calendar ownership 与 research archive；当前 beta deferred，不进入 visual direction 或 review fixture。
