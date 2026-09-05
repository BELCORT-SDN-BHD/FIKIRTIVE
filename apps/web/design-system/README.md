# Fikirtive Design System

`apps/web/design-system/` 是 Fikirtive 在本 repo 内唯一的设计权威目录。这里的 single source of truth（单一权威来源）
不是要求所有决定挤进一个文件，而是要求**每一种设计决定只有一个 owner**，其他路径只能消费或链接它。

例如：珊瑚色的品牌定义只改 `brand/colors.json`；产品里的语义 token 只改
`foundations/globals.css`；Button 的行为与 variants 只改 `primitives/button.tsx`。业务页面不能再
各自重写一遍。

## 目录地图

| 目录 | 唯一负责的内容 | 不负责 |
|---|---|---|
| `brand/` | 品牌色、字体、Logo、Otto 正稿、品牌规范与品牌 React marks | 产品布局与业务流程 |
| `direction/` | Founder 已批准的 v4 视觉方向、设计原则与 Stitch Canvas 研究 | live CSS 值与组件行为 |
| `foundations/` | 产品实际渲染的 tokens、theme、typography、spacing、radius、shadow、motion 与全局 recipes | 品牌原稿与业务状态 |
| `primitives/` | Fikirtive 的 shadcn Base UI primitives、variants 和无障碍行为 | Campaign、Library 等业务组件 |
| `patterns/` | 多页面共用的产品交互模式，包括 Application shell、Founder Home、Otto panel 与 Canvas | 单一页面的业务实现 |
| `information-architecture/` | Founder-facing product map、surface ownership、cross-surface flows、Reference picker contract 与 runtime convergence ledger | 准确 route 字面量、页面视觉实现与 backend action |
| `governance/` | checklist、国际化和设计系统维护规则 | 视觉值本身 |
| `references/` | 已被取代的 v3、旧 handoff 与退役资产，只供溯源 | 任何新实现的批准依据 |

机器可读的同一张地图在 [`authority.json`](authority.json)。新增或移动权威来源时，两者必须一起改。

## 权威顺序

1. 当前 Founder 决定与 `direction/` 决定产品方向。
2. `brand/` 决定身份资产与品牌不可变规则。
3. `foundations/` 决定浏览器实际使用的视觉值。
4. `primitives/` 决定基础组件 API、状态与交互。
5. `information-architecture/` 决定 Founder-facing product area、surface ownership 与 handoff。
6. `patterns/` 组合 primitives，但不能重新定义 token、复制 primitives 或改写 IA ownership。
7. 产品页面消费上述来源，并只拥有业务数据与业务流程。

如果两层冲突，不能默默任选一层。先记录 drift，再由 Founder 决定方向；随后在同一次有边界的变更里
修正下游实现。

## Compatibility aliases

为了不制造一次性大爆炸，以下旧入口继续存在，但它们全部是 symlink，不是第二份来源：

| 兼容入口 | 实际 owner |
|---|---|
| `apps/web/app/globals.css` | `apps/web/design-system/foundations/globals.css` |
| `apps/web/components/ui` | `apps/web/design-system/primitives` |
| `apps/web/components/brand` | `apps/web/design-system/brand/components` |
| `apps/web/components/navigation` | `apps/web/design-system/patterns/application-shell/navigation` |
| `apps/web/components/otto/panel` | `apps/web/design-system/patterns/otto-panel` |
| `docs/brand` | `apps/web/design-system/brand` |
| `docs/design/v4` | `apps/web/design-system/direction` |
| `docs/design-system` | `apps/web/design-system/governance` |

现有 `@/components/ui/button` imports 因此不需要一次性改写。新的 shadcn component 仍通过既有 alias
加入，文件最终会落到 `design-system/primitives/`。

## 修改规则

新增或修改辅助说明、费用提示、Otto 状态或内部能力的用户表达时，先读 [文案与信息展示规则](governance/content-disclosure.md)。它是该类决定的唯一 owner，不改变业务收费合同。

接手本轮前端基线时，先读[前端基线交付与接手入口](governance/frontend-baseline-handoff.md)；它是交付快照，不替代各板块 spec 或实时接线记录。

涉及后端接线、组件或流程变更时，先读[前端接线与设计变更交接规范](governance/frontend-integration-handoff.md)。组件复用、缺口处理、变更批准与接线验收的流程只维护在该文件。

- 不在 page 或业务 component 内写新的品牌 hex、radius、shadow 或 motion literal；先判断是否应成为 token。
- 不复制 primitive 来改外观；优先补正式 variant。只有业务语义和行为不同，才建立 product component。
- pattern 只能 import primitives 和既有 domain truth，不能复制 navigation labels、routes 或 panel state。
- 验收页只传 fixture 给正式组件，不拥有第二套设计实现。
- `references/` 里的文件永远不能被新代码当作当前 authority。
- 每次移动或新增 owner，都必须更新 `authority.json` 并通过 source-of-truth guard test。

## 常见修改应该去哪里

| 想改什么 | 去哪里改 |
|---|---|
| Fikirtive / Otto 官方图形或品牌色 | `brand/` |
| 全局背景、文字、border、spacing、radius、motion | `foundations/globals.css` |
| Button、Dialog、Input、Toast 等组件 | `primitives/` |
| 左侧导航、顶部 utility bar | `patterns/application-shell/` |
| Otto dock、panel geometry、panel state | `patterns/otto-panel/` |
| Dashboard 页面内容 | 产品页面；只组合上述 pattern 和 primitive |
| Canvas 全屏工作方式 | 先在 `direction/` 对齐，再建立 `patterns/canvas/` |
| 新页面、页面归属、主板块或跨页面 flow | `information-architecture/`；准确 route 再由 `@fikirtive/core/navigation` 实现 |
