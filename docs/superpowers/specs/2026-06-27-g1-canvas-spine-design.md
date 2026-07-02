# Design spec — G1 · Canvas spine (first PR)

Date: 2026-06-27
Status: ✅ SHIPPED — canvas spine merged (PR #48 via the #60 stack) and iterated through #82/#85/#88/#89/#90; live on main.
Supersedes the earlier draft `2026-06-27-otto-agent-canvas-workspace-design.md`, which was
grounded in a stale worktree. This spec is grounded in **current main `fba7882`** (post 34-PR
integration) and the founder's fresh decisions (see `2026-06-27-otto-feature-decisions.md`).

## 1. Context & goal

The full effort is decomposed into 6 PR groups (G1→G6) — see the decisions log. **G1 is the
first PR: the canvas spine.** It is the home surface everything else (G2 editor, G4 automation)
plugs into.

Goal: replace the current task-tile home with an **infinite, node-based canvas** as the `/otto`
home. Each generation becomes a draggable node. The user drives it from a left chat rail (the
existing Otto agent) or directly on the canvas. Selecting an image node and pressing "animate"
produces a video node.

## 2. Scope

G1 contains exactly these decided items:
- **2 Infinite canvas engine** — rebuild (React Flow). `Canvas.tsx` today is an unreachable mock.
- **5 Text/design nodes** — rebuild (a canvas node type).
- **44 Model selection** — optimize: fix to 1 image + 1 video, env-configurable, no user picker.
- **45 Canvas-as-home** — optimize routing: make the canvas the `/otto` home.
- **3 Image gen** + **4 image→video (i2v)** — reuse-as-is, wired into the canvas as node actions.

Out of G1 (later groups): crop/aspect/extend/upscale/favorite/detail-page polish (G2);
web-research/brand-brain/intake (G3); UGC & batch pipelines, multi-agent (G4);
templates/history/discover/settings/tasks (G5); connectors/publish/analytics (G6).

## 3. Current-main seams (what we build on)

- **Home routing**: `apps/web/app/studio/page.tsx` redirects all non-editor studio views to
  `/otto` (Canvas is currently unreachable). Home today = `OttoFrontDoor` via
  `apps/web/components/otto/OttoApp.tsx` → `OttoView.tsx` (`view='otto'`, no active thread).
  → G1 makes the canvas the default `/otto` surface (integrate into `OttoView`, option (b) from audit).
- **Generation engine (reuse)**: `packages/core/src/gen.ts`, `packages/generation/src/index.ts`,
  `apps/worker/src/jobs/gen.ts`. Image (Seedream) + video (i2v with optional tail frame) are
  production-grade with atomic exactly-once spend. `GenSpace.tsx` already passes
  `sourceGenerationId` + `tailGenerationId`; the worker resolves source priority.
- **Money path (untouched)**: credit ledger reserve→settle→refund + idempotency. Canvas-direct
  generation routes through the SAME gen entry → same reserve. **No new money path** (founder rule #39).
- **Model config (optimize)**: `GEN_MODELS=['seedream']` + `GEN_VIDEO_MODELS` (13) are hardcoded
  zod consts in `packages/core/src/gen.ts`; `model-registry.ts` + `ModelsAdmin.tsx` gate them.

## 4. Component architecture

Otto uses React `useState` + prop-drilling, Tailwind + `al-*` classes, a `ds.tsx` primitive set.

- **Router**: `OttoView` gains a canvas home. The `/otto` default (no active thread) becomes the
  `<AgentCanvas>` surface instead of `OttoFrontDoor`. (FrontDoor's goal tiles/composer are reused
  inside the canvas empty-state per G3 intake; not deleted.)
- **`<AgentCanvasShell>`** (new) — left chat rail (reuse the existing Otto chat component) +
  `<FlowCanvas>` (new, React Flow). (Assets/Elements sidebar is deferred — it was a separate
  decision and is not in the G1 item list; G1 keeps the two-pane shell.)
- **`<FlowCanvas>`** (new): React Flow with custom node types `ImageNode`, `VideoNode`, `TextNode`,
  rendered with `ds.tsx` styling. Node selection → minimal toolbar (animate on image nodes,
  delete, download). A node-anchored mini-composer and a canvas composer create new generations.
  Image→video edge expresses lineage (`sourceNodeId`).
- **Generation trigger**: canvas/node composer builds a gen request routed through the existing
  gen entry (same as `GenSpace`), reserving credits via the existing path. Agent-produced results
  also materialize as nodes.

## 5. Data model & persistence

New Prisma model (`packages/db/prisma/schema.prisma`):

```
model CanvasNode {
  id           String   @id @default(cuid())
  projectId    String                       // FK Project; owner-scoped via project
  type         String                       // "image" | "video" | "text"
  x            Float
  y            Float
  w            Float
  h            Float
  text         String?                       // for text nodes
  prompt       String?
  generationId String?                       // FK Generation when settled
  genJobId     String?                       // async worker job while pending
  status       String                        // "pending" | "done" | "failed"
  sourceNodeId String?                        // image node a video was animated from
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

New server actions (mirror existing action patterns; all owner-checked + project-scoped):
`listCanvasNodes(projectId)` / `createCanvasNode` / `moveCanvasNode(id,{x,y,w,h})` /
`updateTextNode(id,text)` / `deleteCanvasNode`. Layout persists per project; nodes reference
existing `Generation` rows (no byte duplication).

## 6. Generation & money flow (unchanged spend path)

Two entry points, both through the existing spend path:
1. **From chat** — the agent generates; the result is materialized as a canvas node.
2. **From canvas** — node/canvas composer → existing gen entry → `GenJob` → reserve→settle.

No new credit/charge/grant path. The canvas is a trigger + display layer over the existing engine.
Node status follows the existing job poll (pending → done/failed).

## 7. Model simplification (item 44)

- Image fixed = `seedream`. Video fixed = env var `OTTO_DEFAULT_VIDEO_MODEL` (default chosen at
  deploy). No user-facing model picker.
- Move `GEN_MODELS`/`GEN_VIDEO_MODELS` selection to env/runtime-config; **validate the model id at
  spend-time (pre-spend), not compile-time**; keep the provider `VIDEO_CFG` keyed by all known
  models so adding 1–2 later is an env swap, not a code change. `ModelsAdmin.tsx` reflects the env
  selection (display only).

## 8. Interactions (G1)

Pan / zoom / fit-to-view; select; multi-select (marquee); drag; delete. Image node → "animate" →
new `VideoNode` (status pending, `sourceNodeId` set, lineage edge). Canvas-direct image generation;
results land as nodes. Agent-generated results auto-place as nodes (simple append/grid layout).
Text nodes: create, edit inline, move, delete. Download a node's asset (no spend).

## 9. Error handling

Generation failure → node `failed` state + retry, reusing existing `retryable`/idempotency (no
double-charge). Poll timeout → node marked non-retryable per the existing bounded poll. Declined
approval / insufficient balance → no node; existing denial surfaces in the chat rail. Stale/missing
generation → placeholder node; never crash the board.

## 10. Testing & security (independent branch/PR)

Unit: `CanvasNode` server actions — owner isolation + project scoping (cannot read/move/delete
another owner's nodes); node status state machine; the new env-based model validation at spend-time.
Integration: chat generate → node → poll → done; canvas-direct generate → existing spend reserve →
node done. Security: (1) cross-tenant isolation (nodes/generations/assets); (2) spend gate not
bypassable — every node-creating generation passes the existing reserve path; (3) R2 URL scoping;
(4) the model env-config cannot be used to select an unpriced/unknown model (spend-time validation).
Regression: `/studio?view=editor`, GenSpace, and the agent chat keep working.

## 11. Out of scope (later PR groups)

G2 crop/aspect/extend/upscale/favorite/full detail-page · G3 web-research/Brand-Brain/intake ·
G4 UGC & batch pipelines, multi-agent · G5 templates/history/discover/settings/tasks ·
G6 connectors/publish/analytics. Assets/Elements canvas sidebar: deferred (not a G1 item).

## 12. Open questions
None outstanding — G1 scope, canvas-as-home, React Flow, env-model, reuse spend gate are all decided.
