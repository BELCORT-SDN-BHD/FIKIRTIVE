/**
 * refgen-attach.test.ts — attachOutputs vs the ReferenceImage_live_entity_asset_variant_key
 * partial unique index (codex review 2026-07-03). attachOutputs is findFirst-then-create,
 * so a truly concurrent double-attach (a reaper-resumed redelivery racing a live delivery,
 * or two redeliveries) passes the pre-check on both sides; the DB index makes the loser's
 * create throw P2002. That loser must SKIP (the winner already attached this asset) and
 * finish the job — not bounce into the requeue/rethrow path for a row that's already there.
 * Exercised through handleRefGen's resume branch (outputAssetIds already recorded), which
 * is exactly the racing delivery. Non-P2002 create failures must keep today's behavior:
 * requeue + rethrow (pg-boss redelivers, resume re-attaches).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const refGenJobFindUnique = vi.fn();
  const refGenJobUpdate = vi.fn();
  const refGenJobUpdateMany = vi.fn();
  const refFindFirst = vi.fn();
  const refCreate = vi.fn();
  const entityUpdate = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refGenJob: { findUnique: refGenJobFindUnique, update: refGenJobUpdate, updateMany: refGenJobUpdateMany },
    referenceImage: { findFirst: refFindFirst, create: refCreate },
    entity: { update: entityUpdate },
    // #112 routes the committed-resume path through resumeCommittedRefGenJob, whose first step
    // reads the reserve ledger row. These tests enter resume-first (committedJob w/ outputAssetIds)
    // but don't exercise the ledger branch, so a null-returning stub is enough.
    creditLedger: { findFirst: vi.fn().mockResolvedValue(null) },
    // finalizeDone passes an ARRAY of PrismaPromises; the settle path passes a callback
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma)),
  };
  // Founder 2026-09-15 裁决:挂图与「挂上第一张即封面」同一个事务。留一个真的把手,
  // 好让下面断言这条 REFSHEET 路**确实**调了它(复核 P2-⑤:mock 成没把手的 vi.fn 等于没设防)。
  const reconcileCover = vi.fn(async () => null);
  return { prisma, refGenJobFindUnique, refGenJobUpdate, refGenJobUpdateMany, refFindFirst, refCreate, entityUpdate, refundReservation, settleCredits, reconcileCover };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, Prisma: {}, reconcileEntityCover: m.reconcileCover }));
// import-time deps the resume path does not exercise:
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));

import { handleRefGen } from "./refgen.js";

// A committed job (outputs recorded + spentUsd frozen) being redelivered — the resume path.
const committedJob = {
  id: "rj1",
  ownerId: "o1",
  entityId: "e1",
  variantId: null,
  mode: "REFSHEET",
  status: "GENERATING",
  outputAssetIds: ["a1", "a2"],
  spentUsd: 0.06,
  model: "seedream",
  count: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.refGenJobFindUnique.mockResolvedValue(committedJob);
  m.refFindFirst.mockResolvedValue(null); // nextRefPosition + per-asset pre-check: nothing attached yet
  m.refGenJobUpdate.mockResolvedValue({});
  m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
});

describe("attachOutputs — concurrent double-attach loses the index race (P2002)", () => {
  it("skips a P2002'd asset (winner already attached it) and still finishes the job", async () => {
    // a1: the concurrent winner attached between our pre-check and create → P2002.
    // a2: attaches normally.
    m.refCreate.mockRejectedValueOnce({ code: "P2002" }).mockResolvedValueOnce({ id: "ref2" });

    await expect(handleRefGen({ refGenJobId: "rj1" }, 0)).resolves.toBeUndefined();

    expect(m.refCreate).toHaveBeenCalledTimes(2); // a1 tried, a2 still attached after the skip
    expect(m.settleCredits).toHaveBeenCalledTimes(1); // resume settles (idempotent)
    // finalizeDone ran — the job lands DONE instead of bouncing through requeue
    expect(m.refGenJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DONE" }) }),
    );
    expect(m.refundReservation).not.toHaveBeenCalled();

    // PRODID-A4(Founder 2026-09-15 裁决)——**这条 REFSHEET 路**是裁决点名的那一条:从前只有
    // mode==='BASE' 在 finalizeDone 里钉封面,参考图集一张都不钉,于是商家挂了一整套参考图,
    // 产品在 Brand 页仍然没有脸。这里盯住「真的挂上去的那一张(a2)之后,封面规则跑过」——
    // 而且是在挂图的那个事务里(第一个参数就是 `$transaction` 递进去的 tx)。
    expect(m.reconcileCover).toHaveBeenCalledWith(
      m.prisma, // 这个 mock 的 $transaction 把 prisma 自己当 tx 递进回调
      { ownerId: "o1", entityId: "e1" },
    );
    // P2002 被跳过的那一张(a1)不调 —— 它整个事务都没进去。
    expect(m.reconcileCover).toHaveBeenCalledTimes(1);
  });

  it("a non-P2002 create failure keeps today's behavior: requeue + rethrow, no DONE", async () => {
    m.refCreate.mockRejectedValueOnce(new Error("connection reset"));

    await expect(handleRefGen({ refGenJobId: "rj1" }, 0)).rejects.toThrow("connection reset");

    // post-commit failure → recoverable requeue (status back to QUEUED), never DONE
    const requeue = m.refGenJobUpdateMany.mock.calls.at(-1)![0];
    expect(requeue.data).toMatchObject({ status: "QUEUED" });
    expect(m.refGenJobUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DONE" }) }),
    );
  });
});
