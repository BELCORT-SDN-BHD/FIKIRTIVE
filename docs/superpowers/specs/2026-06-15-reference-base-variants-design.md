# Reference: base identity + named variants — design

> Status: design approved (UX/layout + architecture); pending user review of this written spec.
> Author: pairing session 2026-06-15. Supersedes the "reference sheet" generation model.

## Goal

Replace the single freeform "generate a reference sheet" flow with a **Higgsfield-style** model that applies to **every entity type** (CHARACTER, LOCATION, PRODUCT, BRAND, and future types):

1. **One locked base** reference per entity — the identity anchor. Established by **upload** (0 spend) or **t2i generate**.
2. **Named variants** — outfits / poses / angles / looks — each generated **i2i from the base** (so identity stays consistent), each **separately @mentionable** (`@mira:red-dress`).

## Non-goals

- No change to video generation, the editor, or storyboard render.
- No multi-user / ownership changes (still `FOUNDER_OWNER_ID`).
- No new fal provider code — the existing seedream t2i/edit routing already covers base (t2i) and variant (i2i).
- Phase C does not support the same entity mentioned twice with *different* variants in one prompt (one variant selection per entity per prompt — see §7).

## Mental model

```
Entity (character "Mira")
 ├── baseAssetId ─────────────► the ONE locked canonical image (upload or t2i)
 ├── ReferenceImage[] (variantId = null)   ← base-level refs (incl. the base)
 └── EntityVariant[]
       ├── "Red dress"  (handle red-dress)  → ReferenceImage[] (variantId = this)
       └── "Beach look" (handle beach)      → ReferenceImage[] (variantId = this)
```

- A **variant's image(s)** are ordinary `ReferenceImage` rows tagged with `variantId`. This reuses the entire existing storage + attach + conditioning machinery.
- `EntityVariant` is a **thin registry** (name + handle + the prompt used). It does not store the asset directly.
- The **base** is one of the entity's `variantId = null` refs, pinned by `Entity.baseAssetId`. It is the i2i conditioning anchor for variant generation.

## Per-type config (the generalization)

Today, per-type knowledge is scattered: `TYPE_META` (Library.tsx:20–25), `TYPE_ORDER` (26), `EMPTY_HINTS` (28–33), and the `buildReferencePrompt` switch (404–417). The redesign **consolidates the reference-specific per-type knowledge** into one config object (extend `TYPE_META` or a sibling `TYPE_REF_CONFIG` in `apps/web/components/Library.tsx`) so adding a future type is one edit:

```ts
// apps/web/lib/ref-config.ts (new, imported by Library.tsx + worker via packages/core if needed)
type RefTypeConfig = {
  basePrompt: (e: { name: string; notes: string; negativeConstraints: string }) => string;
  baseHint: string;            // "One clean full-body photo — the identity anchor."
  variantChips: { key: string; label: string; scaffold: string }[];
};
```

Per-type chip taxonomy (chips scaffold the variant prompt; user can still free-type + Enhance):

| Type | base prompt (keep current intent) | variant chips |
|---|---|---|
| CHARACTER | full-body, neutral expression, plain studio bg | Outfit / Pose / Angle / Expression |
| LOCATION | wide establishing shot, consistent architecture/lighting | Time of day / Angle / Weather / Season |
| PRODUCT | clean studio shot, neutral bg, consistent materials | Color / Angle / Material / Packaging |
| BRAND | primary logo lockup, consistent identity | Light bg / Dark bg / Treatment / Layout |

`basePrompt` reuses the existing per-type strings from `buildReferencePrompt` (trimmed to a single canonical shot rather than a multi-view sheet). `buildReferencePrompt` is replaced by `TYPE_REF_CONFIG[type].basePrompt`.

## UX (approved layout, real `al-*` design system)

Lives in the entity detail drawer (`Library.tsx` `EntityDetail`, lines 573–810), replacing the current thumb-strip + `GenerateRefsBlock`. Uses real `ds.tsx` wrappers + `al-*` classes — no invented styling. **Verified primitives** (icon set has 21 icons; `IcUpload`/`IcLock` do **not** exist): `Button` (variant `primary|glass|ghost|danger`, size `sm|md|lg`), `MediaCard` (ratio `16:9|9:16|1:1`), `Chip` (interactive, `selected`), `Badge` (tone `neutral|positive|warning|danger|accent`), `MonoLabel`, `Input` (label/hint, wraps `al-field`), `IconButton`, `PopMenu`; icons `IcSparkle`, `IcPlus`, `IcImage`, `IcCheck`, `IcX`. `card-grid` is a plain CSS utility (not `al-`-prefixed) — keep the name.

**1. Base identity block** (`MonoLabel` "BASE IDENTITY"):
- A single `MediaCard ratio="1:1"` (the locked base) with a small `Badge tone="accent"` text "locked" (no icon — there is no `IcLock`).
- If no base yet: an empty `MediaCard ratio="1:1"` placeholder + two `Button`s: `Upload photo` (variant=glass, `IcImage`) and `Generate (t2i)` (variant=glass, `IcSparkle`).
- "Generate (t2i)" opens an inline prompt (prefilled from `basePrompt`) + `Enhance` + `Generate` → `startRefGen` mode=BASE.
- Uploading sets `baseAssetId` to the uploaded asset (existing upload path, then a `setBaseAsset` action).

**2. Variants grid** (`MonoLabel` "VARIANTS — outfits, poses… · each @mentionable"):
- `card-grid` of `MediaCard ratio="1:1"` variant cards: thumb + name + `@handle` (in `--hue-{type}` color), per-card `PopMenu` (rename / delete / regenerate).
- An `+ Add variant` dashed tile (`IcPlus`) that toggles the add-variant form.
- A variant card with no image yet shows a spinner while its `RefGenJob` polls (reuse `GenerateRefsBlock`'s polling).

**3. Add-variant form** (inline-toggled `al-panel-flat` — **not** a `Dialog`; mirrors the approved mockup):
- `Input` Name ("Red dress") — ds.tsx `Input` (wraps `al-field`).
- Quick-add `Chip` row from `variantChips`; `onClick` appends the chip's `scaffold` text to the prompt.
- `textarea` prompt (the change, e.g. "wearing an elegant red evening gown").
- `Enhance` (`Button` ghost sm, `IcSparkle`) + `Generate variant` (`Button` primary, `IcSparkle`).
- Disabled when no base exists (with hint "Set a base identity first"); disabled while `submittingRef.current` / `enhancingRef.current`.

## Data model

All new models/fields follow the house conventions confirmed in recon: ULID `@id` via `newId()`, `ownerId String @default("founder")`, soft-delete `deletedAt DateTime?`, `createdAt`/`updatedAt`, `@@index([ownerId, deletedAt])`, relations `onDelete: Restrict`.

```prisma
// packages/db/prisma/schema.prisma

enum RefGenMode {
  REFSHEET   // legacy / default for pre-existing jobs
  BASE       // t2i single image → sets Entity.baseAssetId
  VARIANT    // i2i single image conditioned on base → tagged with variantId
}

model EntityVariant {
  id        String    @id
  ownerId   String    @default("founder")
  entityId  String
  name      String                       // "Red dress"
  handle    String                       // "red-dress" → @mira:red-dress
  prompt    String    @default("")        // the change description used to generate
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  // soft-delete: deleteVariant() also soft-deletes its refs (onDelete:Restrict blocks hard-delete)
  entity          Entity           @relation(fields: [entityId], references: [id], onDelete: Restrict)
  referenceImages ReferenceImage[]

  @@index([ownerId, deletedAt])
  @@index([entityId, deletedAt])
}
```

**Handle uniqueness** is a *partial* unique index (Prisma can't express conditional uniqueness, so it's raw SQL in the migration) — this frees a handle for reuse once its variant is soft-deleted:

```sql
CREATE UNIQUE INDEX "EntityVariant_entityId_handle_live"
  ON "EntityVariant" ("entityId", "handle") WHERE "deletedAt" IS NULL;
```

`handle = slugify(name)` (lowercase, non-alnum → `-`); on collision `createVariant` appends `-2`, `-3`, … (loop until the partial index accepts, catching the unique violation). The DB index is the race-proof backstop.

Modified models:

```prisma
model Entity {
  // ...existing...
  baseAssetId String?           // locked canonical base image (an Asset id); soft pointer
                                // (no FK) — must be re-validated live in refgen-actions before
                                // any mode=VARIANT spend. Safe from the D21 sweep while a
                                // base-level ReferenceImage points at the same asset.
  variants    EntityVariant[]   // new relation
}

model ReferenceImage {
  // ...existing: id, ownerId, entityId, assetId, position, note, viewTag, deletedAt...
  variantId String?            // null = base/entity-level ref; set = belongs to that variant
  variant   EntityVariant? @relation(fields: [variantId], references: [id], onDelete: Restrict)
  @@index([entityId, variantId, deletedAt])   // serves BOTH "all base refs" (variantId IS NULL)
                                               // and "this variant's refs" (variantId = x)
}

model RefGenJob {
  // ...existing...
  mode      RefGenMode @default(REFSHEET)
  variantId String?               // set when mode = VARIANT; no FK (validated in app before spend)
}

model GenJob {
  // ...existing: entityIds String[] ... (UNCHANGED) ...
  variantSel Json?    // Phase C: { [entityId]: variantId } — which variant each mention selected;
                      // null/absent = base refs for all mentions (backward-compat with old rows)
}
```

> `attachOutputs`' idempotency key must become `(entityId, assetId, variantId)` — see §money-safety. The existing `@@index`/unique behavior on ReferenceImage is otherwise unchanged.

### Migration

- `pnpm db:migrate` locally (prisma migrate dev) → checked-in migration under `packages/db/prisma/migrations/`.
- **One migration for all three phases.** Every change is additive + nullable, so A, B, and C's `GenJob.variantSel` go in a single migration; the field is simply unpopulated until Phase C ships. This avoids a second prod migrate.
- **`RefGenMode` column**: add as `NOT NULL DEFAULT 'REFSHEET'` so pre-existing rows backfill to `REFSHEET` (a nullable enum would leave old rows `NULL` and force defensive `?? 'REFSHEET'` reads everywhere — avoid).
- **Partial unique index** on `EntityVariant(entityId, handle) WHERE deletedAt IS NULL` (raw SQL, appended to the generated migration — `prisma migrate dev` won't emit it from the schema).
- **Backfill `Entity.baseAssetId`** — idempotent, only touches null rows, correctly leaves ref-less entities null:

```sql
UPDATE "Entity" e
SET "baseAssetId" = (
  SELECT r."assetId" FROM "ReferenceImage" r
  WHERE r."entityId" = e."id" AND r."variantId" IS NULL AND r."deletedAt" IS NULL
  ORDER BY r."position" ASC LIMIT 1
)
WHERE e."deletedAt" IS NULL AND e."baseAssetId" IS NULL;
```

- Prod: `pnpm --filter @fikirtive/db migrate:deploy` (direct `DATABASE_URL`), before web/worker restart. Secrets read from `~/.gstack/projects/fikirtive/secrets/cloud.env`, never printed.

## Generation flow + money-safety

Reuses the `startRefGen` → `RefGenJob` → worker `handleRefGen` pipeline (recon §3). The money-safety invariants are preserved exactly:

- **Contract** (`packages/core/src/refgen.ts`, `refGenRequest`): add `mode: z.enum(["REFSHEET","BASE","VARIANT"]).default("REFSHEET")` + `variantId: z.string().min(1).max(64).nullish()`, with a `superRefine`: `mode==="VARIANT"` ⟺ `variantId` present (reject mismatch). Mode is part of the validated contract, not a loose param.
- **Validate before spend** (`refgen-actions.ts`, in `startRefGen`, after the existing owner/deleted entity check and **before** `RefGenJob.create`): for `mode==="VARIANT"`, load `entity.baseAssetId`, then `prisma.asset.findFirst({ id: baseAssetId, ownerId, deletedAt: null })`; if null → return error, **no job created, no spend**. For `mode==="BASE"`, no base precondition.
- **Atomic claim** (worker): `updateMany WHERE status=QUEUED → GENERATING`, `count===0` ⇒ lost claim, abort.
- **Exactly-once**: `spent` flips at `provider.generate()` return; `outputAssetIds` written **before** `attachOutputs`; `attachOutputs` idempotent — scope re-keyed to **`(entityId, assetId, variantId)`** (see worker note) so a redelivered VARIANT job never double-attaches.
- **Synchronous double-click guard** (UI): `submittingRef`/`enhancingRef` (existing pattern) on every paid button (base generate, variant generate, enhance).

**Worker conditioning per mode** (`apps/worker/src/jobs/refgen.ts`, branch on `job.mode`):
- `BASE`: `inputImageUrls = []` → seedream **t2i** → 1 image → `attachOutputs(…, variantId=null)` → **in the same transaction as the `status=DONE` flip**, `UPDATE Entity SET baseAssetId = outputAssetIds[0]`. (Setting `baseAssetId` *with* DONE means a crash before DONE leaves the job resumable and `baseAssetId` unset-or-set atomically — never a DONE job with a null base.)
- `VARIANT`: re-validate `Entity.baseAssetId` live → presign it → `inputImageUrls = [signedBaseUrl]` → seedream **edit (i2i)** → 1 image → `attachOutputs(…, variantId=job.variantId)`.
- `REFSHEET`: unchanged legacy path.

`attachOutputs(entityId, ownerId, assetIds, variantId = null)` — the existing-row check becomes `findFirst({ where: { entityId, assetId, variantId, deletedAt: null } })` and `ReferenceImage.create` sets `variantId`. Exact match including `null === null`.

### New/changed server actions (`apps/web/lib/refgen-actions.ts` + `actions.ts`)

- `startRefGen` — parse `mode` + `variantId` via the updated contract; validate per mode (above).
- `createVariant(entityId, name, prompt)` — **money-safety critical**: (1) derive `handle = slugify(name)`; (2) in a single `prisma.$transaction`, create the `EntityVariant` (the partial unique index rejects a duplicate live handle → a double-click's second call fails cleanly, **no second variant, no second job**) **and** the `RefGenJob` (mode=VARIANT, `variantId`); (3) dispatch to the queue. Either both rows commit or neither. Returns `{ variantId, jobId }`.
- `regenerateVariant(variantId)` — **money-safety critical**: before creating a new `RefGenJob`, guard on a *per-variant* active job: `findFirst({ where: { variantId, ownerId, status: { in: ["QUEUED","GENERATING"] } } })` → if one exists, return it (don't spend again). Then dispatch a fresh mode=VARIANT job reusing the variant's stored `prompt`.
- `renameVariant(variantId, name)` — updates `name` + re-derives `handle` (collision loop as above). `deleteVariant(variantId)` — soft-delete the variant **and** soft-delete its refs (the `onDelete:Restrict` FK blocks any hard delete; app owns the cascade, D21 pattern).
- `setBaseAsset(entityId, assetId)` — validates the asset is an owned, live ref of this entity, then pins `baseAssetId` (used after upload, or to re-pick the base).

## @mention integration (Phase C — heaviest, ship last, verify separately)

Recon §4 mapped the full path. Surgical, **additive** approach (keep `entityIds`, add a variant selection map):

1. **`packages/core/src/gen.ts`** `genRequest`: add `variantSel: z.record(z.string().max(64)).optional()` (`{[entityId]: variantId}`). `entityIds` unchanged.
2. **`MentionInput.tsx`**: dropdown shows entity + its variants (`Mira`, `Mira · red dress`); a variant pick stores `attrs.variantId`. `resolveDoc()` returns `{ text, ids, variantSel }`; `buildMentionDoc()` (post-Enhance rebuild) preserves `variantId`.
3. **`EntityDTO`** (`types.ts` + `dto.ts`): add `variants: { id, name, handle }[]` so the dropdown has data. `getEntities()` (`data.ts`) eager-loads `variants` (deletedAt null).
4. **`GenSpace.tsx` / `Storyboard.tsx`**: thread `variantSel` from the mention onChange into `startGen`.
5. **`gen-actions.ts`** `startGen`: store `variantSel` on `GenJob`.
6. **`cowork-guardian.ts`** `checkCast` (pre-spend, fail-closed): for each mention with a variant, load the `EntityVariant` (live) and count its live refs (`ReferenceImage WHERE entityId, variantId, deletedAt null`); if the variant is missing/deleted **or** has 0 refs → block ("Variant has no images — pick another or use the base"). The existing **"no refs" block** (`cowork-guardian.ts:36`) is re-scoped: a CHARACTER passes if it has either a live `baseAssetId` **or** ≥1 base-level ref; a *bare* @mention conditions on base-level refs as today.
7. **Worker `gen.ts` (158–175)**, per mentioned entity: if `variantSel[entityId]` set → fetch `ReferenceImage WHERE entityId AND variantId = sel AND deletedAt null`; **if that count is 0, throw before `provider.generate()` (fail closed — never degrade to an unconditioned t2i and spend)**. Else fetch base-level refs (`variantId IS NULL`). A GenJob with no `variantSel` behaves exactly as today. `MAX_CONDITIONING_IMAGES` continues to cap the per-request total; a variant scopes to its own refs (v1 = 1 image).
8. **`entity-snapshot.ts`**: extend the frozen snapshot to `{ id, name, type, variantId?, refHashes }` — when `variantSel` selected a variant, capture that `variantId` and hash **only the variant's refs**, so provenance records exactly which look was used.

> A variant mention is only valid when the entity has a live base (i2i needs an anchor). If `entity.baseAssetId` is null, variants can't have been generated, so this case can't arise in normal flow; the guardian's variant check (0 refs → block) covers any stale selection. `usageCount` stays entity-wide (no per-variant usage tracking in v1).

## Phasing

| Phase | Scope | Risk | Ships |
|---|---|---|---|
| **A — Base identity** | `Entity.baseAssetId` + migration + backfill; per-type `TYPE_REF_CONFIG.basePrompt`; Base block UI (upload + t2i); `RefGenJob.mode` + worker BASE path; `setBaseAsset` action | low (additive) | base lock visible |
| **B — Variants** | `EntityVariant` + `ReferenceImage.variantId` + `RefGenJob.variantId`; Variants grid + add-variant form (per-type chips); worker VARIANT i2i path; `createVariant`/`rename`/`delete`/`regenerate`; money-safety | medium (core) | full variant feature |
| **C — @mention variants** | `GenJob.variantSel` + `genRequest`; MentionInput dropdown + parse/rebuild; DTO variants; composers; guardian; worker conditioning scope; snapshot | medium (integration) | `@mira:red-dress` works |

A + B are the visible feature and can land + deploy together. C is wired and **verified on its own** (it touches the paid gen conditioning path).

Each phase: typecheck + `/codex` review before deploy (house rule). Local mock for any gen testing; check/kill stale fal workers first. No auto-commit/push.

## Touch-point index (from recon — exact paths)

- Design system: `apps/web/app/globals.css` (`al-*`), `apps/web/components/ds.tsx` (wrappers + icons).
- Reference UI: `apps/web/components/Library.tsx` — `EntityDetail` (573–810), `GenerateRefsBlock` (419–571), `TYPE_META`/`TYPE_ORDER`/`EMPTY_HINTS` (20–33), `buildReferencePrompt` (404–417).
- Per-type validation set: `apps/web/lib/actions.ts:37` (`ENTITY_TYPES`).
- Refgen: `apps/web/lib/refgen-actions.ts`; `apps/worker/src/jobs/refgen.ts` (claim, provider, `attachOutputs`); `packages/core/src/refgen.ts` (contract); `packages/generation/src/index.ts` (provider — t2i/edit at ~190–206, no change).
- Conditioning: `apps/worker/src/jobs/gen.ts:158–175`; storage `packages/storage/src/index.ts` (`presignedGet`), `packages/core/src/storage-key.ts`.
- @mention: `apps/web/components/MentionInput.tsx` (`resolveDoc`, `buildMentionDoc`); `apps/web/components/studio/GenSpace.tsx`, `Storyboard.tsx`; `packages/core/src/gen.ts` (`genRequest`); `apps/web/lib/gen-actions.ts`; `apps/web/lib/cowork-guardian.ts`; `apps/web/lib/entity-snapshot.ts`.
- DTO/data: `apps/web/lib/types.ts` (`EntityDTO`), `apps/web/lib/dto.ts` (`toEntityDTO`), `apps/web/lib/data.ts` (`getEntities`, `EntityWithRefs`), `apps/web/app/studio/page.tsx:120`.
- Schema/migrations: `packages/db/prisma/schema.prisma`; `packages/db/prisma/migrations/`; `packages/db/package.json` (`db:migrate`, `migrate:deploy`).

## Resolved by red-team (decisions baked into the spec above)

- **Handle uniqueness vs soft-delete** → *partial* unique index `WHERE deletedAt IS NULL` frees deleted handles; `slugify` + `-N` collision loop.
- **`baseAssetId` soft-pointer / orphan risk** → re-validated live in `startRefGen` **and** the worker before any i2i spend; safe from D21 sweep while a base-level ref points at it.
- **`createVariant` / `regenerateVariant` double-spend** → transactional create gated by the partial unique index; per-variant active-job guard.
- **`attachOutputs` idempotency** → re-keyed to `(entityId, assetId, variantId)`.
- **Worker fail-closed** → a variant resolving to 0 refs throws before spend, never degrades to unconditioned t2i.
- **Design-system fidelity** → real `ds.tsx` primitives only; `IcImage` (no `IcUpload`), text `Badge` (no `IcLock`), `MediaCard ratio="1:1"`.

## Remaining risks / accepted limits

1. **Multiple refs per variant**: the model allows it (variant = tagged refs), but v1 UI generates exactly 1 image per variant (count=1). Door open, no multi-image-per-variant UI yet (YAGNI).
2. **Phase C same-entity-two-variants**: `variantSel` is a per-entity map → one variant per entity per prompt. Documented limit; revisit only if hit.
3. **Backfill**: entities with zero refs get `baseAssetId = null` → empty Base block (upload or generate). No data loss.
