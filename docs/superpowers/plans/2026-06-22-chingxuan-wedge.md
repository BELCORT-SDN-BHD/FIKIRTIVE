# ChingXuan Wedge (v0) — Agentic Otto Product Video + Performance Capture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one beta merchant (ChingXuan) **talk to Otto** and get an on-brand short product video — by referencing her product (and optionally a scene/brand), composing an on-brand image, then animating it (i2v) — and record whether she posted it + a one-line result, so the performance loop starts at video #1.

**Architecture:** REUSE the **existing, end-to-end Otto/Cowork conversational i2v loop** (verified working: `coworkTurn` → forced video proposal → `coworkGenerate` → `startGen` → worker `appendCoworkResult`). The new work is THIN: (1) a merchant **Simple Mode** UX over Cowork/GenerateCard (hide the model/param cockpit; cheap-model default), (2) an append-only **performance signal** via `ActionEvent` (no migration), (3) **onboard** her via the allowlist, (4) optional on-brand polish. **Zero new backend for the agentic loop or for video gen.**

**Multi-reference policy (verified constraint):** IMAGE gen supports up to 8 references (built). VIDEO models (all 14 FAL endpoints) accept only ONE start frame (+ optional end) — native multi-conditioning of the video model is **provider-blocked today**, so we do NOT attempt it. Multi-reference video = the pro pattern: **compose a multi-ref IMAGE (works) → Animate it (works).** Both already exist in the Otto loop.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Prisma 7, vitest.

## Global Constraints

- **Money-safety (spend path):** the ONLY spend gate is `startGen`/`coworkGenerate` → `reserveCredits` (atomic, idempotent on `idempotencyKey`). Simple Mode MUST default to a **cheap** video model — NEVER Veo/Kling-3. Video count stays clamped to 1 (already enforced at `cowork-actions.ts:555`). This touches money → run the repo's money-safety review on Task 2 before merge.
- **Tenancy:** every server action starts `const gate = await requireOwner(); if ("error" in gate) return gate;`, scopes all queries by `ownerId`.
- **Append-only:** performance signals go through `ActionEvent` (never mutate `Generation` outside its `shotId/version/attachedAt/deletedAt` whitelist).
- **No new migration** required (`ActionEvent.payload` is `Json`). The optional Brand-Kit polish (Task 4) is the only thing that *could* add fields — it is explicitly OUT of v0.
- **Do NOT** attempt native video multi-conditioning (provider-blocked), build the Otto front-door flip, URL scrape, ad-pack orchestrator, plan/tier, or full Brand Kit. Those are PRD Phase 1+, decided by her data.
- **Next 16 is not the Next.js you know** — read `node_modules/next/dist/docs/` before UI work (per `apps/web/AGENTS.md`).

---

### Task 1: Performance-signal capture — `recordGenerationOutcome` + `getRecentOutcomes`

The moat-from-day-1 piece. Append-only "posted + result" on an owned Generation. Mirrors `attachGeneration` (`apps/web/lib/actions.ts:516`).

**Files:**
- Modify: `apps/web/lib/actions.ts` (add the action; reuse file-private `logAction` at `actions.ts:46`)
- Modify: `apps/web/lib/data.ts` (add the read)
- Test: `apps/web/lib/__tests__/record-outcome.test.ts` (new)

**Interfaces:**
- Consumes: `requireOwner()` (auth-guard.ts:49); `logAction(ownerId, type, projectId, payload?)` (actions.ts:46); `prisma`.
- Produces: `recordGenerationOutcome(generationId: string, posted: boolean, result: string): Promise<{ ok: true } | { error: string }>`; `getRecentOutcomes(): Promise<Array<{ generationId, posted, result, at }>>`

- [ ] **Step 1: Write the failing test** — `apps/web/lib/__tests__/record-outcome.test.ts`, using the SAME mock harness as `apps/web/lib/__tests__/tenant-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/auth-guard", () => ({ requireOwner: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: {
  generation: { findFirst: vi.fn() },
  actionEvent: { create: vi.fn(), findMany: vi.fn() },
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { recordGenerationOutcome } from "@/lib/actions";
import { getRecentOutcomes } from "@/lib/data";
import { requireOwner } from "@/lib/auth-guard";
import { prisma } from "@fikirtive/db";
beforeEach(() => vi.clearAllMocks());

describe("recordGenerationOutcome", () => {
  it("fails closed with no owner", async () => {
    (requireOwner as any).mockResolvedValue({ error: "Not signed in." });
    expect(await recordGenerationOutcome("g1", true, "x")).toEqual({ error: "Not signed in." });
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
  });
  it("rejects a generation the caller does not own", async () => {
    (requireOwner as any).mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
    (prisma.generation.findFirst as any).mockResolvedValue(null);
    expect(await recordGenerationOutcome("g1", true, "x")).toEqual({ error: "Generation not found." });
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
  });
  it("logs an append-only outcome for an owned generation", async () => {
    (requireOwner as any).mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
    (prisma.generation.findFirst as any).mockResolvedValue({ id: "g1", projectId: "p1" });
    expect(await recordGenerationOutcome("g1", true, "  sold better  ")).toEqual({ ok: true });
    const arg = (prisma.actionEvent.create as any).mock.calls[0][0].data;
    expect(arg).toMatchObject({ ownerId: "o1", type: "generation.outcome", projectId: "p1" });
    expect(arg.payload).toMatchObject({ generationId: "g1", posted: true, result: "sold better" });
  });
});

describe("getRecentOutcomes", () => {
  it("returns this owner's outcomes newest-first", async () => {
    (requireOwner as any).mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
    (prisma.actionEvent.findMany as any).mockResolvedValue([
      { payload: { generationId: "g2", posted: true, result: "great" }, createdAt: new Date("2026-06-22T02:00:00Z") },
    ]);
    const r = await getRecentOutcomes();
    expect(r[0]).toMatchObject({ generationId: "g2", posted: true, result: "great" });
    expect((prisma.actionEvent.findMany as any).mock.calls[0][0].where).toMatchObject({ ownerId: "o1", type: "generation.outcome" });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `pnpm --filter web test record-outcome` → FAIL (not exported).

- [ ] **Step 3: Implement** — add to `apps/web/lib/actions.ts` after `attachGeneration`:

```ts
/** Append-only performance signal on a generated video. Generation is immutable
 *  (whitelist only) → record via ActionEvent. Read back by agent / Brand Brain. */
export async function recordGenerationOutcome(generationId: string, posted: boolean, result: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const clean = result.trim().slice(0, 280);
  const gen = await prisma.generation.findFirst({
    where: { id: generationId, ownerId, deletedAt: null }, select: { id: true, projectId: true },
  });
  if (!gen) return { error: "Generation not found." };
  await logAction(ownerId, "generation.outcome", gen.projectId, { generationId, posted, result: clean });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

And to `apps/web/lib/data.ts`:

```ts
export async function getRecentOutcomes() {
  const gate = await requireOwner(); if ("error" in gate) return [];
  const { ownerId } = gate;
  const rows = await prisma.actionEvent.findMany({
    where: { ownerId, type: "generation.outcome" }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map((r) => {
    const p = (r.payload ?? {}) as { generationId?: string; posted?: boolean; result?: string };
    return { generationId: p.generationId ?? "", posted: !!p.posted, result: p.result ?? "", at: r.createdAt.toISOString() };
  });
}
```

- [ ] **Step 4: Run, confirm pass** — `pnpm --filter web test record-outcome` → PASS (4 tests).
- [ ] **Step 5: Typecheck + commit** — `pnpm -r typecheck` green, then:

```bash
git add apps/web/lib/actions.ts apps/web/lib/data.ts apps/web/lib/__tests__/record-outcome.test.ts
git commit -m "feat(beta): append-only generation outcome signal + founder read"
```

---

### Task 2: Otto "Simple Mode" — merchant-facing agentic surface

The existing Otto loop already does conversational i2v + multi-ref-image. The ONLY gap is power-user chrome. Add a Simple Mode that hides the model picker + params, defaults a cheap video model, and keeps chat + @mention (multi-ref) + Generate + Animate. **Spend touchpoint — money-safety review applies.**

**Files:**
- Modify: `apps/web/components/studio/GenerateCard.tsx` (gate the model picker + param pills behind a `simple` prop; `GenerateCard.tsx:324-408`)
- Modify: `apps/web/components/studio/Cowork.tsx` (a `simple` mode: hide studio chrome; render only chat + cards + Animate; `Cowork.tsx`)
- Modify: `apps/web/lib/cowork-actions.ts` (ensure the cheap default model is applied when the card omits a model — confirm `coworkGenerate` default; `cowork-actions.ts:467-581`)
- Possibly add: a `/m` route (`apps/web/app/m/page.tsx`) that mounts Cowork in `simple` mode against a get-or-create default project.

**Interfaces:**
- `coworkTurn(raw): Promise<{ threadId, brief? } | { error }>`, `coworkGenerate(raw): Promise<{ id } | { error }>` (cowork-actions.ts) — UNCHANGED, reused.
- `<GenerateCard simple />`, `<Cowork simple />` — new prop, default false (studio unchanged).

- [ ] **Step 1: Pick the cheap default video model (money-safety)** — read `packages/core/src/gen.ts` `GEN_VIDEO_MODELS` + `GEN_VIDEO_MODEL_OPTIONS`; choose the cheapest ad-acceptable model (confirm via `videoRateUsdPerSec`). Record the model + a valid `durationSeconds` + `aspectRatio: "9:16"` if supported. **Never Veo/Kling-3.**

- [ ] **Step 2: Apply the cheap default in `coworkGenerate`** — confirm that when the GEN_CARD/`coworkGenerateRequest.model` is absent, `coworkGenerate` uses the cheap default (not an expensive one). If it defaults to an expensive model, set the cheap default here. Add/extend a unit test in the style of the existing cowork tests asserting "video proposal with no explicit model → cheap model reaches startGen."

- [ ] **Step 3: Add `simple` prop to `GenerateCard.tsx`** — when `simple`, render only the prompt + a single Generate button (no model picker, no aspect/resolution/duration/audio pills). The card still carries the cheap default + sensible video params. Keep the existing non-simple path untouched.

- [ ] **Step 4: Add `simple` mode to `Cowork.tsx`** — hide thread-list/studio chrome; show a single thread: chat input (with @mention for multi-ref), the proposal cards (simple), generated images with an **Animate** button, and video results. Plain, beginner-friendly copy.

- [ ] **Step 5: Mount it at `/m`** — `apps/web/app/m/page.tsx` resolves a get-or-create default project (add `getOrCreateDefaultProject()` to `actions.ts` if none exists; owner-scoped, idempotent on name "My Videos") and renders `<Cowork simple projectId={...} />`. Behind the existing closed-beta auth wall.

- [ ] **Step 6: Verify by running** — sign in (allowlisted), go to `/m`: type "make a video of this" with a product photo, confirm Otto proposes a video on the **cheap** model, Generate, a clip comes back, and credits were reserved. Confirm multi-ref works: @mention product + a scene → image → Animate → video.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/studio/GenerateCard.tsx apps/web/components/studio/Cowork.tsx apps/web/lib/cowork-actions.ts apps/web/app/m/page.tsx apps/web/lib/actions.ts
git commit -m "feat(beta): Otto Simple Mode for non-technical merchants (cheap-model default)"
```

---

### Task 3: Capture the loop on the Otto video result

A one-tap "posted + result" on every video result in Simple Mode, wiring Task 1.

**Files:**
- Create: `apps/web/components/studio/PostedResult.tsx`
- Modify: `apps/web/components/studio/Cowork.tsx` (render it under each GEN_RESULT video; `Cowork.tsx:407-409`)

- [ ] **Step 1: Build the control** — `PostedResult.tsx`:

```tsx
"use client";
import { useState } from "react";
import { recordGenerationOutcome } from "@/lib/actions";
export function PostedResult({ generationId }: { generationId: string }) {
  const [done, setDone] = useState(false); const [result, setResult] = useState("");
  if (done) return <p className="text-sm text-mute">Thanks — logged.</p>;
  return (
    <div className="flex flex-col gap-2">
      <input value={result} maxLength={280} onChange={(e) => setResult(e.target.value)}
        placeholder="Did it sell? e.g. 'more orders than usual'" />
      <div className="flex gap-2">
        <button onClick={async () => { await recordGenerationOutcome(generationId, true, result); setDone(true); }}>I posted this</button>
        <button onClick={async () => { await recordGenerationOutcome(generationId, false, result); setDone(true); }}>Didn't post</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render under each video result in `Cowork.tsx`** — the GEN_RESULT payload carries `generationIds` (worker `appendCoworkResult`, gen.ts:118); render `<PostedResult generationId={payload.generationIds[0]} />` under the `<video>` (Cowork.tsx:407-409).

- [ ] **Step 3: Verify** — make a video → "I posted this" + note → confirm an `ActionEvent` (`type='generation.outcome'`) exists and `getRecentOutcomes()` returns it.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/studio/PostedResult.tsx apps/web/components/studio/Cowork.tsx
git commit -m "feat(beta): one-tap posted+result capture on Otto video results"
```

---

### Task 4 (OPTIONAL — only if time): On-brand polish

Otto's planner already injects `Project.coworkBrief` into proposals (verified, cowork-planner.ts:52). Two small wins; skip if it costs the week.

**Files:** `apps/web/lib/cowork-actions.ts`, `apps/worker/src/jobs/gen.ts`, possibly `schema.prisma` (default-entity field).

- [ ] **Option A (S): default hero entity** — let the merchant mark ONE product Entity as default so Otto auto-includes it in every proposal's `entityIds` unless omitted. (Add `Project.defaultEntityId` or `Entity.isDefault`; check in `coworkTurn`.) This is the only thing here that would need an additive migration.
- [ ] **Option B (M): brief at gen time** — have the worker (`handleGen`) read `Project.coworkBrief` and append it to the generation prompt (today only the proposal sees the brief; the structuredPrompt already encodes it, so this is belt-and-suspenders).

Defer both unless Tasks 1–3 + 5 are done and there's slack. Full Brand Kit (logo/palette/tone) is explicitly OUT (PRD Phase 3).

---

### Task 5: Onboard ChingXuan (access) + document

**Files:** `docs/closed-beta-env-checklist.md` (doc); allowlist action (no code if `inviteTenant` exists).

- [ ] **Step 1: Allowlist her email** — via `apps/web/lib/allowlist.ts` path (`inviteTenant(email)` → DB `AllowedEmail` row, LOWERCASED, revocable; preferred over env). Founder supplies the real email.
- [ ] **Step 2: Verify onboarding** — she signs in → `requireOwner()` bootstraps `org_<userId>` + 1000 displayed beta credits (`spend.ts:93`); confirm her org + credit account exist and are isolated from the founder org.
- [ ] **Step 3: Document + commit** — add to `docs/closed-beta-env-checklist.md`: "Invite a beta merchant: `inviteTenant(<email>)` → sign in → org + 1000 credits auto-bootstrap → `/m`."

```bash
git add docs/closed-beta-env-checklist.md
git commit -m "docs(beta): how to invite a beta merchant"
```

---

## Self-Review

- **Spec coverage:** agentic Otto video (existing, Task 2 simplifies UX) ✓ · multi-ref via compose-image→animate (existing; native video multi-ref correctly excluded as provider-blocked) ✓ · cheap-model margin firewall (Task 2 Step 1-2) ✓ · performance capture (Tasks 1, 3) ✓ · founder visibility (Task 1 read) ✓ · on-brand (brief already wired; polish optional Task 4) ✓ · onboard (Task 5) ✓.
- **Money-safety:** only spend is the existing `coworkGenerate`/`startGen`; Task 2 adds a cheap default + keeps video count 1. Run money-safety review on Task 2.
- **No new backend for the agent loop or video gen** — verified end-to-end working today. New code = 1 outcome action + 1 read + Simple-Mode UI + 1 capture control + onboarding.
- **Honest constraint recorded:** native video multi-conditioning is provider-blocked (FAL video = 1 frame); multi-ref = compose image then animate. If the founder wants this researched, it is a separate spike — do not assume it's achievable.
