# FIKIRTIVE Otto frontend — Implementation Plan (from Claude Design handoff)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Build milestone-by-milestone, TDD where it carries weight, review + run before claiming done.

**Goal:** Implement the Claude Design "FIKIRTIVE Otto" prototype as a real, working surface in `apps/web` — a new **light-theme** Otto app at `/otto`, wired to the live backend (`ottoTurn`/`ottoApprove`, `memory-actions`, account/ledger, entities), plus the one new backend feature it needs (the ad-pack **batch**).

**Source of truth (design):** `docs/design/handoff/FIKIRTIVE-Otto.dc.html` (the prototype — recreate its visual output, not its internal `x-dc`/`sc-*` structure), `docs/design/handoff/design-system-readme.md`, `docs/design/handoff/tokens/*.css`, `docs/design/handoff/_ds_manifest.json`. Brand assets already in `apps/web/public/brand/{otto,logo-mark,logo-wordmark}.svg`.

**Locked scope decisions:** (1) build the batch so the chooser is real; (2) new route `/otto`, keep dark `/studio` as the "manual room"; (3) Workshop is a stub for now.

## Global Constraints
- **Non-standard Next.js** (`apps/web/AGENTS.md`) — read `apps/web/node_modules/next/dist/docs/` before route/layout code.
- **Theme isolation:** the light theme MUST NOT bleed into dark `/studio`. Scope all new tokens under a wrapper class (`.fk`) in a NEW `apps/web/app/otto/otto-theme.css`; the OttoApp root carries `className="fk"`. Do NOT edit `globals.css`.
- **Money path untouched.** All spend stays via the existing `ottoApprove`/`startGen`. New batch work reserves/settles through the existing metered path only.
- **Cross-package builds:** changing `packages/*` requires `pnpm --filter @fikirtive/<pkg> build` before web sees it (db tests need `DATABASE_URL=postgresql://artlio:artlio@localhost:5432/artlio_test`).
- Recreate the design's **visual output** faithfully (tokens, radii, shadows, spacing, copy/voice). Sentence case; Otto = first person, UI = "you". No jargon.

## Architecture
One client surface `OttoApp` (mirrors the prototype's single-page model) at `/otto`, with internal view state (`otto | stuff | memory | account` + a Workshop overlay). A server `page.tsx` loads initial data (owner, balance, entities, threads, memory) and hydrates the client. New light-theme component library under `apps/web/components/fk/`. Server actions reused from the backend; the only NEW server work is the batch (Milestone 4).

---

## Milestone 0 — Theme + fonts + assets
- `apps/web/app/otto/otto-theme.css`: port `tokens/*.css` (colors, typography, fonts, spacing, radius, shadows, motion) scoped under `.fk { … }`. Load Hanken Grotesk + JetBrains Mono (next/font or the Google CDN the design uses). Verify: a `.fk` container shows bone bg + slate/coral tokens; `/studio` (dark) is visually unchanged.
- Confirm the brand SVGs render from `/brand/*.svg`.

## Milestone 1 — Light design-system components (`apps/web/components/fk/`)
Port the 16 primitives from `_ds_manifest.json` (recreate visual output as real React + the light tokens): `Button` (variants primary/secondary/soft/ghost; sizes sm/md; left/right icon), `IconButton`, `Badge`, `Avatar`, `OttoAvatar` (idle/thinking states — the coral mascot using `otto.svg`), `Card` (variants default/tint; padding md/lg), `Tabs`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `ProgressBar` (tone teal, showValue), `Toast`, `Tooltip`, `Dialog`. Lucide icons (already a dep or via `lucide-react`). Each with a minimal render test. Verify: a kitchen-sink page renders all variants matching the design.

## Milestone 2 — `/otto` route shell + nav + front door
- `apps/web/app/otto/page.tsx` (server: `requireOwner` → load balance, entities, threads, memory; redirect to /login if unauth) + `OttoApp` client shell: left nav (logo, New campaign, nav items Otto/My stuff/Memory/Account, recent campaigns, **real balance**, user). Internal view routing.
- Otto **front door**: OttoAvatar + greeting + big composer + goal chips. A goal chip / "Let's go" starts a conversation seeded with the matching `goalKey` (Task 5) via `ottoTurn`. Verify: lands on front door, real name + balance, picking a goal opens a conversation.

## Milestone 3 — Conversation + plan card + approve
- Render the real thread (`ChatThread` messages → Otto/you bubbles), composer → `ottoTurn` (with `simple: true`). Map message kinds: TEXT bubbles; GEN_CARD → the **plan card** (line items + spend total + Approve/Change). Approve → `ottoApprove`; "Change something" → a follow-up turn. Plain-language spend confirm copy from the design. Verify (mock provider, $0): a goal → scoped Q&A → plan card with real cost → approve → a generation runs.

## Milestone 4 — Batch backend + ad-pack chooser + working + result
- **Backend (new):** an Otto path to propose+generate **N** variants as one `GenerationBatch` (the table exists). Add an Otto tool / extend the loop so "approve" fans out N gens grouped by a `batchId`; reserve/settle each via the existing metered path (no money-path change). Tests for the batch grouping + exactly-once per gen.
- **UI:** `phaseWorking` (OttoAvatar thinking + ProgressBar + honest partial note "scene 2 didn't work — you weren't charged"); `phaseChoose` (grid of N ad cards + "Otto's pick"); `phaseResult` (chosen ad + Download / Copy-to-post (open IG/TikTok) / Ask to change / Edit by hand→Workshop). Verify: approve → batch of ~4 → pick → result → download.

## Milestone 5 — Brand Memory (wired to `memory-actions`)
- The Memory screen: header + "Otto, learn my brand" (paste text → seeds memory) + "Add a note" (category chips + text) + categorized cards with "learned"/"you" source tags + when. Wire to `listMemory`/`addMemory`/`updateMemory`/`deleteMemory`; "learn my brand" calls `addMemory` per extracted note (v1: store the pasted text as memory; no URL fetch). Verify: add/edit/delete a note persists and shows; categories render.

## Milestone 6 — Account + My Stuff
- **Account:** real balance (big), "Where your money went" from `CreditLedger`, settings rows, sign out. Verify against the real ledger.
- **My Stuff:** Cast tab (entities via `getEntities` → cast tiles with use-count) + Ads tab (finished generations/ad-packs, newest-first, download). Verify both tabs render real data.

## Milestone 7 — Workshop stub + final pass
- Workshop overlay shell ("manual room", Back to Otto) reached from "Edit by hand"; a light placeholder editor inside (no real editing yet) with the design's "most people never need it" copy. Toast component for confirmations.
- **Run it:** `next dev`, walk the whole flow end-to-end on the mock provider; confirm the 5 screens work, the Otto loop is real, memory persists, balance is real, and `/studio` (dark) is untouched. `pnpm -r typecheck` + tests green.

## Open decisions / notes
- Plan card is campaign-level (one total) in the design but the backend emits per-GEN_CARD today — Milestone 3/4 reconciles by treating one approval as the batch trigger (Milestone 4) rather than per-card.
- Copy-to-post = open IG/TikTok with the file ready (no publish API; that's Phase 3).
- Cast is owner-global today (brand-scoping is the deferred agency layer) — fine for the single-brand novice.
