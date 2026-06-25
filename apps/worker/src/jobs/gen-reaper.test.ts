/**
 * gen-reaper.test.ts — reapStaleGenJobs: jobs the worker hung on (no redelivery)
 * must be fail-closed + refunded + given a terminal message, and a still-running
 * winner must be left alone (the conditional claim is the safety mechanism).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindMany = vi.fn();
  const genJobUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findMany: genJobFindMany, updateMany: genJobUpdateMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    // the reaper's $transaction body only touches tx.genJob.updateMany + refundReservation(tx)
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, genJobFindMany, genJobUpdateMany, chatMessageFindFirst, chatMessageCreate, refundReservation, settleCredits };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits }));
// import-time deps the reaper does not exercise:
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));

import { reapStaleGenJobs } from "./gen.js";

const stuckJob = { id: "g1", ownerId: "o1", threadId: "t1", kind: "IMAGE", model: "seedream" };

beforeEach(() => {
  vi.clearAllMocks();
  m.chatMessageFindFirst.mockResolvedValue({ seq: 5 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
});

describe("reapStaleGenJobs", () => {
  it("fail-closes + refunds + posts a TURN_ERROR for a stale GENERATING job we claim", async () => {
    m.genJobFindMany.mockResolvedValue([stuckJob]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // we won the conditional claim
    const n = await reapStaleGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR", genJobId: "g1", threadId: "t1" });
  });

  it("does NOT refund or post when the claim is lost (a live winner still owns it)", async () => {
    m.genJobFindMany.mockResolvedValue([stuckJob]);
    m.genJobUpdateMany.mockResolvedValue({ count: 0 }); // lost the claim — leave it alone
    const n = await reapStaleGenJobs();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("no-ops when nothing is stuck", async () => {
    m.genJobFindMany.mockResolvedValue([]);
    const n = await reapStaleGenJobs();
    expect(n).toBe(0);
    expect(m.genJobUpdateMany).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });
});
