# Design spec — G5c · Discover = Inspiration Gallery (G5 item 32)

Date: 2026-06-28
Status: approved by founder (design); autonomous build, batch-review at the end.
Branch: `claude/otto-g5c-discover` (off `claude/otto-g5b-templates`). Grounded in the G1→G5b stack.

## 1. What this is (and why it's NOT Grok's Discover)

Grok's "Discover" is a feed of **other users'** creations. Otto is a **single-operator** tool with hard
tenant isolation — a user cannot be shown another org's generations, and there is no public/community/
publish system. So Discover for Otto is reinterpreted (founder-approved) as a **static Inspiration
Gallery**: a BELCORT-authored set of ad ideas / prompt recipes. Click an idea → see its prompt → **Use
in Otto** (pre-fills the Otto front-door composer and drops you there) or **Copy prompt**.

Discover carries **no user data**, runs **no generation**, and **spends nothing**. The only money is
the user's eventual send inside Otto, which goes through the existing gate unchanged.

Founder decisions (brainstorming):
- **Static built-in catalog** (no DB, no user content, no community feed).
- **Text-only idea cards in v1** (title + one-line description + prompt) — no example images (those
  can't be user data; curated static images are a later follow-up).
- **"Use in Otto" pre-fills the front-door composer** (matches "预填输入框去做你自己的版本").

## 2. Scope (G5c)

1. **Inspiration catalog + pure helper** — `apps/web/lib/inspirations.ts`.
2. **`<OttoDiscover>`** — gallery grid → `Dialog` detail with **Use in Otto** + **Copy prompt**.
3. **Front-door seed** — `OttoFrontDoor` gains a `seedText?` prop that pre-fills its composer.
4. **Nav + seed wiring** — `OttoViewKey` += `"discover"`; `OttoNav` item; `OttoView` branch; `OttoApp`
   holds the seed and the "use" handler.

### Out of scope (later / dropped)
- ❌ Community/cross-user feed, publishing, opt-in, moderation (the Grok meaning — breaks isolation).
- ❌ Example images on cards; user-authored inspirations; DB-backed catalog.
- ❌ Any generation/spend inside Discover, any money-path/model/engine change.

## 3. Current-stack seams (verified — what we reuse)

- **`Dialog`** — `apps/web/components/fk/Dialog.tsx`, named export `{ open, onClose, title?, description?, children?, footer? }`.
- **Front-door composer** — `apps/web/components/otto/OttoFrontDoor.tsx`: `const [text, setText] = useState("")`; `<textarea value={text}>`; props `{ projectId, entities, userName, onThreadStarted, ottoStreamEnabled?, onStreamStart? }`. Sending uses the typed `text` (`start({})`). We add a `seedText?: string` prop that sets `text` on change.
- **View/nav pattern** — `OttoViewKey` (`OttoApp.tsx`), `OttoNav` `NAV_ITEMS`, `OttoView` if-chain. `OttoApp` already owns `view`/`setView` and `activeThreadId`/`setActiveThreadId`; the front door renders when `activeThreadId` is null.
- **Clipboard** — `navigator.clipboard.writeText` (used elsewhere, e.g. copy-link in OttoResult).

## 4. Architecture

### 4.1 Catalog + helper — `apps/web/lib/inspirations.ts` (pure, no server/React)
```ts
export type Inspiration = { id: string; category: string; title: string; description: string; prompt: string };
export const INSPIRATIONS: Inspiration[];               // ~9 entries across categories
export function inspirationCategories(list: Inspiration[]): string[]; // unique, in first-seen order
```
Starter categories + ~9 entries (copy is tunable later): Product shots, Festival/Seasonal
(Raya/CNY/Deepavali), Social/UGC, Promotions/Sale, Lifestyle. Each `prompt` is a ready
text-to-image / edit prompt the user can run in Otto.

### 4.2 `<OttoDiscover>` — `apps/web/components/otto/OttoDiscover.tsx` (client)
Props `{ onUseInOtto }` where `onUseInOtto: (prompt: string) => void`.
- A responsive grid of `INSPIRATIONS` cards (category chip + title + description). Optionally a category
  filter row from `inspirationCategories(INSPIRATIONS)` (a simple "All" + per-category toggle).
- Click a card → `Dialog` showing the title/description + the full prompt, with footer buttons:
  - **Use in Otto** → `onUseInOtto(inspiration.prompt)` (parent switches view + seeds the composer), close.
  - **Copy prompt** → `navigator.clipboard.writeText(prompt)` (best-effort; brief "Copied" feedback).
- Header copy: "Ideas to start from — pick one, tweak it, make it yours."

### 4.3 Front-door seed — `OttoFrontDoor`
Add `seedText?: string` to props; `useEffect(() => { if (seedText) setText(seedText); }, [seedText])`
so arriving with a seed pre-fills the composer (the user reviews/edits, then sends — no auto-send).

### 4.4 Nav + seed wiring
- `OttoApp.tsx`: `OttoViewKey` += `"discover"` (after `"templates"`). New state `const [seedText, setSeedText] = useState<string>("")`. Handler `handleUseInOtto = (p: string) => { setSeedText(p); setActiveThreadId(null); setView("otto"); }`. Pass `seedText` + `onUseInOtto={handleUseInOtto}` to `OttoView`.
- `OttoNav.tsx`: an `IconCompass` (small SVG) + `{ key: "discover", label: "Discover", icon: <IconCompass /> }` after the `templates` entry.
- `OttoView.tsx`: new props `seedText?: string` + `onUseInOtto: (p: string) => void`. Branch `if (view === "discover") return <…><OttoDiscover onUseInOtto={onUseInOtto} /></…>;`. Pass `seedText={seedText}` to the rendered `<OttoFrontDoor>`.

## 5. Money / safety
- **Zero spend, zero generation in Discover.** No `startGen`/charge/grant/reserve anywhere in this
  branch. "Use in Otto" only sets a text string and switches the view; the eventual send happens in
  Otto through the existing gate (unchanged).
- **No user data, no tenant surface.** The catalog is static module data; Discover reads nothing
  owner-scoped and exposes nothing cross-tenant. There is no isolation surface to get wrong.

## 6. Testing
- **Unit (`inspirations.test.ts`):** catalog well-formed — non-empty list; unique `id`s; every entry has
  non-empty `category`/`title`/`description`/`prompt`. `inspirationCategories` returns unique
  categories in first-seen order (e.g. dedups, preserves order).
- **Build:** full `pnpm -r build` shows `├ ƒ /otto` + `Done`; `tsc` 0 errors.
- **Manual:** open Discover → cards render → click → Dialog → Copy prompt copies → Use in Otto lands on
  the Otto front door with the prompt pre-filled and editable.

## 7. Open questions
None blocking. Example images and a richer "send to a template vs the composer" routing are deferred;
v1 seeds the front-door composer for every idea (the most general "go make your own version").
