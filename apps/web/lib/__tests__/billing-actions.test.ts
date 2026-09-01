import { describe, it, expect, vi, beforeEach } from "vitest";
import { CREDIT_PACKS, CREDIT_PACK_CURRENCY } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));

const pricesList = vi.fn();
const pricesRetrieve = vi.fn();
const sessionsCreate = vi.fn();
vi.mock("@/lib/stripe", () => ({
  stripe: { prices: { list: pricesList, retrieve: pricesRetrieve }, checkout: { sessions: { create: sessionsCreate } } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
  mockIsImpersonating.mockResolvedValue(false);
  process.env.BETTER_AUTH_URL = "https://app.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
});

const { listCreditPacks, createTopupCheckout } = await import("@/lib/billing-actions");

/** 夹具一律从**真的**在售包表长出来 —— 这一组用例要防的病(#1044)恰恰是「代码表与
 *  Stripe 上真实在售的包不是一回事」,自造一个假包就只是在测自己写的夹具。 */
const PACK = {
  starter: CREDIT_PACKS[0]!,
  standard: CREDIT_PACKS[1]!,
  pro: CREDIT_PACKS[2]!,
};

/** 一个与代码表某个包逐字对得上的 Stripe Price。 */
function stripePriceFor(pack: { amountMinor: number; credits: number; name: string }, id: string) {
  return {
    id,
    unit_amount: pack.amountMinor,
    currency: CREDIT_PACK_CURRENCY,
    active: true,
    metadata: { credits: String(pack.credits) },
    product: { name: `${pack.name} (whatever Stripe calls it)` },
  };
}

/** The packs on a shelf we actually got to look at. Fails the test if the action
 *  reported it could not read the catalogue at all — the two are different facts (#786). */
function packsOf(shelf: Awaited<ReturnType<typeof listCreditPacks>>) {
  if ("unreadable" in shelf) throw new Error("expected a shelf we could read, got 'unreadable'");
  return shelf.packs;
}

describe("listCreditPacks", () => {
  it("fails closed before touching Stripe when requireOwner denies", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });

    const shelf = await listCreditPacks();

    // Denied at the door = we never saw the shelf. Reporting an empty shelf here would be
    // the product asserting a fact it never read (#786).
    expect(shelf).toEqual({ unreadable: true });
    expect(pricesList).not.toHaveBeenCalled();
  });

  it("MONEY-A12:货架由代码表渲染 —— 名字与数字全部来自 CREDIT_PACKS,Stripe 只提供 priceId", async () => {
    pricesList.mockResolvedValue({
      data: [
        stripePriceFor(PACK.pro, "price_pro"),
        stripePriceFor(PACK.starter, "price_starter"),
        stripePriceFor(PACK.standard, "price_standard"),
      ],
    });

    const packs = packsOf(await listCreditPacks());

    expect(packs.map((p) => p.priceId)).toEqual(["price_starter", "price_standard", "price_pro"]); // 按金额升序
    expect(packs[0]).toEqual({
      priceId: "price_starter",
      credits: PACK.starter.credits,
      amountCents: PACK.starter.amountMinor,
      currency: CREDIT_PACK_CURRENCY,
      // Stripe 后台把 Product 改成什么名字都不算数:商家看到的是代码表里的名字。
      label: PACK.starter.name,
    });
  });

  it("MONEY-A12(#1044 漂移窗关闭):Stripe 后台多出来的包不上货架", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pricesList.mockResolvedValue({
      data: [
        stripePriceFor(PACK.starter, "price_starter"),
        stripePriceFor(PACK.standard, "price_standard"),
        stripePriceFor(PACK.pro, "price_pro"),
        // 有人在 Stripe 后台加了一个包,却没有改 CREDIT_PACKS 也没有部署。以前它会当场出现在
        // 货架上,买家付了钱、webhook 拒绝入账 —— 报警响起时人已经被扣了款。
        { id: "price_rogue", unit_amount: 50_000, currency: CREDIT_PACK_CURRENCY, active: true, metadata: { credits: "1300" }, product: { name: "Mega — 1300 credits" } },
      ],
    });

    const packs = packsOf(await listCreditPacks());

    expect(packs.map((p) => p.priceId)).toEqual(["price_starter", "price_standard", "price_pro"]);
    expect(packs.some((p) => p.credits === 1300)).toBe(false);
    warn.mockRestore();
  });

  it("MONEY-A12:代码表里有、Stripe 上没有逐字对上的价格 ⇒ 那个包不显示(不显示 = 卖不出去)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pricesList.mockResolvedValue({
      data: [
        stripePriceFor(PACK.starter, "price_starter"),
        // Standard 的 Stripe 价格被人在后台改了金额 —— 与代码表对不上,就不是这个包。
        { ...stripePriceFor(PACK.standard, "price_standard_drifted"), unit_amount: PACK.standard.amountMinor + 500 },
      ],
    });

    const packs = packsOf(await listCreditPacks());

    expect(packs.map((p) => p.priceId)).toEqual(["price_starter"]);
    expect(warn).toHaveBeenCalled(); // 卖不出去的包必须在日志里留一句,否则没人知道货架少了一行
    warn.mockRestore();
  });

  it("reports a real empty shelf without touching Stripe when Stripe is unconfigured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No key = there is genuinely nothing on sale, and no amount of retrying changes that
    // (#687 already ruled this state the empty shelf). It is NOT a read failure.
    const shelf = await listCreditPacks();
    expect(shelf).toEqual({ packs: [] });
    expect(pricesList).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports an unreadable shelf — not an empty one — when prices.list throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pricesList.mockRejectedValue(new Error("connection reset"));
    // #786: this used to return [], which both money pages read as "nothing on sale" and
    // answered with a human exit — a mailto hung on an error the merchant can just retry.
    const shelf = await listCreditPacks();
    expect(shelf).toEqual({ unreadable: true });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("requests a high page limit so >10 active prices are not silently truncated (F34)", async () => {
    // stripe.prices.list defaults to limit 10; a MYR account can accumulate more than
    // 10 active Prices (test/live packs, currency variants), silently truncating the list.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pricesList.mockResolvedValue({ data: [] });
    await listCreditPacks();
    expect(pricesList).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    warn.mockRestore();
  });
});

describe("createTopupCheckout", () => {
  it("returns the gate error when requireOwner denies", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await createTopupCheckout("price_a");
    expect(res).toEqual({ error: "Not authorized." });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("blocks checkout creation while impersonating a customer", async () => {
    mockIsImpersonating.mockResolvedValue(true);

    const res = await createTopupCheckout("price_a");

    expect(res).toEqual({ error: "Paused while impersonating a customer — exit impersonation to buy credits." });
    expect(pricesRetrieve).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("MONEY-A12:客户端 POST 一个不在代码表里的 priceId ⇒ 当场拒绝,不开结账", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 关掉货架还不够:priceId 是客户端传上来的,不核对代码表就等于把漂移窗从看得见挪到看不见。
    pricesRetrieve.mockResolvedValue({ id: "price_rogue", active: true, unit_amount: 50_000, currency: CREDIT_PACK_CURRENCY, metadata: { credits: "1300" } });

    const res = await createTopupCheckout("price_rogue");

    expect(res).toEqual({ error: "That pack is unavailable." });
    expect(sessionsCreate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("MONEY-A12:credits 对得上、金额被改过的价格也拒绝(付的钱与给的 credits 必须是一对)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pricesRetrieve.mockResolvedValue({ id: "price_cheap_pro", active: true, unit_amount: 1000, currency: CREDIT_PACK_CURRENCY, metadata: { credits: String(PACK.pro.credits) } });

    const res = await createTopupCheckout("price_cheap_pro");

    expect(res).toEqual({ error: "That pack is unavailable." });
    expect(sessionsCreate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects a price with no metadata.credits", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pricesRetrieve.mockResolvedValue({ id: "price_x", active: true, metadata: {} });
    const res = await createTopupCheckout("price_x");
    expect("error" in res).toBe(true);
    expect(sessionsCreate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects a price with fractional metadata.credits", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pricesRetrieve.mockResolvedValue({ id: "price_frac", active: true, metadata: { credits: "1.5" } });
    const res = await createTopupCheckout("price_frac");
    expect("error" in res).toBe(true);
    expect(sessionsCreate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns error when BETTER_AUTH_URL is unset", async () => {
    pricesRetrieve.mockResolvedValue(stripePriceFor(PACK.starter, "price_starter"));
    process.env.BETTER_AUTH_URL = "";
    const res = await createTopupCheckout("price_starter");
    // #686 — the merchant cannot retry their way out of a missing base URL, so this is the
    // one checkout error that hands them a person. The flag is what turns that sentence into
    // a clickable mailto in BuyPackButton; a bare string was a dead pointer.
    expect(res).toEqual({ error: "Checkout is unavailable — please contact support.", contactSupport: true });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("MONEY-A12/A13:结账 session 带代码表的 credits、card-only 收单、以及 PaymentIntent 上的 orgId", async () => {
    pricesRetrieve.mockResolvedValue(stripePriceFor(PACK.standard, "price_standard"));
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s/1" });

    const res = await createTopupCheckout("price_standard");

    expect(res).toEqual({ url: "https://checkout.stripe.test/s/1" });
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: "payment",
      // 规格 §3「不扩收单方式」变成机器执行的事实:后台开了 FPX/GrabPay 也进不来这条路。
      payment_method_types: ["card"],
      line_items: [{ price: "price_standard", quantity: 1 }],
      client_reference_id: "org_1",
      metadata: expect.objectContaining({ orgId: "org_1", credits: String(PACK.standard.credits), priceId: "price_standard" }),
      // MONEY-A13:拒付事件拿到的是 Charge/Dispute,身上没有 session metadata —— 商家身份
      // 必须先写到 PaymentIntent 上,拒付一到才认得出是谁。
      payment_intent_data: { metadata: { orgId: "org_1", credits: String(PACK.standard.credits) } },
      success_url: "https://app.test/billing?status=success",
      cancel_url: "https://app.test/billing?status=cancel",
      customer_email: "c@t.test",
    }));
  });

  it("returns a friendly error when Checkout Session creation fails", async () => {
    pricesRetrieve.mockResolvedValue(stripePriceFor(PACK.starter, "price_starter"));
    sessionsCreate.mockRejectedValue(new Error("stripe unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await createTopupCheckout("price_starter");

    expect(res).toEqual({ error: "Could not start checkout — please retry." });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
