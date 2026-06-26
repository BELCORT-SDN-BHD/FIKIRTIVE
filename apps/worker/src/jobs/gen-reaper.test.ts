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
const stuckQueuedJob = { id: "g2", ownerId: "o2", threadId: "t2", kind: "IMAGE", model: "seedream" };

beforeEach(() => {
  vi.clearAllMocks();
  m.chatMessageFindFirst.mockResolvedValue({ seq: 5 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
});

describe("reapStaleGenJobs — GENERATING branch", () => {
  it("fail-closes + refunds + posts a TURN_ERROR for a stale GENERATING job we claim", async () => {
    // first findMany = GENERATING stuck; second findMany = no QUEUED stuck
    m.genJobFindMany.mockResolvedValueOnce([stuckJob]).mockResolvedValueOnce([]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // we won the conditional claim
    const n = await reapStaleGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR", genJobId: "g1", threadId: "t1" });
  });

  it("does NOT refund or post when the claim is lost (a live winner still owns it)", async () => {
    m.genJobFindMany.mockResolvedValueOnce([stuckJob]).mockResolvedValueOnce([]);
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

describe("reapStaleGenJobs — QUEUED branch (GEN-6 / P0-11)", () => {
  it("fail-closes + refunds + posts a TURN_ERROR for a stuck QUEUED job older than 25 min", async () => {
    // first findMany = no GENERATING stuck; second findMany = one QUEUED stuck
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueuedJob]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // conditional claim won
    const n = await reapStaleGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o2", refId: "g2" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR", genJobId: "g2", threadId: "t2" });
  });

  it("does NOT refund or post a TURN_ERROR when a worker wins the race (updateMany returns count 0)", async () => {
    // Simulates the race: reaper selected the job, but a worker claimed it (QUEUED→GENERATING)
    // before the reaper's updateMany ran — count 0 means we lost, no refund, no message.
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueuedJob]);
    m.genJobUpdateMany.mockResolvedValue({ count: 0 }); // worker won the race
    const n = await reapStaleGenJobs();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("does NOT select a QUEUED job newer than 25 min (not returned by findMany)", async () => {
    // A fresh QUEUED job is simply not in the result set — the query filters by createdAt.
    // Verify that nothing is reaped when findMany returns empty for both branches.
    m.genJobFindMany.mockResolvedValue([]);
    const n = await reapStaleGenJobs();
    expect(n).toBe(0);
    expect(m.genJobUpdateMany).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("counts GENERATING-stale + QUEUED-stuck combined in the return value", async () => {
    // Both branches reap one job each → total = 2.
    m.genJobFindMany.mockResolvedValueOnce([stuckJob]).mockResolvedValueOnce([stuckQueuedJob]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleGenJobs();
    expect(n).toBe(2);
    expect(m.refundReservation).toHaveBeenCalledTimes(2);
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(2);
  });
});
