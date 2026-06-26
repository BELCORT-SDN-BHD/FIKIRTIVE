import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));

const pricesList = vi.fn();
const pricesRetrieve = vi.fn();
const sessionsCreate = vi.fn();
vi.mock("@/lib/stripe", () => ({
  stripe: { prices: { list: pricesList, retrieve: pricesRetrieve }, checkout: { sessions: { create: sessionsCreate } } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_URL = "https://app.test";
});

const { listCreditPacks, createTopupCheckout } = await import("@/lib/billing-actions");

describe("listCreditPacks", () => {
  it("returns active prices that carry metadata.credits, sorted by amount", async () => {
    pricesList.mockResolvedValue({ data: [
      { id: "price_b", unit_amount: 5000, currency: "usd", active: true, metadata: { credits: "550" }, product: { name: "550 credits" } },
      { id: "price_a", unit_amount: 1000, currency: "usd", active: true, metadata: { credits: "100" }, product: { name: "100 credits" } },
      { id: "price_x", unit_amount: 9999, currency: "usd", active: true, metadata: {}, product: { name: "no-credits" } },
    ] });
    const packs = await listCreditPacks();
    expect(packs.map((p) => p.priceId)).toEqual(["price_a", "price_b"]); // metadata-less filtered out, sorted asc
    expect(packs[0]).toMatchObject({ priceId: "price_a", credits: 100, amountCents: 1000, currency: "usd", label: "100 credits" });
  });
});

describe("createTopupCheckout", () => {
  it("returns the gate error when requireOwner denies", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await createTopupCheckout("price_a");
    expect(res).toEqual({ error: "Not authorized." });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a price with no metadata.credits", async () => {
    mockRequireOwner.mockResolvedValue({ email: "c@t.test", ownerId: "org_1" });
    pricesRetrieve.mockResolvedValue({ id: "price_x", active: true, metadata: {} });
    const res = await createTopupCheckout("price_x");
    expect("error" in res).toBe(true);
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
});
