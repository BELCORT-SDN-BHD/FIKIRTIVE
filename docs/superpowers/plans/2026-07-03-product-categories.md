# Product Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type-to-create product categories + OTTO auto-categorization, per spec `docs/superpowers/specs/2026-07-03-product-categories-design.md`.

**Architecture:** `category` is one more optional string inside the product record's JSON `data` (zero migration, same pattern as `imageAssetId`). The category list is DERIVED (distinct values in use). OTTO gets a `category` param on `saveProduct`, sees the existing taxonomy via context injection, and follows a one-line instruction discipline. UI = filter chips + card badge + datalist input on the Products tab.

**Tech Stack:** zod v4, vitest, existing OttoMemory/ProductShowcase components.

## Global Constraints

- **MONEY-GUARD (BINDING):** never modify `packages/db/src/credits.ts`, `packages/core/src/spend.ts`, `apps/worker/src/jobs/*`, `apps/web/**/gen-actions.ts`, `refgen-actions.ts`, `cowork-actions.ts`, `**/useCanvasGen.ts`, `packages/generation/*`, `pnpm-lock.yaml`. Zero new spend paths; no migration.
- Branch `claude/product-categories` (off main `0d9062a`) in worktree `/Users/winnin/Desktop/artlio/.claude/worktrees/brand-memory`. Env already bootstrapped.
- Category normalization: store trimmed original casing; compare/group case-insensitively (first-seen casing wins for display).
- OTTO auto-categorize = auto-live + undoable (existing diff/undo covers it); no new approval gates.
- Registry/catalog: `saveProduct` description text changes → regen catalog (`pnpm --filter @fikirtive/otto catalog`).

---

### Task 1: Core — `category` field + derived-category pure helpers (TDD)

**Files:**
- Modify: `packages/core/src/brand-records.ts` (productRecordData + new helpers)
- Test: `packages/core/src/brand-records.test.ts` (extend)
- Modify: `packages/core/src/index.ts` (export helpers)

**Interfaces (Produces):**
- `productRecordData` gains `category: z.string().max(40).optional()` (after `tags`, before `imageAssetId`, comment: type-to-create category; display keeps original casing).
- `export function categoryKey(name: string): string` — `name.trim().toLowerCase()`.
- `export function distinctCategories(records: Array<{ kind: string; status: string; data: Record<string, unknown> }>): string[]` — active products only; first-seen original casing per categoryKey; insertion order.

- [ ] **Step 1: Failing tests** — append to `brand-records.test.ts`:

```ts
describe("product category", () => {
  it("accepts an optional category ≤40 chars", () => {
    expect(productRecordData.safeParse({ name: "Latte", category: "Coffee" }).success).toBe(true);
    expect(productRecordData.safeParse({ name: "Latte", category: "x".repeat(41) }).success).toBe(false);
    expect(productRecordData.safeParse({ name: "Latte" }).success).toBe(true);
  });
});

describe("distinctCategories", () => {
  const rec = (name: string, category?: string, status = "active", kind = "product") =>
    ({ kind, status, data: { name, ...(category ? { category } : {}) } });
  it("derives first-seen-casing distinct list from active products only", () => {
    const list = distinctCategories([
      rec("A", "Coffee"), rec("B", "coffee"), rec("C", "Merch"),
      rec("D", "Seasonal", "archived"), rec("E"), rec("F", "Tea", "active", "offer"),
    ]);
    expect(list).toEqual(["Coffee", "Merch"]);
  });
  it("empty input → empty list", () => expect(distinctCategories([])).toEqual([]));
});
```

- [ ] **Step 2: Verify failure** — `pnpm --filter @fikirtive/core exec vitest run src/brand-records.test.ts` → new cases fail.
- [ ] **Step 3: Implement** — add the schema field; append:

```ts
/** Case-insensitive grouping key for type-to-create categories (display keeps original casing). */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Derived category list: distinct categories of ACTIVE products, first-seen casing, insertion order. */
export function distinctCategories(
  records: Array<{ kind: string; status: string; data: Record<string, unknown> }>,
): string[] {
  const seen = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "product" || r.status !== "active") continue;
    const raw = r.data.category;
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = categoryKey(raw);
    if (!seen.has(key)) seen.set(key, raw.trim());
  }
  return [...seen.values()];
}
```

Export both from `index.ts`.
- [ ] **Step 4:** `pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/core build` → green.
- [ ] **Step 5: Commit** `git add packages/core/src && git commit -m "feat(core): product category field + derived distinctCategories helpers"`

---

### Task 2: OTTO — `saveProduct` category param + injection + instruction (TDD)

**Files:**
- Modify: `packages/otto/src/skills/save-product.ts` (param + description)
- Test: `packages/otto/src/skills/_brand-record.test.ts` (append 2 cases)
- Modify: `packages/otto/src/instructions.ts` (one discipline line in the Brand memory block)
- Modify: `apps/web/lib/memory-actions.ts` (getBrandContextText products section only)
- Test: `apps/web/lib/__tests__/memory-actions.test.ts` (append 1 case)
- Regen: `pnpm --filter @fikirtive/otto catalog`

**Steps:**
- [ ] **Step 1 (otto, failing tests):** append to `_brand-record.test.ts`:

```ts
  it("saveProduct threads category into data", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    db.prisma.brandRecord.create.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", category: "Coffee" } },
      { context: makeCtx() },
    );
    const arg = db.prisma.brandRecord.create.mock.calls[0]![0] as { data: { data: Record<string, unknown> } };
    expect(arg.data.data.category).toBe("Coffee");
  });
  it("OTTO update without category preserves the existing one (merge)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue({ id: "r1", data: { name: "Latte Blend", category: "Coffee" } });
    db.prisma.brandRecord.update.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", price: "RM 55" } },
      { context: makeCtx() },
    );
    expect(db.prisma.brandRecord.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({ data: expect.objectContaining({ category: "Coffee", price: "RM 55" }) }),
    });
  });
```

- [ ] **Step 2:** rebuild core; run → first test FAILS (zod strips undeclared `category` from skill params? No — the helper validates via core schema which now has category, so the create test may PASS already; the REAL red is the skill params: add to `save-product.ts` params: `category: z.string().max(40).optional(),` and append to its description: `" Use category to file the product (pick an existing category from your context when one fits; otherwise create a concise new one — e.g. 'Coffee', 'Merch'). When the user asks you to organize/categorize their products, update each product's category via this skill."` Run both tests → green.
- [ ] **Step 3 (instructions):** in the `## Brand memory` block's records bullet, append sentence: `Products carry a \`category\` — prefer an existing category from your context; create a concise new one only when none fits.` Run `pnpm --filter @fikirtive/otto catalog && pnpm --filter @fikirtive/otto test` (fix instructions.test only if it asserts the block text) → green.
- [ ] **Step 4 (web injection, failing test):** append to `memory-actions.test.ts`:

```ts
  it("products injection includes [category] per line and a Categories summary", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    mockRecordFindMany.mockResolvedValue([
      { kind: "product", data: { name: "Latte Blend", category: "Coffee" }, status: "active", startsAt: null, endsAt: null, pinned: false },
      { kind: "product", data: { name: "Tote Bag", category: "Merch" }, status: "active", startsAt: null, endsAt: null, pinned: false },
      { kind: "product", data: { name: "Mystery" }, status: "active", startsAt: null, endsAt: null, pinned: false },
    ]);
    const text = await getBrandContextText();
    expect(text).toContain("[Coffee]");
    expect(text).toMatch(/Categories: Coffee, Merch/);
  });
```

- [ ] **Step 5:** implement in `getBrandContextText` products block: summary line becomes `Your products: N total (M pinned). Categories: <distinctCategories(...) joined ", ">. Top:` (omit `Categories:` segment when none); each product line appends ` [${category}]` when present (import `distinctCategories` from @fikirtive/core). Keep budget 800/cap. Run full memory-actions tests → green.
- [ ] **Step 6: Commit** `git add packages/otto apps/web/lib && git commit -m "feat(otto,web): saveProduct category + taxonomy injection + instruction discipline"`

---

### Task 3: UI — filter chips + card badge + datalist input

**Files:**
- Modify: `apps/web/components/otto/memory/ProductShowcase.tsx`
- Modify: `apps/web/app/skin-preview/page.tsx` (give sp-prod1 `category: "Coffee"`, sp-prod2 `category: "Merch"`)

**Steps:**
- [ ] **Step 1:** In ProductShowcase: compute `const categories = distinctCategories(records.map(r => ({ kind: r.kind, status: r.status, data: r.data })))` (import from @fikirtive/core). Add `catFilter` state (`"all" | "uncat" | string`). When `categories.length > 0`, render a chips row under the toolbar (pill idiom `rounded-[14px] bg-muted p-1`, chips `rounded-[10px] px-3 py-1.5 text-[0.8125rem]`): `All (n)` · each category `(count via categoryKey match)` · `Uncategorized (count)` (only when >0). Filter the visible grid accordingly (case-insensitive via categoryKey; archived section unaffected).
- [ ] **Step 2:** Card meta row 1: after the source badge add a gray pill with the category when present (`text-[0.6875rem] rounded-full px-2 py-[2px] bg-accent text-muted-foreground`).
- [ ] **Step 3:** Add/edit form: `Category` input with `list="product-categories"` + `<datalist id="product-categories">{categories.map(...)}</datalist>`, placeholder `e.g. Coffee — type a new name to create`. Include `category` in the form's data assembly (trimmed; empty string → omit key).
- [ ] **Step 4:** skin-preview mocks per Files. `pnpm --filter web typecheck` + `pnpm --filter web exec vitest run lib/__tests__/memory-actions.test.ts lib/__tests__/brand-record-actions.test.ts lib/__tests__/stuff-items.test.ts` → green.
- [ ] **Step 5: Commit** `git add apps/web && git commit -m "feat(web): product category filter chips + card badge + type-to-create input"`

---

### Task 4: Verify sweep + PR

- [ ] `pnpm -r typecheck`; core+otto suites; catalog:check; MONEY-GUARD audit `git diff main...HEAD --stat -- <frozen list>` → empty; zero migrations on branch.
- [ ] Live render `/skin-preview?view=memory&tab=products`: chips row + badges + datalist; screenshot → `~/Desktop/product-categories-built.png`; 0 console errors.
- [ ] Push; `gh pr create` (NOT draft; body: spec ref, founder decisions, money-guard output, screenshot). Wait CI both green. Do NOT merge — founder gates.
