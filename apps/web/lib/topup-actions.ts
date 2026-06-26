"use server";
import { requireOwner } from "@/lib/auth-guard";
import { packFor } from "@/lib/stripe-packs";
import { stripe } from "@/lib/stripe";

export async function createTopupCheckout(
  packKey: string,
): Promise<{ url: string } | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return owner;

  const pack = packFor(packKey);
  if (!pack) return { error: "Unknown pack." };

  const base = process.env.APP_URL ?? "";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: pack.usd * 100, // cents
            product_data: {
              name: `${pack.displayCredits} Fikirtive credits`,
            },
          },
        },
      ],
      success_url: `${base}/otto?topup=success`,
      cancel_url: `${base}/otto`,
      metadata: {
        orgId: owner.ownerId,
        packKey,
        internalCredits: String(pack.internalCredits),
      },
    });

    return { url: session.url! };
  } catch {
    return { error: "Couldn't start checkout." };
  }
}
