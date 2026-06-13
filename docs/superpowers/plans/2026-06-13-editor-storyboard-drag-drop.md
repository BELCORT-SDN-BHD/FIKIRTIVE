# Editor + Storyboard drag-and-drop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop in two spots — drag an editor Assets item onto the timeline (append), and drag a Storyboard candidate image onto a shot's Start/End frame slot (attach) — reusing existing actions, no new server action and no migration.

**Architecture:** Standard HTML5 drag-and-drop. A shared `apps/web/lib/dnd.ts` encodes a typed payload on a custom MIME (`application/x-artlio-asset`) so OS-file drags can't trigger our handlers. Drop handlers read the payload, branch on `kind`, and call existing actions: editor → `appendAsset` (`addClip(0,…)` append); Storyboard → `setShotFrame(shotId, slot, generationId)`. No Shotstack canvas-coordinate logic.

**Tech Stack:** Next.js 16 (App Router), React client components, Shotstack Studio SDK 2.11.5 (editor), Prisma. Web has no unit-test runner (test script is a no-op) — web-side behaviour is verified with Playwright against the local dev server in mock ($0) mode, matching the repo's existing tracer pattern.

**House rules:** surgical changes; money-safety (neither drop spends; `setShotFrame` already enforces owner + project + image-only); **no auto-commit/push** (commit only when the user asks); Codex review before any deploy.

---

## File structure

- **Create** `apps/web/lib/dnd.ts` — the shared typed DnD payload helper (encode/decode over `DataTransfer`).
- **Modify** `apps/web/components/Editor.tsx` — make Assets items draggable; make the timeline container a drop target → `appendAsset`.
- **Modify** `apps/web/app/studio/page.tsx` — map image candidates to a small DTO and pass it down.
- **Modify** `apps/web/components/studio/StudioShell.tsx` — forward the new `frameCandidates` prop to `Storyboard`.
- **Modify** `apps/web/components/studio/Storyboard.tsx` — add a sticky draggable candidates strip; make each shot card's frame slots drop targets → `setShotFrame`.

No other files change. No new server action. No DB migration.

---

## Task 1: Shared DnD helper

**Files:**
- Create: `apps/web/lib/dnd.ts`

- [ ] **Step 1: Write `apps/web/lib/dnd.ts`**

```ts
// Typed drag-and-drop payloads carried on a custom MIME type so OS file drags
// (and other content) can never trigger our drop handlers. Both editor and
// Storyboard drops use this; handlers branch on `kind`.
export const DND_MIME = "application/x-artlio-asset";

export type DndPayload =
  | { kind: "editor-clip"; src: string; clipKind: "image" | "video"; seconds: number }
  | { kind: "candidate-frame"; generationId: string };

export function setDnd(dt: DataTransfer | null, p: DndPayload): void {
  if (!dt) return;
  dt.setData(DND_MIME, JSON.stringify(p));
  dt.effectAllowed = "copy";
}

export function getDnd(dt: DataTransfer | null): DndPayload | null {
  const raw = dt?.getData(DND_MIME);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as DndPayload;
    return v && (v.kind === "editor-clip" || v.kind === "candidate-frame") ? v : null;
  } catch {
    return null;
  }
}

/** True when a dragover event is carrying one of our payloads — call before
 *  preventDefault so we only accept our own drags, not arbitrary content. */
export function hasDnd(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(DND_MIME);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @artlio/web typecheck`
Expected: exit 0 (no errors).

---

## Task 2: Editor — drag an Assets item onto the timeline

**Files:**
- Modify: `apps/web/components/Editor.tsx`
  - import (top): add `import { setDnd, getDnd, hasDnd } from "@/lib/dnd";`
  - Assets item button (~line 432-444): add drag source attributes.
  - timeline container (the `<div … ref={timelineRef}>` at ~line 445-453): add drop target attributes + a highlight state.

- [ ] **Step 1: Write the failing Playwright check**

Create a throwaway script at repo root `._dnd-editor.mjs` (deleted after):

```js
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('http://localhost:3000/studio?view=editor', { waitUntil: 'networkidle', timeout: 30000 });
// count clips on track 0 before, drag the first Assets item onto the timeline, count after
const before = await p.locator('canvas').count(); // editor canvas present
const src = p.locator('aside [draggable="true"]').first();
const target = p.locator('[data-dnd="timeline"]').first();
await src.dragTo(target);
await p.waitForTimeout(1500);
console.log('editor canvas present:', before > 0, '| drag completed without error');
await b.close();
```

Run (needs `AUTH_ENABLED=false pnpm --filter @artlio/web dev` running): `node ._dnd-editor.mjs`
Expected: FAILS — `aside [draggable="true"]` / `[data-dnd="timeline"]` not found yet.

- [ ] **Step 2: Make the Assets item a drag source**

On the Assets item `<button key={m.id} onClick={() => appendAsset(m)} …>` add:

```tsx
draggable
onDragStart={(e) => setDnd(e.dataTransfer, { kind: "editor-clip", src: m.src, clipKind: m.kind, seconds: m.seconds })}
```

Keep `onClick={() => appendAsset(m)}` (non-drag path).

- [ ] **Step 3: Make the timeline container a drop target**

Add `const [dropping, setDropping] = useState(false);` near the other Editor state. On the timeline wrapper div (the one holding `ref={timelineRef}`), add a `data-dnd="timeline"` attribute and:

```tsx
data-dnd="timeline"
onDragOver={(e) => { if (hasDnd(e.dataTransfer)) { e.preventDefault(); setDropping(true); } }}
onDragLeave={() => setDropping(false)}
onDrop={(e) => {
  e.preventDefault(); setDropping(false);
  const payload = getDnd(e.dataTransfer);
  if (payload?.kind === "editor-clip" && handles.current) {
    void appendAsset({ id: "", src: payload.src, kind: payload.clipKind, seconds: payload.seconds });
  }
}}
style={{ /* keep existing styles; add: */ outline: dropping ? "2px dashed var(--accent, #6af)" : undefined }}
```

`appendAsset` already no-ops when `handles.current` is null or `status !== "ready"`, so an early drop is safe.

- [ ] **Step 4: Run the Playwright check (expect pass)**

Run: `node ._dnd-editor.mjs` then `rm ._dnd-editor.mjs`
Expected: PASS — drag source + target found, drag completes, no console error. (Manual confirm in the dev UI that the clip is appended.)

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @artlio/web typecheck && pnpm --filter @artlio/web lint`
Expected: both exit 0.

---

## Task 3: Storyboard — thread image candidates down + render the strip

**Files:**
- Modify: `apps/web/app/studio/page.tsx` — build `frameCandidates` from the existing `candidates` and pass it to `StudioShell`.
- Modify: `apps/web/components/studio/StudioShell.tsx` — accept `frameCandidates` and forward to `<Storyboard>`.
- Modify: `apps/web/components/studio/Storyboard.tsx` — accept `candidates` prop; render the sticky strip.

- [ ] **Step 1: Build the candidates DTO in `page.tsx`**

`page.tsx` already has `const candidates = await getCandidates(project.id);` (Generation rows with `.asset`). Below it add (deriving `src` the SAME way shot frame previews are built — reuse the existing storage-key→`/files/...` helper used for `shot.firstFrame.src`; locate it and call it here):

```ts
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const frameCandidates = candidates
  .filter((c) => IMG_EXTS.has(c.asset.ext.toLowerCase()))
  .map((c) => ({ id: c.id, src: fileUrlForAsset(c.asset) })); // fileUrlForAsset = the existing helper
```

Pass `frameCandidates={frameCandidates}` into the `<StudioShell … />` render (alongside `shots`/`entities`).

- [ ] **Step 2: Forward the prop in `StudioShell.tsx`**

Add `frameCandidates: { id: string; src: string }[]` to StudioShell's props type, and pass it to the Storyboard view render: `<Storyboard projectId={…} shots={…} entities={…} candidates={frameCandidates} />`.

- [ ] **Step 3: Accept the prop + render the strip in `Storyboard.tsx`**

Change the signature:

```tsx
export function Storyboard({ projectId, shots, entities, candidates }: {
  projectId: string; shots: StudioShot[]; entities: EntityDTO[];
  candidates: { id: string; src: string }[];
}) {
```

Import the helper: `import { setDnd } from "@/lib/dnd";`

At the top of the scrolling area (above the `scenes.map(...)`), render a sticky strip:

```tsx
{candidates.length > 0 && (
  <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", gap: 6, overflowX: "auto",
    padding: "8px 0", background: "var(--bg-1)", borderBottom: "1px solid var(--line-2)" }}>
    {candidates.map((c) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={c.id} src={c.src} alt="" draggable
        onDragStart={(e) => setDnd(e.dataTransfer, { kind: "candidate-frame", generationId: c.id })}
        title="Drag onto a shot's Start or End frame"
        style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 4, flex: "none", cursor: "grab", border: "1px solid var(--line-2)" }} />
    ))}
  </div>
)}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @artlio/web typecheck`
Expected: exit 0. (Strip renders but isn't a drop target yet — that's Task 4.)

---

## Task 4: Storyboard — frame slots accept the dropped candidate

**Files:**
- Modify: `apps/web/components/studio/Storyboard.tsx` — add `import { getDnd } from "@/lib/dnd";` (merge with the Task 3 import), and make each frame slot a drop target.

- [ ] **Step 1: Write the failing Playwright check**

Create `._dnd-frame.mjs` at repo root:

```js
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('http://localhost:3000/studio?view=storyboard', { waitUntil: 'networkidle', timeout: 30000 });
const cand = p.locator('[data-dnd="candidate"]').first();
const slot = p.locator('[data-dnd="slot-first"]').first();
await cand.dragTo(slot);
await p.waitForTimeout(2000);
await p.reload({ waitUntil: 'networkidle' });
// after reload the first shot's Start slot should show an image (firstFrame set + persisted)
const ok = await p.locator('[data-dnd="slot-first"] img').first().count();
console.log('frame persisted after reload:', ok > 0);
await b.close();
```

Run (dev server up, AUTH off): `node ._dnd-frame.mjs`
Expected: FAILS — `[data-dnd="candidate"]` / `[data-dnd="slot-first"]` not present.

- [ ] **Step 2: Tag the candidate thumbnails** (Task 3 strip) with `data-dnd="candidate"`.

- [ ] **Step 3: Make each frame slot a drop target**

On the slot container element (the per-slot media box that holds the `genFrame`/`uploadFrame`/`clearFrame` buttons; rendered once per `slot` of `"first" | "last"`), add `data-dnd={`slot-${slot}`}` and:

```tsx
onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-artlio-asset") && !busy && !slotBusy) { e.preventDefault(); setDropSlot(slot); } }}
onDragLeave={() => setDropSlot(null)}
onDrop={(e) => {
  e.preventDefault(); setDropSlot(null);
  const payload = getDnd(e.dataTransfer);
  if (payload?.kind !== "candidate-frame" || busy || slotBusy) return;
  setError(null); setSlotBusy(slot);
  (async () => {
    const r = await setShotFrame(shot.id, slot, payload.generationId);
    setSlotBusy(null);
    if (r && "error" in r) setError(r.error); else router.refresh();
  })();
}}
```

Add `const [dropSlot, setDropSlot] = useState<"first" | "last" | null>(null);` to the ShotCard state and apply a highlight (e.g. `outline` ) when `dropSlot === slot`. `setShotFrame` already rejects a non-image or cross-project generation, so a video candidate dropped here returns `{error}` (shown) and changes nothing — no extra client guard needed beyond the kind check.

- [ ] **Step 4: Run the Playwright check (expect pass)**

Run: `node ._dnd-frame.mjs` then `rm ._dnd-frame.mjs`
Expected: PASS — after dropping a candidate on the Start slot and reloading, the slot shows the image (proves `setShotFrame` ran and persisted). Generate/upload buttons still work (manual confirm).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @artlio/web typecheck && pnpm --filter @artlio/web lint`
Expected: both exit 0.

---

## Task 5: Verify + review (no deploy without approval)

- [ ] **Step 1: Full verification**

Run: `pnpm --filter @artlio/core build && pnpm -r typecheck && pnpm --filter @artlio/web lint && pnpm --filter @artlio/core test`
Expected: all green (core build clean, all packages typecheck, web lint clean, 47 core tests pass).

- [ ] **Step 2: Codex review (house rule, before any deploy)**

Run a `/codex review` over the working-tree diff focused on the DnD wiring (payload handling, the two drop handlers, money-safety = no spend, frame-slot image-only relying on `setShotFrame`). Address [P1]/[P2]; converge.

- [ ] **Step 3: Stop for the user**

Do NOT commit, push, or deploy automatically (house rule). Report green status + Codex result, then ask the user whether to commit (logical commit on master) and deploy web.

---

## Self-review (against the spec)

- **Spec coverage:** ① editor asset→timeline = Task 2; ② Storyboard candidates strip = Task 3, frame-slot drop = Task 4; shared `lib/dnd.ts` = Task 1; reuse `appendAsset`/`setShotFrame` = Tasks 2/4; no new action/migration = confirmed (no such tasks); money-safety/image-only/ownership = `setShotFrame` server checks (Task 4 note); non-drag fallback kept (Tasks 2/4 keep click/buttons); drop highlight = Tasks 2/4 (`dropping`/`dropSlot`); custom-MIME guard = Task 1 (`DND_MIME`/`hasDnd`). All spec sections map to a task.
- **Placeholder scan:** one deliberate lookup — `fileUrlForAsset` in Task 3 Step 1 is "the existing storage-key→/files helper used for shot frame previews"; the executor must locate and use the real helper (do not invent a new URL scheme). Everything else is concrete.
- **Type consistency:** `DndPayload` kinds (`editor-clip`, `candidate-frame`), `setDnd/getDnd/hasDnd`, `setShotFrame(shotId, slot, generationId)`, `appendAsset(EditorClip)` are used consistently across tasks.
