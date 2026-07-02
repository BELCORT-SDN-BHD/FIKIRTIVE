import { describe, it, expect, vi, beforeEach } from "vitest";

const constructEvent = vi.fn();
vi.mock("@/lib/stripe", () => ({ stripe: { webhooks: { constructEvent } } }));
const grantCredits = vi.fn();
const actionEventCreate = vi.fn();
vi.mock("@fikirtive/db", () => ({ grantCredits, prisma: { actionEvent: { create: actionEventCreate } } }));
vi.mock("@fikirtive/core", () => ({ newId: () => "evt_id", INTERNAL_PER_DISPLAY: 10 }));

beforeEach(() => { vi.clearAllMocks(); process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"; actionEventCreate.mockResolvedValue({}); });

const { POST } = await import("@/app/api/stripe/webhook/route");
function req(body = "{}") { return { text: async () => body, headers: { get: () => "sig_x" } } as never; }

describe("stripe webhook", () => {
  it("400 on invalid signature; no grant", async () => {
    constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("grants on checkout.session.completed (paid) with the right args", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1", type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid", metadata: { orgId: "org_1", credits: "100" }, payment_intent: "pi_1", amount_total: 1000 } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1", amount: 100 * 10, source: "PURCHASE", idempotencyKey: "stripe:cs_1",
    }));
    expect(actionEventCreate).toHaveBeenCalled();
  });

  it("grants on checkout.session.async_payment_succeeded (paid) with the same dedup key (F01)", async () => {
    // Delayed-notification methods (e.g. FPX/GrabPay) can complete 'unpaid' and pay later via
    // this event — it must grant too, or a paying customer gets no credits. Same stripe:<session>
    // key makes it exactly-once even if completed + async_payment_succeeded both fire.
    constructEvent.mockReturnValue({
      id: "evt_async", type: "checkout.session.async_payment_succeeded",
      data: { object: { id: "cs_async", payment_status: "paid", metadata: { orgId: "org_9", credits: "220" }, payment_intent: "pi_9", amount_total: 10000 } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_9", amount: 220 * 10, source: "PURCHASE", idempotencyKey: "stripe:cs_async",
    }));
  });

  it("200 + no grant when metadata is missing/invalid (no retry storm)", async () => {
    constructEvent.mockReturnValue({ id: "evt_2", type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: {} } } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("200 on a duplicate event (grantCredits reports duplicate)", async () => {
    constructEvent.mockReturnValue({ id: "evt_1", type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: { orgId: "org_1", credits: "100" } } } });
    grantCredits.mockResolvedValue({ duplicate: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
  });

  it("200 + no grant for an unhandled event type", async () => {
    constructEvent.mockReturnValue({ id: "evt_3", type: "payment_intent.created", data: { object: {} } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("200 + no grant when credits is fractional (metadata.credits = '1.5')", async () => {
    constructEvent.mockReturnValue({
      id: "evt_5", type: "checkout.session.completed",
      data: { object: { payment_status: "paid", metadata: { orgId: "org_1", credits: "1.5" } } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("200 + no grant for checkout.session.completed with payment_status !== 'paid'", async () => {
    constructEvent.mockReturnValue({
      id: "evt_4", type: "checkout.session.completed",
      data: { object: { payment_status: "no_payment_required", metadata: { orgId: "org_1", credits: "100" } } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
