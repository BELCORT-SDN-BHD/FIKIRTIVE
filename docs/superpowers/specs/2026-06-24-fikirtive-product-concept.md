# FIKIRTIVE — Product concept (source of truth): Otto, the super-employee

**Date:** 2026-06-24 · **Status:** concept locked; engineering facts verified by 3 independent reviews (tech board, Codex, design/IA board) on 2026-06-24.

> Supersedes the earlier "two doors (/simple + /pro)" framing. **There are no two doors.** There
> is one app: Otto. The "Pro / agency" capability is a *later layer added to this one app*
> (a brand/client context + isolation + volume views), never a separate route tree.

---

## 1. North star (the whole product, in one paragraph)

**Otto is your (this brand's) super-employee.** He has a set of tools and skills you give him; a
memory that can store infinitely but only recalls the relevant part each turn (he records and
updates it himself, and you can see and edit it); reasoning that is strong but fallible; he does
not do the heavy work himself — he hands it to the back-office factory; and before any step that
spends money or is irreversible/external, he checks with the boss.

You just talk to Otto. That is the product.

## 2. What the product IS

**One app = Otto (you talk to him) + a few pages to *look at* what he knows and made.** Because
Otto is a super-employee you simply talk to, the same is true for a solo shop owner and for an
agency doing work for many clients — everyone talks to Otto; Otto carries the complexity. So
there is no "simple mode vs pro mode" to switch between.

- **Otto (the home / the operator)** — the conversation. Where everything gets *done*.
- **View pages (look, don't operate):** your memory (what Otto knows about your brand), your stuff
  (the cast/products/logos he reuses + the ads he made), progress (what he's working on), and
  account/settings (real balance, sign out).
- **Manual drill-downs (optional escape hatch):** when you want to hand-tweak one specific thing,
  Otto opens the relevant tool (editor / storyboard / the manual composer). Available when you
  want it, never a separate mode you have to live in. (This is the old "Studio" surfaces, demoted
  to drill-downs.)

**Mental model:** Otto is the *Claude Code of marketing* — an agent that operates a toolset to
reach a goal, with human approval gates and persistent memory. Two differences shape the build:
(1) Otto's output costs money, so the spend gate is a first-class citizen, not a nicety; (2) the
heavy work (image/video generation) is slow, so Otto dispatches it to an async factory rather than
doing it inline.

## 3. The five pieces (and how each is built)

1. **Capabilities = a tool/skill registry.** Every FIKIRTIVE feature (now + future) is an Otto
   tool/skill, authored one at a time by the dev team (BELCORT). "Otto can do X" ⇔ "a skill for X
   exists and is wired in." Otto is an `@openai/agents` agent (`packages/otto/src/otto.ts`); today
   it has 5 tools (`propose`, `generate`, `updateBrief`, `describeRefs`, `setTitle`). Adding a
   capability = a tool in `packages/otto/src/tools/` + a port in `OttoContext`/`buildOttoContext` +
   an instruction snippet + a gate. **Keep the existing runtime; do NOT swap to HERMES** (its
   self-authoring-skills, single-user-autonomous design conflicts with our human-gated, multi-tenant,
   money-metered crown jewel — borrow its *ideas* only).
   - *Internal scaffold (build before skill #6, not now):* a `defineOttoSkill({name, params, gate,
     execute, memory})` wrapper that auto-wires owner-scoping, makes `gate:'spend'` require an
     idempotency key + the metered port, and registers into the tool list — **fail-closed by default.**
     Migrate the 5 existing tools onto it as proof.

2. **Memory.** Store-infinite, recall-finite: a retrieval-based per-brand memory (compact profile +
   relevant slice + summary each turn, never a full dump). Otto records/updates it; the user views
   and edits it on a **memory page**. A "learn my brand" session = a normal Otto conversation
   steered to interview + write memory. **Reality:** this does not exist yet, and Otto has **no
   dynamic-context-injection seam today** — `buildOttoContext` carries only ids + `startGen`, and
   instructions are a static constant, so Otto currently can't "see" the brand or even the user's
   @mention entities in its reasoning. **The first real task for memory (and for "Otto understands
   your brand") is building that seam:** add `brandContext` + `availableRefs` to `OttoContext`,
   populate in `buildOttoContext`, inject as a system message at run assembly. Honest v1 of "memory"
   = an editable brand-notes text field + a page to read/edit it; retrieval/embeddings come later.
   `researchBrand` (auto-fetch a URL) is a new outbound-fetch trust boundary (SSRF/sanitization) —
   **cut from first ship**; v1 = user pastes text / uploads a doc.

3. **The async factory.** Otto orchestrates; it does not generate. On approval, the `generate` tool
   → `ctx.startGen` → reserves credits + inserts a `GenJob` + enqueues (pg-boss); the worker
   (`apps/worker`) calls fal + ffmpeg, then settles. So "5 videos at once" = 5 queued jobs, each
   independently metered and exactly-once; Otto never blocks. Concurrency is a worker/queue concern,
   already solved.

4. **Human gates.** On **money + irreversible/external** actions. Reuses the real, tested loop:
   `generate` is `needsApproval` → parks the run → `ottoApprove` rehydrates `RunState`, binds the
   approval to the matching `cardId`, resumes → spends. Read-only skills (analytics) don't gate. The
   gate also guards against Otto's fallible reasoning, not just budget.

5. **Isolation, staged.** Org today (`ownerId`, bootstrapped live by `requireOwner()`) → brand/client
   context (for agency support, later) → user/seat + RBAC (enterprise, later). Design new models
   *scopable now* so later isolation is "add a column + a filter," not a migration on a populated
   hot table.

## 4. Agency / multi-client = a later capability layer, NOT a door

When agency support lands, it is added to this one app as: a **brand/client context switcher** (so
Otto knows which client he's working for), **cross-client isolation** (so one client's assets never
leak into another's — see §6, this is a real live bug to fix regardless), and **volume views**
(search/filter/bulk in the "your stuff" pages). The data model for it is `Organization → Client →
Brand → Campaign → Project → GenerationBatch → Generation`. None of it is a parallel route tree or a
separate UI; it is more *context* + more *views* on the same Otto.

## 5. What's real today vs what's new (verified against the code)

**Real and load-bearing (the hard parts are done):**
- The money path is welded and tested: reserve→settle, never-negative, exactly-once per card (DB
  pre-check + unique index), settle clamps actual ≤ reserved (`packages/db/src/credits.ts`),
  anti-flip (`generate` takes only `cardId`; model/params come from the persisted card, never model
  output), ~46 tests.
- Tenancy is live: `requireOwner()` bootstraps a per-user `Organization` + `Membership` +
  `CreditAccount` + beta grant on first request (`apps/web/lib/auth-guard.ts`). The "fake 768 CR" is
  mostly already gone — `StudioShell` reads real `session.user` and shows no fake balance; surfacing
  the *real* balance in the Otto UI is wiring, not a build.
- @mention entities flow into the **spend path** correctly (`propose`/`generate` → `startGen` →
  `checkCast` → frozen in `Generation.entitySnapshot`). (But Otto's *reasoning context* doesn't see
  them — §3.2.)
- The async split + structured 529 failover are real.

**New build (the delta), in rough priority:**
- `ottoState` concurrency guard (CAS) on the web path — only the worker has it today; double-click
  approve / two tabs can corrupt a conversation. ~20 lines. **Do first.**
- The three signature novice screens that don't exist: **goal-tile front door**, **plain-language
  plan card / spend-confirm** (today the gate is a dev cost-debug widget with a model picker and no
  balance shown), and the **ad-pack chooser** ("choose from a batch" — `propose` emits only 1 card;
  needs Otto-emits-N + a `GenerationBatch` table + a chooser; or ship honest single-output and drop
  the "choose" language).
- The dynamic-context-injection seam (§3.2) — prerequisite for memory and reliable brand/@mention.
- A Simple-mode vocabulary constraint in Otto's instructions (today it says "verdict"; it must not
  say "generation/keyframe/render/model" to a novice).
- Real balance surfaced in the Otto UI; honest empty-states (no blank jargon chat; the current `/m`
  empty state must never reach a novice).
- Additive migration (now, even though unused yet): nullable `Project.brandId/campaignId`,
  `Asset.brandId`, `GenJob.batchId`, `Generation.batchId`, `CreditLedger.brandId`,
  `Entity.brandId`/`ReferenceImage.brandId` — so the brand layer lands later without a backfill.
- Design system: a new one is being built in Claude Design (Vapor retired). Rebuild the shared Otto
  surface as a **headless hook + a thin presentational shell**; keep Vapor in-tree until fully
  migrated; treat the token contract (`--fg-*`/`--surface-*`) as the stable seam.

## 6. Known risks (from the 3 reviews) + must-not-skip
- **Cross-client @mention leakage is live today** (`getEntities(ownerId)` is org-wide). Harmless for
  one user; a contract-ending leak for an agency. Brand-scope entities/@mention before exposing
  multiple clients. First item in any future agency work.
- **Tenant guard WARNs, doesn't enforce, in prod**, with blind spots (findUnique/raw/aggregate/
  groupBy/nested). Add a CI check (every tenant-model query carries an `ownerId` filter) + a 2-org
  isolation test before multi-client.
- **Multi-step autonomous spend is unproven** (single approval works; two interruptions in one run
  is untested). v1 = one paid batch per approval, explicitly.
- **Per-task budget ceiling** absent (runaway protection is per-turn). Add `taskBudgetRemaining` to
  `OttoContext` before any no-human-between-turns autonomy.
- **Every state must be designed, not asserted** — especially the ad-pack chooser PARTIAL
  (some-ready / some-pending / some-charged-failed) and the goal-tile→conversation handoff failure
  (Otto's first call errors before a thread exists; today only in-thread errors are handled).

## 7. Staging / critical path to first live ship
Ship the first slice of the one app — **Otto + the novice front door + honest spend + download** —
on the existing engine:
1. `ottoState` CAS guard.
2. Real identity + balance in the Otto UI (wiring).
3. Goal tiles (carrying intent that pre-seeds Otto) → scoped Otto conversation → finished ads →
   download / copy-to-post, with a plain-language plan card (one total, one approve) + the context
   seam for brand/@mention.
4. Additive migration (the nullable columns above) + new models into the tenant guard.
5. Honest empty/onboarding copy + Simple-mode Otto vocabulary.
**Cut from v1:** memory retrieval/embeddings + `researchBrand` (keep an editable brand-notes field +
page), autonomous multi-step, the whole agency layer (brand context/isolation/volume views), the new
design system as a *blocking* dependency (ship on existing components, migrate after), and the
generalized skill registry (build the thin `defineOttoSkill` wrapper when adding skill #6).

**The single most likely reason it fails to ship:** treating the full super-employee north star as
v1 scope. The shippable core is "Otto proposes → you approve → the factory generates → you
download." Everything else is real engineering scheduled *behind* the first ship, not in front of it.

---

### Related docs
- Screen handoff for design (consistent with this one-app model; Pro surfaces already out of scope):
  [`docs/design/2026-06-24-claude-design-brief.md`](../../design/2026-06-24-claude-design-brief.md)
  — add a "brand memory (view/edit)" screen to it before the memory backend ships.
- Earlier home/IA spec (the four-place shape — Home=Otto / your-stuff / drill-downs / account — is
  consistent with this; ignore any residual single-vs-two-door wording):
  [`2026-06-24-fikirtive-otto-operator-home-design.md`](2026-06-24-fikirtive-otto-operator-home-design.md)
