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
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const queryRaw = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findMany: genJobFindMany, update: genJobUpdate, updateMany: genJobUpdateMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    // the reaper's $transaction body only touches tx.genJob.update(Many) + settle/refund(tx)
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    // QUEUED-branch liveness check against pgboss.job (F07). Default: no live message.
    $queryRaw: queryRaw,
  };
  return { prisma, genJobFindMany, genJobUpdate, genJobUpdateMany, chatMessageFindFirst, chatMessageCreate, refundReservation, settleCredits, queryRaw };
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
  m.genJobUpdate.mockResolvedValue({});
  // Default: pg-boss has no live message for the job → the QUEUED reap may proceed.
  m.queryRaw.mockResolvedValue([]);
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
    // the scan targets exactly the stranded-commit population, past the reap window
    const scan = m.genJobFindMany.mock.calls[2]![0];
    expect(scan.where.generationIds).toEqual({ isEmpty: false });
    expect(scan.where.status).toEqual({ in: ["QUEUED", "GENERATING", "FAILED"] });
    expect(scan.where.startedAt.lt).toBeInstanceOf(Date);
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
});
