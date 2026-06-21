# Fikirtive — PRD + Roadmap (Two Clocks → Engineering Phases)

> Draft v2 — 2026-06-21. Grounded in the code-reality audit (`wh7d7mut7`) + Codex verification (`bire1gskv`) + **Codex roadmap review (`b46bjcimg`) — sequencing recut applied.** Pairs with `financial-model.md` + `pitch-deck.md`.
>
> **For agentic workers:** each PHASE gets its own detailed task-by-task plan (superpowers:writing-plans → subagent-driven-development) at execution time. This is roadmap altitude: scope, sequence, deliverables, success criteria, gates, milestone mapping — not bite-sized TDD steps. Anything touching spend or tenancy goes through the repo's money-safety + isolation Codex gates.

**Goal:** Turn the current product (a strong AI creative studio with a bank-grade money/tenancy spine) into the Otto-led, SEA marketing OS the strategy describes — sequenced so the raise's money maps to concrete, diligence-verifiable milestones, and so we don't delay PMF for migrations the wedge may reshape.

**North-star milestone (what the raise buys, month-18):** 1,000–1,500 paying merchants · RM3–5M ARR · monthly churn ≤6% · demonstrated **NRR > 100%** (the metric that de-risks land-and-expand and unlocks the RM8–15M Series A).

---

## 1. Honest starting line (what's built vs not)

**Built today, diligence-verified (do NOT rebuild — lead with these):**
- **Owner-scoped resolver** `requireOwner()` (fail-closed, never defaults) consumed at every query site (`apps/web/lib/auth-guard.ts:49`) **+ a test-time tenant-guard backstop** (`packages/db/src/tenant-guard.ts` — warns in prod, throws under test; documented blind spots for raw SQL / nested writes / findUnique / aggregate). *Isolation is proven by the 2-org isolation tests, not by the extension alone.*
- Atomic same-tx credit reservation + hard ceiling (`packages/db/src/credits.ts:30`); settle/refund in worker; charge decoupled from true fal cost = the margin (`packages/core/src/spend.ts`).
- Multi-layer DB-enforced exactly-once idempotency on every spend path (partial-unique indexes).
- Dual append-only audit by convention (`ActionEvent` + `CreditLedger`) — *append-only is code/schema convention, no DB-level constraint yet (see G7)*; operator RBAC matrix (`packages/core/src/roles.ts`).
- Per-second video **cost** metering (`packages/core/src/gen.ts`); generic asset upload-ingestion **primitive** (`apps/web/lib/upload-actions.ts:145`, best-effort ingest dispatch — unverified rows possible on failure) + generic batch video generation, **capped at 4 clips** (`MAX_GEN_COUNT=4`, `GenSpace.tsx`). ← *the wedge building blocks, with the caveats above.*

**Not built / different than the strategy claims (the gaps this roadmap closes):**
| ID | Gap | Reality today | Sev |
|---|---|---|---|
| **G1** | Org→**Brand**→Project tenancy | Flat: `Project.ownerId`→`Organization` direct; no `Brand` model/`brandId`. (But `EntityType.BRAND` + cowork project-brief already exist → a *thin* brand profile is cheap.) | 🔴 |
| **G2** | Otto-as-front-door + the wedge (product-URL → ad-pack) | GenSpace is default; Cowork is a tab self-branded "Artlio creative director"; no URL ingestion; cowork emits 1 asset/turn (`cowork.ts:135`); batch capped at 4 | 🔴 |
| **G3** | Plan/tier + **server-enforced** cheap default + premium gating | No plan field; cheap default is client-only (`GenSpace.tsx:114`); anyone with credits runs Veo 4K server-side | 🟠 |
| **G4** | Stripe + overage/cost-plus billing | Hard-block at zero balance; Stripe stubbed only | 🟠 |
| **G5** | Brand Brain = real customer-data graph | Only creative-asset lineage + cowork creative context; no customer/conversion/attribution/CRM | 🟡 |
| **G6** | Per-tenant member RBAC | `Membership.role` reserved/inert | 🟡 |
| **G7** | Audit immutability + retention | Append-only by convention only; **no DB-level trigger/permission**; no retention/partitioning | 🟡 |
| **G8** | Credit unit honesty | Bills internal credit (1=$0.01) / displayed (1=$0.10); video charge = model-second estimate **rounded up to display credits** — NOT a literal video-second | 🟡 |
| **G-PP** | Paid-planner spend boundary | Cowork can use a paid LLM transport when unlocked (`runtime-config.ts`); only the env checklist keeps it $0 today | 🟠 |

## 2. The two clocks (governing doctrine, refined by Codex)

- **Foundation clock — build now ONLY the cheap-to-do-now / catastrophic-to-retrofit slice.** Codex's refinement: a *thin* Brand profile + default brand is cheap now (the concept, the default); the *expensive* row-level `brandId` isolation migration across ~20 tables is **deferred until multi-brand demand pulls it** — doing it pre-wedge risks rebuilding against learning. So: brand *concept* day-one, brand *isolation migration* on pull.
- **Feature clock — build only when the wedge / a paying customer pulls it.**
- **Spend safety is non-negotiable from day-one:** every gen credit-firewalled; the paid planner stays $0 (or metered) before any merchant traffic. Anti-trap: enterprise-ready ≠ premature scale infra.

## 3. Product requirements (PRD)

**3.1 Product.** Fikirtive = SEA-native, agent-first marketing OS for SMB/DTC e-commerce. The merchant works by talking to **Otto**; the studio is Otto's hands.

**3.2 The wedge.** A non-technical merchant pastes a product link (or uploads product shots) and, in one Otto conversation, gets a **batch of on-brand, ready-to-publish short-form video ads** the same session — without learning the studio.
- **v1 acceptance (matches today's batch cap):** first-session, no tutorial, ≤10 min, product-in → **4 ad-ready videos** out, on-brand, downloadable/publishable. (>4 requires the ad-pack orchestrator in Phase 1c — quota, retries, packaging, cost preview.)

**3.3 Foundation invariants (Definition-of-Done gates, mostly already met).** Tenant-scoped · fail-closed authz · append-only audited · lineage-captured · idempotent on spend · credit-firewalled · paid-planner $0-or-metered · no PII leakage.

**3.4 Pricing model (from financial-model.md).** Subscription + **COGS-indexed credits** (a credit maps to internal $0.01 cost / $0.10 displayed; **video is priced by model-second estimate, rounded to display credits** — it is *not* a literal video-second, but video IS the dominant COGS) · no % of ad-spend · WhatsApp/SMS pass-through · **server-enforced** cheap-tier default, premium gated by plan/hero-render · 10x-value principle.

---

## 4. Roadmap — phased (sequencing recut per Codex)

> Effort: **S** ≈ days · **M** ≈ 1–3 wk · **L** ≈ 3–8 wk (CC-assisted, solo+small team).

### Phase 0 — Foundation, rebrand & spend gates (do first; cheap, fast, safety-critical)
- **0a · Rebrand Artlio→Fikirtive, Cowork→Otto** (S) — agent identity (`cowork-planner.ts:5`), UI strings, metadata. Rename + persona, no logic change.
- **0b · Thin Brand profile + default brand** (M) — introduce a lightweight `Brand` concept (name/voice/logo) under an Org, auto-create one "house brand" per org, surface it in Otto's context. **Do NOT** do the row-level `brandId` migration yet (that's Phase 3 / on-pull). This gives the brand *concept* without the expensive flip.
- **0c · Spend gates (safety, blocking before any merchant traffic):** assert **paid planner stays $0** (G-PP — `cowork_provider` mock/unset, `COWORK_PAID_PROVIDERS_ALLOWED` off) OR meter planner turns through the credit ledger; **pre-wedge operational gate** = the existing `docs/closed-beta-env-checklist.md` (AUTH_ENABLED, Resend, allowlist, founder admins, Sentry, R2, paid-planner lock) must be green.
- **0d · G7 audit immutability + G8 credit-unit honesty** (S each) — DB-level append-only (trigger/permission revoking update/delete on `ActionEvent`/`CreditLedger`) + retention note; reconcile pricing copy to "COGS-indexed credits" across docs + UI.
- **Deliverable:** Fikirtive/Otto branding live; thin brand concept in Otto's context; spend gates verified; audit immutable at DB level.
- **Success criteria:** isolation tests still green; planner provably $0 in beta config; `ActionEvent` update/delete rejected by DB; build + tests green.

### Phase 1 — The wedge (Otto front-door + product→ad-pack) — **L**
- **1a · Flip the front door** (M) — default landing → Otto conversation (`Studio.tsx:61`); studio surfaces become Otto-invoked tools + optional power-user view; empty-state "paste a product link."
- **1b · Product ingestion** (M/L) — product-URL scrape → images/copy/brand cues into the project; sink through the existing `upload-actions.ts` pipeline **but add `verifiedAt`/hidden-until-verified** so failed-dispatch unverified rows never become merchant-facing source (Codex P2.5).
- **1c · Ad-pack orchestrator** (L) — one Otto turn → a campaign: variants × aspect ratios, on-brand; extend the singular `coworkProposalSchema` (`cowork.ts:135`, `cowork-actions.ts:419`) to a multi-output pack with **quota, retries, packaging, cost preview**; v1 uses the 4-clip batch cap.
- **1d · Minimal server-side margin gating** (M) — **pulled forward from G3:** a minimal entitlement/model allowlist + **server-enforced cheap-tier default** so the ad-pack can't fan out Veo before plans exist (Codex P1.2). Full plan/tier UI waits for Phase 2.
- **1e · Dogfood + QA** (M) — the §3.2 acceptance test with a real non-technical user; /qa pass.
- **Deliverable:** product link in → 4-video ad pack out, Otto-led, one session, cheap-tier-defaulted, spend-safe.
- **Success criteria:** §3.2 wedge acceptance passes; no user can run premium video off the allowlist; spend credit-firewalled.

### Phase 2 — Monetize (full plan/tier + billing) — **M–L**
- **2a · G3 full plan/tier** (M) — `plan` enum + per-plan allowed-model allowlist on `Organization`; "hero-render" surface unlocks premium. (Builds on 1d's minimal allowlist.)
- **2b · G4 Stripe + overage** (M) — Stripe purchase → `grantCredits(source=PURCHASE)` (stubs exist); auto-recharge / cost-plus overage above the included allotment; optional admin-set per-merchant cap.
- **Deliverable:** subscribe, buy credits, hit a plan wall, pay overage.
- **Success criteria:** modeled per-plan margin holds (financial-model §A); off-plan premium blocked; overage path tested.

### Phase 3 — Retain, expand & full multi-brand (the spokes → NRR > 100%) — **L**
- **Spokes, in loop-closing order:** Publish → Ads → Attribution → CS-chat → Lifecycle messaging → CRM; + KOL/affiliate + reviews/UGC.
- **G1 full `brandId` isolation migration** (L) — *now* pulled by real multi-brand demand. **Table-by-table scope (Codex P2.7):** keep `Asset` + R2 keys **org-scoped** (avoid re-keying `u/<ownerId>/<hash>`); make `Project`/`Generation`/`ChatThread` **brand-scoped**; additive migration; extend `requireOwner`→`{ownerId, brandId}` + where-clauses + composite indexes + 2-org×2-brand isolation test.
- **G5 Brand Brain real data model** (L, foundation-flavored) — Customer/Conversion/Attribution entities + write-back from spokes; scope the data model day-one-correct as features layer in.
- **G6 per-tenant member RBAC** (M) — wire `Membership.role` owner/admin/member.
- **Success criteria:** demonstrated **NRR > 100%** on an early cohort; attribution closes content→conversion for ≥1 channel; brand isolation test green.

---

## 5. Roadmap → milestone & money mapping

| Window | Phases | Proof point | Ties to raise |
|---|---|---|---|
| Months 0–2 | Phase 0 | Fikirtive/Otto live; thin brand; spend gates green; audit immutable | "build" use-of-funds; de-risks foundation + safety |
| Months 1–7 | Phase 1 | Wedge end-to-end (4-video ad pack); first design-partner merchants | acquisition + activation proof |
| Months 5–10 | Phase 2 | Paying merchants; plan-gated margin | first revenue; ARR starts |
| Months 8–18 | Phase 3 | Expansion cohort; full multi-brand; **NRR > 100%** | the Series-A unlock metric |

(Phases overlap; founder does founder-led sales throughout. Full Brand-isolation migration lands in Phase 3 — pulled by demand — not pre-wedge.)

## 6. Per-phase execution handoff

Each phase → **superpowers:writing-plans → subagent-driven-development**: task-by-task TDD plan at phase start, fresh subagent per task, two-stage review, **Codex money-safety gate on anything touching spend (Phase 0c/0d, 1d, 2a/2b) or tenancy (0b, Phase 3 G1).**

## 7. Self-review (against the audit + Codex roadmap review)

- **All gaps covered:** G1 split (0b thin + Phase 3 full), G2 (1a/1b/1c), G3 (1d minimal + 2a full), G4 (2b), G5 (3), G6 (3), G7 (0d), G8 (0d), G-PP (0c). ✓
- **Codex P1s applied:** G1 resequenced thin-now/full-later (P1.1); server-side margin gating pulled into Phase 1 (P1.2); wedge acceptance = 4 videos / orchestrator (P1.3). ✓
- **Codex P2/P3 applied:** softened "built today" tenant wording (P2.4); ingestion `verifiedAt` (P2.5); paid-planner gate G-PP (P2.6); table-by-table brand scope (P2.7); Phase 1 re-sized L (P2.8); G7 DB-level (P2.9); credit-unit honesty G8 + §3.4 (P2.10); pre-wedge op gate (P3.11). ✓
- **Two clocks honored, PMF-protected:** brand concept now, expensive migration on pull. ✓
- **Maps to the raise:** §5 ties phases to the month-18 NRR>100% milestone. ✓
