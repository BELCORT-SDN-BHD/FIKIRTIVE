# Otto Generation Trust — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Otto plan card reflect the *real* generation outcome — working, done, or failed — so it never freezes on "On it" or reverts to a pay button, and a failed generation shows an honest "didn't come through, you weren't charged, try again (won't charge twice)" card.

**Architecture:** The worker already posts a durable `TURN_ERROR` message (carrying `genJobId`) and refunds the hold on failure ([apps/worker/src/jobs/gen.ts:145-157](../../../apps/worker/src/jobs/gen.ts)). The client already polls and injects those messages. The fix is purely client state: derive the card's lifecycle state from the messages that already flow (a card's `genJobId` having a `GEN_RESULT` → done, a `TURN_ERROR` → failed, neither → working), via a new pure helper in `otto-inject-helpers.ts`, then render a `failed` state with an idempotency-safe retry. No worker, billing, reserve/settle, or refund logic changes.

**Tech Stack:** Next.js (App Router) + React client components, TypeScript, Vitest. Server actions in `apps/web/lib/*`. Pure UI-state helpers in `apps/web/lib/otto-inject-helpers.ts` (unit-tested in `apps/web/lib/__tests__/otto-inject-helpers.test.ts`).

## Global Constraints

- **No money-logic change.** Do NOT touch reserve/settle/refund/charge code. The failed-card "you weren't charged" copy relies on the EXISTING worker refund (`failClosedWithRefund`), not new code. (Founder rule 2026-06-26: money fixes = display/copy/state only.)
- **Unit is credits, never dollars.** Any cost text uses credits (see `apps/web/lib/credit-format.ts` → `creditsLabel`).
- **Retry must be idempotency-safe and say so.** Retry re-invokes `coworkGenerate({ cardId, ... })`; the `cowork:<cardId>` key guarantees at-most-once-ever charge ([cowork-actions.ts:492](../../../apps/web/lib/cowork-actions.ts)). Retry copy must state it won't charge twice.
- **Honesty:** the card never shows a state it can't verify from data. "Working" only while no terminal message exists; "failed" only when a `TURN_ERROR` for this `genJobId` exists.
- **Both chat surfaces:** changes to `OttoPlanCard` are shared, but `OttoChatStream` (founder/streaming) and `OttoConversation` (merchant/non-stream) each pass props — update BOTH call sites.
- **Test command:** `pnpm --filter @fikirtive/web exec vitest run <path>` (sandbox lacks `DATABASE_URL`; the targeted pure-helper test does not need a DB).

---

## File Structure

- `apps/web/lib/otto-inject-helpers.ts` — **add** `errorJobIds()` and `deriveCardState()` pure helpers (siblings of existing `resultJobIds`/`hasWorkingJob`). One responsibility: derive UI state from the message list.
- `apps/web/lib/__tests__/otto-inject-helpers.test.ts` — **add** unit tests for the two new helpers.
- `apps/web/components/otto/OttoPlanCard.tsx` — **modify** to render four states (`idle`/`working`/`done`/`failed`) from a `cardState` prop instead of the optimistic local `done` boolean; add the failed card + retry button.
- `apps/web/components/otto/OttoChatStream.tsx` — **modify** the `OttoPlanCard` call site: compute `jobsWithError`, pass `cardState` + `onRetry`.
- `apps/web/components/otto/OttoConversation.tsx` — **modify** the parallel `OttoPlanCard` call site identically.

---

### Task 1: `errorJobIds` helper — which genJobIds failed

**Files:**
- Modify: `apps/web/lib/otto-inject-helpers.ts` (add next to `resultJobIds`, ~line 24)
- Test: `apps/web/lib/__tests__/otto-inject-helpers.test.ts`

**Interfaces:**
- Consumes: `OttoUiMessage[]` (existing; each durable message has `metadata?: { kind?, genJobId?, durableId, payload }`).
- Produces: `errorJobIds(messages: OttoUiMessage[]): Set<string>` — genJobIds that have a durable `TURN_ERROR`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/__tests__/otto-inject-helpers.test.ts` (follow the existing `resultJobIds` test's message-builder pattern in that file):

```ts
import { errorJobIds } from "../otto-inject-helpers";

function msg(kind: string, genJobId: string | null) {
  return { id: genJobId ?? kind, role: "assistant", parts: [],
    metadata: { kind, genJobId, durableId: genJobId ?? kind, payload: {} } } as any;
}

it("errorJobIds collects genJobIds with a TURN_ERROR", () => {
  const messages = [msg("GEN_CARD", "j1"), msg("TURN_ERROR", "j1"), msg("GEN_RESULT", "j2")];
  const ids = errorJobIds(messages);
  expect(ids.has("j1")).toBe(true);
  expect(ids.has("j2")).toBe(false);
  expect(ids.size).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-inject-helpers.test.ts -t "errorJobIds"`
Expected: FAIL — `errorJobIds is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/lib/otto-inject-helpers.ts`, directly below `resultJobIds` (mirror it, swapping the kind):

```ts
/** The genJobIds that have a durable TURN_ERROR — so the card can show a failed state. */
export function errorJobIds(messages: OttoUiMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    const meta = m.metadata;
    if (meta?.kind === "TURN_ERROR" && meta.genJobId) ids.add(meta.genJobId);
  }
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-inject-helpers.test.ts -t "errorJobIds"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/otto-inject-helpers.ts apps/web/lib/__tests__/otto-inject-helpers.test.ts
git commit -m "feat(otto): errorJobIds helper — genJobIds with a TURN_ERROR"
```

---

### Task 2: `deriveCardState` helper — the card's lifecycle from data

**Files:**
- Modify: `apps/web/lib/otto-inject-helpers.ts`
- Test: `apps/web/lib/__tests__/otto-inject-helpers.test.ts`

**Interfaces:**
- Consumes: `errorJobIds` (Task 1), existing `resultJobIds`.
- Produces:
  ```ts
  export type CardState = "idle" | "working" | "done" | "failed";
  export function deriveCardState(args: {
    genJobId: string | null;   // durable card → its job (null until "Make it" succeeds)
    submitted: boolean;        // local: approve() returned success this session
    results: Set<string>;      // resultJobIds(messages)
    errors: Set<string>;       // errorJobIds(messages)
  }): CardState
  ```
- Rules (in order): failed if `genJobId && errors.has(genJobId)`; done if `genJobId && results.has(genJobId)`; working if `genJobId || submitted`; else idle. (Once approved, never `idle` again this session → never reverts to a pay button.)

- [ ] **Step 1: Write the failing test**

```ts
import { deriveCardState } from "../otto-inject-helpers";
const S = (a: string[]) => new Set(a);

it("deriveCardState: idle before approval", () => {
  expect(deriveCardState({ genJobId: null, submitted: false, results: S([]), errors: S([]) })).toBe("idle");
});
it("deriveCardState: working after approve even before genJobId lands", () => {
  expect(deriveCardState({ genJobId: null, submitted: true, results: S([]), errors: S([]) })).toBe("working");
});
it("deriveCardState: working while job runs", () => {
  expect(deriveCardState({ genJobId: "j1", submitted: true, results: S([]), errors: S([]) })).toBe("working");
});
it("deriveCardState: done when result landed", () => {
  expect(deriveCardState({ genJobId: "j1", submitted: false, results: S(["j1"]), errors: S([]) })).toBe("done");
});
it("deriveCardState: failed when TURN_ERROR landed (beats working)", () => {
  expect(deriveCardState({ genJobId: "j1", submitted: true, results: S([]), errors: S(["j1"]) })).toBe("failed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-inject-helpers.test.ts -t "deriveCardState"`
Expected: FAIL — `deriveCardState is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/lib/otto-inject-helpers.ts`:

```ts
export type CardState = "idle" | "working" | "done" | "failed";

/** The plan card's lifecycle derived from durable data (never optimistic-only).
 *  Order matters: a terminal result/error always wins over "working". */
export function deriveCardState(args: {
  genJobId: string | null;
  submitted: boolean;
  results: Set<string>;
  errors: Set<string>;
}): CardState {
  const { genJobId, submitted, results, errors } = args;
  if (genJobId && errors.has(genJobId)) return "failed";
  if (genJobId && results.has(genJobId)) return "done";
  if (genJobId || submitted) return "working";
  return "idle";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-inject-helpers.test.ts -t "deriveCardState"`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/otto-inject-helpers.ts apps/web/lib/__tests__/otto-inject-helpers.test.ts
git commit -m "feat(otto): deriveCardState — card lifecycle from durable data"
```

---

### Task 3: OttoPlanCard renders the four states + honest failed card

**Files:**
- Modify: `apps/web/components/otto/OttoPlanCard.tsx`

**Interfaces:**
- Consumes: a new prop `cardState: CardState` and `onRetry: () => void` (replacing the optimistic `alreadyGenerated`/`hasDurableResult`/`done` rendering for the post-approval states). Keep `pendingApproval`, `approve()` for the `idle` → submit transition.
- Produces: a card UI that shows `idle` (Make it/Change), `working` ("Otto is making this…"), `done` (handled by the separate result widget — card shows a quiet ✓), `failed` (honest message + retry).

- [ ] **Step 1: Add the prop + import**

In `OttoPlanCard.tsx`, add to imports:
```ts
import type { CardState } from "@/lib/otto-inject-helpers";
```
Add to `OttoPlanCardProps`:
```ts
  cardState: CardState;
  onRetry: () => void;
```
Keep `creditsLabel` import and the `credits` computation from PR 1.

- [ ] **Step 2: Replace the settled/optimistic block**

Replace the current `settled ? (…) : (…)` block (the `✓ On it — making this now.` line and the Make it/Change buttons, ~lines 112-125) with a state switch. Keep the credit line and trust line above/below as in PR 1. New body:

```tsx
{cardState === "failed" ? (
  <div style={{ marginTop: "var(--space-4)" }}>
    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-strong)", fontWeight: 600 }}>
      😕 This one didn&rsquo;t come through — and you weren&rsquo;t charged.
    </div>
    <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
      <Button variant="primary" size="md" disabled={busy} onClick={onRetry}>
        {busy ? "Starting…" : "↻ Try again"}
      </Button>
      <Button variant="secondary" size="md" disabled={busy} onClick={onChangeSomething}>
        Change something
      </Button>
    </div>
    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", marginTop: 6 }}>
      Retrying this won&rsquo;t charge you twice.
    </div>
  </div>
) : cardState === "working" || cardState === "done" ? (
  <div style={{ marginTop: "var(--space-4)", fontSize: "var(--text-sm)", color: "var(--success-700)", fontWeight: 600 }}>
    {cardState === "done" ? "✓ Done" : "✓ On it — making this now."}
  </div>
) : (
  <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
    <Button variant="primary" size="md" disabled={busy} onClick={approve}>
      {busy ? "Starting…" : `Make it · ${creditsLabel(credits)}`}
    </Button>
    <Button variant="secondary" size="md" disabled={busy} onClick={onChangeSomething}>
      Change something
    </Button>
  </div>
)}
```

- [ ] **Step 3: Make `approve()` not falsely claim success**

In `approve()`, after the `coworkGenerate`/`ottoApprove` call: only set the local submitted flag when the result is a real success. Replace the existing `setDone(true)` with a callback to the parent that records submission AND re-polls (the parent owns submitted state now — see Task 4). Minimal: keep a local `setSubmitted(true)` only when `res` has no `error`; the parent's `onApproved` already re-polls. Remove the now-unused local `done`/`settled`/`alreadyGenerated`/`hasDurableResult` props and state (they're superseded by `cardState`).

- [ ] **Step 4: Verify it compiles (typecheck the otto package-adjacent types)**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-inject-helpers.test.ts`
Expected: PASS (helpers unchanged). Then a visual check in Task 5's manual step.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/otto/OttoPlanCard.tsx
git commit -m "feat(otto): plan card renders working/done/failed from cardState + honest retry"
```

---

### Task 4: Wire OttoChatStream + OttoConversation to drive the card from data

**Files:**
- Modify: `apps/web/components/otto/OttoChatStream.tsx` (the `GEN_CARD` render, ~lines 345-376)
- Modify: `apps/web/components/otto/OttoConversation.tsx` (parallel `OttoPlanCard` render, ~lines 430-445)

**Interfaces:**
- Consumes: `deriveCardState`, `errorJobIds`, existing `resultJobIds`.
- Produces: each `OttoPlanCard` gets `cardState` + `onRetry`; the per-card local "submitted" is tracked in the existing `pendingApprovalCardIds`-style set (add a `submittedCardIds` set) so it survives re-render but resets on remount (genJobId then carries it).

- [ ] **Step 1: Compute the error set + a submitted set**

In `OttoChatStream.tsx`, near `const jobsWithResult = resultJobIds(messages);` add:
```ts
import { errorJobIds, deriveCardState } from "@/lib/otto-inject-helpers";
// …
const jobsWithError = errorJobIds(messages);
const [submittedCardIds, setSubmittedCardIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Pass cardState + onRetry into OttoPlanCard**

In the `kind === "GEN_CARD"` branch, replace `alreadyGenerated`/`hasDurableResult` props with:
```tsx
cardState={deriveCardState({
  genJobId: m.metadata?.genJobId ?? null,
  submitted: submittedCardIds.has(m.metadata!.durableId),
  results: jobsWithResult,
  errors: jobsWithError,
})}
onRetry={() => {
  const p = (m.metadata?.payload ?? {}) as { structuredPrompt?: string; entityIds?: string[]; variantSel?: Record<string,string> };
  void coworkGenerate({
    cardId: m.metadata!.durableId,
    prompt: p.structuredPrompt ?? "",
    entityIds: Array.isArray(p.entityIds) ? p.entityIds : [],
    variantSel: p.variantSel && typeof p.variantSel === "object" ? p.variantSel : {},
  }).then(() => { setPollGaveUp(false); pollCountRef.current = 0; void pollAndInjectResults(); });
}}
```
In the existing `onApproved` callback, also record submission:
```ts
setSubmittedCardIds((cur) => new Set(cur).add(m.metadata!.durableId));
```
Remove the now-unused `alreadyGenerated`/`hasDurableResult` props.

- [ ] **Step 3: Mirror in OttoConversation.tsx**

Apply the identical prop changes at its `OttoPlanCard` render (it imports the same helpers; add `errorJobIds`/`deriveCardState` import and a `submittedCardIds` state the same way). Use its existing `resultJobIds`/message variable names.

- [ ] **Step 4: Manual verification (no component-test harness exists)**

Run the app and drive a generation to failure (or temporarily force the worker to `failClosedWithRefund`). Expected: while running the card shows "On it — making this now" with NO Make-it button; when the `TURN_ERROR` lands the card flips to "😕 This one didn't come through — and you weren't charged" with a "↻ Try again" button + "won't charge you twice"; clicking retry does not double-charge (balance unchanged) and re-enters working. Reloading mid-run keeps the card in working/failed (driven by genJobId), never back to a pay button.
Also run the helper tests once more:
Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-inject-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/otto/OttoChatStream.tsx apps/web/components/otto/OttoConversation.tsx
git commit -m "feat(otto): drive plan card from real job state (working/done/failed) in both chat paths"
```

---

## Out of scope (next plan)

- **Otto's own speech honesty** (inject live GenJob status into `OttoContext` + honesty/boundary rules in `instructions.ts`; stop "Not stuck at all" / the non-existent "Generate" button) — that touches the agent/prompt subsystem (audit P0-7 agent half, HON-1/2/4). Separate plan.
- **Transparent multi-stage progress + ETA** (queued→generating→uploading on the card) — needs the worker to surface stage/progress; separate plan.
- **QUEUED-never-claimed reaper** (audit P0-11 / gated G3 — touches the refund path). Gated on founder OK.

---

## Self-Review

- **Spec coverage:** Implements the trustworthy-core "status-grounded honesty" rule for the CARD (contract rule #3): failed → honest + you-weren't-charged + safe retry; never a frozen/reverting card. Agent-speech honesty + transparent progress are explicitly carved out to the next plan. ✓
- **Placeholder scan:** No TBD/TODO; every step has concrete code or an exact command. ✓
- **Type consistency:** `CardState` defined in Task 2 and imported in Tasks 3-4; `errorJobIds`/`deriveCardState` signatures match across tasks; `coworkGenerate` arg shape matches [cowork-actions.ts:492](../../../apps/web/lib/cowork-actions.ts) and the existing OttoPlanCard call. ✓
- **Money safety:** No reserve/settle/refund/charge code touched; failed-card copy relies on the existing worker refund; retry is `cowork:<cardId>` idempotency-safe. ✓
