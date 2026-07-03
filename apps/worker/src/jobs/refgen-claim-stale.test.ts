/**
 * refgen-claim-stale.test.ts — handleRefGen's ON-CLAIM stale-GENERATING branch
 * (claim.count === 0). Codex P1 (2026-07-02): the fail-close updateMany must be
 * guarded DB-side on outputAssetIds isEmpty, mirroring gen.ts's generationIds
 * guard — never fail-close a job that already committed outputs. Without it, a
 * redelivery whose findUnique snapshot predates the winner's commit tx (outputs
 * written + settled, status still GENERATING >18min) flips the committed job to
 * FAILED: the refund no-ops (already settled) → user charged, job shown FAILED,
 * outputs never attached, and with no further delivery it never self-heals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const refGenJobFindUnique = vi.fn();
  const refGenJobUpdateMany = vi.fn();
  const entityFindFirst = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refGenJob: { findUnique: refGenJobFindUnique, updateMany: refGenJobUpdateMany },
    entity: { findFirst: entityFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, refGenJobFindUnique, refGenJobUpdateMany, entityFindFirst, refundReservation, settleCredits };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, Prisma: {} }));
// import-time deps this branch does not exercise:
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));

import { handleRefGen } from "./refgen.js";

// The redelivery's snapshot: fetched while the winner was still mid-provider-call,
// so outputAssetIds is EMPTY here — but the winner may commit (outputs + settle,
// status still GENERATING) between this read and the stale fail-close below.
const job = {
  id: "r1",
  ownerId: "o1",
  entityId: "e1",
  status: "GENERATING",
  mode: "BASE",
  model: "seedream",
  prompt: "p",
  count: 1,
  variantId: null,
  outputAssetIds: [],
  spentUsd: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.refGenJobFindUnique.mockResolvedValue(job);
  m.entityFindFirst.mockResolvedValue({ id: "e1", baseAssetId: null });
});

describe("handleRefGen — lost claim, stale-GENERATING fail-close", () => {
  it("guards the fail-close on outputAssetIds isEmpty (never fail-close a committed job)", async () => {
    m.refGenJobUpdateMany
      .mockResolvedValueOnce({ count: 0 }) // QUEUED→GENERATING claim lost
      .mockResolvedValueOnce({ count: 0 }); // stale fail-close matched nothing (winner committed)
    await handleRefGen({ refGenJobId: "r1" }, 0);

    expect(m.refGenJobUpdateMany).toHaveBeenCalledTimes(2);
    const stale = m.refGenJobUpdateMany.mock.calls[1]![0];
    expect(stale.where).toMatchObject({ id: "r1", status: "GENERATING" });
    // the DB-side guard (the fix): a job whose winner already committed outputs
    // (charged + settled) must never be flipped to FAILED by a late redelivery
    expect(stale.where.outputAssetIds).toEqual({ isEmpty: true });
    expect(stale.data).toMatchObject({ status: "FAILED" });
    // matched nothing → never touch the settled charge
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("still fail-closes + refunds a genuinely stale row (no committed outputs)", async () => {
    m.refGenJobUpdateMany
      .mockResolvedValueOnce({ count: 0 }) // claim lost
      .mockResolvedValueOnce({ count: 1 }); // stale fail-close won — refund the hold
    await handleRefGen({ refGenJobId: "r1" }, 0);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "r1" });
  });
});
