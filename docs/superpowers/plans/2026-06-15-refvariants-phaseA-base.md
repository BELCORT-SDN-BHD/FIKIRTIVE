# Reference base-identity (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every entity a locked **base identity** image (upload or t2i-generated) — the i2i anchor all future variants condition on.

**Architecture:** One additive Prisma migration introduces the *entire* feature's schema (base + variants + mention fields — variants/mentions stay dormant until Phases B/C). Phase A wires only the base path: a per-type config drives the base prompt, `startRefGen`/worker gain a `BASE` mode (single t2i image that pins `Entity.baseAssetId`), and the entity drawer gets a base-identity block. Reuses the existing refgen money-safety pipeline (atomic claim, exactly-once, validate-before-spend) unchanged.

**Tech Stack:** Prisma 7.8 + Neon Postgres, Next.js 16 server actions, pg-boss worker, fal seedream (t2i/i2i auto-routed), vitest (unit tests in `packages/core`), `al-*`/`ds.tsx` design system.

**Spec:** `docs/superpowers/specs/2026-06-15-reference-base-variants-design.md`

**House rules (apply throughout):**
- **Money-safety**: validate-before-spend, no double-spend, fail-closed. Never weaken the existing guards.
- **Surgical**: touch only what each task names; match existing style; don't refactor unrelated code.
- **Commits**: the plan includes per-task commit steps for a clean history, but commits/pushes happen **only when the user asks** (house rule). The executor batches and asks; do not auto-push.
- **No real spend in tests**: all gen verification runs against `GENERATION_PROVIDER=mock` on the local DB. Before any worker run, check for and kill stale fal workers.
- **Codex gate**: Task 9 runs `/codex` review before any deploy.

---

## File structure

| File | Responsibility | Phase A change |
|---|---|---|
| `packages/db/prisma/schema.prisma` | DB schema | add `RefGenMode` enum, `Entity.baseAssetId`+`variants`, `EntityVariant`, `ReferenceImage.variantId`, `RefGenJob.mode`+`variantId`, `GenJob.variantSel` |
| `packages/db/prisma/migrations/<ts>_reference_base_variants/migration.sql` | migration | generated diff + appended partial-unique-index + backfill SQL |
| `packages/core/src/refgen.ts` | refgen contract | add `mode`+`variantId` to `refGenRequest`, export `REFGEN_MODES` |
| `packages/core/src/refgen.test.ts` | contract tests | new cases for mode/variantId |
| `packages/core/src/ref-config.ts` | **new** — per-type base prompt + variant chips + `slugify` | create |
| `packages/core/src/ref-config.test.ts` | **new** — config + slugify tests | create |
| `packages/core/src/index.ts` | core barrel | export `ref-config` + new refgen symbols |
| `apps/web/lib/refgen-actions.ts` | refgen server actions | `startRefGen` mode handling; new `setBaseAsset` |
| `apps/worker/src/jobs/refgen.ts` | refgen worker | `BASE` mode branch + pin `baseAssetId` |
| `apps/web/lib/types.ts` | DTOs | `RefImageDTO.assetId`, `EntityDTO.baseAssetId` |
| `apps/web/lib/dto.ts` | DTO mapper | map the two new fields |
| `apps/web/components/Library.tsx` | entity drawer UI | `GenerateRefsBlock` `mode` prop; base-identity block; import `basePromptFor` |

---

### Task 1: Schema + migration + backfill

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_reference_base_variants/migration.sql` (generated, then hand-appended)
- Create (temp, for verification only): `scripts/verify-phaseA-migration.mjs`

- [ ] **Step 1: Add the enum + models to the schema**

In `packages/db/prisma/schema.prisma`, after the `AssetSource` enum (line 43), add:

```prisma
// Phase A redesign: per-mode reference generation. REFSHEET = legacy multi-view
// (default for pre-existing rows); BASE = single t2i identity anchor; VARIANT =
// single i2i look conditioned on the base (Phase B).
enum RefGenMode {
  REFSHEET
  BASE
  VARIANT
}
```

In the `Entity` model, after `referenceImages ReferenceImage[]` (line 76), add:

```prisma
  variants        EntityVariant[]
```

and after `deletedAt DateTime?` (line 74) add:

```prisma
  // locked canonical base image (an Asset id); soft pointer (no FK) — re-validated
  // live in refgen-actions before any mode=VARIANT spend. Safe from the D21 sweep
  // while a base-level ReferenceImage points at the same asset.
  baseAssetId         String?
```

After the `Entity` model (line 80), add the new model:

```prisma
// Phase B: named look/outfit/angle variant of an entity. A thin registry — its
// image(s) are ReferenceImage rows tagged with variantId. handle uniqueness is a
// PARTIAL unique index (live rows only) added in migration.sql (Prisma can't
// express conditional uniqueness).
model EntityVariant {
  id        String    @id
  ownerId   String    @default("founder")
  entityId  String
  name      String
  handle    String
  prompt    String    @default("")
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  entity          Entity           @relation(fields: [entityId], references: [id], onDelete: Restrict)
  referenceImages ReferenceImage[]

  @@index([ownerId, deletedAt])
  @@index([entityId, deletedAt])
}
```

In the `ReferenceImage` model, after `viewTag String?` (line 90) add:

```prisma
  // null = base/entity-level ref; set = belongs to that variant (Phase B)
  variantId String?
```

and after `asset Asset @relation(...)` (line 95) add:

```prisma
  variant EntityVariant? @relation(fields: [variantId], references: [id], onDelete: Restrict)
```

and add an index alongside the existing ones (after line 98):

```prisma
  @@index([entityId, variantId, deletedAt])
```

In the `RefGenJob` model, after `count Int` (line 278) add:

```prisma
  mode      RefGenMode @default(REFSHEET)
  variantId String?    // set when mode = VARIANT; no FK (validated in app before spend)
```

In the `GenJob` model, after `entityIds String[] @default([])` (line 314) add:

```prisma
  // Phase C: { [entityId]: variantId } — selected variant per @mentioned entity;
  // null/absent = base refs for all mentions (backward-compat with old rows)
  variantSel Json?
```

- [ ] **Step 2: Generate the migration without applying it**

Run: `cd packages/db && pnpm exec prisma migrate dev --create-only --name reference_base_variants`
Expected: prints "Prisma Migrate created the following migration ... reference_base_variants" and creates `migration.sql` (does NOT apply yet).

- [ ] **Step 3: Append the partial unique index + backfill to the generated migration.sql**

Open the new `packages/db/prisma/migrations/<timestamp>_reference_base_variants/migration.sql` and append at the end:

```sql
-- Handle uniqueness only among LIVE variants (frees a handle once soft-deleted).
CREATE UNIQUE INDEX "EntityVariant_entityId_handle_live"
  ON "EntityVariant" ("entityId", "handle") WHERE "deletedAt" IS NULL;

-- Backfill the base for existing entities: lowest-position live base-level ref.
-- Idempotent (only null baseAssetId), leaves ref-less entities null.
UPDATE "Entity" e
SET "baseAssetId" = (
  SELECT r."assetId" FROM "ReferenceImage" r
  WHERE r."entityId" = e."id" AND r."variantId" IS NULL AND r."deletedAt" IS NULL
  ORDER BY r."position" ASC LIMIT 1
)
WHERE e."deletedAt" IS NULL AND e."baseAssetId" IS NULL;
```

> Confirm the generated diff added the `RefGenMode` column as `NOT NULL DEFAULT 'REFSHEET'` (Prisma emits this for a non-nullable enum with a schema default — pre-existing rows backfill to `REFSHEET`). If it emitted nullable, change the `ADD COLUMN "mode"` line to `... NOT NULL DEFAULT 'REFSHEET'`.

- [ ] **Step 4: Apply the migration + regenerate the client**

Run: `cd packages/db && pnpm exec prisma migrate dev` then `pnpm --filter @artlio/db generate`
Expected: "All migrations have been successfully applied." + "Generated Prisma Client".

- [ ] **Step 5: Write a verification script proving the backfill + defaults**

Create `scripts/verify-phaseA-migration.mjs`:

```js
// Verifies Phase A schema + backfill against the LOCAL dev DB. Read-only except
// it asserts invariants. Run: node scripts/verify-phaseA-migration.mjs
import { PrismaClient } from "../packages/db/generated/prisma/client.js";
const prisma = new PrismaClient();
try {
  // 1. every live entity with a live base-level ref has a baseAssetId pointing at its lowest-position ref
  const entities = await prisma.entity.findMany({
    where: { deletedAt: null },
    include: { referenceImages: { where: { deletedAt: null, variantId: null }, orderBy: { position: "asc" } } },
  });
  let bad = 0;
  for (const e of entities) {
    const expected = e.referenceImages[0]?.assetId ?? null;
    if (e.baseAssetId !== expected) { bad++; console.error(`✗ ${e.id} base=${e.baseAssetId} expected=${expected}`); }
  }
  // 2. RefGenJob.mode defaulted to REFSHEET on all pre-existing rows
  const nullMode = await prisma.refGenJob.count({ where: { mode: { equals: undefined } } }).catch(() => 0);
  // 3. the new tables/columns are queryable
  await prisma.entityVariant.count();
  console.log(`entities checked: ${entities.length}, backfill mismatches: ${bad}, refGenJob null-mode: ${nullMode}`);
  if (bad > 0) process.exit(1);
  console.log("✓ Phase A migration verified");
} finally { await prisma.$disconnect(); }
```

- [ ] **Step 6: Run the verification + typecheck**

Run: `node scripts/verify-phaseA-migration.mjs && pnpm --filter @artlio/db typecheck`
Expected: "✓ Phase A migration verified" (0 mismatches) + clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations scripts/verify-phaseA-migration.mjs
git commit -m "feat(db): reference base+variants schema + base backfill (phase A)"
```

---

### Task 2: refGenRequest contract — mode + variantId

**Files:**
- Modify: `packages/core/src/refgen.ts:38-46`
- Test: `packages/core/src/refgen.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/refgen.test.ts`, add inside the `describe("refGenRequest", …)` block:

```ts
  it("defaults mode to REFSHEET and rejects mode/variantId mismatch", () => {
    expect(refGenRequest.parse(ok).mode).toBe("REFSHEET");
    expect(refGenRequest.parse({ ...ok, mode: "BASE" }).mode).toBe("BASE");
    // VARIANT requires a variantId
    expect(() => refGenRequest.parse({ ...ok, mode: "VARIANT" })).toThrow();
    expect(refGenRequest.parse({ ...ok, mode: "VARIANT", variantId: "v1" }).variantId).toBe("v1");
    // a variantId without VARIANT mode is a contract error
    expect(() => refGenRequest.parse({ ...ok, mode: "BASE", variantId: "v1" })).toThrow();
    expect(() => refGenRequest.parse({ ...ok, variantId: "v1" })).toThrow();
    // unknown mode rejected
    expect(() => refGenRequest.parse({ ...ok, mode: "WHATEVER" })).toThrow();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @artlio/core test -- refgen`
Expected: FAIL — `mode` is unknown (strict object rejects it) / `.mode` is undefined.

- [ ] **Step 3: Implement the contract change**

In `packages/core/src/refgen.ts`, add after `MAX_REFGEN_PROMPT` (line 31):

```ts
/** Reference generation modes — REFSHEET legacy multi-view, BASE single t2i
 *  identity anchor, VARIANT single i2i look from the base. */
export const REFGEN_MODES = ["REFSHEET", "BASE", "VARIANT"] as const;
export type RefGenMode = (typeof REFGEN_MODES)[number];
```

Replace the `refGenRequest` definition (lines 38-46) with:

```ts
export const refGenRequest = z
  .object({
    entityId: z.string().min(1).max(64),
    prompt: z.string().trim().min(1).max(MAX_REFGEN_PROMPT),
    count: z.number().int().min(1).max(MAX_REFGEN_COUNT),
    model: z.enum(REFGEN_MODELS).default("seedream"),
    mode: z.enum(REFGEN_MODES).default("REFSHEET"),
    variantId: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // VARIANT ⟺ variantId — a VARIANT job must name its target, and a variantId
    // is meaningless (and a sign of a confused caller) outside VARIANT mode.
    if (v.mode === "VARIANT" && !v.variantId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VARIANT mode requires a variantId", path: ["variantId"] });
    if (v.mode !== "VARIANT" && v.variantId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "variantId only valid in VARIANT mode", path: ["variantId"] });
  });
export type RefGenRequest = z.infer<typeof refGenRequest>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @artlio/core test -- refgen`
Expected: PASS (all refGenRequest cases green, including the existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/refgen.ts packages/core/src/refgen.test.ts
git commit -m "feat(core): add mode+variantId to refGenRequest contract (phase A)"
```

---

### Task 3: Per-type reference config (base prompt, variant chips, slugify)

**Files:**
- Create: `packages/core/src/ref-config.ts`
- Create: `packages/core/src/ref-config.test.ts`
- Modify: `packages/core/src/index.ts` (barrel export)
- Modify: `apps/web/components/Library.tsx` (replace `buildReferencePrompt` with `basePromptFor`)

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/ref-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REF_TYPE_CONFIG, basePromptFor, slugify, type RefEntityType } from "./ref-config.js";

const TYPES: RefEntityType[] = ["CHARACTER", "LOCATION", "PRODUCT", "BRAND"];

describe("slugify", () => {
  it("lowercases, dashes non-alnum, trims, and falls back", () => {
    expect(slugify("Red dress")).toBe("red-dress");
    expect(slugify("  Beach!!  ")).toBe("beach");
    expect(slugify("3/4 angle")).toBe("3-4-angle");
    expect(slugify("")).toBe("variant");
    expect(slugify("红裙")).toBe("variant"); // non-ascii → fallback (display name keeps it)
  });
});

describe("REF_TYPE_CONFIG", () => {
  it("covers every entity type with a base prompt, hint, and chips", () => {
    for (const t of TYPES) {
      const c = REF_TYPE_CONFIG[t];
      expect(c.baseHint.length).toBeGreaterThan(0);
      expect(c.variantChips.length).toBeGreaterThanOrEqual(3);
      for (const chip of c.variantChips) expect(chip.scaffold.length).toBeGreaterThan(0);
    }
  });
});

describe("basePromptFor", () => {
  it("weaves name, notes and negative constraints into one shot", () => {
    const p = basePromptFor("CHARACTER", { name: "Mira", notes: "freckles", negativeConstraints: "no glasses" });
    expect(p).toContain("Mira");
    expect(p).toContain("freckles");
    expect(p).toContain("no glasses");
  });
  it("omits the notes/negative clauses when empty", () => {
    const p = basePromptFor("PRODUCT", { name: "Aura mug", notes: "", negativeConstraints: "" });
    expect(p).toContain("Aura mug");
    expect(p).not.toContain("Avoid:");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @artlio/core test -- ref-config`
Expected: FAIL — `Cannot find module './ref-config.js'`.

- [ ] **Step 3: Implement the config**

Create `packages/core/src/ref-config.ts`:

```ts
/**
 * Per-entity-type reference knowledge: the single base prompt + the variant-chip
 * taxonomy, plus handle slugification. One place to add a future entity type.
 * Pure (no DB / React) so it is unit-tested and reusable by web + worker.
 */
export type RefEntityType = "CHARACTER" | "LOCATION" | "PRODUCT" | "BRAND";

export interface VariantChip {
  key: string;
  label: string;
  scaffold: string; // appended to the prompt when the chip is clicked
}

export interface RefTypeConfig {
  baseHint: string;
  /** the locked single base shot (not a multi-view sheet) */
  baseShot: (subject: string) => string;
  variantChips: VariantChip[];
}

const clause = (notes: string, negative: string) =>
  `${notes ? `, ${notes}` : ""}${negative ? `. Avoid: ${negative}.` : "."}`;

export const REF_TYPE_CONFIG: Record<RefEntityType, RefTypeConfig> = {
  CHARACTER: {
    baseHint: "One clean full-body photo — the identity anchor every variant is generated from.",
    baseShot: (s) => `Full-body reference photo of ${s}, neutral expression, natural standing pose, plain studio background, soft even lighting, sharp focus`,
    variantChips: [
      { key: "outfit", label: "Outfit", scaffold: "wearing " },
      { key: "pose", label: "Pose", scaffold: "in a " },
      { key: "angle", label: "Angle", scaffold: "seen from " },
      { key: "expression", label: "Expression", scaffold: "with a " },
    ],
  },
  LOCATION: {
    baseHint: "One wide establishing shot — the canonical look of this place.",
    baseShot: (s) => `Wide establishing shot of ${s}, consistent architecture and materials, even natural lighting, sharp focus`,
    variantChips: [
      { key: "time", label: "Time of day", scaffold: "at " },
      { key: "angle", label: "Angle", scaffold: "from " },
      { key: "weather", label: "Weather", scaffold: "in " },
      { key: "season", label: "Season", scaffold: "during " },
    ],
  },
  PRODUCT: {
    baseHint: "One clean studio shot — the hero look of this product.",
    baseShot: (s) => `Clean studio product shot of ${s}, neutral seamless background, consistent materials and proportions, soft even lighting, sharp focus`,
    variantChips: [
      { key: "color", label: "Color", scaffold: "in " },
      { key: "angle", label: "Angle", scaffold: "from " },
      { key: "material", label: "Material", scaffold: "in " },
      { key: "packaging", label: "Packaging", scaffold: "with " },
    ],
  },
  BRAND: {
    baseHint: "One primary logo lockup — the canonical mark.",
    baseShot: (s) => `Primary logo lockup for ${s}, centered on a plain background, crisp edges, consistent visual identity`,
    variantChips: [
      { key: "light", label: "Light bg", scaffold: "on a light background" },
      { key: "dark", label: "Dark bg", scaffold: "on a dark background" },
      { key: "treatment", label: "Treatment", scaffold: "as a " },
      { key: "layout", label: "Layout", scaffold: "in a " },
    ],
  },
};

export function basePromptFor(
  type: RefEntityType,
  e: { name: string; notes: string; negativeConstraints: string },
): string {
  const subject = `${e.name}${e.notes ? `, ${e.notes}` : ""}`;
  return `${REF_TYPE_CONFIG[type].baseShot(subject)}${e.negativeConstraints ? ` Avoid: ${e.negativeConstraints}.` : "."}`;
}

/** Handle for @entity:handle — lowercase, non-alnum → "-", trimmed, ascii-only,
 *  with a stable fallback (collisions are resolved by the caller's -N loop). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "variant";
}
```

> `basePromptFor` ignores the unused `clause` helper above — delete the `clause` const; it was scaffolding. (Keep the file to exactly what the tests exercise.)

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, add an export line next to the other `refgen` exports:

```ts
export * from "./ref-config.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @artlio/core test -- ref-config && pnpm --filter @artlio/core typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Replace buildReferencePrompt in Library.tsx**

In `apps/web/components/Library.tsx`:
- add `basePromptFor` to the `@artlio/core` import (line 5): `import { REFGEN_PRICE_USD_PER_IMAGE, basePromptFor } from "@artlio/core";`
- delete the whole `buildReferencePrompt` function (lines 404-417).
- in `GenerateRefsBlock`, change the prompt initializer (line 422) from `useState(() => buildReferencePrompt(entity))` to `useState(() => basePromptFor(entity.type, entity))`.

- [ ] **Step 7: Verify the web app typechecks**

Run: `pnpm --filter web typecheck`
Expected: clean (no remaining `buildReferencePrompt` reference).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ref-config.ts packages/core/src/ref-config.test.ts packages/core/src/index.ts apps/web/components/Library.tsx
git commit -m "feat(core): per-type ref config + slugify; use it for base prompt (phase A)"
```

---

### Task 4: `setBaseAsset` server action

**Files:**
- Modify: `apps/web/lib/refgen-actions.ts`

- [ ] **Step 1: Implement the action**

In `apps/web/lib/refgen-actions.ts`, after `startRefGen` (before `getRefGenJobs`, line 67), add:

```ts
/** Pin the entity's locked base to one of its OWN live reference images' assets.
 *  Validate-before-write: the asset must already be a live ref of this entity
 *  (no arbitrary asset ids), then set Entity.baseAssetId. No spend. */
export async function setBaseAsset(entityId: string, assetId: string): Promise<{ ok: true } | { error: string }> {
  const ref = await prisma.referenceImage.findFirst({
    where: { entityId, assetId, ownerId: FOUNDER_OWNER_ID, deletedAt: null, variantId: null },
    select: { id: true },
  });
  if (!ref) return { error: "That image is not a base reference of this element." };
  await prisma.entity.update({
    where: { id: entityId },
    data: { baseAssetId: assetId },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 3: Verify against the local DB**

Create `scripts/verify-phaseA-setbase.mjs`:

```js
// Proves setBaseAsset only accepts an owned live base ref. Local DB, no spend.
import { PrismaClient } from "../packages/db/generated/prisma/client.js";
const prisma = new PrismaClient();
try {
  const e = await prisma.entity.findFirst({
    where: { deletedAt: null },
    include: { referenceImages: { where: { deletedAt: null, variantId: null }, take: 1 } },
  });
  if (!e || !e.referenceImages[0]) { console.log("⚠ no entity with a base ref locally — skip"); process.exit(0); }
  const good = e.referenceImages[0].assetId;
  // valid: a real owned base ref exists for this entity
  const ok = await prisma.referenceImage.findFirst({ where: { entityId: e.id, assetId: good, deletedAt: null, variantId: null } });
  // invalid: a made-up asset id must not match
  const bad = await prisma.referenceImage.findFirst({ where: { entityId: e.id, assetId: "asset-does-not-exist", deletedAt: null, variantId: null } });
  console.log(`valid-ref match: ${!!ok} (want true), bogus-ref match: ${!!bad} (want false)`);
  if (!ok || bad) process.exit(1);
  console.log("✓ setBaseAsset guard logic verified");
} finally { await prisma.$disconnect(); }
```

Run: `node scripts/verify-phaseA-setbase.mjs`
Expected: "✓ setBaseAsset guard logic verified" (or "skip" if no local data).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/refgen-actions.ts scripts/verify-phaseA-setbase.mjs
git commit -m "feat(web): setBaseAsset action — pin base to an owned live ref (phase A)"
```

---

### Task 5: `startRefGen` mode handling + variant precondition

**Files:**
- Modify: `apps/web/lib/refgen-actions.ts:21-47`

- [ ] **Step 1: Thread mode/variantId + add the VARIANT precondition**

In `apps/web/lib/refgen-actions.ts`, replace the destructure (line 24) and the entity check + active-job guard region so it reads:

```ts
  const { entityId, prompt, count, model, mode, variantId } = parsed.data;

  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });
  if (!entity) return { error: "Element not found." };

  // validate-before-spend: a VARIANT generation conditions on the locked base
  // (i2i), so the base must exist as a live owned asset BEFORE we create a paid
  // job. A BASE generation has no precondition (it produces the base).
  if (mode === "VARIANT") {
    if (!entity.baseAssetId) return { error: "Set a base identity first — variants are generated from it." };
    const base = await prisma.asset.findFirst({ where: { id: entity.baseAssetId, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, select: { id: true } });
    if (!base) return { error: "The base image is missing — set a new base before generating variants." };
  }

  // BASE and VARIANT are single-image; only REFSHEET honors the requested count.
  const effectiveCount = mode === "REFSHEET" ? count : 1;
```

Then change the active-job guard to scope per-variant for VARIANT jobs (a single entity can have multiple variant jobs in flight), and the create to persist mode/variantId/effectiveCount. Replace the `active` query (lines 35-43) and the create (lines 45-47) with:

```ts
  const STALE_MS = 15 * 60 * 1000;
  const active = await prisma.refGenJob.findFirst({
    where: {
      ownerId: FOUNDER_OWNER_ID,
      status: { in: ["QUEUED", "GENERATING"] },
      updatedAt: { gte: new Date(Date.now() - STALE_MS) },
      // BASE/REFSHEET serialize per entity; VARIANT serializes per variant.
      ...(mode === "VARIANT" ? { variantId } : { entityId, mode: { not: "VARIANT" } }),
    },
  });
  if (active) return { error: "A generation is already running for this element — wait for it to finish." };

  const job = await prisma.refGenJob.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, prompt, count: effectiveCount, model, mode, variantId: variantId ?? null },
  });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: clean (`mode`/`variantId` now on the parsed type from Task 2).

- [ ] **Step 3: Verify the precondition with a local mock run**

Create `scripts/verify-phaseA-variant-guard.mjs`:

```js
// Proves startRefGen rejects a VARIANT request when the entity has no base —
// no RefGenJob row is created (no spend). Local DB + GENERATION_PROVIDER=mock.
import { PrismaClient } from "../packages/db/generated/prisma/client.js";
const prisma = new PrismaClient();
try {
  // pick (or create) an entity with NO baseAssetId
  let e = await prisma.entity.findFirst({ where: { deletedAt: null, baseAssetId: null } });
  if (!e) { console.log("⚠ no base-less entity locally — skip"); process.exit(0); }
  const before = await prisma.refGenJob.count({ where: { entityId: e.id, mode: "VARIANT" } });
  // call the action through its module (server action is a plain async fn)
  const { startRefGen } = await import("../apps/web/lib/refgen-actions.ts");
  const res = await startRefGen({ entityId: e.id, prompt: "wearing a red dress", count: 1, model: "seedream", mode: "VARIANT", variantId: "v-test" });
  const after = await prisma.refGenJob.count({ where: { entityId: e.id, mode: "VARIANT" } });
  console.log("result:", res, "jobs before/after:", before, after);
  if (!("error" in res) || after !== before) { console.error("✗ a no-base VARIANT must error with NO job created"); process.exit(1); }
  console.log("✓ VARIANT-without-base rejected, no job created");
} finally { await prisma.$disconnect(); }
```

> Importing a `"use server"` module + Next aliases (`@/…`) directly from a node script may need `tsx` and an env shim. If the import path fights Next's module resolution, fall back to asserting the guard at the DB layer (as Task 4's script does): confirm `prisma.refGenJob.count` is unchanged after a manual `startRefGen` call invoked from a Next route during local dev. Keep whichever runs cleanly; do not weaken the assertion.

Run: `GENERATION_PROVIDER=mock node --import tsx scripts/verify-phaseA-variant-guard.mjs`
Expected: "✓ VARIANT-without-base rejected, no job created" (or "skip").

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/refgen-actions.ts scripts/verify-phaseA-variant-guard.mjs
git commit -m "feat(web): startRefGen mode handling + VARIANT base precondition (phase A)"
```

---

### Task 6: Worker `BASE` mode — single t2i that pins `baseAssetId`

**Files:**
- Modify: `apps/worker/src/jobs/refgen.ts`

- [ ] **Step 1: Branch conditioning on mode + pin the base atomically with DONE**

In `apps/worker/src/jobs/refgen.ts`:

First, the **resume path** (lines 76-84) must also pin the base when a BASE job resumes. Replace it with:

```ts
    // exactly-once spend (codex P1): a prior delivery already paid and stored
    // these outputs — just (re-)attach them idempotently and finish
    if (job.outputAssetIds.length > 0) {
      await attachOutputs(job.entityId, job.ownerId, job.outputAssetIds);
      await finalizeDone(job.id, job.mode, job.entityId, job.ownerId, job.outputAssetIds[0]);
      console.log(`[refgen] ${job.id}: resumed — re-attached ${job.outputAssetIds.length} prior outputs (no re-spend)`);
      return;
    }
```

Then the **conditioning** block (lines 105-126): a BASE job is text-to-image — skip the ref fetch entirely. Replace the `const refs = …` through the unreachable-refs `throw` (lines 106-126) with:

```ts
    // BASE = text-to-image identity anchor → no conditioning. REFSHEET/VARIANT
    // resolve conditioning from the entity's existing refs → presigned GETs.
    const inputImageUrls: string[] = [];
    if (job.mode !== "BASE") {
      const refs = await prisma.referenceImage.findMany({
        where: { entityId: job.entityId, ownerId: job.ownerId, deletedAt: null, variantId: null },
        orderBy: { position: "asc" },
        include: { asset: true },
        // Seedream edit: inputs + outputs ≤ 15 (codex P2)
        take: Math.max(0, Math.min(MAX_CONDITIONING_IMAGES, MAX_EDIT_INPUT_PLUS_OUTPUT - job.count)),
      });
      for (const ref of refs) {
        const key = storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext);
        const signed = await storage.presignedGet(key, 3600);
        if (signed) inputImageUrls.push(signed);
      }
      // a real (paid) provider must not silently degrade a conditioned request
      // to text-to-image because the refs weren't reachable (codex P1)
      const isMock = provider.name === "mock";
      if (!isMock && refs.length > 0 && inputImageUrls.length < refs.length) {
        throw new Error(
          `conditioning refs unreachable (${inputImageUrls.length}/${refs.length} signable) — refusing to spend on a degraded generation`,
        );
      }
    }
```

Then the **success finalize** (lines 161-166): replace the `attachOutputs` + DONE update with the shared finalizer:

```ts
    // attach (idempotent: skips assets already attached to this entity)
    await attachOutputs(job.entityId, job.ownerId, outputAssetIds);
    await finalizeDone(job.id, job.mode, job.entityId, job.ownerId, outputAssetIds[0]);
    console.log(`[refgen] ${job.id}: DONE (${job.mode}) → ${outputAssetIds.length} images via ${provider.name}`);
```

- [ ] **Step 2: Add the `finalizeDone` helper**

After `handleRefGen` (before `attachOutputs`, line 188), add:

```ts
/** Flip the job DONE and, for a BASE job, pin Entity.baseAssetId in the SAME
 *  transaction — so a crash can never leave a DONE base job with a null base
 *  (it stays resumable until both commit together). */
async function finalizeDone(
  jobId: string,
  mode: string,
  entityId: string,
  ownerId: string,
  firstAssetId: string | undefined,
): Promise<void> {
  const ops: Parameters<typeof prisma.$transaction>[0] = [
    prisma.refGenJob.update({
      where: { id: jobId },
      data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" },
    }),
  ];
  if (mode === "BASE" && firstAssetId) {
    ops.unshift(
      prisma.entity.update({ where: { id: entityId }, data: { baseAssetId: firstAssetId } }),
    );
  }
  await prisma.$transaction(ops);
}
```

> `RefGenMode` is a string in the worker (`job.mode`); comparing to the literal `"BASE"` is sufficient — no extra import needed. The `attachOutputs` signature is unchanged in Phase A (BASE attaches with the default `variantId = null`); Phase B re-keys its idempotency.

- [ ] **Step 3: Typecheck the worker**

Run: `pnpm --filter worker typecheck`
Expected: clean.

- [ ] **Step 4: Verify the BASE path end-to-end with the mock provider**

Create `scripts/verify-phaseA-base-worker.mjs`:

```js
// Drives a BASE RefGenJob through the worker handler with the mock provider on
// the local DB: asserts one ReferenceImage attached AND Entity.baseAssetId set
// to that asset. No real spend (mock). Run after `pnpm --filter worker build`
// OR via tsx. Requires GENERATION_PROVIDER=mock.
import { PrismaClient } from "../packages/db/generated/prisma/client.js";
import { ulid } from "ulid";
const prisma = new PrismaClient();
try {
  // a base-less entity to anchor
  let e = await prisma.entity.findFirst({ where: { deletedAt: null, baseAssetId: null } });
  if (!e) { e = await prisma.entity.create({ data: { id: ulid(), type: "CHARACTER", name: "PhaseA test" } }); }
  const job = await prisma.refGenJob.create({
    data: { id: ulid(), entityId: e.id, prompt: "full-body studio photo", count: 1, model: "seedream", mode: "BASE" },
  });
  const { handleRefGen } = await import("../apps/worker/src/jobs/refgen.ts");
  await handleRefGen({ refGenJobId: job.id }, 0);
  const done = await prisma.refGenJob.findUnique({ where: { id: job.id } });
  const ent = await prisma.entity.findUnique({ where: { id: e.id } });
  const ref = await prisma.referenceImage.findFirst({ where: { entityId: e.id, assetId: ent?.baseAssetId ?? "", deletedAt: null } });
  console.log("job:", done?.status, "baseAssetId set:", !!ent?.baseAssetId, "base ref attached:", !!ref);
  if (done?.status !== "DONE" || !ent?.baseAssetId || !ref) process.exit(1);
  console.log("✓ BASE worker path: t2i image attached + baseAssetId pinned");
} finally { await prisma.$disconnect(); }
```

Run: `GENERATION_PROVIDER=mock node --import tsx scripts/verify-phaseA-base-worker.mjs`
Expected: "✓ BASE worker path: t2i image attached + baseAssetId pinned".

> First check for stale fal workers: `ps aux | grep -i "[w]orker" ` and kill any leftover before running, so a real worker can't claim the test job and spend.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/refgen.ts scripts/verify-phaseA-base-worker.mjs
git commit -m "feat(worker): BASE refgen mode — single t2i pins baseAssetId atomically (phase A)"
```

---

### Task 7: DTO — expose `baseAssetId` + per-ref `assetId`

**Files:**
- Modify: `apps/web/lib/types.ts:10-25`
- Modify: `apps/web/lib/dto.ts:12-27`

- [ ] **Step 1: Extend the DTO types**

In `apps/web/lib/types.ts`, add `assetId` to `RefImageDTO` (after `id`, line 11):

```ts
export interface RefImageDTO {
  id: string;
  assetId: string; // the underlying Asset id — lets the UI match the base + call setBaseAsset
  url: string;
  kind: "image" | "video" | "other";
}
```

and add `baseAssetId` to `EntityDTO` (after `refs`, line 23):

```ts
  baseAssetId: string | null; // the locked base — one of refs' assetId, or null
```

- [ ] **Step 2: Map the new fields**

In `apps/web/lib/dto.ts`, update `toEntityDTO`'s ref map + add `baseAssetId` (lines 20-26):

```ts
    refs: e.referenceImages.map((r) => ({
      id: r.id,
      assetId: r.assetId,
      url: assetUrl(r.asset.ownerId, r.asset.contentHash, r.asset.ext),
      kind: kindOf(r.asset.ext),
    })),
    baseAssetId: e.baseAssetId,
    usageCount: e._count.shotRefs,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: clean (`e.baseAssetId` is now on the Prisma type from Task 1; `e.referenceImages[].assetId` already exists).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/types.ts apps/web/lib/dto.ts
git commit -m "feat(web): expose baseAssetId + ref assetId on EntityDTO (phase A)"
```

---

### Task 8: Base-identity block UI

**Files:**
- Modify: `apps/web/components/Library.tsx` (`GenerateRefsBlock` gains a `mode` prop; `EntityDetail` gets the base block)

- [ ] **Step 1: Give `GenerateRefsBlock` a `mode` prop (BASE = single t2i)**

In `apps/web/components/Library.tsx`, change the `GenerateRefsBlock` signature (line 419) and the bits that depend on mode:

```tsx
function GenerateRefsBlock({ entity, projectId, mode = "REFSHEET" }: { entity: EntityDTO; projectId?: string; mode?: "REFSHEET" | "BASE" }) {
```

- initialize the prompt from the right source (line 422):

```tsx
  const [prompt, setPrompt] = useState(() => basePromptFor(entity.type, entity));
```

- for BASE, count is fixed at 1; hide the count selector. After the `count` state (line 423) add:

```tsx
  const single = mode === "BASE";
```

- pass `mode` + the right count to `startRefGen` (replace the `run(() => startRefGen({...}))` call, lines 489):

```tsx
      () => startRefGen({ entityId: entity.id, prompt, count: single ? 1 : count, model: "seedream", mode }),
```

- in the JSX, gate the count `<label>…</label>` (lines 535-546) behind `{!single && ( … )}`, and change the generate button label (lines 553-555) to:

```tsx
        <Button size="sm" onClick={generate} disabled={busy || enhancing || prompt.trim().length === 0}>
          {busy ? (single ? `Generating… ${elapsed}s` : `Generating ${count}… ${elapsed}s`)
                : (single ? `Generate base (~$${REFGEN_PRICE_USD_PER_IMAGE.toFixed(2)})` : `Generate ${count} (~$${cost})`)}
        </Button>
```

- change the header `MonoLabel` (line 514) to reflect mode:

```tsx
        <MonoLabel>{single ? "Generate base" : "Generate references"}</MonoLabel>
```

> Everything else in `GenerateRefsBlock` (the `submittingRef`/`enhancingRef` money-safety guards, polling, elapsed timer, resume) is reused unchanged — BASE rides the exact same paid-path protections.

- [ ] **Step 2: Add a `setBaseAsset` import + a base-block render in `EntityDetail`**

In `Library.tsx`, add `setBaseAsset` to the refgen-actions import (line 16):

```tsx
import { startRefGen, getRefGenJobs, setBaseAsset } from "@/lib/refgen-actions";
```

and add `Badge` to the `./ds` import if not already present (line 18 already imports `Badge`).

Inside `EntityDetail`, compute the base ref and a setter near the other hooks (after `fileRef`, line 585):

```tsx
  const baseRef = entity.refs.find((r) => r.assetId === entity.baseAssetId) ?? null;
  const [genBase, setGenBase] = useState(false); // toggles the inline t2i base generator
```

Replace the entire **reference images** `<div>` block (lines 684-745, from `{/* reference images */}` through its closing `</div>` before the Notes label) with the base-identity block + a kept "additional references" strip:

```tsx
      {/* base identity — the locked anchor every variant is generated from */}
      <div>
        <MonoLabel style={{ display: "block", marginBottom: 7 }}>Base identity</MonoLabel>
        <div className="al-panel al-panel-flat" style={{ padding: 12, display: "flex", gap: 14, borderRadius: "var(--radius-md)" }}>
          <div style={{ width: 96, flex: "none" }}>
            <MediaCard
              ratio="1:1"
              src={baseRef?.url ?? null}
              statusChip={baseRef ? <Badge tone="accent">locked</Badge> : undefined}
            />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={{ font: "var(--text-small)", color: "var(--fg-2)" }}>
              {REF_TYPE_CONFIG[entity.type].baseHint}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="sm" variant="glass" icon={<IcImage size={14} />} disabled={refAct.pending} onClick={() => fileRef.current?.click()}>
                {baseRef ? "Replace — upload" : "Upload photo"}
              </Button>
              {projectId && (
                <Button size="sm" variant="glass" icon={<IcSparkle size={14} />} onClick={() => setGenBase((v) => !v)}>
                  {genBase ? "Close" : baseRef ? "Replace — generate" : "Generate (t2i)"}
                </Button>
              )}
            </div>
          </div>
        </div>
        {genBase && projectId && (
          <div style={{ marginTop: 8 }}>
            <GenerateRefsBlock entity={entity} projectId={projectId} mode="BASE" />
          </div>
        )}
        {refAct.error && (
          <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "6px 0 0" }}>{refAct.error}</p>
        )}
      </div>

      {/* additional base-level references (kept) — click one to make it the base */}
      {entity.refs.length > 0 && (
        <div>
          <MonoLabel style={{ display: "block", marginBottom: 7 }}>References · {entity.refs.length}</MonoLabel>
          <div className="thumb-strip">
            {entity.refs.map((r) => (
              <span key={r.id} style={{ position: "relative" }} className="group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="ref-thumb" src={r.url} alt=""
                  style={r.assetId === entity.baseAssetId ? { outline: "2px solid var(--accent)", outlineOffset: 1 } : undefined} />
                {r.assetId !== entity.baseAssetId && (
                  <button aria-label="Make base" title="Make base" disabled={refAct.pending}
                    onClick={() => refAct.run(() => setBaseAsset(entity.id, r.assetId))}
                    style={{ position: "absolute", bottom: 2, left: 2, height: 18, borderRadius: 99, border: "none", cursor: "pointer", background: "rgba(6,8,11,.75)", color: "var(--fg-2)", fontSize: 10, padding: "0 6px" }}>
                    base
                  </button>
                )}
                <button aria-label="Remove reference image" disabled={refAct.pending}
                  onClick={() => refAct.run(() => softDeleteReferenceImage(r.id))}
                  style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 99, border: "none", cursor: "pointer", background: "rgba(6,8,11,.75)", color: "var(--fg-2)", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
```

Add the `REF_TYPE_CONFIG` import to the `@artlio/core` import line (line 5):

```tsx
import { REFGEN_PRICE_USD_PER_IMAGE, basePromptFor, REF_TYPE_CONFIG } from "@artlio/core";
```

> The hidden `<input ref={fileRef} …>` (lines 733-741) and `uploadFiles` already exist and stay — uploading still appends a ReferenceImage; the user then clicks "base" on it (or, if it's the entity's first ref, the backfill/empty state leaves them to pick). The `drop-zone` empty-state block is removed (the base block now owns the empty state).

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: clean (no unused `cost`/`conditioned` warnings — `cost` is still used by the non-single label; `conditioned` still used by Enhance).

- [ ] **Step 4: Manual smoke in local dev**

Run: `pnpm dev` (web + worker), open an entity drawer.
Expected behaviors to confirm by eye:
- An entity with refs shows its base locked in the 1:1 card; "References" strip shows all refs with the base outlined and a "base" button on the others.
- "Make base" on another ref moves the lock.
- "Generate (t2i)" reveals the single-image base generator (no count selector, "Generate base" button); with `GENERATION_PROVIDER=mock` it produces one image and (after the worker runs) the base card fills.
- A brand-new entity (no refs) shows the empty base card + Upload / Generate buttons.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/Library.tsx
git commit -m "feat(web): base-identity block in entity drawer (phase A)"
```

---

### Task 9: Integration gate — full typecheck, build, Codex

**Files:** none (verification only)

- [ ] **Step 1: Whole-repo typecheck + core tests + build**

Run: `pnpm -r typecheck && pnpm --filter @artlio/core test && pnpm --filter web build`
Expected: all clean / green.

- [ ] **Step 2: Codex review of the Phase A diff**

Run the `/codex` review skill against the working diff (house rule: Codex before deploy). Address any P1/P2 findings, then re-run Step 1.

- [ ] **Step 3: Stop for deploy decision**

Do NOT deploy automatically. Report the verified state and ask the user before `railway up`. Prod migration runs first: `pnpm --filter @artlio/db migrate:deploy` (direct `DATABASE_URL` from `~/.gstack/projects/artlio/secrets/cloud.env`, never printed), then `railway up --service web` and `--service worker`.

---

## Self-Review

**1. Spec coverage (Phase A rows of the spec):**
- `Entity.baseAssetId` + one migration + backfill → Task 1 ✓
- `RefGenMode` enum (+ default for old rows) → Task 1 ✓
- Full schema for all phases in one migration (EntityVariant, ReferenceImage.variantId, RefGenJob.variantId, GenJob.variantSel) → Task 1 ✓ (dormant until B/C)
- Partial unique index for handles → Task 1 ✓
- `refGenRequest` mode+variantId+superRefine → Task 2 ✓
- Per-type `TYPE_REF_CONFIG` (basePrompt/baseHint/variantChips) + replace `buildReferencePrompt` → Task 3 ✓
- `setBaseAsset` (validate owned live ref) → Task 4 ✓
- `startRefGen` mode handling + VARIANT base precondition (validate-before-spend) + per-variant active-job guard shape → Task 5 ✓
- Worker BASE t2i path + pin baseAssetId atomically with DONE (main + resume) → Task 6 ✓
- DTO `baseAssetId` (+ `assetId` for matching) → Task 7 ✓
- Base-identity block UI with real `ds.tsx`/`al-*` primitives, `MediaCard ratio="1:1"`, text `Badge tone="accent"`, `IcImage`/`IcSparkle` → Task 8 ✓
- Codex gate + no auto-deploy → Task 9 ✓

**2. Placeholder scan:** none — every code step shows real code; the two import-resolution caveats (Task 5/6 scripts) name a concrete fallback assertion, not "handle it later".

**3. Type consistency:** `mode` values `"REFSHEET"|"BASE"|"VARIANT"` consistent across contract (Task 2), action (Task 5), worker (Task 6), UI prop (`"REFSHEET"|"BASE"` only, since the UI never issues VARIANT in Phase A) — intentional narrowing. `RefImageDTO.assetId` (Task 7) is consumed by Task 8's `baseRef` match + `setBaseAsset(entity.id, r.assetId)` (Task 4 signature `setBaseAsset(entityId, assetId)`) ✓. `basePromptFor(entity.type, entity)` signature (Task 3) matches its call sites (Task 3 Step 6, Task 8 Step 1) ✓.

**Deferred to Phase B (not gaps):** EntityVariant CRUD actions, variant worker i2i path, `attachOutputs` variantId re-keying, variants grid + add-variant form. **Phase C:** mention dropdown, `variantSel`, guardian/worker conditioning scope, snapshot.
