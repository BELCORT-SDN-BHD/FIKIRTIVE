/**
 * #601 T2b — what a board reader does when the settlement it calls comes back with an error.
 *
 * The settlement bounds its wait inside PostgreSQL (2s for the job's placement lock, 4s for the
 * statement). Bounding it means it now REJECTS on a board another writer is holding — and the
 * whole point of the bound is that the merchant gets their board back quickly, so that rejection
 * must not travel up and blank the canvas. Everything else must still fail loudly: a board that
 * is wrong for any other reason must not be quietly served as if it were right.
 *
 * The error fixtures below are the shapes REAL PostgreSQL failures have when they come back
 * through this repo's Prisma 7.8 + @prisma/adapter-pg client — captured by running the failures
 * against a real database, not invented. The end-to-end proof, with a real lock really held
 * while a real board is opened, is in canvas-settlement-browser-absent.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSettleCanvasCards } = vi.hoisted(() => ({ mockSettleCanvasCards: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ settleCanvasCardsForGenJob: mockSettleCanvasCards }));

const { reconcileSettledCanvasJobs } = await import("@/lib/canvas-settlement-reconcile");

/** A raw statement (the advisory lock) fails as P2010 carrying the driver error under `meta`. */
function rawStatementFailure(sqlstate: string, message: string): Error {
  return Object.assign(new Error(`Raw query failed. Code: \`${sqlstate}\`. Message: \`${message}\``), {
    name: "PrismaClientKnownRequestError",
    code: "P2010",
    clientVersion: "7.8.0",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { originalCode: sqlstate, originalMessage: message, kind: "postgres", code: sqlstate, severity: "ERROR", message },
      },
    },
  });
}

/** An ORM statement fails as the driver error itself. */
function ormStatementFailure(sqlstate: string, message: string): Error {
  return Object.assign(new Error(message), {
    name: "DriverAdapterError",
    clientVersion: "7.8.0",
    cause: { originalCode: sqlstate, originalMessage: message, kind: "postgres", code: sqlstate, severity: "ERROR", message },
  });
}

/** One delivered job with one paid output and no card for it — settlement is worth attempting. */
function unfinishedBoard(jobIds: string[]) {
  return {
    ownerId: "org_1",
    cards: [] as { genJobId: string | null; generationId: string | null; status: string }[],
    jobs: jobIds.map((id) => ({ id, status: "DONE", generationIds: [`gen_${id}`] })),
  };
}

beforeEach(() => {
  mockSettleCanvasCards.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("a board another writer is already holding", () => {
  it("gives way on a lock timeout instead of throwing the board away", async () => {
    mockSettleCanvasCards.mockRejectedValue(
      rawStatementFailure("55P03", "canceling statement due to lock timeout"),
    );

    await expect(reconcileSettledCanvasJobs(unfinishedBoard(["job_1"]))).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it("gives way on a statement timeout too, whichever statement was cancelled", async () => {
    for (const failure of [
      rawStatementFailure("57014", "canceling statement due to statement timeout"),
      ormStatementFailure("57014", "canceling statement due to statement timeout"),
      ormStatementFailure("55P03", "canceling statement due to lock timeout"),
    ]) {
      mockSettleCanvasCards.mockReset();
      mockSettleCanvasCards.mockRejectedValue(failure);
      await expect(reconcileSettledCanvasJobs(unfinishedBoard(["job_1"]))).resolves.toBe(false);
    }
  });

  it("stops at the first contended job, and still reports what an earlier job wrote", async () => {
    mockSettleCanvasCards
      .mockResolvedValueOnce({ status: "settled", nodeIds: ["cnd_1"], created: 1, updated: 0 })
      .mockRejectedValueOnce(rawStatementFailure("55P03", "canceling statement due to lock timeout"))
      .mockResolvedValue({ status: "settled", nodeIds: ["cnd_3"], created: 1, updated: 0 });

    // True: the first job DID write, so the caller must re-read before rendering.
    await expect(reconcileSettledCanvasJobs(unfinishedBoard(["job_1", "job_2", "job_3"]))).resolves.toBe(true);
    // The third job was never attempted — a second bounded wait would cost the merchant again.
    expect(mockSettleCanvasCards).toHaveBeenCalledTimes(2);
  });
});

describe("every other database failure", () => {
  it("still throws — a wrong board is not served as if it were right", async () => {
    for (const failure of [
      rawStatementFailure("42P01", 'relation "CanvasNode" does not exist'),
      rawStatementFailure("40P01", "deadlock detected"),
      ormStatementFailure("23505", "duplicate key value violates unique constraint"),
      new Error("connection terminated unexpectedly"),
    ]) {
      mockSettleCanvasCards.mockReset();
      mockSettleCanvasCards.mockRejectedValue(failure);
      await expect(reconcileSettledCanvasJobs(unfinishedBoard(["job_1"]))).rejects.toThrow(failure);
    }
  });

  it("is judged by its SQLSTATE, never by how the message is worded", async () => {
    // Same words a real lock timeout uses, a code that is not one. The wording is PostgreSQL's
    // to change; the code is the contract.
    mockSettleCanvasCards.mockRejectedValue(
      rawStatementFailure("42P01", "canceling statement due to lock timeout"),
    );

    await expect(reconcileSettledCanvasJobs(unfinishedBoard(["job_1"]))).rejects.toThrow(/lock timeout/);
  });
});
