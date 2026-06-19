# Closed-Beta SaaS Foundation — Design

**Date:** 2026-06-19
**Status:** Design approved (decisions locked); pending user review of this spec → per-phase implementation plans.

**Goal:** Turn Artlio from a single-owner dogfooding tool into a true multi-tenant SaaS ready for a closed beta of invited merchants — building the data foundation *once* so teams/billing/SSO bolt on later with no painful re-migration.

**North star (the founder's words):** "把基础直接做好，当成完整的 SaaS database 来设计，未来就不用多做一次工作。" The foundation must be designed once. The one thing expensive to change later is **what `ownerId` points at** — so we get that right now, and everything else is additive.

**Grounding:** This design is the synthesis of four adversarial research passes (org-as-tenant data model; credits ledger; Clerk-vs-next-auth; managed-auth comparison), each with an independent reviewer. All `approved`/`approved-with-fixes` verdicts and their required fixes are folded in below. Money-handling (credits, spend path) gets max review rigor (Codex + money-safety gate) per the proportional-rigor rule; additive migrations only; no auto-commit/push; surgical changes.

---

## 1. Decisions (locked)

| Axis | Decision | Why |
|---|---|---|
| Tenancy model | **Org-as-tenant** (Organization = tenant; even a solo merchant is a personal org of 1) | Industry standard; migration-immune — adding teammates later is an INSERT, never a re-key |
| Granularity | Per-user (each user → one personal org) for beta | Matches "individual merchants giving feedback"; teams deferred |
| Existing data | Stays owned by the **founder** org, seeded with literal id `"founder"` | Zero data backfill, zero R2 re-key (see §3.1) |
| Ownership column | Keep `ownerId` (no rename, no parallel `organizationId`); its *meaning* becomes "owning Organization.id" | ~20 tables + R2 keys + idempotency indexes untouched |
| Two role axes | `User.role` (platform-staff /admin RBAC) **separate from** `Membership.role` (per-org) | Conflating them is the headline security hole |
| Auth | **Harden next-auth for beta → migrate to Better Auth before paid GA** | next-auth isn't insecure, but Auth.js is patch-only since 2025-09 and its authors point new builds at Better Auth; Better Auth keeps identity in our Neon DB, $0, zero-migration-safe |
| Managed auth (Clerk/WorkOS/Auth0) | **Deferred bolt-on** (WorkOS AuthKit, identity-only) — only when a paying enterprise demands SAML/SCIM | Clerk Orgs break the zero-migration trick; managed relocates PII + adds US data-residency/cost/lock-in we don't need in a free beta |
| Spend safety | A per-org **credits ledger** IS the spend cap (closes the long-open M1 finding) | Reserve-at-submit blocks generation when balance is low → a hard per-org ceiling |
| Credits unit | Internal: integer, 1 credit = $0.01. **Display: decoupled, 1 credit = $0.10** (image = 1 credit; video by the second) | Legible round per-action costs + numerosity, without a per-model price table |
| Beta grant | **1,000 credits/org**, one-time, no expiry during beta | Funds the full aha-loop + a 2nd project; true fal cost only ~$40–60 |
| Out-of-credits | **Block new generations + friendly "you've hit your beta limit — reply and we'll top you up"**; admin tops up manually | Safe-by-default; turns the wall into a feedback/relationship moment |
| Payments | **Deferred** (Stripe). Schema is payment-ready (a purchase is one additive credit grant) | Beta is free; pricing model undecided — building checkout now = rework |
| Presentation ethics | Transparent: **$-equivalent always visible** (not removed at monetization); honest pack math; **top-up never gated on feedback** | B2B merchants think in unit economics; trust > tricks |

---

## 2. Architecture overview

Four concerns, one shared root (the org). Each is independently shippable; the dangerous "go multi-tenant" flip is gated and last.

1. **Tenancy** — `Organization` + `Membership`; `ownerId == Organization.id`; founder seed.
2. **Isolation enforcement** — one tenant-scoped data seam + lint/test guards; fix the latent IDOR queries.
3. **Credits** — `CreditAccount` (hot balance) + `CreditLedger` (append-only audit); reserve/settle/refund wired into the existing idempotent spend path.
4. **Auth + ops** — harden next-auth (flip the perimeter wall on), Sentry, Account page; migrate to Better Auth pre-GA.

The foundation is **auth-agnostic**: the only auth touchpoints are one `requireOwner()` resolver (session → `ownerId`) and the `events.signIn` org-bootstrap. Both next-auth and Better Auth expose the same session shape, so the auth choice does not block the foundation.

---

## 3. Tenancy (org-as-tenant)

### 3.1 The zero-migration trick (the crux)

Every business table already has `ownerId String @default("founder")`, and `"founder"` (`FOUNDER_OWNER_ID`, `packages/core/src/storage-key.ts`) is baked into R2 keys via `storageKey() → u/${ownerId}/${hash}.${ext}`. Therefore:

- Seed an `Organization` whose **primary key is the literal string `"founder"`**.
- Every existing row already satisfies `ownerId == "founder"` → the FK validates against existing data with **zero row backfill**, **zero R2 re-key**, **zero change** to `Asset @@unique([ownerId, contentHash])` or the partial-unique idempotency indexes.
- New orgs get a ULID id (passes the existing `/[^0-9A-Za-z_-]/` charset validator unchanged).

**Hard rule (guard with a test):** `FOUNDER_OWNER_ID` must always equal the seeded founder org id. Changing it orphans every existing R2 blob. A CI test asserts the constant's value never drifts. **Provider org ids (Clerk `org_…`, etc.) are forbidden in `ownerId`** — a money-safety-review check; a test asserts `storageKey()` never receives a provider id.

### 3.2 New models

```
model Organization {
  id          String    @id            // ULID for new orgs; literal "founder" for the seed
  name        String    @default("")
  slug        String?   @unique         // future tenant routing; nullable now
  deletedAt   DateTime?                 // RESERVED NOW (account closure / GDPR erasure)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  memberships Membership[]
  creditAccount CreditAccount?
  creditLedger  CreditLedger[]
}

model Membership {
  id        String    @id              // ULID
  userId    String
  orgId     String
  role      String    @default("owner") // per-org: owner|admin|member (core ORG_ROLES zod, NOT a PG enum, NOT User.role)
  status    String    @default("active")// RESERVED NOW (active|suspended|revoked)
  invitedBy String?                     // RESERVED NOW (who invited; future invites)
  deletedAt DateTime?                   // RESERVED NOW (revocation audit)
  createdAt DateTime  @default(now())
  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  org  Organization @relation(fields: [orgId],  references: [id], onDelete: Cascade)
  @@unique([userId, orgId])
  @@index([orgId, role])
  @@index([userId])
}

// User: add `activeOrgId String?` (RESERVED NOW — the active-org carrier, so a future
// multi-org switcher never forces an auth-table migration) + `memberships Membership[]`.
// User.role (platform-staff RBAC) is UNCHANGED.
```

`packages/core/src/org-roles.ts` (NEW, separate from `roles.ts`): `ORG_ROLES = ["owner","admin","member"]` + `isOrgRole()` zod guard. A String column validated in code, **not** a Postgres enum (matches house style — adding a role later needs no migration). **Do not** build an org-role permission matrix or any owner-only-destructive enforcement until a second member exists (YAGNI).

**Reserved-now columns** (`Organization.deletedAt`, `Membership.status`/`deletedAt`/`invitedBy`, `User.activeOrgId`) are free to add while creating the tables and remove the exact "add a column to a live multi-tenant table later" friction the foundation exists to avoid. They are unused in beta.

### 3.3 The two role axes (must stay separate)

- **`User.role`** (existing, `packages/core/src/roles.ts`): platform-staff RBAC (super-admin/ops/finance/moderator/viewer) gating the internal `/admin` console. A property of a person. **Unchanged.**
- **`Membership.role`** (new): per-tenant RBAC (owner/admin/member) — what a merchant may do inside *their* workspace.

A platform support engineer (`User.role = super-admin`) must **not** thereby get write access inside a customer org — that requires a Membership. Never merge the two; never fall back to `User.role` for tenant-scoped checks. The founder maps to both independently: platform super-admin (via `FOUNDER_ADMIN_EMAILS` self-heal) **and** owner of the `"founder"` org (via Membership).

### 3.4 Migration sequencing (additive, reversible, lock-safe)

- **Pre-flight:** `SELECT DISTINCT "ownerId"` across all business tables in prod to confirm every row is exactly `"founder"` before adding FKs.
- **Additive only:** create tables + seed the founder org `ON CONFLICT DO NOTHING` in the same migration; the seed must precede any FK.
- **FK lock-safety:** for hot tables (Generation, Asset, GenJob, RefGenJob, RenderJob, ActionEvent) hand-write `ADD CONSTRAINT … FOREIGN KEY … NOT VALID` (instant) then a separate `VALIDATE CONSTRAINT` (scans but doesn't block reads/writes) — never ship Prisma's default validating FK on a large table (Railway auto-migrate would `ACCESS EXCLUSIVE`-lock it mid-deploy).
- **Do not** `ON DELETE CASCADE` from Organization to business tables — org deletion must be deliberate, not an FK side-effect.
- Founder `Membership` is created **lazily** in `events.signIn` (idempotent upsert), since the founder User row may not exist until first sign-in.

---

## 4. Isolation enforcement

The app is single-tenant today (one tenant = `"founder"`), so there is no live leak now. ~4 queries forget to filter by owner (latent IDOR) and **detonate the instant `ownerId` carries real per-tenant values**. Enforcement is built *before* that flip.

- **Primary seam — a tenant-scoped data layer** (`packages/db/src/scoped.ts`): the only module allowed to import the raw Prisma client. Exports `forTenant(ownerId)` whose methods always scope by `ownerId`. This formalizes the existing `OWNED = { ownerId, deletedAt: null }` + verify-then-act idiom already in `actions.ts`. It composes with existing `$transaction` blocks and the two `$executeRaw` alias mutations (which keep their hand-written `AND "ownerId" = …` — a query extension can't rewrite SQL strings).
- **The guarantee** reframed from "is every WHERE correct?" (unprovable) to "does anything outside the seam touch owner-scoped models?" (greppable): (1) ESLint `no-restricted-imports` banning the raw client outside `packages/db/src/scoped.ts` + `apps/worker`; (2) a CI grep tripwire on `prisma.<tenantModel>.` in `apps/web`.
- **Backstop — a Prisma client extension** injecting the `ownerId` filter on `$allModels` reads/writes. Documented blind spots (raw SQL, nested writes, `findUnique`-by-unique-key) are owned by the repository, so they don't overlap. It's a backstop, never the sole guarantee.
- **The `/files` route is a cross-tenant IDOR (Codex BLOCKER — added):** `storageKeyToSrc()` emits `/files/${key}` and `apps/web/app/files/[...key]/route.ts` only checks `allowed(session.email)`, then serves/presigns the requested key **without comparing the key's embedded owner to the session org**. Any authed user could fetch another org's blobs by key. **Fix (Phase 3): `/files` must call `requireOwner()` and reject when `parseStorageKey(joined).ownerId !== ownerId`.** This is the storage-layer twin of the DB isolation and must be in the Phase-3 gate.
- **Fix the latent IDOR now (hard beta deliverable, with tests) — the full list (Codex-corrected):** scope `getShots` by `ownerId` (`apps/web/lib/data.ts`); scope `resolveCoworkResultUrls`'s `genJob.findMany`/`generation.findMany` by `ownerId` (**prioritized — it reads `spentUsd`, i.e. cross-tenant cost visibility**); scope `getRenderJobs`' `asset.findMany` (`apps/web/lib/actions.ts`); **`ownedAssetFromSrc` already has a DB owner filter but discards the owner embedded in the storage key — it must verify the key's `ownerId` matches the caller's** (not just filter the row); add owner filters to the **second-hop reads** `getGenJob` / `getRecentGenResults` (`apps/web/lib/gen-actions.ts`). Free under single-tenant; removes the landmines before the flip detonates them.
- **Admin reads are cross-tenant BY DESIGN** (the `/admin` console aggregates across the platform). They are gated by `User.role` (staff RBAC) and must be **excluded** from `forTenant()` — never silently rewritten to session-org scope. The two `$executeRaw` alias sites and the admin `FOUNDER_OWNER_ID` reads are enumerated explicitly in the flip checklist (the ESLint/grep guard won't catch them).
- **The 2-org isolation test** (seed org A + B; assert B can't read/charge A's projects/assets/generations/credits/threads) ships **with the flip** (Phase 3) — before the flip every `ownerId` is `"founder"` and the assertions would be vacuous.

---

## 5. Credits ledger

### 5.1 Why this also solves M1

A per-org credits ledger with **reserve-at-submit** is a hard per-org spend ceiling: a generation is refused before it's created when the balance can't cover its cost. Granting an org N credits *is* its spend cap. **Building credits closes the long-open M1 ("no spend cap") finding** — there is no separate dollar-cap to build, and no reliance on an unbuilt backstop.

**Charge vs cost:** the credit **debit = what we charge the user** (the priced amount, with margin); `spentUsd` = **what fal charges us** (record-only, unchanged). Margin = price − cost. Both are tracked; they cross-check (`sum(debits)*$0.01 ≈ sum(spentUsd)`).

### 5.2 Models

```
model CreditAccount {            // hot mutable counters; ONE row per org
  orgId    String  @id           // == ownerId
  balance  Int     @default(0)   // spendable now (internal credits, 1 = $0.01); never Float
  reserved Int     @default(0)   // held in-flight
  updatedAt DateTime @updatedAt
  org Organization @relation(fields:[orgId], references:[id])
}
enum CreditTxnKind   { GRANT RESERVE SETTLE REFUND ADJUST }
enum CreditTxnSource { ADMIN BETA PROMO PURCHASE SYSTEM }   // PURCHASE reserved until Stripe
model CreditLedger {             // append-only audit; source of truth for BOTH counters
  id String @id
  orgId String
  balanceDelta  Int              // signed change to CreditAccount.balance
  reservedDelta Int              // signed change to CreditAccount.reserved
  kind   CreditTxnKind
  source CreditTxnSource @default(SYSTEM)
  reason String  @default("")
  refId  String?                 // GenJob.id / RefGenJob.id (1:1 with one job/reservation; a job may emit multiple outputs); null for GRANT/ADJUST
  stripePaymentIntentId String?  // RESERVED for future Stripe
  idempotencyKey String          // "grant:<uuid>" | "signup:<orgId>" | "stripe:<eventId>"
  createdBy String @default("")
  createdAt DateTime @default(now())
  org Organization @relation(fields:[orgId], references:[id])
  @@unique([orgId, idempotencyKey])
  @@index([orgId, createdAt])
}
// migration.sql (Prisma can't express a partial unique) — the exactly-once guard for worker writes:
//   CREATE UNIQUE INDEX "CreditLedger_ref_kind_once"
//     ON "CreditLedger"("orgId","refId","kind") WHERE "refId" IS NOT NULL;
```

**Ledger accounting (the fix for the inconsistency Codex caught).** The single signed `amount` was wrong: a RESERVE just *moves* credits from `balance` to `reserved` (net total unchanged), so a `-cost` amount made `sum(amount) == balance + reserved` false. Instead the ledger records **two explicit deltas**, and the credit charged is a **deterministic priced amount** (see §5.3), so reserve and settle are equal by construction — there is no variable actual-cost reconciliation:

| Event | balanceDelta | reservedDelta | net total (balance+reserved) |
|---|---|---|---|
| GRANT / ADJUST | ±N | 0 | ±N |
| RESERVE (submit) | −priced | +priced | 0 (hold) |
| SETTLE (success) | 0 | −priced | −priced (charge finalized) |
| REFUND (terminal fail) | +priced | −priced | 0 (released) |

**Invariants (out-of-band reconciliation test, not a cron):** `CreditAccount.balance == Σ balanceDelta` and `CreditAccount.reserved == Σ reservedDelta` per org. Never mutate `balance`/`reserved` without writing a matching ledger row in the same transaction; never expose a raw balance write.

### 5.3 Price (what we charge) vs cost (what fal charges) — two distinct numbers

Codex caught a contradiction: we want margin (charge a flat 1 displayed credit for a ~$0.04 image), so the charge is **not** `usdToCredits(spentUsd)`. There are two numbers, defined once:

- **`pricedCreditCost(req)` — the CHARGE (what we debit the user), in internal credits.** Deterministic from the request; a whole number of *displayed* credits (×10 internal) with margin baked in. Image = 1 displayed credit = 10 internal (≈ $0.10 vs ~$0.04 true cost). Video = `ceil(seconds × displayRate)` displayed credits → ×10 internal (display rate per second by model class; mapping internal, never a per-model *dollar* table to the user). This is what RESERVE / SETTLE / REFUND all use.
- **`spentUsd` — the true fal COST.** Unchanged, record-only (`genSpentUsd`/`refgenSpentUsd` in `packages/core/src/spend.ts`); the worker still snapshots it. It does **not** drive the user's debit; it's kept only for our margin analytics. The two cross-check: `Σ(charged credits) × $0.01` should exceed `Σ spentUsd` by the margin.

Constants live once in `packages/core/src/spend.ts`: `CREDITS_PER_USD = 100` (internal accounting only), `DISPLAY_CREDITS = 10` internal per displayed credit, and `pricedCreditCost()` over the existing pricing inputs — **no second price catalog** (the per-model rates are the existing ones; only the rounding-to-displayed-unit + margin is new).

**Because the charge is deterministic, RESERVE == SETTLE always — there is no variable actual-cost delta to refund.** SETTLE simply finalizes the held priced amount (§5.4). A unit test asserts `pricedCreditCost(req)` is stable for a given resolved request (so the held amount and the settled amount are identical and the balance can never be driven negative).

### 5.4 Deduction flow (reserve → settle → refund)

The six spend sites converge on **two insert points** (`startGen` — which `coworkGenerate` funnels through; `startRefGen` + `dispatchVariantJob` — which `createVariant`/`regenerateVariant` funnel through) and **two worker points** (gen + refgen commit/terminal). One shared helper trio: `reserveCredits` / `settleCredits` / `refundReservation`.

We charge the deterministic `priced = pricedCreditCost(req)` (§5.3), so the three operations are simple holds — there is no variable actual-cost reconciliation.

- **RESERVE (atomic, closes the over-spend race)** — inside the existing job-insert `$transaction`:
  `updateMany({ where:{ orgId, balance:{ gte: priced } }, data:{ balance:{ decrement: priced }, reserved:{ increment: priced } } })`; if `count === 0` throw `InsufficientCredits` → the whole tx rolls back (no job, no queue dispatch, friendly "out of credits"). Postgres row-locks the `CreditAccount` row, so concurrent submits serialize and the loser affects 0 rows — beats read-then-write (which has a TOCTOU window). Write the RESERVE ledger row (`balanceDelta −priced, reservedDelta +priced`) in the same tx. **Do not** add a second reserve in `coworkGenerate` (it funnels through `startGen`).
- **SETTLE (success only)** — fold into the worker's existing commit `$transaction` (the one that writes `generationIds + spent + spentUsd`): finalize the held charge — `reservedDelta −priced, balanceDelta 0` (the balance was already decremented at reserve). Idempotent via the `(orgId,refId,SETTLE)` partial-unique (a resume re-enters and P2002 no-ops). The resume short-circuit and the `spentUsd`-backfill branches must also call `settleCredits` (a row with no matching RESERVE — historical/in-flight jobs — is a safe no-op). `spentUsd` is still recorded as today (record-only; it does not affect the credit charge).
- **REFUND — the critical fix (the credits reviewer's BLOCKING catch):** the gen worker fails closed via **early `return` (not `throw`) in ~13 pre-spend branches** (deleted project/shot/entity/variant, unreachable refs, disabled model, no i2v source, stale claim). A refund placed only in the `catch` would **leak the reservation forever**. Therefore `refundReservation` (`balanceDelta +priced, reservedDelta −priced` — full release) must run in **every terminal-FAILED transition** — wrap each early-return fail-closed update in a `$transaction([update, refundReservation])`. **The user is fully refunded on ANY terminal failure**, including paid-but-undelivered (fal billed us but delivery failed): the founder absorbs the real fal cost — recorded via `spentUsd` — rather than charging a merchant for a generation they never received. Idempotent via `(orgId,refId,REFUND)`.
- **Web-side post-reserve dispatch failure:** if `boss.send` fails after the reserve committed, the web action marks the job FAILED without a worker ever running — add `refundReservation` in that same FAILED-write tx.
- **Stale-active refgen vs the unique index (Codex catch):** `startRefGen`/`dispatchVariantJob` ignore active jobs older than `STALE_MS`, but `RefGenJob_active_entity_variant_key` still covers all `QUEUED/GENERATING` rows, so a new create hits `P2002` and returns the stale job. With credits, the stale row's reservation must not be stranded: **explicitly terminal-fail the stale active row WITH `refundReservation` before accepting the new reserve** (or drop the stale bypass). Add a test.
- **Lost-claim ownership:** the credit settle/refund for a `refId` is owned **exclusively** by the delivery that wins the `QUEUED→GENERATING` claim (or the resume short-circuit). The loser branch that fails a stale GENERATING row closed performs **no** credit mutation.
- **Requeue branch stays credit-free:** the hold survives the requeue; the eventual resume settles/refunds exactly once.
- `apps/worker/src/jobs/refgen.ts` commit is a **bare update today (apps/worker/src/jobs/refgen.ts:214-221) — it MUST be wrapped** in a `$transaction` with `settleCredits`.
- **No** distributed locks / saga / advisory locks — the single-row conditional UPDATE inside the existing tx is the entire concurrency primitive and composes with the existing atomic claim + idempotency indexes.

### 5.5 Admin grants

Add a `credits` section to the existing `roleAllows` matrix (`packages/core/src/roles.ts`): `credits: { read: {finance}, mutate: {finance} }` (super-admin supersedes; `cost` stays read-only — granting money is a higher-trust mutate). One `grantCredits(orgId, amount, reason)` action (signed amount; negative = adjust-down) gated by `requireRole("credits","mutate")`, writing the ledger row + `CreditAccount` increment + `ActionEvent` audit in one tx, idempotent on `(orgId, idempotencyKey)`. New `/admin/credits` page (mirrors `/admin/cost`): per-org balance + reserved + grant form + recent ledger. Beta: founder-org-only is acceptable (sidesteps validating an arbitrary `orgId` before other orgs exist). New-org initial allotment = a `BETA_INITIAL_GRANT_CREDITS = 1000` constant, granted idempotently in the org-creation path (`signup:<orgId>`). Seed the founder org's `CreditAccount` with a large BETA grant at migration so there is exactly one code path (reserve→settle) and no founder special-casing (a missing account + fail-closed reserve would lock the founder out).

### 5.6 Presentation (transparent by design)

- **Internal ledger stays $0.01 integer.** Display a decoupled unit: **1 displayed credit = $0.10** (divide internal by 10 only at the view seam; never let displayed credits drive deduction/idempotency/refund). Image = **1 credit**; video by the **second** (e.g. Standard 2 cr/s, HD 6 cr/s — model→rate mapping internal; live cost on the Generate button before the click).
- **A `≈ $X` equivalent is shown permanently** — next to the balance and the per-action cost, in the generation flow, **not removed at monetization**. (Removing transparency the moment money is real is the dark pattern; transparency that survives monetization is just honest pricing.)
- Balance: one round number top-right (numerosity), with the persistent `≈ $` subtitle.
- **Out of credits → block + friendly message** ("you've hit your free beta limit — reply and we'll top you up"); soft low-balance nudges at ~25% and ~10%. The top-up is **unconditional and frictionless** — never gated on giving feedback; the feedback ask is optional and *after* unblocking.
- **No fake-discount framing.** When packs eventually ship (post-Stripe), honest per-credit math, no "save X% / bonus / best value" against a self-invented rate; honor leftover credits (no engineered breakage). **Public pack pricing + the $0.10 ratio commitment + competitor-rate/EU-CPC verification are deferred to when Stripe lands** — beta does not lock public pricing.

### 5.7 Credits must cap ALL real fal spend, not just generation (Codex BLOCKER — added)

The credits gate covers `GenJob`/`RefGenJob` (the image/video spend). But **cowork has paid fal LLM paths *outside* those jobs**: `enhancePrompt`, `coworkDraftStoryboard`, and `coworkTurn` call the planner transport (`getTransport()`/`runSkill()`/`transport.chat()`), and `FalTransport` hits `https://fal.run/openrouter/...` (`apps/web/lib/cowork-actions.ts`, `packages/core/src/cowork-transport.ts`). If `COWORK_PROVIDER=fal`, a beta merchant could run unbounded LLM cost the credits ceiling never sees. Self-hosted ffmpeg render and whisper.cpp captions/transcripts are `$0` (fine).

**Beta rule (pre-beta config gate, Phase 0):** the planner must be `$0` during beta so the only real fal spend is generation, which credits fully cap. Enforce it on the **effective** provider — note the provider is resolved from the DB `runtimeConfig.cowork_provider` key which **overrides** the `COWORK_PROVIDER` env var, so the gate must check the resolved value (DB override + env fallback), not just the env. Assert at startup/CI that the effective planner is `mock`/self-hosted/free while beta is on (or, if a paid planner is ever enabled, meter it against the same credit ledger via a small fixed reserve per cowork turn). Document both `COWORK_PROVIDER` and the `runtimeConfig.cowork_provider` override in the env checklist.

---

## 6. Auth + ops

### 6.1 Beta: harden next-auth (now, ~half a day, zero migration)

next-auth/Auth.js v5 is **not insecure** — and this app is structurally safe from the recent Next.js middleware-bypass class (CVE-2025-29927) because it uses DB sessions and re-asserts the allowlist *inside* handlers, not via middleware gating. Beta hardening:

- **Flip the perimeter wall on** — `AUTH_ENABLED` is currently `!== 'true'` (`apps/web/proxy.ts`), so the middleware wall is **off**; only the in-handler guards enforce. Set `AUTH_ENABLED=true` + `RESEND_API_KEY` **before the first cost-incurring endpoint ships**, and smoke the wall once (it has never run enforced). **This is the real pre-beta auth task — not a provider migration.**
- Pin the next-auth beta version; confirm it builds clean + review the changelog before any dep bump.
- Move the in-memory magic-link rate-limit to a shared store before multi-node.
- (Optional) add a Google provider (~15 lines, same PrismaAdapter) if sign-up friction warrants.

### 6.2 Pre-GA: migrate to Better Auth (separate, ~2–4 days, never mid-beta)

Auth.js is patch-only since 2025-09 and its authors direct new builds to **Better Auth** (its designated successor). Migrate the *library*, not the data: Better Auth stores User/Session/Account in the **same Neon DB** (identity stays ours; EU residency is our choice via Neon's EU region), its **organization plugin stays OFF** (we keep our own Organization/Membership), `User.id` stays `cuid` (Membership/Credit FKs never need a second migration), Account/Session map ~1:1. SSO/SCIM via Better Auth's plugin is self-hosted ($0 license, but real security-critical eng — see §8).

**Mandatory lockout-avoidance preconditions (not optional):** stage on a DB clone; dry-run a login **and one end-to-end generation** before deleting the old path; keep `User.id = cuid` stable; additive + reversible schema; never touch the founder seed / `ownerId` / R2 keys.

### 6.3 Session → ownerId seam

One `requireOwner()` resolver (sibling to `requireSession`/`requireRole` in `apps/web/lib/auth-guard.ts`): re-assert `auth()` + `allowed()` (allowlist stays the outer invite gate), resolve the caller's active org, return `{ email, ownerId }`. Every spend/data site uses it instead of the `FOUNDER_OWNER_ID` constant.

**`requireOwner()` MUST fail closed (Codex sharpening):** it must **never** fall back to `"founder"` for a non-founder session — that would silently hand a new user the founder's data/credits. If the membership isn't present yet, **bootstrap synchronously** (create the personal Organization + Membership + `CreditAccount` with the beta grant, idempotently) and return the new org id; if bootstrap can't complete, return `{ error }`, never a default owner. Only a `FOUNDER_ADMIN_EMAILS` session may ever resolve to `"founder"`. `events.signIn` still does the same bootstrap best-effort/never-block as a convergence path, but correctness does not depend on it having run — `requireOwner()` is the authoritative, fail-closed resolver. This seam is identical under next-auth and Better Auth.

### 6.4 Managed auth (deferred bolt-on)

If a paying enterprise merchant later demands SAML/SCIM: bolt on **WorkOS AuthKit** identity-only (free to 1M MAU; SSO billed per-connection, billable to that enterprise; map its opaque `user_…` via a nullable `providerUserId` on User; **never** adopt its Organizations primitive; resolve identity from the verified session and get-or-create User+Membership **inside** the spend transaction — never gate spend on a webhook mirror). Revisit EU residency at that point (WorkOS US-only today). **Not built now.**

### 6.5 Ops

- **Sentry (or equivalent)** wired for web + worker before inviting external users (zero monitoring today; a real-money app must not be blind).
- **Account page** (`/account`): who am I, sign out, current org balance + usage from the ledger. Read-mostly, additive.

---

## 7. Phased rollout

Each phase is independently Railway-deployable (push = auto-deploy + auto-migrate). Spend-path phases (2, 3) pass the **/codex money-safety gate** before deploy. Tests use `GENERATION_PROVIDER=mock` (no real fal; kill stale fal workers first).

- **Phase 0 — Beta safety prerequisites (no schema):** flip `AUTH_ENABLED` on + `RESEND_API_KEY` + smoke the wall; **assert `COWORK_PROVIDER` is `$0` (mock/self-hosted) — close the un-capped cowork-LLM fal spend (§5.7)**; pin next-auth; shared rate-limit; Sentry; fix the full latent-IDOR list (§4: `getShots`, `resolveCoworkResultUrls`, `getRenderJobs`, `ownedAssetFromSrc` key-owner check, `getGenJob`/`getRecentGenResults` second-hop) + tests; the `FOUNDER_OWNER_ID === seeded-org-id` guard test; ESLint/grep raw-client ban skeleton. *Low risk, ships first.*
- **Phase 1 — Tenancy schema (additive, zero data change):** Organization + Membership + reserved columns; `org-roles.ts`; seed founder org id=`"founder"`; lazy founder Membership in `events.signIn`; FK `NOT VALID`+`VALIDATE` on hot tables. Dormant (app still uses the constant).
- **Phase 2 — Credits ledger, founder-scoped (delivers M1):** CreditAccount + CreditLedger (two-delta); `pricedCreditCost()` (the deterministic charge, with margin) kept separate from record-only `spentUsd` + a test that `pricedCreditCost(req)` is stable (so reserve == settle, balance never negative); reserve/settle/refund helpers wired into all 6 spend sites + both worker commit/terminal paths (**every fail-closed branch refunds**; refgen.ts wrapped; resume settles; lost-claim ownership; requeue credit-free; web-side dispatch-fail refund); seed founder a large grant; display decoupling + permanent `≈$`; out-of-credits block + nudges; `/admin/credits` (finance RBAC) + grant action. Enforces against the (one) founder org — proves the machinery. **Codex money-safety gate.**
- **Phase 3 — Multi-tenant flip (point of no return, gated):** `requireOwner()` resolver (**fail-closed, never falls back to `"founder"`**, §6.3); `events.signIn` + synchronous personal-org + CreditAccount(+grant) bootstrap; replace `FOUNDER_OWNER_ID` reads with the resolver across spend + data sites. **Flip checklist (must ALL be covered or it's an open leak):** the 2 `$executeRaw` alias sites; admin cross-tenant reads (kept out of `forTenant()`); **the `/files` route owner check (§4)**; second-hop reads (`getGenJob`/`getRecentGenResults`); `ownedAssetFromSrc` key-owner verification; direct upload/finalize paths; caption/transcript reads; **confirm cowork LLM is `$0` (§5.7)**. Prisma extension backstop; **2-org isolation test green** (covers `/files` + spend + cost visibility). After this, invite real merchants. **Codex money-safety gate.**
- **Phase 4 — Auth successor + UX (pre-GA):** Account page; migrate next-auth → Better Auth (mandatory lockout precautions). Beta runs on hardened next-auth until here.

---

## 8. Verification

- **Core vitest:** tenancy isolation (two owners can't see each other's projects/assets/generations/credits/threads); credit math + **every fail-closed refund branch** (the two-delta ledger invariants `balance == Σ balanceDelta`, `reserved == Σ reservedDelta`); `pricedCreditCost()` stability (reserve == settle); `spentUsd` stays record-only; backward-compat parse; the `FOUNDER_OWNER_ID` guard.
- **2-org isolation table** (Phase 3): every repo method asserts org B gets `[]`/`null`/throws for org A's ids; a meta-test fails if `forTenant()` gains an unexercised export.
- **Money-safety/Codex gate** on Phase 2 + 3 (spend path = max rigor) — must confirm no double-credit-spend, no leaked reservation, all 6 spend sites covered, no unscoped query, no provider id in `ownerId`.
- **Local ffmpeg/mock** for any gen test; **never** real fal; kill stale fal workers first.
- A manual **/qa** pass on the running beta build.

---

## 9. Out of scope (deferred; all additive later, no re-migration)

Team invites / multi-seat UI; Stripe / billing / subscriptions / public pack pricing; SSO / SAML / SCIM (and the managed-auth bolt-on); Postgres RLS (revisit before GA / untrusted tenants — `ownerId` is shaped so it's additive); org-switcher UI; per-org org-role permission matrix; renaming `ownerId → organizationId`; a `createSpendJob` insert funnel (the shared credit helpers already give the deletion-test property); sample-project onboarding polish (lazy "My First Project" already exists).

---

## 10. Risks carried forward

- **R2 orphaning (highest, permanent):** never change the founder org id away from `"founder"`. Guarded by a test.
- **Premature flip:** the latent-IDOR queries **and the `/files` route** become live cross-tenant leaks the instant `ownerId` carries real values — the flip (Phase 3) is gated on the full flip-checklist + 2-org isolation test + Codex.
- **Un-capped cowork LLM spend:** if `COWORK_PROVIDER` is a paid provider, `enhancePrompt`/`coworkDraftStoryboard`/`coworkTurn` spend fal money the credits ceiling can't see — Phase 0 asserts `$0` planner (§5.7).
- **Refund leak:** refund must live in every terminal-FAILED branch, not just the catch (the worker fails closed via early `return`).
- **Hot-row contention:** one `CreditAccount` row per org serializes that org's concurrent submits (correct; a non-issue at beta scale).
- **Token-priced models** (seedance-2, grok-imagine) bill approximately; the founder absorbs the small gap during beta (same as today's record-only ledger); bump a model's rate to a ceiling if drift proves material — don't build a true-up engine.
- **Better Auth migration** is the one cutover that can lock the founder out — the §6.2 preconditions are mandatory.
