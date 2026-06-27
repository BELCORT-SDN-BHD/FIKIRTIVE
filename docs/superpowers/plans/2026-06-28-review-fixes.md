# Ultra-review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the 10 confirmed findings + 2 hardening items from the stack ultra-review in one cleanup PR, without weakening any invariant.

**Architecture:** Five grouped tasks: (1) align the agent's video-model selection to the single spendable model; (2) make DetailPanel surface generated results; (3) React lifecycle cleanups; (4) error-text + owner-scope hardening; (5) schema (BrandKit uniqueness + drop a dead index). Money path is only made *consistent*, never weakened.

**Tech Stack:** Next.js App Router, Prisma 7.8 + Postgres, `@fikirtive/core` (gen/model-config), React, vitest 3.2 (prisma mocked).

## Global Constraints

- **Money path made consistent only, never weakened.** F1 changes which video model id the agent *proposes* so it equals the already-enforced spendable model (`activeVideoModel()`). Do NOT touch `reserveCredits`/charge/grant/settle/pricing, and do NOT add a new model — `veo3.1-lite` already exists in the priced table.
- **Active video model id = `"veo3.1-lite"`** (verbatim). Image model unchanged (`seedream`, the only image model).
- **All hardening is owner-scoped fail-closed** — validate client-supplied ids against the caller's `ownerId` (and `projectId` where applicable); null/coerce on mismatch, never trust blindly (mirror the existing `threadId` validation in `createCanvasNode`).
- **After any schema change, rebuild the db package** — `pnpm --filter @fikirtive/db run build` (NOT just generate) so consumers see fresh types.
- **Test runner** — `cd apps/web && pnpm exec vitest run <path>` for web; `pnpm --filter @fikirtive/core exec vitest run <path>` (or `cd packages/core && pnpm exec vitest run <path>`) for core.
- **Build gate** — final `pnpm -r build` must show `├ ƒ /otto` + `Done`; grep the log, don't trust the pipe exit code.
- **Deferred (do NOT implement):** DNS IP-pinning (pre-existing, mitigated by `redirect:"error"`+timeout; needs a custom undici dispatcher — tracked follow-up).

---

### Task 1: F1 — Align agent video-model selection to the single spendable model

**Files:**
- Modify: `packages/core/src/model-config.ts` (`activeVideoModel` default)
- Modify: `packages/core/src/model-config.test.ts` (default + override tests)
- Modify: `packages/core/src/cowork-route.ts` (`suggestModel` video branch)
- Modify: `packages/core/src/cowork-route.test.ts` IF it exists and asserts video-model picks (update to the active model)

**Interfaces:**
- Produces: `activeVideoModel(env?)` now defaults to `"veo3.1-lite"`. `suggestModel({kind:"video", ...})` returns `model === activeVideoModel()` (params clamped to that model's options).

- [ ] **Step 1: Write the failing model-config tests**

Append to `packages/core/src/model-config.test.ts`:

```ts
describe("activeVideoModel default", () => {
  const prev = process.env.OTTO_DEFAULT_VIDEO_MODEL;
  afterEach(() => { if (prev === undefined) delete process.env.OTTO_DEFAULT_VIDEO_MODEL; else process.env.OTTO_DEFAULT_VIDEO_MODEL = prev; });
  it("defaults to veo3.1-lite when no env override", () => {
    delete process.env.OTTO_DEFAULT_VIDEO_MODEL;
    expect(activeVideoModel()).toBe("veo3.1-lite");
  });
  it("honors a valid env override", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "veo3.1" })).toBe("veo3.1");
  });
  it("ignores an unknown env value (falls back to veo3.1-lite)", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("veo3.1-lite");
  });
});
```

(Ensure `activeVideoModel` and `afterEach` are imported at the top — add `afterEach` to the vitest import and `activeVideoModel` to the model-config import if not already present.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && pnpm exec vitest run src/model-config.test.ts`
Expected: FAIL — default is currently `kling`, not `veo3.1-lite`.

- [ ] **Step 3: Change the default in `activeVideoModel`**

In `packages/core/src/model-config.ts`, replace the `activeVideoModel` body:

```ts
export function activeVideoModel(env?: Env): string {
  const want = getEnv(env).OTTO_DEFAULT_VIDEO_MODEL;
  if (want && (GEN_VIDEO_MODELS as readonly string[]).includes(want)) return want;
  // Default to veo3.1-lite (supports 9:16/16:9 + audio; the GEN_VIDEO_MODELS[0]=kling
  // default lacks both). Founder overrides via OTTO_DEFAULT_VIDEO_MODEL.
  return (GEN_VIDEO_MODELS as readonly string[]).includes("veo3.1-lite") ? "veo3.1-lite" : GEN_VIDEO_MODELS[0];
}
```

- [ ] **Step 4: Run to verify model-config tests pass**

Run: `cd packages/core && pnpm exec vitest run src/model-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Force `suggestModel` video branch to the active model**

Read `packages/core/src/cowork-route.ts` `suggestModel` fully first. In the video branch (after the `image` early-return), the current code builds `candidates` → `pool` → cheapest `pick`. Replace the model-selection block (the `candidates`/`pool`/`pick` computation) with the locked active model, and KEEP the existing param-building block that follows (the part using `const o = GEN_VIDEO_MODEL_OPTIONS[pick]` to clamp duration/resolution/aspect/audio and build the `SuggestModelResult`). Concretely:

- Add the import at the top of `cowork-route.ts`: `import { activeVideoModel } from "./model-config.js";`
- Replace the `const candidates = ... ` through `... .sort((a,b)=>a.rate-b.rate)[0]!.m as GenVideoModel;` block with:

```ts
  // Locked to the single active video model (product decision: one video model, no picker).
  // The spend gate (assertSpendableModel) only allows activeVideoModel(); proposing any other
  // model would freeze a price onto a card that startGen then rejects. Params below are still
  // clamped to THIS model's options, so capability mismatches degrade to the model's defaults.
  const pick = activeVideoModel() as GenVideoModel;
```

Leave everything from `const o = GEN_VIDEO_MODEL_OPTIONS[pick];` onward unchanged. (If `wantTail`/`t2vNeedsAspect`/`enabledVideoModels` become unused after the deletion, remove only those now-orphaned locals/imports to keep the build clean.)

- [ ] **Step 6: Update any suggestModel video tests + typecheck**

Run: `cd packages/core && pnpm exec vitest run 2>&1 | tail -30`
If a `cowork-route` test asserts a specific video model pick (e.g. "picks veo3.1-lite for 9:16" or "picks the cheapest"), update those expectations to `activeVideoModel()` (= `"veo3.1-lite"` by default). Then:
Run: `cd packages/core && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors; all core tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/model-config.ts packages/core/src/model-config.test.ts packages/core/src/cowork-route.ts packages/core/src/cowork-route.test.ts
git commit -m "fix(review): lock agent video-model selection to the single spendable model (veo3.1-lite)"
```

---

### Task 2: F3 — DetailPanel surfaces the generated result (regen / animate / edit)

**Files:**
- Modify: `apps/web/components/asset/DetailPanel.tsx` (`handleRegen`, `handleAnimate`, `handleEditSubmit`)

**Interfaces:**
- Consumes: existing `getGeneration` (`@/lib/asset-actions`), `getGenJob` (`@/lib/gen-actions`), `pollJob`, `setGen`.

> No unit test (no RTL); the money-path correctness is verified by `tsc` + manual smoke (the result must appear after a spend).

- [ ] **Step 1: Confirm the handler + pollJob shapes**

Read `apps/web/components/asset/DetailPanel.tsx` lines 174–320: confirm `pollJob(jobId)` returns `"done" | "failed"`, that `handleRegen`/`handleAnimate`/`handleEditSubmit` each do `const result = await startGen(...)` (so `result.id` is the JOB id) then `const status = await pollJob(result.id)`, and that `getGenJob` is already imported (it is used inside `pollJob`). Confirm `handleCropConfirm`'s reload pattern (`setGen(null); getGeneration(result.id).then(setGen)`).

- [ ] **Step 2: Add a reload helper + call it on success in all three handlers**

Add a `useCallback` helper near `pollJob`:

```tsx
  // After a job completes, resolve its new generation id and load it into the panel
  // (so a paid regen/animate/edit result is visible here, not only in Library).
  const reloadFromJob = useCallback(async (jobId: string) => {
    const job = await getGenJob(jobId);
    const newId = job?.generationIds?.[0];
    if (!newId) return;
    setGen(null);
    const r = await getGeneration(newId);
    if (r && !("error" in r)) setGen(r);
  }, []);
```

Then in `handleRegen`, `handleAnimate`, and `handleEditSubmit`, immediately after `const status = await pollJob(result.id);` and the existing `if (status === "done")` success branch (where the transient label is set), add `await reloadFromJob(result.id);`. Keep the existing transient status label. Add `reloadFromJob` to each handler's `useCallback` dependency array.

> If `getGenJob` is not already imported at the top, add `import { getGenJob } from "@/lib/gen-actions";` (or extend the existing gen-actions import). Confirm `getGenJob`'s return includes `generationIds: string[]`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/asset/DetailPanel.tsx
git commit -m "fix(review): surface regen/animate/edit results in DetailPanel (was invisible after spend)"
```

---

### Task 3: React lifecycle cleanups (F2, F7, F8, F9)

**Files:**
- Modify: `apps/web/components/canvas/FlowCanvas.tsx` (F2 double-submit guard)
- Modify: `apps/web/components/otto/TemplateModal.tsx` (F7 unmount cancel)
- Modify: `apps/web/components/otto/OttoLibrary.tsx` (F8 stale-response guard)
- Modify: `apps/web/components/otto/OttoDiscover.tsx` (F9 timeout cleanup)

> No unit tests (no RTL); verified by `tsc` + manual. Each is a contained guard.

- [ ] **Step 1: F2 — guard the canvas Generate against double-submit**

Read `apps/web/components/canvas/FlowCanvas.tsx` and find `handleGenerate` (the form/MentionInput submit that calls `generateImage`). Add a ref near the other refs: `const submittingRef = useRef(false);`. At the top of `handleGenerate`, `if (submittingRef.current) return; submittingRef.current = true;`, and in a `finally` (or after the `generateImage` call resolves) `submittingRef.current = false;`. Also disable the Generate submit button while submitting — add a `useState` `const [submitting, setSubmitting] = useState(false)` set around the call and `disabled={submitting}` on the Generate button (the `al-btn-primary` submit). Keep behavior otherwise identical.

- [ ] **Step 2: F7 — cancel TemplateModal polling on unmount**

In `apps/web/components/otto/TemplateModal.tsx`: add `const cancelledRef = useRef(false);` and an effect `useEffect(() => () => { cancelledRef.current = true; }, []);`. In `pollJob`, check `if (cancelledRef.current) return null;` at the top of each loop iteration; and in `onGenerate`, after `const out = await pollJob(...)`, guard `if (cancelledRef.current) return;` before any `setResultUrl`/`setError`/`setPhase`. Import `useRef`/`useEffect` if not present.

- [ ] **Step 3: F8 — drop stale OttoLibrary responses**

In `apps/web/components/otto/OttoLibrary.tsx`: add `const reqIdRef = useRef(0);`. In `fetchPage`, at the start capture `const myReq = ++reqIdRef.current;`, and before EACH `setItems`/`setCursor`/`setHasMore` apply, guard `if (myReq !== reqIdRef.current) return;` (so a late append from an old query/filter is dropped once a newer fetch started). Import `useRef` if not present. Leave the keyset cursor logic unchanged.

- [ ] **Step 4: F9 — clear OttoDiscover copy timeout on unmount**

In `apps/web/components/otto/OttoDiscover.tsx`: add `const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);`. In `copy`, before setting a new timeout `if (copyTimer.current) clearTimeout(copyTimer.current);` and store `copyTimer.current = setTimeout(() => setCopied(false), 1500);`. Add `useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);`. Import `useRef`/`useEffect` if not present.

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors across the four files.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/canvas/FlowCanvas.tsx apps/web/components/otto/TemplateModal.tsx apps/web/components/otto/OttoLibrary.tsx apps/web/components/otto/OttoDiscover.tsx
git commit -m "fix(review): React lifecycle guards — canvas double-submit, modal/poll cancel, library stale-response, discover timeout"
```

---

### Task 4: Error-text + owner-scope hardening (F4, H1, H2)

**Files:**
- Modify: `apps/web/lib/url-safety.ts` (F4 — drop resolved IP from the message)
- Modify: `apps/web/lib/brand-actions.ts` (H1 — validate `logoAssetId` owner-scoped)
- Modify: `apps/web/lib/canvas-actions.ts` (H2 — validate attribution ids owner-scoped)
- Test: `apps/web/lib/__tests__/brand-actions.test.ts`, `apps/web/lib/__tests__/canvas-actions.test.ts`

**Interfaces:**
- Produces: `saveBrandKit` stores `logoAssetId` only if it names an Asset owned by the caller (else null). `createCanvasNode` stamps `generationId`/`genJobId`/`sourceNodeId` only when each names a row owned by the caller (else null), mirroring `threadId`.

- [ ] **Step 1: F4 — generic SSRF error message**

In `apps/web/lib/url-safety.ts:200`, change the resolved-IP rejection from
`` `URL hostname "${url.hostname}" resolves to a private/reserved address (${address}) and is not allowed` ``
to
`` `URL hostname "${url.hostname}" resolves to a private/reserved address and is not allowed` ``
(drop `(${address})` so the resolved internal IP is not echoed back to the user). No other change.

- [ ] **Step 2: Write failing tests for H1 + H2**

In `apps/web/lib/__tests__/brand-actions.test.ts`, add an Asset-ownership mock + a test that `saveBrandKit` nulls a `logoAssetId` the caller doesn't own:

```ts
it("nulls logoAssetId when the asset is not owned by the caller", async () => {
  mockAssetFindFirst.mockResolvedValue(null); // not owned
  mockKitFindFirst.mockResolvedValue(null);   // no existing kit
  mockKitCreate.mockResolvedValue({ id: "k1" });
  await saveBrandKit({ logoAssetId: "asset-foreign" });
  expect(mockKitCreate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ logoAssetId: null }) }),
  );
});
it("keeps logoAssetId when the asset is owned", async () => {
  mockAssetFindFirst.mockResolvedValue({ id: "asset-mine" });
  mockKitFindFirst.mockResolvedValue(null);
  mockKitCreate.mockResolvedValue({ id: "k1" });
  await saveBrandKit({ logoAssetId: "asset-mine" });
  expect(mockKitCreate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ logoAssetId: "asset-mine" }) }),
  );
});
```

(Extend the existing `vi.hoisted`/`vi.mock("@fikirtive/db", ...)` block with `asset: { findFirst: mockAssetFindFirst }` and `brandKit: { findFirst: mockKitFindFirst, create: mockKitCreate, update: mockKitUpdate }` as needed, matching the file's current mock shape.)

In `apps/web/lib/__tests__/canvas-actions.test.ts`, add a test that a foreign `generationId` is nulled:

```ts
it("nulls a generationId the caller does not own", async () => {
  mockProjectFindFirst.mockResolvedValue({ id: "p1" });
  mockGenerationFindFirst.mockResolvedValue(null); // not owned
  mockCreate.mockResolvedValue({ id: "node-1" });
  await createCanvasNode({ projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1, generationId: "g-foreign" });
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ generationId: null }) }),
  );
});
```

(Add `generation: { findFirst: mockGenerationFindFirst }` and, if you also validate `sourceNodeId`/`genJobId`, `canvasNode.findFirst`/`genJob.findFirst` mocks to the prisma mock.)

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/brand-actions.test.ts lib/__tests__/canvas-actions.test.ts`
Expected: FAIL (current code stores the foreign ids verbatim).

- [ ] **Step 3: H1 — validate logoAssetId owner-scoped in saveBrandKit**

In `apps/web/lib/brand-actions.ts`, before building `data`, resolve a validated logo id:

```ts
  let validLogoAssetId: string | null | undefined;
  if (input.logoAssetId === null) {
    validLogoAssetId = null;
  } else if (typeof input.logoAssetId === "string") {
    const owned = await prisma.asset.findFirst({ where: { id: input.logoAssetId, ownerId }, select: { id: true } });
    validLogoAssetId = owned ? input.logoAssetId : null; // fail-closed: drop a foreign/unknown asset id
  }
```

and change the `data.logoAssetId` line to use `validLogoAssetId` (keep the strip-undefined behavior: when `input.logoAssetId` is absent, `validLogoAssetId` is `undefined` and gets stripped).

- [ ] **Step 4: H2 — validate attribution ids owner-scoped in createCanvasNode**

In `apps/web/lib/canvas-actions.ts`, mirror the existing `threadId` validation for the attribution fields. After the `threadId` resolution block, add owner-scoped checks (each fail-closed to null on miss):

```ts
  let generationId: string | null = null;
  if (input.generationId) {
    const g = await prisma.generation.findFirst({ where: { id: input.generationId, ownerId: gate.ownerId, deletedAt: null }, select: { id: true } });
    generationId = g ? g.id : null;
  }
  let sourceNodeId: string | null = null;
  if (input.sourceNodeId) {
    const n = await prisma.canvasNode.findFirst({ where: { id: input.sourceNodeId, ownerId: gate.ownerId }, select: { id: true } });
    sourceNodeId = n ? n.id : null;
  }
  let genJobId: string | null = null;
  if (input.genJobId) {
    const j = await prisma.genJob.findFirst({ where: { id: input.genJobId, ownerId: gate.ownerId }, select: { id: true } });
    genJobId = j ? j.id : null;
  }
```

and replace the corresponding `generationId: input.generationId ?? null` / `genJobId: input.genJobId ?? null` / `sourceNodeId: input.sourceNodeId ?? null` in the `create` data with the validated `generationId` / `genJobId` / `sourceNodeId` locals.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/brand-actions.test.ts lib/__tests__/canvas-actions.test.ts`
Expected: PASS. Then `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/url-safety.ts apps/web/lib/brand-actions.ts apps/web/lib/canvas-actions.ts apps/web/lib/__tests__/brand-actions.test.ts apps/web/lib/__tests__/canvas-actions.test.ts
git commit -m "fix(review): generic SSRF error text; owner-scope logoAssetId + canvas-node attribution ids"
```

---

### Task 5: Schema — BrandKit uniqueness (F5) + drop dead index (F6); final build gate

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (BrandKit comment; remove `Generation` favorite index)
- Create: `packages/db/prisma/migrations/20260628120000_review_fixes_indexes/migration.sql`
- Modify: `apps/web/lib/brand-actions.ts` (P2002 fallback in `saveBrandKit`)
- Test: `apps/web/lib/__tests__/brand-actions.test.ts`

**Interfaces:**
- Produces: a unique index on `BrandKit(ownerId, COALESCE(brandId,''))`; `saveBrandKit` retries as update on a unique violation; `Generation_ownerId_favorite_deletedAt_idx` dropped.

- [ ] **Step 1: Write the migration**

Create `packages/db/prisma/migrations/20260628120000_review_fixes_indexes/migration.sql`:

```sql
-- F5: dedup BrandKit per owner+brand, including the common brandId IS NULL case
-- (plain UNIQUE(ownerId, brandId) would NOT dedup NULL brandId — NULLs are distinct in Postgres).
CREATE UNIQUE INDEX "BrandKit_owner_brand_unique" ON "BrandKit"("ownerId", COALESCE("brandId", ''));

-- F6: drop the unused favorite index (the favorites library query is served by Generation_library_idx).
DROP INDEX IF EXISTS "Generation_ownerId_favorite_deletedAt_idx";
```

- [ ] **Step 2: Reflect in schema.prisma (raw-index comment + remove dead index)**

In `packages/db/prisma/schema.prisma`:
- Remove the `@@index([ownerId, favorite, deletedAt])` line from the `Generation` model.
- In the `BrandKit` model, add a comment documenting the raw unique index (Prisma can't express a `COALESCE` expression index):

```prisma
  // F5: a raw UNIQUE INDEX on (ownerId, COALESCE(brandId,'')) lives in migration
  // 20260628120000_review_fixes_indexes — dedups kits per owner+brand incl. brandId IS NULL.
  @@index([ownerId, brandId])
```

(Keep the existing `@@index([ownerId, brandId])`.)

- [ ] **Step 3: Rebuild the db package**

Run: `pnpm --filter @fikirtive/db run build`
Expected: "Generated Prisma Client" + clean tsc.

- [ ] **Step 4: Write the failing P2002-fallback test**

In `apps/web/lib/__tests__/brand-actions.test.ts`, add a test that a create hitting a unique violation falls back to update:

```ts
it("falls back to update when create races a unique violation (P2002)", async () => {
  mockAssetFindFirst.mockResolvedValue(null);
  mockKitFindFirst
    .mockResolvedValueOnce(null)            // first read: no existing
    .mockResolvedValueOnce({ id: "k-race" }); // re-read after P2002: the racer's row
  const p2002 = Object.assign(new Error("unique"), { code: "P2002" });
  mockKitCreate.mockRejectedValue(p2002);
  mockKitUpdate.mockResolvedValue({ id: "k-race" });
  const res = await saveBrandKit({ name: "X" });
  expect(res).toEqual({ id: "k-race" });
  expect(mockKitUpdate).toHaveBeenCalled();
});
```

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/brand-actions.test.ts`
Expected: FAIL (no P2002 handling yet).

- [ ] **Step 5: Implement the P2002 fallback in saveBrandKit**

In `apps/web/lib/brand-actions.ts`, wrap the `create` branch so a unique-violation re-reads and updates:

```ts
    } else {
      const id = newId();
      try {
        await prisma.brandKit.create({ data: { id, ownerId, brandId, ...data } });
        return { id };
      } catch (e) {
        // F5: lost the create race — a concurrent saveBrandKit won the unique index.
        if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
          const raced = await prisma.brandKit.findFirst({ where: { ownerId, brandId }, select: { id: true } });
          if (raced) {
            await prisma.brandKit.update({ where: { id: raced.id }, data });
            return { id: raced.id };
          }
        }
        throw e;
      }
    }
```

(Keep the outer `try/catch` that returns the generic `{ error }`.)

- [ ] **Step 6: Run brand-actions tests + typecheck**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/brand-actions.test.ts`
Expected: PASS. Then `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit` → 0 errors.

- [ ] **Step 7: Full suite + monorepo build gate**

Run: `cd apps/web && pnpm exec vitest run` — expected: green except the pre-existing `DATABASE_URL` integration tests (`require-owner`, `tenant-guard`, `files route`, `isolation`).
Run: `cd packages/core && pnpm exec vitest run` — expected: all green (model-config + cowork-route).
Run (repo root `/Users/winnin/Desktop/artlio/.claude/worktrees/otto-g2-editor`): `pnpm -r build 2>&1 | tee /tmp/review-fixes-build.log; grep -E "ƒ /otto|Done|error TS|Failed to compile" /tmp/review-fixes-build.log`
Expected: shows `├ ƒ /otto` + `Done`, no `error TS` / `Failed to compile`.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260628120000_review_fixes_indexes apps/web/lib/brand-actions.ts apps/web/lib/__tests__/brand-actions.test.ts
git commit -m "fix(review): BrandKit COALESCE-unique + P2002 upsert fallback; drop dead favorite index; build-verified"
```

---

## Self-Review

**Spec coverage:** F1 → Task 1. F2 → Task 3.1. F3 → Task 2. F4 → Task 4.1. F5 → Task 5. F6 → Task 5. F7 → Task 3.2. F8 → Task 3.3. F9 → Task 3.4. H1 → Task 4.3. H2 → Task 4.4. Deferred DNS IP-pin: explicitly out of scope (Global Constraints). All covered.

**Placeholder scan:** No TBD/TODO; each step gives concrete code or a precise edit + a drift-guard ("read X first / confirm shape") where the surrounding lines must be matched against the real file. No "handle edge cases" hand-waves.

**Type consistency:** `activeVideoModel()` returns `string` ("veo3.1-lite"); `suggestModel` keeps its `SuggestModelResult` shape (only the `pick` source changes). `reloadFromJob(jobId: string)` uses `getGenJob` (returns `{ generationIds: string[] }`) → `getGeneration(newId)` (returns the `GenDTO`/`{error}` the panel already handles). The `data.logoAssetId` / `generationId` / `genJobId` / `sourceNodeId` validated locals are `string | null` (matching the nullable Prisma columns). The P2002 fallback returns `{ id: string }` consistent with `saveBrandKit`'s existing return.

**Note (F5 nullable-unique):** a plain `@@unique([ownerId, brandId])` would NOT dedup `brandId = null` (Postgres NULLs distinct) — the migration uses `COALESCE(brandId,'')`, which Prisma can't express in schema, so it lives in raw SQL with a schema comment. The app-level P2002 fallback closes the residual race.
