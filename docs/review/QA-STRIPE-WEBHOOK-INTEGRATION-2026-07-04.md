# QA Stripe Webhook Integration - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Commit: `f8d30e6`

## Purpose

Close the autonomous part of the Stripe money-in gap without requiring production Stripe secrets or a hosted checkout session.

This test proves that the webhook route calls the real credit ledger path idempotently when Stripe reports a delayed-payment checkout as paid.

## Boundary

- No real Stripe API call was made.
- No live or test-mode Stripe checkout session was created.
- The Stripe signature parser was mocked at the `constructEvent` boundary so the route could receive deterministic Stripe event objects.
- The route under test and `@fikirtive/db` credit ledger implementation were real.
- The database was a local `_test` Postgres database guarded by the repo test safety checks.

## Scenario

The integration test creates a temporary organization and sends three route-level webhook events with the same checkout session id:

1. `checkout.session.completed` with `payment_status: unpaid`.
   - Expected: no credit account and no ledger row.
2. `checkout.session.async_payment_succeeded` with `payment_status: paid`.
   - Expected: one purchase grant through the real `grantCredits` ledger path.
3. `checkout.session.completed` replay with `payment_status: paid`.
   - Expected: no second grant; duplicate purchase action event recorded.

## Assertions

- Final credit account balance is exactly `220 * INTERNAL_PER_DISPLAY`.
- Reserved balance remains `0`.
- Exactly one `CreditLedger` row exists for the temporary org.
- The row uses:
  - `kind: GRANT`
  - `source: PURCHASE`
  - `idempotencyKey: stripe:<sessionId>`
- Two `credits.purchase` action events exist, with the replay marked `duplicate: true`.

## Verification

Command:

```bash
DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:55432/fikirtive_stripe_webhook_test' pnpm --filter @fikirtive/web exec vitest run lib/__tests__/billing-actions.test.ts lib/__tests__/stripe-webhook.test.ts lib/__tests__/stripe-webhook-integration.test.ts
```

Result:

- 3 test files passed.
- 20 tests passed.

Additional check:

```bash
pnpm --filter @fikirtive/web typecheck
```

Result: pass.

## Remaining Stripe Gate

Real hosted checkout and Stripe event delivery are still not proven. The remaining external smoke should use an approved Stripe test/live-mode plan, complete one checkout, and assert that the production/test ledger receives exactly one purchase grant for the resulting Stripe session.
