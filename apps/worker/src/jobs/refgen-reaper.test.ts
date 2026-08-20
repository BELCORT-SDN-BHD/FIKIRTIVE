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
  const refGenJobUpdate = vi.fn();
  const refGenJobUpdateMany = vi.fn();
  const referenceImageFindFirst = vi.fn();
  const referenceImageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const queryRaw = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refGenJob: { findMany: refGenJobFindMany, update: refGenJobUpdate, updateMany: refGenJobUpdateMany },
    referenceImage: { findFirst: referenceImageFindFirst, create: referenceImageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    // fn form (reaper claims, settle) AND array form (finalizeDone's PrismaPromise batch)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn(async (arg: any) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg))),
    // QUEUED-branch liveness check against pgboss.job (F07-analog). Default: no live message.
    $queryRaw: queryRaw,
  };
  return { prisma, refGenJobFindMany, refGenJobUpdate, refGenJobUpdateMany, referenceImageFindFirst, referenceImageCreate, creditLedgerFindFirst, refundReservation, settleCredits, queryRaw };
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
  // Default: pg-boss has no live message for the job → the QUEUED reap may proceed.
  m.queryRaw.mockResolvedValue([]);
  m.refGenJobUpdate.mockResolvedValue({});
  m.referenceImageFindFirst.mockResolvedValue(null);
  m.referenceImageCreate.mockResolvedValue({ id: "ref1" });
  // Default: no REFUND finalizer on the ledger → a committed job may be delivered.
  m.creditLedgerFindFirst.mockResolvedValue(null);
});

describe("reapStaleRefGenJobs — GENERATING branch", () => {
  it("fail-closes + refunds a stale GENERATING refgen job we claim", async () => {
    // first findMany = GENERATING stuck; second = no QUEUED stuck
    m.refGenJobFindMany.mockResolvedValueOnce([stuckGenerating]).mockResolvedValueOnce([]).mockResolvedValue([]);
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
    m.refGenJobFindMany.mockResolvedValueOnce([stuckGenerating]).mockResolvedValueOnce([]).mockResolvedValue([]);
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
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueued]).mockResolvedValue([]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o2", refId: "r2" });
    const claim = m.refGenJobUpdateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ id: "r2", status: "QUEUED" });
    expect(claim.data).toMatchObject({ status: "FAILED" });
  });

  it("does NOT reap a QUEUED refgen job that still has a live pg-boss message (F07-analog — serial-queue starvation)", async () => {
    // A paid refgen job can legitimately wait >25 min behind a congested worker. If pg-boss
    // still holds a live message for it (created/retry/active), it WILL be delivered —
    // fail-closing it here would refund a job that then runs anyway (a free paid generation).
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueued]);
    m.queryRaw.mockResolvedValue([{ id: "boss-msg-1" }]); // pg-boss: message is created/retry/active
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(0);
    expect(m.refGenJobUpdateMany).not.toHaveBeenCalled(); // never even attempts the fail-close claim
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("skips the QUEUED reap this sweep when the pg-boss liveness check fails (fail-safe)", async () => {
    // If pgboss.job can't be read we must assume a live message MAY exist — a delayed reap
    // is far better than refunding a live paid job.
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueued]);
    m.queryRaw.mockRejectedValue(new Error("pgboss schema unreadable"));
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(0);
    expect(m.refGenJobUpdateMany).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("does NOT refund when a worker wins the QUEUED→GENERATING race (count 0)", async () => {
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueued]).mockResolvedValue([]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 0 });
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("counts GENERATING-stale + QUEUED-stuck combined", async () => {
    m.refGenJobFindMany.mockResolvedValueOnce([stuckGenerating]).mockResolvedValueOnce([stuckQueued]).mockResolvedValue([]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(2);
    expect(m.refundReservation).toHaveBeenCalledTimes(2);
  });

  it("never fail-closes a QUEUED job whose outputs are already committed (isEmpty guard on scan + claim)", async () => {
    // A committed job can land back in QUEUED (post-commit finalize blip → requeue) and lose
    // its message on the final attempt. Fail-closing it would show FAILED on a job the user
    // WAS charged for (settle already won; the refund no-ops) — the QUEUED scan must skip it.
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueued]).mockResolvedValue([]);
    m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
    await reapStaleRefGenJobs();
    const scan = m.refGenJobFindMany.mock.calls[1]![0];
    expect(scan.where.outputAssetIds).toEqual({ isEmpty: true });
    const claim = m.refGenJobUpdateMany.mock.calls[0]![0];
    expect(claim.where.outputAssetIds).toEqual({ isEmpty: true });
  });
});

describe("reapStaleRefGenJobs — committed-but-stuck resume scan (Codex 2026-07-03)", () => {
  // Winner delivery A committed (outputAssetIds + settle landed, status still GENERATING) then
  // crashed before attachOutputs/finalizeDone; the last redelivery B snapshotted pre-commit,
  // lost the claim, was (correctly) blocked by the isEmpty guard, and returned. No delivery
  // ever comes again: the ReferenceImage rows are never created (user sees nothing) and the
  // partial-unique active index keeps the entity/variant slot hostage. The reaper must RESUME
  // (attach + settle no-op + DONE) — never fail-close, never refund (committed ⟹ settled).
  const committedStuck = {
    id: "r3", ownerId: "o3", entityId: "e1", variantId: null, mode: "REFSHEET",
    model: "seedream", prompt: "p", count: 2, status: "GENERATING",
    outputAssetIds: ["a1", "a2"], spentUsd: 0.08,
  };

  it("attaches + finalizes (DONE + settle) a stuck job whose outputs are committed — never refunds", async () => {
    m.refGenJobFindMany
      .mockResolvedValueOnce([])               // scan 1: stale GENERATING (uncommitted) — none
      .mockResolvedValueOnce([])               // scan 2: stuck QUEUED — none
      .mockResolvedValueOnce([committedStuck]); // scan 3: committed-but-stuck
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(1);
    // the scan targets exactly the stranded-commit population, past the reap window.
    // FAILED is deliberately EXCLUDED (Codex P1): a legacy FAILED row can carry outputs
    // while a REFUND won the finalizer — only QUEUED/GENERATING guarantee settle won.
    const scan = m.refGenJobFindMany.mock.calls[2]![0];
    expect(scan.where.outputAssetIds).toEqual({ isEmpty: false });
    expect(scan.where.status).toEqual({ in: ["QUEUED", "GENERATING"] });
    expect(scan.where.startedAt.lt).toBeInstanceOf(Date);
    // delivery was gated on the ledger showing NO refund finalizer
    expect(m.creditLedgerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ refId: "r3", kind: "REFUND" }) }),
    );
    // the user-visible outputs finally exist: one ReferenceImage per committed asset
    expect(m.referenceImageCreate).toHaveBeenCalledTimes(2);
    expect(m.referenceImageCreate.mock.calls[0]![0].data).toMatchObject({ entityId: "e1", assetId: "a1", variantId: null });
    expect(m.referenceImageCreate.mock.calls[1]![0].data).toMatchObject({ entityId: "e1", assetId: "a2", variantId: null });
    // finalized: DONE (frees the active-index slot) + settled; refund must NEVER run
    const done = m.refGenJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "DONE");
    expect(done).toBeTruthy();
    expect(m.settleCredits).toHaveBeenCalledWith(expect.anything(), { orgId: "o3", refId: "r3" });
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("a failing resume doesn't halt the sweep — the next job still finishes, the failure retries next sweep", async () => {
    const other = { ...committedStuck, id: "r4", ownerId: "o4", outputAssetIds: ["b1"] };
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([committedStuck, other]);
    m.referenceImageFindFirst.mockRejectedValueOnce(new Error("db blip")); // first job's attach fails
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(1); // only the second healed this sweep; the first stays for the next sweep
    expect(m.refundReservation).not.toHaveBeenCalled(); // a resume failure must never turn into a refund
  });

  it("never delivers a committed job whose charge was REFUNDED — fails it closed, no attach, no re-refund (Codex P1 free-delivery guard)", async () => {
    // Legacy shape: outputs recorded but a REFUND won the finalizer — the merchant got their
    // money back. Attaching + DONE would hand them the images for free; fail it closed instead.
    m.refGenJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([committedStuck]);
    m.creditLedgerFindFirst.mockResolvedValueOnce({ id: "rf1" }); // a REFUND finalizer exists
    const n = await reapStaleRefGenJobs();
    expect(n).toBe(1); // transitioned out of stuck (to terminal FAILED) — counted as handled
    expect(m.referenceImageCreate).not.toHaveBeenCalled(); // refunded outputs are never attached
    // #951 漏网(M1-b):这一笔终态写现在和 gen.ts 的同一处一样,是**条件** updateMany
    // (只在行还在飞时才落),所以断言跟着搬到 updateMany 上,并连它的谓词一起钉。
    const failed = m.refGenJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failed).toBeTruthy();
    expect(failed![0].where).toEqual(
      expect.objectContaining({ id: "r3", ownerId: "o3", status: { in: ["QUEUED", "GENERATING"] } }),
    );
    expect(m.refGenJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "DONE")).toBeFalsy();
    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled(); // already refunded — never refund twice
  });
});
