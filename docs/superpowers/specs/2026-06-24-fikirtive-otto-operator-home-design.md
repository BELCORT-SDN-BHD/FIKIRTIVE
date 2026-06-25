# FIKIRTIVE — Otto-Operator reframe (design spec, source of truth)

**Date:** 2026-06-24 · **Status:** IA locked; visual design pending (Claude Design) · **Owner:** founder + design brainstorm

> One line: stop shipping *a creative tool you operate*; ship *a marketing outcome you request*.
> Otto becomes the **operator** and the front door (`/home`); the six manual Studio surfaces
> collapse into **Workshop**, reached only by tapping "change this." A 60-year-old with zero
> AI/marketing knowledge picks a plain-language goal, has a short scoped Otto conversation, and
> chooses from a small batch of finished, on-brand, correctly-priced ads.

**Companion doc:** the per-screen visual handoff for Claude Design lives in
[`docs/design/2026-06-24-claude-design-brief.md`](../../design/2026-06-24-claude-design-brief.md).

---

## 1. Background & problem

Verified against the codebase:

- Login → `/` **hard-redirects to `/studio`** (`apps/web/app/page.tsx`). There is **no home**.
- `/studio` is a six-surface manual switcher via `?view=` (`StudioShell.tsx`): Gen space,
  Storyboard, Video editor, Elements, Assets, Otto. `plans`/`canvas` are dead placeholders.
- `/m` = "simple mode" = `<Cowork simple/>` (Otto chat, one project, no chrome). Closest seed.
- The shell shows **fake identity + a fake credit balance** ("Tessa Bright" / "768 CR").
- Otto's loop works (`propose` → $0 card → `generate` → gated spend, metered reserve→settle), but
  proposals **die in chat** — they never become `Shot`s or an organized deliverable.

The founder's words: it "feels 很卡" (clunky). Target user is a total novice; north stars are
Pencil and Adobe GenStudio — but Otto-driven, more automated, radically simpler. Diagnosis: the
clunk is the manual six-surface cockpit. Pencil/GenStudio bolt their engine onto an enterprise
cockpit; **FIKIRTIVE keeps the engine and hides the cockpit.**

> **Design-system note:** Vapor (the current `globals.css` + `ds.tsx`) is being **replaced** — the
> founder is building a new design system in Claude Design. This spec is therefore **structure,
> routes, features, and behavior only**; visual styling is out of scope here and handled in the
> companion brief. Do not assume Vapor tokens/components survive.

---

## 2. Vision & positioning

**Otto is the operator, not a chat tab.** "Tell Otto what you want → Otto delivers." The
editor/storyboard/elements become drill-downs Otto opens for you, not destinations you navigate.

**Borrow (with the FIKIRTIVE twist):** show a batch and let the user *choose* (choosing is easy,
creating is hard); brand-from-a-URL that materializes as `@mention` entities (Phase 2);
channel-aware sizing done silently (Phase 2).

**Do NOT copy:** enterprise governance/roles; user-facing model-picking; and **fake performance
scores** (we have zero channel data — confidence stays *editorial*: "Otto would run this one
because…", never a number).

**Three signature edges:**
- **A. Radical automation by default** — but gated by Co-pilot approval (below).
- **B. The `@mention` reference moat** — same `@Maya`/`@Product` across everything. **Verified
  already wired** end-to-end (`ottoTurn` → `propose`/`generate` → `startGen` → `checkCast` →
  `Generation.entitySnapshot`). Phase 1 **surfaces** it ("My Cast"); it is not broken.
- **C. Spend-safe metering as a loud trust feature** — the real reserve→settle ledger with hard
  caps exists; the UI lies with a fake balance. Make honesty the signature.

---

## 3. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Product model | **Otto = operator + front door.** The big inversion: Otto moves from `?view=cowork` (a tab) to `/home` (the door); tools collapse into Workshop. |
| D2 | First screen | **Goal tiles → scoped Otto chat → ad-pack chooser.** |
| D3 | Goal-tile set | **Hardcoded ~6 curated tiles for Phase 1** (admin-editable is a fast follow). |
| D4 | Approval | **Co-pilot — approve every paid step.** Auto-pilot dropped from Phase 1. |
| D5 | Endpoint | **Download / "copy to post."** No ad-channel publishing (Phase 3). |
| D6 | Structure | **Hidden.** Top-level = Home / My Stuff / Workshop / Account. "Project" stays a hidden grouping key. |
| D7 | Confidence | **Editorial only**, never a fake number. |
| D8 | Ad-pack grouping | **Add a lightweight `GenerationBatch` table in Phase 1** (the only new table). |
| D9 | Design system | **New system via Claude Design.** Vapor retired. |
| D10 | Device | **Desktop-first, mobile-ready.** |
| D11 | Route name | `/home` (founder may rename to `/make`). |
| D12 | My Stuff shape | **One surface, two sections** (Cast / Ads), not two tabs. |
| D13 | Workshop shape | **One `/workshop` with a `?surface=` switcher.** |
| D14 | Cast editing | Browse in `/stuff#cast`; **edit drills into `/workshop?surface=cast-editor`.** |

---

## 4. Information architecture

### 4.1 Top-level places (the only places a user can BE)

| Place | One job | Novice sees it? |
|---|---|---|
| **Home** (`/home`) | Pick a goal, talk to Otto, choose from finished ad-packs. | Always — this is the product. |
| **My Stuff** (`/stuff`) | See/reuse the two things you own: Cast (people/products/logos) + Ads (deliverables). One page, two sections. | Yes. |
| **Workshop** (`/workshop`) | Hand-adjust one thing Otto made. Reached only via "change this." No primary nav entry. | On demand only. |
| **Account** (`/account`) | Real balance, spend history, sign out. | Yes — quiet corner. |

### 4.2 Route map (before → after)

| Today | Becomes | Why |
|---|---|---|
| `/` → `/studio` | `/` → `/home` (preserve `?p`) | Land on the goal loop, not a tool. |
| `/studio` shell + `?view=` | **Retired as a destination**; `/studio` → `/home`; views relocate (below) | The operator cockpit is what we're replacing. |
| `?view=cowork` | `/home` | Otto becomes the door, not a tab. |
| `?view=genspace` | `/workshop?surface=genspace` | Manual composer = power escape hatch. |
| `?view=storyboard` | `/workshop?surface=storyboard` | Power surface. |
| `?view=editor` | `/workshop?surface=editor` | Power surface. |
| `?view=elements` | `/stuff#cast` (browse) + `/workshop?surface=cast-editor` (edit) | Browse/edit split. |
| `?view=assets` | `/stuff#ads` | Deliverables gallery. |
| `?view=account` | `/account` | Promoted top-level. |
| `?view=canvas` | **Retired** → `/home` | Abandoned placeholder. |
| `?view=plans` | **Retired** → `/account` | "Coming soon" stub. |
| `/m` | **Folded into `/home`** (301) | `/m` already is the novice Otto surface. |
| `/editor` | `/workshop?surface=editor` (301) | One editor home. |
| `/library` | `/stuff#cast` (301) | Re-point the existing redirect. |
| `/admin/*` | Unchanged | Internal founder console, outside the novice IA. |

Net: novice-facing routes collapse from `{/, /studio (+9 views), /m, /editor, /library}` to
**`{/home, /stuff, /workshop, /account}`**.

### 4.3 Feature placement (nothing silently lost)

Every existing user-facing feature is KEEP (lands somewhere) / MERGE / DEMOTE (Workshop drill-down)
/ RETIRE. Highlights:

- **KEEP–promoted:** Otto loop → `/home`; real credit ledger → `/account`; entity moat (unchanged
  backend).
- **MERGE:** Studio shell/nav/project-switcher → the new 4-place chrome (project stays hidden);
  Assets media grid → `/stuff#ads`; Elements browse → `/stuff#cast`.
- **DEMOTE → Workshop:** Gen space manual composer, Storyboard, Video editor, Elements editor,
  reference/tail upload, prompt-coach, attach-to-shot, project-brief editor.
- **RETIRE:** Canvas placeholder, Plans stub.
- **Unchanged/internal:** `/login`, `/admin/*` (note `/admin/directives` is load-bearing for
  Otto's editorial-confidence quality).

(Full per-feature table preserved in the IA workflow output; mirror into this file if it drifts.)

---

## 5. New features by phase

### Phase 1 — buildable on the existing engine
1. **Goal-tile Home** — ~6 hardcoded plain-language tiles launch a scoped Otto conversation.
2. **Plain-language spend confirm** — "$0.50 — 5 frames × 10¢. Approve?" on the real ledger,
   before any paid step. Reuses `account-actions` price helpers + `ottoApprove`. No schema change.
3. **`createShot` + `attachGeneration` Otto tools** — materialize a chat outcome into real
   shots/board entries. New `packages/otto/src/tools/*` + ports in `buildOttoContext`
   (`apps/web/lib/otto-actions.ts`), mirroring the existing `startGen` port.
4. **`GenerationBatch` (the one new table)** — name + join to `Generation`s + soft-delete, so a
   batch reads as one ad-pack to choose from and "My Ads" can group. Optional Otto tool to batch on
   completion.
5. **My Cast** (`/stuff#cast`) — reusable entities with refs/variants/usage; reuses `getEntities` +
   `Library`.
6. **My Ads** (`/stuff#ads`) — finished generations/renders grouped by ad-pack, newest-first.
7. **Download / copy-to-post** — per result: download (R2 proxy) + open IG/TikTok with file ready.
   No publishing.
8. **Plain-language batch status** — "3 of 4 ready — 1 failed (not charged), retry?" (fixes the
   audit's vanishing-failures). Thread a batch id through `GenJob`.
9. **First-run teaching** — 3-step empty state (goal → talk → approve & download). Optional
   `User.onboardingCompleted`.
10. **Hands-on toggle** — entry from a result into `/workshop?surface=genspace`.

### Phase 2 — medium infra
11. **Brand-from-URL bootstrap** → seeds My Cast (scraper + vision sub-agent + `Entity`/`ReferenceImage`).
12. **Auto multi-format sizing** — one idea → 9:16 + 1:1 + 16:9 in one batch (GenJob aspect params exist).
13. **Editorial confidence** — rationale text on the proposal DTO; powered by `/admin/directives`.

### Phase 3 — new infra
14. **Real publishing + analytics** — OAuth IG/TikTok, post directly, engagement (`UserSocialAccount`/`PostRecord`).
15. **Scheduled posting / campaigns** (`Campaign`/`ScheduledPost` + scheduler worker).
16. **Auto-captions + burn-in** — wire existing `CaptionJob`/`Transcript` to editor/render.

---

## 6. Phase-1 engine changes (the build, summarized)

- **Routing:** `apps/web/app/page.tsx` → `/home`; add `/home`, `/stuff`, `/workshop`, `/account`
  routes; 301/redirect the retired routes (§4.2). Per `apps/web/AGENTS.md`, read
  `node_modules/next/dist/docs/` before writing route/layout code (non-standard Next.js).
- **Otto tools:** add `createShot`, `attachGeneration`; optional `groupBatch`.
- **Schema:** add `GenerationBatch` (name, ownerId/projectId, `Generation[]` join, `deletedAt`).
  One Prisma migration. Everything else reuses existing models.
- **Approval:** Co-pilot reuses `needsApproval`/`ottoApprove` + the card's manual Generate; wrap in
  the plain-language spend confirm. Control surface = Co-pilot (default) + Hands-on (Workshop).
- **Real identity/balance:** read `User` + `CreditAccount`; remove the hardcoded user row.

---

## 7. Visual design (Claude Design, new design system)

Out of scope for this spec; see the companion brief. The bounded screen list (19 screens/states,
items 1–9 = the Home product) is the founder's design deliverable. Engineering ports the returned
design into new React components and wires it to the data/Otto actions above.

---

## 8. Constraints honored
- Desktop-first, mobile-ready. New design system (no Vapor assumption).
- Every component defines LOADING / EMPTY / ERROR / SUCCESS / PARTIAL with inline recovery; no
  blocking error dialogs; zero silent failure.
- Empty states teach the next action.
- Every spend requires explicit human approval (Co-pilot) — no armed-on-load Generate.
- No fake data — real identity, real balance, honest endpoints, no fake scores.

## 9. Verification
- `pnpm typecheck` + `pnpm test` green; add tests for `createShot`/`attachGeneration` and the
  `GenerationBatch` actions.
- Local money-safe by default (`GENERATION_PROVIDER=mock`); exercise Otto with a real `ANTHROPIC_API_KEY`.
- Manual: land on `/home`, run a goal-tile flow end-to-end to a downloadable ad-pack; confirm real
  balance, plain-language spend confirm, inline error recovery, and that no retired route 404s.

## 10. Open questions & risks
- **O1** route name `/home` vs `/make` (D11) — founder preference.
- **O2** final goal-tile copy + each tile's 2–3 scoped questions (D3).
- **O3** display balance in $, credits, or both.
- **Risk:** "materialize the pipeline" + video assembly is the deepest new work; keep video scoped
  (storyboard preview → per-scene gen → assemble) and lean on the existing worker/ffmpeg path.

## 11. Roadmap
Phase 2 = brand-from-URL + auto multi-format + editorial-confidence text. Phase 3 = real publish +
analytics (and only then does "Otto would run this" become a data-backed number).
