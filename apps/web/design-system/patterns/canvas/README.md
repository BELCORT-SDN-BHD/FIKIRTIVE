# Creation product pattern

**状态：** First-class Create workspace amendment approved；prototype implementation 已授权。
**Founder direction approval：** 2026-08-29 — “是的。”
**Current authority：** [`stitch-image-video-parity-spec.md`](./stitch-image-video-parity-spec.md)。

## 当前方向

Creation 以 Founder 重新选定的 **R22 Canvas** 为视觉与空间基线：全屏可拖动画布、上方 Otto status、下方 Conversation history、底部 omnibox、selection context、variations 与非破坏式 iteration。R22 原本吸收的 Stitch agentic Canvas 逻辑继续成立；Fikirtive 把 creation domain 落在 image/video。`Create` 是与 Home、Library、Campaigns、Schedule 同级的 first-class product area，使用主 application shell 的专用 workspace；开始或继续项目后才进入 full-screen Canvas。

Fikirtive 另外拥有自己的 brand、Otto、design tokens、付费 generation confirmation、Library/Campaign/Schedule/Share domain boundaries。页面仍是 fixture-only review surface，不调用 production generation、money、persistence 或 navigation action。

## Canonical files

- `stitch-image-video-parity-spec.md` — 当前批准且冻结的 product/design authority。
- `CanvasReference.tsx` — 当前 R22 convergence review surface；只承载 fixture behavior。
- `fixtures.ts` — review-only prompts、quotes、projects 与 assets。
- `model.ts` — prototype types 与 pure helpers。
- `assets/` — 本 pattern 的 review imagery。
- `references/r22-canvas-completed-1280x720.jpg` — 当前 R22 completed-state 视觉基线（1280 × 720）。
- `references/` — 其他 source capture / visual reference archive。

## Historical decisions

- `grok-imagine-full-parity-proposal.md` — 已被 2026-08-29 Stitch-first direction 取代。
- `grok-imagine-interaction-parity-proposal.md` — 更早的 Stitch × Grok hybrid。
- `grok-image-flow-change-proposal.md` — 更早的 Grok flow change proposal。
- 其他旧 spec 保留用于审计，不再指导当前实现。

## Change register

- 2026-08-29：Founder 批准从零改为 Grok Imagine full parity；明确移除 Stitch Canvas 与 draggable mechanics。
- 2026-08-29：Founder 修正为 Stitch 是唯一 interaction model，只把 website/app creation 翻译成 image/video；批准先重写 spec 再实现。
- 2026-08-29：Founder 批准冻结 Stitch image/video parity spec，并授权 prototype implementation。
- 2026-08-29：Founder 重新选定已保留的 R22 Canvas 为实现基线；保留当前 design system、Founder Home 与其他已通过表面，只收敛 Canvas 与 Otto Ask。
- 2026-08-29：Founder 反转独立 Creation Lab 方向并明确确认。新架构是 Unified Founder Home 内嵌 creation components，提交或继续后直达 full-screen Canvas；独立 Lab surface 退役。
- 2026-08-29：Founder 进一步澄清“不要两个 Home”不等于把 Create 塞进 Home。最终架构是 `Home / first-class Create workspace / full-screen Canvas`；Create 与 Schedule 同级，拥有自己的 route 与内容面。
- 2026-08-30：Founder 批准 Stitch-minimal interaction pass。Create 收敛为一个 shared Otto composer 与低干扰 Canvas history；Canvas 使用单一 current-turn surface、默认折叠 Conversation、node-local progress 与 contextual actions，同时保留 exact-credit confirmation。
- 2026-08-30：Founder 批准 design-system convergence pass；不重新设计已通过的 Create / Canvas，只把 radius、controls、type、motion 与 Otto contrast 收回 canonical tokens / primitives，并增加防回归 guard。
- 2026-08-30：Founder 批准 Canvas reference accessibility QA fix；程序化 file input 从键盘与 accessibility tree 隐藏，`Add a reference` 成为唯一可见且有名称的上传入口。
