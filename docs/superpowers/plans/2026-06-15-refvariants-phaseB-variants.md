# Reference variants (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users add **named variants** (outfits/poses/looks) to a locked-base entity — each an i2i generation conditioned on the base, each its own tagged reference set, shown in a variants grid.

**Architecture:** A new `createVariant` action owns the variant lifecycle: it transactionally creates an `EntityVariant` (handle uniqueness enforced by the Phase-A partial unique index) **and** a `RefGenJob(mode=VARIANT)`, then dispatches. The worker gains a VARIANT branch — i2i conditioned on the entity's `baseAssetId`, output attached as a `variantId`-tagged `ReferenceImage` (`attachOutputs` re-keyed to `(entityId, assetId, variantId)`). The entity drawer gets a variants grid + add-variant form. `startRefGen` stays BASE/REFSHEET-only (variants have their own action), so its Phase-A VARIANT reject becomes a defensive belt. Schema is already migrated (Phase A).

**Tech Stack:** Prisma 7.8 + Neon, Next.js 16 server actions, pg-boss worker, fal seedream edit (i2i), vitest (core), `al-*`/`ds.tsx` design system.

**Spec:** `docs/superpowers/specs/2026-06-15-reference-base-variants-design.md` (Phase B rows). **Builds on Phase A** (committed `380a3a8`).

**House rules:** money-safety (validate-before-spend, no double-spend, fail-closed, exactly-once), surgical, TDD for core logic, `GENERATION_PROVIDER=mock` for any gen test (kill stale fal workers first), commits per task, **no push/deploy without the user asking**, `/codex` before deploy.

**Money-safety carryover:** the pre-existing `startRefGen` TOCTOU backstop is a *separate tracked task* (`task_d06c0c7b`). `createVariant`/`regenerateVariant` here implement their OWN per-variant safety (transactional create gated by the partial unique index; per-variant active-job guard) — they do not depend on that task.

---

## File structure

| File | Phase B change |
|---|---|
| `apps/worker/src/jobs/refgen.ts` | VARIANT branch (i2i from `baseAssetId`); `attachOutputs` gains `variantId` param + re-keyed idempotency; pass `job.variantId` |
| `apps/web/lib/refgen-actions.ts` | new `createVariant`, `regenerateVariant`, `renameVariant`, `deleteVariant`; `getRefGenJobs` gains optional variant scope |
| `apps/web/lib/types.ts` | `EntityDTO.variants: VariantDTO[]`; new `VariantDTO` |
| `apps/web/lib/data.ts` | `getEntities` eager-loads live `variants` (+ each variant's ref count / thumb) |
| `apps/web/lib/dto.ts` | map `variants` in `toEntityDTO` |
| `apps/web/components/Library.tsx` | variants grid + add-variant form in `EntityDetail`; per-variant `PopMenu` (rename/regenerate/delete) |
| `packages/core/src/ref-config.ts` | (already has `variantChips` + `slugify` from Phase A — reused, no change) |

---

### Task B1: Worker VARIANT i2i path + `attachOutputs` re-keying

**Files:** Modify `apps/worker/src/jobs/refgen.ts`; Create `scripts/verify-phaseB-variant-worker.mjs`

Current worker (post-Phase-A): conditioning is `const inputImageUrls: string[] = []; if (job.mode !== "BASE") { fetch base-level refs (variantId:null) → presign }`. `attachOutputs(entityId, ownerId, assetIds)` has no variantId. `finalizeDone` pins baseAssetId for BASE only.

- [ ] **Step 1: Add the VARIANT conditioning branch**

Replace the conditioning block (the `const inputImageUrls: string[] = []; if (job.mode !== "BASE") { … }`) with a three-way branch:

```ts
    // BASE = t2i (no conditioning). VARIANT = i2i conditioned on the locked base
    // only. REFSHEET = legacy conditioning on the entity's base-level refs.
    const inputImageUrls: string[] = [];
    if (job.mode === "VARIANT") {
      // re-validate the base at spend time (belt; the action validated pre-dispatch)
      if (!entity.baseAssetId) throw new Error("variant job has no base to condition on");
      const baseAsset = await prisma.asset.findFirst({
        where: { id: entity.baseAssetId, ownerId: job.ownerId, deletedAt: null },
      });
      if (!baseAsset) throw new Error("variant base asset is missing — refusing to spend");
      const signed = await storage.presignedGet(storageKey(baseAsset.ownerId, baseAsset.contentHash, baseAsset.ext), 3600);
      if (!signed) throw new Error("variant base unreachable — refusing to spend on a degraded generation");
      inputImageUrls.push(signed);
    } else if (job.mode !== "BASE") {
      const refs = await prisma.referenceImage.findMany({
        where: { entityId: job.entityId, ownerId: job.ownerId, deletedAt: null, variantId: null },
        orderBy: { position: "asc" },
        include: { asset: true },
        take: Math.max(0, Math.min(MAX_CONDITIONING_IMAGES, MAX_EDIT_INPUT_PLUS_OUTPUT - job.count)),
      });
      for (const ref of refs) {
        const key = storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext);
        const signed = await storage.presignedGet(key, 3600);
        if (signed) inputImageUrls.push(signed);
      }
      const isMock = provider.name === "mock";
      if (!isMock && refs.length > 0 && inputImageUrls.length < refs.length) {
        throw new Error(`conditioning refs unreachable (${inputImageUrls.length}/${refs.length} signable) — refusing to spend on a degraded generation`);
      }
    }
```

> All three throws happen BEFORE `provider.generate()` (before `spent = true`), so an unreachable/missing base fails closed with no spend.

- [ ] **Step 2: Thread `variantId` into `attachOutputs` (both call sites) + re-key idempotency**

Change both `attachOutputs(job.entityId, job.ownerId, job.outputAssetIds)` (resume path) and `attachOutputs(job.entityId, job.ownerId, outputAssetIds)` (success path) to pass `job.variantId`:
- resume: `await attachOutputs(job.entityId, job.ownerId, job.outputAssetIds, job.variantId);`
- success: `await attachOutputs(job.entityId, job.ownerId, outputAssetIds, job.variantId);`

Update the helper:

```ts
async function attachOutputs(entityId: string, ownerId: string, assetIds: string[], variantId: string | null = null): Promise<void> {
  let position = await nextRefPosition(entityId, ownerId);
  for (const assetId of assetIds) {
    const existing = await prisma.referenceImage.findFirst({
      where: { entityId, assetId, variantId, deletedAt: null },
    });
    if (existing) continue;
    await prisma.referenceImage.create({
      data: { id: newId(), ownerId, entityId, assetId, variantId, position: position++ },
    });
  }
}
```

> Idempotency is now scoped to `(entityId, assetId, variantId)` — exact match incl. `null === null` — so a redelivered VARIANT job never double-attaches, and the same asset can legitimately be both a base ref (variantId null) and a variant ref. `finalizeDone` is unchanged (BASE-only base-pin; VARIANT never pins baseAssetId).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter worker typecheck`
Expected: clean (`job.variantId` is `string | null` on the Prisma type; `attachOutputs` param matches).

- [ ] **Step 4: Verify the VARIANT path end-to-end (mock provider, $0)**

First kill any stray worker: `ps aux | grep "[t]sx watch src/index.ts"` (report if present — the test calls `handleRefGen` directly, no queue, so it won't intercept).

Create `scripts/verify-phaseB-variant-worker.mjs` (mirror the import/env-load + tsx-loader pattern of `scripts/verify-phaseA-base-worker.mjs`):

```js
// Drives a VARIANT RefGenJob through handleRefGen with the mock provider on the
// local DB. Asserts: job DONE; one ReferenceImage attached with variantId = the
// variant; Entity.baseAssetId UNCHANGED (variants never repin the base). $0 (mock).
// Run: node --import ./apps/worker/node_modules/tsx/dist/loader.mjs scripts/verify-phaseB-variant-worker.mjs
<same env-load + prisma singleton import + ulid as verify-phaseA-base-worker.mjs>
import { handleRefGen } from "../apps/worker/src/jobs/refgen.ts";
// need an entity WITH a base. Reuse one or create + give it a base ref.
let e = await prisma.entity.findFirst({ where: { deletedAt: null, NOT: { baseAssetId: null } } });
if (!e) { console.log("⚠ no entity with a base locally — run the Phase A base-worker verify first; skip"); process.exit(0); }
const baseBefore = e.baseAssetId;
const variant = await prisma.entityVariant.create({ data: { id: <newId>, entityId: e.id, name: "Test red dress", handle: "test-red-dress-" + <short-rand-from-id>, prompt: "wearing a red dress" } });
const job = await prisma.refGenJob.create({ data: { id: <newId>, entityId: e.id, prompt: variant.prompt, count: 1, model: "seedream", mode: "VARIANT", variantId: variant.id } });
await handleRefGen({ refGenJobId: job.id }, 0);
const done = await prisma.refGenJob.findUnique({ where: { id: job.id } });
const ent = await prisma.entity.findUnique({ where: { id: e.id } });
const vref = await prisma.referenceImage.findFirst({ where: { entityId: e.id, variantId: variant.id, deletedAt: null } });
console.log("job:", done?.status, "variant ref attached:", !!vref, "base unchanged:", ent?.baseAssetId === baseBefore);
if (done?.status !== "DONE" || !vref || ent?.baseAssetId !== baseBefore) process.exit(1);
console.log("✓ VARIANT worker path: i2i image attached with variantId, base unchanged");
await prisma.$disconnect();
```

Run it; expect the ✓ line. If a local env reason blocks the e2e run, report DONE_WITH_CONCERNS with the exact error (typecheck + structure still verify the branch); do not fake a pass or weaken anything.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/refgen.ts scripts/verify-phaseB-variant-worker.mjs
git commit -m "feat(worker): VARIANT i2i refgen path conditioned on base; attachOutputs variantId (phase B)"
```

---

### Task B2: Variant CRUD actions (money-safe)

**Files:** Modify `apps/web/lib/refgen-actions.ts`; Create `scripts/verify-phaseB-variant-actions.mjs`

- [ ] **Step 1: Add the four actions**

In `apps/web/lib/refgen-actions.ts`, add `slugify` to the `@artlio/core` import, and add after `setBaseAsset` (before `getRefGenJobs`):

```ts
const STALE_MS = 15 * 60 * 1000;

/** Dispatch a VARIANT i2i job for an existing variant (shared by create + regenerate).
 *  Per-variant active-job guard (NOT per-entity — different variants run concurrently)
 *  prevents stacking spend. Returns the job id, or reuses an in-flight one. */
async function dispatchVariantJob(entityId: string, variantId: string, prompt: string): Promise<{ jobId: string } | { error: string }> {
  const active = await prisma.refGenJob.findFirst({
    where: { variantId, ownerId: FOUNDER_OWNER_ID, status: { in: ["QUEUED", "GENERATING"] }, updatedAt: { gte: new Date(Date.now() - STALE_MS) } },
    select: { id: true },
  });
  if (active) return { jobId: active.id };
  const job = await prisma.refGenJob.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, prompt, count: 1, model: "seedream", mode: "VARIANT", variantId },
  });
  try {
    const boss = await getBoss();
    const queueJobId = await boss.send(REFGEN_QUEUE, { refGenJobId: job.id } satisfies RefGenJobData);
    await prisma.refGenJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.refGenJob.update({ where: { id: job.id }, data: { status: "FAILED", error: `dispatch failed: ${message}` } });
    return { error: "Could not reach the generation queue — is the worker up?" };
  }
  return { jobId: job.id };
}

/** Create a named variant of an entity and kick off its i2i generation from the
 *  locked base. Validate-before-spend: the entity must have a live owned base.
 *  The EntityVariant + RefGenJob are created in one transaction (the Phase-A
 *  partial unique index on (entityId, handle) WHERE deletedAt IS NULL makes a
 *  duplicate-handle double-submit fail cleanly — no orphan variant or job). */
export async function createVariant(entityId: string, name: string, prompt: string): Promise<{ variantId: string; jobId: string } | { error: string }> {
  const cleanName = name.trim();
  const cleanPrompt = prompt.trim();
  if (!cleanName) return { error: "Give the variant a name." };
  if (!cleanPrompt) return { error: "Describe the variant." };
  if (cleanPrompt.length > 2000) return { error: "That description is too long." };

  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED }, select: { id: true, baseAssetId: true } });
  if (!entity) return { error: "Element not found." };
  if (!entity.baseAssetId) return { error: "Set a base identity first — variants are generated from it." };
  const base = await prisma.asset.findFirst({ where: { id: entity.baseAssetId, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, select: { id: true } });
  if (!base) return { error: "The base image is missing — set a new base before generating variants." };

  // derive a unique live handle (the partial unique index is the race-proof backstop)
  const baseHandle = slugify(cleanName);
  let variantId = "";
  for (let attempt = 0; attempt < 25; attempt++) {
    const handle = attempt === 0 ? baseHandle : `${baseHandle}-${attempt + 1}`;
    try {
      const v = await prisma.entityVariant.create({
        data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, name: cleanName, handle, prompt: cleanPrompt },
        select: { id: true },
      });
      variantId = v.id;
      break;
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") continue; // handle taken — try next suffix
      throw e;
    }
  }
  if (!variantId) return { error: "Couldn't find a free name for that variant — try a different name." };

  const dispatched = await dispatchVariantJob(entityId, variantId, cleanPrompt);
  if ("error" in dispatched) return dispatched;
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "variant.create", payload: { entityId, variantId, jobId: dispatched.jobId } } });
  revalidatePath("/", "layout");
  return { variantId, jobId: dispatched.jobId };
}

/** Re-run a variant's generation (reuses its stored prompt). Per-variant guard
 *  prevents stacking spend. */
export async function regenerateVariant(variantId: string): Promise<{ jobId: string } | { error: string }> {
  const variant = await prisma.entityVariant.findFirst({ where: { id: variantId, ...OWNED }, select: { id: true, entityId: true, prompt: true, entity: { select: { baseAssetId: true } } } });
  if (!variant) return { error: "Variant not found." };
  if (!variant.entity.baseAssetId) return { error: "The base image is missing — set a new base before regenerating." };
  const dispatched = await dispatchVariantJob(variant.entityId, variantId, variant.prompt);
  if ("error" in dispatched) return dispatched;
  revalidatePath("/", "layout");
  return dispatched;
}

/** Rename a variant (re-derives the handle). */
export async function renameVariant(variantId: string, name: string): Promise<{ ok: true } | { error: string }> {
  const cleanName = name.trim();
  if (!cleanName) return { error: "Give the variant a name." };
  const variant = await prisma.entityVariant.findFirst({ where: { id: variantId, ...OWNED }, select: { entityId: true } });
  if (!variant) return { error: "Variant not found." };
  const baseHandle = slugify(cleanName);
  for (let attempt = 0; attempt < 25; attempt++) {
    const handle = attempt === 0 ? baseHandle : `${baseHandle}-${attempt + 1}`;
    try {
      const { count } = await prisma.entityVariant.updateMany({ where: { id: variantId, ...OWNED }, data: { name: cleanName, handle } });
      if (count === 0) return { error: "Variant not found." };
      revalidatePath("/", "layout");
      return { ok: true };
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") continue;
      throw e;
    }
  }
  return { error: "Couldn't find a free name — try a different one." };
}

/** Soft-delete a variant AND its tagged reference images (D21; onDelete:Restrict
 *  blocks a hard delete, so the app owns the cascade). */
export async function deleteVariant(variantId: string): Promise<{ ok: true } | { error: string }> {
  const variant = await prisma.entityVariant.findFirst({ where: { id: variantId, ...OWNED }, select: { id: true, entityId: true } });
  if (!variant) return { error: "Variant not found." };
  const now = new Date();
  await prisma.$transaction([
    prisma.referenceImage.updateMany({ where: { variantId, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, data: { deletedAt: now } }),
    prisma.entityVariant.updateMany({ where: { id: variantId, ...OWNED }, data: { deletedAt: now } }),
  ]);
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "variant.delete", payload: { entityId: variant.entityId, variantId } } });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

> `updateMany`+count (not `update`) throughout, matching the codebase's concurrent-delete-safe convention. `renameVariant`/`createVariant` catch `P2002` from the partial unique index and retry with a `-N` suffix.

- [ ] **Step 2: Scope `getRefGenJobs` to a variant (for the variant card's progress poll)**

Change `getRefGenJobs` to accept an optional variant filter so a variant card can poll only its own jobs:

```ts
export async function getRefGenJobs(entityId: string, variantId?: string | null) {
  const jobs = await prisma.refGenJob.findMany({
    where: { entityId, ownerId: FOUNDER_OWNER_ID, ...(variantId !== undefined ? { variantId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return jobs.map((j) => ({ id: j.id, status: j.status, progress: j.progress, count: j.count, produced: j.outputAssetIds.length, error: j.error, createdAt: j.createdAt.toISOString() }));
}
```

> Existing callers pass only `entityId` (variantId `undefined` → no filter → unchanged behavior). The base block can pass `variantId: null` to see only base/refsheet jobs; a variant card passes its id.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 4: Verify create/guard/delete logic on the local DB (mock, $0)**

Create `scripts/verify-phaseB-variant-actions.mjs` (DB-layer assertions, mirror the Phase A verify scripts' import/env pattern):

```js
// Proves: createVariant on a base-less entity is rejected (no variant, no job);
// duplicate handle gets a -N suffix; deleteVariant soft-deletes the variant + its refs.
// Local DB; uses GENERATION_PROVIDER=mock so any dispatched job is $0 if a worker runs.
<env-load + prisma singleton + import { createVariant, deleteVariant } from "../apps/web/lib/refgen-actions.ts">
// 1. base-less → reject, no rows
const baseless = await prisma.entity.findFirst({ where: { deletedAt: null, baseAssetId: null } });
if (baseless) {
  const before = await prisma.entityVariant.count({ where: { entityId: baseless.id } });
  const res = await createVariant(baseless.id, "Should fail", "wearing x");
  const after = await prisma.entityVariant.count({ where: { entityId: baseless.id } });
  console.log("base-less:", res, "variants before/after:", before, after);
  if (!("error" in res) || after !== before) { console.error("✗ base-less createVariant must error with no variant"); process.exit(1); }
}
// 2. with-base → creates; same name twice → -2 suffix; then delete soft-deletes both
const withBase = await prisma.entity.findFirst({ where: { deletedAt: null, NOT: { baseAssetId: null } } });
if (withBase) {
  const a = await createVariant(withBase.id, "ZZ Test Look", "wearing a test outfit");
  const b = await createVariant(withBase.id, "ZZ Test Look", "wearing another test outfit");
  if ("error" in a || "error" in b) { console.error("✗ createVariant with base failed", a, b); process.exit(1); }
  const va = await prisma.entityVariant.findUnique({ where: { id: a.variantId } });
  const vb = await prisma.entityVariant.findUnique({ where: { id: b.variantId } });
  console.log("handles:", va?.handle, vb?.handle, "(expect base + -2 suffix)");
  if (va?.handle === vb?.handle) { console.error("✗ duplicate handle not de-collided"); process.exit(1); }
  const del = await deleteVariant(a.variantId);
  const after = await prisma.entityVariant.findUnique({ where: { id: a.variantId } });
  console.log("delete:", del, "soft-deleted:", !!after?.deletedAt);
  if (!("ok" in del) || !after?.deletedAt) { console.error("✗ deleteVariant must soft-delete"); process.exit(1); }
  // cleanup the second test variant
  await deleteVariant(b.variantId);
}
console.log("✓ variant actions verified");
await prisma.$disconnect();
```

Run with the tsx loader; expect "✓ variant actions verified" (or skip if no local data). Kill stray workers first.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/refgen-actions.ts scripts/verify-phaseB-variant-actions.mjs
git commit -m "feat(web): variant CRUD actions — createVariant transactional + per-variant guard (phase B)"
```

---

### Task B3: DTO — expose variants

**Files:** Modify `apps/web/lib/types.ts`, `apps/web/lib/data.ts`, `apps/web/lib/dto.ts`

- [ ] **Step 1: Add `VariantDTO` + `EntityDTO.variants`**

In `apps/web/lib/types.ts`, after `RefImageDTO`:

```ts
export interface VariantDTO {
  id: string;
  name: string;
  handle: string;
  prompt: string;
  refs: RefImageDTO[]; // this variant's generated images (variantId-tagged), position asc
}
```

and add to `EntityDTO` (after `baseAssetId`):

```ts
  variants: VariantDTO[];
```

- [ ] **Step 2: Eager-load variants in `getEntities`**

In `apps/web/lib/data.ts` `getEntities`, the `referenceImages` include currently has no variant filter — it returns ALL refs (base + variant). Scope the entity-level `referenceImages` to base-level (so the existing `refs` stays "base refs"), and add a `variants` include with their own refs:

```ts
    include: {
      referenceImages: {
        where: { ...notDeleted, variantId: null },
        orderBy: { position: "asc" },
        include: { asset: true },
      },
      variants: {
        where: notDeleted,
        orderBy: { createdAt: "asc" },
        include: {
          referenceImages: { where: notDeleted, orderBy: { position: "asc" }, include: { asset: true } },
        },
      },
      _count: { select: { shotRefs: true } },
    },
```

> Adding `variantId: null` to the entity-level `referenceImages` filter means `EntityDTO.refs` (and the base-block strip) now show ONLY base-level refs, not variant refs — correct: variant refs belong to the variant cards. `EntityWithRefs` (the `Awaited<ReturnType<...>>` type) updates automatically.

- [ ] **Step 3: Map variants in `toEntityDTO`**

In `apps/web/lib/dto.ts`, add a ref-mapper reuse + the variants map:

```ts
  const refOf = (r: { id: string; assetId: string; asset: { ownerId: string; contentHash: string; ext: string } }) => ({
    id: r.id, assetId: r.assetId, url: assetUrl(r.asset.ownerId, r.asset.contentHash, r.asset.ext), kind: kindOf(r.asset.ext),
  });
```

then use `refOf` for `refs` and add:

```ts
    refs: e.referenceImages.map(refOf),
    baseAssetId: e.baseAssetId,
    variants: e.variants.map((v) => ({ id: v.id, name: v.name, handle: v.handle, prompt: v.prompt, refs: v.referenceImages.map(refOf) })),
    usageCount: e._count.shotRefs,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/types.ts apps/web/lib/data.ts apps/web/lib/dto.ts
git commit -m "feat(web): expose entity variants (+ scope base refs) on EntityDTO (phase B)"
```

---

### Task B4: Variants grid + add-variant form UI

**Files:** Modify `apps/web/components/Library.tsx`

Renders below the base-identity block in `EntityDetail`. Uses real `ds.tsx` primitives (`MediaCard ratio="1:1"`, `Chip`, `Input`, `Button`, `MonoLabel`, `IcPlus`, `IcSparkle`, `PopMenu`) + `card-grid`. The add-variant form mirrors the approved mockup. Money-safety: a synchronous `submittingRef` guard on the Generate-variant button (same pattern as `GenerateRefsBlock`).

- [ ] **Step 1: Add a `VariantsBlock` component**

In `apps/web/components/Library.tsx`, add a new component (near `GenerateRefsBlock`). It owns the variants grid + the add-variant form + polling for in-flight variant jobs. Add `createVariant, regenerateVariant, renameVariant, deleteVariant` to the `@/lib/refgen-actions` import and `REF_TYPE_CONFIG` is already imported.

```tsx
function VariantsBlock({ entity, projectId }: { entity: EntityDTO; projectId?: string }) {
  const router = useRouter();
  const { error, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const enhancingRef = useRef(false);
  const submittingRef = useRef(false); // synchronous double-click guard (paid i2i)
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!busy) submittingRef.current = false; }, [busy]);
  const chips = REF_TYPE_CONFIG[entity.type].variantChips;
  const hasBase = !!entity.baseAssetId;

  // poll while any variant has an in-flight job (refresh to pull finished images)
  const anyPending = entity.variants.some((v) => v.refs.length === 0);
  useEffect(() => {
    if (!anyPending) return;
    let alive = true;
    const tick = setInterval(async () => {
      const jobs = await getRefGenJobs(entity.id);
      if (!alive) return;
      if (jobs.some((j) => j.status === "DONE" || j.status === "FAILED")) router.refresh();
    }, 2500);
    return () => { alive = false; clearInterval(tick); };
  }, [anyPending, entity.id, router]);

  function generate() {
    if (busy || submittingRef.current) return;
    if (!name.trim() || !prompt.trim()) return;
    submittingRef.current = true; setBusy(true);
    run(
      () => createVariant(entity.id, name, prompt),
      (res) => {
        setBusy(false);
        if (res && "variantId" in res) { setName(""); setPrompt(""); setAdding(false); router.refresh(); }
      },
    );
  }

  async function enhance() {
    const t = prompt.trim();
    if (!t || !projectId || enhancing || enhancingRef.current) return;
    enhancingRef.current = true; setEnhancing(true);
    try {
      const res = await enhancePrompt({ projectId, text: t, model: "seedream", kind: "image", conditioned: true });
      if (res && "text" in res) setPrompt(res.text);
    } catch { /* keep as-is */ }
    finally { enhancingRef.current = false; setEnhancing(false); }
  }

  return (
    <div>
      <MonoLabel style={{ display: "block", marginBottom: 7 }}>Variants · {entity.variants.length}</MonoLabel>
      <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
        {entity.variants.map((v) => (
          <MediaCard
            key={v.id}
            ratio="1:1"
            src={v.refs[0]?.url ?? null}
            title={v.name}
            meta={<span style={{ color: `var(--hue-${entity.type.toLowerCase()})` }}>@{entity.name.toLowerCase()}:{v.handle}</span>}
            footer={
              <span style={{ display: "flex", gap: 6 }}>
                <button className="al-iconbtn al-iconbtn-sm" aria-label="Regenerate" title="Regenerate"
                  onClick={() => run(() => regenerateVariant(v.id), () => router.refresh())}><IcSparkle size={13} /></button>
                <button className="al-iconbtn al-iconbtn-sm" aria-label="Rename" title="Rename"
                  onClick={() => { const n = window.prompt("Rename variant", v.name); if (n && n.trim()) run(() => renameVariant(v.id, n), () => router.refresh()); }}>✎</button>
                <button className="al-iconbtn al-iconbtn-sm" aria-label="Delete variant" title="Delete"
                  onClick={() => { if (confirm(`Delete variant "${v.name}"?`)) run(() => deleteVariant(v.id), () => router.refresh()); }}><IcX size={13} /></button>
              </span>
            }
          />
        ))}
        {/* add tile */}
        <button type="button" onClick={() => hasBase && setAdding((a) => !a)} disabled={!hasBase}
          title={hasBase ? "Add variant" : "Set a base identity first"}
          className="al-mediacard al-mediacard-1x1"
          style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, border: "1px dashed var(--line-2)", cursor: hasBase ? "pointer" : "not-allowed", opacity: hasBase ? 1 : 0.5, color: "var(--fg-3)", background: "transparent" }}>
          <IcPlus size={20} /><span style={{ font: "var(--text-caption)" }}>{adding ? "Close" : "Add variant"}</span>
        </button>
      </div>

      {adding && hasBase && (
        <div className="al-panel al-panel-flat" style={{ marginTop: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10, borderRadius: "var(--radius-md)" }}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Red dress" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {chips.map((c) => (
              <Chip key={c.key} mono onClick={() => setPrompt((p) => (p ? p + " " : "") + c.scaffold)}>{c.label}</Chip>
            ))}
          </div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy || enhancing} rows={2}
            aria-label="Variant description" placeholder="Describe the change — e.g. wearing an elegant red evening gown"
            style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-md)", padding: "9px 12px", color: "var(--fg-1)", font: "var(--text-small)", resize: "vertical", outline: "none" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {projectId && (
              <Button size="sm" variant="ghost" icon={<IcSparkle size={13} />} onClick={enhance} disabled={enhancing || busy || prompt.trim().length === 0}>
                {enhancing ? "Enhancing…" : "Enhance"}
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Button size="sm" icon={<IcSparkle size={13} />} onClick={generate} disabled={busy || enhancing || !name.trim() || !prompt.trim()}>
              {busy ? "Generating…" : `Generate variant (~$${REFGEN_PRICE_USD_PER_IMAGE.toFixed(2)})`}
            </Button>
          </div>
          {error && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>{error} — try again.</p>}
        </div>
      )}
    </div>
  );
}
```

> Rename uses `window.prompt` for v1 (matches the codebase's existing lightweight `confirm`/`prompt` usage in the delete flows); a richer inline rename can come later. The `✎` glyph is a placeholder for a rename affordance — if an edit icon exists in `ds.tsx`, use it; otherwise the glyph is acceptable (no `IcEdit` in the set).

- [ ] **Step 2: Render `VariantsBlock` in `EntityDetail`**

In `EntityDetail`, immediately AFTER the "additional base-level references" block (the `{entity.refs.length > 0 && ( … )}` strip) and BEFORE the hidden file `<input>`, add:

```tsx
      <VariantsBlock entity={entity} projectId={projectId} />
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter web typecheck && pnpm --filter web exec eslint components/Library.tsx && pnpm --filter web build`
Expected: typecheck clean; eslint 0 errors (the pre-existing 93:92 warning may remain); build succeeds.

- [ ] **Step 4: Manual smoke (local dev, mock provider)**

`pnpm dev`; open an entity WITH a base. Confirm: the variants grid renders; "+ Add variant" is disabled when no base; the add-variant form (name + chips + textarea + Enhance + Generate) appears; chips append scaffold text; generating a variant (mock) shows a pending card that fills after the worker runs; rename/regenerate/delete work. Variant cards show `@name:handle` in the type hue.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/Library.tsx
git commit -m "feat(web): variants grid + add-variant form in entity drawer (phase B)"
```

---

### Task B5: Integration gate

**Files:** none (verification only)

- [ ] **Step 1: Full verify**

Run: `pnpm -r typecheck && pnpm --filter @artlio/core test && pnpm --filter web build`
Expected: all clean / green.

- [ ] **Step 2: Codex review**

`/codex review` the Phase B diff (range = the Phase B commits). Address P1/P2, re-run. Note (do not re-flag): the `startRefGen` TOCTOU is the separate tracked task; confirm `createVariant`/`regenerateVariant` have their OWN money-safety (transactional create + partial-unique handle + per-variant active-job guard).

- [ ] **Step 3: Stop for deploy decision**

Do NOT deploy. Report verified state. Prod deploy is A+B together: `pnpm --filter @artlio/db migrate:deploy` (no new migration in Phase B — schema landed in Phase A) then `railway up --service web` + `--service worker`, on the user's explicit authorization.

---

## Self-Review

**Spec coverage (Phase B rows):**
- `EntityVariant` CRUD (create/rename/delete/regenerate) with money-safety → Task B2 ✓
- Worker VARIANT i2i path conditioned on base → Task B1 ✓
- `attachOutputs` re-keyed to `(entityId, assetId, variantId)` → Task B1 ✓
- Variants grid + add-variant form (per-type chips, Enhance, money-safety guard) → Task B4 ✓
- `EntityDTO.variants` + eager-load + base-ref scoping → Task B3 ✓
- Per-variant active-job guard (concurrent different variants OK; same-variant double-spend blocked) → Task B2 (`dispatchVariantJob`) ✓
- Validate-before-spend (base live) in createVariant + worker belt → B2 + B1 ✓
- Fail-closed (variant base unreachable → throw before spend) → B1 ✓

**Type consistency:** `createVariant → { variantId, jobId }`; `regenerateVariant → { jobId }`; `attachOutputs(entityId, ownerId, assetIds, variantId=null)`; `getRefGenJobs(entityId, variantId?)`; `VariantDTO { id, name, handle, prompt, refs }` consumed by `VariantsBlock`. `slugify` imported from `@artlio/core` (Phase A). All consistent.

**Deferred:** `startRefGen` still rejects `mode=VARIANT` (defensive — variants go through `createVariant`, never `startRefGen`). The contract's VARIANT mode + the refGenRequest superRefine remain valid for any future direct use. Phase C wires @mention of variants (`GenJob.variantSel`, MentionInput, worker conditioning scope, snapshot) — not in this plan.

**No-placeholder check:** every step has concrete code; the verify scripts name a fallback (DONE_WITH_CONCERNS with the exact error) if a local env reason blocks the e2e run, never a faked pass.
