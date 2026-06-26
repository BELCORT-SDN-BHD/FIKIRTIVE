import { describe, it, expect, beforeAll, vi } from "vitest";
beforeAll(() => { process.env.STRIPE_SECRET_KEY = "sk_test_x"; });
describe("stripe client", () => {
  it("exports a constructed Stripe client without throwing", async () => {
    const { stripe } = await import("@/lib/stripe");
    expect(typeof stripe.checkout.sessions.create).toBe("function");
    expect(typeof stripe.webhooks.constructEvent).toBe("function");
  });

  it("importing does NOT throw when STRIPE_SECRET_KEY is absent (build-safe)", async () => {
    vi.resetModules();
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    await expect(import("@/lib/stripe")).resolves.toBeDefined();
    if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
  });
});
