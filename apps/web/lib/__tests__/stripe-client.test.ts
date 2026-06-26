import { describe, it, expect, beforeAll } from "vitest";
beforeAll(() => { process.env.STRIPE_SECRET_KEY = "sk_test_x"; });
describe("stripe client", () => {
  it("exports a constructed Stripe client without throwing", async () => {
    const { stripe } = await import("@/lib/stripe");
    expect(typeof stripe.checkout.sessions.create).toBe("function");
    expect(typeof stripe.webhooks.constructEvent).toBe("function");
  });
});
