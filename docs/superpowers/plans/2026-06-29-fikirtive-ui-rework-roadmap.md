# FIKIRTIVE UI Rework — Master Roadmap

> **For agentic workers:** This is a phased ROADMAP, not a single task plan. Phase 0 below is
> detailed and executable now. Phases 1–5 are scoped; each gets its own detailed
> `superpowers:writing-plans` document (TDD, task-by-task) at the time it's built.

**Goal:** Re-skin the entire live FIKIRTIVE app onto the new **Grok-bright** design system, one surface
at a time (strangler), starting from the activation funnel — without ever changing money logic.

**Architecture:** The Grok-bright system already lives in claude.ai/design project `0abf8563` (theme
`globals.css`, Geist, OTTO, customized shadcn components). We merge it into `apps/web` additively
(new CSS-var names coexist with the legacy "Vapor" `--bg-0` vars), then replace screens one by one,
each behind the existing route, so the live app keeps working the whole way.

**Tech Stack:** Next.js (this repo's fork) · Tailwind v4 · shadcn/ui (new-york, Radix) · Geist +
JetBrains Mono via `next/font` · lucide-react.

## Global Constraints (every phase obeys these)

- **Money path is untouchable.** Re-skins may change what credit numbers/copy are *shown*; they MUST
  NOT change reserve/settle/charge logic, the `genRequest` gate, `startGen`, idempotency, or the fal
  provider call. Money fixes = display/copy only. (Standing founder rule.)
- **Strangler, never big-bang.** One surface per phase; the rest of the live app is untouched. Ship
  risky surfaces behind a flag; keep the old screen until the new one is verified.
- **One system.** All new UI uses the Grok-bright tokens + Geist + shadcn from project `0abf8563`.
  Coral = OTTO only; semantic colour = state only; wins bloom. (See `design-rules.md` there.)
- **Founder approves each screen's hi-fi before build.** The core flow (Phase 2) gets one real-merchant
  usability test before it's considered done.
- **Every state, every screen:** loading (skeletons), empty, error, success. AA contrast. Sentence
  case. No em-dashes in UI copy.

---

## Sequence at a glance (ordered by activation funnel + risk)

| Phase | Surface | Why this order | Risk |
|---|---|---|---|
| **0** | Foundation (install the system) | Hard prerequisite for everything | Low |
| **1** | Front door — sign-in + first-run/onboarding | First impression; sets the tone | Low |
| **2** | ⭐ Core make-an-ad loop — home → describe → plan card → generating → result | The activation heart; fixes the audit's #1 trust problems | High (money-display) |
| **3** | Manage — My Stuff · Brand Memory · Account/Billing | Calm destinations; fixes `/billing` bug fully | Med |
| **4** | Creative surfaces — per-asset editor / storyboard / library | Heavier tools; build on Phase 2 patterns | Med |
| **5** | Admin / operator console (founder-only) | Self-contained, data-dense (shadcn Table) | Med |

Per-phase rhythm: **design hi-fi → founder approves → build (strangler) → design QA → ship behind flag → measure → iterate.**

---

## Phase 0 — Foundation (detailed; executable now)

**Deliverable:** the Grok-bright system is installed in `apps/web` and renders on a throwaway
kitchensink route, the existing app is visually unchanged, and the broken `/billing` theme is fixed as
the first real proof screen.

**Files:**
- Create: `apps/web/lib/utils.ts` (the `cn()` helper) — if not already present.
- Create: `apps/web/hooks/use-mobile.ts`.
- Create: `apps/web/components/ui/*` (the customized 5 now; `npx shadcn add` others as needed).
- Create: `apps/web/components/otto-mark/*` (OTTO svgs from project `0abf8563`, `assets/otto*.svg`).
- Create: `apps/web/components.json` (shadcn config).
- Modify: `apps/web/app/globals.css` (append the Grok-bright `:root`/`@theme` block — new var names,
  coexists with the legacy Vapor vars; nothing existing references the new names yet).
- Modify: `apps/web/app/layout.tsx` (load Geist + JetBrains Mono via `next/font/google`).
- Modify: `apps/web/app/billing/page.tsx` (the proof screen — see Step 6).
- Create: `apps/web/app/_kitchensink/page.tsx` (throwaway: renders themed Button/Badge/Card/Input/Dialog + OTTO).

- [ ] **Step 1 — Install deps.** Run:
  `pnpm --filter web add radix-ui class-variance-authority clsx tailwind-merge` (add `cmdk react-hook-form @hookform/resolvers zod sonner vaul next-themes recharts` later, per component need). `lucide-react` is already in.
  Verify: `pnpm --filter web install` completes; lockfile updates.

- [ ] **Step 2 — Bring in the system files.** Copy from project `0abf8563`: `shadcn/lib/utils.ts` →
  `apps/web/lib/utils.ts`, `shadcn/hooks/use-mobile.ts` → `apps/web/hooks/use-mobile.ts`,
  `shadcn/components.json` → `apps/web/components.json`, the 5 customized `shadcn/ui/*.tsx` →
  `apps/web/components/ui/`, `assets/otto*.svg` → `apps/web/components/otto-mark/`.
  Verify: imports `@/lib/utils`, `@/components/ui/button` resolve (`pnpm --filter web typecheck`).

- [ ] **Step 3 — Merge the theme.** Append project `0abf8563`'s `shadcn/theme/globals.css` token blocks
  (`:root`, `.dark`, `@theme inline`, the Geist `@import` can be dropped in favour of next/font) into
  `apps/web/app/globals.css`, BELOW the existing Vapor tokens. The new var names (`--background`,
  `--primary`, `--brand`, …) don't collide with Vapor's (`--bg-0`, `--accent`, …).
  Verify: app still builds and the existing `/otto`, `/studio` screens look unchanged (new vars unused yet).

- [ ] **Step 4 — Fonts.** In `apps/web/app/layout.tsx`, load `Geist` and `JetBrains_Mono` via
  `next/font/google`, expose as CSS vars (`--font-sans`, `--font-mono`) on `<html>`.
  Verify: a `font-sans` element renders in Geist.

- [ ] **Step 5 — Kitchensink proof.** Create `apps/web/app/_kitchensink/page.tsx` wrapping content in a
  `className` that applies the new tokens; render Button (default/brand/soft), Badge (semantic),
  Card, Input, Dialog, and the OTTO mark. Run the app, open `/_kitchensink`.
  Verify (screenshot): ink primary button, coral `brand` button, semantic badges, Geist type, OTTO cloud.

- [ ] **Step 6 — Fix `/billing` as the first real screen.** `apps/web/app/billing/page.tsx` currently
  uses `--text-strong`/`--brand`/`--surface-card` (old FK names) with NO theme wrapper, so it renders
  unstyled. Rebuild it on the new system (Grok-bright tokens + shadcn). Keep `createTopupCheckout` →
  Stripe redirect (`success_url`/`cancel_url=/billing?status=`) exactly as-is (money path untouched).
  Verify: `/billing` renders correctly themed; the top-up button still hits Stripe.

- [ ] **Step 7 — Commit.** `git add -A && git commit -m "feat(ui): install Grok-bright design system foundation + fix /billing theme"`

**Phase 0 done when:** `/_kitchensink` renders the themed components + OTTO, `pnpm --filter web build`
passes, existing screens are visually unchanged, and `/billing` is fixed (Stripe flow intact).

---

## Phase 1 — Front door (scoped; detailed plan at build time)

**Screens:** Sign-in (the approved split layout: social-proof left + magic-link form right) ·
First-run/onboarding (OTTO greets + plain-language goal tiles = the empty-state home).
**Wired to:** Better Auth magic-link (confirm if Google/password are actually enabled; show only what's live).
**Ship:** low risk; can go straight in (no flag) once approved.
**Done when:** a new merchant signs in and lands on a warm, on-brand first-run that points at the first action.

**Follow-up — dedicated password-reset flow (founder-requested 2026-06-29, TODO):** today the
"Forgot?" link on `/login` sends a magic link (the passwordless way back in). Build a proper reset
flow — Better Auth `requestPasswordReset` → emailed reset link → a `/reset-password` page that sets
a new password — and point "Forgot?" at it. Not built yet; tracked here so it isn't lost.

## Phase 2 — ⭐ Core make-an-ad loop (the activation heart)

**Screens:** Home (returning state) · the describe/chat surface · **the plan card (spend gate)** ·
generating state (honest status: queued → generating, ETA, "N credits on hold") · **result/payoff**
(OTTO celebrating + the bloom + suggestion buttons).
**Fixes (display/copy only):** the audit's #1 trust problems — quote = real charge in credits,
no false "nothing is charged" claims, authoritative plan-card state (no revert-to-pay-button),
honest failure + safe retry, quote-vs-actual reconciliation. **No charge-logic changes.**
**Test:** one real-merchant usability test on this flow before it's "done."
**Ship:** behind a flag; this is the highest-value + highest-care surface.
**Done when:** a merchant goes describe → approve → result, always knowing what they'll pay and what happened.

## Phase 3 — Manage surfaces

**Screens:** My Stuff (type grouping + search/sort + rename/delete) · Brand Memory · Account
(calm balance + honest receipt). `/billing` already done in Phase 0.
**Ship:** medium risk; per-screen.

## Phase 4 — Creative surfaces

**Screens:** per-asset detail/editor, storyboard, library — the heavier creative tools, re-skinned on
the Phase 2 patterns. Coupled to the legacy Vapor system today (highest migration cost).
**Ship:** per-surface, behind flags.

## Phase 5 — Admin / operator console (founder-only)

**Screens:** the 14 admin surfaces (audit, tenants, credits, cost, system, …) on shadcn Table +
data-density patterns. Self-contained; doesn't touch merchant UX.
**Ship:** straightforward (founder-only, no merchant risk).

---

## Success criteria (the whole rework)

A new merchant moves **sign-in → first ad** through a single, coherent, world-class experience: it
looks premium and trustworthy (Grok-clean), OTTO is present and warm throughout, **money never
surprises**, and every state is designed. The live app keeps working the entire migration, and the
money path is never touched.
