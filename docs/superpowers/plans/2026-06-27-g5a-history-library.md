# G5a — History / Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A searchable, paginated "Library" view of all the user's generations (every source) for the current project, opening the existing G2a DetailPanel on click.

**Architecture:** One new owner+project-scoped keyset reader (`getGenerationHistory`) mirroring `getMediaPage`'s cursor pattern but without the `threadId` filter; one additive index; one client `<OttoLibrary>` view (search · favorites · Full/Compact · load-more · DetailPanel click-through); three lines of nav wiring. Read-only over existing rows — money path, agent, and skills untouched.

**Tech Stack:** Next.js App Router (`"use server"` action), Prisma 7.8 + Postgres (keyset pagination), React `useState`/`useEffect` + `al-*`/`ds.tsx` styling, vitest 3.2 (prisma mocked via `vi.hoisted`/`vi.mock`).

## Global Constraints

- **Money path untouched** — no charge/grant/reserve/settle/`startGen`. The reader only reads; the card star reuses the existing owner-scoped `setFavorite`; deletes come from the reused `DetailPanel`. No spend-path file is modified.
- **Owner + project scoped** — `getGenerationHistory` gates `requireOwner()` then `ownedProject(projectId, ownerId)`; the `where` always carries `ownerId` + `projectId` + `deletedAt: null`. Search and cursor only NARROW within that gated `where` — they can never widen scope.
- **Additive, nullable-safe migration** — new index only, no column, no backfill.
- **After any schema change, rebuild the db package** — `pnpm --filter @fikirtive/db run build` (NOT just `generate`); the Prisma client outputs to `packages/db/generated/prisma` and `@fikirtive/db`'s `dist` must be rebuilt so the new index/types reach consumers and `tsc` stays clean.
- **Reuse, don't rebuild** — `DetailPanel` (G2a), `setFavorite` (G2a), the `getMediaPage` keyset pattern, `storageKey`/`storageKeyToSrc` from `@fikirtive/core`, and the `OttoViewKey`/`OttoNav`/`OttoView` view pattern.
- **Test runner** — `cd apps/web && pnpm exec vitest run <relative path>` (the `pnpm test -- <name>` form is broken here).
- **Build gate** — `pnpm -r build` must show `├ ƒ /otto` and `Done`. Grep the build log; do not trust the pipe's exit code.
- **Out of scope (do NOT build):** kind (image/video) filter, cross-project library, bulk actions, tag/entity filter, the other G5 pieces.

---

### Task 1: `getGenerationHistory` reader + additive index

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Generation model — add one `@@index`)
- Create: `packages/db/prisma/migrations/20260627130000_generation_library_idx/migration.sql`
- Create: `apps/web/lib/library-actions.ts`
- Test: `apps/web/lib/__tests__/library-actions.test.ts`

**Interfaces:**
- Produces:
  - `type LibraryItem = { id: string; url: string; kind: "image" | "video"; prompt: string; favorite: boolean; createdAt: string }`
  - `type LibraryPage = { items: LibraryItem[]; nextCursor: string | null; hasMore: boolean }`
  - `getGenerationHistory(projectId: string, opts?: { search?: string; favoriteOnly?: boolean; cursor?: string | null; take?: number }): Promise<LibraryPage | { error: string }>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/library-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockProjectFindFirst, mockGenFindMany } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockGenFindMany: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    generation: { findMany: mockGenFindMany },
  },
}));
vi.mock("@fikirtive/core", () => ({
  storageKey: (o: string, h: string, e: string) => `${o}/${h}.${e}`,
  storageKeyToSrc: (k: string) => `https://cdn/${k}`,
}));

import { getGenerationHistory } from "../library-actions";

function row(id: string, ext: string, createdAtIso: string, favorite = false) {
  return {
    id, promptText: `p-${id}`, favorite, createdAt: new Date(createdAtIso),
    asset: { ownerId: "u1", contentHash: `h-${id}`, ext },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockProjectFindFirst.mockResolvedValue({ id: "p1" });
});

describe("getGenerationHistory — scoping & errors", () => {
  it("returns the gate error for a non-owner", async () => {
    mockOwner.mockResolvedValue({ error: "Unauthorized." });
    expect(await getGenerationHistory("p1")).toEqual({ error: "Unauthorized." });
    expect(mockGenFindMany).not.toHaveBeenCalled();
  });
  it("rejects an unowned project before querying generations", async () => {
    mockProjectFindFirst.mockResolvedValue(null);
    expect(await getGenerationHistory("pX")).toEqual({ error: "Project not found." });
    expect(mockGenFindMany).not.toHaveBeenCalled();
  });
  it("always scopes where to owner+project+deletedAt:null, newest-first, over-fetch take+1", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { take: 10 });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "u1", projectId: "p1", deletedAt: null }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 11,
      }),
    );
  });
});

describe("getGenerationHistory — filters", () => {
  it("adds favorite:true when favoriteOnly", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { favoriteOnly: true });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ favorite: true }) }),
    );
  });
  it("adds a case-insensitive promptText contains when search is set", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { search: "  sale  " });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ promptText: { contains: "sale", mode: "insensitive" } }) }),
    );
  });
  it("omits the search filter for blank/whitespace search", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { search: "   " });
    const arg = mockGenFindMany.mock.calls[0][0];
    expect("promptText" in arg.where).toBe(false);
  });
  it("builds the keyset OR clause from a cursor", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { cursor: "2026-01-02T00:00:00.000Z|gen-9" });
    const arg = mockGenFindMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { createdAt: { lt: new Date("2026-01-02T00:00:00.000Z") } },
      { createdAt: new Date("2026-01-02T00:00:00.000Z"), id: { lt: "gen-9" } },
    ]);
  });
});

describe("getGenerationHistory — paging & mapping", () => {
  it("derives kind from ext, resolves url, maps fields", async () => {
    mockGenFindMany.mockResolvedValue([
      row("a", "mp4", "2026-01-03T00:00:00.000Z", true),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    const res = await getGenerationHistory("p1", { take: 60 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items[0]).toEqual({ id: "a", url: "https://cdn/u1/h-a.mp4", kind: "video", prompt: "p-a", favorite: true, createdAt: "2026-01-03T00:00:00.000Z" });
    expect(res.items[1].kind).toBe("image");
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBe(null);
  });
  it("sets hasMore + nextCursor when over-fetch returns take+1 rows", async () => {
    mockGenFindMany.mockResolvedValue([
      row("a", "png", "2026-01-03T00:00:00.000Z"),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    const res = await getGenerationHistory("p1", { take: 1 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe("a");
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe("2026-01-03T00:00:00.000Z|a");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/library-actions.test.ts`
Expected: FAIL — cannot find module `../library-actions`.

- [ ] **Step 3: Add the index to the Prisma schema**

In `packages/db/prisma/schema.prisma`, in the `Generation` model's index block (near the other `@@index` lines), add:

```prisma
  // G5a: unified library keyset — newest-first over ALL of a project's generations
  // (no threadId filter, unlike Generation_media_idx). Additive, no backfill.
  @@index([ownerId, projectId, deletedAt, createdAt, id], map: "Generation_library_idx")
```

- [ ] **Step 4: Write the migration SQL**

Create `packages/db/prisma/migrations/20260627130000_generation_library_idx/migration.sql`:

```sql
-- CreateIndex
CREATE INDEX "Generation_library_idx" ON "Generation"("ownerId", "projectId", "deletedAt", "createdAt", "id");
```

- [ ] **Step 5: Rebuild the db package (generate + tsc → fresh types for consumers)**

Run: `pnpm --filter @fikirtive/db run build`
Expected: "Generated Prisma Client" then a clean `tsc` (no errors).

- [ ] **Step 6: Implement the reader**

Create `apps/web/lib/library-actions.ts`:

```ts
"use server";

import { prisma } from "@fikirtive/db";
import { storageKey, storageKeyToSrc } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";

export type LibraryItem = {
  id: string;
  url: string;
  kind: "image" | "video";
  prompt: string;
  favorite: boolean;
  createdAt: string;
};
export type LibraryPage = { items: LibraryItem[]; nextCursor: string | null; hasMore: boolean };

const LIBRARY_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

/**
 * One keyset page of a project's full generation history (every source: cowork, canvas,
 * upload, crop), newest first. Cursor = "<createdAt-iso>|<id>" (id breaks ties so no row is
 * skipped/repeated). Owner+project scoped; read-only. Optional prompt search + favorites filter.
 */
export async function getGenerationHistory(
  projectId: string,
  opts?: { search?: string; favoriteOnly?: boolean; cursor?: string | null; take?: number },
): Promise<LibraryPage | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  if (!(await ownedProject(projectId, ownerId))) return { error: "Project not found." };

  const take = opts?.take ?? 60;
  const search = opts?.search?.trim();

  let cursorWhere = {};
  if (opts?.cursor) {
    const sep = opts.cursor.lastIndexOf("|");
    const at = new Date(opts.cursor.slice(0, sep));
    const id = opts.cursor.slice(sep + 1);
    if (!Number.isNaN(at.getTime()) && id) {
      cursorWhere = { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
    }
  }

  const rows = await prisma.generation.findMany({
    where: {
      ownerId,
      projectId,
      deletedAt: null,
      ...(opts?.favoriteOnly ? { favorite: true } : {}),
      ...(search ? { promptText: { contains: search, mode: "insensitive" as const } } : {}),
      ...cursorWhere,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1, // over-fetch one to learn hasMore without a count()
    include: { asset: true },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const items: LibraryItem[] = page.map((g) => {
    const ext = g.asset.ext.toLowerCase();
    return {
      id: g.id,
      url: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)),
      kind: LIBRARY_VIDEO_EXTS.has(ext) ? "video" : "image",
      prompt: g.promptText ?? "",
      favorite: g.favorite,
      createdAt: g.createdAt.toISOString(),
    };
  });
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;
  return { items, nextCursor, hasMore };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/library-actions.test.ts`
Expected: PASS (all scoping/filter/paging tests green).

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260627130000_generation_library_idx apps/web/lib/library-actions.ts apps/web/lib/__tests__/library-actions.test.ts
git commit -m "feat(g5a): getGenerationHistory keyset reader + library index (owner+project scoped, read-only)"
```

---

### Task 2: `<OttoLibrary>` view component

**Files:**
- Create: `apps/web/components/otto/OttoLibrary.tsx`

**Interfaces:**
- Consumes: `getGenerationHistory`, `LibraryItem` (Task 1); `setFavorite` (`apps/web/lib/asset-actions.ts`); `DetailPanel` (`apps/web/components/asset/DetailPanel.tsx`, default export, props `{ generationId, projectId, onClose, entities? }`); `EntityDTO` (`@/lib/types`).
- Produces: `OttoLibrary({ projectId, entities })` — default export.

> No unit test (the testable logic — the keyset reader — is Task 1; this is presentational/integration). Verified by `tsc` here and the full build gate in Task 3.

- [ ] **Step 1: Implement the component**

Create `apps/web/components/otto/OttoLibrary.tsx`:

```tsx
"use client";
import React, { useCallback, useEffect, useState } from "react";
import type { EntityDTO } from "@/lib/types";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import { setFavorite } from "@/lib/asset-actions";
import DetailPanel from "../asset/DetailPanel";

const PAGE = 60;

export default function OttoLibrary({ projectId, entities = [] }: { projectId: string; entities?: EntityDTO[] }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [view, setView] = useState<"full" | "compact">("full");
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (fromCursor: string | null, replace: boolean) => {
      setLoading(true);
      const res = await getGenerationHistory(projectId, {
        search: search.trim() || undefined,
        favoriteOnly,
        cursor: fromCursor,
        take: PAGE,
      });
      setLoading(false);
      if ("error" in res) return;
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
    },
    [projectId, search, favoriteOnly],
  );

  // Initial load + reload (debounced) whenever search/favorites change.
  useEffect(() => {
    const t = setTimeout(() => {
      void fetchPage(null, true);
    }, 300);
    return () => clearTimeout(t);
  }, [fetchPage]);

  async function toggleFav(id: string, current: boolean) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorite: !current } : it)));
    const res = await setFavorite(id, !current);
    if ("error" in res) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorite: current } : it)));
    }
  }

  const minCard = view === "compact" ? 120 : 220;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-4)", flexShrink: 0, borderBottom: "1px solid var(--border-subtle)" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your library…"
          className="al-input"
          style={{ flex: 1, maxWidth: 360 }}
        />
        <button
          type="button"
          onClick={() => setFavoriteOnly((v) => !v)}
          aria-pressed={favoriteOnly}
          className="al-btn al-btn-sm"
          style={{ background: favoriteOnly ? "var(--surface-raised)" : "transparent" }}
        >
          {favoriteOnly ? "★ Favorites" : "☆ Favorites"}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-1)" }}>
          <button type="button" onClick={() => setView("full")} aria-pressed={view === "full"} className="al-btn al-btn-sm" style={{ background: view === "full" ? "var(--surface-raised)" : "transparent" }}>Full</button>
          <button type="button" onClick={() => setView("compact")} aria-pressed={view === "compact"} className="al-btn al-btn-sm" style={{ background: view === "compact" ? "var(--surface-raised)" : "transparent" }}>Compact</button>
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-4)" }}>
        {items.length === 0 && !loading ? (
          <div style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--text-muted)" }}>
            {search || favoriteOnly ? "Nothing matches." : "No generations yet — make something with Otto or the canvas."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}px, 1fr))`, gap: "var(--space-3)" }}>
            {items.map((it) => (
              <div key={it.id} style={{ position: "relative", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", cursor: "pointer" }} onClick={() => setDetailFor(it.id)}>
                {it.kind === "video" ? (
                  <video src={it.url} muted style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.url} alt={it.prompt} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                )}
                <button
                  type="button"
                  aria-label={it.favorite ? "Unfavorite" : "Favorite"}
                  onClick={(e) => { e.stopPropagation(); void toggleFav(it.id, it.favorite); }}
                  style={{ position: "absolute", top: 6, right: 6, border: "none", background: "rgba(0,0,0,0.45)", color: it.favorite ? "#ffce4d" : "#fff", cursor: "pointer", borderRadius: "999px", width: 26, height: 26, lineHeight: 1 }}
                >
                  {it.favorite ? "★" : "☆"}
                </button>
                {view === "full" && (
                  <div style={{ padding: "var(--space-2)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.prompt || "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(it.createdAt).toLocaleDateString()}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4)" }}>
            <button type="button" className="al-btn al-btn-sm" disabled={loading} onClick={() => void fetchPage(cursor, false)}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {detailFor && (
        <DetailPanel
          generationId={detailFor}
          projectId={projectId}
          entities={entities}
          onClose={() => { setDetailFor(null); void fetchPage(null, true); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors. (If `al-input` is not an existing class, drop the `className="al-input"` and keep the inline styles; verify against `apps/web/app/otto/otto-theme.css` / existing inputs in `OttoStuff.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/otto/OttoLibrary.tsx
git commit -m "feat(g5a): OttoLibrary view — search, favorites, Full/Compact, keyset paging, DetailPanel click-through"
```

---

### Task 3: Nav wiring + final build gate

**Files:**
- Modify: `apps/web/components/otto/OttoApp.tsx` (`OttoViewKey`)
- Modify: `apps/web/components/otto/OttoNav.tsx` (icon + NavItem)
- Modify: `apps/web/components/otto/OttoView.tsx` (view branch)

**Interfaces:**
- Consumes: `<OttoLibrary>` (Task 2). `OttoView` already receives `projectId` and `entities`.

> Integration wiring. Verified by `tsc` + the full build gate.

- [ ] **Step 1: Add the view key**

In `apps/web/components/otto/OttoApp.tsx`, change:

```ts
export type OttoViewKey = "otto" | "stuff" | "memory" | "account";
```
to:
```ts
export type OttoViewKey = "otto" | "stuff" | "library" | "memory" | "account";
```

- [ ] **Step 2: Add the nav item**

In `apps/web/components/otto/OttoNav.tsx`, add an icon component near the other `IconX` functions:

```tsx
function IconLibrary() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
```

And add to `NAV_ITEMS` (after the `stuff` entry):

```tsx
  { key: "library", label: "Library", icon: <IconLibrary /> },
```

- [ ] **Step 3: Add the view branch**

In `apps/web/components/otto/OttoView.tsx`, import the component near the other otto imports:

```tsx
import OttoLibrary from "./OttoLibrary";
```

And add a branch alongside the existing `if (view === "stuff") { … }` blocks (before the `view === "otto"` two-pane return):

```tsx
  if (view === "library") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoLibrary projectId={projectId} entities={entities} />
      </div>
    );
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors; `OttoViewKey` union, the NavItem, and the OttoView branch all line up.

- [ ] **Step 5: Run the whole web test suite**

Run: `cd apps/web && pnpm exec vitest run`
Expected: the G5a test file passes; the only failures are the pre-existing `DATABASE_URL`-not-set integration tests (`require-owner`, `tenant-guard`, `files route`, `isolation`).

- [ ] **Step 6: Full monorepo build gate**

Run: `pnpm -r build 2>&1 | tee /tmp/g5a-build.log; grep -E "ƒ /otto|Done|error TS|Failed to compile" /tmp/g5a-build.log`
Expected: the log shows `├ ƒ /otto` and `Done`, and NO `error TS` / `Failed to compile`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/otto/OttoApp.tsx apps/web/components/otto/OttoNav.tsx apps/web/components/otto/OttoView.tsx
git commit -m "feat(g5a): wire Library into Otto nav + view switch; build-verified"
```

---

## Self-Review

**Spec coverage:**
- §2.1 reader → Task 1. ✓
- §2.2 additive index → Task 1 (schema + migration). ✓
- §2.3 `<OttoLibrary>` (search · favorites · Full/Compact · load-more · DetailPanel · star · empty state) → Task 2. ✓
- §2.4 nav wiring (OttoViewKey · OttoNav · OttoView) → Task 3. ✓
- §5 money/safety → reader is `requireOwner`+`ownedProject` scoped (Task 1 tests); star reuses `setFavorite`; no spend file touched. ✓
- §6 testing → Task 1 unit tests cover scoping/filters/paging/mapping; Task 3 runs the suite + build gate. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two "verify against existing X" notes (Task 2 `al-input`, Task 3 nav placement) are drift guards, not missing content.

**Type consistency:** `LibraryItem`/`LibraryPage` defined in Task 1 are consumed verbatim in Task 2. `getGenerationHistory(projectId, opts)` signature matches its call in `OttoLibrary.fetchPage`. `DetailPanel` props `{ generationId, projectId, onClose, entities }` match the Task 2 usage and the real G2a export. `OttoViewKey` gains `"library"` in Task 3 Step 1, consumed by the NavItem (Step 2) and the OttoView branch (Step 3). `setFavorite(id, boolean) → { favorite } | { error }` matches the optimistic toggle's `"error" in res` check.

**Note:** The reader uses `mode: "insensitive" as const` for the Prisma case-insensitive filter — supported by Prisma 7.8 on Postgres. If `tsc` rejects the literal, import `Prisma` from `@fikirtive/db` and use `Prisma.QueryMode.insensitive`; the test asserts the shape `{ contains: "sale", mode: "insensitive" }` either way.
