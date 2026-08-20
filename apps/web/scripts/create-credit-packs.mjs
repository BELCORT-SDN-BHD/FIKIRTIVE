// Create (idempotently) the FIKIRTIVE MYR credit packs as Stripe Products + one-time Prices.
// Each Price carries metadata.credits — that is what listCreditPacks() reads to surface a pack.
// The script lives under apps/web so `stripe` resolves; from the repo root, load
// secrets from the gitignored env:
//   node --env-file=apps/web/.env.local apps/web/scripts/create-credit-packs.mjs
// Idempotent: matches an existing pack by (product name + currency + amount + credits) and skips it.
// Safety: refuses to run against a LIVE key unless ALLOW_LIVE=1.
import { interlock } from "../../../scripts/tools/_interlock.mjs";
interlock({ spends: "Stripe API writes — creates Products/Prices; with a LIVE key (+ALLOW_LIVE=1) these are real live billing objects" });
import Stripe from "stripe";
// 钱路 M1-c:包表搬去 @fikirtive/core 的集中定价配置,这里**引用**而不是再存一份。
// 以前这三行数字只活在这个脚本里,webhook 入账时没有任何东西能拿它核对金额;
// 两份副本正是「说的」与「做的」分家的老路。core 必须先 build(pnpm --filter @fikirtive/core build)。
import { CREDIT_PACKS, CREDIT_PACK_CURRENCY } from "@fikirtive/core";

const CURRENCY = CREDIT_PACK_CURRENCY;
const PACKS = CREDIT_PACKS.map((p) => ({ name: p.name, amountSen: p.amountMinor, credits: p.credits }));

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
