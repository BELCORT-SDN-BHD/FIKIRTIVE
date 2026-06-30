# shadcn Migration — S1a Nav (OttoNav) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Convert `OttoNav` — the otto sidebar — off the `fk` token system onto shadcn `.gb` (tailwind `.gb` utilities + shadcn `Avatar`), wrapped in its own `.gb` root, with **zero visual change** (a re-skin to the same Grok-bright look). This is the first visible surface and sets the conversion pattern for the epic.

**Architecture:** `OttoNav` uses NO fk *components* — it is custom markup with inline `style={{var(--fk-token)}}` reading fk tokens from `otto-theme.css` (`.fk`/`.fk.gb-skin`). The conversion: (1) wrap the `<nav>` (and its mobile backdrop) root in `className="gb"` so `.gb` tokens + shadcn components resolve in the subtree; (2) replace every fk token with its `.gb`/tailwind equivalent per `docs/ui-rework/fk-to-gb-token-map.md`; (3) adopt shadcn `Avatar` for the user chip; (4) keep ALL logic, props, structure, the mobile drawer, the hover-delete, and the project/thread tree byte-for-byte. Verified by a before/after screenshot that must be visually identical.

**Tech Stack:** shadcn `components/ui` (Avatar added in S0), tailwind v4 `.gb` utilities, the S0 token map. Custom Next.js 16.2.9 fork (read `apps/web/node_modules/next/dist/docs` before Next code).

## Global Constraints (from the migration strategy spec)

- **Zero visual change.** This is a re-skin to the SAME locked Grok-bright look — the nav must look pixel-identical before and after. Success = a before/after screenshot diff shows no meaningful change. This is NOT a redesign.
- **coral = OTTO only.** The OTTO cloud mark + the credit coin use coral (`fk --accent` → `.gb --brand`, i.e. `text-brand`/`fill-[var(--brand)]`). The active nav item uses INK tint (`fk --brand-tint`/`--brand-press` → `.gb` neutral `--accent`/`--primary`, NOT coral). Sentence case, no em-dashes.
- **`.gb`-wrap invariant.** The nav root MUST carry `className="gb"` (the fk shell around it does not provide `.gb` tokens). A `var(--gb-token)` or shadcn component outside a `.gb` ancestor renders unresolved.
- **Tailwind v4 silent-no-op.** A `bg-X`/`border-X` with an unregistered `--color-X` renders nothing, no build error. Verify by SCREENSHOT, never by `next build` alone.
- **MONEY PATH UNTOUCHED.** The nav only DISPLAYS `balanceCredits` (already a prop). Do not touch any spend file. The `creditsLabel` display helper stays. Money guard must be clean.
- **Logic frozen.** Props (`OttoNavProps`), the project/thread grouping, collapse state, rename/delete handlers, the `MOBILE_BP` drawer behavior, `dotFor`, and `handleNavAction` are unchanged. Only styling (and the user-chip markup → shadcn Avatar) changes.

## Token handling (the crux — every fk token the nav uses must be mapped)

Per `docs/ui-rework/fk-to-gb-token-map.md`. The nav uses these fk tokens — convert each:
- **Color:** `--surface-card`→`bg-card`/`var(--card)`; `--brand`(ink, new-campaign btn)→`bg-primary text-primary-foreground`; `--brand-tint`(active bg)→`bg-accent`; `--brand-press`(active text)→`text-foreground`/`text-primary`; `--text-strong`→`text-foreground`; `--text-body`→`text-foreground`; `--text-muted`→`text-muted-foreground`; `--text-faint`→`text-muted-foreground/70`; `--border-subtle`→`border-border`; `--brand-soft`/`--on-brand-soft`(user avatar)→shadcn Avatar fallback; `--accent`(OTTO cloud + credit coin — CORAL)→`var(--brand)`/`text-brand`; `--surface-sunken`(history tiles)→`bg-muted`; status dots (`#f59e0b/#dc2626/#16a34a`) stay literal (semantic).
- **Non-color:** `--space-1..6`→tailwind spacing (`gap-1`/`p-2`/`px-3`/`py-2.5`… — confirm the px values against the fk scale in the token map so spacing is identical); `--text-xs/sm/lg`→`text-xs`/`text-sm`/`text-lg`; `--weight-regular/semibold/bold`→`font-normal`/`font-semibold`/`font-bold`; `--radius-sm/md/circle`→`rounded-md`/`rounded-lg`/`rounded-full`; `--dur-fast/base` + `--ease-out`→`transition-* duration-150`; `--font-sans`→inherit (Geist via `.gb`); `--shadow-brand-sm`→`shadow-[var(--shadow-brand)]` or `shadow-sm`.
- If a non-color fk value has no exact tailwind step, use an arbitrary value (`p-[10px]`) to keep the pixel match — identical-look beats idiomatic-purity.

## File Structure
- Modify: `apps/web/components/otto/OttoNav.tsx` (the conversion).
- Create: `apps/web/app/skin-preview/nav/page.tsx` (dev harness to screenshot the nav unauthenticated — mirrors `skin-preview/account`).

---

## Task 1: Capture the BEFORE baseline

**Files:** none (verification artifact).

- [ ] **Step 1: Screenshot the current nav** so the conversion can be proven identical. The otto shell is auth-walled; the existing `app/skin-preview/page.tsx` renders the real `OttoApp` (incl. `OttoNav`) with mock data. Run the dev server + browse:
```bash
cd /Users/winnin/Desktop/artlio/.claude/worktrees/gracious-chandrasekhar-72f8c9
PORT=3007 pnpm --filter @fikirtive/web dev > /private/tmp/dev-s1a.log 2>&1 &   # wait for ready (poll lsof -ti:3007)
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B viewport 1440x900; $B goto "http://localhost:3007/skin-preview"; $B wait --networkidle; sleep 1
$B screenshot "/private/tmp/nav-BEFORE.png"
```
Read `/private/tmp/nav-BEFORE.png` and note the nav's exact look (logo + fikirtive wordmark, New campaign coral... no — INK button, 6 nav items with the active one tinted, Projects tree, balance line with coral coin, user chip). Keep the dev server running for Task 2's after-shot. Do NOT commit anything in this task.

---

## Task 2: Convert OttoNav to `.gb` + verify identical

**Files:**
- Modify: `apps/web/components/otto/OttoNav.tsx`
- Create: `apps/web/app/skin-preview/nav/page.tsx`

**Interfaces:** consumes shadcn `Avatar` (`@/components/ui/avatar`), the S0 token map. Produces the re-skinned nav (same `OttoNavProps`, same exports).

- [ ] **Step 1: Add the `.gb` wrap.** On the `<nav>` element, add `gb` to the className: `className={\`otto-nav gb${drawerOpen ? " otto-nav--open" : ""}\`}`. Also add `gb` to the mobile backdrop wrapper if it needs `.gb` tokens (it uses a literal rgba — leave it). This makes the nav subtree resolve `.gb` tokens.

- [ ] **Step 2: Convert every fk token** in `OttoNav.tsx`'s inline styles to the `.gb`/tailwind equivalent per the token-handling table above and `docs/ui-rework/fk-to-gb-token-map.md`. Two acceptable styles (pick per call-site for the cleanest identical result):
  - **tailwind classes** on the element (`className="..."`) — preferred for static styling;
  - **inline `var(--gb-token)`** where the value is dynamic (e.g. `background: active ? "var(--accent)" : "transparent"`) — keep inline but swap the token.
  Keep the two inline `<style>` blocks (mobile media query + hover-delete) but swap any fk tokens inside them (`--shadow-xl`→`--shadow-xl` exists in `.gb`; `--surface-hover`→a `.gb` neutral like `var(--accent)`; `--text-default`→`var(--foreground)`). The OTTO cloud (`fill="var(--accent)"`) and the credit coin (`stroke="var(--accent)"`) → `var(--brand)` (coral in `.gb`).

- [ ] **Step 3: Adopt shadcn `Avatar` for the user chip** (the `{initial}` circle at the bottom). Replace the hand-rolled 32px circle div with:
```tsx
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
// ...
<Avatar className="size-8"><AvatarFallback className="bg-brand-soft text-brand-soft-foreground text-sm font-bold">{initial}</AvatarFallback></Avatar>
```
(Keep the name/email block beside it as tailwind-classed text.)

- [ ] **Step 4: Typecheck + build.** `cd apps/web && npx tsc --noEmit` → clean. `cd <root> && pnpm --filter @fikirtive/web build` → exit 0. (Remember: build does NOT prove the tokens resolve — Step 6 does.)

- [ ] **Step 5: Add the nav screenshot harness** `apps/web/app/skin-preview/nav/page.tsx` (mirror `skin-preview/account`; `notFound()` in prod; import `../../otto/otto-theme.css` so the surrounding shell tokens still resolve for the non-nav chrome; render the real `OttoApp` is simplest — but to isolate the nav, reuse `skin-preview/page.tsx`'s full-shell render). Simplest: reuse the existing `/skin-preview` route for the after-shot (it already renders OttoNav via OttoApp) — so this harness is OPTIONAL; if `/skin-preview` shows the nav clearly, skip creating a new harness and screenshot `/skin-preview`.

- [ ] **Step 6: Screenshot AFTER + compare.** With the dev server still up (it hot-reloads), re-screenshot the same route:
```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B viewport 1440x900; $B goto "http://localhost:3007/skin-preview"; $B wait --networkidle; sleep 1
$B screenshot "/private/tmp/nav-AFTER.png"; $B console --errors
lsof -ti:3007 | xargs kill -9   # stop the dev server
```
Read BOTH `/private/tmp/nav-BEFORE.png` and `/private/tmp/nav-AFTER.png`. They MUST look the same: same logo/wordmark, same INK New-campaign button, same 6 nav items with the active tint, same Projects tree + chevrons, same coral credit coin + balance, same user chip (now a shadcn Avatar but visually identical). If anything shifted (spacing, color, a now-invisible border = an unmapped token), fix the token mapping and re-shoot. No console errors. Copy `/private/tmp/nav-AFTER.png` to `~/Desktop/fikirtive-s1a-nav.png` for founder review.

- [ ] **Step 7: Money guard + commit** (must print nothing):
```bash
git status --porcelain -- packages/db/src/credits.ts packages/core/src/spend.ts apps/web/lib/gen-actions.ts apps/web/components/canvas/useCanvasGen.ts
git add apps/web/components/otto/OttoNav.tsx apps/web/app/skin-preview/nav/page.tsx
git commit -m "refactor(ui): migrate OttoNav off fk tokens onto shadcn .gb (S1a; zero visual change)"
```
(Include the harness file only if you created one.)

---

## Self-Review

**Spec coverage** (migration strategy, S1a):
- Nav off fk tokens onto `.gb`/tailwind + `.gb` wrap → Task 2 Steps 1-2 ✓.
- shadcn primitive adoption where it fits (user chip → `Avatar`) → Task 2 Step 3 ✓.
- Zero visual change, verified by before/after screenshot → Tasks 1 + 2 Step 6 ✓.
- coral = OTTO only (cloud + coin coral; active item ink) → Step 2 ✓.
- Logic/props frozen; money path display-only → Global Constraints ✓.

**Note on `fk` deletion:** OttoNav uses fk *tokens*, not fk *components*, so no `@/components/fk/*` import is removed here. The fk token CSS (`otto-theme.css`) stays until S1b-d also migrate (strangler) — do NOT delete it in S1a.

**Placeholder scan:** the only conditional is "fix the token mapping and re-shoot if the after-shot drifts" (Step 6) — concrete (map the offending fk token per the S0 table), not a TODO.

**Pattern-setting:** S1a establishes the per-surface recipe — `.gb` wrap → token re-point (color + non-color) per the map → shadcn primitives where clean → before/after-identical screenshot → money guard. S1b (views) reuses it.

**Open item for the implementer:** the otto shell renders `OttoNav` inside `OttoApp`'s `className="fk gb-skin"`. Adding `gb` to the nav makes it a `.gb` island inside that shell — verify the nav's tokens now come from `.gb` (the nearest ancestor with the token) and that the fk shell around it is visually unaffected (it is — `.gb` on the nav only scopes the nav subtree).
