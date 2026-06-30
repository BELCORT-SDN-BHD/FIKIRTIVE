# shadcn Migration — S0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the additive, zero-visual-risk foundation for the full shadcn migration — bring the stock shadcn components the app's surfaces will need into `components/ui` (auto-themed from the existing `.gb` tokens), and author the canonical fk → `.gb` token-mapping reference every later surface plan cites.

**Architecture:** Purely additive. `npx shadcn add` writes new component files to `components/ui/` that render only inside a `.gb` ancestor (so nothing changes visually until a surface adopts them). The token map is documentation. No existing component, route, or style is modified; no surface is migrated yet.

**Tech Stack:** shadcn (`new-york`, configured in `apps/web/components.json`), tailwind v4 (`@theme inline` in `globals.css`), the `radix-ui` umbrella package (already a dependency), `lucide-react`, pnpm@10 workspace.

## Global Constraints (from `docs/superpowers/specs/2026-06-30-full-shadcn-migration-strategy.md`)

- **Design is LOCKED — Grok-bright.** coral `#EC5828` = OTTO/agent ONLY; semantic palette for STATE only; Geist font. This is conversion, not redesign. The `.gb` tokens already encode this (`--brand` = coral, `--primary` = ink).
- **MONEY PATH UNTOUCHED.** S0 touches no money files (it only adds UI primitives + a doc). Money guard must stay clean.
- **Additive only.** S0 must not change any existing component, route, page, or visual output. `next build` and the otto/login/billing surfaces look identical before and after.
- **Lockfile discipline** ([[fikirtive-monorepo-deploy-gotchas]]): any `package.json` dependency change MUST be followed by a `pnpm install` that regenerates `pnpm-lock.yaml`, or clean Docker/worker builds break (`ERR_PNPM_OUTDATED_LOCKFILE`).

## Deferred out of S0 (sequenced for safety — recorded so they are not lost)

- **Global root `.gb` flip** (applying `.gb` at `app/layout.tsx`): deferred to **S4 Teardown**. Doing it now would flip the body bg/color/font under the still-Vapor admin pages. Each surface instead wraps its own root in `.gb` as it migrates (the login/billing pattern). The global flip is safe only once all surfaces are shadcn.
- **Deleting `components/studio` + `app/studio`**: deferred to the surface that handles the **Editor** (S2/S3). Finding: `components/Editor.tsx:1365` has `<Link href="/studio?p=${projectId}">`, so studio is not orphaned — it is coupled to the Editor (both legacy Shotstack-era). They are deleted together, after confirming the Editor itself is being retired.

## File Structure

- Modify: `apps/web/components/ui/` (new files from `npx shadcn add`) + `apps/web/package.json` + `pnpm-lock.yaml` (only if the add pulls a new dep, e.g. `sonner`).
- Create: `docs/ui-rework/fk-to-gb-token-map.md` — the canonical mapping reference.

---

## Task 1: Add the stock shadcn components

**Files:**
- Modify/Create: `apps/web/components/ui/{avatar,checkbox,tabs,select,switch,textarea,progress,sonner,tooltip}.tsx` (written by the CLI)
- Modify (only if new deps pulled): `apps/web/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: shadcn `Avatar`, `Checkbox`, `Tabs`, `Select`, `Switch`, `Textarea`, `Progress`, `Toaster`/`toast` (sonner), `Tooltip` in `@/components/ui/*`, auto-themed from the `.gb` token block. These are the shadcn equivalents of the fk primitives later surfaces will swap to. (`Badge`, `Button`, `Card`, `Dialog`, `Input` already exist in `components/ui`. `IconButton` → use `Button` `size="icon"`. `OttoAvatar` stays a custom component re-skinned later on shadcn `Avatar`.)

- [ ] **Step 1: Record the pre-state** so the additive guarantee is verifiable.

Run: `cd apps/web && ls components/ui && git rev-parse HEAD`
Note the current `components/ui` contents (badge, button, card, dialog, input) and the HEAD sha.

- [ ] **Step 2: Add the components** (non-interactive; they theme from `globals.css` `.gb`).

Run from `apps/web`:
```bash
npx shadcn@latest add avatar checkbox tabs select switch textarea progress sonner tooltip --yes
```
Expected: new files in `components/ui/`. If the CLI reports it could not infer config, confirm `apps/web/components.json` exists (it does) and re-run from `apps/web`. Do NOT let it overwrite the existing `button/card/input/dialog/badge` (those are FIKIRTIVE-customized) — if prompted about an existing file, decline that file; the 9 names above are all new.

- [ ] **Step 3: Regenerate the lockfile** (only if `package.json` changed — `sonner` is the likely new dep; the rest route through the `radix-ui` umbrella already present).

Run from the repo root:
```bash
cd /Users/winnin/Desktop/artlio/.claude/worktrees/gracious-chandrasekhar-72f8c9
git diff --stat -- apps/web/package.json
pnpm install   # regenerates pnpm-lock.yaml if package.json changed
git diff --stat -- pnpm-lock.yaml
```
Expected: if `apps/web/package.json` gained a dep, `pnpm-lock.yaml` is updated. If `package.json` is unchanged, no lockfile change (fine).

- [ ] **Step 4: Typecheck + build** (proves the added components compile + nothing regressed).

Run:
```bash
cd apps/web && npx tsc --noEmit
cd /Users/winnin/Desktop/artlio/.claude/worktrees/gracious-chandrasekhar-72f8c9 && pnpm --filter @fikirtive/web build
```
Expected: tsc clean; `next build` exit 0. If a newly added component references a token the `@theme inline` block doesn't register (e.g. a `--color-sidebar`/`--color-chart-*` used by some shadcn components), the build surfaces it — add the missing `--color-*: var(--…)` line to the `@theme inline` block in `app/globals.css` mapping it to the nearest existing `.gb` token (do NOT invent new colors; reuse existing ones). Re-run the build.

- [ ] **Step 5: Money guard + commit** (must print nothing):
```bash
git status --porcelain -- packages/db/src/credits.ts packages/core/src/spend.ts apps/web/lib/gen-actions.ts apps/web/components/canvas/useCanvasGen.ts
git add apps/web/components/ui apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): add stock shadcn components (avatar/checkbox/tabs/select/switch/textarea/progress/sonner/tooltip) for the migration"
```
(Include `package.json`/`pnpm-lock.yaml` in the add only if they changed.)

---

## Task 2: fk → .gb token-mapping reference

**Files:**
- Create: `docs/ui-rework/fk-to-gb-token-map.md`

**Interfaces:**
- Produces: the canonical mapping every surface plan cites when converting `style={{ color: "var(--text-muted)" }}` / `cv-*` CSS / fk components to shadcn `components/ui` + tailwind `.gb` classes. Pure documentation; no code.

- [ ] **Step 1: Author the map.** Create `docs/ui-rework/fk-to-gb-token-map.md`:

```markdown
# fk → .gb (shadcn) token + component map

The migration converts the otto/admin surfaces off the `fk` system
(`components/fk` + `.fk`/`.fk.gb-skin` tokens in `app/otto/otto-theme.css`,
consumed as inline `style={{var(--token)}}`) onto shadcn `components/ui` + the
`.gb` token block in `app/globals.css` (tailwind v4 utilities like `bg-primary`,
`text-muted-foreground`). Coral stays OTTO/agent-only.

## Tokens (fk value → .gb token / tailwind utility)
| fk token (`.fk` / `.fk.gb-skin`) | value | .gb token | tailwind utility |
|---|---|---|---|
| `--bg-page` | `#FCFCFC` | `--background` | `bg-background` |
| `--surface-card` / `--surface-raised` | `#FFFFFF` | `--card` | `bg-card` |
| `--surface-sunken` | `#F4F4F3` | `--secondary` / `--muted` | `bg-secondary` / `bg-muted` |
| `--brand` (ink) | `#0A0A0A` | `--primary` | `bg-primary` / `text-primary` |
| `--brand-press` | `#000000` | (primary, `active:` darken) | `active:bg-primary` |
| `--brand-tint` | `#F4F4F3` | `--accent` | `bg-accent` |
| `--accent` (CORAL — OTTO only) | `#EC5828` | `--brand` | `bg-brand` / `text-brand` |
| `--accent-soft` | `#FBE4D8` | `--brand-soft` | `bg-brand-soft` |
| `--text-strong` | `#0A0A0A` | `--foreground` | `text-foreground` |
| `--text-body` | `#1A1A18` | `--foreground` | `text-foreground` |
| `--text-muted` | `#6E6E68` | `--muted-foreground` | `text-muted-foreground` |
| `--text-faint` | `#9A9A98` | `--muted-foreground` (lighter) | `text-muted-foreground/70` |
| `--border-subtle` | `#EFEFED` | `--border` | `border-border` |
| `--border-default` | `#E6E6E3` | `--border` | `border-border` |
| `--border-strong` | `#D8D7D1` | `--border` (darker) | `border-border` |
| success / warning / error / info | — | `--success` / `--warning` / `--error` / `--info` (+ `-soft`) | `bg-success-soft text-success-soft-foreground` etc. |
| radius (controls / cards / modals) | 14 / 18 / 24 | `--radius` / `--radius-card` / `--radius-modal` | `rounded-lg` / `rounded-[var(--radius-card)]` |

NOTE the swap: in `fk`, `--brand` is INK and `--accent` is coral. In `.gb`,
`--primary` is INK and `--brand` is coral. So `fk --brand` → `.gb --primary`,
and `fk --accent` → `.gb --brand`. Keep coral OTTO-only.

## Components (fk → shadcn `components/ui`)
| fk (`@/components/fk`) | shadcn (`@/components/ui`) |
|---|---|
| `Button` | `button` (variants: `default`=ink, `brand`=coral, `soft`, `secondary`, `outline`, `ghost`, `destructive`, `link`) |
| `IconButton` | `button` with `size="icon"` + `variant="ghost"` |
| `Card` | `card` (`Card`/`CardHeader`/`CardContent`/...) |
| `Input` | `input` · `Textarea` → `textarea` · `Select` → `select` · `Checkbox` → `checkbox` · `Switch` → `switch` |
| `Badge` | `badge` · `Tabs` → `tabs` · `Tooltip` → `tooltip` · `ProgressBar` → `progress` |
| `Toast` | `sonner` (`<Toaster />` + `toast(...)`) |
| `Avatar` | `avatar` · `OttoAvatar` → custom component built on shadcn `avatar` (OTTO coral cloud) |

## Conversion rules
- Wrap each migrated surface's root in `className="gb"` (until S4 teardown applies it globally).
- Replace inline `style={{var(--fk-token)}}` with tailwind `.gb` utilities per the table.
- Replace `cv-*` / `al-*` CSS rules with tailwind classes; delete the rule from `otto-theme.css` once its last user is gone.
- coral (`bg-brand`/`text-brand`) ONLY on OTTO/agent elements.
- Delete an `@/components/fk/X` import + the fk file once `grep -rl "@/components/fk/X"` is empty.
```

- [ ] **Step 2: Commit**
```bash
git add docs/ui-rework/fk-to-gb-token-map.md
git commit -m "docs(ui): fk → .gb token + component mapping reference for the shadcn migration"
```

---

## Self-Review

**Spec coverage** (migration strategy, S0 bullet):
- `npx shadcn add` stock components → Task 1 ✓.
- fk → .gb token-mapping reference → Task 2 ✓.
- Apply `.gb` at root → **deferred to S4 teardown** (documented above with rationale — flipping the body under still-Vapor admin pages is the risk) ✓.
- Delete studio → **deferred to S2/S3** (documented: Editor links to /studio; delete the legacy pair together) ✓.

**Placeholder scan:** none. The only conditional is "add the missing `--color-*` line if the build surfaces one" (Task 1 Step 4) — that is a concrete, bounded instruction (reuse an existing `.gb` token), not a TODO.

**Type consistency:** S0 produces no new types — it adds shadcn component files (standard shadcn API) + a doc. The component names in the token map (Task 2) match the `npx shadcn add` list (Task 1).

**Additive guarantee:** Task 1 Steps 1 + 4 verify nothing existing changed (pre-state recorded; build green). No surface is migrated in S0; the next plan (S1a nav) is the first real conversion.
