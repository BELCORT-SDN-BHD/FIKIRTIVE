# Otto whole-clip reference video (整段视频参考 v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a user attach a whole video in the Otto composer and have Seedance 2.0 use it as a `reference_video` (motion/style/edit/extend via prompt), on a new `referenceVideoGenerationId` field parallel to the image `sourceGenerationId`.

**Architecture:** New `referenceVideoGenerationId` travels composer → `coworkTurnRequest` → `OttoContext` → propose card (video-plans only) → `genRequest` → `startGen` → a new `GenJob` column → worker resolves it to a presigned video URL → `BytePlusProvider.generateVideo` emits a `{type:"video_url", role:"reference_video"}` content part. The image `sourceGenerationId` path and its 4 image-ext validators are untouched — the new field gets its own video-ext validators.

**Tech Stack:** TypeScript, zod, Prisma, vitest, pnpm workspaces (`@fikirtive/core`, `@fikirtive/otto`, `@fikirtive/generation`, `@fikirtive/db`, `apps/web`, `apps/worker`), BytePlus Ark.

## Global Constraints

- **Money path.** Touched by Tasks 1,3,4,5 (`genRequest`, `startGen`, `GenJob`, worker resolve, provider call). **Run `money-safety-review` on the full diff before merge (Task 8).** Invariants that MUST hold: `pricedGenCredits`/reserve/settle/dedup **unchanged**; charge stays `seedance-2-fast` flat 720p=7cr keyed off kind+model+resolution (reference video does NOT change the price); `genRequest` stays `.strict()` with `idempotencyKey` required.
- **Do NOT widen the 4 image-ext validators** (the `sourceGenerationId` gates). The new field gets its OWN video-ext validators (`mp4/mov/webm`).
- **New field is `referenceVideoGenerationId`** everywhere (never overload `sourceGenerationId`). Video ext set = `["mp4","mov","webm"]`.
- **Input clip length cap: 2–10 seconds** (client-validated). Constant `REF_VIDEO_MAX_SECONDS = 10`, `REF_VIDEO_MIN_SECONDS = 2`.
- **Reference video only affects `kind:"video"` plans** — ignored for image plans (mirror the `isI2V` gate).
- **Worker is fail-closed:** reference video set-but-unresolvable → `failClosedWithRefund` (mirror i2v source), never spend.
- **BytePlus only.** `FalProvider.generateVideo` must reject `refVideoUrl` (throw pre-spend), never silently drop it.
- **Ark param is documented but not yet API-verified** — Task 8 includes a founder-gated paid test; do not first-real-gen before it.
- **Custom Next.js** (`apps/web/AGENTS.md`): Tasks touching `apps/web` are server actions / a client component — no new Next APIs.
- Ships on branch `claude/otto-reference-video` (off prod `c4c635f`).

---

### Task 1: Core contracts — `referenceVideoGenerationId` through the pure layer

**Files:**
- Modify: `packages/core/src/gen.ts` (`genRequest`, ~line 172)
- Modify: `packages/core/src/cowork.ts` (`coworkTurnRequest`, ~line 55)
- Modify: `packages/core/src/refgen.ts` (`VideoRequest`, ~line 107)
- Modify: `packages/core/src/gen-from-card.ts` (`buildGenRequestFromCard`, ~line 60/83)
- Test: `packages/core/src/cowork.test.ts`, `packages/core/src/gen-from-card.test.ts` (create if absent)

**Interfaces:**
- Produces: `genRequest.referenceVideoGenerationId?: string | null`; `CoworkTurnRequest.referenceVideoGenerationId?: string`; `VideoRequest.refVideoUrl?: string`; `buildGenRequestFromCard` threads `referenceVideoGenerationId` from card payload into the req.

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/cowork.test.ts`:

```ts
describe("coworkTurnRequest referenceVideoGenerationId", () => {
  const base = { projectId: "p", text: "hi" };
  it("accepts a bounded referenceVideoGenerationId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationId: "gen_vid" });
    expect(r.success && r.data.referenceVideoGenerationId).toBe("gen_vid");
  });
  it("rejects an over-length referenceVideoGenerationId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationId: "x".repeat(65) });
    expect(r.success).toBe(false);
  });
});
```

Create `packages/core/src/gen-from-card.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildGenRequestFromCard } from "./gen-from-card.js";

const baseArgs = {
  projectId: "p", threadId: "t", cardId: "c", prompt: "make it move",
  entityIds: [], variantSel: {},
};

it("threads referenceVideoGenerationId from a video card payload", () => {
  const r = buildGenRequestFromCard({
    ...baseArgs,
    cardPayload: { kind: "video", model: "seedance-2-fast", structuredPrompt: "x", params: {}, referenceVideoGenerationId: "gen_vid" },
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.req.referenceVideoGenerationId).toBe("gen_vid");
});

it("omits referenceVideoGenerationId when the card has none", () => {
  const r = buildGenRequestFromCard({
    ...baseArgs,
    cardPayload: { kind: "video", model: "seedance-2-fast", structuredPrompt: "x", params: {} },
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect("referenceVideoGenerationId" in r.req).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @fikirtive/core exec vitest run src/cowork.test.ts src/gen-from-card.test.ts`
Expected: FAIL (field not accepted / not threaded).

- [ ] **Step 3: Implement**

In `packages/core/src/gen.ts`, add to the `genRequest` object right after the `tailGenerationId` line (~174):

```ts
    // whole-clip reference video (Seedance 2.0 reference_video). Server-validated
    // owner+project+video-ext, like sourceGenerationId. Only used by video plans.
    referenceVideoGenerationId: z.string().min(1).max(64).nullish(),
```

In `packages/core/src/cowork.ts`, add to `coworkTurnRequest` right after the `sourceGenerationId` field (~55):

```ts
  // whole-clip reference video (整段视频参考). Server-TRUSTED: re-validated owned +
  // in-project + video-ext before use; invalid/foreign/deleted id silently ignored.
  referenceVideoGenerationId: z.string().min(1).max(64).optional(),
```

In `packages/core/src/refgen.ts`, add to `VideoRequest` after `tailImageUrl` (~111):

```ts
  /** optional whole-clip reference video — a short-lived presigned GET the provider
   *  passes to Seedance as role:"reference_video". BytePlus 2.0 only; Fal rejects it. */
  refVideoUrl?: string;
```

In `packages/core/src/gen-from-card.ts`, after the `sourceGenerationId` extraction (line 60):

```ts
  const referenceVideoGenerationId = typeof p.referenceVideoGenerationId === "string" ? p.referenceVideoGenerationId : null;
```

and in the `req` object, after the `sourceGenerationId` spread (line 83):

```ts
    ...(referenceVideoGenerationId ? { referenceVideoGenerationId } : {}),
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @fikirtive/core exec vitest run src/cowork.test.ts src/gen-from-card.test.ts`
Expected: PASS. Also run `pnpm --filter @fikirtive/core exec vitest run` — the existing suite stays green (`.strict()` still accepts the new optional field).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @fikirtive/core exec tsc --noEmit` (clean).
```bash
git add packages/core/src/gen.ts packages/core/src/cowork.ts packages/core/src/refgen.ts packages/core/src/gen-from-card.ts packages/core/src/cowork.test.ts packages/core/src/gen-from-card.test.ts
git commit -m "feat(core): referenceVideoGenerationId contract (genRequest/coworkTurn/VideoRequest/card)"
```

---

### Task 2: Provider — BytePlus `reference_video` content part; Fal rejects

**Files:**
- Modify: `packages/generation/src/byteplus.ts` (`generateVideo`, ~line 62-64)
- Modify: `packages/generation/src/index.ts` (`FalProvider.generateVideo`)
- Test: `packages/generation/src/byteplus.test.ts`

**Interfaces:**
- Consumes: `VideoRequest.refVideoUrl` (Task 1).

- [ ] **Step 1: Write failing test**

Append to `packages/generation/src/byteplus.test.ts` (follow the file's existing mock-fetch style — capture the submit body):

```ts
it("generateVideo includes a reference_video content part when refVideoUrl is set", async () => {
  const bodies: string[] = [];
  const g = globalThis as { fetch?: unknown };
  const orig = g.fetch;
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith("/tasks") && init?.body) {
      bodies.push(init.body);
      return { ok: true, json: async () => ({ id: "task1" }) } as unknown as Response;
    }
    // poll → succeeded, then download
    if (String(url).includes("/tasks/")) return { ok: true, json: async () => ({ status: "succeeded", content: { video_url: "https://x/v.mp4" } }) } as unknown as Response;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(2) } as unknown as Response;
  };
  try {
    const p = new BytePlusProvider("k");
    await p.generateVideo({ prompt: "move like this", imageUrl: "", refVideoUrl: "https://x/ref.mp4", durationSeconds: 5, model: "seedance-2-fast" });
    const submit = JSON.parse(bodies[0]!);
    const parts = submit.content as Array<{ type: string; role?: string; video_url?: { url: string } }>;
    const vp = parts.find((c) => c.type === "video_url");
    expect(vp).toBeTruthy();
    expect(vp!.role).toBe("reference_video");
    expect(vp!.video_url!.url).toBe("https://x/ref.mp4");
  } finally { g.fetch = orig as typeof fetch; }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/generation exec vitest run src/byteplus.test.ts`
Expected: FAIL (no video_url part emitted).

- [ ] **Step 3: Implement**

In `packages/generation/src/byteplus.ts` `generateVideo`, replace the content-assembly block (lines 62-64):

```ts
    const content: unknown[] = [];
    if (i2v) content.push({ type: "image_url", image_url: { url: req.imageUrl } });
    if (req.refVideoUrl) content.push({ type: "video_url", video_url: { url: req.refVideoUrl }, role: "reference_video" });
    content.push({ type: "text", text: `${req.prompt} ${flags}`.trim() });
```

In `packages/generation/src/index.ts`, in `FalProvider.generateVideo`, add near the top (before building the fal request), a guard:

```ts
    if (req.refVideoUrl) throw new Error("fal provider does not support whole-clip reference video (BytePlus only)"); // pre-spend
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @fikirtive/generation exec vitest run src/byteplus.test.ts`
Expected: PASS. Full suite `pnpm --filter @fikirtive/generation exec vitest run` stays green (i2v path unaffected — the new part is additive and only fires on `refVideoUrl`).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @fikirtive/generation exec tsc --noEmit` (clean).
```bash
git add packages/generation/src/byteplus.ts packages/generation/src/index.ts packages/generation/src/byteplus.test.ts
git commit -m "feat(generation): BytePlus reference_video content part; Fal rejects refVideoUrl"
```

---

### Task 3: propose.helpers — thread reference video into the card (video-only)

**Files:**
- Modify: `packages/otto/src/skills/propose.helpers.ts` (`CardPayload` type ~line 68; `buildProposeCard` ~line 97-104 and the payload spread ~line 213)
- Modify: `packages/otto/src/context.ts` (add `referenceVideoGenerationId?: string | null` next to `sourceGenerationId` ~line 33)
- Test: `packages/otto/src/skills/propose.test.ts`

**Interfaces:**
- Consumes: `OttoContext.referenceVideoGenerationId`.
- Produces: `CardPayload.referenceVideoGenerationId?: string` (present only for video plans with a reference video).

- [ ] **Step 1: Write failing tests**

Append to `packages/otto/src/skills/propose.test.ts` (using the file's `makeCtx`):

```ts
it("reference video: kind=video + referenceVideoGenerationId → present in payload, image tier untouched", () => {
  const ctx = makeCtx({ referenceVideoGenerationId: "gen_vid" });
  const { cardPayload } = buildProposeCard(
    { kind: "video", structuredPrompt: "move like this", entityIds: [], variantSel: {} }, ctx, []);
  expect(cardPayload.kind).toBe("video");
  expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBe("gen_vid");
});

it("reference video: kind=image ignores referenceVideoGenerationId (not in payload)", () => {
  const ctx = makeCtx({ referenceVideoGenerationId: "gen_vid" });
  const { cardPayload } = buildProposeCard(
    { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {} }, ctx, []);
  expect(cardPayload.kind).toBe("image");
  expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBeUndefined();
  expect(cardPayload.estimatedCredits).toBe(1); // image tier unchanged
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose.test.ts`
Expected: FAIL (field not on payload).

- [ ] **Step 3: Implement**

In `packages/otto/src/context.ts`, after the `sourceGenerationId` field (~line 33):

```ts
  /** Whole-clip reference video for THIS turn (整段视频参考). Server-validated video-ext.
   *  Threaded to the gen ONLY for a video plan; ignored for image plans. */
  referenceVideoGenerationId?: string | null;
```

In `packages/otto/src/skills/propose.helpers.ts`, add to the `CardPayload` type after `sourceGenerationId?: string;` (~line 68):

```ts
  referenceVideoGenerationId?: string;
```

In `buildProposeCard`, after the `isI2V`/`hasSourceImage` block (~line 104) add:

```ts
  const isRefVideo = kind === "video" && !!ctx.referenceVideoGenerationId;
```

and in the `cardPayload` object, right after the `isI2V` source spread (line 214):

```ts
    ...(isRefVideo ? { referenceVideoGenerationId: ctx.referenceVideoGenerationId! } : {}),
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose.test.ts`
Expected: PASS. Full `pnpm --filter @fikirtive/otto exec vitest run` green (price logic untouched → reserve==settle intact).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @fikirtive/otto exec tsc --noEmit` (clean).
```bash
git add packages/otto/src/skills/propose.helpers.ts packages/otto/src/context.ts packages/otto/src/skills/propose.test.ts
git commit -m "feat(otto): thread referenceVideoGenerationId into video proposal cards (video-only)"
```

---

### Task 4: DB migration + startGen persistence

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`GenJob` model, after `tailGenerationId String?` ~line 440)
- Create: `packages/db/prisma/migrations/<timestamp>_gen_job_reference_video/migration.sql`
- Modify: `apps/web/lib/gen-actions.ts` (`startGen` destructure ~line 35 + GenJob create data ~line 117)
- Test: none new (covered by migration apply + Task 5 worker test); verify build.

**Interfaces:**
- Produces: `GenJob.referenceVideoGenerationId` column; `startGen` persists it from the parsed `genRequest`.

- [ ] **Step 1: Add the column to the schema**

In `packages/db/prisma/schema.prisma`, in `model GenJob`, immediately after `tailGenerationId   String?`:

```prisma
  referenceVideoGenerationId String?
```

- [ ] **Step 2: Create the additive migration**

Create `packages/db/prisma/migrations/20260702_gen_job_reference_video/migration.sql`:

```sql
-- Additive: whole-clip reference video source for a video GenJob. Nullable, no backfill.
ALTER TABLE "GenJob" ADD COLUMN IF NOT EXISTS "referenceVideoGenerationId" TEXT;
```

- [ ] **Step 3: Regenerate the client + build the db package**

Run: `pnpm --filter @fikirtive/db exec prisma generate && pnpm --filter @fikirtive/db run build`
Expected: succeeds; the generated client now knows `GenJob.referenceVideoGenerationId`. (Per repo gotcha: `prisma generate` alone leaves the dist stale for tsc — the `build` is required.)

- [ ] **Step 4: Persist in startGen**

In `apps/web/lib/gen-actions.ts`, add `referenceVideoGenerationId` to the destructure (~line 35):

```ts
  const { projectId, shotId, sourceGenerationId, tailGenerationId, referenceVideoGenerationId, prompt, entityIds, count, kind, model, durationSeconds, resolution, aspectRatio, fps, audio, idempotencyKey, variantSel, threadId } = parsed.data;
```

and to the GenJob create `data` object, right after `sourceGenerationId: sourceGenerationId ?? null,` (~line 117):

```ts
          referenceVideoGenerationId: referenceVideoGenerationId ?? null,
```

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter web exec tsc --noEmit 2>&1 | grep -E "gen-actions\.ts"` (prints nothing).
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/web/lib/gen-actions.ts
git commit -m "feat(db): GenJob.referenceVideoGenerationId column (additive) + startGen persist"
```

---

### Task 5: Worker — resolve reference video → presign → provider (fail-closed)

**Files:**
- Modify: `apps/worker/src/jobs/gen.ts` (the `job.kind === "VIDEO"` branch, ~line 452-502)
- Test: `apps/worker/src/jobs/gen.test.ts` (or the file where the i2v-source-not-found test lives; follow existing pattern)

**Interfaces:**
- Consumes: `GenJob.referenceVideoGenerationId` (Task 4); `VideoRequest.refVideoUrl` (Task 1); `BytePlusProvider` (Task 2).

- [ ] **Step 1: Write failing test**

Mirror the existing "i2v source not found → failClosedWithRefund" test with a reference-video case: a job with `referenceVideoGenerationId` that resolves to nothing → `failClosedWithRefund` is called and `provider.generateVideo` is NOT. (Copy the existing i2v test's harness; swap `sourceGenerationId`→`referenceVideoGenerationId` and the ext set to video.) If no such test file exists, create one following the worker test conventions; name the test `reference video set but not found → fail closed, no spend`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/worker exec vitest run src/jobs/gen.test.ts`
Expected: FAIL (no resolution logic yet).

- [ ] **Step 3: Implement**

In `apps/worker/src/jobs/gen.ts`, inside the `job.kind === "VIDEO"` branch, AFTER the tail-frame block and BEFORE the `provider.generateVideo(...)` call (~line 493-497), add:

```ts
      // Whole-clip reference video (整段视频参考). Resolved server-side from an owned,
      // in-project, video-ext Generation; fail-closed if set-but-missing (never spend).
      let refVideoUrl = "";
      if (job.referenceVideoGenerationId) {
        const rv = await prisma.generation.findFirst({
          where: { id: job.referenceVideoGenerationId, ownerId: job.ownerId, projectId: job.projectId, deletedAt: null, asset: { ext: { in: ["mp4", "mov", "webm"] } } },
          include: { asset: true },
        });
        if (!rv) {
          await failClosedWithRefund(job, "reference video not found (or not a video) in this project");
          return;
        }
        refVideoUrl = (await storage.presignedGet(storageKey(rv.asset.ownerId, rv.asset.contentHash, rv.asset.ext), 3600)) ?? "";
        if (provider.name !== "mock" && !refVideoUrl) throw new Error("reference video unreachable — refusing to spend");
      }
```

Then add `refVideoUrl: refVideoUrl || undefined,` to the `provider.generateVideo({ ... })` call object (alongside `tailImageUrl`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @fikirtive/worker exec vitest run src/jobs/gen.test.ts`
Expected: PASS. Full worker suite green.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @fikirtive/worker exec tsc --noEmit` (clean; needs Task 4's db build).
```bash
git add apps/worker/src/jobs/gen.ts apps/worker/src/jobs/gen.test.ts
git commit -m "feat(worker): resolve referenceVideoGenerationId → presigned refVideoUrl (fail-closed)"
```

---

### Task 6: Web server wiring — video-ext validators + buildOttoContext + pass-through

**Files:**
- Modify: `apps/web/lib/otto-actions.ts` (validate `referenceVideoGenerationId` ~350-363; pass to `buildOttoContext`; `buildOttoContext` signature + return ~119-165)
- Modify: `apps/web/app/api/otto/stream/route.ts` (validate ~102-110; pass to `buildOttoContext`)
- Test: `apps/web/lib/__tests__/otto-actions.test.ts` (extend if a validation test exists; else assert via a focused test)

**Interfaces:**
- Consumes: `coworkTurnRequest.referenceVideoGenerationId` (Task 1); `OttoContext.referenceVideoGenerationId` (Task 3).
- Produces: `buildOttoContext({ ..., referenceVideoGenerationId })` sets `ctx.referenceVideoGenerationId`.

- [ ] **Step 1: Add the video-ext validator + pass-through in `otto-actions.ts`**

In `ottoTurn` destructure (~341), add `referenceVideoGenerationId`. After the existing `sourceGenerationId` image-ext validation block (~350-363), add a PARALLEL video-ext validator (do NOT modify the image one):

```ts
    // Validate referenceVideoGenerationId (owned + in-project + VIDEO-ext), else null
    let validRefVideo: string | null = null;
    if (referenceVideoGenerationId) {
      const rv = await prisma.generation.findFirst({
        where: { id: referenceVideoGenerationId, ...OWNED, projectId, asset: { ext: { in: ["mp4", "mov", "webm"] } } },
        select: { id: true },
      });
      if (rv) validRefVideo = rv.id;
    }
```

Add `referenceVideoGenerationId: validRefVideo` to the `buildOttoContext({...})` call (~line 420).

In `buildOttoContext`'s params type + destructure (~119-131) add `referenceVideoGenerationId?: string | null`, and in the returned object (~148, after `sourceGenerationId`) add `referenceVideoGenerationId: referenceVideoGenerationId ?? null,`.

- [ ] **Step 2: Same validator + pass-through in `stream/route.ts`**

In the route's destructure (~85) add `referenceVideoGenerationId`. After the `sourceGenerationId` image-ext validation (~102-110) add the same parallel video-ext validator (producing `validRefVideo`), and add `referenceVideoGenerationId: validRefVideo` to the `buildOttoContext({...})` call (~167).

- [ ] **Step 3: Write/extend a focused test**

Add a test (in `apps/web/lib/__tests__/otto-actions.test.ts` or a new `otto-ref-video-validate.test.ts`) that mocks `prisma.generation.findFirst` to assert: a `referenceVideoGenerationId` whose asset ext is an image is NOT accepted (validRefVideo stays null), and one with a video ext IS. If the surrounding `ottoTurn` is too heavy to unit-test, extract the validator into a tiny pure helper `validateOwnedGenerationExt(prisma, {id, ownerId, projectId, exts})` used by both call sites and test THAT (preferred — also DRYs the image + video validators). State which approach you took in the report.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter web exec vitest run <the test file>` (PASS) and `pnpm --filter web exec tsc --noEmit 2>&1 | grep -E "otto-actions\.ts|stream/route\.ts"` (prints nothing).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/otto-actions.ts apps/web/app/api/otto/stream/route.ts apps/web/lib/__tests__
git commit -m "feat(otto): validate + thread referenceVideoGenerationId (video-ext) into OttoContext"
```

---

### Task 7: Composer UI — "Use whole video" + instructions guidance

**Files:**
- Modify: `apps/web/lib/video-frame.ts` (add `REF_VIDEO_MIN_SECONDS`, `REF_VIDEO_MAX_SECONDS`, `isRefVideoDurationOk`)
- Modify: `apps/web/components/otto/OttoChatStream.tsx` (picker: "Use whole video" button; extend attach state with kind; send `referenceVideoGenerationId`)
- Modify: `packages/otto/src/instructions.ts` (reference-video guidance)
- Test: `apps/web/lib/__tests__/video-frame.test.ts`; `packages/otto/src/instructions.test.ts`

**Interfaces:**
- Consumes: existing `videoPick` picker state, `uploadFilesDirect`, `finalizeCandidateUploads`; the send path that currently passes `sourceGenerationId`.

- [ ] **Step 1: Write failing helper + instruction tests**

Append to `apps/web/lib/__tests__/video-frame.test.ts`:

```ts
import { REF_VIDEO_MIN_SECONDS, REF_VIDEO_MAX_SECONDS, isRefVideoDurationOk } from "../video-frame.js";
describe("ref video duration bounds", () => {
  it("2..10s inclusive ok; outside not", () => {
    expect(REF_VIDEO_MIN_SECONDS).toBe(2);
    expect(REF_VIDEO_MAX_SECONDS).toBe(10);
    expect(isRefVideoDurationOk(2)).toBe(true);
    expect(isRefVideoDurationOk(10)).toBe(true);
    expect(isRefVideoDurationOk(1.5)).toBe(false);
    expect(isRefVideoDurationOk(11)).toBe(false);
    expect(isRefVideoDurationOk(Number.NaN)).toBe(false);
  });
});
```

Append to `packages/otto/src/instructions.test.ts`:

```ts
describe("ottoInstructions — reference video", () => {
  it("mentions an attached reference video guides motion/style of a video plan", () => {
    expect(ottoInstructions.toLowerCase()).toContain("reference video");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run lib/__tests__/video-frame.test.ts` and `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helper + instructions**

In `apps/web/lib/video-frame.ts`, append:

```ts
export const REF_VIDEO_MIN_SECONDS = 2;
export const REF_VIDEO_MAX_SECONDS = 10;
/** Whole-clip reference video must be 2–10s (Seedance min; upper bound protects COGS). */
export function isRefVideoDurationOk(duration: number): boolean {
  return Number.isFinite(duration) && duration >= REF_VIDEO_MIN_SECONDS && duration <= REF_VIDEO_MAX_SECONDS;
}
```

In `packages/otto/src/instructions.ts`, inside the "## Attached reference image" section (added by #84, after the bullets ~line 47), append a bullet (keep template-literal backtick escaping):

```
- The user may instead attach a **reference video** (whole clip). If so, propose \`kind: "video"\` and describe how to use its motion/pacing/style; the clip guides the video generation. You cannot see the video — reason from the user's words.
```

- [ ] **Step 4: Implement the composer "Use whole video"**

In `apps/web/components/otto/OttoChatStream.tsx`:
- Import the new helpers: add `REF_VIDEO_MIN_SECONDS, REF_VIDEO_MAX_SECONDS, isRefVideoDurationOk` to the existing `@/lib/video-frame` import.
- Extend the attach state to carry a kind. Change `attached` to `{ generationId: string; src: string; kind: "image" | "refVideo" }` (update the two existing `setAttached({ generationId, src })` calls — image branch of `handleFilePick` and `useSelectedFrame` — to pass `kind: "image"`).
- Add a `useWholeVideo` handler next to `useSelectedFrame`:

```ts
  async function useWholeVideo() {
    const v = videoElRef.current;
    if (!v || !isRefVideoDurationOk(v.duration)) {
      setAttachError(`Reference video must be ${REF_VIDEO_MIN_SECONDS}–${REF_VIDEO_MAX_SECONDS}s.`);
      return;
    }
    if (!wholeVideoFileRef.current) return;
    setUploading(true);
    try {
      const outcome = await uploadFilesDirect([wholeVideoFileRef.current], () => {});
      if (outcome.files.length === 0) { setAttachError(outcome.failures[0]?.reason ?? "Upload failed."); return; }
      const r = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in r || !r.generationIds?.[0]) { setAttachError("error" in r ? r.error : "Could not attach video."); return; }
      const preview = canvasRef.current?.toDataURL("image/jpeg", FRAME_JPEG_QUALITY) ?? "";
      setAttached({ generationId: r.generationIds[0], src: preview, kind: "refVideo" });
      closeVideoPick();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed.");
    } finally { setUploading(false); }
  }
```

- Keep the original `File` for whole-clip upload: add `const wholeVideoFileRef = useRef<File | null>(null);` and set `wholeVideoFileRef.current = file;` in the video branch of `handleFilePick` (right after `setVideoPick(...)`).
- In the picker JSX button row, add a second button beside "Use this frame":

```tsx
                <Button variant="default" size="sm" onClick={useWholeVideo} disabled={uploading || !isRefVideoDurationOk(videoPick.duration)}>
                  {uploading ? "Attaching…" : "Use whole video"}
                </Button>
```

(When `videoPick.duration` is out of 2–10s, the button is disabled — pair it with a small hint line: `{videoPick.duration > 0 && !isRefVideoDurationOk(videoPick.duration) && <div className="text-[0.8rem] text-muted-foreground">Whole-video reference needs a {REF_VIDEO_MIN_SECONDS}–{REF_VIDEO_MAX_SECONDS}s clip.</div>}`.)

- In the send path, where the request currently includes `sourceGenerationId: attached?.generationId`, branch on kind so a `refVideo` attach sends `referenceVideoGenerationId` instead:

```ts
      ...(attached?.kind === "refVideo"
        ? { referenceVideoGenerationId: attached.generationId }
        : attached ? { sourceGenerationId: attached.generationId } : {}),
```

(Find the current `sourceGenerationId` send site — it's where `ottoTurn`/the stream request body is assembled — and replace it with the branch above. State the exact line in the report.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter web exec vitest run lib/__tests__/video-frame.test.ts` (PASS), `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts` (PASS), and `pnpm --filter web exec tsc --noEmit 2>&1 | grep -E "OttoChatStream\.tsx|video-frame\.ts"` (prints nothing).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/video-frame.ts apps/web/lib/__tests__/video-frame.test.ts apps/web/components/otto/OttoChatStream.tsx packages/otto/src/instructions.ts packages/otto/src/instructions.test.ts
git commit -m "feat(otto): composer 'Use whole video' → referenceVideoGenerationId (2–10s) + guidance"
```

---

### Task 8: Money-safety gate + founder-approved paid API verification

**Not a code task — a required gate before merge.**

- [ ] **Step 1:** Run the `money-safety-review` skill against the full branch diff (`git diff c4c635f..HEAD`). Confirm: `pricedGenCredits`/reserve/settle/dedup unchanged; `genRequest` still `.strict()` + `idempotencyKey` required; the new field never alters price (charge keyed off kind+model+resolution); worker is fail-closed on an unresolvable reference video; no bypass of `startGen`. Address any finding.
- [ ] **Step 2:** Present to the founder for the **paid API verification** (per [[ask-before-spending-real-money]]): a single real BytePlus `reference_video` generation to confirm the `{type:"video_url", role:"reference_video"}` param shape + record the **actual COGS** for a 10s-input / 5s-output 720p clip. **Do not run it without the founder's explicit go-ahead.** If the measured COGS exceeds the 7cr (=$0.70) revenue by >20%, reduce `REF_VIDEO_MAX_SECONDS` to 5 (one constant) before shipping — do NOT change the price function.
- [ ] **Step 3:** Manual prod smoke (founder): attach a 2–10s clip → "Use whole video" → "make my product move like this" → a video generates referencing the clip; a clip with a real face → graceful failure + refund.

---

## Self-Review (against the spec)

- **Spec coverage:** contract (T1); provider reference_video + Fal reject (T2); propose video-only threading (T3); GenJob column + startGen (T4); worker resolve + fail-closed (T5); web video-ext validators + context + composer + instructions (T6, T7); money-safety + paid verify + input cap (T8, and the 2–10s cap in T7). Non-goals (face verification, multi-clip, reference-image, fal, Otto-sees-video) are absent by construction.
- **Placeholder scan:** every code step has literal code; the two "find the exact send site / mirror the existing i2v test" notes name the concrete anchor + require reporting the line — acceptable because the surrounding file is large and the pattern is exact.
- **Type consistency:** `referenceVideoGenerationId` (id field) vs `refVideoUrl` (VideoRequest presigned URL) used consistently; `isRefVideo` mirrors `isI2V`; `GenJob.referenceVideoGenerationId` column ↔ `job.referenceVideoGenerationId` read; video ext set `["mp4","mov","webm"]` identical in T5/T6.
- **Money:** price path untouched; new field is additive + fail-closed; T8 gates the spend-shape review + paid verify.
