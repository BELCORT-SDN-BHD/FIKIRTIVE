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
  type: "checkout.session.completed" | "checkout.session.async_payment_succeeded";
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
});
