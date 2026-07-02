# Brand Memory Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Brand memory screen as a 6-section knowledge base (3 static fact sections + 3 living collections backed by a new `BrandRecord` table), with chat-on-top where OTTO auto-edits facts/records live (undoable), and a sectioned-budget rewrite of `getBrandContextText`.

**Architecture:** Static facts stay in the existing `Memory` table (category enum narrows to `about|look|rules`; legacy categories map at read time). Products / customer segments / offers become structured records in a NEW `BrandRecord` table (founder decision C: kind discriminator + zod-validated `data Json` + real `startsAt/endsAt/status` columns). OTTO writes via 4 new free skills (`saveProduct`, `saveCustomerSegment`, `saveOffer`, `lookupProducts`); the user writes via new server actions. The UI snapshots both lists before each chat turn, diffs after, highlights changes and offers Undo.

**Tech Stack:** Next.js App Router server actions, Prisma (Postgres), zod v4, `defineOttoSkill` (packages/otto), vitest, Tailwind + `.gb` shadcn tokens.

**Specs (read first):**
- `docs/superpowers/specs/2026-07-02-brand-memory-taxonomy-fable-design.md` (taxonomy + §5 拍板结果 — 7 founder decisions)
- `docs/superpowers/specs/2026-07-02-brand-memory-rebuild-design.md` (chat/live-edit/undo mechanics; superseded parts flagged in its header)

## Global Constraints

- **MONEY-GUARD (BINDING):** NEVER modify: `packages/db/src/credits.ts`, `packages/core/src/spend.ts`, `apps/worker/src/jobs/gen.ts`, `apps/worker/src/jobs/refgen.ts`, `apps/web/**/gen-actions.ts`, `apps/web/**/refgen-actions.ts`, `apps/web/**/cowork-actions.ts`, `**/useCanvasGen.ts`, `packages/generation/*`, any idempotency index. After EVERY commit run: `git log --stat -1 | grep -E "credits|spend|jobs/gen|gen-actions|refgen|cowork-actions|useCanvasGen|packages/generation"` → must output NOTHING.
- All 4 new skills are `cost: "free"` — zero new spend paths. `price` on products is a display-only string; it must never reach any billing/credits code.
- No new npm dependencies (zod already in `packages/core`). Do NOT touch `pnpm-lock.yaml` (a stale lockfile breaks worker Docker builds).
- Work in worktree `/Users/winnin/Desktop/artlio/.claude/worktrees/brand-memory`, branch `claude/brand-memory-rebuild`. ALL commands below run from that worktree root.
- UI follows the Analytics design baseline: section labels 12px/600/+0.05em/uppercase/muted; cards `rounded-[16px] border border-border`; body rows 14px `leading-[1.45]`; coral (`text-brand`) is OTTO-only signal. Match the existing class idiom in `apps/web/components/otto/OttoMemory.tsx` (Tailwind arbitrary values + shadcn `Button`/`Textarea`).
- Copy stays plain-English friendly ("Your customers", never "ICP/segments"). Code/identifiers English.
- Keep `export function threadToBubbles` in `OttoMemory.tsx` — other files import it.

---

### Task 0: Worktree bootstrap

**Files:** none (environment only)

- [ ] **Step 1: Install + generate + build packages**

```bash
cd /Users/winnin/Desktop/artlio/.claude/worktrees/brand-memory
pnpm install --frozen-lockfile
cp /Users/winnin/Desktop/artlio/packages/db/.env packages/db/.env   # dev DATABASE_URL lives only in the main checkout
pnpm --filter @fikirtive/db generate
pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build && pnpm --filter @fikirtive/otto build
```

- [ ] **Step 2: Verify baseline is green**

Run: `pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/otto test`
Expected: all existing tests PASS. (If `packages/db/.env` is missing in the main checkout, STOP and ask the founder.)

---

### Task 1: `BrandRecord` Prisma model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add model + back-relation on `Organization` ~line 585)
- Create: `packages/db/prisma/migrations/<timestamp>_brand_record/migration.sql` (generated + hand-appended index)

**Interfaces:**
- Produces: `prisma.brandRecord` client delegate with columns `{ id, ownerId, brandId, kind, nameKey, data, status, startsAt, endsAt, source, pinned, createdAt, updatedAt, deletedAt }`.

- [ ] **Step 1: Add the model to `schema.prisma`** (next to `model Memory`)

```prisma
model BrandRecord {
  id           String    @id
  ownerId      String
  organization Organization @relation(fields: [ownerId], references: [id])
  brandId      String?
  kind         String    // 'product' | 'segment' | 'offer' (code-validated, not a PG enum — house style)
  nameKey      String    // normalized name/title — upsert key (see @fikirtive/core brand-records)
  data         Json      // zod-validated per-kind payload; offer dates live in the columns below, NOT here
  status       String    @default("active") // 'active' | 'archived'
  startsAt     DateTime? // offers only
  endsAt       DateTime? // offers only — drives read-time expiry (never a background job)
  source       String    // 'otto' | 'user' (last author, same semantics as Memory.source)
  pinned       Boolean   @default(false)   // products: featured-first injection
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?

  @@index([ownerId, brandId, kind, deletedAt])
}
```

And inside `model Organization` relations block (after `brandRules BrandRule[]`):

```prisma
  brandRecords            BrandRecord[]
```

- [ ] **Step 2: Create the migration (create-only), append the live-rows unique index**

```bash
pnpm --filter @fikirtive/db exec prisma migrate dev --create-only --name brand_record
```

Append to the generated `migration.sql` (same pattern as BrandKit's F5 index — Prisma can't model functional/partial indexes):

```sql
-- Upsert-by-name guard: one live record per owner+brand+kind+nameKey (soft-deleted rows don't block re-creation).
CREATE UNIQUE INDEX "BrandRecord_owner_brand_kind_namekey_live"
  ON "BrandRecord" ("ownerId", COALESCE("brandId", ''), "kind", "nameKey")
  WHERE "deletedAt" IS NULL;
```

- [ ] **Step 3: Apply + regenerate + verify**

```bash
pnpm --filter @fikirtive/db exec prisma migrate dev
pnpm --filter @fikirtive/db generate && pnpm --filter @fikirtive/db build
pnpm --filter @fikirtive/db typecheck
```

Expected: migration applies clean; typecheck PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): BrandRecord table — living brand collections (products/segments/offers)"
```

---

### Task 2: Pure record schemas — `@fikirtive/core` `brand-records.ts` (TDD)

**Files:**
- Create: `packages/core/src/brand-records.ts`
- Test: `packages/core/src/brand-records.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Interfaces (Produces — used by Tasks 4, 5, 6, 7, 8, 10):**
- `RECORD_KINDS: readonly ["product","segment","offer"]`, `type RecordKind`
- `productRecordData / segmentRecordData / offerRecordData` (zod objects) + inferred types `ProductRecordData / SegmentRecordData / OfferRecordData`
- `recordSchemaFor(kind: RecordKind): z.ZodObject<any>`
- `recordName(kind: RecordKind, data: unknown): string` (product/segment → `.name`, offer → `.title`; returns `""` if absent)
- `normalizeNameKey(name: string): string`
- `offerPhase(o: { startsAt?: Date | null; endsAt?: Date | null }, now: Date): "active" | "scheduled" | "expired"`

- [ ] **Step 1: Write the failing test** — `packages/core/src/brand-records.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  productRecordData, segmentRecordData, offerRecordData,
  recordSchemaFor, recordName, normalizeNameKey, offerPhase,
} from "./brand-records.js";

describe("record schemas", () => {
  it("accepts a minimal product and rejects a nameless one", () => {
    expect(productRecordData.safeParse({ name: "Latte Blend" }).success).toBe(true);
    expect(productRecordData.safeParse({ description: "x" }).success).toBe(false);
  });
  it("accepts a full product", () => {
    expect(productRecordData.safeParse({
      name: "Latte Blend", description: "smooth everyday coffee", price: "RM 49",
      url: "https://x.com/latte", sellingAngle: "affordable daily ritual", tags: ["bestseller"],
    }).success).toBe(true);
  });
  it("segment requires name AND who", () => {
    expect(segmentRecordData.safeParse({ name: "Young working moms" }).success).toBe(false);
    expect(segmentRecordData.safeParse({ name: "Young working moms", who: "25-38, urban, time-poor" }).success).toBe(true);
  });
  it("offer requires title only; dates are NOT part of data", () => {
    expect(offerRecordData.safeParse({ title: "Raya sale — 20% off" }).success).toBe(true);
    expect(Object.keys(offerRecordData.shape)).not.toContain("endsAt");
  });
  it("recordSchemaFor / recordName dispatch by kind", () => {
    expect(recordSchemaFor("offer")).toBe(offerRecordData);
    expect(recordName("product", { name: "A" })).toBe("A");
    expect(recordName("offer", { title: "B" })).toBe("B");
    expect(recordName("offer", {})).toBe("");
  });
});

describe("normalizeNameKey", () => {
  it("trims, lowercases, collapses whitespace", () => {
    expect(normalizeNameKey("  Latte   Blend ")).toBe("latte blend");
  });
});

describe("offerPhase", () => {
  const now = new Date("2026-07-02T00:00:00Z");
  it("expired when endsAt passed", () =>
    expect(offerPhase({ endsAt: new Date("2026-07-01T00:00:00Z") }, now)).toBe("expired"));
  it("scheduled when startsAt in future", () =>
    expect(offerPhase({ startsAt: new Date("2026-07-10T00:00:00Z") }, now)).toBe("scheduled"));
  it("active in window / with no dates", () => {
    expect(offerPhase({ startsAt: new Date("2026-07-01T00:00:00Z"), endsAt: new Date("2026-07-15T00:00:00Z") }, now)).toBe("active");
    expect(offerPhase({}, now)).toBe("active");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/core exec vitest run src/brand-records.test.ts`
Expected: FAIL — cannot resolve `./brand-records.js`.

- [ ] **Step 3: Implement** — `packages/core/src/brand-records.ts`

```ts
/** Brand living-collection record shapes (founder decision C, 2026-07-02).
 *  Pure: zod schemas + name/date helpers. No IO. Shared by web actions + otto skills. */
import { z } from "zod";

export const RECORD_KINDS = ["product", "segment", "offer"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const productRecordData = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  /** Display-only free text ("RM 49"). NEVER parsed into any billing/credits logic. */
  price: z.string().max(60).optional(),
  url: z.string().max(500).optional(),
  sellingAngle: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});
export type ProductRecordData = z.infer<typeof productRecordData>;

export const segmentRecordData = z.object({
  name: z.string().min(1).max(120),
  who: z.string().min(1).max(400),
  pains: z.string().max(400).optional(),
  wants: z.string().max(400).optional(),
  channels: z.string().max(200).optional(),
  toneTips: z.string().max(300).optional(),
});
export type SegmentRecordData = z.infer<typeof segmentRecordData>;

/** Offer dates (startsAt/endsAt) live in real BrandRecord columns, NOT in data. */
export const offerRecordData = z.object({
  title: z.string().min(1).max(160),
  details: z.string().max(400).optional(),
  code: z.string().max(60).optional(),
  appliesTo: z.string().max(200).optional(),
});
export type OfferRecordData = z.infer<typeof offerRecordData>;

export function recordSchemaFor(kind: RecordKind): z.ZodObject<any> {
  return kind === "product" ? productRecordData : kind === "segment" ? segmentRecordData : offerRecordData;
}

export function recordName(kind: RecordKind, data: unknown): string {
  const d = data as Record<string, unknown> | null;
  const raw = kind === "offer" ? d?.title : d?.name;
  return typeof raw === "string" ? raw : "";
}

export function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type OfferPhase = "active" | "scheduled" | "expired";
/** Read-time phase derivation — status is never written back (undo stays clean). */
export function offerPhase(o: { startsAt?: Date | null; endsAt?: Date | null }, now: Date): OfferPhase {
  if (o.endsAt && o.endsAt.getTime() < now.getTime()) return "expired";
  if (o.startsAt && o.startsAt.getTime() > now.getTime()) return "scheduled";
  return "active";
}
```

Append to `packages/core/src/index.ts`:

```ts
export {
  RECORD_KINDS, productRecordData, segmentRecordData, offerRecordData,
  recordSchemaFor, recordName, normalizeNameKey, offerPhase,
} from "./brand-records.js";
export type {
  RecordKind, ProductRecordData, SegmentRecordData, OfferRecordData, OfferPhase,
} from "./brand-records.js";
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @fikirtive/core exec vitest run src/brand-records.test.ts && pnpm --filter @fikirtive/core typecheck && pnpm --filter @fikirtive/core build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): brand-record zod schemas + nameKey/offerPhase pure helpers"
```

---

### Task 3: Pure sections + diff — `@fikirtive/core` `memory-sections.ts` (TDD)

**Files:**
- Create: `packages/core/src/memory-sections.ts`
- Test: `packages/core/src/memory-sections.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (Produces — used by Tasks 8, 10):**
- `SECTIONS: readonly [{key:"about",label:"About the brand"}, {key:"look",label:"Look & feel"}, {key:"customers",label:"Your customers"}, {key:"products",label:"Your products"}, {key:"offers",label:"Your offers"}, {key:"rules",label:"Do & don't"}]` (page order)
- `type SectionKey = "about"|"look"|"customers"|"products"|"offers"|"rules"`
- `FACT_SECTION_KEYS: readonly ["about","look","rules"]` (the only sections new facts can be filed to)
- `sectionForCategory(category: string): SectionKey` (legacy mapping: Brand/Voice→about, Audience→customers, Products→products, Rules→rules, about/look/customers/products/offers/rules pass through, unknown→about)
- `diffRows<T extends {id:string; updatedAt: Date|string}>(before: T[], after: T[]): { added: T[]; changed: {before:T; after:T}[]; removed: T[] }`

- [ ] **Step 1: Write the failing test** — `packages/core/src/memory-sections.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { SECTIONS, FACT_SECTION_KEYS, sectionForCategory, diffRows } from "./memory-sections.js";

describe("SECTIONS", () => {
  it("has the 6 approved sections in page order", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(["about", "look", "customers", "products", "offers", "rules"]);
  });
  it("fact sections are the 3 static ones", () => {
    expect([...FACT_SECTION_KEYS]).toEqual(["about", "look", "rules"]);
  });
});

describe("sectionForCategory — legacy mapping", () => {
  it.each([
    ["Brand", "about"], ["Voice", "about"], ["Audience", "customers"],
    ["Products", "products"], ["Rules", "rules"],
    ["about", "about"], ["look", "look"], ["rules", "rules"],
    ["totally-unknown", "about"], ["  RULES ", "rules"],
  ])("%s → %s", (cat, want) => expect(sectionForCategory(cat)).toBe(want));
});

describe("diffRows", () => {
  const t1 = new Date("2026-07-01T00:00:00Z"), t2 = new Date("2026-07-02T00:00:00Z");
  const a = { id: "a", updatedAt: t1, content: "old" };
  it("detects added, changed (by updatedAt), removed; ignores unchanged", () => {
    const before = [a, { id: "b", updatedAt: t1 }, { id: "c", updatedAt: t1 }];
    const after = [{ ...a, updatedAt: t2, content: "new" }, { id: "b", updatedAt: t1 }, { id: "d", updatedAt: t2 }];
    const d = diffRows(before, after);
    expect(d.added.map((r) => r.id)).toEqual(["d"]);
    expect(d.changed).toEqual([{ before: a, after: { ...a, updatedAt: t2, content: "new" } }]);
    expect(d.removed.map((r) => r.id)).toEqual(["c"]);
  });
  it("empty diff for identical lists", () => {
    const d = diffRows([a], [a]);
    expect(d.added.length + d.changed.length + d.removed.length).toBe(0);
  });
  it("compares Date vs ISO-string updatedAt equal", () => {
    const d = diffRows([{ id: "a", updatedAt: t1 }], [{ id: "a", updatedAt: t1.toISOString() }]);
    expect(d.changed.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/core exec vitest run src/memory-sections.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `packages/core/src/memory-sections.ts`

```ts
/** Brand memory sections (6, founder-approved 2026-07-02) + snapshot diff for the live-edit/undo UI. Pure, no IO. */

export const SECTIONS = [
  { key: "about", label: "About the brand" },
  { key: "look", label: "Look & feel" },
  { key: "customers", label: "Your customers" },
  { key: "products", label: "Your products" },
  { key: "offers", label: "Your offers" },
  { key: "rules", label: "Do & don't" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

/** New FACTS may only be filed to these; customers/products/offers take structured records. */
export const FACT_SECTION_KEYS = ["about", "look", "rules"] as const;

const LEGACY: Record<string, SectionKey> = {
  brand: "about", voice: "about", audience: "customers", products: "products", rules: "rules",
  about: "about", look: "look", customers: "customers", offers: "offers",
};

export function sectionForCategory(category: string): SectionKey {
  return LEGACY[category.trim().toLowerCase()] ?? "about";
}

export type RowDiff<T> = { added: T[]; changed: { before: T; after: T }[]; removed: T[] };

const ts = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** id + updatedAt based diff between a pre-turn snapshot and a post-turn refetch. */
export function diffRows<T extends { id: string; updatedAt: Date | string }>(before: T[], after: T[]): RowDiff<T> {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterIds = new Set(after.map((r) => r.id));
  const added: T[] = [];
  const changed: { before: T; after: T }[] = [];
  for (const row of after) {
    const prev = beforeById.get(row.id);
    if (!prev) added.push(row);
    else if (ts(prev.updatedAt) !== ts(row.updatedAt)) changed.push({ before: prev, after: row });
  }
  const removed = before.filter((r) => !afterIds.has(r.id));
  return { added, changed, removed };
}
```

Append to `packages/core/src/index.ts`:

```ts
export { SECTIONS, FACT_SECTION_KEYS, sectionForCategory, diffRows } from "./memory-sections.js";
export type { SectionKey, RowDiff } from "./memory-sections.js";
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter @fikirtive/core exec vitest run src/memory-sections.test.ts && pnpm --filter @fikirtive/core build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): 6-section brand-memory taxonomy + legacy mapping + snapshot diff"
```

---

### Task 4: Web server actions — `brand-record-actions.ts` (TDD)

**Files:**
- Create: `apps/web/lib/brand-record-actions.ts`
- Test: `apps/web/lib/__tests__/brand-record-actions.test.ts`

**Interfaces (Produces — used by Tasks 8, 9, 10):**
```ts
export type BrandRecordRow = {
  id: string; kind: RecordKind; data: Record<string, unknown>;
  status: "active" | "archived"; startsAt: Date | null; endsAt: Date | null;
  source: "otto" | "user"; pinned: boolean; updatedAt: Date;
};
export async function listBrandRecords(_ownerId?: string, brandId?: string | null): Promise<BrandRecordRow[]>;
export async function listMyBrandRecords(): Promise<BrandRecordRow[]>;
// create when no id; full-data update when id given. source:"user". Offers: startsAt/endsAt ISO date strings.
export async function saveBrandRecord(raw: unknown): Promise<{ ok: true; id: string } | { error: string }>;
export async function deleteBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }>;   // soft delete
export async function restoreBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }>;  // clears deletedAt (undo of a remove)
```

Follow `apps/web/lib/memory-actions.ts` exactly for idiom: `"use server"`, session-scoped `requireOwner()` ignoring caller ids (SECURITY comment), `revalidatePath("/", "layout")` after writes, try/catch → friendly `{error}`.

- [ ] **Step 1: Write the failing test** — `apps/web/lib/__tests__/brand-record-actions.test.ts` (mirror the `vi.hoisted` mock pattern of `memory-actions.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireOwner, mockFindMany, mockFindFirst, mockCreate, mockUpdateMany } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { brandRecord: { findMany: mockFindMany, findFirst: mockFindFirst, create: mockCreate, updateMany: mockUpdateMany } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { listMyBrandRecords, saveBrandRecord, deleteBrandRecord, restoreBrandRecord } from "../brand-record-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
});

describe("saveBrandRecord — create", () => {
  it("creates an owner-scoped product with nameKey and source user", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});
    const res = await saveBrandRecord({ kind: "product", data: { name: "Latte  Blend", price: "RM 49" } });
    expect(res).toHaveProperty("ok", true);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: "o1", kind: "product", nameKey: "latte blend", source: "user", status: "active",
        data: { name: "Latte  Blend", price: "RM 49" },
      }),
    });
  });
  it("rejects invalid data (segment without who)", async () => {
    const res = await saveBrandRecord({ kind: "segment", data: { name: "Moms" } });
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it("stores offer dates as Date columns", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});
    await saveBrandRecord({ kind: "offer", data: { title: "Raya sale" }, startsAt: "2026-07-01", endsAt: "2026-07-15" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ startsAt: new Date("2026-07-01"), endsAt: new Date("2026-07-15") }),
    });
  });
});

describe("saveBrandRecord — update by id", () => {
  it("updates data/nameKey owner-scoped and flips source to user", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await saveBrandRecord({ id: "r1", kind: "product", data: { name: "Latte Blend", price: "RM 55" } });
    expect(res).toEqual({ ok: true, id: "r1" });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1", ownerId: "o1", deletedAt: null },
      data: expect.objectContaining({ nameKey: "latte blend", source: "user" }),
    });
  });
  it("errors when not found", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    expect(await saveBrandRecord({ id: "nope", kind: "product", data: { name: "X" } })).toHaveProperty("error");
  });
});

describe("delete / restore", () => {
  it("soft-deletes owner-scoped", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await deleteBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1", ownerId: "o1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
  it("restore clears deletedAt", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await restoreBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1", ownerId: "o1" },
      data: { deletedAt: null },
    });
  });
});

describe("listMyBrandRecords", () => {
  it("returns [] when not signed in", async () => {
    mockRequireOwner.mockResolvedValue({ error: "no" });
    expect(await listMyBrandRecords()).toEqual([]);
  });
  it("lists live rows owner-scoped, parsed shape", async () => {
    mockFindMany.mockResolvedValue([{
      id: "r1", kind: "product", data: { name: "A" }, status: "active",
      startsAt: null, endsAt: null, source: "otto", pinned: false, updatedAt: new Date(),
    }]);
    const rows = await listMyBrandRecords();
    expect(rows).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: "o1", brandId: null, deletedAt: null },
    }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run lib/__tests__/brand-record-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/web/lib/brand-record-actions.ts`

```ts
"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import {
  newId, RECORD_KINDS, recordSchemaFor, recordName, normalizeNameKey, type RecordKind,
} from "@fikirtive/core";
import { requireOwner } from "./auth-guard";

export type BrandRecordRow = {
  id: string;
  kind: RecordKind;
  data: Record<string, unknown>;
  status: "active" | "archived";
  startsAt: Date | null;
  endsAt: Date | null;
  source: "otto" | "user";
  pinned: boolean;
  updatedAt: Date;
};

const SELECT = {
  id: true, kind: true, data: true, status: true,
  startsAt: true, endsAt: true, source: true, pinned: true, updatedAt: true,
} as const;

/** Client-callable list (Memory-screen refetch after a chat turn). Session-scoped. */
export async function listMyBrandRecords(): Promise<BrandRecordRow[]> {
  return listBrandRecords();
}

export async function listBrandRecords(_ownerId?: string, brandId?: string | null): Promise<BrandRecordRow[]> {
  // SECURITY: "use server" export — owner comes from the SESSION, caller ids ignored (see memory-actions listMemory).
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const rows = await prisma.brandRecord.findMany({
    where: { ownerId: gate.ownerId, brandId: brandId ?? null, deletedAt: null },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: SELECT,
  });
  return rows as unknown as BrandRecordRow[];
}

function parseInput(raw: unknown):
  | { kind: RecordKind; data: Record<string, unknown>; id?: string; status?: "active" | "archived"; startsAt?: Date | null; endsAt?: Date | null }
  | { error: string } {
  const r = raw as { id?: unknown; kind?: unknown; data?: unknown; status?: unknown; startsAt?: unknown; endsAt?: unknown };
  const kind = r?.kind as RecordKind;
  if (!RECORD_KINDS.includes(kind)) return { error: "Unknown record type." };
  const parsed = recordSchemaFor(kind).safeParse(r.data);
  if (!parsed.success) return { error: "That record is missing something — please fill in the required fields." };
  const toDate = (v: unknown): Date | null | undefined => {
    if (v === null) return null;                       // explicit clear
    if (typeof v !== "string" || !v.trim()) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return {
    kind,
    data: parsed.data as Record<string, unknown>,
    id: typeof r.id === "string" ? r.id : undefined,
    status: r.status === "archived" ? "archived" : r.status === "active" ? "active" : undefined,
    startsAt: kind === "offer" ? toDate(r.startsAt) : undefined,
    endsAt: kind === "offer" ? toDate(r.endsAt) : undefined,
  };
}

/** Create (no id) or full-data update (id). User writes stamp source:"user". */
export async function saveBrandRecord(raw: unknown): Promise<{ ok: true; id: string } | { error: string }> {
  const input = parseInput(raw);
  if ("error" in input) return input;
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const nameKey = normalizeNameKey(recordName(input.kind, input.data));
  if (!nameKey) return { error: "A record needs a name." };

  try {
    if (input.id) {
      const { count } = await prisma.brandRecord.updateMany({
        where: { id: input.id, ownerId: gate.ownerId, deletedAt: null },
        data: {
          data: input.data, nameKey, source: "user",
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        },
      });
      if (!count) return { error: "Record not found." };
      revalidatePath("/", "layout");
      return { ok: true, id: input.id };
    }
    const existing = await prisma.brandRecord.findFirst({
      where: { ownerId: gate.ownerId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
      select: { id: true },
    });
    if (existing) return saveBrandRecord({ ...(raw as object), id: existing.id });
    const id = newId();
    await prisma.brandRecord.create({
      data: {
        id, ownerId: gate.ownerId, brandId: null,
        kind: input.kind, nameKey, data: input.data,
        status: input.status ?? "active",
        startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
        source: "user", pinned: false,
      },
    });
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch {
    return { error: "Couldn't save that — please try again." };
  }
}

export async function deleteBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  try {
    const { count } = await prisma.brandRecord.updateMany({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!count) return { error: "Record not found." };
  } catch { return { error: "Couldn't delete — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Undo of an OTTO-removed record: bring the soft-deleted row back. */
export async function restoreBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  try {
    const { count } = await prisma.brandRecord.updateMany({
      where: { id: r.id, ownerId: gate.ownerId },
      data: { deletedAt: null },
    });
    if (!count) return { error: "Record not found." };
  } catch { return { error: "Couldn't restore — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter web exec vitest run lib/__tests__/brand-record-actions.test.ts && pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/brand-record-actions.ts apps/web/lib/__tests__/brand-record-actions.test.ts
git commit -m "feat(web): BrandRecord server actions (list/save/delete/restore, session-scoped)"
```

---

### Task 5: OTTO write skills — shared upsert + `saveProduct` / `saveCustomerSegment` / `saveOffer` (TDD)

**Files:**
- Create: `packages/otto/src/skills/_brand-record.ts` (shared execute helper)
- Create: `packages/otto/src/skills/save-product.ts`, `save-customer-segment.ts`, `save-offer.ts`
- Test: `packages/otto/src/skills/_brand-record.test.ts`

**Interfaces:**
- Consumes: `RECORD_KINDS/recordSchemaFor/recordName/normalizeNameKey` from `@fikirtive/core` (Task 2); `prisma.brandRecord` (Task 1); `defineOttoSkill` + `OttoContext` (existing).
- Produces: `saveProductSkill`, `saveCustomerSegmentSkill`, `saveOfferSkill` (each `OttoSkill`, cost:"free"/effect:"write"/reach:"internal" → no approval), and `upsertBrandRecordFromOtto(input, runContext)` for tests.

**Semantics (all three skills):** upsert by normalized name. On update, MERGE provided fields into existing `data` (an OTTO call that only mentions `channels` must not wipe `pains`). Writes stamp `source:"otto"`. `status:"archived"` goes through the same skill. Offers accept `startsAt`/`endsAt` as `YYYY-MM-DD` strings → Date columns. Identity from ctx only (framework-enforced).

- [ ] **Step 1: Write the failing test** — `packages/otto/src/skills/_brand-record.test.ts` (mirror the `remember-brand-fact.test.ts` mock pattern)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";
import { saveProductSkill } from "./save-product.js";
import { saveCustomerSegmentSkill } from "./save-customer-segment.js";
import { saveOfferSkill } from "./save-offer.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    brandRecord: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    genJob: { create: vi.fn() }, // must never be called — these are $0 skills
  },
}));
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: vi.fn(() => "rec-id-1"),
}));

function makeCtx(): OttoContext {
  return {
    orgId: "org-test", userId: "user-test", projectId: "proj-test", threadId: "thread-test",
    disabledModels: [], sourceGenerationId: null,
  } as unknown as OttoContext;
}

let db: { prisma: { brandRecord: Record<string, ReturnType<typeof vi.fn>>; genJob: { create: ReturnType<typeof vi.fn> } } };
beforeEach(async () => {
  vi.clearAllMocks();
  db = (await import("@fikirtive/db")) as unknown as typeof db;
});

describe("upsertBrandRecordFromOtto", () => {
  it("creates when no live row matches nameKey (source otto, ownerId from ctx)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    db.prisma.brandRecord.create.mockResolvedValue({});
    const res = await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", price: "RM 49" } },
      { context: makeCtx() },
    );
    expect(res).toEqual({ ok: true, id: "rec-id-1", updated: false });
    expect(db.prisma.brandRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: "org-test", kind: "product", nameKey: "latte blend", source: "otto", status: "active",
      }),
    });
    expect(db.prisma.genJob.create).not.toHaveBeenCalled();
  });

  it("merges fields into existing data on update (does not wipe unspecified fields)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue({
      id: "r-old", data: { name: "Young working moms", who: "25-38 urban", pains: "no time" },
    });
    db.prisma.brandRecord.update.mockResolvedValue({});
    const res = await upsertBrandRecordFromOtto(
      { kind: "segment", fields: { name: "Young working moms", channels: "IG Reels, XHS" } },
      { context: makeCtx() },
    );
    expect(res).toEqual({ ok: true, id: "r-old", updated: true });
    expect(db.prisma.brandRecord.update).toHaveBeenCalledWith({
      where: { id: "r-old" },
      data: expect.objectContaining({
        source: "otto",
        data: { name: "Young working moms", who: "25-38 urban", pains: "no time", channels: "IG Reels, XHS" },
      }),
    });
  });

  it("rejects when merged data fails the kind schema (create of segment without who)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    await expect(
      upsertBrandRecordFromOtto({ kind: "segment", fields: { name: "Moms" } }, { context: makeCtx() }),
    ).rejects.toThrow(/who/i);
    expect(db.prisma.brandRecord.create).not.toHaveBeenCalled();
  });

  it("offer dates land in columns, not data", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    db.prisma.brandRecord.create.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "offer", fields: { title: "Raya sale" }, startsAt: "2026-07-01", endsAt: "2026-07-15" },
      { context: makeCtx() },
    );
    const arg = db.prisma.brandRecord.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.startsAt).toEqual(new Date("2026-07-01"));
    expect(arg.data.endsAt).toEqual(new Date("2026-07-15"));
    expect((arg.data.data as Record<string, unknown>).endsAt).toBeUndefined();
  });
});

describe("skill classifications", () => {
  it.each([[saveProductSkill], [saveCustomerSegmentSkill], [saveOfferSkill]])(
    "%o is free/write/internal → no approval",
    (skill) => {
      expect(skill.cost).toBe("free");
      expect(skill.effect).toBe("write");
      expect(skill.reach).toBe("internal");
      expect(skill.needsApproval).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/_brand-record.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement helper** — `packages/otto/src/skills/_brand-record.ts`

```ts
/**
 * _brand-record — shared $0 upsert for the three living-collection write skills.
 * Spends NO money, creates NO GenJob. Identity from ctx only (never tool input).
 * Upsert-by-name: find live row (ownerId+kind+nameKey) → merge-update; else create.
 */
import type { RunContext } from "@openai/agents";
import { prisma } from "@fikirtive/db";
import {
  newId, recordSchemaFor, recordName, normalizeNameKey, type RecordKind,
} from "@fikirtive/core";
import type { OttoContext } from "../context.js";

export interface UpsertBrandRecordInput {
  kind: RecordKind;
  /** Partial per-kind fields, already shape-checked by the skill's zod parameters. */
  fields: Record<string, unknown>;
  status?: "active" | "archived";
  startsAt?: string; // YYYY-MM-DD (offers)
  endsAt?: string;
}

const stripUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const toDate = (v?: string): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export async function upsertBrandRecordFromOtto(
  input: UpsertBrandRecordInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: true; id: string; updated: boolean }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const name = recordName(input.kind, input.fields);
  const nameKey = normalizeNameKey(name);
  if (!nameKey) throw new Error(`A ${input.kind} needs a name.`);

  const existing = await prisma.brandRecord.findFirst({
    where: { ownerId: ctx.orgId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
    select: { id: true, data: true },
  });

  // Merge (update) or take as-is (create), then validate the FULL shape.
  const mergedRaw = existing
    ? { ...(existing.data as Record<string, unknown>), ...stripUndefined(input.fields) }
    : stripUndefined(input.fields);
  const parsed = recordSchemaFor(input.kind).safeParse(mergedRaw);
  if (!parsed.success) {
    throw new Error(`Invalid ${input.kind}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const data = parsed.data as Record<string, unknown>;

  const dates = stripUndefined({ startsAt: toDate(input.startsAt), endsAt: toDate(input.endsAt) });
  const status = input.status;

  if (existing) {
    await prisma.brandRecord.update({
      where: { id: existing.id },
      data: { data, nameKey, source: "otto", ...(status ? { status } : {}), ...dates },
    });
    return { ok: true, id: existing.id, updated: true };
  }

  const id = newId();
  try {
    await prisma.brandRecord.create({
      data: {
        id, ownerId: ctx.orgId, brandId: null,
        kind: input.kind, nameKey, data,
        status: status ?? "active",
        startsAt: (dates.startsAt as Date | undefined) ?? null,
        endsAt: (dates.endsAt as Date | undefined) ?? null,
        source: "otto", pinned: false,
      },
    });
  } catch (e) {
    // Unique-index race (two turns saving the same name): retry once as an update.
    const again = await prisma.brandRecord.findFirst({
      where: { ownerId: ctx.orgId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
      select: { id: true },
    });
    if (!again) throw e;
    await prisma.brandRecord.update({ where: { id: again.id }, data: { data, source: "otto", ...(status ? { status } : {}), ...dates } });
    return { ok: true, id: again.id, updated: true };
  }
  return { ok: true, id, updated: false };
}
```

- [ ] **Step 4: Implement the three skills**

`packages/otto/src/skills/save-product.ts`:

```ts
/** saveProduct — $0 skill. Upserts ONE product record (by name) in Brand memory. */
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";

const params = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  price: z.string().max(60).optional(),
  url: z.string().max(500).optional(),
  sellingAngle: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const saveProductSkill = defineOttoSkill({
  name: "saveProduct",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Save or update ONE product in the user's Brand memory (upsert by name — mentioning an existing product's name updates it, and fields you omit are kept). " +
    "$0. Use when the user describes something they sell, changes a price/angle, or asks you to record products (e.g. from their website). " +
    "price is display text like 'RM 49' — only record a price the user or their site actually stated. Set status:'archived' to retire a product.",
  parameters: params,
  execute: async ({ status, ...fields }, runContext) =>
    upsertBrandRecordFromOtto({ kind: "product", fields, status }, runContext),
});

export const saveProduct = saveProductSkill.tool;
```

`packages/otto/src/skills/save-customer-segment.ts`:

```ts
/** saveCustomerSegment — $0 skill. Upserts ONE customer group card (by name) in Brand memory. */
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";

const params = z.object({
  name: z.string().min(1).max(120),
  who: z.string().min(1).max(400).optional(),
  pains: z.string().max(400).optional(),
  wants: z.string().max(400).optional(),
  channels: z.string().max(200).optional(),
  toneTips: z.string().max(300).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const saveCustomerSegmentSkill = defineOttoSkill({
  name: "saveCustomerSegment",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Save or update ONE customer group in the user's Brand memory (upsert by name; omitted fields are kept). $0. " +
    "Use when the user describes who they sell to — a distinct group with its own pains/wants/channels. " +
    "Keep groups few and meaningful (a brand rarely needs more than ~6). 'who' is required when creating a new group.",
  parameters: params,
  execute: async ({ status, ...fields }, runContext) =>
    upsertBrandRecordFromOtto({ kind: "segment", fields, status }, runContext),
});

export const saveCustomerSegment = saveCustomerSegmentSkill.tool;
```

`packages/otto/src/skills/save-offer.ts`:

```ts
/** saveOffer — $0 skill. Upserts ONE offer/promotion (by title) in Brand memory. */
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";

const params = z.object({
  title: z.string().min(1).max(160),
  details: z.string().max(400).optional(),
  code: z.string().max(60).optional(),
  appliesTo: z.string().max(200).optional(),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
});

export const saveOfferSkill = defineOttoSkill({
  name: "saveOffer",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Save or update ONE offer/promotion in the user's Brand memory (upsert by title; omitted fields are kept). $0. " +
    "Use when the user mentions a sale, discount, promo code or campaign period. Record endsAt whenever known — " +
    "expired offers are automatically excluded from your context. 'Extend the Raya sale to the 20th' = same title, new endsAt.",
  parameters: params,
  execute: async ({ startsAt, endsAt, ...fields }, runContext) =>
    upsertBrandRecordFromOtto({ kind: "offer", fields, startsAt, endsAt }, runContext),
});

export const saveOffer = saveOfferSkill.tool;
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/_brand-record.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src/skills/_brand-record.ts packages/otto/src/skills/_brand-record.test.ts packages/otto/src/skills/save-product.ts packages/otto/src/skills/save-customer-segment.ts packages/otto/src/skills/save-offer.ts
git commit -m "feat(otto): saveProduct/saveCustomerSegment/saveOffer $0 skills (merge-upsert by name)"
```

---

### Task 6: OTTO read skill — `lookupProducts` (TDD)

**Files:**
- Create: `packages/otto/src/skills/lookup-products.ts`
- Test: `packages/otto/src/skills/lookup-products.test.ts`

**Interfaces:**
- Produces: `lookupProductsSkill` (cost:"free"/effect:"read"/reach:"internal"), `executeLookupProducts(input, runContext)` returning `{ matches: Array<{ name; description?; price?; url?; sellingAngle?; tags?; status }> }` (≤5).

- [ ] **Step 1: Write the failing test** — `packages/otto/src/skills/lookup-products.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeLookupProducts, lookupProductsSkill } from "./lookup-products.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: { brandRecord: { findMany: vi.fn() } },
}));

const ctx = { context: { orgId: "org-1" } as unknown as OttoContext };
const row = (name: string, extra: Record<string, unknown> = {}) => ({
  data: { name, ...extra }, status: "active", pinned: false, updatedAt: new Date(),
});

let db: { prisma: { brandRecord: { findMany: ReturnType<typeof vi.fn> } } };
beforeEach(async () => {
  vi.clearAllMocks();
  db = (await import("@fikirtive/db")) as unknown as typeof db;
});

describe("executeLookupProducts", () => {
  it("is free/read/internal, no approval", () => {
    expect(lookupProductsSkill.cost).toBe("free");
    expect(lookupProductsSkill.effect).toBe("read");
    expect(lookupProductsSkill.needsApproval).toBe(false);
  });
  it("matches name/description/tags case-insensitively, caps at 5", async () => {
    db.prisma.brandRecord.findMany.mockResolvedValue([
      row("Latte Blend"), row("Espresso Kit", { description: "strong latte-style shots" }),
      row("Tea Sampler", { tags: ["latte-alternative"] }), row("Mug"), 
      row("Latte 2"), row("Latte 3"), row("Latte 4"), row("Latte 5"),
    ]);
    const res = await executeLookupProducts({ query: "LATTE" }, ctx);
    expect(res.matches.length).toBe(5);
    expect(res.matches.map((m) => m.name)).not.toContain("Mug");
    expect(db.prisma.brandRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: "org-1", kind: "product", deletedAt: null, status: "active" }),
    }));
  });
  it("returns empty matches for no hit", async () => {
    db.prisma.brandRecord.findMany.mockResolvedValue([row("Mug")]);
    expect((await executeLookupProducts({ query: "latte" }, ctx)).matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/lookup-products.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `packages/otto/src/skills/lookup-products.ts`

```ts
/** lookupProducts — $0 read skill: on-demand catalog retrieval so a growing product list never bloats the prompt. */
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";

const params = z.object({ query: z.string().min(1).max(80) });

export async function executeLookupProducts(
  input: z.infer<typeof params>,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ matches: Record<string, unknown>[] }> {
  const ctx = runContext.context as OttoContext;
  const q = input.query.trim().toLowerCase();
  const rows = await prisma.brandRecord.findMany({
    where: { ownerId: ctx.orgId, brandId: null, kind: "product", deletedAt: null, status: "active" },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { data: true },
    take: 200, // catalog design bound (founder decision 6); substring match in app code
  });
  const hit = (d: Record<string, unknown>): boolean => {
    const hay = [d.name, d.description, d.sellingAngle, ...(Array.isArray(d.tags) ? d.tags : [])]
      .filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
    return hay.includes(q);
  };
  const matches = rows.map((r) => r.data as Record<string, unknown>).filter(hit).slice(0, 5);
  return { matches };
}

export const lookupProductsSkill = defineOttoSkill({
  name: "lookupProducts",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Look up the user's saved products by name, tag or description (returns up to 5 full records). $0. " +
    "Your context only shows a summary of the catalog — call this BEFORE naming, pricing or featuring a specific product that isn't already in your context.",
  parameters: params,
  execute: executeLookupProducts,
});

export const lookupProducts = lookupProductsSkill.tool;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/lookup-products.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/otto/src/skills/lookup-products.ts packages/otto/src/skills/lookup-products.test.ts
git commit -m "feat(otto): lookupProducts $0 read skill — on-demand catalog retrieval"
```

---

### Task 7: Wire skills — registry, `rememberBrandFact` enum, instructions, catalog

**Files:**
- Modify: `packages/otto/src/skills/remember-brand-fact.ts` (enum + description)
- Modify: `packages/otto/src/skills/remember-brand-fact.test.ts` (category values in existing cases)
- Modify: `packages/otto/src/registry.ts` (+4 skills)
- Modify: `packages/otto/src/instructions.ts` (`## Brand memory` block, ~line 102)
- Modify: `packages/otto/src/registry.test.ts` / `catalog` if count-asserted (run and see)

**Interfaces:**
- Consumes: the 4 skills from Tasks 5–6.
- Produces: `rememberBrandFact` category enum = `["about", "look", "rules"]`. Registry order: insert the 4 new skills right after `rememberBrandFactSkill`.

- [ ] **Step 1: Narrow the fact enum.** In `remember-brand-fact.ts` replace:

```ts
const rememberBrandFactInput = z.object({
  category: z.enum(["Brand", "Voice", "Audience", "Products", "Rules"]),
  content: z.string().min(1).max(600),
});
```

with:

```ts
// 6-section taxonomy (2026-07-02): free-text FACTS file to the 3 static sections only.
// Products / customer groups / offers are structured records → saveProduct / saveCustomerSegment / saveOffer.
// Legacy categories (Brand/Voice/Audience/Products/Rules) map at read time in @fikirtive/core sectionForCategory.
const rememberBrandFactInput = z.object({
  category: z.enum(["about", "look", "rules"]),
  content: z.string().min(1).max(600),
});
```

and replace the skill `description` with:

```ts
  description:
    "Save ONE durable brand FACT to Brand Memory. $0, persists across campaigns. Categories: " +
    "'about' = who the brand is, story, voice, positioning; 'look' = visual style, colors, imagery mood; " +
    "'rules' = hard do/don't constraints (banned words, competitors, compliance). " +
    "Call ONLY for durable truths the user states or asks you to remember — never one-off creative choices. " +
    "For products, customer groups or offers/promotions use saveProduct / saveCustomerSegment / saveOffer instead.",
```

- [ ] **Step 2: Update `remember-brand-fact.test.ts`** — change every `category: "Brand"|"Voice"|...` literal in existing cases to `"about"`/`"look"`/`"rules"` (behavioral assertions unchanged). Add one case:

```ts
  it("rejects legacy category values", () => {
    expect(rememberBrandFactInput_forTest?.safeParse?.({ category: "Products", content: "x" }).success ?? false).toBe(false);
  });
```

(If the schema isn't exported, assert via the tool path the file already uses — follow the file's existing pattern; do not export internals just for this.)

- [ ] **Step 3: Register the 4 skills.** In `registry.ts` add imports and insert after `rememberBrandFactSkill`:

```ts
import { saveProductSkill } from "./skills/save-product.js";
import { saveCustomerSegmentSkill } from "./skills/save-customer-segment.js";
import { saveOfferSkill } from "./skills/save-offer.js";
import { lookupProductsSkill } from "./skills/lookup-products.js";
```

```ts
  rememberBrandFactSkill,
  saveProductSkill,
  saveCustomerSegmentSkill,
  saveOfferSkill,
  lookupProductsSkill,
```

- [ ] **Step 4: Rewrite the `## Brand memory` block in `instructions.ts`** (currently ~line 102, the paragraph starting "When the user shares a durable brand fact") with:

```md
## Brand memory

Brand memory has two shapes — pick the right tool:
- **Facts** (durable free-text truths): \`rememberBrandFact\` with category \`about\` (story/voice/identity), \`look\` (visual style, colors, imagery), or \`rules\` (hard do/don't).
- **Records** (living, structured): \`saveProduct\`, \`saveCustomerSegment\`, \`saveOffer\` — upsert by name/title, so updating an existing one is one call and omitted fields are kept. Archive with status:"archived", never delete.

Save only durable, reusable truths — never one-off creative choices; don't save near-duplicates. When you research the user's website, also capture the products and current offers you find (records), not just facts.

Discipline for produced content:
- **Prices** come ONLY from product records. If no record states a price, write copy without a number.
- **Offers**: never reference an expired or invented offer; only use offers in your context (expired ones are auto-removed) — record new ones the user mentions with \`saveOffer\`.
- Featuring a specific product not in your context? Call \`lookupProducts\` first.
```

- [ ] **Step 5: Regenerate catalog + run the otto suite**

```bash
pnpm --filter @fikirtive/otto catalog
pnpm --filter @fikirtive/otto test && pnpm --filter @fikirtive/otto typecheck && pnpm --filter @fikirtive/otto build
```

Expected: PASS. If `registry.test.ts`/`catalog.test.ts` assert a skill count, update 15 → 19 (or per its fixture style).

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src packages/otto/skills 2>/dev/null; git add packages/otto
git commit -m "feat(otto): register record skills; rememberBrandFact → about|look|rules; brand-memory instructions v2"
```

---

### Task 8: `getBrandContextText` v2 — sectioned budgets + records (TDD)

**Files:**
- Modify: `apps/web/lib/memory-actions.ts` (only `getBrandContextText`; the CRUD actions stay untouched)
- Modify: `apps/web/lib/__tests__/memory-actions.test.ts` (extend)

**Interfaces:**
- Signature UNCHANGED: `getBrandContextText(_ownerId?: string, brandId?: string | null): Promise<string>` — its 3 callers in `otto-actions.ts` are not modified.
- Consumes: `sectionForCategory`, `offerPhase`, `SECTIONS` from `@fikirtive/core`; `prisma.brandRecord`.

**Behavior:**
1. Fetch in one `Promise.all`: memory rows (as today), brandKit, brandRules, PLUS `prisma.brandRecord.findMany({ where: { ownerId, brandId: brandId ?? null, deletedAt: null }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], select: { kind: true, data: true, status: true, startsAt: true, endsAt: true, pinned: true } })`.
2. Assemble per-section with per-section character budgets (cap each with `…` suffix), output order + budgets:
   - `Brand rules:` (BrandRule rows + memory facts mapped to `rules`) — **600, first (never truncated by other sections again — fixes the current bug where `slice(0,3000)` cut rules last-in-first-cut)**
   - `About the brand:` (facts → `about`) + `Look & feel:` (facts → `look`) + `Brand kit:` block (existing format) — 1200 combined
   - `Your customers:` active segments, one line each: `- <name>: <who>; pains: <pains>; reach: <channels>; tone: <toneTips>` (skip empty fields) + legacy loose notes mapped to `customers` — 900
   - `Your offers (active):` records where `offerPhase(..., new Date()) !== "expired"` and status active; scheduled ones prefixed `(upcoming)`; one line: `- <title> (<details>; code <code>, ends <YYYY-MM-DD>)` — 500. **Expired offers NEVER appear.**
   - `Your products:` header line `N total (M pinned).` then Top-10 (pinned first, then updatedAt): `- <name> — <description>; <price>; angle: <sellingAngle>` + trailing `(use lookupProducts for the rest)` when N > 10 — 800. Legacy loose notes mapped to `products` count toward this budget after the records.
3. Global `slice(0,3000)` is REMOVED (per-section caps bound the total ≈ 4.1k chars).
4. Empty sections are omitted (as today). All-empty → `""`.

- [ ] **Step 1: Extend the test file with failing cases** (keep every existing test green — the mock setup at top already stubs kit/rules; add `brandRecord: { findMany: mockRecordFindMany }` to the prisma mock and a `mockRecordFindMany` default of `[]` in `beforeEach`):

```ts
describe("getBrandContextText v2 — sections + records", () => {
  it("rules come first and survive when other sections are huge", async () => {
    mockMemoryFindMany.mockResolvedValue(
      Array.from({ length: 80 }, (_, i) => ({ category: "Brand", content: `note ${i} ${"x".repeat(50)}` })),
    );
    mockRuleFindMany.mockResolvedValue([{ kind: "never", text: "no competitor names" }]);
    const text = await getBrandContextText();
    expect(text.startsWith("Brand rules:")).toBe(true);
    expect(text).toContain("no competitor names");
  });

  it("injects active segments and offers, excludes expired offers", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    mockRecordFindMany.mockResolvedValue([
      { kind: "segment", data: { name: "Young working moms", who: "25-38 urban" }, status: "active", startsAt: null, endsAt: null, pinned: false },
      { kind: "offer", data: { title: "Raya sale", code: "RAYA20" }, status: "active", startsAt: null, endsAt: new Date("2099-01-01"), pinned: false },
      { kind: "offer", data: { title: "Dead promo" }, status: "active", startsAt: null, endsAt: new Date("2020-01-01"), pinned: false },
    ]);
    const text = await getBrandContextText();
    expect(text).toContain("Young working moms");
    expect(text).toContain("Raya sale");
    expect(text).not.toContain("Dead promo");
  });

  it("products: summary + top list, archived excluded, lookup hint when >10", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    const product = (name: string, pinned = false, status = "active") =>
      ({ kind: "product", data: { name, price: "RM 9" }, status, startsAt: null, endsAt: null, pinned });
    mockRecordFindMany.mockResolvedValue([
      product("Pinned One", true), ...Array.from({ length: 12 }, (_, i) => product(`P${i}`)),
      product("Gone", false, "archived"),
    ]);
    const text = await getBrandContextText();
    expect(text).toMatch(/Your products: 13 total \(1 pinned\)/);
    expect(text).toContain("Pinned One");
    expect(text).not.toContain("Gone");
    expect(text).toContain("lookupProducts");
  });

  it("legacy Audience facts appear under Your customers", async () => {
    mockMemoryFindMany.mockResolvedValue([{ category: "Audience", content: "mostly KL urbanites" }]);
    const text = await getBrandContextText();
    expect(text).toContain("Your customers");
    expect(text).toContain("mostly KL urbanites");
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm --filter web exec vitest run lib/__tests__/memory-actions.test.ts`
Expected: new cases FAIL; old cases still PASS (if an old case asserted the exact legacy concat format, update it to the sectioned format consciously — note it in the commit body).

- [ ] **Step 3: Implement** — replace the body of `getBrandContextText` in `apps/web/lib/memory-actions.ts`:

```ts
export async function getBrandContextText(_ownerId?: string, brandId?: string | null): Promise<string> {
  // SECURITY: session-scoped, ignore any caller-supplied id (see listMemory above).
  const gate = await requireOwner();
  if ("error" in gate) return "";
  const ownerId = gate.ownerId;

  const [rows, kit, rules, records] = await Promise.all([
    prisma.memory.findMany({
      where: { ownerId, brandId: brandId ?? null, deletedAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { category: true, content: true },
      take: 100,
    }),
    prisma.brandKit.findFirst({
      where: { ownerId, brandId: brandId ?? null },
      select: { name: true, colorsJson: true, fonts: true, tone: true, styleGuide: true },
    }),
    prisma.brandRule.findMany({
      where: { ownerId, brandId: brandId ?? null, active: true },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
      select: { kind: true, text: true },
    }),
    prisma.brandRecord.findMany({
      where: { ownerId, brandId: brandId ?? null, deletedAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { kind: true, data: true, status: true, startsAt: true, endsAt: true, pinned: true },
    }),
  ]);

  // Per-section budgets (chars). Rules are assembled FIRST so they can never be
  // truncated by other sections growing (the old global slice(0,3000) cut them first).
  const cap = (text: string, budget: number) => (text.length <= budget ? text : text.slice(0, budget) + "…");
  const now = new Date();

  // Facts grouped into the 6-section taxonomy (legacy categories map here).
  const factsBySection = new Map<string, string[]>();
  for (const r of rows) {
    const key = sectionForCategory(r.category);
    factsBySection.set(key, [...(factsBySection.get(key) ?? []), r.content]);
  }

  const parts: string[] = [];

  // 1) Do & don't — budget 600
  {
    const lines: string[] = [];
    const byKind = new Map<string, string[]>();
    for (const r of rules) byKind.set(r.kind.toUpperCase(), [...(byKind.get(r.kind.toUpperCase()) ?? []), r.text]);
    for (const [kind, texts] of byKind) lines.push(`${kind}: ${texts.join("; ")}`);
    for (const f of factsBySection.get("rules") ?? []) lines.push(f);
    if (lines.length) parts.push(cap(`Brand rules:\n${lines.join("\n")}`, 600));
  }

  // 2) About + Look & feel + Brand kit — budget 1200 combined
  {
    const lines: string[] = [];
    const about = factsBySection.get("about") ?? [];
    if (about.length) lines.push(`About the brand: ${about.join("; ")}`);
    const look = factsBySection.get("look") ?? [];
    if (look.length) lines.push(`Look & feel: ${look.join("; ")}`);
    if (kit) {
      const kitLines: string[] = [];
      if (kit.name) kitLines.push(`Name: ${kit.name}`);
      if (kit.colorsJson) kitLines.push(`Colors: ${JSON.stringify(kit.colorsJson)}`);
      if (kit.fonts?.length) kitLines.push(`Fonts: ${kit.fonts.join(", ")}`);
      if (kit.tone) kitLines.push(`Tone: ${kit.tone}`);
      if (kit.styleGuide) kitLines.push(`Style guide: ${kit.styleGuide}`);
      if (kitLines.length) lines.push(`Brand kit:\n${kitLines.join("\n")}`);
    }
    if (lines.length) parts.push(cap(lines.join("\n"), 1200));
  }

  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

  // 3) Your customers — budget 900
  {
    const lines: string[] = [];
    for (const rec of records) {
      if (rec.kind !== "segment" || rec.status !== "active") continue;
      const d = rec.data as Record<string, unknown>;
      const bits = [str(d.who), str(d.pains) && `pains: ${d.pains}`, str(d.wants) && `wants: ${d.wants}`,
        str(d.channels) && `reach: ${d.channels}`, str(d.toneTips) && `tone: ${d.toneTips}`].filter(Boolean);
      lines.push(`- ${str(d.name) ?? "?"}: ${bits.join("; ")}`);
    }
    for (const f of factsBySection.get("customers") ?? []) lines.push(`- ${f}`);
    if (lines.length) parts.push(cap(`Your customers:\n${lines.join("\n")}`, 900));
  }

  // 4) Your offers — budget 500; expired NEVER injected (read-time derivation)
  {
    const lines: string[] = [];
    for (const rec of records) {
      if (rec.kind !== "offer" || rec.status !== "active") continue;
      const phase = offerPhase(rec, now);
      if (phase === "expired") continue;
      const d = rec.data as Record<string, unknown>;
      const bits = [str(d.details), str(d.code) && `code ${d.code}`,
        rec.endsAt && `ends ${rec.endsAt.toISOString().slice(0, 10)}`].filter(Boolean);
      lines.push(`- ${phase === "scheduled" ? "(upcoming) " : ""}${str(d.title) ?? "?"}${bits.length ? ` (${bits.join("; ")})` : ""}`);
    }
    if (lines.length) parts.push(cap(`Your offers (active):\n${lines.join("\n")}`, 500));
  }

  // 5) Your products — budget 800: summary + Top-10 + lookup hint
  {
    const products = records.filter((r) => r.kind === "product" && r.status === "active");
    const lines: string[] = [];
    if (products.length) {
      const pinnedCount = products.filter((p) => p.pinned).length;
      lines.push(`Your products: ${products.length} total (${pinnedCount} pinned). Top:`);
      for (const rec of products.slice(0, 10)) {
        const d = rec.data as Record<string, unknown>;
        const bits = [str(d.description), str(d.price), str(d.sellingAngle) && `angle: ${d.sellingAngle}`].filter(Boolean);
        lines.push(`- ${str(d.name) ?? "?"}${bits.length ? ` — ${bits.join("; ")}` : ""}`);
      }
      if (products.length > 10) lines.push("(use lookupProducts for the rest)");
    }
    for (const f of factsBySection.get("products") ?? []) lines.push(`- ${f}`);
    if (lines.length) parts.push(cap(lines.join("\n"), 800));
  }

  if (!parts.length) return "";
  return parts.join("\n\n");
}
```

Add to the imports at top of the file: `import { sectionForCategory, offerPhase } from "@fikirtive/core";`

- [ ] **Step 4: Run the full web-lib suite + typecheck**

Run: `pnpm --filter web exec vitest run lib/__tests__/memory-actions.test.ts && pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/memory-actions.ts apps/web/lib/__tests__/memory-actions.test.ts
git commit -m "feat(web): getBrandContextText v2 — sectioned budgets (rules first) + record injection

Fixes the pre-existing truncation bug where Brand rules, appended last,
were the first content cut by the global slice(0,3000)."
```

---

### Task 9: Data threading — page load + `OttoView` + skin-preview mocks

**Files:**
- Modify: `apps/web/app/otto/page.tsx` (~line 41: add records to the `Promise.all`)
- Modify: `apps/web/components/otto/OttoView.tsx` (accept + pass `records`)
- Modify: `apps/web/app/skin-preview/page.tsx` (mock records)

**Interfaces:**
- Consumes: `listBrandRecords`, `BrandRecordRow` (Task 4).
- Produces: `<OttoMemory initialMemory={memory} initialRecords={records} projectId={projectId} />` — Task 10 implements the new prop.

- [ ] **Step 1: `apps/web/app/otto/page.tsx`** — in the existing `Promise.all` next to `listMemory(ownerId)` add `listBrandRecords(ownerId)` (import from `@/lib/brand-record-actions`), destructure as `records`, pass down to the component currently receiving `memory` (follow the existing prop path — `OttoApp`/`OttoView`).

- [ ] **Step 2: `OttoView.tsx`** — add `records: BrandRecordRow[]` to props, and change the memory view branch (~line 96) to:

```tsx
        <OttoMemory initialMemory={memory} initialRecords={records} projectId={projectId} />
```

- [ ] **Step 3: `skin-preview/page.tsx`** — next to the existing `memory: MemoryRow[]` mock add:

```ts
  const records: BrandRecordRow[] = [
    { id: "sp-seg1", kind: "segment", data: { name: "Young working moms", who: "25–38, urban, time-poor", pains: "no time to cook", channels: "IG Reels, TikTok" }, status: "active", startsAt: null, endsAt: null, source: "otto", pinned: false, updatedAt: new Date() },
    { id: "sp-prod1", kind: "product", data: { name: "Latte Blend", description: "smooth everyday coffee", price: "RM 49", sellingAngle: "affordable daily ritual" }, status: "active", startsAt: null, endsAt: null, source: "user", pinned: true, updatedAt: new Date() },
    { id: "sp-prod2", kind: "product", data: { name: "Espresso Kit", price: "RM 129" }, status: "active", startsAt: null, endsAt: null, source: "otto", pinned: false, updatedAt: new Date() },
    { id: "sp-off1", kind: "offer", data: { title: "Raya sale — 20% off", code: "RAYA20" }, status: "active", startsAt: null, endsAt: new Date("2026-07-15"), source: "otto", pinned: false, updatedAt: new Date() },
    { id: "sp-off2", kind: "offer", data: { title: "Launch promo (over)" }, status: "active", startsAt: null, endsAt: new Date("2026-06-01"), source: "user", pinned: false, updatedAt: new Date() },
  ];
```

and pass `records={records}` where `memory={memory}` is passed (import the type from `@/lib/brand-record-actions`).

- [ ] **Step 4: Typecheck** (will fail on `initialRecords` until Task 10 — acceptable ONLY if Tasks 9+10 are executed by the same worker before committing; otherwise stub the prop as optional in Task 10 first). Preferred: do Step 5's commit together with Task 10's.

- [ ] **Step 5: Commit (combined with Task 10)** — see Task 10 Step 8.

---

### Task 10: UI rewrite — chat-on-top + 6 sections + live diff/undo

**Files:**
- Create: `apps/web/components/otto/memory/FactSection.tsx`
- Create: `apps/web/components/otto/memory/SegmentCards.tsx`
- Create: `apps/web/components/otto/memory/ProductList.tsx`
- Create: `apps/web/components/otto/memory/OfferList.tsx`
- Create: `apps/web/components/otto/memory/UndoBar.tsx`
- Rewrite: `apps/web/components/otto/OttoMemory.tsx` (orchestrator; KEEP `export function threadToBubbles` and the existing `sendChat`/`ottoTurn` wiring)

**Interfaces:**
- Consumes: `SECTIONS/FACT_SECTION_KEYS/sectionForCategory/diffRows/offerPhase` (`@fikirtive/core`); memory CRUD actions (existing); record actions (Task 4); `ottoTurn` (existing).
- Page layout (top→bottom): h1 + sub → chat panel (chips + input + fine print) → UndoBar (conditional) → ABOUT THE BRAND → LOOK & FEEL → YOUR CUSTOMERS → YOUR PRODUCTS → YOUR OFFERS → DO & DON'T.
- The research-URL card is REMOVED (replaced by a chip; Task 11 deletes the dead server code).

**Shared visual vocabulary (Analytics baseline — use these exact classes):**
- Section label: `text-[0.75rem] font-semibold tracking-[0.05em] uppercase text-muted-foreground mt-6 mb-2`
- Section card: `rounded-[16px] border border-border bg-card` (fact rows inside, `divide-y divide-border`)
- Fact/record row: `text-[0.875rem] leading-[1.45] text-foreground px-[15px] py-[10px]`
- Badges: OTTO → `text-brand bg-brand/10` pill `✦ OTTO learned`; user → `text-muted-foreground bg-accent` pill `You added`; pill base `text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap`
- Fresh-change highlight: wrap row with `bg-brand/5 border-l-[3px] border-l-brand` for ids in the `freshIds` set; clear after 4s (`setTimeout` in the orchestrator).
- Chips: `rounded-full border border-border bg-secondary px-3 py-1.5 text-[0.8125rem] hover:bg-accent`

**State machine (orchestrator):**
```
sendChat():
  snapshot = { facts: memory, records }            // current client state
  await ottoTurn(...)                              // existing wiring, unchanged
  fresh = await Promise.all([listMyMemory(), listMyBrandRecords()])
  factDiff = diffRows(snapshot.facts, fresh[0]); recDiff = diffRows(snapshot.records, fresh[1])
  setMemory(fresh[0]); setRecords(fresh[1])
  if (nonEmpty(factDiff) || nonEmpty(recDiff)) { setLastDiff({factDiff, recDiff}); setFreshIds(idsOf(added+changed)); schedule 4s clear }

undo(lastDiff):
  facts: added→deleteMemory({id}); changed→updateMemory({id, content: before.content}); removed→addMemory({category: before.category, content: before.content})
  records: added→deleteBrandRecord({id}); changed→saveBrandRecord({id: before.id, kind: before.kind, data: before.data, status: before.status, startsAt: iso(before.startsAt), endsAt: iso(before.endsAt)}); removed→restoreBrandRecord({id})
  then refetch both lists, clear lastDiff/freshIds.
```

- [ ] **Step 1: `UndoBar.tsx`**

```tsx
"use client";
import React from "react";
import { Button } from "@/components/ui/button";

export function UndoBar({ summary, busy, onUndo, onDismiss }: {
  summary: string; busy: boolean; onUndo: () => void; onDismiss: () => void;
}) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-[14px] border border-brand/25 bg-brand/5 px-[15px] py-[10px] mb-4">
      <span className="text-[0.875rem] leading-[1.45] text-foreground flex-1">
        <span className="text-brand font-semibold">✦ OTTO</span> updated your brand memory — {summary}.
      </span>
      <Button variant="outline" size="sm" disabled={busy} onClick={onUndo}>{busy ? "Undoing…" : "Undo"}</Button>
      <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground text-[0.875rem]" onClick={onDismiss}>✕</button>
    </div>
  );
}
```

- [ ] **Step 2: `FactSection.tsx`** — one static section (about/look/rules): rows with badge + inline edit (textarea) + delete + "Add a fact". Props:

```tsx
"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryRow } from "@/lib/memory-actions";

export function FactSection({ label, rows, freshIds, onSave, onDelete, onAdd }: {
  label: string;
  rows: MemoryRow[];
  freshIds: Set<string>;
  onSave: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (content: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <section>
      <h2 className="text-[0.75rem] font-semibold tracking-[0.05em] uppercase text-muted-foreground mt-6 mb-2">{label}</h2>
      <div className="rounded-[16px] border border-border bg-card divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className={`px-[15px] py-[10px] ${freshIds.has(r.id) ? "bg-brand/5 border-l-[3px] border-l-brand" : ""}`}>
            {editingId === r.id ? (
              <div className="flex flex-col gap-2">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void onSave(r.id, text).then(() => setEditingId(null))}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="text-[0.875rem] leading-[1.45] text-foreground flex-1">{r.content}</span>
                <span className={`text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap ${r.source === "otto" ? "text-brand bg-brand/10" : "text-muted-foreground bg-accent"}`}>
                  {r.source === "otto" ? "✦ OTTO learned" : "You added"}
                </span>
                <button type="button" aria-label="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditingId(r.id); setText(r.content); }}>✎</button>
                <button type="button" aria-label="Delete" className="text-muted-foreground hover:text-foreground" onClick={() => void onDelete(r.id)}>🗑</button>
              </div>
            )}
          </div>
        ))}
        <div className="px-[15px] py-[10px]">
          {adding ? (
            <div className="flex flex-col gap-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Add a fact about your brand…" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!draft.trim()} onClick={() => void onAdd(draft.trim()).then(() => { setDraft(""); setAdding(false); })}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-[0.8125rem] text-muted-foreground hover:text-foreground" onClick={() => setAdding(true)}>+ Add a fact</button>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: `SegmentCards.tsx`** — grid of mini persona cards + field-form add/edit (never raw JSON). Fields: name*, who*, pains, wants, channels, toneTips. Card: name bold + who + optional `pains/reach/tone` lines + badge + ✎/🗑. Soft cap: when 6 active cards exist, show hint text `Tip: keep groups few — archive one before adding more.` above the add button (do NOT block). Form fields are labeled `<input>`/`<Textarea>` rows; submit calls `onSave(id | undefined, dataFields)`. Grid: `grid grid-cols-1 sm:grid-cols-2 gap-3`. Complete implementation follows the FactSection editing pattern (useState for `editingId`/field values; badge/highlight classes identical). "+ Add a customer group" button.

- [ ] **Step 4: `ProductList.tsx`** — search box (`<Textarea rows={1}>` NO — use `<input className="…">` styled like the shadcn Input if present in `components/ui`, else a bordered input) + rows sorted pinned→updatedAt; default show 8, `View all (N)` toggle; each row: `name` (semibold, 0.875rem) · description (muted, truncate) · price (mono if present) · status pill (`Archived` gray when archived) · `updated <whenLabel>` (reuse the `whenLabel` helper — move it from OttoMemory.tsx into this file or export it) · ✎ opens field form (name*, description, price, url, sellingAngle, tags comma-joined) · Archive/Unarchive button (calls `onSave(id, data, { status })`). Client-side filter: name/description/tags substring, case-insensitive. Empty state: `No products yet — tell Otto what you sell, or add one.`

- [ ] **Step 5: `OfferList.tsx`** — two groups: `Active & upcoming` (offerPhase active/scheduled) with date pill (`Ends Jul 15` / `Starts Jul 10` — format with `toLocaleDateString("en-MY", { month: "short", day: "numeric" })`), and `Past` (expired), collapsed by default (`<details>` or a toggle), rows opacity-60, each with a `Duplicate` button that opens the add-form prefilled (new title required to change dates → actually keep same title; saving re-uses upsert and revives by setting new endsAt). Add/edit form fields: title*, details, code, appliesTo, startsAt (date input), endsAt (date input). Uses `offerPhase` from `@fikirtive/core` with `new Date()`.

- [ ] **Step 6: Rewrite `OttoMemory.tsx`** (orchestrator). Keep from the old file: imports of chat machinery, `threadToBubbles` export, `whenLabel` (or move to ProductList), `sendChat`'s `ottoTurn` call, chat bubble rendering. Remove: `CATEGORIES`, the research card + `researchUrl/researching/researchError/proposedFacts/selectedFacts/savingFacts` state, `doResearch`/`addSelectedFacts`/`toggleFact`. New shape:

```tsx
export function OttoMemory({ initialMemory, initialRecords, projectId }: {
  initialMemory: MemoryRow[];
  initialRecords: BrandRecordRow[];
  projectId: string;
}) {
  const [memory, setMemory] = useState<MemoryRow[]>(initialMemory);
  const [records, setRecords] = useState<BrandRecordRow[]>(initialRecords);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [lastDiff, setLastDiff] = useState<{ facts: RowDiff<MemoryRow>; records: RowDiff<BrandRecordRow> } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  // …existing chat state (chat, brandThreadId, input, sending, chatError) unchanged…
```

Header copy: h1 `Brand memory`; sub `What Otto remembers about your brand — he uses it on every campaign.`

Chat panel (replaces research + old chat cards, ONE panel): chips row →

```tsx
const CHIPS = [
  { label: "Describe my brand", prompt: "Let me describe my brand to you — ask me what you need to know." },
  { label: "My ideal customer", prompt: "Help me define my main customer groups." },
  { label: "My brand voice", prompt: "Help me pin down my brand voice." },
  { label: "Research my site", prompt: "Research my website and save what you learn — brand facts, products, and current offers. My URL: " },
];
```

Chip click: sets `input` to the prompt (Research chip leaves cursor for the URL — just `setInput(prompt)`; do NOT auto-send). Fine print under input: `Chatting uses a little credit. Otto edits the memory below live — you can undo.`

`sendChat` additions (after the existing `ottoTurn` await + reply handling):

```tsx
      const [freshFacts, freshRecords] = await Promise.all([listMyMemory(), listMyBrandRecords()]);
      const factDiff = diffRows(snapshot.facts, freshFacts);
      const recDiff = diffRows(snapshot.records, freshRecords);
      setMemory(freshFacts); setRecords(freshRecords);
      const touched = [
        ...factDiff.added.map((r) => r.id), ...factDiff.changed.map((c) => c.after.id),
        ...recDiff.added.map((r) => r.id), ...recDiff.changed.map((c) => c.after.id),
      ];
      if (touched.length || factDiff.removed.length || recDiff.removed.length) {
        setLastDiff({ facts: factDiff, records: recDiff });
        setFreshIds(new Set(touched));
        window.setTimeout(() => setFreshIds(new Set()), 4000);
      }
```

(`snapshot` = `{ facts: memory, records }` captured at the top of `sendChat` before the turn.)

`undo` implementation:

```tsx
  async function undo() {
    if (!lastDiff) return;
    setUndoBusy(true);
    try {
      const { facts, records: rec } = lastDiff;
      await Promise.all([
        ...facts.added.map((r) => deleteMemory({ id: r.id })),
        ...facts.changed.map((c) => updateMemory({ id: c.before.id, content: c.before.content })),
        ...facts.removed.map((r) => addMemory({ category: r.category, content: r.content })),
        ...rec.added.map((r) => deleteBrandRecord({ id: r.id })),
        ...rec.changed.map((c) => saveBrandRecord({
          id: c.before.id, kind: c.before.kind, data: c.before.data, status: c.before.status,
          startsAt: c.before.startsAt ? c.before.startsAt.toISOString().slice(0, 10) : null,
          endsAt: c.before.endsAt ? c.before.endsAt.toISOString().slice(0, 10) : null,
        })),
        ...rec.removed.map((r) => restoreBrandRecord({ id: r.id })),
      ]);
      setMemory(await listMyMemory());
      setRecords(await listMyBrandRecords());
    } finally {
      setUndoBusy(false); setLastDiff(null); setFreshIds(new Set());
    }
  }
```

Undo summary string: `const n = (d: RowDiff<any>) => ({ a: d.added.length, c: d.changed.length, r: d.removed.length })` → compose `"2 added, 1 changed"` skipping zeros (facts+records summed).

Sections render (after the chat panel + UndoBar):

```tsx
        <FactSection label="About the brand" rows={factsFor("about")} … />
        <FactSection label="Look & feel" rows={factsFor("look")} … />
        <SegmentCards records={recordsFor("segment")} looseNotes={factsFor("customers")} … />
        <ProductList records={recordsFor("product")} looseNotes={factsFor("products")} … />
        <OfferList records={recordsFor("offer")} … />
        <FactSection label="Do & don't" rows={factsFor("rules")} … />
```

with `factsFor(key) = memory.filter((m) => sectionForCategory(m.category) === key)` and `recordsFor(kind) = records.filter((r) => r.kind === kind)`. `looseNotes` (legacy Products/Audience facts) render as plain fact rows under the records inside those sections (same row component/badges — pass `onSave/onDelete` from memory CRUD). New facts added via FactSection call `addMemory({ category: sectionKey, content })` (`about`/`look`/`rules` — the new canonical keys).

Handlers passed down: `onSave(id, content) → updateMemory({id, content})` then refetch memory; `onDelete(id) → deleteMemory({id})` then refetch; record `onSave(id, kind, data, extras) → saveBrandRecord({...})` then refetch records; product archive → `saveBrandRecord({ id, kind: "product", data, status: "archived" })`.

- [ ] **Step 7: Typecheck + full web tests**

Run: `pnpm --filter web typecheck && pnpm --filter web test`
Expected: PASS (all files from Tasks 9+10 compile together).

- [ ] **Step 8: Commit (Tasks 9+10 together)**

```bash
git add apps/web/components/otto apps/web/app/otto/page.tsx apps/web/app/skin-preview/page.tsx
git commit -m "feat(web): Brand memory v2 UI — chat-on-top, 6 sections, records, live diff + undo"
```

---

### Task 11: Remove dead research server code

**Files:**
- Modify: `apps/web/lib/brand-research.ts` — DELETE `researchBrandFromUrl`, `mockReply`, `SYSTEM`, `ProposedFact`, `ResearchResult` (all orphaned by Task 10's UI removal). KEEP `fetchAndExtract` + `MAX_BODY` (used by `otto-actions.ts` `research.fetchUrl` — verify with grep before deleting).

- [ ] **Step 1: Verify the only callers were OttoMemory**

Run: `grep -rn "researchBrandFromUrl\|ProposedFact\|ResearchResult" apps/web packages --include="*.ts" --include="*.tsx" | grep -v brand-research.ts | grep -v __tests__`
Expected: no output (if anything else imports them, STOP and reassess instead of deleting).

- [ ] **Step 2: Delete the dead exports; run `grep -rn "brand-research" apps/web` to confirm remaining imports only use `fetchAndExtract`.** Delete any orphaned tests of `researchBrandFromUrl` in `apps/web/lib/__tests__/` the same way (check `ls apps/web/lib/__tests__ | grep -i research`).

- [ ] **Step 3: Typecheck + test + commit**

```bash
pnpm --filter web typecheck && pnpm --filter web test
git add apps/web/lib/brand-research.ts apps/web/lib/__tests__
git commit -m "refactor(web): drop researchBrandFromUrl (replaced by chat-driven research via researchWeb + record skills)"
```

Note for the PR body: this removes a metered-LLM server action whose UI entry point no longer exists; `fetchAndExtract` (SSRF-hardened fetch, still used by the agent's `research.fetchUrl`) is untouched.

---

### Task 12: Full verification sweep

- [ ] **Step 1: Whole-repo checks**

```bash
pnpm -r typecheck
pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/otto test && pnpm --filter web test && pnpm --filter @fikirtive/db test
pnpm --filter @fikirtive/otto catalog:check
```

Expected: all PASS.

- [ ] **Step 2: MONEY-GUARD audit (whole branch)**

```bash
git diff main...HEAD --stat -- packages/db/src/credits.ts packages/core/src/spend.ts apps/worker/src/jobs packages/generation "apps/web/**/gen-actions.ts" "apps/web/**/refgen-actions.ts" "apps/web/**/cowork-actions.ts" pnpm-lock.yaml
```

Expected: EMPTY output. Also confirm no migration touches existing tables: the only migration is `*_brand_record` and contains only `CREATE TABLE "BrandRecord"` + its indexes.

- [ ] **Step 3: Visual verify** — start the dev server, screenshot `/skin-preview?view=memory` (the mock records from Task 9 exercise all 6 sections incl. an expired offer in Past), and compare 1× against `~/Desktop/brandmem-rebuild-mock.png` (same-scale montage; downscale the mock if it's 2×). Copy the comparison PNG to `~/Desktop/brandmem-built-vs-mock.png` for founder review.

- [ ] **Step 4: Manual mainline (dev, mock transport = $0):** open Brand memory → send "We sell a smooth everyday coffee called Latte Blend for RM 49" → expect: OTTO calls `saveProduct`, the product row appears highlighted, UndoBar shows "1 added" → click Undo → row disappears → add a product manually via the form → badge "You added" → edit a fact inline → badge flips → offers section shows the Past group.

- [ ] **Step 5: Push + PR (draft)** — PR body: goal, the 7 founder decisions table (from taxonomy spec §5 拍板结果), money-guard audit output, screenshots. Do NOT merge — the founder gates every merge.

```bash
git push -u origin claude/brand-memory-rebuild
gh pr create --draft --title "feat: Brand memory v2 — 6-section KB + living collections (BrandRecord) + live OTTO edit/undo" --body "<per above>"
```

---

## Self-Review Notes (done at planning time)

- **Spec coverage:** taxonomy §2 buckets → Tasks 2/3/10; §2.5 injection budgets → Task 8; §3 storage C + 三纪律 (single write gate = core schemas used by BOTH write paths; status derived at read time via `offerPhase`; records/notes coexist via `looseNotes`) → Tasks 1/2/4/5/8/10; §4 enum/mapping/zero-migration → Tasks 3/7 (read-time mapping, no data migration); 拍板 1–7 all covered (7 = chip prompt + instructions "research also captures products/offers" in Tasks 7/10); rebuild-spec chat/undo/badges → Task 10; rules-truncation bug → Task 8.
- **Deliberate deviations (flag to founder in PR):** none beyond what's in the locked specs. The old propose/select research UI is removed per rebuild-spec 决策 ①+3 (auto+undo replaces select-to-add).
- **Type consistency verified:** `BrandRecordRow` (Task 4) is the single client row type consumed by Tasks 9/10; skills use `fields`-partial + merge (Task 5) while web `saveBrandRecord` is full-data (Task 4) — intentional, documented in both.
- **Known risk:** `remember-brand-fact.test.ts` and `catalog`/`registry` tests may assert old enum/count fixtures — Task 7 Steps 2/5 handle; if catalog check fails, run `pnpm --filter @fikirtive/otto catalog` to regenerate.
