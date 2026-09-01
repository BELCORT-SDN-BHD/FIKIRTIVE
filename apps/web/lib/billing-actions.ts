"use server";
import { stripe } from "@/lib/stripe";
import { requireOwner } from "@/lib/auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { CREDIT_PACKS, CREDIT_PACK_CURRENCY, verifyCreditPackPurchase } from "@fikirtive/core";

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

/**
 * 在售充值包(MONEY-A12 / #1044:**代码表是唯一权威**)。
 *
 * 以前这里是「Stripe 上有什么就卖什么」:后台加一个包,货架当场多一行,而入账那一侧
 * (`verifyCreditPackPurchase`)只认代码里的 `CREDIT_PACKS` —— 买家付了钱,webhook 拒绝入账,
 * 报警响起,而人已经被扣了款。两个权威中间那道漂移窗,就是 #1044。
 *
 * 现在货架由 `CREDIT_PACKS` **逐行渲染**,Stripe Price 只剩一个身份:结账载体。渲染前逐笔
 * 核对(金额 / 币种 / credits 三样都得对上),对不上就不显示 —— 显示不出来的包,买不到,
 * 也就永远不会走到「付了钱拿不到 credits」那一步。名字、价格、credits 三样全部来自代码表:
 * Stripe 后台改了 Product 名字,商家看到的仍然是我们说了算的那一个。
 */
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
    const packs = CREDIT_PACKS.map((pack) => {
      // 一个包能上货架,当且仅当 Stripe 上有一个与它**逐字相同**的活跃 Price:同样的金额、
      // 同样的币种、同样的 credits。差一格就不是这个包 —— 宁可少卖一个包,也不许卖出一个
      // 入账那一侧会拒绝的包。
      const price = res.data.find(
        (p) =>
          p.active &&
          typeof p.unit_amount === "number" &&
          p.unit_amount === pack.amountMinor &&
          typeof p.currency === "string" &&
          p.currency.toLowerCase() === CREDIT_PACK_CURRENCY &&
          Number(p.metadata?.credits) === pack.credits,
      );
      if (!price) {
        console.warn(
          `[billing] pack "${pack.name}" is in CREDIT_PACKS but has no matching active Stripe Price ` +
            `(${CREDIT_PACK_CURRENCY} ${pack.amountMinor} → ${pack.credits} credits) — not shown. ` +
            `Run apps/web/scripts/create-credit-packs.mjs against this Stripe account.`,
        );
        return null;
      }
      return { priceId: price.id, credits: pack.credits, amountCents: pack.amountMinor, currency: CREDIT_PACK_CURRENCY, label: pack.name };
    })
      .filter((p): p is CreditPack => p !== null)
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
  // MONEY-A12 / #1044 的另一半:货架关上了,**这条路**也得关。priceId 是客户端 POST 上来的,
  // 在此之前这里只问过 Stripe「这个价格活着吗、带 credits 吗」—— 于是一个从来没上过货架的
  // Stripe Price 仍然可以被直接结账,漂移窗只是从看得见挪到了看不见。
  //
  // 现在用**入账那一侧同一个**核对函数(同一张 CREDIT_PACKS)当场判:金额、币种、credits
  // 三样对不上代码表里的任何一个包,就不给结账。报价与入账从此是同一张表的同一次判定。
  //
  // 与 webhook 的一处刻意不同:那边 `unverifiable`(Stripe 没报金额)照常入账 —— 因为钱已经
  // 收了,拿我们自己读不到的字段去坑一个真付了钱的商家是错的方向。这边还没收钱,所以
  // 「没法核」就是不放行:结账前 fail closed,结账后 fail open,两边都朝着不坑商家的方向。
  const check = verifyCreditPackPurchase({ credits: price.metadata?.credits, amountTotal: price.unit_amount, currency: price.currency });
  if (!price.active || check.verdict !== "match") {
    console.warn(`[billing] refused checkout for price ${priceId}: ${check.verdict === "match" ? "price is not active" : check.reason}`);
    return { error: "That pack is unavailable." };
  }
  const credits = check.pack.credits;

  const base = process.env.BETTER_AUTH_URL ?? "";
  if (!base) return { error: "Checkout is unavailable — please contact support.", contactSupport: true };
  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      // 收单方式钉在代码里(规格 §3「不扩收单方式」+ 变更登记 2026-09-02 风险⑤)。不写这一行,
      // Stripe 后台随时可以开 FPX / GrabPay,而手续费钉点只量过卡类 —— 45% 宪法地板的分母会
      // 在没有任何 PR 的情况下变掉。要加收单方式,就要先改这一行 + 补手续费钉点,走 PR。
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: gate.ownerId,
      metadata: { orgId: gate.ownerId, credits: String(credits), priceId },
      // MONEY-A13:把商家身份也写到 **PaymentIntent** 上。拒付事件(charge.dispute.*)拿到的
      // 对象是 Dispute / Charge —— 它们身上没有 Checkout Session 的 metadata,而账本反查又要
      // 先有 orgId,链是断的(报警只能写「ownerId: founder」,认人全靠人工翻后台)。
      // 这一行让 PaymentIntent 自带 orgId,拒付一到就认得出是谁。
      payment_intent_data: { metadata: { orgId: gate.ownerId, credits: String(credits) } },
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
