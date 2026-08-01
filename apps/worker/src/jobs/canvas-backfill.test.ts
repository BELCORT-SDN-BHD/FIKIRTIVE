/**
 * #601 T2b r2 — the sweep that finishes a delivered job's board when the completion path could not.
 *
 * The merchant behaviour: the job was delivered and charged, the board write then fell over, and
 * nothing in the system used to look at that job ever again. These cases pin that a later sweep
 * does look, that it repairs the board with the SAME idempotent shell the delivery path uses, and
 * that it stays completely out of the money path while doing it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  findCanvasSettlementBacklog: vi.fn(),
  settleCanvasCardsForGenJob: vi.fn(),
  settleCredits: vi.fn(),
  refundReservation: vi.fn(),
  tenants: [] as string[],
}));

vi.mock("@fikirtive/db", () => ({
  findCanvasSettlementBacklog: m.findCanvasSettlementBacklog,
  settleCanvasCardsForGenJob: m.settleCanvasCardsForGenJob,
  // Present only so a stray money call would be VISIBLE here rather than crashing on an
  // undefined import: the assertions below require both to stay untouched.
  settleCredits: m.settleCredits,
  refundReservation: m.refundReservation,
  prisma: {},
}));
vi.mock("@fikirtive/db/principal", () => ({
  runAsTenant: (ownerId: string, fn: () => Promise<unknown>) => {
    m.tenants.push(ownerId);
    return fn();
  },
}));

const {
  backfillCanvasBoards,
  CANVAS_BACKFILL_GRACE_MS,
  CANVAS_BACKFILL_LOOKBACK_MS,
  CANVAS_BACKFILL_LIMIT,
} = await import("./canvas-backfill.js");

const settled = { status: "settled", nodeIds: ["n1"], created: 1, updated: 0 };
const nothingToDo = { status: "settled", nodeIds: ["n1"], created: 0, updated: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  m.tenants.length = 0;
  m.findCanvasSettlementBacklog.mockResolvedValue([]);
  m.settleCanvasCardsForGenJob.mockResolvedValue(settled);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the canvas backfill sweep", () => {
  it("finishes the board of every delivered job the backlog reports, as that job's own tenant", async () => {
    m.findCanvasSettlementBacklog.mockResolvedValue([
      { id: "g1", ownerId: "o1" },
      { id: "g2", ownerId: "o2" },
    ]);

    await expect(backfillCanvasBoards()).resolves.toBe(2);

    expect(m.settleCanvasCardsForGenJob.mock.calls).toEqual([["g1", "o1"], ["g2", "o2"]]);
    expect(m.tenants).toEqual(["o1", "o2"]);
  });

  it("asks only for jobs old enough to be finished with, and never for an unbounded list", async () => {
    const now = new Date("2026-08-01T12:00:00.000Z");

    await backfillCanvasBoards(now);

    expect(m.findCanvasSettlementBacklog).toHaveBeenCalledWith({
      finishedAfter: new Date(now.getTime() - CANVAS_BACKFILL_LOOKBACK_MS),
      finishedBefore: new Date(now.getTime() - CANVAS_BACKFILL_GRACE_MS),
      limit: CANVAS_BACKFILL_LIMIT,
    });
    expect(CANVAS_BACKFILL_GRACE_MS).toBeGreaterThan(0);
  });

  it("reports nothing repaired when every board already matched its job", async () => {
    m.findCanvasSettlementBacklog.mockResolvedValue([{ id: "g1", ownerId: "o1" }]);
    m.settleCanvasCardsForGenJob.mockResolvedValue(nothingToDo);

    await expect(backfillCanvasBoards()).resolves.toBe(0);
  });

  it("keeps sweeping when one board cannot be repaired — that one retries next sweep", async () => {
    m.findCanvasSettlementBacklog.mockResolvedValue([
      { id: "g-broken", ownerId: "o1" },
      { id: "g-fine", ownerId: "o1" },
    ]);
    m.settleCanvasCardsForGenJob
      .mockRejectedValueOnce(new Error("canvas write blew up"))
      .mockResolvedValueOnce(settled);

    await expect(backfillCanvasBoards()).resolves.toBe(1);
    expect(m.settleCanvasCardsForGenJob).toHaveBeenCalledTimes(2);
  });

  it("never touches money — no ledger, no settle, no refund, whatever it finds", async () => {
    m.findCanvasSettlementBacklog.mockResolvedValue([
      { id: "g1", ownerId: "o1" },
      { id: "g-broken", ownerId: "o2" },
    ]);
    m.settleCanvasCardsForGenJob
      .mockResolvedValueOnce(settled)
      .mockRejectedValueOnce(new Error("canvas write blew up"));

    await backfillCanvasBoards();

    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });
});
