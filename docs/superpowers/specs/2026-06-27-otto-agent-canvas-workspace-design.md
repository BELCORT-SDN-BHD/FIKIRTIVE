# Design spec — Otto Agent + Canvas workspace (PR #1)

Date: 2026-06-27
Status: draft for founder review (not yet approved for implementation)
Author: brainstormed with founder (winnin.eth)

> 一句话：把 Otto 现有的生成引擎，包进一个「左 chat rail + 右无限画布」的统一主面，
> 生成物变成可拖拽节点，选图一键 animate 成视频。最像竞品的「conva」体感。
> 这是 5 块路线图里的第 ② 块（the spine），其余 4 块都挂在它上面。

---

## 1. Context & goal

This is the first shippable slice of a larger effort to bring a competitor-grade
"agent + infinite canvas" creative workspace into Otto. The full effort decomposes
into five independent sub-projects, built in this order (each its own PR):

1. Web research skill (gives the agent "eyes" — grounding) — *deferred*
2. **Agent + Canvas workspace (the spine) — THIS SPEC**
3. Ad-knowledge + auto full-pack generation — *deferred*
4. Meta Ads connector (read) + Analyze Data — *deferred*
5. Meta Ads connector (write / publish) — *deferred, money-gated, isolated PR + security testing*

This spec covers **only block ②**. It is the platform surface the other four plug into.

**Goal:** Replace Otto's current chat-only home with a unified workspace whose main
area is an infinite, node-based canvas. Every generated image/video becomes a
draggable node. The user drives it from a left chat rail (the existing Otto agent) or
directly on the canvas. Selecting an image node and pressing "animate" produces a
video node, linked back to its source.

**Non-goal for this PR:** any new spend/billing path, web research, real Meta API,
freeform drawing/text nodes, multi-agent parallelism. See §10.

---

## 2. Locked decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Canvas vs Studio | **Canvas becomes the home**; Studio tools fold into it over time | Founder direction: "one Otto operator app, no two doors" |
| v1 surface scope | Spine **+ Assets + Elements folded into the canvas sidebar** | Founder pick (most unified of the offered options) |
| Canvas tech | **React Flow (`@xyflow/react`)** | Purpose-built node canvas; pan/zoom/drag/multi-select/edges out of the box; custom node components render with our own design system; light & controllable |
| Models | Image fixed = **Seedream v4.5**; Video fixed = **env var `OTTO_DEFAULT_VIDEO_MODEL`** (default chosen at deploy, no user picker) | Founder: simplify like the competitor — one image + one video model, configurable not user-selectable |
| Money path | **Reuse the existing spend gate unchanged** (`OttoPlanCard` "Make it · $X" → `coworkGenerate`/`ottoApprove`) | Hard rule: money-in = grantCredits only; spend path never modified. Canvas is only a new trigger+display layer. |
| Delivery | **Independent branch/PR + security testing**; commit/PR only after founder finalizes | Founder instruction |

---

## 3. Surface & layout

Default home becomes a single surface, `AgentCanvas`, laid out as four panes
(left → right):

1. **Global nav** (narrow) — existing `OttoNav`, lightly adapted.
2. **Agent chat rail** — the existing `OttoChatStream`, reused as-is.
3. **Infinite canvas** (main area) — new `FlowCanvas` built on React Flow; replaces the
   `Canvas.tsx` mock. Dotted-grid background, pan/zoom, image + video nodes.
4. **Assets + Elements sidebar** (collapsible) — wraps the existing `Assets` and
   `Elements` components.

(See the wireframe shared during brainstorming.)

---

## 4. Component architecture (follows existing patterns)

Otto uses React `useState` + prop-drilling (no global store), Tailwind + `al-*` classes,
and a `ds.tsx` primitive set. The new work follows the same conventions.

- **Router seam** — `apps/web/components/otto/OttoView.tsx`: add a new `view` case
  (e.g. `"canvas"`) and make it the default. `apps/web/components/otto/OttoApp.tsx`
  holds the `view` state and project/thread source of truth (unchanged pattern).
- **`<AgentCanvasShell>`** (new) — three-pane flex container (the global `OttoNav`
  stays at the `OttoApp` shell level, outside it) composing:
  - `<OttoChatStream>` — **reused** (left rail). No change to the agent stream contract.
  - `<FlowCanvas>` — **new** (main).
  - `<CanvasSidebar>` — **new thin wrapper** around the existing `<Assets>` and
    `<Elements>` (`<Library/>`) components; collapsible.
- **`<FlowCanvas>`** (new, React Flow):
  - Custom node types: `ImageNode`, `VideoNode` — render with `ds.tsx` primitives and
    the `OttoResult` visual style (media + download/copy).
  - Node selection → floating node toolbar: animate (image only), download, delete.
  - Optional edges express `image → animate → video` lineage (from `sourceNodeId`).
  - A node-anchored mini-composer for "generate from this node" / "describe a video to
    generate", reusing `GenSpace`'s prompt/`MentionInput`/`@entity` logic.
  - Canvas-level composer ("type to imagine") for net-new generations placed on the board.

**Key reuse seams (from codebase map):**
- Generation trigger: `startGen(GenReq)` → `GenJob` (`apps/web/lib/gen-actions.ts`).
- Status polling: reuse the `getGenJob` / `hasWorkingJob` bounded-poll pattern from
  `OttoChatStream`.
- Spend approval: `OttoPlanCard` → `coworkGenerate({cardId,...})` / `ottoApprove(...)`.
- Asset URL resolution: `storageKey`/`storageKeyToSrc` from `@fikirtive/core`, via
  `GenerationDTO.url`.

---

## 5. Data model & persistence

New Prisma model (`packages/db/prisma/schema.prisma`):

```
model CanvasNode {
  id           String   @id @default(cuid())
  projectId    String                       // FK Project; owner-scoped via project
  type         String                       // "image" | "video"
  x            Float
  y            Float
  w            Float
  h            Float
  prompt       String?
  generationId String?                       // FK Generation when settled
  genJobId     String?                       // async worker job while pending
  status       String                        // "pending" | "done" | "failed"
  sourceNodeId String?                        // image node this video was animated from
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

New server actions (mirror existing action patterns; all `requireOwner` + project scoping):
- `listCanvasNodes(projectId)` — hydrate the board on open.
- `createCanvasNode(input)` — create a node (pending or attached to a generation).
- `moveCanvasNode(id, {x,y,w,h})` — persist drag/resize.
- `deleteCanvasNode(id)`.

Board layout persists per project. Nodes reference existing `Generation` rows; they do
not duplicate asset bytes. Node positions debounce-persist on drag end.

---

## 6. Generation & money flow (unchanged spend path)

Two entry points to create a node; **both go through the same existing spend gate**:

1. **From chat** — the agent proposes via `OttoPlanCard`; on approval and worker
   completion, the resulting `GEN_RESULT` is materialized as a canvas node (in addition
   to the chat result).
2. **From canvas** — node/canvas composer builds a `GenReq` and routes through the same
   `coworkGenerate` → `startGen` → `GenJob` flow, surfacing the same "Make it · $X"
   approval before any spend.

No new credit, charge, top-up, or grant path is introduced. The canvas is a trigger +
display layer over the existing engine. (Aligns with the "ask before spending real
money" rule.)

---

## 7. Interactions (v1)

- Pan / zoom / fit-to-view; select; multi-select (marquee); drag; resize; delete.
- Image node → "animate" → creates a `VideoNode` (status pending), `sourceNodeId` set,
  edge drawn; video generated via the env-configured model.
- Canvas-direct image generation via the composer; results land as nodes.
- Agent-generated results auto-place as nodes (simple append/grid layout in v1).
- Download a node's asset (plain `<a download>`, no spend).
- Node status reflects job state (pending → done/failed) via the reused poll.

---

## 8. Error handling

- **Generation failure** → node enters `failed` state with a retry affordance, reusing
  the existing `Result.retryable` semantics (no double-charge on already-charged jobs).
- **Poll timeout** (worker stuck) → node marked non-retryable per existing bounded-poll
  cap (~2 min), with a clear message; no silent hang.
- **Approval declined / insufficient balance** → no node created; existing denial
  surfaces (`DENIAL`) shown in the chat rail; canvas stays consistent.
- **Stale/missing generation** → node renders a placeholder; never crashes the board.

---

## 9. Testing & security (independent branch/PR)

Unit:
- `CanvasNode` server actions — owner isolation and project scoping (cannot read/move/
  delete a node in another owner's project).
- Node status state machine (pending → done/failed; retry rules).

Integration:
- Chat generate → node materializes → poll → done (full path).
- Canvas-direct generate → spend gate → charge → node done.

Security focus (explicit):
1. **Cross-tenant isolation** — a user cannot list/read/mutate nodes, generations, or
   assets belonging to another owner's project.
2. **Spend gate cannot be bypassed** — every node-creating generation must pass the
   existing approval/charge path; no canvas route reaches `startGen` without it.
3. **R2 URL scoping** — presigned/asset URLs are not leaked across tenants.

Regression:
- Existing Studio / GenSpace / Otto chat keep working; even though the new surface
  becomes the home, prior entry points remain reachable and unbroken.

---

## 10. Out of scope (future PRs)

- Text / design / frame nodes (freeform whiteboard).
- Multiple parallel agents in one project.
- Folding the Shotstack video editor into the canvas.
- Web research / brand grounding (that is block ①).
- Any real Meta Ads connector or analytics (blocks ④/⑤).
- Stripe / new money-in path (separate, later).

---

## 11. Open questions

None outstanding — all forks resolved during brainstorming (canvas-as-home, v1 scope =
spine + Assets/Elements, React Flow, Seedream image, env-var video model, reuse spend gate).

---

## Appendix A — confirmed canvas interactions (full-res verification, 2026-06-27)

Verified by cropping the source recording at full resolution. These are reference
behaviors to match for fidelity; our v1 subset is noted.

- **Canvas bottom toolbar** (left→right): Hand/Pan with a chevron popover (Select ⌘S /
  Hand ⌘P) · Image node (⌘I) · Video node · Edit/annotate · Add-image. Zoom control
  (− % +) bottom-left; Report Issue bottom-right.
  - *v1*: Select/Hand toggle, Image-gen, Video/animate, Add-node, zoom + fit. (Edit/text node deferred.)
- **Node action toolbar** (appears on node select, left→right): play/animate · crop ·
  expand · align/layers · download · share/upload · like · dislike · delete.
  - *v1 subset*: animate (image nodes only), download, delete. Others optional/deferred.
- **On-canvas image composer** (docked, for net-new generations): prompt + batch count +
  Speed/Quality tier toggle + aspect (2:3) + close (X) + send. Empty image-node
  placeholders appear immediately while generating.
  - *v1*: prompt + count + aspect + send; keep Speed/Quality only if the fixed model
    exposes a tier, else drop. No model picker (fixed `Seedream v4.5`).
- **Animate / video composer** (docked near the selected node): source-image thumbnail +
  "describe a video to generate" prompt + resolution 480p|720p + duration 6s|10s +
  aspect (2:3) + close (X) + send. Empty state: "Select one or more image nodes to animate."
  - *v1*: same, but the model is fixed (env `OTTO_DEFAULT_VIDEO_MODEL`), so no model picker.
- **In-progress jobs**: a queued video renders as a floating labeled pill
  ("<prompt> · 720p · 10s") plus a placeholder node showing % progress; a "Generating"
  status pill attaches to the node. The bottom-left History rail mirrors the same %.
  - *v1*: reuse the existing `GenJob` poll → node `pending` → `done/failed`.

---

## Appendix B — full-product context (recording 2, 2026-06-27) + node → detail view

A second recording revealed Grok Imagine's *other* surface — a per-asset **detail/edit
page** (`/imagine/post/<id>`). This does NOT change PR#1, but informs one design seam and
the later roadmap.

**Design seam to preserve in v1:** a canvas node should be openable into a per-asset
**detail/edit view**, not a dead tile. Reference action rail (adopt incrementally):
Animate · Crop · Aspect Ratio (presets: Original / 2:3 Tall / 3:2 Wide / 1:1 / 9:16 /
16:9) · Regenerate · Extend (`+6s`/`+10s`, "Extend from Frame", "Cancel Extend") ·
Make Video · Upscale · Download · Share · edit-with-`@reference` · favorite · feedback ·
delete.
- *v1*: node opens a MINIMAL detail view (prompt + download + delete + animate). Crop /
  aspect / extend / regenerate / upscale / sound are later PRs. Build the node so it can
  open this view; don't build the full rail yet.

**Explicitly NOT adopted (product-fit filter — FIKIRTIVE is a brand-safe marketing OS):**
- **Build** (Grok's `curl`-installed terminal coding agent) — wrong product. Skip.
- **Spicy / 18+** (NSFW toggle) — off-brand. Skip.
- **Post to X** — consumer social; Meta is the channel (roadmap block ④). Defer.

**Later-roadmap backlog (hangs off block ②, serves ③ "auto video"):** per-asset editor
(crop/aspect/regenerate), video Extend/Sound/Upscale, History library (search,
Full/Compact), brand templates. None outranks the founder's 4 vectors.
