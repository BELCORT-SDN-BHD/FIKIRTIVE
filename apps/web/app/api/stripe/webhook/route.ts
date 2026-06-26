export const runtime = "nodejs";

import { stripe } from "@/lib/stripe";
import { grantCredits } from "@fikirtive/db";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET ?? "");
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Only grant once the payment has ACTUALLY settled. checkout.session.completed can fire
    // for an "unpaid" session when async payment methods are enabled (bank transfer, some
    // e-wallets) — granting then would hand out credits before money arrives. Card payments
    // are always "paid" here; for anything else we wait (and would handle
    // checkout.session.async_payment_succeeded separately if async methods are added).
    if (session.payment_status !== "paid") {
      return new Response(null, { status: 200 });
    }

    const { orgId, internalCredits: internalCreditsStr } = session.metadata ?? {};
    const internalCredits = parseInt(internalCreditsStr ?? "", 10);

    if (!orgId || !internalCreditsStr || Number.isNaN(internalCredits) || internalCredits <= 0) {
      // Ignore malformed events — always 200 so Stripe doesn't retry
      console.error("stripe webhook: malformed metadata", session.metadata);
      return new Response(null, { status: 200 });
    }

    await grantCredits({
      orgId,
      amount: internalCredits,
      source: "PURCHASE",
      reason: "Stripe top-up",
      idempotencyKey: `stripe:${session.id}`,
    });
  }

  return new Response(null, { status: 200 });
}
