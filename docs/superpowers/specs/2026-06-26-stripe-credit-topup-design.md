# Stripe Credit Top-Ups (Phase 3a) — Design

**Status:** Approved design (brainstorm 2026-06-26). Next: implementation plan via `writing-plans`.

**Goal:** Let an allowlisted customer buy credit packs with a card (one-time Stripe Checkout); on successful payment, credits land in their org's balance via the existing `grantCredits()` — exactly once, money-path untouched.

**Scope:** One-time **top-ups only.** Subscriptions, persisted Stripe Customer, refunds/disputes UI, and the `@better-auth/stripe` plugin are **out of scope** (Phase 3b).

**Architecture:** Plain Stripe SDK (`stripe`). A customer `/billing` page lists packs (Stripe Prices) and starts a Checkout Session via a server action; Stripe hosts the payment; a signed webhook (`/api/stripe/webhook`) verifies the event and calls `grantCredits({ source:"PURCHASE", idempotencyKey:"stripe:<eventId>" })`. The credit ledger's money-in seam (`PURCHASE` source, `stripe:<eventId>` idempotency) was built for exactly this — no ledger-logic change.

**Tech stack:** `stripe` (official Node SDK), Next.js 16 App Router, the existing `@fikirtive/db` credit service. Builds on Phase 1 (merged: the credit ledger + admin).

---

## Global Constraints

- **Do NOT modify the spend/charge path:** `gen-actions.ts`, `cowork-actions.ts`, `otto-actions.ts`, `refgen-actions.ts`, `packages/otto/src/meter.ts`, `apps/worker/*`, and the credit models. The ONLY credit write is calling the existing `grantCredits(...)` (the designed money-in entry point) — its signature is NOT changed.
- **`credits.ts` is NOT modified.** `grantCredits` doesn't accept `stripePaymentIntentId` and won't be changed to; the Stripe payment-intent id + Stripe details are recorded in an `actionEvent` audit row instead. The `CreditLedger.stripePaymentIntentId` column stays unused for MVP. Exactly-once is enforced by `idempotencyKey:"stripe:<eventId>"`.
- **No schema change.** The ledger already has `CreditTxnSource.PURCHASE`, `stripePaymentIntentId`, and the `stripe:<eventId>` idempotency convention.
- **`proxy.ts` change required (1 line):** add `api/stripe` to the auth-wall matcher exclusion (the webhook is unauthenticated — Stripe calls it; its auth is the signature). Same treatment as `api/better-auth`.
- **Secrets are user-provided, never handled by the implementer:** `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` (test) — set in Railway. The implementer codes against `process.env.*`, never enters key values.
- **Test mode throughout:** built and smoke-tested entirely in Stripe **test mode** (test cards). Live keys are flipped in by the user after verification.
- 1 displayed credit = `INTERNAL_PER_DISPLAY` (10) internal = $0.10.

---

## 1. Packs (defined in Stripe, not code)

Each pack is a **Stripe Product + one-time Price** (created by the user in the test dashboard), with `metadata.credits = <displayed credits>` on the Price. The app never hardcodes amounts:

- `/billing` lists packs by querying active one-time prices that carry `metadata.credits` (e.g. `stripe.prices.list({ active: true, expand: ["data.product"] })`, filter to `metadata.credits` present). Shows `unit_amount` (the price) + `metadata.credits` (what they get).
- Changing packs/prices = edit in Stripe, no redeploy.

## 2. Buy flow

1. **`/billing` page** — customer-facing RSC, gated by `requireOwner()`. Shows current balance (existing read) + the packs + a "Buy" button each. Handles `?status=success|cancel` after the Stripe redirect (a confirmation/"credits will appear shortly" note; the actual grant is webhook-driven).
2. **`createTopupCheckout(priceId)`** — `"use server"` action: `requireOwner()` → `orgId`; validate `priceId` is an active price with `metadata.credits`; read its `credits`; create a Checkout Session:
   ```
   stripe.checkout.sessions.create({
     mode: "payment",
     line_items: [{ price: priceId, quantity: 1 }],
     client_reference_id: orgId,
     metadata: { orgId, credits: String(credits), priceId },
     success_url: `${APP_URL}/billing?status=success`,
     cancel_url: `${APP_URL}/billing?status=cancel`,
     customer_email: gate.email,
   })
   ```
   Returns `{ url }`; the client redirects to Stripe. (Putting `orgId` + `credits` in session `metadata` lets the webhook read them directly without expanding line items.)
3. **Low-balance CTA** — where a generation is blocked by insufficient credits (the customer-facing error surface), show a "Top up" link to `/billing`. UI-only; does not touch the spend path's logic.

## 3. Webhook — `POST /api/stripe/webhook`

A Next route handler (no auth wall; signature-verified):
1. Read the **raw** body (`await req.text()`) + the `stripe-signature` header.
2. `stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)`. On failure → `400`.
3. On `event.type === "checkout.session.completed"` with `session.payment_status === "paid"`:
   - `orgId = session.metadata.orgId`; `credits = Number(session.metadata.credits)`; guard both present/valid (else log + `200` to stop retries, with an `actionEvent` error row).
   - `grantCredits({ orgId, amount: credits * INTERNAL_PER_DISPLAY, source: "PURCHASE", reason: "stripe top-up", createdBy: "stripe", idempotencyKey: "stripe:" + event.id })`.
   - Write an `actionEvent` (`type:"credits.purchase"`, `ownerId:orgId`) with `{ credits, amountPaid: session.amount_total, paymentIntentId: session.payment_intent, eventId: event.id }` for reconciliation (this is where the PI id lives — not the ledger).
   - `grantCredits` returns `{ duplicate: true }` on a replayed `event.id` → still `200` (already applied; no double-grant).
4. Ignore other event types → `200`.
5. Always `200` for handled/ignored events so Stripe stops retrying; only signature failure is `4xx`.

**Security:** the route is unauthenticated by design (Stripe has no session); the signature IS the authentication. It must be excluded from the proxy auth wall (§Global Constraints).

## 4. Files

- Create: `apps/web/lib/stripe.ts` — the `stripe` client singleton (`new Stripe(process.env.STRIPE_SECRET_KEY)`), build-safe (no throw at import if the key is absent — warn, like the better-auth secret guard).
- Create: `apps/web/lib/billing-actions.ts` — `createTopupCheckout(priceId)` + a `listCreditPacks()` read for the page.
- Create: `apps/web/app/api/stripe/webhook/route.ts` — the webhook handler.
- Create: `apps/web/app/billing/page.tsx` (+ a small client buy-button component).
- Modify: `apps/web/proxy.ts` — add `api/stripe` to the matcher exclusion.
- Modify: the customer-facing insufficient-credits surface — add the "Top up" link (UI only; identify the exact spot during planning).
- Add dependency: `stripe` (latest stable) to `apps/web`.

## 5. Testing

- **Unit — webhook** (`apps/web/lib/__tests__/stripe-webhook.test.ts`): mock `stripe.webhooks.constructEvent` + `grantCredits`:
  - invalid signature → `400`, `grantCredits` not called.
  - valid `checkout.session.completed` (paid) → `grantCredits` called with the right `orgId`, `amount = credits*10`, `source:"PURCHASE"`, `idempotencyKey:"stripe:<eventId>"`; `200`.
  - missing/invalid `metadata` → `200` (no retry storm) + no grant.
  - duplicate event (`grantCredits` returns `{duplicate}`) → `200`, no error.
  - unhandled event type → `200`, no grant.
- **Unit — `createTopupCheckout`**: `requireOwner` denial returns `{error}`, no session; success creates a session with `client_reference_id:orgId` + `metadata.{orgId,credits}`; rejects an unknown/active-less price.
- **Manual smoke (user, Stripe test mode):** create test products/prices with `metadata.credits`; on `/billing` buy a pack with card `4242 4242 4242 4242`; confirm the balance increases by the pack's credits and an audit row is written; replay the webhook event (Stripe CLI) and confirm no double-grant.

## 6. Non-goals (Phase 3b)

Subscriptions (recurring, proration, cancel) — the `@better-auth/stripe` plugin earns its keep there; a persisted Stripe Customer per org; refunds/disputes handling; invoices/receipts UI. The credit ledger already reserves a path (a `SUBSCRIPTION` source value may be added then).

## 7. Risks / verify during implementation

- **Raw body for signature:** the Next route handler must read the unparsed body (`req.text()`); a parsed/JSON-transformed body breaks `constructEvent`.
- **`grantCredits` arg shape:** confirmed `{ orgId, amount, reason?, source?, createdBy?, idempotencyKey }` — `source:"PURCHASE"` is a valid `CreditGrantSource`; no PI-id arg (recorded in `actionEvent` instead).
- **`APP_URL`/base URL** for success/cancel — reuse the existing base URL env (e.g. `BETTER_AUTH_URL`) rather than introducing a new one if it already points at the app origin.
- **Webhook idempotency** rests on `idempotencyKey:"stripe:<eventId>"`; Stripe can deliver an event more than once — the ledger's unique `(orgId, idempotencyKey)` makes the second a no-op.
