/**
 * gen-requeue.test.ts — F04: the recoverable-retry requeue must be a GUARDED
 * conditional write. A job a finalizer (reaper / stale fail-close) already
 * FAILED+refunded mid-flight must NEVER be resurrected to QUEUED by a delivery
 * whose pre-charge query throws transiently — that would let a later delivery run
 * the paid call and deliver a free result against an already-refunded reservation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, refundReservation, settleCredits };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, // #601: the delivery path ends by writing the job's canvas cards. Stubbed so these suites
  // exercise the money path they are about, not a swallowed canvas error.
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })) }));
// import-time deps the requeue path does not exercise before the throw:
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));

import { handleGen } from "./gen.js";

// A QUEUED job (no recorded outputs). The pre-charge project lookup at gen.ts:300
// throws (prisma.project is undefined on the mock) BEFORE the spend claim, so with
// retryCount 0 the catch takes the RECOVERABLE requeue branch.
const baseJob = {
  id: "g1", ownerId: "o1", projectId: "p1", shotId: null, threadId: null,
  kind: "IMAGE", model: "seedream", count: 1, prompt: "x", entityIds: [],
  generationIds: [], status: "QUEUED", spent: false, spentUsd: null,
  videoOptions: null, variantSel: null, sourceGenerationId: null, tailGenerationId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleGen recoverable requeue is status-guarded (F04)", () => {
  it("requeues with a status filter so a finalizer-FAILED job is not resurrected", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...baseJob });
    // In the window between read and requeue a reaper FAILED+refunded the row, so the
    // guarded requeue matches 0 rows and leaves it FAILED (no free re-delivery).
    m.genJobUpdateMany.mockResolvedValue({ count: 0 });

    // pre-charge project lookup throws → caught → recoverable requeue branch.
    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    // The requeue MUST be a guarded conditional write (updateMany with a status filter),
    // NOT an unconditional single-row update that would resurrect a FAILED/DONE row.
    expect(m.genJobUpdateMany).toHaveBeenCalledTimes(1);
    const call = m.genJobUpdateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: "g1" });
    expect(call.where.status).toEqual({ in: ["QUEUED", "GENERATING"] });
    expect(call.data).toMatchObject({ status: "QUEUED" });
    expect(m.genJobUpdate).not.toHaveBeenCalled();
  });
});
