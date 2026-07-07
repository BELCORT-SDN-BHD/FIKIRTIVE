# Brand Memory v2 — Tabs + Product Images + My Stuff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the just-built Brand memory UI into 6 tabs (one per section) with a Shopify-showcase Products tab (images), unify My Stuff into one filterable library with Upload + fixed-format Generate-reference, per spec `docs/superpowers/specs/2026-07-02-brand-memory-v2-tabs-mystuff-design.md` (founder revisions R1–R4). Approved mockup: `~/Desktop/brandmem-v2-tabs-mock.png`.

**Architecture:** Pure additive layers over the v1 machinery (which stays): tabs re-home the existing sections; products gain `imageAssetId` inside the JSON `data` (zero migration); My Stuff becomes one `StuffLibrary` grid fed by a pure `buildStuffItems()` classifier over data the page ALREADY loads (entities + ads + history); Generate-reference = 4 readable template files → existing `createEntity` + frozen `startRefGen` (call-only). No new tables, no new server actions, no new spend paths.

**Tech Stack:** Next.js App Router (shallow search-param tabs), shadcn Tabs idiom, zod v4, vitest, existing refgen engine.

## Global Constraints

- **MONEY-GUARD (BINDING):** NEVER modify `packages/db/src/credits.ts`, `packages/core/src/spend.ts`, `apps/worker/src/jobs/gen.ts`, `apps/worker/src/jobs/refgen.ts`, `apps/web/**/gen-actions.ts`, **`apps/web/lib/refgen-actions.ts`**, `apps/web/**/cowork-actions.ts`, `**/useCanvasGen.ts`, `packages/generation/*`, any idempotency index. `startRefGen` and `createEntity` are CALLED, never edited. After every commit: `git log --stat -1 | grep -E "credits|spend|jobs/gen|jobs/refgen|gen-actions|refgen-actions|cowork-actions|useCanvasGen|packages/generation"` → empty.
- No new npm deps; `pnpm-lock.yaml` untouched. No DB migration (imageAssetId lives in the JSON `data` column).
- Worktree `/Users/winnin/Desktop/fikirtive/.claude/worktrees/brand-memory`, branch `claude/brand-memory-rebuild` (on top of PR #103's commits). All commands run from worktree root. Env is bootstrapped.
- `imageAssetId` is display-only; OTTO skills must NOT accept it as a parameter (UI-managed only), but OTTO updates must PRESERVE it (merge semantics).
- Manual verification of Generate uses the MOCK transport only — never trigger a real paid generation ("ask before spending real money" is binding).
- Style = Analytics baseline + existing idioms: tabs `rounded-[14px] bg-muted p-1` (copy from `OttoStuff.tsx:256`), cards `rounded-[16px] border border-border`, section labels 12px/600/+0.05em uppercase muted, coral `text-brand` = OTTO-only, mono price `font-mono`. Match `OttoMemory.tsx` / `memory/*.tsx` class idiom.
- Keep `export function threadToBubbles` and the chat/undo/diff machinery in `OttoMemory.tsx` untouched in behavior.

---

### Task 1: Core — `imageAssetId` on products + `sectionsTouched` helper (TDD)

**Files:**
- Modify: `packages/core/src/brand-records.ts` (productRecordData only)
- Modify: `packages/core/src/memory-sections.ts` (add `sectionsTouched`)
- Modify: `packages/core/src/index.ts` (export `sectionsTouched`)
- Test: `packages/core/src/brand-records.test.ts`, `packages/core/src/memory-sections.test.ts` (extend both)

**Interfaces:**
- Consumes: existing `RowDiff<T>`, `sectionForCategory`, `RecordKind`.
- Produces: `productRecordData` accepts optional `imageAssetId: string (max 64)`; `sectionsTouched(factDiff: RowDiff<{category:string; id:string; updatedAt: Date|string}>, recDiff: RowDiff<{kind:string; id:string; updatedAt: Date|string}>): Set<SectionKey>` — maps changed/added/removed facts via `sectionForCategory(category)` and records via kind→section (`segment→customers`, `product→products`, `offer→offers`).

- [ ] **Step 1: Extend tests (failing).** Append to `brand-records.test.ts`:

```ts
describe("product imageAssetId", () => {
  it("accepts an optional imageAssetId and keeps it out of required fields", () => {
    expect(productRecordData.safeParse({ name: "Latte", imageAssetId: "as_123" }).success).toBe(true);
    expect(productRecordData.safeParse({ name: "Latte" }).success).toBe(true);
    expect(productRecordData.safeParse({ name: "Latte", imageAssetId: 5 }).success).toBe(false);
  });
});
```

Append to `memory-sections.test.ts` (import `sectionsTouched` too):

```ts
describe("sectionsTouched", () => {
  const t = new Date("2026-07-02T00:00:00Z");
  const empty = { added: [], changed: [], removed: [] };
  it("maps fact categories and record kinds to their sections", () => {
    const facts = { added: [{ id: "f1", updatedAt: t, category: "look" }], changed: [], removed: [{ id: "f2", updatedAt: t, category: "Rules" }] };
    const recs = { added: [{ id: "r1", updatedAt: t, kind: "product" }], changed: [{ before: { id: "r2", updatedAt: t, kind: "segment" }, after: { id: "r2", updatedAt: t, kind: "segment" } }], removed: [] };
    expect([...sectionsTouched(facts, recs)].sort()).toEqual(["customers", "look", "products", "rules"]);
  });
  it("empty diffs → empty set", () => {
    expect(sectionsTouched(empty, empty).size).toBe(0);
  });
  it("offer kind → offers", () => {
    const recs = { added: [{ id: "r1", updatedAt: t, kind: "offer" }], changed: [], removed: [] };
    expect([...sectionsTouched(empty, recs)]).toEqual(["offers"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @fikirtive/core exec vitest run src/brand-records.test.ts src/memory-sections.test.ts`
Expected: new cases FAIL (unknown key stripped → actually `imageAssetId: 5` may pass if zod strips unknown keys — it will NOT: the key must be declared to be type-checked; before implementation the `5` case passes wrongly and the import of `sectionsTouched` errors). Confirm at least one failure per file.

- [ ] **Step 3: Implement.** In `brand-records.ts`, add to `productRecordData` after `tags`:

```ts
  /** Optional My Stuff asset link for the showcase card. Display-only; UI-managed (OTTO skills never accept it). */
  imageAssetId: z.string().max(64).optional(),
```

In `memory-sections.ts` append:

```ts
const KIND_SECTION: Record<string, SectionKey> = { segment: "customers", product: "products", offer: "offers" };

/** Which tabs a chat turn touched — drives the per-tab coral dot. */
export function sectionsTouched(
  factDiff: RowDiff<{ id: string; updatedAt: Date | string; category: string }>,
  recDiff: RowDiff<{ id: string; updatedAt: Date | string; kind: string }>,
): Set<SectionKey> {
  const out = new Set<SectionKey>();
  for (const f of [...factDiff.added, ...factDiff.removed, ...factDiff.changed.map((c) => c.after)]) out.add(sectionForCategory(f.category));
  for (const r of [...recDiff.added, ...recDiff.removed, ...recDiff.changed.map((c) => c.after)]) {
    const s = KIND_SECTION[r.kind];
    if (s) out.add(s);
  }
  return out;
}
```

Append to `index.ts` exports: `export { sectionsTouched } from "./memory-sections.js";`

- [ ] **Step 4: Tests + build**

Run: `pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/core build`
Expected: all pass (incl. prior 435+).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): product imageAssetId + sectionsTouched tab-dot helper"
```

---

### Task 2: OTTO merge preserves `imageAssetId` (test-only guard)

**Files:**
- Test: `packages/otto/src/skills/_brand-record.test.ts` (append one case)

**Interfaces:** Consumes existing `upsertBrandRecordFromOtto`. Produces: a regression guard that OTTO product updates keep UI-set image links.

- [ ] **Step 1: Append the test**

```ts
  it("preserves UI-set imageAssetId when OTTO updates a product (merge keeps unknown-to-skill fields)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue({
      id: "r-img", data: { name: "Latte Blend", price: "RM 49", imageAssetId: "as_777" },
    });
    db.prisma.brandRecord.update.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", price: "RM 55" } },
      { context: makeCtx() },
    );
    expect(db.prisma.brandRecord.update).toHaveBeenCalledWith({
      where: { id: "r-img" },
      data: expect.objectContaining({
        data: expect.objectContaining({ imageAssetId: "as_777", price: "RM 55" }),
      }),
    });
  });
```

(Task 1 must land first — `productRecordData` needs the declared key or zod strips it in the merge validation. Rebuild core before running: `pnpm --filter @fikirtive/core build`.)

- [ ] **Step 2: Run** `pnpm --filter @fikirtive/otto exec vitest run src/skills/_brand-record.test.ts` → all pass (8). Also confirm `save-product.ts` params contain NO `imageAssetId` (grep).

- [ ] **Step 3: Commit** `git add packages/otto/src/skills/_brand-record.test.ts && git commit -m "test(otto): OTTO product updates preserve UI-set imageAssetId"`

---

### Task 3: Reference formats — 4 template files (TDD)

**Files:**
- Create: `apps/web/lib/reference-formats/index.ts`
- Test: `apps/web/lib/__tests__/reference-formats.test.ts`

**Interfaces (Produces — used by Task 7):**

```ts
export type ReferenceFormat = {
  key: "avatar" | "product-shot" | "location" | "brandmark";
  label: string;                    // friendly UI name
  entityType: "CHARACTER" | "PRODUCT" | "LOCATION" | "BRANDMARK";
  subjectLabel: string;             // form field label
  subjectPlaceholder: string;
  buildPrompt(fields: { subject: string; notes?: string }): string;
};
export const REFERENCE_FORMATS: ReferenceFormat[];
export function formatFor(key: string): ReferenceFormat | undefined;
```

One file (not four) — each format is ~10 lines; a directory of 4 files would be scaffolding for its own sake. The file reads top-to-bottom like config; the founder edits template strings directly (spec R4's "可读文件" intent — noted deviation from spec's four-file listing, flag in PR).

- [ ] **Step 1: Write the failing test** — `apps/web/lib/__tests__/reference-formats.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { REFERENCE_FORMATS, formatFor } from "../reference-formats";

describe("REFERENCE_FORMATS", () => {
  it("has the 4 approved formats mapped to existing entity types", () => {
    expect(REFERENCE_FORMATS.map((f) => [f.key, f.entityType])).toEqual([
      ["avatar", "CHARACTER"],
      ["product-shot", "PRODUCT"],
      ["location", "LOCATION"],
      ["brandmark", "BRANDMARK"],
    ]);
  });
  it("buildPrompt interpolates the subject and keeps the fixed skeleton", () => {
    const p = formatFor("avatar")!.buildPrompt({ subject: "Rosa, 30s Malaysian founder" });
    expect(p).toContain("Rosa, 30s Malaysian founder");
    expect(p).toContain("Head-and-shoulders");
    expect(p).toContain("neutral expression");
  });
  it("appends notes only when present", () => {
    const f = formatFor("product-shot")!;
    expect(f.buildPrompt({ subject: "a bag of coffee beans" })).not.toContain("Additional details");
    expect(f.buildPrompt({ subject: "beans", notes: "kraft-paper bag" })).toContain("Additional details: kraft-paper bag");
  });
  it("every format's prompt stays under the refgen limit", () => {
    for (const f of REFERENCE_FORMATS) {
      expect(f.buildPrompt({ subject: "x".repeat(300), notes: "y".repeat(300) }).length).toBeLessThanOrEqual(2000);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter web exec vitest run lib/__tests__/reference-formats.test.ts` → module not found.

- [ ] **Step 3: Implement** — `apps/web/lib/reference-formats/index.ts`

```ts
/**
 * Fixed reference-generation formats (founder decision R4, 2026-07-02).
 * Each format bakes the OBJECTIVE best-practice shape for that reference type —
 * the user only supplies the subject. Founder-editable: change the template
 * strings below; the skeleton is the product knowledge.
 * Prompts are English (structuredPrompt convention). Display/compose-only —
 * generation itself goes through the existing frozen startRefGen path.
 */

export type ReferenceFormat = {
  key: "avatar" | "product-shot" | "location" | "brandmark";
  label: string;
  entityType: "CHARACTER" | "PRODUCT" | "LOCATION" | "BRANDMARK";
  subjectLabel: string;
  subjectPlaceholder: string;
  buildPrompt(fields: { subject: string; notes?: string }): string;
};

const notesSuffix = (notes?: string) => (notes?.trim() ? ` Additional details: ${notes.trim()}.` : "");
const cap = (s: string) => (s.length <= 2000 ? s : s.slice(0, 2000));

export const REFERENCE_FORMATS: ReferenceFormat[] = [
  {
    key: "avatar",
    label: "Avatar / Cast",
    entityType: "CHARACTER",
    subjectLabel: "Who is this?",
    subjectPlaceholder: "e.g. Rosa, 30s Malaysian founder, warm smile",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Professional reference portrait of ${subject.trim()}. Head-and-shoulders framing, facing camera, ` +
          `neutral expression, soft even studio lighting, plain light-gray seamless background, sharp focus, ` +
          `no props, no text, photorealistic.${notesSuffix(notes)}`,
      ),
  },
  {
    key: "product-shot",
    label: "Product shot",
    entityType: "PRODUCT",
    subjectLabel: "What product?",
    subjectPlaceholder: "e.g. a 250g bag of Latte Blend coffee",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Clean studio product photograph of ${subject.trim()}. Centered on a seamless off-white background, ` +
          `soft diffused lighting, gentle natural shadow, true-to-life colors, sharp focus, ` +
          `no props, no hands, no text.${notesSuffix(notes)}`,
      ),
  },
  {
    key: "location",
    label: "Location",
    entityType: "LOCATION",
    subjectLabel: "What place?",
    subjectPlaceholder: "e.g. our cozy Bangsar cafe interior",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Wide establishing shot of ${subject.trim()}. Empty scene with no people, natural daylight, ` +
          `eye-level perspective, clean composition, photorealistic, no text.${notesSuffix(notes)}`,
      ),
  },
  {
    key: "brandmark",
    label: "Brand mark",
    entityType: "BRANDMARK",
    subjectLabel: "Describe the mark",
    subjectPlaceholder: "e.g. our coral cloud logo",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Flat brand mark of ${subject.trim()}, centered on a plain white background, no distortion, ` +
          `no perspective, no shadows, no extra elements, crisp edges.${notesSuffix(notes)}`,
      ),
  },
];

export function formatFor(key: string): ReferenceFormat | undefined {
  return REFERENCE_FORMATS.find((f) => f.key === key);
}
```

- [ ] **Step 4: Run tests** — `pnpm --filter web exec vitest run lib/__tests__/reference-formats.test.ts` → PASS.

- [ ] **Step 5: Commit** `git add apps/web/lib/reference-formats apps/web/lib/__tests__/reference-formats.test.ts && git commit -m "feat(web): fixed reference-generation formats (avatar/product/location/brandmark)"`

---

### Task 4: Stuff items classifier (TDD)

**Files:**
- Create: `apps/web/lib/stuff-items.ts`
- Test: `apps/web/lib/__tests__/stuff-items.test.ts`

**Interfaces (Produces — used by Tasks 5, 6):**

```ts
export type StuffFilter = "all" | "images" | "videos" | "cast" | "products" | "ads";
export type StuffItem = {
  id: string;                          // unique across sources (prefix by source)
  source: "entity" | "gen" | "ad";
  label: string;
  url: string | null;                  // thumb/media URL (null → placeholder tile)
  mediaKind: "image" | "video" | "other";
  entityId?: string;                   // entities only
  entityType?: "CHARACTER" | "LOCATION" | "PRODUCT" | "BRANDMARK";
  assetId?: string;                    // entities' refs only — REQUIRED for the product picker
  productName?: string;                // ⭐ tag: linked Brand-memory product, if any
};
export function buildStuffItems(args: {
  entities: EntityDTO[]; history: HistoryThumb[]; ads: AdTile[];
  records: BrandRecordRow[];           // for the ⭐ productName reverse index
}): StuffItem[];
export function filterStuffItems(items: StuffItem[], filter: StuffFilter, search: string): StuffItem[];
export function productImageIndex(records: BrandRecordRow[]): Map<string, string>; // assetId → product name
```

**Semantics:** entities → one item per entity (base ref's url via `e.refs.find(r => r.assetId === e.baseAssetId) ?? e.refs[0]`; `mediaKind` from that ref's `kind`; `assetId` = that ref's assetId); history thumbs → `{source:"gen", url: h.src, mediaKind: h.kind}` (no assetId → never pickable); ads → `AdTile` fields as today's AdMediaTile uses. Filters: `images` = mediaKind image (any source); `videos` = mediaKind video; `cast` = entityType CHARACTER; `products` = entityType PRODUCT; `ads` = source ad. LOCATION/BRANDMARK entities appear under `all` + `images`. Search = case-insensitive substring on label. `productImageIndex` scans records where `kind === "product" && status === "active"` for `data.imageAssetId`.

- [ ] **Step 1: Write the failing test** — `apps/web/lib/__tests__/stuff-items.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildStuffItems, filterStuffItems, productImageIndex } from "../stuff-items";
import type { EntityDTO } from "../types";
import type { BrandRecordRow } from "../brand-record-actions";

const ent = (id: string, type: EntityDTO["type"], name: string, assetId?: string): EntityDTO => ({
  id, type, name, aliases: [], notes: "", negativeConstraints: "",
  refs: assetId ? [{ id: `ref-${id}`, assetId, url: `/a/${assetId}.png`, kind: "image" }] : [],
  baseAssetId: assetId ?? null, variants: [], usageCount: 0,
});
const rec = (name: string, imageAssetId?: string): BrandRecordRow => ({
  id: `r-${name}`, kind: "product", data: { name, ...(imageAssetId ? { imageAssetId } : {}) },
  status: "active", startsAt: null, endsAt: null, source: "user", pinned: false, updatedAt: new Date(),
});

describe("buildStuffItems", () => {
  it("classifies entities, gens and ads with stable unique ids", () => {
    const items = buildStuffItems({
      entities: [ent("e1", "CHARACTER", "Rosa", "as1"), ent("e2", "PRODUCT", "Latte", "as2")],
      history: [{ id: "g1", src: "/g1.png", kind: "image" }, { id: "g2", src: "/g2.mp4", kind: "video" }],
      ads: [{ id: "a1", name: "Raya teaser", mediaUrl: "/ad1.mp4", kind: "video" } as never],
      records: [rec("Latte", "as2")],
    });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.find((i) => i.entityId === "e2")?.productName).toBe("Latte");
    expect(items.find((i) => i.entityId === "e1")?.assetId).toBe("as1");
    expect(items.filter((i) => i.source === "gen").every((i) => i.assetId === undefined)).toBe(true);
  });
});

describe("filterStuffItems", () => {
  const items = buildStuffItems({
    entities: [ent("e1", "CHARACTER", "Rosa", "as1"), ent("e2", "PRODUCT", "Latte", "as2"), ent("e3", "LOCATION", "Cafe", "as3")],
    history: [{ id: "g1", src: "/g1.png", kind: "image" }, { id: "g2", src: "/g2.mp4", kind: "video" }],
    ads: [], records: [],
  });
  it("cast/products filter by entity type; location shows in images+all only", () => {
    expect(filterStuffItems(items, "cast", "").map((i) => i.entityId)).toEqual(["e1"]);
    expect(filterStuffItems(items, "products", "").map((i) => i.entityId)).toEqual(["e2"]);
    expect(filterStuffItems(items, "images", "").length).toBe(4); // 3 entity images + g1
    expect(filterStuffItems(items, "videos", "").map((i) => i.id)).toEqual(["gen:g2"]);
    expect(filterStuffItems(items, "all", "").length).toBe(5);
  });
  it("search is case-insensitive substring on label", () => {
    expect(filterStuffItems(items, "all", "LATTE").map((i) => i.entityId)).toEqual(["e2"]);
  });
});

describe("productImageIndex", () => {
  it("maps assetId → product name, active products only", () => {
    const archived = { ...rec("Old", "asX"), status: "archived" as const };
    const idx = productImageIndex([rec("Latte", "as2"), archived, rec("NoImg")]);
    expect(idx.get("as2")).toBe("Latte");
    expect(idx.has("asX")).toBe(false);
    expect(idx.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** → module not found.

- [ ] **Step 3: Implement** — `apps/web/lib/stuff-items.ts`

```ts
/** Pure classifier for the unified My Stuff library (spec R3). No IO. */
import type { EntityDTO } from "./types";
import type { HistoryThumb } from "./data";
import type { AdTile } from "@/components/otto/OttoStuff";
import type { BrandRecordRow } from "./brand-record-actions";

export type StuffFilter = "all" | "images" | "videos" | "cast" | "products" | "ads";

export type StuffItem = {
  id: string;
  source: "entity" | "gen" | "ad";
  label: string;
  url: string | null;
  mediaKind: "image" | "video" | "other";
  entityId?: string;
  entityType?: EntityDTO["type"];
  assetId?: string;
  productName?: string;
};

export function productImageIndex(records: BrandRecordRow[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "product" || r.status !== "active") continue;
    const d = r.data as { name?: unknown; imageAssetId?: unknown };
    if (typeof d.imageAssetId === "string" && d.imageAssetId && typeof d.name === "string") {
      idx.set(d.imageAssetId, d.name);
    }
  }
  return idx;
}

export function buildStuffItems(args: {
  entities: EntityDTO[];
  history: HistoryThumb[];
  ads: AdTile[];
  records: BrandRecordRow[];
}): StuffItem[] {
  const pidx = productImageIndex(args.records);
  const items: StuffItem[] = [];
  for (const e of args.entities) {
    const base = e.refs.find((r) => r.assetId === e.baseAssetId) ?? e.refs[0];
    items.push({
      id: `entity:${e.id}`,
      source: "entity",
      label: e.name,
      url: base?.url ?? null,
      mediaKind: base ? base.kind : "other",
      entityId: e.id,
      entityType: e.type,
      ...(base ? { assetId: base.assetId } : {}),
      ...(base && pidx.has(base.assetId) ? { productName: pidx.get(base.assetId) } : {}),
    });
  }
  for (const h of args.history) {
    items.push({ id: `gen:${h.id}`, source: "gen", label: h.id, url: h.src, mediaKind: h.kind });
  }
  for (const a of args.ads) {
    items.push({ id: `ad:${a.id}`, source: "ad", label: a.name ?? "Ad", url: a.mediaUrl ?? null, mediaKind: a.kind ?? "other" });
  }
  return items;
}

export function filterStuffItems(items: StuffItem[], filter: StuffFilter, search: string): StuffItem[] {
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    if (q && !i.label.toLowerCase().includes(q)) return false;
    switch (filter) {
      case "all": return true;
      case "images": return i.mediaKind === "image";
      case "videos": return i.mediaKind === "video";
      case "cast": return i.entityType === "CHARACTER";
      case "products": return i.entityType === "PRODUCT";
      case "ads": return i.source === "ad";
    }
  });
}
```

NOTE: `AdTile`'s exact fields live at `apps/web/components/otto/OttoStuff.tsx:13` — check them and adjust the `ads` mapping lines (name/mediaUrl/kind) to the REAL field names before running; the test's `as never` cast lets the test stay stable either way. If AdTile import creates a client/server cycle, move the `AdTile` type into `stuff-items.ts` and re-export from OttoStuff.

- [ ] **Step 4: Run tests** → PASS. `pnpm --filter web typecheck` → clean.

- [ ] **Step 5: Commit** `git add apps/web/lib/stuff-items.ts apps/web/lib/__tests__/stuff-items.test.ts && git commit -m "feat(web): pure stuff-items classifier for unified My Stuff library"`

---

### Task 5: `StuffLibrary` component (library + picker modes) + `AddAssetDialog` (Upload half)

**Files:**
- Create: `apps/web/components/otto/stuff/StuffLibrary.tsx`
- Create: `apps/web/components/otto/stuff/AddAssetDialog.tsx`

**Interfaces:**
- Consumes: Task 4 exports; existing `createEntity` (`@/lib/actions`, takes FormData: `name`, `type`, file inputs accepted by `acceptRefFiles` — check its input name convention at `apps/web/lib/actions.ts` `acceptRefFiles` before wiring, use the same field names the existing entity-create UI uses; grep `acceptRefFiles(` for the reader).
- Produces:

```tsx
export function StuffLibrary(props: {
  items: StuffItem[];
  mode: "library" | "picker";
  onPick?: (assetId: string) => void;         // picker mode: image+assetId items only are clickable
  onRename?: (entityId: string, name: string) => void;
  onDelete?: (entityId: string) => void;
  onSetProductImage?: (assetId: string) => void; // opens the product-choose flow (Task 7 wires)
}): JSX.Element;

export function AddAssetDialog(props: {
  open: boolean; onClose: () => void; onDone: () => void;  // onDone → parent refreshes
}): JSX.Element;
```

**Structure (complete but lean — match memory/* idiom):**
- StuffLibrary: filter pill bar (`StuffFilter` tabs with counts, same classes as OttoStuff Tabs), search input, responsive grid `grid grid-cols-3 md:grid-cols-5 gap-3`. Tile: square thumb (`<img>`/`<video muted>` by mediaKind; null url → `bg-accent` placeholder with label initial), name row, ⭐ `productName` chip top-left (`text-brand` tiny pill), `Video`/`Ad`/`Cast` type tag. Library-mode hover overlay (group-hover) with buttons: `Set as product image` (only when `assetId && mediaKind==="image"`), `Rename`, `Delete` (entity items only — reuse the rename/delete handlers passed in; OttoStuff already owns those functions, lift them via props). Picker mode: grid shows ONLY `filterStuffItems(items, "images", search)` items that have `assetId`; whole tile is a button calling `onPick(assetId)`; no hover actions.
- AddAssetDialog (Upload half only in this task): shadcn-style modal (`fixed inset-0` overlay + centered `rounded-[16px] border bg-card p-6 max-w-[480px]`) with two segmented options `Upload` / `Generate reference` (Generate disabled with "next step" tooltip until Task 7 replaces it). Upload form: name input, type select (`Avatar / Cast→CHARACTER`, `Product shot→PRODUCT`, `Location→LOCATION`, `Brand mark→BRANDMARK` — same labels as REFERENCE_FORMATS), file input (accept `image/*`, multiple). Submit → build `FormData` with the field names `createEntity` expects → `await createEntity(fd)` → `onDone()` + close. Error text inline.

- [ ] **Step 1: Implement both components** (no unit-test — UI layer; logic already TDD'd in Task 4. Verification = typecheck + Task 8's skin-preview render).
- [ ] **Step 2:** `pnpm --filter web typecheck` → clean (components not yet mounted anywhere — that's Task 6/8).
- [ ] **Step 3: Commit** `git add apps/web/components/otto/stuff && git commit -m "feat(web): StuffLibrary (library/picker modes) + AddAssetDialog upload half"`

---

### Task 6: OttoMemory 6-tab restructure

**Files:**
- Modify: `apps/web/components/otto/OttoMemory.tsx`

**Interfaces:**
- Consumes: `SECTIONS`, `sectionsTouched` (@fikirtive/core); existing section components (FactSection/SegmentCards/OfferList; ProductList until Task 7 replaces it).
- Produces: tab-scoped rendering; `touchedTabs: Set<SectionKey>` state cleared with the same 4s timer as `freshIds`; `?tab=` shallow routing. Everything else (chat panel, chips, UndoBar, diff/undo handlers, threadToBubbles) BEHAVIOR-UNCHANGED.

- [ ] **Step 1: Add tab state.** In the component:

```tsx
const searchParams = useSearchParams();
const router = useRouter();
const pathname = usePathname();
const rawTab = searchParams.get("tab");
const activeTab: SectionKey = (SECTIONS.some((s) => s.key === rawTab) ? rawTab : "about") as SectionKey;
const setTab = (k: SectionKey) => {
  const p = new URLSearchParams(searchParams.toString());
  p.set("tab", k);
  router.replace(`${pathname}?${p.toString()}`, { scroll: false });
};
const [touchedTabs, setTouchedTabs] = useState<Set<SectionKey>>(new Set());
```

(imports from `next/navigation`; if OttoMemory is rendered where `useSearchParams` needs a Suspense boundary, fall back to plain `useState<SectionKey>("about")` + note it in the report — do NOT wrap the app in Suspense for this.)

In `sendChat` where diffs are computed (after `setFreshIds`), add:

```tsx
setTouchedTabs(sectionsTouched(factDiff, recDiff));
window.setTimeout(() => setTouchedTabs(new Set()), 4000);
```

and clear in `undo()`'s finally alongside `setFreshIds(new Set())`: `setTouchedTabs(new Set());`

- [ ] **Step 2: Tab bar UI** (below UndoBar, above content — replaces the vertical stack):

```tsx
<div className="flex gap-1 rounded-[14px] bg-muted p-1 w-max mb-4" role="tablist">
  {SECTIONS.map((s) => {
    const count = s.key === "customers" ? recordsFor("segment").length
      : s.key === "products" ? recordsFor("product").length
      : s.key === "offers" ? recordsFor("offer").length : 0;
    const on = activeTab === s.key;
    return (
      <button key={s.key} role="tab" aria-selected={on} onClick={() => setTab(s.key)}
        className={`flex items-center gap-2 rounded-[10px] px-4 py-2 text-[0.8125rem] ${on ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"}`}>
        {s.label}
        {count > 0 && <span className="text-[0.6875rem] text-muted-foreground/70">{count}</span>}
        {touchedTabs.has(s.key) && <span className="h-[6px] w-[6px] rounded-full bg-brand" aria-label="Otto updated this" />}
      </button>
    );
  })}
</div>
```

- [ ] **Step 3: Panels.** Replace the stacked sections with a switch on `activeTab`: `about`/`look`/`rules` → the corresponding `<FactSection>` (label from SECTIONS); `customers` → `<SegmentCards …>` (+ its looseNotes); `products` → existing `<ProductList …>` (Task 7 swaps it); `offers` → `<OfferList …>`. Keep every handler exactly as-is. FactSection's `label` prop becomes redundant on-screen inside a labeled tab — pass `label=""` and hide the `<h2>` when empty (`{label && <h2 …>}` one-line change in FactSection.tsx is allowed).

- [ ] **Step 4:** `pnpm --filter web typecheck && pnpm --filter web exec vitest run lib/__tests__/memory-actions.test.ts lib/__tests__/brand-record-actions.test.ts` → clean/green.

- [ ] **Step 5: Commit** `git add apps/web/components/otto && git commit -m "feat(web): Brand memory 6-tab restructure — shallow-routed tabs + OTTO coral dots"`

---

### Task 7: Products showcase + picker + Generate-reference flow

**Files:**
- Create: `apps/web/components/otto/memory/ProductShowcase.tsx` (replaces ProductList in the Products tab)
- Delete: `apps/web/components/otto/memory/ProductList.tsx` (after the swap; keep `whenLabel` by moving it into ProductShowcase)
- Modify: `apps/web/components/otto/OttoMemory.tsx` (swap component; add picker modal state)
- Modify: `apps/web/components/otto/stuff/AddAssetDialog.tsx` (Generate half)

**Interfaces:**
- Consumes: `REFERENCE_FORMATS`/`formatFor` (Task 3), `StuffLibrary` picker mode (Task 5), `saveBrandRecord` (existing), `createEntity` + `startRefGen` (existing, FROZEN — call only), `REFGEN_PRICE_USD_PER_IMAGE` from `@fikirtive/core` (verify it's exported from core index; if not, import from `@fikirtive/core/refgen` path used elsewhere — grep first).
- Produces: `ProductShowcase({ records, looseNotes, freshIds, stuffItems, onSave, onDelete, onArchive, onNoteSave, onNoteDelete, onSetImage })` where `onSetImage(rec: BrandRecordRow, assetId: string | null)` calls `saveBrandRecord({ id: rec.id, kind: "product", data: { ...rec.data, imageAssetId: assetId ?? undefined } })` (null clears — delete the key: build data with `imageAssetId` omitted when null) then refetches.

**ProductShowcase structure (mockup board A):** toolbar (search input flex + `+ Add product` button right); `grid grid-cols-2 xl:grid-cols-3 gap-4`; card = `rounded-[16px] border border-border bg-card overflow-hidden` with: 150px image area (`<img className="h-[150px] w-full object-cover">` when the record's `data.imageAssetId` resolves to a `stuffItems` entry's url; else a button `h-[150px] bg-accent/50 text-[0.8125rem] text-muted-foreground` reading `Add image · from My Stuff` opening the picker), `⭐ Pinned` chip absolute top-left when `pinned`; body: name (semibold) + mono price row, 2-line clamped description, meta row (badge / `updated {whenLabel}` / actions ✎ edit-form (same fields as before + no image field — image is the picker's job), Archive/Unarchive). Archived cards `opacity-55` sorted last + footer note `Archived (n) — hidden from Otto`. `+ Add product` dashed card at grid end (opens the existing add form). Edit/add forms = the field-form idiom from the old ProductList — port it over unchanged (fields: name*, description, price, url, sellingAngle, tags).

**Picker wiring (OttoMemory):** state `pickerFor: BrandRecordRow | null`; ProductShowcase's picker-open events set it; render:

```tsx
{pickerFor && (
  <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center" onClick={() => setPickerFor(null)}>
    <div className="bg-card rounded-[16px] border border-border p-5 max-w-[720px] w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
      <h3 className="text-[0.9375rem] font-semibold mb-3">Choose an image from My Stuff</h3>
      <StuffLibrary items={stuffItems} mode="picker" onPick={(assetId) => { void onSetImage(pickerFor, assetId); setPickerFor(null); }} />
    </div>
  </div>
)}
```

`stuffItems` comes into OttoMemory as a new prop (Task 8 threads it; until then compute `[]` default so typecheck holds: `stuffItems = []` default param).

**Generate half (AddAssetDialog):** replace the disabled segment with: format picker (4 cards from `REFERENCE_FORMATS` — label + one-line skeleton hint), then form: subject (required, `subjectLabel`/`subjectPlaceholder`), notes (optional textarea). Footer: cost line `Generates 1 reference image — uses ~$${REFGEN_PRICE_USD_PER_IMAGE.toFixed(2)} of credits.` + buttons Cancel / `Generate` (disabled while busy). Submit:

```tsx
const fd = new FormData();
fd.set("name", subject.slice(0, 60));
fd.set("type", fmt.entityType);
const created = await createEntity(fd);                    // no files — entity shell
if (!created || "error" in created) { setError(...); return; }
const res = await startRefGen({
  entityId: created.id,
  prompt: fmt.buildPrompt({ subject, notes }),
  count: 1, model: "seedream", mode: "BASE",
});
if ("error" in res) { setError(res.error); return; }
onDone(); // parent refetches; job completes async via existing worker → refs appear
```

Show after success: `Generating — it will appear in My Stuff shortly.` (existing refgen worker attaches refs; no polling in v1).

- [ ] **Step 1: Build ProductShowcase; swap into OttoMemory's products tab; delete ProductList.** Grep first: `grep -rn "ProductList" apps/web` → only OttoMemory imports it (plus its own file); after swap re-grep → zero references.
- [ ] **Step 2: Wire picker modal + onSetImage in OttoMemory.**
- [ ] **Step 3: Build the Generate half in AddAssetDialog** per above (grep the exact exported name/location of `REFGEN_PRICE_USD_PER_IMAGE` before importing).
- [ ] **Step 4:** `pnpm --filter web typecheck && pnpm --filter web test` → clean / green-except-known-pre-existing.
- [ ] **Step 5: Commit** `git add apps/web/components/otto apps/web/lib && git commit -m "feat(web): Products showcase cards + My Stuff picker + fixed-format Generate reference"`

---

### Task 8: OttoStuff rewrite + data threading + skin-preview mocks

**Files:**
- Modify: `apps/web/components/otto/OttoStuff.tsx` (rewrite around StuffLibrary + AddAssetDialog; keep `AdTile` export + rename/delete server calls)
- Modify: `apps/web/components/otto/OttoApp.tsx`, `apps/web/components/otto/OttoView.tsx` (thread `records` + `history` into OttoStuff; thread `stuffItems` into OttoMemory)
- Modify: `apps/web/app/otto/page.tsx` (no new loads needed — `records`, `history`, `entities`, `ads` already in the Promise.all; just pass through)
- Modify: `apps/web/app/skin-preview/page.tsx` (mocks: give `sp-prod1` `imageAssetId: "as-latte"`; add a CHARACTER entity mock with `refs:[{assetId:"as-rosa",…}]` and a PRODUCT entity with `assetId:"as-latte"` so the ⭐ tag renders; ensure history mocks exist for Images/Videos filters)

**Structure:** OttoStuff = header (`My Stuff` h1 + sub `Everything you and Otto have made or saved — reuse any of it in the next campaign.`) + `[+ Add]` button (opens AddAssetDialog) + `<StuffLibrary items={buildStuffItems({entities, history, ads, records})} mode="library" onRename={…existing} onDelete={…existing} onSetProductImage={(assetId) => setChooseProductFor(assetId)} />`. `chooseProductFor` modal: list active product records (name rows); click → `saveBrandRecord({ id, kind:"product", data:{...data, imageAssetId} })` → `router.refresh()`. The old cast/ads Tabs, EntityTile grid and AdMediaTile grid are REPLACED by StuffLibrary (AdJobCard row for in-flight ad jobs stays above the grid, unchanged). In OttoMemory, accept `stuffItems?: StuffItem[]` (default `[]`) and pass from OttoView (compute once in OttoView with useMemo from the same props).

- [ ] **Step 1: Rewrite OttoStuff + threading per above.** Keep every server-action call that exists today (rename/delete entity handlers move into props for StuffLibrary).
- [ ] **Step 2: skin-preview mocks** per Files list.
- [ ] **Step 3:** `pnpm --filter web typecheck && pnpm --filter web test` → clean/green. Grep `EntityTile\|AdMediaTile` — if now-unused, delete the dead components in the same commit (they were replaced by THIS change).
- [ ] **Step 4: Commit** `git add apps/web && git commit -m "feat(web): My Stuff unified library — filters, add-asset, product-image linking"`

---

### Task 9: Verification sweep + visual + PR update

- [ ] **Step 1:** `pnpm -r typecheck` ✓; `pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/otto test && pnpm --filter web test` ✓ (web: only the known pre-existing env failures); `pnpm --filter @fikirtive/otto catalog:check` ✓.
- [ ] **Step 2: MONEY-GUARD whole-branch:** `git diff main...HEAD --stat -- packages/db/src/credits.ts packages/core/src/spend.ts apps/worker/src/jobs packages/generation "apps/web/**/gen-actions.ts" "apps/web/**/refgen-actions.ts" "apps/web/**/cowork-actions.ts" "**/useCanvasGen.ts" pnpm-lock.yaml` → EMPTY. Confirm still exactly ONE migration on the branch.
- [ ] **Step 3: Visual:** dev server → `/skin-preview?view=memory` (Products tab: image card + placeholder + tabs + dots) and `/skin-preview?view=stuff` (filters + ⭐ tag + hover actions + Add dialog both halves). Screenshot both, compose vs `~/Desktop/brandmem-v2-tabs-mock.png` same-scale → `~/Desktop/brandmem-v2-built-vs-mock.png`. 0 console errors. Manual mainline (mock transport, $0): switch tabs → chat a price change → Products tab dot + card highlight → Undo → open picker from product card → pick image → My Stuff shows ⭐ tag → [+ Add]→Generate shows cost line (do NOT submit a real generation outside mock transport).
- [ ] **Step 4:** Push; update PR #103 title/body (6-tab v2 + My Stuff scope, the R1–R4 revisions table, new screenshots). Do NOT merge.

---

## Self-Review Notes

- Spec coverage: R1→Task 6; R2→Tasks 1/2/7; R3→Tasks 4/5/8; R4→Tasks 3/5/7; 钱路→global constraints + Task 9 audit; 测试/验收→per-task TDD + Task 9. Deviations to flag in PR: formats as ONE file (spec said four — same founder-editability, less scaffolding); picker sources = entity images only (history thumbs carry no assetId; noted in Task 4 interface); enhance button deferred (spec allowed "实现时定" — v1 is pure template interpolation).
- Type consistency: `StuffItem`/`StuffFilter` (T4) consumed by T5/7/8; `sectionsTouched` (T1) by T6; `ReferenceFormat` (T3) by T7; `onSetImage`/`saveBrandRecord` data-spread matches BrandRecordRow.
- Known risk: exact `AdTile` fields + `acceptRefFiles` FormData field names + `REFGEN_PRICE_USD_PER_IMAGE` export path are grep-first steps inside Tasks 4/5/7 (marked inline).
