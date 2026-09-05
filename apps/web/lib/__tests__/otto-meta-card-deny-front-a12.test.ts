/**
 * FRONT-A12 — Deny on Otto's two Meta cards is a server fact, not a React state
 * (spec `docs/specs/frontend-baseline.md`; 接线盘点 L8).
 *
 * FRONT-A12's second clause is "任何写入失败都有错误反馈，不出现「假成功」". A Deny button that
 * only calls `setDenied(true)` is the purest form of 假成功: the merchant reads "Plan declined —
 * nothing was changed", refreshes, and the plan is pending again — still approvable, by them or
 * by anyone else who opens the thread. So the assertions here are all about what survives the
 * refresh: the card row is RE-READ from Postgres after the click, never inspected in memory.
 *
 * Real Postgres, real Prisma, two real orgs. `requireOwner` is the only thing mocked, because it
 * is the seam where a browser session becomes a server principal — everything downstream of it
 * (the owner-scoped WHERE clauses that make the tenant assertion mean something) runs for real.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

let currentOwnerId = "";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The real `runAsUser` / tenant guard stay in place on purpose: the cross-tenant case below is
// only worth writing if the frame that pins every query is the production one.
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: async () => ({ ownerId: currentOwnerId, email: "merchant@example.test" }),
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: async () => false }));

const { prisma } = await import("@fikirtive/db");
const { newId } = await import("@fikirtive/core");
const { ottoReject } = await import("@/lib/otto-actions");
const { verifyApproval, hashSteps } = await import("@/lib/meta-approval");
const { ACTION_PLAN_DECLINE_TEXT, AD_BUILD_DECLINE_TEXT } = await import("@/lib/meta-card-decline-view");

const orgA = newId();
const orgB = newId();
let threadA = "";
let threadB = "";

const PLAN_STEPS = [
  { index: 0, op: "budget_up" as const, targetId: "adset_1", targetValue: { dailyBudgetMinor: 5000 } },
];

function actionCardPayload(ownerId: string) {
  return {
    planTitle: "Raise the Hari Raya adset budget",
    steps: [
      {
        index: 0,
        op: "budget_up",
        targetId: "adset_1",
        targetName: "Hari Raya gifting",
        currentValue: { status: "ACTIVE", dailyBudgetMinor: 3000, currency: "MYR" },
        targetValue: { dailyBudgetMinor: 5000 },
        moneyClass: "spend",
      },
    ],
    totalSpendImpactDisplay: "MYR 20.00/day",
    autoEligible: false,
    approval: {
      paramHash: hashSteps(PLAN_STEPS),
      boundActor: ownerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

function buildCardPayload(ownerId: string) {
  return {
    goal: "Launch a Hari Raya traffic ad",
    reasoning: "Your gifting page converts best in the two weeks before the holiday.",
    mode: "create",
    objective: "OUTCOME_TRAFFIC",
    accountId: "act_1",
    currency: "MYR",
    pageId: "page_1",
    targeting: { geo_locations: { countries: ["MY"] } },
    dailyBudgetMinor: 3000,
    creative: {
      assetId: "ast_1",
      kind: "image",
      message: "Gift jasmine this Raya",
      cta: "SHOP_NOW",
      link: "https://example.test/raya",
    },
    approval: {
      paramHash: "b".repeat(64),
      boundActor: ownerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

async function makeThread(ownerId: string, shopName: string): Promise<string> {
  await prisma.organization.create({ data: { id: ownerId, name: shopName } });
  const project = await prisma.project.create({
    data: { id: `prj_${randomUUID()}`, ownerId, name: "Hari Raya gifting" },
  });
  const thread = await prisma.chatThread.create({
    data: { id: `thr_${randomUUID()}`, ownerId, projectId: project.id, title: "Ads" },
  });
  return thread.id;
}

let seq = 0;
async function makeCard(
  ownerId: string,
  threadId: string,
  kind: "ACTION_CARD" | "BUILD_CARD",
  payload: Record<string, unknown>,
): Promise<string> {
  seq += 1;
  const row = await prisma.chatMessage.create({
    data: {
      id: newId(),
      threadId,
      ownerId,
      role: "AGENT",
      kind,
      seq,
      payload: payload as never,
    },
  });
  return row.id;
}

async function reReadPayload(cardId: string, ownerId = orgA): Promise<Record<string, unknown>> {
  const row = await prisma.chatMessage.findFirstOrThrow({
    where: { id: cardId, ownerId },
    select: { payload: true },
  });
  return row.payload as unknown as Record<string, unknown>;
}

beforeAll(async () => {
  threadA = await makeThread(orgA, "Kaia Cafe (deny A)");
  threadB = await makeThread(orgB, "Kaia Cafe (deny B)");
});

describe("FRONT-A12 — Otto Meta card Deny goes to the server", () => {
  it("FRONT-A12 declining an ACTION_CARD persists: the card re-reads as declined and the plan is no longer approvable", async () => {
    currentOwnerId = orgA;
    const cardId = await makeCard(orgA, threadA, "ACTION_CARD", actionCardPayload(orgA));

    const res = await ottoReject({ threadId: threadA, cardId });
    expect(res).toEqual({ ok: true, status: "done", reply: ACTION_PLAN_DECLINE_TEXT });

    // The refresh test: everything below comes back out of Postgres, not out of React.
    const payload = await reReadPayload(cardId);
    expect(typeof payload.declinedAt).toBe("string");

    // Un-approvable, structurally: the frozen binding now reads "consumed", which is exactly what
    // approveMetaActionPlan checks before it will touch a merchant's ad account.
    const approval = payload.approval as { consumedAt?: string; boundActor: string; expiresAt: string; paramHash: string };
    expect(typeof approval.consumedAt).toBe("string");
    const verdict = verifyApproval(approval, PLAN_STEPS, orgA, new Date().toISOString());
    expect(verdict).toEqual({ ok: false, reason: "consumed" });

    // The conversation says the same sentence the card does — one story, not two.
    const note = await prisma.chatMessage.findFirst({
      where: { threadId: threadA, ownerId: orgA, kind: "TEXT", text: ACTION_PLAN_DECLINE_TEXT },
    });
    expect(note).not.toBeNull();

    const audit = await prisma.actionEvent.findFirst({
      where: { ownerId: orgA, type: "approval.declined" },
    });
    expect(audit).not.toBeNull();
    expect((audit!.payload as unknown as { cardId: string }).cardId).toBe(cardId);
  });

  it("FRONT-A12 declining a BUILD_CARD persists with the build's own sentence", async () => {
    currentOwnerId = orgA;
    const cardId = await makeCard(orgA, threadA, "BUILD_CARD", buildCardPayload(orgA));

    const res = await ottoReject({ threadId: threadA, cardId });
    expect(res).toEqual({ ok: true, status: "done", reply: AD_BUILD_DECLINE_TEXT });

    const payload = await reReadPayload(cardId);
    expect(typeof payload.declinedAt).toBe("string");
    expect(typeof (payload.approval as { consumedAt?: string }).consumedAt).toBe("string");

    const note = await prisma.chatMessage.findFirst({
      where: { threadId: threadA, ownerId: orgA, kind: "TEXT", text: AD_BUILD_DECLINE_TEXT },
    });
    expect(note).not.toBeNull();
  });

  it("FRONT-A12 declining twice writes once — the second click reads back as already resolved", async () => {
    currentOwnerId = orgA;
    const cardId = await makeCard(orgA, threadA, "ACTION_CARD", actionCardPayload(orgA));

    await ottoReject({ threadId: threadA, cardId });
    const firstDeclinedAt = (await reReadPayload(cardId)).declinedAt;
    const notesAfterFirst = await prisma.chatMessage.count({
      where: { threadId: threadA, ownerId: orgA, kind: "TEXT", text: ACTION_PLAN_DECLINE_TEXT },
    });

    const second = await ottoReject({ threadId: threadA, cardId });
    expect(second).toEqual({ ok: true, alreadyResolved: true, resolution: "rejected" });

    expect((await reReadPayload(cardId)).declinedAt).toBe(firstDeclinedAt);
    const notesAfterSecond = await prisma.chatMessage.count({
      where: { threadId: threadA, ownerId: orgA, kind: "TEXT", text: ACTION_PLAN_DECLINE_TEXT },
    });
    expect(notesAfterSecond).toBe(notesAfterFirst);
  });

  it("FRONT-A12 another org cannot decline this org's card — the row does not move", async () => {
    currentOwnerId = orgA;
    const cardId = await makeCard(orgA, threadA, "ACTION_CARD", actionCardPayload(orgA));

    // orgB is a real, logged-in merchant holding orgA's ids. Nothing about that may work.
    currentOwnerId = orgB;
    const res = await ottoReject({ threadId: threadA, cardId });
    expect(res).toEqual({ error: "Conversation not found." });

    currentOwnerId = orgA;
    const payload = await reReadPayload(cardId);
    expect(payload.declinedAt).toBeUndefined();
    expect((payload.approval as { consumedAt?: string }).consumedAt).toBeUndefined();

    // …and not even by pairing orgA's card with orgB's own conversation.
    currentOwnerId = orgB;
    const crossed = await ottoReject({ threadId: threadB, cardId });
    expect(crossed).toEqual({ error: "That card isn't awaiting approval." });
    expect((await reReadPayload(cardId)).declinedAt).toBeUndefined();
  });

  it("FRONT-A12 a plan that already ran is reported as approved, never as declined", async () => {
    currentOwnerId = orgA;
    const cardId = await makeCard(orgA, threadA, "ACTION_CARD", {
      ...actionCardPayload(orgA),
      autoOutcome: { ran: true, state: "done" },
    });

    const res = await ottoReject({ threadId: threadA, cardId });
    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "approved" });
    expect((await reReadPayload(cardId)).declinedAt).toBeUndefined();
  });
});
