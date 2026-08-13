/**
 * gen-reaper.test.ts — reapStaleGenJobs: jobs the worker hung on (no redelivery)
 * must be fail-closed + refunded + given a terminal message, and a still-running
 * winner must be left alone (the conditional claim is the safety mechanism).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindMany = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const queryRaw = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findMany: genJobFindMany, update: genJobUpdate, updateMany: genJobUpdateMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    // the reaper's $transaction body only touches tx.genJob.update(Many) + settle/refund(tx)
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    // QUEUED-branch liveness check against pgboss.job (F07). Default: no live message.
    $queryRaw: queryRaw,
  };
  return { prisma, genJobFindMany, genJobUpdate, genJobUpdateMany, chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, refundReservation, settleCredits, queryRaw };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, // #601: the delivery path ends by writing the job's canvas cards. Stubbed so these suites
  // exercise the money path they are about, not a swallowed canvas error.
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })) }));
// import-time deps the reaper does not exercise:
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));

import { reapStaleGenJobs } from "./gen.js";

const stuckJob = { id: "g1", ownerId: "o1", threadId: "t1", kind: "IMAGE", model: "seedream" };
const stuckQueuedJob = { id: "g2", ownerId: "o2", threadId: "t2", kind: "IMAGE", model: "seedream" };

beforeEach(() => {
  vi.clearAllMocks();
  m.chatMessageFindFirst.mockResolvedValue({ seq: 5 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.genJobUpdate.mockResolvedValue({});
  // Default: no REFUND finalizer on the ledger → a committed job may be delivered.
  m.creditLedgerFindFirst.mockResolvedValue(null);
  // Default: pg-boss has no live message for the job → the QUEUED reap may proceed.
  m.queryRaw.mockResolvedValue([]);
  // Default for EVERY scan the sweep runs (each test overrides the ones it cares about with
  // mockResolvedValueOnce): nothing to reap. #782 r13 added a fourth scan, and a scan whose mock
  // falls off the end of the `Once` chain would return undefined and blow up the sweep.
  m.genJobFindMany.mockResolvedValue([]);
  // #782 r13: the self-heal reads refundReservation's four-state answer (#858) to decide whether
  // its FAILED flip may stand. Default = the ordinary case: we released the hold.
  m.refundReservation.mockResolvedValue("refunded");
});

describe("reapStaleGenJobs — GENERATING branch", () => {
  it("fail-closes + refunds + posts a TURN_ERROR for a stale GENERATING job we claim", async () => {
    // first findMany = GENERATING stuck; second findMany = no QUEUED stuck
    m.genJobFindMany.mockResolvedValueOnce([stuckJob]).mockResolvedValueOnce([]).mockResolvedValue([]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // we won the conditional claim
    const n = await reapStaleGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    const created = m.chatMessageCreate.mock.calls[0]![0].data;
    expect(created).toMatchObject({ kind: "TURN_ERROR", genJobId: "g1", threadId: "t1" });
    // TURN_ERROR must never carry costCredits — only successful GEN_RESULT does
    expect(created.payload).not.toHaveProperty("costCredits");
  });

  it("does NOT refund or post when the claim is lost (a live winner still owns it)", async () => {
    m.genJobFindMany.mockResolvedValueOnce([stuckJob]).mockResolvedValueOnce([]).mockResolvedValue([]);
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
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueuedJob]).mockResolvedValue([]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // conditional claim won
    const n = await reapStaleGenJobs();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o2", refId: "g2" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR", genJobId: "g2", threadId: "t2" });
  });

  it("does NOT reap a QUEUED job that still has a live pg-boss message (F07 — serial-queue starvation)", async () => {
    // A paid job can legitimately wait >25 min behind a burst of long video jobs (serial
    // batchSize:1 queue). If pg-boss still holds a live message for it, it will be delivered —
    // fail-closing it here would spuriously refund a job that's about to run.
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueuedJob]).mockResolvedValue([]);
    m.queryRaw.mockResolvedValue([{ id: "boss-msg-1" }]); // pg-boss: message is created/retry/active
    const n = await reapStaleGenJobs();
    expect(n).toBe(0);
    expect(m.genJobUpdateMany).not.toHaveBeenCalled(); // never even attempts the fail-close claim
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("does NOT refund or post a TURN_ERROR when a worker wins the race (updateMany returns count 0)", async () => {
    // Simulates the race: reaper selected the job, but a worker claimed it (QUEUED→GENERATING)
    // before the reaper's updateMany ran — count 0 means we lost, no refund, no message.
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueuedJob]).mockResolvedValue([]);
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
    m.genJobFindMany.mockResolvedValueOnce([stuckJob]).mockResolvedValueOnce([stuckQueuedJob]).mockResolvedValue([]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleGenJobs();
    expect(n).toBe(2);
    expect(m.refundReservation).toHaveBeenCalledTimes(2);
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(2);
  });

  it("never fail-closes a QUEUED job whose outputs are already committed (isEmpty guard on scan + claim)", async () => {
    // A committed job can land back in QUEUED (post-commit DONE-write blip → requeue) and then
    // lose its message on the final attempt. Fail-closing it would refund-no-op (already settled)
    // but post a FALSE "you weren't charged" TURN_ERROR that permanently wins the single-terminal-
    // message index over the real GEN_RESULT. The QUEUED scan must exclude committed rows.
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckQueuedJob]).mockResolvedValue([]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    await reapStaleGenJobs();
    const scan = m.genJobFindMany.mock.calls[1]![0];
    expect(scan.where.generationIds).toEqual({ isEmpty: true });
    const claim = m.genJobUpdateMany.mock.calls[0]![0];
    expect(claim.where.generationIds).toEqual({ isEmpty: true });
  });
});

describe("reapStaleGenJobs — committed-but-stuck resume scan (Codex 2026-07-03)", () => {
  // Winner delivery A committed (generationIds + settle landed, status still GENERATING) then
  // crashed before attach/DONE; the last redelivery B snapshotted pre-commit, lost the claim,
  // was (correctly) blocked by the isEmpty guard, and returned. No delivery will ever come
  // again — only the reaper can finish this job. It must RESUME (attach + DONE + settle no-op
  // + GEN_RESULT), never fail-close, never refund: outputs committed ⟹ already settled.
  const committedStuckJob = {
    id: "g3", ownerId: "o3", projectId: "p1", threadId: "t3", shotId: null,
    status: "GENERATING", kind: "IMAGE", model: "seedream", prompt: "p",
    entityIds: [], variantSel: null, count: 1, videoOptions: null,
    generationIds: ["gen_a"], spentUsd: 0.03,
  };

  it("finishes (DONE + settle + GEN_RESULT) a stuck job whose outputs are committed — never refunds", async () => {
    m.genJobFindMany
      .mockResolvedValueOnce([])                  // scan 1: stale GENERATING (uncommitted) — none
      .mockResolvedValueOnce([])                  // scan 2: stuck QUEUED — none
      .mockResolvedValueOnce([committedStuckJob]); // scan 3: committed-but-stuck
    const n = await reapStaleGenJobs();
    expect(n).toBe(1);
    // the scan targets exactly the stranded-commit population, past the reap window.
    // FAILED is deliberately EXCLUDED (Codex P1): a legacy FAILED row can carry outputs
    // while a REFUND won the finalizer — only QUEUED/GENERATING guarantee settle won.
    const scan = m.genJobFindMany.mock.calls[2]![0];
    expect(scan.where.generationIds).toEqual({ isEmpty: false });
    expect(scan.where.status).toEqual({ in: ["QUEUED", "GENERATING"] });
    expect(scan.where.startedAt.lt).toBeInstanceOf(Date);
    // delivery was gated on the ledger showing NO refund finalizer
    expect(m.creditLedgerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ refId: "g3", kind: "REFUND" }) }),
    );
    // finalized: DONE + settled; the charge stands — refund must NEVER run on a committed job
    const done = m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "DONE");
    expect(done).toBeTruthy();
    expect(m.settleCredits).toHaveBeenCalledWith(expect.anything(), { orgId: "o3", refId: "g3" });
    expect(m.refundReservation).not.toHaveBeenCalled();
    // the user finally gets their real result message (not a TURN_ERROR)
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    const msg = m.chatMessageCreate.mock.calls[0]![0].data;
    expect(msg).toMatchObject({ kind: "GEN_RESULT", genJobId: "g3" });
    expect(msg.payload.generationIds).toEqual(["gen_a"]);
  });

  it("a failing resume doesn't halt the sweep — the next job still finishes, the failure retries next sweep", async () => {
    const other = { ...committedStuckJob, id: "g4", ownerId: "o4", threadId: null, generationIds: ["gen_b"] };
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([committedStuckJob, other]);
    m.genJobUpdate.mockRejectedValueOnce(new Error("db blip")); // first job's DONE write fails
    const n = await reapStaleGenJobs();
    expect(n).toBe(1); // only the second healed this sweep; the first stays for the next sweep
    expect(m.refundReservation).not.toHaveBeenCalled(); // a resume failure must never turn into a refund
  });

  it("never delivers a committed job whose charge was REFUNDED — fails it closed, no re-refund, no result (Codex P1 free-delivery guard)", async () => {
    // Legacy shape (pre-conditional-commit era, or a future out-of-worker refund path):
    // outputs recorded on the row but a REFUND won the finalizer index — the merchant got
    // their money back. Delivering would be a FREE delivery; the resume must fail it
    // closed instead: no attach-to-DONE, no settle, no GEN_RESULT, and never refund again.
    m.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([committedStuckJob]);
    m.creditLedgerFindFirst.mockResolvedValueOnce({ id: "rf1" }); // a REFUND finalizer exists
    const n = await reapStaleGenJobs();
    expect(n).toBe(1); // transitioned out of stuck (to terminal FAILED) — counted as handled
    // The free-delivery guard's terminal write is conditional on the row still being in flight
    // like every other terminal write in gen.ts (#602 r2, judge P1-2).
    const failed = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failed).toBeTruthy();
    expect(failed![0].where).toMatchObject({ status: { in: ["QUEUED", "GENERATING"] } });
    expect(m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "DONE")).toBeFalsy();
    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled(); // already refunded — never refund twice
    const kinds = m.chatMessageCreate.mock.calls.map((c) => c[0].data.kind);
    expect(kinds).not.toContain("GEN_RESULT"); // the user must never see a result they weren't charged for
  });
});

describe("reapStaleGenJobs — DONE-with-nothing self-heal (#782 r13, judge r12 P1-F1)", () => {
  // A row that says DONE and cannot point at a single Generation. No merchant surface has an
  // honest word for it: "nothing started" is a lie about the money, the old result is a lie about
  // the replacement, and "you weren't charged" is a lie unless the hold really came back. The
  // sweep's job is to turn it into a state that IS honest — and only when the money says it may.
  const doneEmpty = { id: "g9", ownerId: "o9", threadId: "t9", kind: "VIDEO", model: "seedance-2-mini" };

  /** Only the 4th scan returns rows. */
  function onlyDoneEmptyScan(rows: unknown[] = [doneEmpty]) {
    m.genJobFindMany
      .mockResolvedValueOnce([]) // stale GENERATING
      .mockResolvedValueOnce([]) // stuck QUEUED
      .mockResolvedValueOnce([]) // committed-but-stuck
      .mockResolvedValueOnce(rows);
  }

  it("scans exactly the DONE-with-nothing population, past a grace window", async () => {
    onlyDoneEmptyScan();
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    await reapStaleGenJobs();
    const scan = m.genJobFindMany.mock.calls[3]![0];
    expect(scan.where.status).toBe("DONE");
    expect(scan.where.generationIds).toEqual({ isEmpty: true });
    expect(scan.where.finishedAt.lt).toBeInstanceOf(Date);
  });

  it("flips it to FAILED + refunds + posts an honest terminal message", async () => {
    onlyDoneEmptyScan();
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleGenJobs();
    expect(n).toBe(1);
    const failed = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failed).toBeTruthy();
    // The claim re-asserts every predicate — a concurrent resume that recorded outputs, or
    // another instance's sweep, makes it match zero rows.
    expect(failed![0].where).toMatchObject({ id: "g9", ownerId: "o9", status: "DONE", generationIds: { isEmpty: true } });
    // Labelled refund (#858 `reason`): "this reservation has a REFUND" says nothing about WHO
    // wrote it, so the sweep signs its own.
    expect(m.refundReservation).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o9", refId: "g9", reason: "gen:done-without-output" },
    );
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    const msg = m.chatMessageCreate.mock.calls[0]![0].data;
    expect(msg).toMatchObject({ kind: "TURN_ERROR", genJobId: "g9", threadId: "t9" });
    expect(msg.text).toContain("You weren't charged.");
  });

  for (const outcome of ["already-refunded", "no-reservation"] as const) {
    it(`keeps the flip when the ledger says "${outcome}" — the merchant is provably not out of pocket`, async () => {
      onlyDoneEmptyScan();
      m.genJobUpdateMany.mockResolvedValue({ count: 1 });
      m.refundReservation.mockResolvedValue(outcome);
      const n = await reapStaleGenJobs();
      expect(n).toBe(1);
      expect(m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED")).toBeTruthy();
      expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    });
  }

  it('ROLLS THE FLIP BACK when the ledger says "already-settled" — FAILED must never promise a refund that did not happen', async () => {
    // The one case where the merchant really is out of pocket. FAILED/CANCELLED carry
    // "you weren't charged" on every surface that reads them, and that promise is true only
    // because every path to those words releases the hold in the same transaction. Writing this
    // row FAILED would be the first exception — so the transaction is thrown away and a human is
    // asked instead. Putting the merchant right means moving money that was correctly taken.
    onlyDoneEmptyScan();
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    m.refundReservation.mockResolvedValue("already-settled");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const n = await reapStaleGenJobs();
      expect(n).toBe(0); // nothing healed
      expect(m.chatMessageCreate, "told the merchant they weren't charged over money that was taken").not.toHaveBeenCalled();
      expect(spy.mock.calls.flat().join(" ")).toContain("paid for nothing");
    } finally {
      spy.mockRestore();
    }
  });

  it("says nothing at all when it loses the claim (a concurrent resume recorded outputs first)", async () => {
    onlyDoneEmptyScan();
    m.genJobUpdateMany.mockResolvedValue({ count: 0 });
    const n = await reapStaleGenJobs();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("one bad row doesn't halt the sweep — the next one still heals", async () => {
    const other = { ...doneEmpty, id: "g10", ownerId: "o10", threadId: "t10" };
    onlyDoneEmptyScan([doneEmpty, other]);
    m.genJobUpdateMany.mockRejectedValueOnce(new Error("db blip")).mockResolvedValue({ count: 1 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const n = await reapStaleGenJobs();
      expect(n).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("counts alongside the other three scans in the sweep's return value", async () => {
    m.genJobFindMany
      .mockResolvedValueOnce([stuckJob])
      .mockResolvedValueOnce([stuckQueuedJob])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([doneEmpty]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    expect(await reapStaleGenJobs()).toBe(3);
  });
});
