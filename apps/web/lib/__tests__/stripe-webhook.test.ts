import { describe, it, expect, vi, beforeEach } from "vitest";

const constructEvent = vi.fn();
vi.mock("@/lib/stripe", () => ({ stripe: { webhooks: { constructEvent } } }));
const grantCredits = vi.fn();
const actionEventCreate = vi.fn();
vi.mock("@fikirtive/db", () => ({ grantCredits, prisma: { actionEvent: { create: actionEventCreate } } }));
vi.mock("@fikirtive/core", () => ({ newId: () => "evt_id", INTERNAL_PER_DISPLAY: 10 }));
const captureMessage = vi.fn();
vi.mock("@sentry/node", () => ({ captureMessage }));

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

  // ── #552:延迟到账失败(FPX/GrabPay)不再被裸 200 吞掉 ─────────────────────────
  it("checkout.session.async_payment_failed → audit row + Sentry alert, ZERO grant, 200", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f1", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f1", payment_status: "unpaid", metadata: { orgId: "org_7", credits: "220" }, payment_intent: "pi_f1", amount_total: 10000 } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled(); // no money arrived → nothing may be issued
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("checkout.session.async_payment_failed"), "warning");
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "stripe_failed:cs_f1", ownerId: "org_7", type: "credits.purchase.failed" }),
      }),
    );
  });

  it("async_payment_failed keys the audit row on the SESSION, so a redelivery hits the same PK", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f2", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f2", payment_status: "unpaid", metadata: { orgId: "org_7", credits: "220" } } },
    });
    expect((await POST(req())).status).toBe(200);
    // Stripe redelivers the SAME event, or a second failure event for the same session.
    expect((await POST(req())).status).toBe(200);
    const ids = actionEventCreate.mock.calls.map((c) => c[0].data.id);
    expect(ids).toEqual(["stripe_failed:cs_f2", "stripe_failed:cs_f2"]);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("async_payment_failed with no orgId metadata still audits (owner falls back to founder), 200, no grant", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f3", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f3", payment_status: "unpaid", metadata: {} } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "stripe_failed:cs_f3", ownerId: "founder", type: "credits.purchase.failed" }),
      }),
    );
  });

  it("async_payment_failed still 200s when the audit write throws (Stripe must not retry-storm)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f4", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f4", payment_status: "unpaid", metadata: { orgId: "org_7" } } },
    });
    actionEventCreate.mockRejectedValueOnce(new Error("unique constraint"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(captureMessage).toHaveBeenCalled(); // alert is at-least-once: a DB fault can't silence it
    expect(grantCredits).not.toHaveBeenCalled();
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

  // ── 2026-07-04 盲区修复:争议/退款 = 钱被拉回,必须有人被叫到 ──────────────
  it("charge.dispute.created → audit event + Sentry alert, NO money mutation, 200", async () => {
    constructEvent.mockReturnValue({
      id: "evt_d1", type: "charge.dispute.created",
      data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 5000, reason: "fraudulent", status: "needs_response" } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled(); // alert-only: clawback 是 founder 的钱决定
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("charge.dispute.created"), "warning");
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "credits.dispute" }) }),
    );
  });

  it("charge.refunded → audit event + Sentry alert, NO money mutation, 200", async () => {
    constructEvent.mockReturnValue({
      id: "evt_r1", type: "charge.refunded",
      data: { object: { id: "ch_2", payment_intent: "pi_2", amount: 3000, amount_refunded: 3000 } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("charge.refunded"), "warning");
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "credits.refund" }) }),
    );
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
