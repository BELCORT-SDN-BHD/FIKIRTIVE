# Canvas design-system compliance audit（2026-08-30）

## Audit scope

- Surface：`Create → full-screen Canvas`。
- User goal：从一句 prompt 进入 Otto 的必要提问、准确 credits 确认、node-local generation、完成结果与 contextual actions。
- Accessibility target：desktop keyboard / pointer，清晰的 state、focus、control semantics 与至少 WCAG AA small-text contrast。
- Viewport：1440 × 900，devicePixelRatio 1。
- Canonical authority：`apps/web/design-system/authority.json`、`foundations/globals.css`、`primitives/` 与 `patterns/canvas/`。

## Initial verdict

**Not fully compliant.** Canvas 的颜色、状态色、阴影、品牌资产和多数 actions 已消费正式 design system；但 surface radius、部分 typography / motion、7 个 raw buttons、1 个 raw textarea 与 Otto filled-button contrast 仍绕过或暴露 design-system gap。不能把当前版本称为“全部 components 都跟着 design system”。

## Flow evidence

| Step | State | Health | Evidence |
| --- | --- | --- | --- |
| 1 | Create idle | Needs revision | [`01-create-idle.png`](01-create-idle.png) |
| 2 | Otto needs answer | Needs revision | [`02-canvas-needs-answer.png`](02-canvas-needs-answer.png) |
| 3 | Exact credits confirmation | Needs revision | [`03-canvas-credit-confirmation.png`](03-canvas-credit-confirmation.png) |
| 4 | Node-local generating | Healthy | [`04-canvas-generating.png`](04-canvas-generating.png) |
| 5 | Completed + selected result | Mostly healthy | [`05-canvas-completed-selected.png`](05-canvas-completed-selected.png) |
| 6 | Conversation expanded | Needs revision | [`06-canvas-conversation-open.png`](06-canvas-conversation-open.png) |
| 7 | Variations popover | Healthy | [`07-canvas-variations-popover.png`](07-canvas-variations-popover.png) |
| 8 | Contextual actions menu | Healthy | [`08-canvas-actions-menu.png`](08-canvas-actions-menu.png) |

## Confirmed strengths

- Canvas source contains **0 local hex colours**. Background、foreground、border、Otto、success、warning、error 全部使用 semantic tokens。
- Visible shadows consume `--shadow-sm` / `--shadow-md`; no page-local shadow literal。
- Main actions use the canonical Base UI-backed `Button`、`Popover`、`DropdownMenu`、`Badge`、`Spinner` and `toast` primitives。
- Fikirtive and Otto marks come from official brand components；image/video previews use real local assets。
- Current flow exposes named regions, disabled Send state, `status="Loading"`, menu / menuitem semantics and exact credit copy。
- 8 screenshots were captured and inspected in this run；browser console error / warning count is 0。
- Focused tests passed：Canvas contract 13 / 13；design-system source-of-truth guard 5 / 5。

## Findings

### P1 — Surface radius bypasses the card token

`rounded-xl` resolves to **28px** in the current foundation, while `--radius-card` is **12px**. The rendered composer、Otto current turn、Conversation、tool rail and zoom rail therefore use 28px even though the formal Card / Popover language uses 12px. Static scan found 8 `rounded-xl` uses across the Canvas pattern.

### P1 — Product controls bypass canonical primitives

Static scan found 7 raw `<button>` elements and 1 raw `<textarea>` across `CanvasReference.tsx` and `CreationComposer.tsx`. This includes question choices、Something else、project title、Conversation rows / trigger、zoom reset and remove-reference. They remain semantic HTML, but they bypass the Base UI-backed Button defaults, `data-press-feedback`, shared sizes, disabled/loading behavior and the canonical Textarea / InputGroup focus contract.

### P1 — Otto text button contrast is below AA

The canonical `Button variant="otto"` renders `#FFFFFF` on `#EC5828`, measured at **3.50:1**. The confirmation label `Generate · 20 credits` is small text and needs 4.5:1. The same coral with `--brand-ink` is **5.00:1**; alternatively, the brand rule already says human-action buttons are ink, so confirmation can use the default ink Button while coral remains Otto presence.

### P2 — Typography and motion values are locally repeated

Canvas has 18 arbitrary `text-[…]` utilities, 5 arbitrary tracking values and 2 local `duration-150 ease-out` pairs. Several values happen to resemble foundation values, but copying the literals means later token changes will not propagate.

### P2 — Repeated Canvas surface shells are not DRY

Current turn、Conversation、tool rail、zoom rail and composer repeat the same border / background / shadow / radius composition. A small `CanvasSurface` product component or a formal surface recipe would make the source and future corrections traceable without turning every business card into a generic primitive.

### P2 — Existing guard tests do not prove component compliance

`design-system-source-of-truth.test.ts` correctly verifies authority paths, aliases and brand assets, but it does not reject raw controls, page-local typography / motion literals or incorrect radius utilities. Both existing test suites pass while the issues above remain.

## Before / after recommendation

| Before | After | Why |
| --- | --- | --- |
| `rounded-xl` → rendered 28px | `rounded-[var(--radius-card)]` or canonical `Card` → 12px | Consume the one radius owner instead of Tailwind's unrelated XL scale |
| Raw question / Conversation / zoom `<button>` | Canonical `Button`, plus one explicit `choice` variant only if needed | Restores Base UI behavior, press feedback, sizing and focus defaults |
| Raw composer `<textarea>` | `InputGroup` + `InputGroupTextarea` | Uses the formal field / focus / disabled contract without losing the Stitch composition |
| `text-[10px]`, `text-[11px]`, `text-[15px]` | Existing `text-xs` / `text-sm` / `text-base`, or a named foundation type token | Typography changes propagate from the source of truth |
| `duration-150 ease-out` | `duration-[var(--dur-2)] ease-[var(--ease-out)]` | Motion follows the approved timing source |
| `variant="otto"` white text on coral | Default ink confirmation, or coral + `brand-ink` | Keeps Otto identity while meeting small-text contrast |
| Repeated surface class strings | One local `CanvasSurface` composition | DRY without over-generalising a product-specific component |

## Evidence limits

- This is a desktop fixture-only audit；no production generation, persistence or billing mutation was exercised。
- Screenshot and DOM evidence cannot establish full screen-reader compatibility；a later production integration should add automated accessibility checks and a manual screen-reader pass。

## Post-fix verification

Founder 批准 remediation 后，本轮只做 design-system convergence，没有改变 Create / Canvas 的 information architecture、布局、question / exact-credit flow、generation semantics 或 Canvas mechanics。

| State | Before | After | Result |
| --- | --- | --- | --- |
| Create idle | [`01-create-idle.png`](01-create-idle.png) | [`after-01-create-idle.png`](after-01-create-idle.png) | Composer 保持同一层级，surface 收到 12px card token |
| Needs answer | [`02-canvas-needs-answer.png`](02-canvas-needs-answer.png) | [`after-02-canvas-needs-answer.png`](after-02-canvas-needs-answer.png) | Choice controls 改为 canonical Button；没有改变问题 flow |
| Credits confirmation | [`03-canvas-credit-confirmation.png`](03-canvas-credit-confirmation.png) | [`after-03-canvas-credit-confirmation.png`](after-03-canvas-credit-confirmation.png) | Otto coral + brand ink 实测 4.997:1 |
| Generating | [`04-canvas-generating.png`](04-canvas-generating.png) | [`after-04-canvas-generating.png`](after-04-canvas-generating.png) | Node-local progress 保持不变 |
| Completed + selected | [`05-canvas-completed-selected.png`](05-canvas-completed-selected.png) | [`after-05-canvas-completed-selected.png`](after-05-canvas-completed-selected.png) | Selection actions、node 与 toolbar 使用 card radius token |
| Conversation open | [`06-canvas-conversation-open.png`](06-canvas-conversation-open.png) | [`after-06-canvas-conversation-open.png`](after-06-canvas-conversation-open.png) | Rows / trigger 改为 canonical Button；chronology 不变 |
| Variations popover | [`07-canvas-variations-popover.png`](07-canvas-variations-popover.png) | [`after-07-canvas-variations-popover.png`](after-07-canvas-variations-popover.png) | Formal Popover / Button composition 保持正常 |
| Actions menu | [`08-canvas-actions-menu.png`](08-canvas-actions-menu.png) | [`after-08-canvas-actions-menu.png`](after-08-canvas-actions-menu.png) | Formal DropdownMenu / menuitem semantics 保持正常 |

### Resolved findings

- `rounded-xl` / `rounded-2xl`：Canvas pattern 归零；current turn 与 composer rendered radius 都是 **12px**。
- Raw visible controls：raw `<button>` / `<textarea>` 归零；browser DOM 未发现绕过 `data-slot` 的 button，composer textarea 是 `input-group-control`。
- Otto contrast：canonical `Button variant="otto"` 继续使用 `#EC5828` coral，foreground 改为 `#2B1308` brand ink；实际 computed ratio **4.997:1**。
- Typography / motion literals：`text-[Npx]`、arbitrary tracking、`duration-150 ease-out` 在 Canvas pattern 归零。
- DRY：Current turn 与 Conversation 复用 local `CanvasSurface` composition；radius、border、background 与 shadow 只有一个 Canvas owner。
- Guard：Canvas contract 现在拒绝 raw controls、legacy radius 与 typography / motion drift；source-of-truth guard 同时计算 Otto brand pair 的 AA contrast。

### Browser regression

- 1440 × 900；Create → question → confirmation → generating → completed → Conversation / Variations / actions menu 全部通过。
- Canvas drag 实测：artifact 从 `left 452 / top 225` 移到 `left 512 / top 255`。
- Current turn、Conversation、composer、tool rail 与 zoom rail：0 overlap、0 viewport overflow。
- Browser dev logs：0 error、0 warning；Next.js runtime error overlay：0。

### Engineering evidence

- Focused Vitest：2 files，20 / 20 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Design-system usage audit command：通过；本结果只声明 Canvas pattern 已收口，不把全产品 adoption 误报为完成。
- Next.js production build：通过；repo 缺少本地 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 warning，不影响 fixture-only Create / Canvas route 编译与生成。
- `git diff --check`：通过。

final result: passed
