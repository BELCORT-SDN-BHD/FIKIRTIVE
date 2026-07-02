/**
 * refgen-reaper.test.ts — F02: reapStaleRefGenJobs. A RefGenJob the worker hung on
 * during its FINAL pg-boss attempt (retry budget exhausted, message dead-lettered to
 * REFGEN_DLQ which has no consumer) is never redelivered, so refgen's on-claim stale
 * branch never runs and the RESERVE hold leaks forever. A proactive reaper must
 * fail-close + refund any GENERATING row older than the reap window (with no committed
 * outputs) and any QUEUED row that was never picked up. Mirrors reapStaleGenJobs; no
 * cowork message (refgen has no thread).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const refGenJobFindMany = vi.fn();
  const refGenJobUpdateMany = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refGenJob: { findMany: refGenJobFindMany, updateMany: refGenJobUpdateMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, refGenJobFindMany, refGenJobUpdateMany, refundReservation, settleCredits };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, Prisma: {} }));
// import-time deps the reaper does not exercise:
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));

import { reapStaleRefGenJobs } from "./refgen.js";

const stuckGenerating = { id: "r1", ownerId: "o1" };
const stuckQueued = { id: "r2", ownerId: "o2" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reapStaleRefGenJobs — GENERATING branch", () => {
  it("fail-closes + refunds a stale GENERATING refgen job we claim", async () => {
    // first findMany = GENERATING stuck; second = no QUEUED stuck
    m.refGenJobFindMany.mockResolvedValueOnce([stuckGenerating]).mockResolvedValueOnce([]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 1 }); // we won the conditional claim
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "r1" });
    // the claim must be guarded on status GENERATING + empty outputs (never clobber a committed job)
    const claim = m.refGenJobUpdateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ id: "r1", status: "GENERATING" });
    expect(claim.where.outputAssetIds).toEqual({ isEmpty: true });
    expect(claim.data).toMatchObject({ status: "FAILED" });
  });

  it("does NOT refund when the claim is lost (a live winner still owns it)", async () => {
    m.refGenJobFindMany.mockResolvedValueOnce([stuckGenerating]).mockResolvedValueOnce([]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 0 }); // lost the claim — leave it alone
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("no-ops when nothing is stuck", async () => {
    m.refGenJobFindMany.mockResolvedValue([]);
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(0);
    expect(m.refGenJobUpdateMany).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });
});

describe("reapStaleRefGenJobs — QUEUED branch", () => {
  it("fail-closes + refunds a stuck QUEUED refgen job we claim", async () => {
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueued]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o2", refId: "r2" });
    const claim = m.refGenJobUpdateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ id: "r2", status: "QUEUED" });
    expect(claim.data).toMatchObject({ status: "FAILED" });
  });

  it("does NOT refund when a worker wins the QUEUED→GENERATING race (count 0)", async () => {
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueued]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 0 });
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("counts GENERATING-stale + QUEUED-stuck combined", async () => {
    m.refGenJobFindMany.mockResolvedValueOnce([stuckGenerating]).mockResolvedValueOnce([stuckQueued]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(2);
    expect(m.refundReservation).toHaveBeenCalledTimes(2);
  });
});
