# Design spec — G4c · Multi-convo canvas (parallel Otto conversations per project)

Date: 2026-06-27
Status: approved by founder (design); autonomous build, batch-review at the end.
Branch: `claude/otto-g4c-multi-convo` (off `claude/otto-g4b-pack-approve`). Grounded in the
G1→G4b stack as it stands in the `otto-g2-editor` worktree.

## 1. What this is (and what it deliberately is NOT)

The founder's "multi-agent" (item 6) resolves to: **within one project, run several parallel Otto
conversations, surfaced on the canvas.** Each convo is an independent `ChatThread` — its own state,
its own stream, its own approval. They share only the project: the same Brand Brain, entities,
assets, and **the same canvas board**.

Decisions locked in brainstorming:
- **Single Otto engine, capabilities via skills** — NO personas/roles. (Founder: "就一个 agent
  就好，然后通过 skill 去 harness".)
- **User opens convos manually** — no auto-spawn orchestrator (deferred).
- **UX = sidebar multi-tab (Option 1)** — Grok's own layout (left chat rail + right canvas) plus a
  convo tab strip; backend genuinely parallel, user views one convo at a time.
- **Money path untouched** — each convo approves its own GEN_CARDs through the existing per-card
  gate. Two convos generating = two independent reservations, each separately approved.

This is NOT a rebuild. The multi-thread skeleton and the project-scoped board already exist (see §3).
G4c is a focused **surfacing + concurrency-legibility** PR.

## 2. Scope (G4c)

1. **Convo tab strip (headline).** A compact tab bar atop the left chat pane in the Otto workspace:
   lists this project's threads, highlights the active one, `+ New convo`, click-to-switch, delete.
   Reuses the existing `threads` / `activeThreadId` state and the existing create (first-message)
   and delete (`deleteCoworkThread`) paths — no new thread lifecycle.
2. **Activity dots.** A tab shows a small "working" dot when its thread has an in-flight job (a
   `GenJob` QUEUED/RUNNING or a `CanvasNode` `status="pending"`). Surfaced via one new owner+project
   scoped reader, polled while the workspace is open. This is what makes "parallel" legible.
3. **Shared-board persistence guard.** Lock the already-true behavior that `FlowCanvas` does NOT
   remount when the active convo changes (it is a stable `projectId`-keyed sibling, OttoView:175).
   Add a regression test so a future refactor can't silently couple the board to a thread.
4. **Node attribution (light).** `CanvasNode.threadId String?` (additive, nullable). Canvas actions
   stamp the currently-focused convo; the board tints nodes per convo and offers a
   "filter: this convo / all" toggle. Old nodes (`threadId = null`) render as "unattributed".

### Out of scope (later / dropped)
- ❌ Auto-spawn orchestrator (a lead Otto delegating to sub-convos) — future.
- ❌ Personas / role permissions — dropped per founder.
- ❌ Chat-as-canvas-node (Option 2, chat boxes living on the board) — future "north star" look.
- ❌ Simultaneous live-token streaming of multiple convos on screen — Option 1 means one focused at
  a time; background work continues server-side.
- ❌ Cross-convo chat-history sharing — convos share project assets/brand/board only.
- ❌ Any change to the money path, the agent engine, or skill definitions.

## 3. Current-stack seams (what we build on — verified)

- **Multi-thread already works.** `apps/web/components/otto/OttoApp.tsx` holds `threads` +
  `activeThreadId`; `OttoNav` lists/selects/deletes; `onNewCampaign` opens a new convo (active→null
  → front door → first message creates the `ChatThread`). `ChatThread(projectId, ownerId, …)` already
  supports N-per-project.
- **Board already persists.** `apps/web/components/otto/OttoView.tsx:104` is a two-pane row; the left
  pane swaps front-door↔`OttoChatStream` (keyed by `activeThread.id`), while the right pane
  `OttoView.tsx:175` `<FlowCanvas projectId={projectId} … />` is a stable sibling **outside** the
  per-thread conditional → React keeps it mounted across convo switches.
- **Node creation.** `apps/web/components/canvas/useCanvasGen.ts` (`generateImage`/`animate`) and
  `apps/web/components/canvas/FlowCanvas.tsx:219` (text) all call `createCanvasNode({projectId, …})`.
  None pass a `threadId`, and `FlowCanvas` is not given `activeThreadId` today.
- **Owner/project scoping.** `apps/web/lib/canvas-actions.ts` gates every action with `requireOwner`
  + `ownedProject(projectId, ownerId)`; nodes are `updateMany/deleteMany` with `ownerId` in `where`.
- **Per-thread isolation (engine).** Each thread serializes its own `ottoState` with a CAS guard
  (`otto-actions.ts`); approval is bound 1:1 to a `cardId` (`ottoApprove(threadId, cardId)`); spend
  goes only through `ctx.startGen` with per-card idempotency. Parallel convos cannot cross-write.

## 4. Architecture

### 4.1 Convo tab strip — `<ConvoTabs>` (new)
`apps/web/components/otto/ConvoTabs.tsx`. Props:
`{ threads, activeThreadId, activity, onSelect, onNew, onDelete }`.
Rendered at the top of the left chat pane in `OttoView` (both front-door and active states), so it
reads as "this board's convos". Pure presentational; all state stays in `OttoApp`. `onNew` =
`onActiveThreadChange(null)` (existing front-door path). `onDelete` reuses `handleDeleteThread`.
`activity` = a `Set<string>` of thread ids currently working (from §4.2).

### 4.2 Activity reader — `listProjectThreadActivity` (new)
`apps/web/lib/otto-actions.ts` (or a small `thread-activity.ts`):
`listProjectThreadActivity(projectId): Promise<{ threadId: string; pending: boolean }[] | {error}>`.
`requireOwner` + `ownedProject`. For the project's threads, `pending = true` iff there exists a
`GenJob` (owner+project, `threadId` set, status in QUEUED/RUNNING) **or** a `CanvasNode`
(owner+project, `threadId` = that thread, `status="pending"`). Polled by the workspace every few
seconds while mounted; cheap (indexed, owner+project scoped). Read-only; no spend.

### 4.3 Node attribution
- **Schema:** `CanvasNode.threadId String?` + `@@index([ownerId, projectId, threadId])`. Additive,
  nullable, no backfill.
- **Write:** `createCanvasNode` gains optional `threadId`. When present, validate it names a
  `ChatThread` with the same `ownerId` AND `projectId` (fail-closed → ignore/clear if mismatch;
  never trust it blindly). `useCanvasGen` and the text-node path stamp the active convo.
- **Plumb:** `OttoView` passes `activeThreadId` → `FlowCanvas` → `useCanvasGen` + text create.
  Canvas-direct actions are attributed to whatever convo is currently focused.
- **Render:** nodes tint by a deterministic color derived from `threadId` (stable hash → palette);
  a canvas toolbar toggle filters to the active convo's nodes vs all. `null` → neutral "unattributed".

### 4.4 Concurrency model (no new coordination)
Each convo = one thread = its own `ottoState`/stream/approval. Two convos running concurrently are
different DB rows with independent CAS + independent per-card idempotency, so no shared mutable state
and no new locking. Background convos' `GenJob`s already run worker-side; switching away stops only
live token streaming, not the job. Switching back reloads the thread + polls its jobs (existing).

## 5. Money / safety

- **Money path untouched.** No new charge/grant/reserve path. Every spend still flows card-by-card
  through the existing `generate` → `ctx.startGen` → reserve→settle, separately approved per convo.
  Parallel convos = parallel independent, separately-approved reservations. "The ask is the cap"
  holds per convo. (See [[ask-before-spending-real-money]].)
- **Isolation.** New reader + `threadId` attribution are `requireOwner` + `ownedProject` scoped. A
  thread from another owner/project can be neither listed, made active, nor stamped onto a node
  (cross-project `threadId` is rejected at write). No cross-tenant read/write is reachable.

## 6. Testing

- **Unit:** `listProjectThreadActivity` owner+project scoping (non-owner → not found; other project's
  threads excluded; pending computed from QUEUED/RUNNING GenJob or pending CanvasNode).
  `createCanvasNode` with `threadId`: accepted when same owner+project; rejected/cleared when the
  thread is another project's or another owner's. Deterministic node→color helper is pure + tested.
- **Component/regression:** switching `activeThreadId` does NOT remount `FlowCanvas` (board state
  survives a convo switch). `ConvoTabs` select/new/delete drive the existing `OttoApp` callbacks.
- **Concurrency:** two threads each running `generate` produce two independent `GenJob`s with no
  idempotency collision and no `ottoState` cross-write (keys are per-card; rows are per-thread).
- **Build:** full `pnpm -r build` must pass, including `├ ƒ /otto`.
- **Manual (deployed; mock locally):** open project → `+ New convo` ×2 → generate in each → both sets
  of nodes land on one board, tabs show activity dots, filter toggles per convo, switch never clears
  the board.

## 7. Open questions
None blocking. If activity polling proves chatty, fold `pending` into the existing thread-list DTO
instead of a separate poll — an implementation detail, not a design change.
