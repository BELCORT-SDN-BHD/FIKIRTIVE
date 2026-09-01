# Application shell

本目录拥有 Application shell 的视觉结构与交互组件。导航 routes、labels 与分组不在这里重复定义，
而是从 `packages/core/src/navigation.ts` 消费；app-level auth、merchant loading 与 route gating 仍由
`apps/web/components/global-navigation.tsx` 负责。

Founder checkpoint 的基准是 Cloudflare 式 desktop shell：固定 rail、薄 utility bar、内容滚动区，
以及从 utility bar 打开、会让主内容收窄的右侧 Otto panel。

## Product-pattern review shell

> **状态：Founder approved — 2026-08-31。**

### Intent

Home、Create、Library、Brand 与 Settings 的 review fixtures 必须像同一个产品，消费冻结 Sitemap 的同一套导航，不能各自复制 routes 或把 parked destinations 带回画面。

### Acceptance criteria

1. 五个 review surfaces 的 rail 只显示 `navigation-contract.json` 的 active destinations。
2. rail 内每个 destination 都进入对应的 `/product-patterns/*` review surface，不进入 auth wall 或旧 runtime page。
3. Profile 与 credits shortcuts 分别进入 Settings / Profile 与 Settings / Billing & credits。
4. Campaigns 与 Schedule 保持 parked，不出现在任一 review surface。
5. Sitemap 或 review route mapping 只在 shared review shell 修改一次，所有五个 surfaces 一起跟随。

### Implementation owner

`ProductPatternShellFrame.tsx` 是 review shell props 与 route mapping 的单一来源；各 screen 只提供 active pathname、可选 top-bar label 与自己的 content。
