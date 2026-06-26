# Stripe Credit Top-Ups (Phase 3a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an allowlisted customer buy credit packs with a card (one-time Stripe Checkout); a signed webhook grants the credits via the existing `grantCredits()`, exactly once, money-path untouched.

**Architecture:** Plain `stripe` SDK. A `/billing` page lists packs (Stripe Prices) and a server action starts a Checkout Session; Stripe hosts payment; `POST /api/stripe/webhook` verifies the signature and calls `grantCredits({ source:"PURCHASE", idempotencyKey:"stripe:<eventId>" })`. No ledger-logic or schema change.

**Tech Stack:** `stripe` (official Node SDK), Next.js 16 App Router, `@fikirtive/db` credit service.

**Design doc:** `docs/superpowers/specs/2026-06-26-stripe-credit-topup-design.md`.

## Global Constraints

- **Do NOT modify the spend/charge path or its primitives:** `gen-actions.ts`, `cowork-actions.ts`, `otto-actions.ts`, `refgen-actions.ts`, `packages/otto/src/meter.ts`, `apps/worker/*`, `packages/db/src/credits.ts`, and the credit models. The only credit write is **calling** the existing `grantCredits(...)` (signature unchanged).
- **No schema change.** Ledger already has `CreditTxnSource.PURCHASE`, `stripePaymentIntentId`, and the `stripe:<eventId>` idempotency convention. The PI id is recorded in an `actionEvent`, not the ledger (grantCredits doesn't take it).
- **`proxy.ts`:** add `api/stripe` to the matcher exclusion (webhook is unauthenticated — Stripe calls it; signature is its auth). This is the ONLY proxy change.
- **Secrets are `process.env.*`, never hardcoded or entered by the implementer:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the app origin `BETTER_AUTH_URL` (reused for success/cancel URLs). Build-safe: no throw at import if a key is absent.
- **Test mode throughout.** Code is mode-agnostic (reads whatever key is set); the user supplies test keys.
- 1 displayed credit = `INTERNAL_PER_DISPLAY` (10) internal. `CreditGrantSource` includes `"PURCHASE"` (verified `credits.ts:108`).

**Base branch:** `origin/main` (`1d04ec5`, Phase 1 merged). This worktree (`stripe-topup-phase3`) is off it. Phase 3a is independent of Phase 2 (impersonation).

**Run tests:** `pnpm --filter @fikirtive/web exec vitest run <relative/path>` (cwd = `apps/web`).

---

### Task 1: Add `stripe` + the client singleton

**Files:**
- Modify: `apps/web/package.json` (add `stripe` dependency)
- Create: `apps/web/lib/stripe.ts`
- Test: `apps/web/lib/__tests__/stripe-client.test.ts`

**Interfaces:**
- Produces: `export const stripe: Stripe` — the shared client (`apps/web/lib/stripe.ts`), consumed by Tasks 2 & 3. Build-safe: constructing with an absent key does not throw (Stripe only errors on an API call).

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @fikirtive/web add stripe`
Expected: `stripe` appears in `apps/web/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Write the failing test**

Create `apps/web/lib/__tests__/stripe-client.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
beforeAll(() => { process.env.STRIPE_SECRET_KEY = "sk_test_x"; });
describe("stripe client", () => {
  it("exports a constructed Stripe client without throwing", async () => {
    const { stripe } = await import("@/lib/stripe");
    expect(typeof stripe.checkout.sessions.create).toBe("function");
    expect(typeof stripe.webhooks.constructEvent).toBe("function");
  });
});
```

- [ ] **Step 3: Run it — fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/stripe-client.test.ts`
Expected: FAIL — `Cannot find module '@/lib/stripe'`.

- [ ] **Step 4: Create `lib/stripe.ts`**

```ts
import "server-only";
import Stripe from "stripe";

// Build-safe: constructing with an empty key does NOT throw (Stripe only errors on an API
// call). Warn loudly in production so a misconfigured deploy is obvious in logs, mirroring
// the better-auth secret guard. The key is test or live depending on what's set in env.
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (process.env.NODE_ENV === "production" && !key) {
  console.error("[stripe] STRIPE_SECRET_KEY is missing — billing endpoints will fail.");
}

export const stripe = new Stripe(key);
```
(If TS requires an `apiVersion`, pass the SDK's current pinned default — do not invent a version string.)

- [ ] **Step 5: Run the test — passes; typecheck; commit**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/stripe-client.test.ts` → PASS.
Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/package.json ../../pnpm-lock.yaml apps/web/lib/stripe.ts apps/web/lib/__tests__/stripe-client.test.ts
git commit -m "feat(billing): add stripe SDK + build-safe client singleton"
```

---

### Task 2: `billing-actions.ts` — list packs + start checkout

**Files:**
- Create: `apps/web/lib/billing-actions.ts`
- Test: `apps/web/lib/__tests__/billing-actions.test.ts`

**Interfaces:**
- Consumes: `stripe` (Task 1), `requireOwner` (`@/lib/auth-guard`), `BETTER_AUTH_URL`.
- Produces:
  - `listCreditPacks(): Promise<{ priceId: string; credits: number; amountCents: number; currency: string; label: string }[]>` — active one-time prices carrying `metadata.credits`, sorted by `amountCents`.
  - `createTopupCheckout(priceId: string): Promise<{ url: string } | { error: string }>` — `requireOwner`-gated; creates a Checkout Session and returns its URL.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/billing-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));

const pricesList = vi.fn();
const pricesRetrieve = vi.fn();
const sessionsCreate = vi.fn();
vi.mock("@/lib/stripe", () => ({
  stripe: { prices: { list: pricesList, retrieve: pricesRetrieve }, checkout: { sessions: { create: sessionsCreate } } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_URL = "https://app.test";
});

const { listCreditPacks, createTopupCheckout } = await import("@/lib/billing-actions");

describe("listCreditPacks", () => {
  it("returns active prices that carry metadata.credits, sorted by amount", async () => {
    pricesList.mockResolvedValue({ data: [
      { id: "price_b", unit_amount: 5000, currency: "usd", active: true, metadata: { credits: "550" }, product: { name: "550 credits" } },
      { id: "price_a", unit_amount: 1000, currency: "usd", active: true, metadata: { credits: "100" }, product: { name: "100 credits" } },
      { id: "price_x", unit_amount: 9999, currency: "usd", active: true, metadata: {}, product: { name: "no-credits" } },
    ] });
    const packs = await listCreditPacks();
    expect(packs.map((p) => p.priceId)).toEqual(["price_a", "price_b"]); // metadata-less filtered out, sorted asc
    expect(packs[0]).toMatchObject({ priceId: "price_a", credits: 100, amountCents: 1000, currency: "usd" });
  });
});

describe("createTopupCheckout", () => {
  it("returns the gate error when requireOwner denies", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await createTopupCheckout("price_a");
    expect(res).toEqual({ error: "Not authorized." });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a price with no metadata.credits", async () => {
    mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
    pricesRetrieve.mockResolvedValue({ id: "price_x", active: true, metadata: {} });
    const res = await createTopupCheckout("price_x");
    expect("error" in res).toBe(true);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a Checkout Session with orgId + credits in client_reference_id/metadata", async () => {
    mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
    pricesRetrieve.mockResolvedValue({ id: "price_a", active: true, metadata: { credits: "100" } });
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s/1" });
    const res = await createTopupCheckout("price_a");
    expect(res).toEqual({ url: "https://checkout.stripe.test/s/1" });
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: "payment",
      line_items: [{ price: "price_a", quantity: 1 }],
      client_reference_id: "org_1",
      metadata: expect.objectContaining({ orgId: "org_1", credits: "100", priceId: "price_a" }),
      success_url: "https://app.test/billing?status=success",
      cancel_url: "https://app.test/billing?status=cancel",
      customer_email: "c@t.test",
    }));
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/billing-actions.test.ts`
Expected: FAIL — cannot find `@/lib/billing-actions`.

- [ ] **Step 3: Implement `billing-actions.ts`**

```ts
"use server";
import { stripe } from "@/lib/stripe";
import { requireOwner } from "@/lib/auth-guard";

export type CreditPack = { priceId: string; credits: number; amountCents: number; currency: string; label: string };

/** Active one-time credit packs = active Stripe Prices carrying metadata.credits.
 *  Packs live in Stripe (test/live dashboard) — no redeploy to change them. */
export async function listCreditPacks(): Promise<CreditPack[]> {
  const res = await stripe.prices.list({ active: true, expand: ["data.product"] });
  return res.data
    .filter((p) => p.metadata?.credits && Number(p.metadata.credits) > 0 && typeof p.unit_amount === "number")
    .map((p) => ({
      priceId: p.id,
      credits: Number(p.metadata.credits),
      amountCents: p.unit_amount as number,
      currency: p.currency,
      label: (typeof p.product === "object" && p.product && "name" in p.product ? (p.product.name as string) : `${p.metadata.credits} credits`),
    }))
    .sort((a, b) => a.amountCents - b.amountCents);
}

/** Start a one-time Checkout for a pack. requireOwner-gated; the org + credits ride in
 *  client_reference_id + metadata so the webhook can grant without expanding line items. */
export async function createTopupCheckout(priceId: string): Promise<{ url: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (typeof priceId !== "string" || !priceId) return { error: "Pick a credit pack." };

  let price: Awaited<ReturnType<typeof stripe.prices.retrieve>>;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch {
    return { error: "That pack is unavailable." };
  }
  const credits = Number(price.metadata?.credits);
  if (!price.active || !credits || credits <= 0) return { error: "That pack is unavailable." };

  const base = process.env.BETTER_AUTH_URL ?? "";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: gate.ownerId,
    metadata: { orgId: gate.ownerId, credits: String(credits), priceId },
    success_url: `${base}/billing?status=success`,
    cancel_url: `${base}/billing?status=cancel`,
    customer_email: gate.email,
  });
  if (!session.url) return { error: "Could not start checkout — please retry." };
  return { url: session.url };
}
```

- [ ] **Step 4: Run the tests — pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/billing-actions.test.ts` → PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/lib/billing-actions.ts apps/web/lib/__tests__/billing-actions.test.ts
git commit -m "feat(billing): listCreditPacks + createTopupCheckout (Stripe Checkout)"
```

---

### Task 3: Webhook — `POST /api/stripe/webhook` + proxy exclusion

**Files:**
- Create: `apps/web/app/api/stripe/webhook/route.ts`
- Modify: `apps/web/proxy.ts` (matcher)
- Test: `apps/web/lib/__tests__/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: `stripe` (Task 1), `grantCredits` + `prisma` (`@fikirtive/db`), `newId`/`INTERNAL_PER_DISPLAY` (`@fikirtive/core`).
- Produces: the webhook route. Grants on `checkout.session.completed` (paid) via `grantCredits({ source:"PURCHASE", idempotencyKey:"stripe:<eventId>" })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/stripe-webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const constructEvent = vi.fn();
vi.mock("@/lib/stripe", () => ({ stripe: { webhooks: { constructEvent } } }));
const grantCredits = vi.fn();
const actionEventCreate = vi.fn();
vi.mock("@fikirtive/db", () => ({ grantCredits, prisma: { actionEvent: { create: actionEventCreate } } }));
vi.mock("@fikirtive/core", () => ({ newId: () => "evt_id", INTERNAL_PER_DISPLAY: 10 }));

beforeEach(() => { vi.clearAllMocks(); process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"; actionEventCreate.mockResolvedValue({}); });

const { POST } = await import("@/app/api/stripe/webhook/route");
function req(body = "{}") { return { text: async () => body, headers: { get: () => "sig_x" } } as never; }

describe("stripe webhook", () => {
  it("400 on invalid signature; no grant", async () => {
    constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("grants on checkout.session.completed (paid) with the right args", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1", type: "checkout.session.completed",
      data: { object: { payment_status: "paid", metadata: { orgId: "org_1", credits: "100" }, payment_intent: "pi_1", amount_total: 1000 } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1", amount: 100 * 10, source: "PURCHASE", idempotencyKey: "stripe:evt_1",
    }));
    expect(actionEventCreate).toHaveBeenCalled();
  });

  it("200 + no grant when metadata is missing/invalid (no retry storm)", async () => {
    constructEvent.mockReturnValue({ id: "evt_2", type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: {} } } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("200 on a duplicate event (grantCredits reports duplicate)", async () => {
    constructEvent.mockReturnValue({ id: "evt_1", type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: { orgId: "org_1", credits: "100" } } } });
    grantCredits.mockResolvedValue({ duplicate: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
  });

  it("200 + no grant for an unhandled event type", async () => {
    constructEvent.mockReturnValue({ id: "evt_3", type: "payment_intent.created", data: { object: {} } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — fails (route missing)**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/stripe-webhook.test.ts`
Expected: FAIL — cannot find `@/app/api/stripe/webhook/route`.

- [ ] **Step 3: Implement the webhook route**

Create `apps/web/app/api/stripe/webhook/route.ts`:

```ts
import { stripe } from "@/lib/stripe";
import { grantCredits, prisma } from "@fikirtive/db";
import { newId, INTERNAL_PER_DISPLAY } from "@fikirtive/core";
import type { NextRequest } from "next/server";

// Unauthenticated by design — Stripe calls this; the SIGNATURE is the auth. proxy.ts excludes
// api/stripe from the wall. Always 200 for handled/ignored events so Stripe stops retrying;
// only a bad signature is 4xx.
export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text(); // RAW body required for signature verification
  const sig = req.headers.get("stripe-signature") ?? "";
  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET ?? "");
  } catch (e) {
    return new Response(`Webhook signature verification failed: ${e instanceof Error ? e.message : "error"}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = event.data.object as any;
    if (session.payment_status === "paid") {
      const orgId = typeof session.metadata?.orgId === "string" ? session.metadata.orgId : "";
      const credits = Number(session.metadata?.credits);
      if (!orgId || !credits || credits <= 0) {
        await prisma.actionEvent.create({ data: { id: newId(), ownerId: "founder", type: "credits.purchase.bad", payload: { eventId: event.id, metadata: session.metadata ?? null } } }).catch(() => {});
        return new Response("ignored: missing metadata", { status: 200 }); // 200 → no retry storm
      }
      const res = await grantCredits({
        orgId, amount: credits * INTERNAL_PER_DISPLAY, source: "PURCHASE",
        reason: "stripe top-up", createdBy: "stripe", idempotencyKey: `stripe:${event.id}`,
      });
      await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "credits.purchase", payload: { credits, amountTotal: session.amount_total ?? null, paymentIntentId: session.payment_intent ?? null, eventId: event.id, duplicate: "duplicate" in res } } }).catch(() => {});
    }
  }
  return new Response("ok", { status: 200 });
}
```

- [ ] **Step 4: Run the webhook tests — pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/stripe-webhook.test.ts` → PASS (5 tests).

- [ ] **Step 5: Exclude the webhook from the auth wall**

In `apps/web/proxy.ts`, change the matcher:
```ts
  matcher: ["/((?!login|api/better-auth|_next/static|_next/image|favicon.ico).*)"],
```
to:
```ts
  // api/stripe excluded — the webhook is unauthenticated (Stripe calls it; the signature is its auth).
  matcher: ["/((?!login|api/better-auth|api/stripe|_next/static|_next/image|favicon.ico).*)"],
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/app/api/stripe/webhook/route.ts apps/web/proxy.ts apps/web/lib/__tests__/stripe-webhook.test.ts
git commit -m "feat(billing): stripe webhook → grantCredits(PURCHASE) idempotent on event id; exclude api/stripe from auth wall"
```

---

### Task 4: `/billing` page + buy button

**Files:**
- Create: `apps/web/app/billing/page.tsx`
- Create: `apps/web/components/billing/BuyPackButton.tsx`
- Test: none beyond typecheck + build (UI; actions are tested in Task 2).

**Interfaces:** Consumes `listCreditPacks` + `createTopupCheckout` (Task 2) and the existing `getMyAccount` (`@/lib/account-actions`) for the balance. READ `apps/web/lib/account-actions.ts` (`getMyAccount` return shape) and a sibling customer page (e.g. `apps/web/components/otto/OttoAccount.tsx` or `apps/web/components/studio/Account.tsx`) to match the project's styling + how it renders balance.

- [ ] **Step 1: Buy button (client)**

Create `apps/web/components/billing/BuyPackButton.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { createTopupCheckout } from "@/lib/billing-actions";

export function BuyPackButton({ priceId, label }: { priceId: string; label: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          setErr(null);
          const res = await createTopupCheckout(priceId);
          if ("error" in res) { setErr(res.error); return; }
          window.location.href = res.url; // redirect to Stripe-hosted Checkout
        })}
      >{pending ? "Starting…" : label}</button>
      {err && <span role="alert">{err}</span>}
    </span>
  );
}
```
(Match the project's button styling — read a sibling button, e.g. in `OttoAccount.tsx`/`Account.tsx`, and use the same classes/inline-style approach. `window.location.href` is correct here — Checkout is an external origin, not a Next route.)

- [ ] **Step 2: `/billing` page (server)**

Create `apps/web/app/billing/page.tsx`:

```tsx
import { getMyAccount } from "@/lib/account-actions";
import { listCreditPacks } from "@/lib/billing-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const account = await getMyAccount();
  const packs = await listCreditPacks();
  // render: balance (from account if not {error}), a status note when status==="success"|"cancel",
  // and the packs list with a <BuyPackButton priceId credits price label/> each.
  // Match the styling of the existing customer account view.
  return (/* ...JSX per the project's design system... */);
}
```
Render: current balance (from `getMyAccount`; handle its `{error}` shape), a `status==="success"` note ("Payment received — credits will appear shortly") / `status==="cancel"` note, and each pack (label, price formatted from `amountCents`/`currency`, credits) with a `BuyPackButton`. Match the existing customer account page's structure/styling (you read it in Interfaces).

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
Run: `pnpm --filter @fikirtive/web build` → completes (confirms the RSC page + client button compile). If build is too heavy here, say so and confirm typecheck + the RSC/client boundary (page is a server component; `BuyPackButton` is `"use client"`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/billing/page.tsx apps/web/components/billing/BuyPackButton.tsx
git commit -m "feat(billing): /billing page — balance + credit packs + buy button"
```

---

### Task 5: Low-balance "Top up" link in the insufficient-credits surface

**Files:**
- Modify: `apps/web/components/otto/OttoChatStream.tsx` (the `data-error` display, ~L524)
- Test: none beyond typecheck (display-only link).

**Interfaces:** Consumes the `/billing` route. This is the customer-facing surface where an `insufficient_credits` `data-error` is shown after a blocked turn. **Display-only** — no logic/charge change.

- [ ] **Step 1: Add the link**

Read `apps/web/components/otto/OttoChatStream.tsx` around the `data-error` rendering (the comment at ~L524 marks it: "data-error: stays visible after the turn ends"). When the error is an insufficient-credits error, render a `Top up` link to `/billing` next to the error text. Detect it by the error string the route emits (grep the stream route for the `insufficient_credits`/credits error text and match on it; if the error shape doesn't distinguish, render the `/billing` link unconditionally beneath any `data-error` — a low-risk, always-helpful affordance). Use a plain `<a href="/billing">` styled to match the surrounding error UI.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/components/otto/OttoChatStream.tsx
git commit -m "feat(billing): link to /billing from the insufficient-credits error"
```

---

### Task 6: Verify — suite, non-goals, final review, smoke

**Files:** none (verification only).

- [ ] **Step 1: Full suite vs baseline**

Run: `pnpm --filter @fikirtive/web test`. Confirm the new billing tests pass and there are **no NEW failures** beyond the known pre-existing baseline (the DB-integration/request-scope files — `files/route`, `isolation`, `require-owner`, `tenant-guard` — fail identically on the base; verify count).

- [ ] **Step 2: Non-goal diff check**

Run: `git diff origin/main..HEAD --stat`. Confirm **no** changes to `gen-actions.ts`, `cowork-actions.ts`, `otto-actions.ts`, `refgen-actions.ts`, `packages/otto/`, `apps/worker/`, `packages/db/src/credits.ts`, or the credit models. `proxy.ts` shows **only** the `api/stripe` matcher addition. `OttoChatStream.tsx` shows only the added link (no logic change).

- [ ] **Step 3: Final whole-branch review** (controller dispatches per subagent-driven-development — opus, with the review package + these constraints; emphasize: money-in is only `grantCredits`, webhook idempotency on `stripe:<eventId>`, raw-body signature verify, proxy change is the only wall touch).

- [ ] **Step 4: Manual smoke (user, Stripe TEST mode)** — document results:
  1. In the Stripe **test** dashboard, create a Product + one-time Price with `metadata.credits` (e.g. 100), and set `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (test) + the webhook endpoint (`/api/stripe/webhook`) in Railway (or via Stripe CLI `stripe listen --forward-to .../api/stripe/webhook`).
  2. On `/billing`, buy the pack with card `4242 4242 4242 4242` (any future expiry/CVC).
  3. Confirm the org balance increases by the pack's credits and a `credits.purchase` audit row is written.
  4. Replay the event (Stripe CLI `stripe events resend <id>`) and confirm **no double-grant** (balance unchanged; `grantCredits` reported duplicate).

---

## Out of scope (Phase 3b)

Subscriptions (recurring, proration, cancel) via `@better-auth/stripe`; persisted Stripe Customer per org; refunds/disputes; invoices/receipts UI.

## Self-Review (done)

- **Spec coverage:** packs via Stripe Prices (Task 2 `listCreditPacks`); buy flow (Task 2 `createTopupCheckout` + Task 4 page/button); webhook → grantCredits + audit (Task 3); proxy exclusion (Task 3); low-balance CTA (Task 5); secrets via env + build-safe client (Task 1); verification + smoke (Task 6).
- **Placeholders:** none in logic; the `/billing` JSX and the OttoChatStream link are described with exact data sources + the explicit instruction to match the existing customer-page styling (read named files) — UI integration points, not logic gaps.
- **Type consistency:** `stripe` (Task 1) consumed in 2 & 3; `listCreditPacks`/`createTopupCheckout` (Task 2) consumed in 4; `grantCredits({source:"PURCHASE", idempotencyKey})` matches `credits.ts:108/139`; `amount = credits × INTERNAL_PER_DISPLAY` (10); webhook keys/return shapes match the tests.
