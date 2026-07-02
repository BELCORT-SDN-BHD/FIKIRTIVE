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

  // F01: async_payment_succeeded fires when a delayed-notification method (e.g. FPX/GrabPay)
  // settles AFTER the session completed 'unpaid' — grant on it too, or that customer pays and
  // never receives credits. The stripe:<session.id> idempotencyKey keeps it exactly-once even
  // if both completed(paid) and async_payment_succeeded arrive for the same session.
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = event.data.object as any;
    if (session.payment_status === "paid") {
      const orgId = typeof session.metadata?.orgId === "string" ? session.metadata.orgId : "";
      const credits = Number(session.metadata?.credits);
      if (!orgId || !credits || credits <= 0 || !Number.isInteger(credits)) {
        await prisma.actionEvent.create({ data: { id: newId(), ownerId: "founder", type: "credits.purchase.bad", payload: { eventId: event.id, metadata: session.metadata ?? null } } }).catch(() => {});
        return new Response("ignored: missing metadata", { status: 200 }); // 200 → no retry storm
      }
      // Dedup on the Checkout SESSION id, not the event id: one session = one payment = one
      // grant. session.id stays exactly-once even if Stripe delivers multiple distinct events
      // for the same completed session, whereas event.id only dedups redeliveries of one event.
      const res = await grantCredits({
        orgId, amount: credits * INTERNAL_PER_DISPLAY, source: "PURCHASE",
        reason: "stripe top-up", createdBy: "stripe", idempotencyKey: `stripe:${session.id}`,
      });
      await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "credits.purchase", payload: { credits, amountTotal: session.amount_total ?? null, paymentIntentId: session.payment_intent ?? null, sessionId: session.id ?? null, eventId: event.id, duplicate: "duplicate" in res } } }).catch(() => {});
    }
  }
  return new Response("ok", { status: 200 });
}
