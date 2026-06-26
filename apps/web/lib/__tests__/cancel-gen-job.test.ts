import { describe, it, expect, vi, beforeEach } from "vitest";

// cancelGenJob is the only NEW refund path #46 adds. Its safety rests on:
//  (a) a conditional updateMany WHERE { id, ownerId, status:"QUEUED" } — only a still-queued,
//      owner-scoped job matches (races against the worker's QUEUED→GENERATING claim lose),
//  (b) refundReservation fires ONLY when count>0,
//  (c) owner scoping (a cross-tenant jobId never matches),
//  (d) idempotency: a second call finds count 0 (status already FAILED) → no double-refund.

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner, requireRole: vi.fn(), requireSession: vi.fn() }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(), auth: vi.fn() }));

const updateMany = vi.fn();
const refundReservation = vi.fn();
// $transaction runs the callback with a tx that exposes genJob.updateMany, and returns its result.
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ genJob: { updateMany } }));
vi.mock("@fikirtive/db", () => ({
  prisma: { $transaction, genJob: { updateMany } },
  Prisma: {},
  refundReservation,
}));
vi.mock("@fikirtive/otto", () => ({ withLlmBudget: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ email: "u@t.test", ownerId: "org-1" });
});

const { cancelGenJob } = await import("@/lib/cowork-actions");

describe("cancelGenJob — refund/race (audit #46)", () => {
  it("QUEUED job: fails it closed (owner-scoped) and refunds exactly once", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const res = await cancelGenJob({ jobId: "g1" });
    expect(res).toEqual({ refunded: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "g1", ownerId: "org-1", status: "QUEUED" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
    expect(refundReservation).toHaveBeenCalledTimes(1);
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "org-1", refId: "g1" });
  });

  it("already started (worker won the race / DONE / FAILED): count 0 → no refund", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await cancelGenJob({ jobId: "g2" });
    expect(res).toEqual({ alreadyStarted: true });
    expect(refundReservation).not.toHaveBeenCalled();
  });

  it("cross-tenant jobId: ownerId scoping yields count 0 → no refund", async () => {
    updateMany.mockResolvedValue({ count: 0 }); // another org's job never matches the WHERE
    const res = await cancelGenJob({ jobId: "someone-elses" });
    expect(res).toEqual({ alreadyStarted: true });
    expect(refundReservation).not.toHaveBeenCalled();
  });

  it("invalid input (no jobId): rejects before any DB write or refund", async () => {
    const res = await cancelGenJob({});
    expect(res).toEqual({ error: "Invalid request." });
    expect(updateMany).not.toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
  });

  it("double-call: the second finds count 0 → refund happens at most once", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const first = await cancelGenJob({ jobId: "g3" });
    const second = await cancelGenJob({ jobId: "g3" });
    expect(first).toEqual({ refunded: true });
    expect(second).toEqual({ alreadyStarted: true });
    expect(refundReservation).toHaveBeenCalledTimes(1);
  });
});
