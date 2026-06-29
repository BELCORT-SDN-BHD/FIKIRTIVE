// Create (idempotently) the FIKIRTIVE MYR credit packs as Stripe Products + one-time Prices.
// Each Price carries metadata.credits — that is what listCreditPacks() reads to surface a pack.
// Run from apps/web so `stripe` resolves; load secrets from the main-checkout env:
//   node --env-file=/Users/winnin/Desktop/artlio/apps/web/.env.local apps/web/scripts/create-credit-packs.mjs
// Idempotent: matches an existing pack by (product name + currency + amount + credits) and skips it.
// Safety: refuses to run against a LIVE key unless ALLOW_LIVE=1.
import Stripe from "stripe";

const CURRENCY = "myr";
const PACKS = [
  { name: "Starter — 50 credits", amountSen: 2500, credits: 50 },
  { name: "Standard — 220 credits", amountSen: 10000, credits: 220 },
  { name: "Pro — 600 credits", amountSen: 25000, credits: 600 },
];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY not set — pass --env-file pointing at the main-checkout .env.local");
  process.exit(1);
}
const isLive = key.startsWith("sk_live_") || key.startsWith("rk_live_");
if (isLive && process.env.ALLOW_LIVE !== "1") {
  console.error("Refusing to run against a LIVE Stripe key. Re-run with ALLOW_LIVE=1 only when you mean it.");
  process.exit(1);
}

const stripe = new Stripe(key);
console.log(`[packs] mode=${isLive ? "LIVE" : "TEST"} currency=${CURRENCY}`);

const existingProducts = (await stripe.products.list({ limit: 100 })).data;

for (const pack of PACKS) {
  let product = existingProducts.find((p) => p.active && p.name === pack.name);
  if (!product) {
    product = await stripe.products.create({
      name: pack.name,
      metadata: { kind: "credit_pack", credits: String(pack.credits) },
    });
    console.log(`  + product ${product.id}  "${pack.name}"`);
  } else {
    console.log(`  = product ${product.id}  "${pack.name}" (exists)`);
  }

  const prices = (await stripe.prices.list({ product: product.id, active: true, limit: 100 })).data;
  const match = prices.find(
    (pr) => pr.currency === CURRENCY && pr.unit_amount === pack.amountSen && String(pr.metadata?.credits) === String(pack.credits),
  );
  if (match) {
    console.log(`  = price   ${match.id}  (exists) ${CURRENCY} ${pack.amountSen} → ${pack.credits} cr`);
    continue;
  }
  const price = await stripe.prices.create({
    product: product.id,
    currency: CURRENCY,
    unit_amount: pack.amountSen,
    metadata: { credits: String(pack.credits) },
  });
  console.log(`  + price   ${price.id}  ${CURRENCY} ${pack.amountSen} → ${pack.credits} cr`);
}

console.log("[packs] done. listCreditPacks() will now surface these (active prices with metadata.credits).");
