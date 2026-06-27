# Design spec — G5a · History / Library (first slice of G5)

Date: 2026-06-27
Status: approved by founder (design); autonomous build, batch-review at the end.
Branch: `claude/otto-g5a-library` (off `claude/otto-g4c-multi-convo`). Grounded in the G1→G4c stack.

## 1. What this is

The first slice of G5: a **searchable, paginated "Library" view** of the user's generations for the
current project — Otto-conversation outputs, canvas-direct generations, uploads, and crops, all
sources, newest first, excluding only soft-deleted. Click a card to open the existing G2a
`DetailPanel` (regen / animate / download / favorite / delete / variants / crop / edit). It is a
**read-only view over existing rows** — the money path, the agent, and skills are untouched.

Founder decisions (brainstorming):
- **Content = everything you made** (all sources incl. uploads), with search + a "favorites" filter.
- **Project-scoped** — `/otto` resolves one default project per user (`ensureDefaultProject`), so
  project-scoped IS the user's whole library. No cross-project view in v1.
- **Full / Compact** view modes (mirrors Grok's saved page).

This is mostly **reuse**: the only new pieces are one query action, one additive index, and one view
component + three lines of nav wiring.

## 2. Scope (G5a)

1. **New owner-scoped reader** `getGenerationHistory` — keyset-paginated, optional prompt search,
   optional favorites filter.
2. **Additive index** for the unified newest-first keyset.
3. **`<OttoLibrary>` view** — header (search box · ⭐ favorites toggle · Full/Compact toggle) + a
   responsive card grid + "Load more" keyset paging + empty state; cards open `DetailPanel`; the
   star toggles via the existing `setFavorite`.
4. **Nav wiring** — add `"library"` to `OttoViewKey`, a NavItem in `OttoNav`, a branch in `OttoView`.

### Out of scope (later / dropped)
- ❌ Kind filter (image/video) — `kind` is derived from `asset.ext`, awkward in SQL; v1 ships search +
  favorites only. Follow-up.
- ❌ Cross-project library, bulk select/actions, tag/entity filter, the other G5 pieces (templates,
  settings, tasks, discover).
- ❌ Any money-path / agent / skill change.

## 3. Current-stack seams (verified — what we reuse)

- **Keyset pagination pattern** — `apps/web/lib/data.ts` `getMediaPage(ownerId, projectId, cursor?, take=60)`:
  cursor `"<createdAt-iso>|<id>"`, `OR: [{createdAt: {lt: at}}, {createdAt: at, id: {lt: id}}]`,
  `orderBy: [{createdAt: "desc"}, {id: "desc"}]`, over-fetch `take + 1` to learn `hasMore`, resolve
  `asset` → `storageKeyToSrc(storageKey(ownerId, contentHash, ext))`, `kind` from a video-ext set.
  Our reader mirrors this but **drops the `threadId: null` filter** (so cowork + manual both show).
- **Helpers** — `storageKey`, `storageKeyToSrc` from `@fikirtive/core`; `requireOwner` from
  `./auth-guard`; `notDeleted = { deletedAt: null }`.
- **`DetailPanel`** — `apps/web/components/asset/DetailPanel.tsx`,
  props `{ generationId, projectId, onClose, entities? }` (G2a). Reused for click-through.
- **`setFavorite(generationId, favorite)`** — `apps/web/lib/asset-actions.ts` (owner-scoped). Reused
  for the card star.
- **View/nav pattern** — `OttoViewKey = "otto"|"stuff"|"memory"|"account"` (`OttoApp.tsx`); `OttoNav`
  `NavItem { key, label, icon }` + `NAV_ITEMS`; `OttoView` if-chain (`if (view==="stuff") return <OttoStuff…/>`).
- **`Generation` model** — `id, ownerId, projectId, shotId, assetId, source, promptText, favorite,
  threadId, createdAt, deletedAt`, `asset{ ownerId, contentHash, ext }`; `kind` derived from `ext`.

## 4. Architecture

### 4.1 Reader — `getGenerationHistory` (new `apps/web/lib/library-actions.ts`, `"use server"`)
```
getGenerationHistory(projectId: string, opts?: {
  search?: string; favoriteOnly?: boolean; cursor?: string | null; take?: number;
}): Promise<{ items: LibraryItem[]; nextCursor: string | null; hasMore: boolean } | { error: string }>
```
- `requireOwner()` → `ownedProject(projectId, ownerId)` (mirror `canvas-actions.ts`'s gate).
- `where = { ownerId, projectId, deletedAt: null, ...(favoriteOnly ? { favorite: true } : {}),
  ...(search ? { promptText: { contains: search, mode: "insensitive" } } : {}), ...cursorWhere }`.
- Same keyset cursor parse/build as `getMediaPage`; `take` defaults 60, over-fetch `take + 1`.
- `LibraryItem = { id: string; url: string; kind: "image" | "video"; prompt: string;
  favorite: boolean; createdAt: string }`. `kind` from a local video-ext set
  (`["mp4","mov","webm","mkv"]`, matching `data.ts`'s `THUMB_VIDEO_EXTS`).

### 4.2 Index (additive)
`packages/db/prisma/schema.prisma` Generation model: `@@index([ownerId, projectId, deletedAt, createdAt, id])`
(named `Generation_library_idx`) — the existing `Generation_media_idx` leads with `threadId`, which
the unified (no-threadId-filter) keyset can't use for ordered paging. Additive, nullable-safe, no backfill.

### 4.3 `<OttoLibrary>` (new `apps/web/components/otto/OttoLibrary.tsx`, client)
- Props `{ projectId, entities }`. State: `items`, `cursor`, `hasMore`, `loading`, `search`,
  `favoriteOnly`, `view: "full" | "compact"`, `detailFor: string | null`.
- On mount and whenever `search`/`favoriteOnly` change (debounced ~300ms), fetch page 1 (reset list).
  "Load more" appends via the `nextCursor`. Search/favorite changes reset the cursor.
- Grid: Full = larger cards (media + prompt + date + ⭐ toggle); Compact = dense thumbnail grid
  (media + ⭐ only). Responsive `auto-fill minmax`, reusing OttoStuff's grid/card styling idiom.
- Click a card → `setDetailFor(id)` → render `<DetailPanel generationId={id} projectId={projectId}
  entities={entities} onClose={() => setDetailFor(null)} />` over the grid.
- ⭐ on a card calls `setFavorite(id, next)` and updates the item locally (optimistic; revert on error).
- Empty state when `items.length === 0 && !loading`.

### 4.4 Nav wiring
- `OttoApp.tsx`: `OttoViewKey` gains `"library"`. Pass `entities` to `OttoView` (already in scope).
- `OttoNav.tsx`: add `{ key: "library", label: "Library", icon: <IconLibrary /> }` to `NAV_ITEMS`
  (new small icon component, matching the others' stroke style).
- `OttoView.tsx`: `if (view === "library") return <OttoLibrary projectId={projectId} entities={entities} />;`

## 5. Money / safety
- **Read-only.** No charge/grant/reserve/settle/`startGen`. The reader only reads; the star reuses the
  existing owner-scoped `setFavorite`; deletes (from `DetailPanel`) reuse existing owner-scoped actions.
- **Owner + project scoped.** `getGenerationHistory` gates `requireOwner` + `ownedProject`; the `where`
  always carries `ownerId` + `projectId`. A non-owner or other project's generations are unreachable —
  search and cursor cannot widen the scope (they only narrow within the gated `where`).

## 6. Testing
- **Unit (`library-actions.test.ts`, prisma mocked):** owner+project gate (non-owner → error; other
  project → "Project not found."); `where` always includes `ownerId`+`projectId`+`deletedAt: null`;
  `favoriteOnly` adds `favorite: true`; `search` adds `promptText: { contains, mode: "insensitive" }`;
  cursor parse builds the `OR` keyset clause; over-fetch `take + 1` sets `hasMore` and `nextCursor`
  is `"<iso>|<id>"` of the last kept row; `kind` resolves video exts → "video" else "image".
- **Build:** full `pnpm -r build` shows `├ ƒ /otto` + `Done`; `tsc` 0 errors.
- **Manual (deployed; mock locally):** open Library → see all gens newest-first → search filters →
  ⭐ toggle filters → Full/Compact switches → Load more pages → click a card opens DetailPanel.

## 7. Open questions
None blocking. If the unified query is hot, the new index covers it; if search over `promptText`
needs ranking later, that's a follow-up (v1 = substring `contains`).
