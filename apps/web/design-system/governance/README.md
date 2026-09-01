# Design system governance

> 本目录只负责设计系统的维护规则与验收证据。完整来源地图在
> [`../README.md`](../README.md)，机器可读版本在 [`../authority.json`](../authority.json)。
> 实际渲染值由 `../foundations/globals.css` 负责，基础组件行为由 `../primitives/` 负责。

- `checklist-closure.md` — 2026-08-28 Phase 1C 查漏补缺结论与延期边界。
- `internationalization.md` — locale、文案扩张、数字、货币、日期、timezone、RTL 与验收规则。
- [frontend-integration-handoff.md](frontend-integration-handoff.md) — 后端接线涉及前端时必读：设计来源核对、组件复用／扩展、变更批准与验证边界。
- [frontend-baseline-handoff.md](frontend-baseline-handoff.md) — 2026-09-02 本次基线交付快照、源码入口、验证范围和接手顺序；不替代实时 convergence record。
- `design-rules.md` 与 `cards/` — 为旧链接保留的 compatibility symlink；真实文件在
  `../references/legacy-v3/`，已被 v4 取代，不能用于批准新实现。

## 当前分阶段边界

Phase 1A foundations、Phase 1B primitives 与 Phase 1C checklist 已分别形成可运行验收页和
closure 记录。下一阶段按 product pattern 分批验收，不把 dashboard 内容、Otto conversation flow
或 Canvas workflow 混成一个无底洞。

后续内容分开验收：

1. Application shell：Cloudflare 式 rail、utility bar、content frame 与 Otto panel geometry。
2. Otto flow：conversation、history、composer、task cards 与打开/收起行为。
3. Dashboard templates：真实 dashboard 内容与状态。
4. Canvas：Stitch 式全屏工作区与完整 flow。
5. 逐页高保真实现与 design QA。

权威关系：品牌色值来自 `../brand/colors.json`，产品 token 实际值来自
`../foundations/globals.css` 的 `.gb` token root，验收路由只渲染这些正式来源。

## Phase 1A 动效契约

动效先判断频率与目的，再选择时间和曲线。键盘触发与每天重复 100 次以上的操作保持即时；
hover、focus 与颜色反馈使用 120ms；紧凑 reveal 使用 150ms；dialog、sheet 与重要状态变化使用
200ms。600ms 只允许用于一次性的 Otto authorship highlight，不属于常规 UI 动效。

hover、颜色与 opacity 反馈使用 `--ease-standard`，进入与离开使用 `--ease-out`，屏幕内移动与
morph 使用 `--ease-in-out`，手势 drawer 使用 `--ease-drawer`，持续进度才使用
`--ease-linear`。pointer press 可以提供 `scale(0.97)` 的即时反馈，keyboard activation 不增加
位移动效。reduced motion 应去除空间移动，同时保留帮助理解的颜色与 opacity 反馈；具体组件状态
在 Phase 1B 逐项验证。
