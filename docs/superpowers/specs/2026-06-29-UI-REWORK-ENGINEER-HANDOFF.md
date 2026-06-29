# FIKIRTIVE UI Rework — Engineer Handoff

**Date:** 2026-06-29
**For:** the engineer taking over the build phase (same machine)
**Status:** Design phase **done**. Foundation (Phase 0) **committed**. Next = build the screens.

---

## 1. What this is

We redesigned the **entire FIKIRTIVE app** onto a new design system ("Grok-bright"). This is a **visual + experience rebuild, not new features** — the product features already exist. Your job: implement the locked designs in code, **one surface at a time (strangler)**, keeping the live app working the whole way.

The design language, OTTO mascot, and 9 hi-fi screens are **locked and approved**. Phase 0 (the design-system foundation) is already installed and committed. You are building Phases 1–5 against those mockups.

---

## 2. Where everything lives

| Thing | Location |
|---|---|
| **Hi-fi mockups (HTML)** | `docs/ui-rework-mockups/*.html` ← in this repo, open in a browser |
| **Mockups (PNG)** | `~/Desktop/fikirtive-*.png` |
| **Design system (interactive + tokens + OTTO + components)** | claude.ai/design → project **`0abf8563-147b-494a-8364-1b199c775b7d`** ("FIKIRTIVE — Grok-bright"). Screens are under `ui_kits/canvas/` and `ui_kits/app/`. Theme = `shadcn/theme/globals.css`. |
| **Roadmap (phases + constraints)** | `docs/superpowers/plans/2026-06-29-fikirtive-ui-rework-roadmap.md` |
| **This worktree (where Phase 0 lives)** | `…/.claude/worktrees/gracious-chandrasekhar-72f8c9` on branch `claude/gracious-chandrasekhar-72f8c9` |
| **Main checkout (has in-flight WIP — see §6)** | `/Users/winnin/Desktop/artlio` on `main` |

> **None of the new UI is live in the running app yet.** Production (Railway, from `main`) still runs the old dark "Vapor" UI. Phase 0 is committed only to this worktree branch, **not pushed, not merged, not deployed.**

---

## 3. Quick start (run the app)

Monorepo: pnpm workspace, **pnpm@10.0.0, node >=22**, custom Next.js **16.2.9** / React 19.2.4. No turbo — plain `pnpm -r` scripts.

From the repo root of this worktree:

```bash
pnpm install                       # native build-script gating is whitelisted in package.json
pnpm --filter "./packages/*" build # MUST run first — builds @fikirtive/* libs + `prisma generate`.
                                   # Skip this and apps/web type-checking cascades into errors.
pnpm --filter @fikirtive/web dev   # web only, on http://localhost:3000
```

- `pnpm dev` (root) also starts `apps/worker` (pg-boss). Use the `--filter @fikirtive/web` form to run only the UI.
- **Env is already present** in this worktree: `apps/web/.env.local` + `packages/db/.env` (auth / Stripe / Meta / `DATABASE_URL`). If ever missing, copy from the main checkout (`/Users/winnin/Desktop/artlio/apps/web/.env.local`, `…/packages/db/.env`).
- ⚠️ **Custom Next.js.** `apps/web/AGENTS.md`: *"This is NOT the Next.js you know … read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* (e.g. route `searchParams` is a Promise you must await — see `billing/page.tsx:21-24`.) Docs exist only after `pnpm install`.

---

## 4. How the design system works (build a new screen)

Phase 0 (commit `5b3789d`) installed **Grok-bright as a shadcn system scoped to a `.gb` class**, coexisting with the legacy Vapor system in one `globals.css` (strangler — new tokens never override `:root`).

**To build a screen so it picks up the theme:**

1. **Wrap the screen's root in `className="gb"`.** That's the contract. `globals.css:552-598` defines the `.gb` tokens (background, foreground, `--primary`, `--brand` = coral `#EC5828`, card, semantic state, radii, shadows, `font-family: var(--font-geist)`). `layout.tsx` does **not** apply `.gb` globally — it only puts font vars on `<html>`. Forget the wrapper → your screen silently renders with Vapor/dark tokens. (Reference: `kitchensink/page.tsx:12`, `billing/page.tsx:29` both do `<div className="gb">`.)
2. **Fonts** are wired in `layout.tsx`: Geist → `--font-geist` (the `.gb` sans), Hanken_Grotesk → `--font-body` (legacy), Geist_Mono → `--font-meta` (legacy).
3. **Components:** only **5** shadcn components exist locally — `components/ui/{badge,button,card,dialog,input}.tsx`. Add any others with `npx shadcn add <name>` (config: new-york, neutral, `cssVariables`, `app/globals.css`). They auto-theme from `.gb`.
4. **Slot gotcha:** this repo uses the unified umbrella package `radix-ui` (not `@radix-ui/react-slot`). `Slot` is a **namespace** → use `Slot.Root` for `asChild` (see `button.tsx:48`, `badge.tsx:34`). Old shadcn snippets doing `import { Slot } from "@radix-ui/react-slot"` will break.
5. **Verify** the foundation renders after login at **`/kitchensink`** (throwaway proof — delete once rework is underway) and **`/billing`** (real screen, re-themed in Phase 0).

> ⚠️ **Two component libraries — don't confuse them.** `components/ui/*` = the **new** shadcn / `.gb` system (use this). `components/fk/*` = an **older** inline-style "FIKIRTIVE light" library scoped to a different `.fk` wrapper, tokens in `app/otto/otto-theme.css`. `billing/BuyPackButton.tsx` still imports `Button` from `@/components/fk` — a known mixing point. **For all Grok-bright work, build on `components/ui` + `.gb`.**

---

## 5. Hard constraints (non-negotiable)

Quoted from the roadmap:

- 💰 **Money path is untouchable — display/copy only.** *"Re-skins may change what credit numbers/copy are shown, they MUST NOT change reserve/settle/charge logic, the genRequest gate, startGen, idempotency, or the fal provider call."* (roadmap:20-22). For `/billing`: *"Keep `createTopupCheckout` → Stripe redirect (success_url/cancel_url=/billing?status=) exactly as-is."* (roadmap:94-96). **Before spending real money** (any fal/Stripe call) the founder confirms each time — the ask is the cap.
- 🧱 **Strangler, never big-bang.** One surface per phase; the rest of the live app untouched. Ship risky surfaces **behind a flag**; keep the old screen until the new one is verified. (roadmap:23-24)
- 👁️ **Founder approves each screen's hi-fi BEFORE you build it.** Per-phase rhythm: *design hi-fi → founder approves → build → design QA → ship behind flag → measure → iterate.* (roadmap:45) — **The founder cannot see inline preview widgets; render mockups/QA to PNG → `~/Desktop`.**
- 🎨 **One system.** Grok-bright tokens + Geist + shadcn from project `0abf8563`. **Coral = OTTO only**; semantic colour = state only; wins "bloom" (polychrome only at the payoff). (roadmap:25-26)
- ✅ **Every state, every screen:** loading (skeletons), empty, error, success. AA contrast. **Sentence case. No em-dashes in UI copy.** (roadmap:29-30)

---

## 6. Git state & build ordering (read before touching login/canvas)

> ✅ **RESOLVED 2026-06-29:** the colliding WIP described below has been **discarded** (stashed). The main checkout is clean. The collision risk is gone — you only need to rebase Phase 0 onto current `origin/main` before building. To recover the old WIP if ever needed: `git -C /Users/winnin/Desktop/artlio stash list` → `stash pop`. It was an old re-skin of login + Otto-shell on the **rejected Figtree** direction, superseded by these mockups; the only non-styling bits were an orphaned `proxy.ts` `/brand` exclusion and an `OttoNav` thread-search (re-add later if wanted).

**(Historical, for context)** There was uncommitted WIP in the MAIN checkout that would have collided with the front-door and Otto-canvas screens.

- The main checkout (`/Users/winnin/Desktop/artlio`, on `main` @ `5ad6214`) has **uncommitted Otto-shell + login WIP**: modified `app/layout.tsx`, `app/login/{page,LoginForm}.tsx`, `app/otto/otto-theme.css`, `components/fk/Button.tsx`, `components/otto/{OttoApp,OttoNav,OttoView}.tsx`, `proxy.ts`; untracked `app/login/login.module.css`. **None of it has landed.** It is uncommitted and unbacked-up — commit or stash it before any branch work that touches these files.
- Phase 0 lives only on branch `claude/gracious-chandrasekhar-72f8c9` (HEAD `5b3789d`), **≈4 ahead / 1 behind `origin/main`, NOT pushed.**
- **The single guaranteed conflict** between Phase 0 and the WIP is `apps/web/app/layout.tsx` (both edit it). Every other Phase 0 file and every other WIP file are disjoint.
- The new **canvas-home** screen re-skins `OttoApp/OttoNav/OttoView` (+ `otto-theme.css`); the new **login/first-run** re-skins `app/login/*` + `OttoFrontDoor.tsx` — **all of these are dirty in main right now.**

**Sequence (now that the WIP is discarded):**
1. **Rebase Phase 0** (`claude/gracious-chandrasekhar-72f8c9`, HEAD `5b3789d`) onto current `origin/main`. `origin/main` has advanced with #66 (credit packs / MYR pricing) and #67 (BytePlus generation migration); `layout.tsx` is now a clean rebase (Phase 0 adds the Geist font var; no competing WIP). Push the branch.
2. **Build the new screens** on the rebased Phase 0 foundation — login/first-run and canvas-home no longer collide with anything.

The Otto-shell files the canvas-home re-skins (`OttoApp/OttoNav/OttoView`, `app/login/*`, `app/otto/otto-theme.css`) are back at their committed state, so you re-skin them straight from the mockups.

---

## 7. Build order (Phases)

Phase 0 ✅ done. Each later phase gets its own TDD plan doc when you start it.

| Phase | Scope | Risk |
|---|---|---|
| **P0 Foundation** ✅ | Install Grok-bright system + fix `/billing` theme | Low (done) |
| **P1 Front door** | Sign-in (split layout) + first-run (OTTO greets + goal tiles = empty-state home) | Low — collides with main WIP (§6) |
| **P2 ★ Make-an-ad loop** | Home(returning) → chat → plan card (spend gate) → generating → result/payoff | **High (money-display)** — behind a flag; needs 1 real-merchant usability test before "done" |
| **P3 Manage** | My Stuff · Brand Memory · Account (calm balance + honest receipt) | Med |
| **P4 Creative** | Per-asset editor · storyboard · library (heavier; still on legacy Vapor today) | Med |
| **P5 Admin console** | The 14 founder-only admin surfaces on shadcn Table | Med |

Mockups map to phases: `login.html`/`first-run.html` → P1 · `canvas-home*.html`/`node-types.html`/`result-payoff.html` → P2 · `my-stuff.html`/`brand-memory.html`/`account.html` → P3 · `asset-editor.html` → P4 · `schedule.html`/`analytics.html` → P3/post-loop.

---

## 8. Gotchas checklist

- [ ] Built `packages/*` before running web (else `@fikirtive/*` type errors).
- [ ] New screen root has `className="gb"`.
- [ ] Using `components/ui` (shadcn/.gb), **not** `components/fk` (.fk).
- [ ] `Slot.Root`, not `<Slot>`.
- [ ] Read `node_modules/next/dist/docs/` for the custom Next 16.2.9 API before new route code.
- [ ] Rebased Phase 0 onto current `origin/main` (resolve `layout.tsx`) before building login/canvas.
- [ ] Money path: display/copy only. Founder approves each hi-fi + confirms each real spend.
- [ ] Founder reviews via **PNG on Desktop** (can't see inline widgets).
