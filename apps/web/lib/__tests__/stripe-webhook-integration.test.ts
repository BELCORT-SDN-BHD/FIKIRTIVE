import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const constructEvent = vi.fn();
vi.mock("@/lib/stripe", () => ({ stripe: { webhooks: { constructEvent } } }));

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

const { POST } = await import("@/app/api/stripe/webhook/route");
const { prisma } = await import("@fikirtive/db");
const { INTERNAL_PER_DISPLAY } = await import("@fikirtive/core");

function req(body = "{}") {
  return { text: async () => body, headers: { get: () => "sig_test" } } as never;
}

function checkoutEvent({
  eventId,
  type,
  sessionId,
  orgId,
  credits,
  paymentStatus,
}: {
  eventId: string;
  type:
    | "checkout.session.completed"
    | "checkout.session.async_payment_succeeded"
    | "checkout.session.async_payment_failed";
  sessionId: string;
  orgId: string;
  credits: string;
  paymentStatus: string;
}) {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        metadata: { orgId, credits },
        payment_intent: `pi_${sessionId}`,
        amount_total: 10_000,
      },
    },
  };
}

describe("stripe webhook money-in integration", () => {
  const orgId = `stripe_it_${randomUUID()}`;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: "Stripe webhook integration test" } });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.creditLedger.deleteMany({ where: { orgId } });
    await prisma.creditAccount.deleteMany({ where: { orgId } });
    await prisma.actionEvent.deleteMany({ where: { ownerId: orgId } });
  });

  afterAll(async () => {
    await prisma.actionEvent.deleteMany({ where: { ownerId: orgId } }).catch(() => {});
    await prisma.creditLedger.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.creditAccount.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  });

  it("grants delayed-payment credits once across unpaid completed, async success, and paid replay", async () => {
    const sessionId = `cs_${randomUUID()}`;

    constructEvent.mockReturnValueOnce(checkoutEvent({
      eventId: "evt_completed_unpaid",
      type: "checkout.session.completed",
      sessionId,
      orgId,
      credits: "220",
      paymentStatus: "unpaid",
    }));
    expect((await POST(req())).status).toBe(200);
    expect(await prisma.creditLedger.count({ where: { orgId } })).toBe(0);
    expect(await prisma.creditAccount.findUnique({ where: { orgId } })).toBeNull();

    constructEvent.mockReturnValueOnce(checkoutEvent({
      eventId: "evt_async_paid",
      type: "checkout.session.async_payment_succeeded",
      sessionId,
      orgId,
      credits: "220",
      paymentStatus: "paid",
    }));
    expect((await POST(req())).status).toBe(200);

    constructEvent.mockReturnValueOnce(checkoutEvent({
      eventId: "evt_completed_paid_replay",
      type: "checkout.session.completed",
      sessionId,
      orgId,
      credits: "220",
      paymentStatus: "paid",
    }));
    expect((await POST(req())).status).toBe(200);

    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId } });
    expect(account.balance).toBe(220 * INTERNAL_PER_DISPLAY);
    expect(account.reserved).toBe(0);

    const rows = await prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      balanceDelta: 220 * INTERNAL_PER_DISPLAY,
      reservedDelta: 0,
      kind: "GRANT",
      source: "PURCHASE",
      idempotencyKey: `stripe:${sessionId}`,
    });

    const purchaseEvents = await prisma.actionEvent.findMany({
      where: { ownerId: orgId, type: "credits.purchase" },
      orderBy: { createdAt: "asc" },
    });
    expect(purchaseEvents).toHaveLength(2);
    expect(purchaseEvents[1]?.payload).toMatchObject({ duplicate: true, sessionId });
  });

  // #552: the other half of the delayed-payment story — the payment never settles.
  it("records a delayed-payment failure exactly once and never grants credits", async () => {
    const sessionId = `cs_${randomUUID()}`;

    constructEvent.mockReturnValueOnce(checkoutEvent({
      eventId: "evt_completed_unpaid_f",
      type: "checkout.session.completed",
      sessionId,
      orgId,
      credits: "220",
      paymentStatus: "unpaid",
    }));
    expect((await POST(req())).status).toBe(200);

    for (const eventId of ["evt_async_failed", "evt_async_failed_redelivery"]) {
      constructEvent.mockReturnValueOnce(checkoutEvent({
        eventId,
        type: "checkout.session.async_payment_failed",
        sessionId,
        orgId,
        credits: "220",
        paymentStatus: "unpaid",
      }));
      expect((await POST(req())).status).toBe(200);
    }

    // Zero money moved: no ledger row, no account, nothing to reconcile.
    expect(await prisma.creditLedger.count({ where: { orgId } })).toBe(0);
    expect(await prisma.creditAccount.findUnique({ where: { orgId } })).toBeNull();

    // Exactly one audit row survives the redelivery — the session-derived primary key,
    // not a check-then-act read, is what enforces it.
    const failures = await prisma.actionEvent.findMany({
      where: { ownerId: orgId, type: "credits.purchase.failed" },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.id).toBe(`stripe_failed:${sessionId}`);
    expect(failures[0]?.payload).toMatchObject({ sessionId, eventId: "evt_async_failed" });
  });

  it("a later successful settlement still grants exactly once after a failure was recorded", async () => {
    const sessionId = `cs_${randomUUID()}`;

    constructEvent.mockReturnValueOnce(checkoutEvent({
      eventId: "evt_failed_first",
      type: "checkout.session.async_payment_failed",
      sessionId,
      orgId,
      credits: "50",
      paymentStatus: "unpaid",
    }));
    expect((await POST(req())).status).toBe(200);
    expect(await prisma.creditLedger.count({ where: { orgId } })).toBe(0);

    // The failure branch must not have poisoned the grant path's own idempotency key.
    for (const eventId of ["evt_succeeded_after", "evt_succeeded_after_replay"]) {
      constructEvent.mockReturnValueOnce(checkoutEvent({
        eventId,
        type: "checkout.session.async_payment_succeeded",
        sessionId,
        orgId,
        credits: "50",
        paymentStatus: "paid",
      }));
      expect((await POST(req())).status).toBe(200);
    }

    const rows = await prisma.creditLedger.findMany({ where: { orgId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idempotencyKey: `stripe:${sessionId}`, balanceDelta: 50 * INTERNAL_PER_DISPLAY });
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId } });
    expect(account.balance).toBe(50 * INTERNAL_PER_DISPLAY);
  });
});
