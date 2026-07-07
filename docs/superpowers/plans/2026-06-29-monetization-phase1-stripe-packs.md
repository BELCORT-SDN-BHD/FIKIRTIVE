# Monetization Phase 1 — Stripe Credit Packs + Pricing Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on buying credits — create the 3 MYR credit packs in Stripe, set the free-credit grant to 100, set Otto's LLM margin to 1.5×, and verify the (already-built) checkout→webhook→grantCredits flow end-to-end.

**Architecture:** The buy-credits code already exists (PR #22). This phase is config + two tiny code-constant changes + verification. It is **provider-independent** (it does not touch generation; the per-generation credit re-cost + BytePlus migration is Phase 2, a separate plan).

**Tech Stack:** TypeScript, Next.js, Stripe SDK (`apps/web/lib/stripe.ts`), Prisma/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-monetization-credit-packs-byteplus-design.md`.

## Global Constraints

- **Money-in = `grantCredits` only**, idempotent. Do NOT touch the spend path (reserve/settle/gen-gate). This phase only changes two pricing constants + creates Stripe Prices.
- **Credit unit:** 1 display credit = $0.10; `INTERNAL_PER_DISPLAY = 10` (grant amounts are in INTERNAL credits = display × 10).
- **The 3 packs (MYR, TEST mode first):** Starter RM25 → 50 credits · Standard RM100 → 220 credits · Pro RM250 → 600 credits. Each = a Stripe Price with `currency=myr`, `unit_amount` = RM×100 (sen), `metadata.credits` = the credit count, on a named Product.
- **Free-credit grant = 100 display credits** (was 1000).
- **Otto LLM margin default = 1.5×** (was 3).
- **Stripe stays in TEST mode** — do NOT switch to live keys (founder flips live separately). Env layout: dev secrets = main checkout `apps/web/.env.local`; STRIPE_* keys already wired there (memory `fikirtive-stripe-config`).
- **Worktree:** work in `/Users/winnin/Desktop/fikirtive/.claude/worktrees/distracted-maxwell-7d1884` on branch `claude/monetization-credit-packs`; verify `git rev-parse --show-toplevel` + branch before committing; NEVER touch `/Users/winnin/Desktop/fikirtive`. Tests: `pnpm --filter @fikirtive/core test`, `pnpm --filter @fikirtive/web test`.

---

## Task 1: Free-credit grant 1000 → 100

**Files:** Modify `packages/core/src/spend.ts:93` (+ comment at :91-92); Modify `apps/web/lib/__tests__/require-owner.test.ts:87`.
**Interfaces — Produces:** `BETA_INITIAL_GRANT_CREDITS = 100 * INTERNAL_PER_DISPLAY` (= 1000 internal credits = 100 display credits).

- [ ] **Step 1: Update the pinning test first (TDD).** In `apps/web/lib/__tests__/require-owner.test.ts:87`, change `expect(acct?.balance).toBe(1000 * 10);` to `expect(acct?.balance).toBe(100 * 10);` (the new grant = 100 display × 10 internal = 1000 internal). (This test is DB-gated and may not run in the worktree; update it for correctness regardless.)
- [ ] **Step 2: Add a pure unit test that does run** — `packages/core/src/spend.test.ts`: `import { BETA_INITIAL_GRANT_CREDITS, INTERNAL_PER_DISPLAY } from "./spend";` then `it("beta grant is 100 display credits", () => { expect(BETA_INITIAL_GRANT_CREDITS).toBe(100 * INTERNAL_PER_DISPLAY); });`. Run `pnpm --filter @fikirtive/core test spend` → FAIL (still 1000).
- [ ] **Step 3: Change the constant.** `packages/core/src/spend.ts:93`: `export const BETA_INITIAL_GRANT_CREDITS = 100 * INTERNAL_PER_DISPLAY;` and update the comment at :91-92 (`1000 DISPLAYED credits` → `100 DISPLAYED credits`). Run `pnpm --filter @fikirtive/core test spend` → PASS.
- [ ] **Step 4: Commit.** `git add packages/core/src/spend.ts packages/core/src/spend.test.ts apps/web/lib/__tests__/require-owner.test.ts && git commit -m "feat(money): free signup grant 1000 → 100 credits"`

## Task 2: Otto LLM margin default 3 → 1.5×

**Files:** Modify `packages/core/src/llm-prices.ts:45-47` (the `OTTO_LLM_MARGIN_DEFAULT` const + comment); Modify any test asserting the default (search).
**Interfaces — Produces:** `OTTO_LLM_MARGIN_DEFAULT = 1.5`.

- [ ] **Step 1: Find any test pinning the default.** `grep -rn "OTTO_LLM_MARGIN_DEFAULT\|ottoLlmMargin" packages apps --include=*.test.ts`. Note the files asserting `3`.
- [ ] **Step 2: Write/adjust a pure test (TDD).** In the meter/llm-prices test (e.g. `packages/otto/src/meter.test.ts` or a `llm-prices.test.ts`): assert `OTTO_LLM_MARGIN_DEFAULT === 1.5` and that `ottoLlmMargin()` returns 1.5 when `OTTO_LLM_MARGIN` env is unset. Run → FAIL (currently 3).
- [ ] **Step 3: Change the default.** `packages/core/src/llm-prices.ts:47`: `export const OTTO_LLM_MARGIN_DEFAULT = 1.5;` and update the comment at :45 (`3× = ~66% margin` → `1.5× = real tokens + overhead, the cheap-Otto differentiator`). Update any meter test that asserted a 3× expected credit cost to the 1.5× value (recompute the expected). Run the affected suites → PASS.
- [ ] **Step 4: Commit.** `git add packages/core/src/llm-prices.ts <changed tests> && git commit -m "feat(money): Otto LLM margin default 3x → 1.5x (real-token + overhead)"`

## Task 3: Create the 3 MYR credit packs in Stripe (TEST)

**Files:** Create `scripts/create-credit-packs.ts` (a one-off operator script — not app code; not imported anywhere).
**Interfaces — Consumes:** the Stripe client pattern from `apps/web/lib/stripe.ts` (`STRIPE_SECRET_KEY`). **Produces:** 3 active Stripe Prices (TEST) that `listCreditPacks()` will surface.

- [ ] **Step 1: Write the idempotent creation script.** `scripts/create-credit-packs.ts` (run with `tsx`/`node`, reading `STRIPE_SECRET_KEY` from the main-checkout env). For each of the 3 packs `{ name, amountSen, credits }` = `[{name:"Starter — 50 credits", amountSen:2500, credits:50},{name:"Standard — 220 credits", amountSen:10000, credits:220},{name:"Pro — 600 credits", amountSen:25000, credits:600}]`: create (or find existing by name) a Stripe **Product**, then a one-time **Price** `{ currency:"myr", unit_amount: amountSen, product: <id>, metadata:{ credits: String(credits) } }`. Make it idempotent: list existing products by name and skip if a matching active Price already exists (so re-running doesn't duplicate). Log each created/existing priceId.
- [ ] **Step 2: Run it against TEST keys.** Run the script with the TEST `STRIPE_SECRET_KEY` (from `apps/web/.env.local`). Confirm it prints 3 priceIds and creates nothing on a second run (idempotent).
- [ ] **Step 3: Verify `listCreditPacks()` surfaces them.** A focused check: call `listCreditPacks()` (or hit `/billing`) and confirm it returns exactly the 3 packs, sorted by amount, with the right credits + currency `myr`. (No new test file required — this is an integration verify against live TEST Stripe.)
- [ ] **Step 4: Commit the script.** `git add scripts/create-credit-packs.ts && git commit -m "chore(money): script to create the 3 MYR credit packs (idempotent, TEST)"`

## Task 4: End-to-end verify the buy flow

(Operator verification — no code; confirms the existing flow works with the real packs.)

- [ ] **Step 1: Checkout → webhook → grant.** With the app running against TEST Stripe + the webhook reachable (Stripe CLI `stripe listen --forward-to <app>/api/stripe/webhook` or the deployed TEST webhook): on `/billing`, buy the Starter pack with test card `4242 4242 4242 4242`. Confirm `checkout.session.completed` fires, the webhook grants **50 credits** (source `PURCHASE`, key `stripe:<sessionId>`), and the org balance increases by 50 display credits. Re-deliver the event → no double-grant (idempotent).
- [ ] **Step 2: Confirm the new constants live.** A new test org gets **100** free credits (not 1000); an Otto turn now charges ~1.5× (spot-check the metered cost vs a 3× baseline). 
- [ ] **Step 3: Record the verification** in the PR description (what was tested + the priceIds). No commit.

---

## Self-Review (against the spec)

**Spec coverage:** §3 Phase 1 step 1 (create packs) → Task 3; step 2 (Otto 1.5×) → Task 2; step 3 (free 100) → Task 1; step 4 (verify) → Task 4. §1 the pack numbers (RM25/100/250 → 50/220/600 cr) → Task 3 verbatim. §4 money-safety (grantCredits idempotent, spend path untouched) → no task modifies the spend/ledger code; only two pricing constants + Stripe config.

**Placeholder scan:** the only non-code tasks (3 create-Prices, 4 verify) are inherently operator/integration steps with exact values + commands; not placeholders.

**Type consistency:** `BETA_INITIAL_GRANT_CREDITS` (Task 1) + `OTTO_LLM_MARGIN_DEFAULT` (Task 2) are the only new constant values; both stated in INTERNAL-vs-DISPLAY units explicitly. The pack metadata shape (`metadata.credits` string) matches what `listCreditPacks()` reads (`Number(p.metadata.credits)`).

**Note:** Phase 2 (BytePlus migration + per-generation credit re-cost + 720p/1080p picker) is OUT of this plan — it gets its own brainstorm/spec/plan. This plan ships the buy-credits feature on the current provider.
