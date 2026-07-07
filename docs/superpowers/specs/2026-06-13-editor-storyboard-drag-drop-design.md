# Drag-and-drop: editor timeline + Storyboard frame attach — design

Date: 2026-06-13
Status: approved (brainstorming) — pending implementation plan
Branch: master

## Goal

Add drag-and-drop in two high-value spots, using a familiar "drag the thing onto its target" gesture:

1. **Editor** — drag an asset from the Assets panel onto the timeline to add it to the cut.
2. **Storyboard** — drag a candidate image onto a shot card's Start/End frame slot to attach it as that keyframe.

Both reuse existing server actions. The new work is purely the drag-and-drop wiring plus one new draggable source strip in Storyboard. No Shotstack canvas-internal coordinate logic.

## Scope

**In scope**
- ① Editor: drag Assets-panel item → timeline (append to track 0, same result as the existing click).
- ② Storyboard: a new candidates strip (draggable image thumbnails) + frame slots as drop targets → `setShotFrame`.
- A shared, typed DataTransfer helper (`apps/web/lib/dnd.ts`).
- Drop-target visual affordance (highlight on dragover); keep the existing click/buttons as the non-drag path.

**Out of scope (YAGNI)**
- Drop at a precise timeline time/position. The Shotstack Studio SDK (v2.11.5) exposes `addClip(trackIdx, clip)` but **no public pixel→time mapping**; reverse-engineering canvas coordinates is fragile on this non-standard stack. Repositioning is done with Shotstack's built-in in-timeline clip drag.
- Drag in Gen space results (③), Elements reorder / asset→entity (④), candidate-tray→shot outside Storyboard (⑤).
- Reordering clips/shots by drag (the SDK already drags clips internally; shot reorder has its own buttons).

## Mechanism

Standard HTML5 drag-and-drop:
- A draggable source item sets `draggable` + `onDragStart` writing a typed payload.
- A drop target handles `onDragOver` (preventDefault to allow drop + highlight) and `onDrop` (read payload, run the action).
- Payload travels on a **custom MIME type** `application/x-fikirtive-asset` so OS file drags and other content can't trigger our handlers (and our payload doesn't leak into plain-text drops).

### Shared helper — `apps/web/lib/dnd.ts`
```
export const DND_MIME = "application/x-fikirtive-asset";
export type DndPayload =
  | { kind: "editor-clip"; src: string; clipKind: "image" | "video"; seconds: number }
  | { kind: "candidate-frame"; generationId: string };

export function setDnd(e: DragEvent, p: DndPayload): void   // e.dataTransfer.setData(DND_MIME, JSON.stringify(p)); effectAllowed = "copy"
export function getDnd(e: DragEvent): DndPayload | null     // parse DND_MIME; return null on absence/parse error
```
Pure, framework-agnostic, independently testable. Drop handlers branch on `payload.kind` so a payload meant for one target can't be misapplied by another.

## ① Editor — asset → timeline

- File: `apps/web/components/Editor.tsx`.
- Each Assets-panel media item (currently `onClick={() => appendAsset(m)}`) also gets `draggable` + `onDragStart` → `setDnd(e, { kind: "editor-clip", src: m.src, clipKind: m.kind, seconds: m.seconds })`.
- The timeline container element (the wrapper around `timelineRef`) becomes the drop target: `onDragOver` (preventDefault + highlight state) and `onDrop` → `getDnd`, and if `kind === "editor-clip"` call the existing `appendAsset(clip)` (which does `addClip(0, { asset, start: end, length })`).
- The existing click-to-add stays as the keyboard/non-drag path.
- Ignore the drop until the Shotstack edit is loaded (`handles.current` is set); no other guard needed — `appendAsset` already works whether the edit is empty or populated.

No Shotstack-internal changes; `appendAsset` is unchanged.

## ② Storyboard — candidate → shot frame slot

- File: `apps/web/components/studio/Storyboard.tsx` (+ `apps/web/app/studio/page.tsx` to thread data).
- **New candidates strip**: thread the project's unattached generations into `Storyboard` (page.tsx already calls `getCandidates(project.id)`; pass the **image** candidates down as a new `candidates` prop). Render a horizontal strip of draggable thumbnails at the top of the Storyboard view (above the scenes; sticky so it stays reachable while scrolling cards). Empty state: a one-line hint pointing to Gen space. Each thumbnail: `draggable` + `onDragStart` → `setDnd(e, { kind: "candidate-frame", generationId: c.id })`. Images only — frame slots don't accept video.
- **Frame slots as drop targets**: each shot card's Start and End slot gets `onDragOver` (highlight) + `onDrop` → `getDnd`, and if `kind === "candidate-frame"` call the existing `setShotFrame(shot.id, slot, payload.generationId)`, then `router.refresh()`. Reuse the existing `slotBusy` guard so a drop can't race a generate/upload in flight.
- The existing «✨ generate / ⬆ upload» buttons stay as the non-drag path.

`setShotFrame` already exists (`apps/web/lib/studio-actions.ts:123`) and is owner/project-scoped; the implementation plan must confirm it (or the drop handler) rejects a non-image generation so a video candidate can't land in a frame slot.

## Data flow

```
Assets item / candidate thumb  --dragstart-->  DataTransfer[application/x-fikirtive-asset] = payload
timeline container / frame slot --drop-->      getDnd() --> existing action (appendAsset | setShotFrame) --> refresh
```
No new server action, no new DB column, no migration. The frame attach is a pure DB update (no spend); the editor add is an in-memory Shotstack edit change persisted by the existing save flow.

## Money-safety, edge cases, accessibility

- **No spend**: neither drop triggers a paid call. Frame attach = DB update; editor add = local edit change.
- **Ownership/project scope**: enforced by the reused actions (`setShotFrame`, and the editor save/render path).
- **Type safety**: frame slots accept images only — filter the candidates strip to images AND keep/confirm the server-side image check in `setShotFrame`.
- **Race guards**: respect existing `busy` / `slotBusy`; ignore a drop while a conflicting op is in flight.
- **Wrong-target payloads**: drop handlers branch on `payload.kind`; a mismatched kind is ignored.
- **Accessibility / non-drag fallback**: drag is additive. Editor keeps click-to-add; Storyboard keeps the generate/upload buttons. No flow becomes drag-only.
- **Visual affordance**: drop targets highlight on `dragover` and clear on `dragleave`/`drop`.

## Verification

- Unit: `dnd.ts` set/get round-trips a payload; `getDnd` returns null for absent/garbage data and for a foreign MIME type.
- Editor (Playwright, mock/$0): drag an Assets item onto the timeline → a clip is appended (edit clip count +1); click-to-add still works.
- Storyboard (Playwright, mock/$0): drag an image candidate onto a shot's Start slot → `setShotFrame` runs, the slot shows the image after refresh; a video candidate is not draggable into a slot (or is rejected); generate/upload buttons still work.
- typecheck + lint + core tests green; Codex review before deploy (house rule).
