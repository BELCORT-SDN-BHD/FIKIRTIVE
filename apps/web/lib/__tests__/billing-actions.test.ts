import { describe, it, expect, vi, beforeEach } from "vitest";

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

  it("returns active prices that carry metadata.credits, sorted by amount", async () => {
    pricesList.mockResolvedValue({ data: [
      { id: "price_b", unit_amount: 5000, currency: "usd", active: true, metadata: { credits: "550" }, product: { name: "550 credits" } },
      { id: "price_a", unit_amount: 1000, currency: "usd", active: true, metadata: { credits: "100" }, product: { name: "100 credits" } },
      { id: "price_x", unit_amount: 9999, currency: "usd", active: true, metadata: {}, product: { name: "no-credits" } },
    ] });
    const packs = packsOf(await listCreditPacks());
    expect(packs.map((p) => p.priceId)).toEqual(["price_a", "price_b"]); // metadata-less filtered out, sorted asc
    expect(packs[0]).toMatchObject({ priceId: "price_a", credits: 100, amountCents: 1000, currency: "usd", label: "100 credits" });
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
    pricesList.mockResolvedValue({ data: [] });
    await listCreditPacks();
    expect(pricesList).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it("does not list fractional-credit prices that checkout would reject", async () => {
    pricesList.mockResolvedValue({ data: [
      { id: "price_ok", unit_amount: 1000, currency: "usd", active: true, metadata: { credits: "100" }, product: { name: "100 credits" } },
      { id: "price_frac", unit_amount: 150, currency: "usd", active: true, metadata: { credits: "1.5" }, product: { name: "bad fractional credits" } },
    ] });
    const packs = packsOf(await listCreditPacks());
    expect(packs.map((p) => p.priceId)).toEqual(["price_ok"]);
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

  it("rejects a price with no metadata.credits", async () => {
    mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
    pricesRetrieve.mockResolvedValue({ id: "price_x", active: true, metadata: {} });
    const res = await createTopupCheckout("price_x");
    expect("error" in res).toBe(true);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a price with fractional metadata.credits", async () => {
    mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
    pricesRetrieve.mockResolvedValue({ id: "price_frac", active: true, metadata: { credits: "1.5" } });
    const res = await createTopupCheckout("price_frac");
    expect("error" in res).toBe(true);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("returns error when BETTER_AUTH_URL is unset", async () => {
    mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
    pricesRetrieve.mockResolvedValue({ id: "price_a", active: true, metadata: { credits: "100" } });
    process.env.BETTER_AUTH_URL = "";
    const res = await createTopupCheckout("price_a");
    // #686 — the merchant cannot retry their way out of a missing base URL, so this is the
    // one checkout error that hands them a person. The flag is what turns that sentence into
    // a clickable mailto in BuyPackButton; a bare string was a dead pointer.
    expect(res).toEqual({ error: "Checkout is unavailable — please contact support.", contactSupport: true });
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

  it("returns a friendly error when Checkout Session creation fails", async () => {
    mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
    pricesRetrieve.mockResolvedValue({ id: "price_a", active: true, metadata: { credits: "100" } });
    sessionsCreate.mockRejectedValue(new Error("stripe unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await createTopupCheckout("price_a");

    expect(res).toEqual({ error: "Could not start checkout — please retry." });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
