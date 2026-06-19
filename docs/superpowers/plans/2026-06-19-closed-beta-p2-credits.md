# Closed-Beta Phase 2 — Credits Ledger (delivers M1 spend cap) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development / executing-plans. Steps use `- [ ]`. This is a MONEY-PATH phase → triple gate (Codex + workflow QA + money-safety-review) before done.

**Goal:** A per-org credits ledger that IS the spend cap (closes M1). Reserve-at-submit / settle-at-commit / refund-on-fail, composed with the existing exactly-once spend machinery. Charge = a deterministic `pricedCredits` (with margin), separate from record-only `spentUsd`. Founder-scoped (one org) in P2 — the per-tenant flip is P3.

**Architecture:** Two new tables — `CreditAccount` (hot mutable `balance`+`reserved`, Int internal credits where 1 = $0.01) and `CreditLedger` (append-only audit, **two signed deltas** `balanceDelta`/`reservedDelta`). One credit-service module (`packages/db/src/credits.ts`) exporting `reserveCredits`/`settleCredits`/`refundReservation`/`grantCredits`, the ONLY writers of the account. Reserve = atomic conditional `updateMany(balance>=cost)` inside the existing job-insert `$transaction`. Settle = fold into the worker commit tx. Refund = every terminal-FAILED transition. All idempotent via a partial-unique `(orgId,refId,kind)` index.

**Tech Stack:** Prisma 7.8 (local migration), Postgres, vitest (core math), `@artlio/core` for the pure `pricedCredits`.

**House rules:** LOCAL migration only (never prod); the charge is deterministic so reserve==settle (no variable delta); never expose a raw balance write; surgical; NO auto-commit/push. **The triple gate (Codex + workflow QA + money-safety-review) MUST pass before P2 is done.**

**Grounded integration points (verified this session):**
- Reserve sites (the 2 `*.create` the 6 spend paths converge on): `startGen` (`apps/web/lib/gen-actions.ts:92`, also serves `coworkGenerate`) and `startRefGen`+`dispatchVariantJob` (`apps/web/lib/refgen-actions.ts:79,161`).
- gen worker settle: commit tx (`apps/worker/src/jobs/gen.ts:398-418`) + resume short-circuit (`:155-164`) + spentUsd-backfill branch (`:162`). gen worker refund: ~13 fail-closed `update→return` branches (`:177,:183,:191,:213-216 stale,:237,:247,:257,:266,:327,:339,:357`) + catch `final` (`:450-458`).
- refgen worker settle: wrap the BARE commit update (`apps/worker/src/jobs/refgen.ts:217`) in a tx; resume (`:79-90`) + backfill (`:84-86`). refgen refund: `:70-73,:103-106,:118,:134-137 stale` + catch `final` (`:233-241`).
- Worker requeue branches touch NO credits (hold survives → resume settles once).

---

### Task 1: Credit math (core, pure, TDD)

**Files:** Modify `packages/core/src/spend.ts`; Test `packages/core/src/spend.test.ts` (exists); Export already via `export * `? confirm — spend.ts is exported from index.

- [ ] **Step 1: Failing tests** (append to `spend.test.ts`)

```ts
import { pricedGenCredits, pricedRefgenCredits, displayCredits, CREDITS_PER_USD, INTERNAL_PER_DISPLAY } from "./spend.js";

describe("credit pricing (deterministic CHARGE in internal credits; 1 internal = $0.01, 1 displayed = 10 internal)", () => {
  it("image = 1 displayed credit (10 internal) PER image — flat, with margin over the ~$0.04 true cost", () => {
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })).toBe(10);
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null })).toBe(40);
  });
  it("video = cost rounded UP to the $0.10 displayed unit × 10 (>= true cost, deterministic)", () => {
    const c = pricedGenCredits({ kind: "VIDEO", model: "kling-2.5", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } });
    expect(c % INTERNAL_PER_DISPLAY).toBe(0); // whole displayed credits
    expect(c).toBeGreaterThanOrEqual(10);     // at least 1 displayed credit
  });
  it("refgen = 1 displayed credit per image", () => {
    expect(pricedRefgenCredits({ model: "seedream", count: 1 })).toBe(10);
    expect(pricedRefgenCredits({ model: "seedream", count: 3 })).toBe(30);
  });
  it("displayCredits converts internal→displayed", () => {
    expect(displayCredits(2500)).toBe(250);
    expect(CREDITS_PER_USD).toBe(100);
  });
});
```

- [ ] **Step 2: Run → FAIL** `pnpm --filter @artlio/core test spend`
- [ ] **Step 3: Implement** in `packages/core/src/spend.ts` (append)

```ts
/** Internal credit accounting unit: 1 internal credit = $0.01. The LEDGER + balance
 *  are in internal credits. */
export const CREDITS_PER_USD = 100;
/** Display denomination: 1 user-facing credit = 10 internal = $0.10. Charges are whole
 *  displayed credits (×10 internal) so per-action costs read as small round numbers. */
export const INTERNAL_PER_DISPLAY = 10;
const USD_PER_DISPLAY_CREDIT = 0.1;

/** Displayed credits from a USD amount: round UP to the $0.10 unit, min 1 (never
 *  under-charge; never zero). */
function displayedFromUsd(usd: number): number {
  return Math.max(1, Math.ceil(usd / USD_PER_DISPLAY_CREDIT));
}

/** DETERMINISTIC charge in INTERNAL credits for a gen job. Image = 1 displayed credit
 *  PER image (flat — the clean unit, ~2.5x margin over true cost). Video = true cost
 *  rounded up to the $0.10 unit (>= cost). Separate from genSpentUsd (record-only true
 *  fal cost). reserve uses this; settle finalizes the SAME value → no variable delta. */
export function pricedGenCredits(job: GenSpendInput): number {
  if (job.kind === "VIDEO") return displayedFromUsd(genSpentUsd(job)) * INTERNAL_PER_DISPLAY;
  return job.count * INTERNAL_PER_DISPLAY; // 1 displayed credit per image
}
export function pricedRefgenCredits(job: RefGenSpendInput): number {
  return job.count * INTERNAL_PER_DISPLAY; // 1 displayed credit per image
}
/** Internal credits → user-facing displayed credits (view seam only). */
export function displayCredits(internal: number): number {
  return internal / INTERNAL_PER_DISPLAY;
}
```

- [ ] **Step 4: Run → PASS**; `pnpm --filter @artlio/core build`.
- [ ] **Step 5: (leave for user) commit.**

---

### Task 2: Credit schema (local migration)

**Files:** Modify `packages/db/prisma/schema.prisma`; new migration via `migrate diff` + psql (same flow as P1 — `migrate dev` would reset the local DB).

- [ ] **Step 1: Add models** (after `Membership`):

```prisma
model CreditAccount {
  orgId     String   @id // == Organization.id (== ownerId)
  balance   Int      @default(0) // spendable now (internal credits, 1 = $0.01); never negative (conditional UPDATE)
  reserved  Int      @default(0) // held in-flight
  updatedAt DateTime @updatedAt
  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
}

enum CreditTxnKind   { GRANT RESERVE SETTLE REFUND ADJUST }
enum CreditTxnSource { ADMIN BETA PROMO PURCHASE SYSTEM } // PURCHASE reserved for future Stripe

model CreditLedger {
  id           String          @id
  orgId        String
  balanceDelta Int             // signed Δ to CreditAccount.balance
  reservedDelta Int            // signed Δ to CreditAccount.reserved
  kind         CreditTxnKind
  source       CreditTxnSource @default(SYSTEM)
  reason       String          @default("")
  refId        String?         // GenJob.id / RefGenJob.id (1:1 with one job/reservation); null for GRANT/ADJUST
  stripePaymentIntentId String? // RESERVED for future Stripe
  idempotencyKey String        // "grant:<uuid>" | "signup:<orgId>" | "stripe:<eventId>"
  createdBy    String          @default("")
  createdAt    DateTime        @default(now())
  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  @@unique([orgId, idempotencyKey])
  @@index([orgId, createdAt])
}
```
Add to `Organization`: `creditAccount CreditAccount?` and `creditLedger CreditLedger[]`.

- [ ] **Step 2: Hand-write the migration** `packages/db/prisma/migrations/20260619130000_credits/migration.sql` via `migrate diff --from-schema <HEAD-or-prev> --to-schema <current> --script`, then ADD the partial-unique exactly-once guard Prisma can't express:
```sql
CREATE UNIQUE INDEX "CreditLedger_ref_kind_once" ON "CreditLedger"("orgId","refId","kind") WHERE "refId" IS NOT NULL;
```
And seed the founder account with a large BETA grant (so the fail-closed reserve can't lock the founder out):
```sql
INSERT INTO "CreditAccount" ("orgId","balance","reserved","updatedAt")
VALUES ('founder', 100000000, 0, CURRENT_TIMESTAMP) ON CONFLICT ("orgId") DO NOTHING; -- founder ~unlimited
INSERT INTO "CreditLedger" ("id","orgId","balanceDelta","reservedDelta","kind","source","reason","idempotencyKey","createdAt")
VALUES ('seedfounderbeta0000000000', 'founder', 100000000, 0, 'GRANT','BETA','founder beta seed','grant:founder-seed', CURRENT_TIMESTAMP) ON CONFLICT ("orgId","idempotencyKey") DO NOTHING;
```
- [ ] **Step 3: Apply local** via `psql -v ON_ERROR_STOP=1 -f migration.sql`, `migrate resolve --applied`, `prisma generate`, `pnpm --filter @artlio/db build`.
- [ ] **Step 4: Verify** founder CreditAccount balance + the unique index present.

---

### Task 3: Credit service (the ONLY account writer) + tests

**Files:** Create `packages/db/src/credits.ts`; export from `packages/db/src/index.ts`; Test against local DB OR via a thin unit on the delta logic (the integration is exercised by the worker + a DB smoke).

- [ ] Implement `reserveCredits(tx, {orgId, refId, cost})`: `updateMany({where:{orgId, balance:{gte:cost}}, data:{balance:{decrement:cost}, reserved:{increment:cost}}})`; if `count===0` throw `InsufficientCredits`; else write the RESERVE ledger row (`balanceDelta:-cost, reservedDelta:+cost`). Takes a tx so it's atomic with the job insert.
- [ ] `settleCredits(tx, {orgId, refId, cost})`: write SETTLE (`reservedDelta:-cost, balanceDelta:0`) — guarded by the `(orgId,refId,SETTLE)` partial-unique (catch P2002 → no-op, for resume idempotency); update account `reserved:{decrement:cost}`. NOTE: must read the original reserved cost; since `cost` is deterministic (`pricedGenCredits(job)`), pass the same value the worker recomputes. If no matching RESERVE exists (historical job), it's a safe no-op (guard: only settle if a RESERVE row exists for this refId).
- [ ] `refundReservation(tx, {orgId, refId})`: look up the RESERVE row's cost for this refId; write REFUND (`balanceDelta:+cost, reservedDelta:-cost`); update account; idempotent via `(orgId,refId,REFUND)` (P2002 → no-op). No-op if no RESERVE row (historical).
- [ ] `grantCredits({orgId, amount, reason, source, createdBy, idempotencyKey})`: tx — write GRANT (`balanceDelta:+amount`) + upsert account `balance:{increment:amount}` + idempotent on `(orgId,idempotencyKey)`.
- [ ] `InsufficientCredits` error class. Export all from `@artlio/db`.
- [ ] Tests: against the local DB (founder has the big seed): reserve→settle leaves balance=grant-cost,reserved=0; reserve→refund returns to grant,reserved=0; over-balance reserve throws; double settle/refund is a no-op (idempotent). (If a DB-test harness is too heavy, a focused integration smoke script + the worker isolation test cover it; document the choice.)

---

### Task 4: Wire RESERVE into the web spend sites

**Files:** `apps/web/lib/gen-actions.ts` (`startGen`), `apps/web/lib/refgen-actions.ts` (`startRefGen`, `dispatchVariantJob`).

- [ ] In `startGen`: compute `const cost = pricedGenCredits({kind: kind==="video"?"VIDEO":"IMAGE", model, count: kind==="video"?1:count, videoOptions: videoOptions ?? null})`. Wrap the existing `genJob.create` in `prisma.$transaction(async tx => { const j = await tx.genJob.create(...); await reserveCredits(tx, {orgId: FOUNDER_OWNER_ID, refId: j.id, cost}); return j; })`. Catch: `InsufficientCredits` → `{error: "You've used up your beta credits — reply and we'll top you up."}`; keep the existing P2002 dedup (returns existing job, NO reserve — the rollback means none happened). **Do NOT add a reserve in coworkGenerate** (it funnels through startGen).
- [ ] In `startRefGen` + `dispatchVariantJob`: same wrap around each `refGenJob.create` with `cost = pricedRefgenCredits({model, count})`. Handle the stale-active-row case (refgen-actions.ts:56-88,150-175): when the dedup returns a STALE active job, terminal-fail it WITH `refundReservation` before accepting the new reserve (else the stale hold leaks) — OR keep returning the stale job (no new reserve). Pick: return the stale job (simplest, no leak — the stale job's hold settles/refunds when the worker eventually terminates it).

---

### Task 5: Wire SETTLE + REFUND into the workers

**Files:** `apps/worker/src/jobs/gen.ts`, `apps/worker/src/jobs/refgen.ts`.

- [ ] **gen worker:** add a `failClosedWithRefund(jobId, ownerId, cost, error)` local helper = `$transaction([genJob.update FAILED, refundReservation])`. Replace each of the ~13 `await prisma.genJob.update({...FAILED...}); return;` fail-closed branches with `await failClosedWithRefund(job.id, job.ownerId, pricedGenCredits(job), "...")` (cost computed once from the job row). Stale-claim (`:213-216`): if the stale `updateMany` count>0, refund. Commit tx (`:398-418`): add `await settleCredits(tx, {orgId: job.ownerId, refId: job.id, cost})`. Resume short-circuit (`:155-164`): add `settleCredits` (idempotent). Catch `final` branch: refund (the hold is still open — settle only ran in the commit tx which didn't complete). Requeue branch: NOTHING.
- [ ] **refgen worker:** WRAP the bare commit update (`:217`) in `$transaction([refGenJob.update(...), settleCredits])`. Resume (`:79-90`) + backfill: settle. The 4 fail branches (`:70,:103,:118,:134`) + catch `final` (`:233`): refund. Use `pricedRefgenCredits(job)`.
- [ ] Verify: each `pricedX(job)` recomputes the SAME deterministic cost the reserve used (test: reserve cost == settle cost for every model).

---

### Task 6: Admin grants + display + out-of-credits UX

- [ ] `roles.ts`: add a `credits` section to SECTION_MATRIX (`read:{finance}, mutate:{finance}`); `roleAllows` + `requireRole` gate it.
- [ ] `apps/web/lib/credit-actions.ts`: `grantCredits(raw)` action → `requireRole("credits","mutate")` + zod-validate (orgId, signed amount, reason) + the service `grantCredits` + `ActionEvent` audit (`credits.grant`) — mirror `saveUserRole` (`admin-actions.ts:163`). Add `credits.grant` to the audit viewer's money-gate types.
- [ ] `/admin/credits` page (mirror `/admin/cost`): founder-org balance + reserved + recent ledger + a grant form. `requireRole("credits","read")`.
- [ ] Display: surface credits in the gen UI — show `displayCredits(balance)` with a permanent `≈ $X` (the transparency rule); on the Generate button show the cost in displayed credits before the click; out-of-credits → the friendly "reply and we'll top you up" block. (UI scope may be trimmed/iterated; the ledger + cap is the must-have.)

---

### Task 7: Phase verify + TRIPLE gate

- [ ] `pnpm -r typecheck` + `pnpm --filter @artlio/core test` green; local DB smoke (reserve/settle/refund/grant arithmetic + idempotency).
- [ ] Capture the P2 diff → **Codex** (money-safety focus: double-spend, leaked reservation, all 6 sites covered, reserve==settle, every terminal-FAILED refunds, requeue clean) + **workflow code-QA** (concurrency / ledger-consistency / dormancy-of-display) + **money-safety-review** skill. Fix all confirmed BLOCKER/STRONG; re-verify. STOP for the user before P3.

---

## Self-Review
**Spec coverage (§5):** ledger two-delta (Task 2/3), pricedCredits vs spentUsd (Task 1/5), reserve/settle/refund all sites (Task 4/5), refund every terminal-FAILED (Task 5), refgen.ts wrap (Task 5), founder seed (Task 2), admin grants + RBAC (Task 6), display + out-of-credits (Task 6), credits=M1 (the conditional reserve). ✅
**Placeholder scan:** none. **Type consistency:** `pricedGenCredits`/`pricedRefgenCredits` signatures match `GenSpendInput`/`RefGenSpendInput`; `cost` (internal credits) is the single currency through reserve/settle/refund; `(orgId,refId,kind)` partial-unique is the idempotency key for all worker writes.
**Money-safety:** charge deterministic → reserve==settle (no negative delta); conditional `balance>=cost` UPDATE → never negative; refund in every terminal branch (the early-return leak); requeue untouched; founder seeded so fail-closed can't lock the founder; triple gate before done.
