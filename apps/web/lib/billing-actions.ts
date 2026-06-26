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
