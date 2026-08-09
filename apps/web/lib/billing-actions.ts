"use server";
import { stripe } from "@/lib/stripe";
import { requireOwner } from "@/lib/auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";

export type CreditPack = { priceId: string; credits: number; amountCents: number; currency: string; label: string };

/**
 * 货架的两种状态 —— 「真没货」和「拿不到货架」不是同一件事(#786)。
 *
 * 过去两种都返回 `[]`,于是一次瞬时的价格目录报错被两个账务页当成空货架,按 #687 的口径
 * 挂上人工出口 —— 正好违反 #771 自己立的围栏:**可重试的错误不挂人工出口**。
 *
 *   `{ packs }`      我们看过货架了。空数组 = 真的没有可售的包。Stripe 没配也算这一种:
 *                    那不是「读失败」,是确实没有东西可卖,而且商家怎么重试都变不出来 ——
 *                    该给的正是人工出口(#687 已把这一支判进空货架)。
 *   `{ unreadable }` 我们没看到货架:目录调用抛错,或者守卫没让我们看。产品不知道货架是空
 *                    是满,所以既不许说「没有」,也不许因此把商家引去写邮件 —— 这是一个
 *                    重试就可能好的状态,出路是重试,不是人。
 */
export type CreditPackShelf = { packs: CreditPack[] } | { unreadable: true };

/** Active one-time credit packs = active Stripe Prices carrying metadata.credits.
 *  Packs live in Stripe (test/live dashboard) — no redeploy to change them. */
export async function listCreditPacks(): Promise<CreditPackShelf> {
  const gate = await requireOwner();
  // Denied at the door: we never got to look at the shelf, so we may not report on it.
  if ("error" in gate) return { unreadable: true };
  if (!process.env.STRIPE_SECRET_KEY) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[billing] listCreditPacks unavailable: STRIPE_SECRET_KEY is not set.");
    }
    return { packs: [] };
  }
  try {
    // limit:100 (Stripe max per page) — the default of 10 silently truncates once the
    // account carries >10 active Prices (test/live packs, currency variants), dropping
    // real packs from the money-in list. The metadata.credits filter below still scopes
    // the result to credit packs.
    const res = await stripe.prices.list({ active: true, expand: ["data.product"], limit: 100 });
    const packs = res.data
      .flatMap((p) => {
        const credits = Number(p.metadata?.credits);
        if (!p.active || !Number.isInteger(credits) || credits <= 0 || typeof p.unit_amount !== "number") return [];
        return [{
          priceId: p.id,
          credits,
          amountCents: p.unit_amount as number,
          currency: p.currency,
          label: (typeof p.product === "object" && p.product && "name" in p.product ? (p.product.name as string) : `${credits} credits`),
        }];
      })
      .sort((a, b) => a.amountCents - b.amountCents);
    return { packs };
  } catch (e) {
    console.warn("[billing] listCreditPacks failed (Stripe unconfigured or API error):", e);
    // We asked and did not get an answer. That is not the same as "nothing is on sale",
    // and it is not a reason to send the merchant to a person (#786).
    return { unreadable: true };
  }
}

/** Start a one-time Checkout for a pack. requireOwner-gated; the org + credits ride in
 *  client_reference_id + metadata so the webhook can grant without expanding line items.
 *
 *  `contactSupport` marks the ONE failure the merchant cannot retry their way out of
 *  (the server has no base URL to send Stripe back to). BuyPackButton turns that flag
 *  into a real mailto — before #686 the sentence said "please contact support" and gave
 *  them nothing to click. Every other error here is retryable and deliberately carries
 *  no human hand-off. */
export async function createTopupCheckout(
  priceId: string,
): Promise<{ url: string } | { error: string; contactSupport?: true }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to buy credits." };
  if (typeof priceId !== "string" || !priceId) return { error: "Pick a credit pack." };

  let price: Awaited<ReturnType<typeof stripe.prices.retrieve>>;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch {
    return { error: "That pack is unavailable." };
  }
  const credits = Number(price.metadata?.credits);
  if (!price.active || !credits || credits <= 0 || !Number.isInteger(credits)) return { error: "That pack is unavailable." };

  const base = process.env.BETTER_AUTH_URL ?? "";
  if (!base) return { error: "Checkout is unavailable — please contact support.", contactSupport: true };
  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: gate.ownerId,
      metadata: { orgId: gate.ownerId, credits: String(credits), priceId },
      success_url: `${base}/billing?status=success`,
      cancel_url: `${base}/billing?status=cancel`,
      customer_email: gate.email,
    });
  } catch (e) {
    console.warn("[billing] createTopupCheckout failed:", e);
    return { error: "Could not start checkout — please retry." };
  }
  if (!session.url) return { error: "Could not start checkout — please retry." };
  return { url: session.url };
}
