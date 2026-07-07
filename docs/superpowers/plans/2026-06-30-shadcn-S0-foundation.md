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
- **Tailwind v4 does NOT error on a missing token.** A `@theme inline` that omits a `--color-X` used by a `border-X`/`bg-X` utility produces a silently-wrong render, not a build failure (codex review finding). So token completeness is verified by **reading the utilities the components use + a screenshot**, never by relying on `next build` to catch it.
- **`.gb`-wrap invariant (binding for S1+):** every migrated surface MUST wrap its root in `className="gb"` before any `components/ui` renders — the `@theme inline` utilities resolve to vars (`--background`, `--primary`, `--border`…) that exist ONLY under `.gb` (`globals.css:552`); `layout.tsx` does not apply `.gb`. A shadcn component rendered outside a `.gb` ancestor compiles but renders with unresolved CSS variables.

## Deferred out of S0 (sequenced for safety — recorded so they are not lost)

- **Global root `.gb` flip** (applying `.gb` at `app/layout.tsx`): deferred to **S4 Teardown**. Doing it now would flip the body bg/color/font under the still-Vapor admin pages. Each surface instead wraps its own root in `.gb` as it migrates (the login/billing pattern). The global flip is safe only once all surfaces are shadcn.
- **Deleting `components/studio` + `app/studio`**: deferred to the surface that handles the **Editor** (S2/S3). Finding: `components/Editor.tsx:1365` has `<Link href="/studio?p=${projectId}">`, so studio is not orphaned — it is coupled to the Editor (both legacy Shotstack-era). They are deleted together, after confirming the Editor itself is being retired.

## File Structure

- Modify: `apps/web/components/ui/` (new files from `npx shadcn add`) + `apps/web/package.json` + `pnpm-lock.yaml` (only if the add pulls a new dep, e.g. `sonner`). [Task 1]
- Modify: `apps/web/app/globals.css` (the `@theme inline` block — register the missing `--color-*`). [Task 2]
- Create: `docs/ui-rework/fk-to-gb-token-map.md` — the canonical mapping reference (color + non-color). [Task 3]

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
Expected: 9 new files in `components/ui/`. The 9 names do NOT collide with the 5 customized files (`button/card/input/dialog/badge`), so `--yes` only writes new files. **Immediately verify the customized files were untouched** (codex finding #6 — `--yes` can't be declined, so prove it instead):
```bash
git diff --stat -- components/ui/button.tsx components/ui/card.tsx components/ui/input.tsx components/ui/dialog.tsx components/ui/badge.tsx
```
This MUST be empty. If ANY of the 5 changed, `git checkout -- <that file>` to restore it (the customizations — e.g. the `brand`/`soft` button variants — must survive). If the CLI couldn't infer config, confirm `apps/web/components.json` exists (it does) and re-run from `apps/web`.

- [ ] **Step 3: Regenerate the lockfile** (only if `package.json` changed — `sonner` is the likely new dep; the rest route through the `radix-ui` umbrella already present).

Run from the repo root:
```bash
cd /Users/winnin/Desktop/fikirtive/.claude/worktrees/gracious-chandrasekhar-72f8c9
git diff --stat -- apps/web/package.json
pnpm install   # regenerates pnpm-lock.yaml if package.json changed
git diff --stat -- pnpm-lock.yaml
```
Expected: if `apps/web/package.json` gained a dep, `pnpm-lock.yaml` is updated. If `package.json` is unchanged, no lockfile change (fine).

- [ ] **Step 4: Typecheck + build** (proves the added components compile + nothing regressed).

Run:
```bash
cd apps/web && npx tsc --noEmit
cd /Users/winnin/Desktop/fikirtive/.claude/worktrees/gracious-chandrasekhar-72f8c9 && pnpm --filter @fikirtive/web build
```
Expected: tsc clean; `next build` exit 0. **Note (codex finding #3):** a clean build does NOT prove the components are correctly themed — tailwind v4 silently ignores a `bg-X`/`border-X` whose `--color-X` is unregistered; it does not error. Token completeness is verified in Task 2 (the `@theme inline` audit), not here. This step only confirms the new files compile and nothing else regressed.

- [ ] **Step 5: Money guard + commit** (must print nothing):
```bash
git status --porcelain -- packages/db/src/credits.ts packages/core/src/spend.ts apps/web/lib/gen-actions.ts apps/web/components/canvas/useCanvasGen.ts
git add apps/web/components/ui apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): add stock shadcn components (avatar/checkbox/tabs/select/switch/textarea/progress/sonner/tooltip) for the migration"
```
(Include `package.json`/`pnpm-lock.yaml` in the add only if they changed.)

---

## Task 2: Complete the `@theme inline` token registrations (codex finding #3)

**Files:**
- Modify: `apps/web/app/globals.css` (the `@theme inline` block only)

**Interfaces:**
- Produces: a complete `@theme inline` so every `--color-X` referenced by a `border-X`/`bg-X`/`text-X` utility in `components/ui/*` (the existing 5 + the 9 added in Task 1) resolves under `.gb`. Foundational: without it, migrated surfaces render borders/accents as silent no-ops.

The current `@theme inline` registers `--color-input`/`--color-ring` but NOT `--color-border` or `--color-accent`, yet `components/ui` already use `border-border` (`card.tsx:14`, `button.tsx:22`) and `bg-accent`/`hover:bg-accent` (button `ghost`/`outline`). Tailwind v4 silently drops a utility whose `--color-*` is unregistered — no build error. Fix it now, before any surface depends on it.

- [ ] **Step 1: Audit** the color utilities the components reference. Run from `apps/web`:
```bash
grep -rhoE "(bg|text|border|ring|from|to|fill|stroke)-(border|input|ring|accent|accent-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|card|card-foreground|popover|popover-foreground|destructive|destructive-foreground|background|foreground|brand|brand-foreground|brand-soft|brand-soft-foreground)\b" components/ui | sort -u
```
For each utility `X-Y`, tailwind v4 needs `--color-Y` in the `@theme inline` block. Compare against that block in `app/globals.css` (it currently lacks at least `--color-border` and `--color-accent`).

- [ ] **Step 2: Add the missing registrations** to the `@theme inline` block in `app/globals.css` (each maps to an already-defined `.gb` var — do NOT invent colors, do NOT touch the `.gb` token VALUES):
```css
  --color-border: var(--border);
  --color-accent: var(--accent);
```
Add any further gap the Step-1 audit surfaced, each mapped to its existing `--<name>` var.

- [ ] **Step 3: Verify visually** (build can't catch this). Build + screenshot the components proof route:
```bash
cd /Users/winnin/Desktop/fikirtive/.claude/worktrees/gracious-chandrasekhar-72f8c9 && pnpm --filter @fikirtive/web build
PORT=3007 pnpm --filter @fikirtive/web dev   # background; wait for ready
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto "http://localhost:3007/kitchensink"; $B wait --networkidle; $B screenshot "/private/tmp/gb-tokens-check.png"; $B console --errors
```
Expected: cards/inputs/buttons on `/kitchensink` (uses `components/ui` under `.gb`) show their borders + accent hovers. Read the PNG to confirm.

- [ ] **Step 4: Commit**
```bash
git add apps/web/app/globals.css
git commit -m "fix(ui): register --color-border/--color-accent (+audit gaps) in @theme inline so shadcn utilities resolve"
```

---

## Task 3: fk → .gb token-mapping reference

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

NOTE the swap (read carefully — this is where coral/ink silently invert): the
otto app's Grok-bright look comes from the `.fk.gb-skin` override block, NOT base
`.fk` (in base `.fk`, `--brand` is slate `--slate-500` and `--accent` is coral —
`otto-theme.css:103`; only `.fk.gb-skin` repaints `--brand` to INK `#0A0A0A` and
keeps `--accent` coral `#EC5828` — `otto-theme.css:289`). Map from the
**`.fk.gb-skin` values** (what users see today): `fk --brand` (ink) → `.gb
--primary` / `bg-primary`; `fk --accent` (CORAL) → `.gb --brand` / **`bg-brand`**.
**Coral is `bg-brand`/`text-brand`, NEVER `bg-accent`** (`.gb --accent` is the neutral
`#ECECEA` hover tint). Putting coral on `bg-accent` is the exact silent-inversion bug.

## Non-color tokens (spacing / type / weight / radius / motion) — needed by S1
The otto components use these fk vars heavily as inline styles (e.g. `padding:
"var(--space-3)"`, `font: "var(--text-sm)"`, `var(--weight-semibold)`,
`var(--radius-control)`, `var(--transition-control)`). They live in `otto-theme.css`,
NOT in `.gb` — so a surface cannot drop `otto-theme.css` until these are translated.
Convert each to a tailwind utility using its REAL px value (read it from
`otto-theme.css` per component; the scale below is the convention, confirm the px):
| fk var family | example | tailwind utility |
|---|---|---|
| `--space-N` (4px scale: 1=4 2=8 3=12 4=16 5=20 6=24 8=32) | `padding: var(--space-3)` | `p-3` / `px-3` / `gap-3` / `m-3` (match the px) |
| `--text-xs/sm/base/lg/xl/2xl/4xl` | `font-size: var(--text-sm)` | `text-xs` … `text-4xl` (match the px) |
| `--weight-medium/semibold/bold` | `var(--weight-semibold)` | `font-medium` / `font-semibold` / `font-bold` |
| `--radius-control/card/modal` (14/18/24) | `var(--radius-control)` | `rounded-lg` / `rounded-[var(--radius-card)]` / `rounded-[var(--radius-modal)]` (the `.gb` radius vars exist) |
| `--dur-fast` / `--ease-out` / `--transition-control` | `transition: var(--transition-control)` | `transition` + `duration-150` + `ease-out` |
| `--font-display` / `--font-body` | `font-family: var(--font-display)` | `.gb` uses Geist via `font-geist` (already on `<html>`); drop the per-element font var |

If a fk var has no clean tailwind equivalent, use an arbitrary value bound to the
EXISTING `.gb` var (`p-[var(--space-3)]`) rather than inventing a number — but prefer
the named scale.

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

**Spec coverage** (migration strategy, S0 bullet + codex review fixes):
- `npx shadcn add` stock components → Task 1 ✓ (with the 5-customized-files-unchanged verification — codex #6).
- Complete `@theme inline` registrations (`--color-border`/`--color-accent` + audit) → **Task 2 ✓ (codex #3 — was missing entirely).**
- fk → .gb token-mapping reference, **color + non-color** (space/text/weight/radius/motion) → Task 3 ✓ (codex #5 — non-color was missing; coral=`bg-brand`-not-`bg-accent` made explicit, codex #4).
- Apply `.gb` at root → **deferred to S4 teardown** (the `.gb`-wrap-per-surface invariant in Global Constraints covers the interim — codex #2) ✓.
- Delete studio → **deferred to S2/S3** (Editor links to /studio; delete the legacy pair together) ✓.

**Codex findings addressed:** #2 (`.gb`-wrap invariant → Global Constraints), #3 (missing `@theme` tokens → new Task 2; false "build catches it" claim corrected in Task 1 Step 4), #4 (coral/ink inversion → Task 3 note maps from `.fk.gb-skin`, coral=`bg-brand`), #5 (non-color token map → Task 3), #6 (`--yes` overwrite → Task 1 Step 2 verify). #1 (billing/BuyPackButton uses fk) + #8 (S4 must tear down the Vapor body + ambient-layer) are **strategy-level** → fixed in the strategy spec, out of S0's scope.

**Placeholder scan:** none. Conditionals (Task 1 "restore if a customized file changed"; Task 2 "add any further gap the audit surfaced") are concrete bounded instructions, not TODOs.

**Type consistency:** S0 produces no new types — shadcn component files (standard API) + a globals.css `@theme` addition + a doc. The component names in the Task 3 map match the Task 1 add list.

**Additive guarantee:** Task 1 (5 files unchanged + build green) + Task 2 (only `@theme inline` registration added, `.gb` values untouched, verified by screenshot) change no existing visual output. No surface is migrated in S0; the next plan (S1a nav) is the first real conversion.
