/**
 * #601 T2b — placing the delivered cards is the LAST step of a generation job's completion path.
 *
 * What this pins, and why each one matters to a merchant:
 *  - Every way a job can be DELIVERED — first try, or resumed after a crash by a redelivery or
 *    the reaper — ends with the board being written, so "my tab was closed" can never mean "my
 *    paid work is missing".
 *  - The board write happens AFTER the charge is settled and after the job row says DONE. It is
 *    an append-only last step, never a participant in the charge.
 *  - If the board write itself falls over, the job still finishes and the money is still right.
 *    A card can be written again later; a charge cannot.
 *  - A job that ended badly is NOT written here. Failure/cancelled/timeout terminals are T2c, and
 *    the case below pins that this slice leaves them alone rather than half-projecting them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobFindMany = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const entityFindMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const assetUpsert = vi.fn();
  const shotUpdateMany = vi.fn();
  const queryRaw = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const settleCanvasCardsForGenJob = vi.fn();
  const generateImages = vi.fn();
  const generateVideo = vi.fn();
  const storagePut = vi.fn();
  const storagePresignedGet = vi.fn();
  const storage = { put: storagePut, presignedGet: storagePresignedGet };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, findMany: genJobFindMany, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst, create: generationCreate },
    asset: { upsert: assetUpsert },
    entity: { findMany: entityFindMany },
    shot: { updateMany: shotUpdateMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $queryRaw: queryRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobFindMany, genJobUpdate, genJobUpdateMany, projectFindFirst,
    generationFindFirst, generationCreate, entityFindMany, chatMessageFindFirst, chatMessageCreate,
    creditLedgerFindFirst, assetUpsert, shotUpdateMany, queryRaw, refundReservation, settleCredits,
    settleCanvasCardsForGenJob, generateImages, generateVideo, storage, storagePut, storagePresignedGet,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: m.settleCanvasCardsForGenJob,
}));
vi.mock("@fikirtive/db/principal", () => ({
  runAsSystem: (_name: string, fn: () => Promise<unknown>) => fn(),
  runAsTenant: (_ownerId: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, generateVideo: m.generateVideo } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { handleGen, reapStaleGenJobs } from "./gen.js";

const baseJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: "t1",
  shotId: null,
  status: "QUEUED",
  kind: "IMAGE",
  model: "seedream",
  prompt: "a cup steaming",
  entityIds: [],
  variantSel: null,
  count: 2,
  videoOptions: null,
  generationIds: [] as string[],
  spent: false,
  spentUsd: null,
  sourceGenerationId: null,
  tailGenerationId: null,
  referenceVideoGenerationId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.asset = { upsert: m.assetUpsert };
  m.prisma.generation = { findFirst: m.generationFindFirst, create: m.generationCreate };
  m.genJobFindUnique.mockResolvedValue({ ...baseJob });
  m.genJobFindMany.mockResolvedValue([]);
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.entityFindMany.mockResolvedValue([]);
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
  m.assetUpsert.mockResolvedValue({ id: "asset1" });
  m.generationCreate.mockResolvedValueOnce({ id: "gen1" }).mockResolvedValueOnce({ id: "gen2" });
  m.storagePut.mockResolvedValue({ contentHash: "h".repeat(64) });
  m.generateImages.mockResolvedValue([
    { bytes: new Uint8Array([1]), ext: "png" },
    { bytes: new Uint8Array([2]), ext: "png" },
  ]);
  m.settleCanvasCardsForGenJob.mockResolvedValue({ status: "settled", nodeIds: ["n1", "n2"], created: 1, updated: 1 });
  m.queryRaw.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

/** The order two mocked calls happened in, across all mocks in this file. */
function ranBefore(first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>): boolean {
  const a = first.mock.invocationCallOrder.at(-1);
  const b = second.mock.invocationCallOrder.at(0);
  return a !== undefined && b !== undefined && a < b;
}

describe("a delivered job", () => {
  it("writes the board as the last step, after the charge is settled and the job is DONE", async () => {
    await handleGen({ genJobId: "g1" }, 0);

    expect(m.settleCanvasCardsForGenJob).toHaveBeenCalledTimes(1);
    expect(m.settleCanvasCardsForGenJob).toHaveBeenCalledWith("g1", "o1");
    expect(ranBefore(m.settleCredits, m.settleCanvasCardsForGenJob)).toBe(true);
    const doneWrite = m.genJobUpdate.mock.calls.findIndex((call) => call[0]?.data?.status === "DONE");
    expect(doneWrite).toBeGreaterThanOrEqual(0);
    expect(ranBefore(m.genJobUpdate, m.settleCanvasCardsForGenJob)).toBe(true);
  });

  it("still finishes and keeps the money right when the board write fails", async () => {
    m.settleCanvasCardsForGenJob.mockRejectedValue(new Error("canvas write blew up"));

    await expect(handleGen({ genJobId: "g1" }, 0)).resolves.toBeUndefined();

    expect(m.genJobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DONE" }),
    }));
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });
});

describe("a job that never delivered", () => {
  it("does not touch the board when the job fails before spending", async () => {
    m.projectFindFirst.mockResolvedValue(null); // project gone → fail closed, no spend

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    // Showing a failure on the card is T2c; this slice must not half-project it.
    expect(m.settleCanvasCardsForGenJob).not.toHaveBeenCalled();
  });

  it("does not touch the board when a post-charge failure ends the job", async () => {
    // The paid call returned, then storing the bytes failed for good: terminal FAILED + refund.
    m.storagePut.mockRejectedValue(new Error("R2 down"));

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.settleCanvasCardsForGenJob).not.toHaveBeenCalled();
  });
});

describe("a job finished by a later delivery", () => {
  it("writes the board when a redelivery resumes an already-paid job", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...baseJob, status: "GENERATING", generationIds: ["gen1", "gen2"] });

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateImages).not.toHaveBeenCalled(); // never re-spends
    expect(m.settleCanvasCardsForGenJob).toHaveBeenCalledWith("g1", "o1");
    expect(ranBefore(m.settleCredits, m.settleCanvasCardsForGenJob)).toBe(true);
  });
});

describe("the reaper", () => {
  it("writes the board for the job it finishes, and not for the one it fails closed", async () => {
    const stale = { id: "g-stale", ownerId: "o1", threadId: "t1", kind: "IMAGE", model: "seedream" };
    const committed = { ...baseJob, id: "g-committed", status: "GENERATING", generationIds: ["gen1"] };
    m.genJobFindMany
      .mockResolvedValueOnce([stale])      // stale GENERATING scan → fail closed + refund
      .mockResolvedValueOnce([])           // stuck QUEUED scan
      .mockResolvedValueOnce([committed]); // committed-but-stuck scan → resume to DONE
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });

    await reapStaleGenJobs();

    expect(m.settleCanvasCardsForGenJob).toHaveBeenCalledTimes(1);
    expect(m.settleCanvasCardsForGenJob).toHaveBeenCalledWith("g-committed", "o1");
  });

  it("keeps sweeping when one job's board write fails", async () => {
    const committed = { ...baseJob, id: "g-committed", status: "GENERATING", generationIds: ["gen1"] };
    m.genJobFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([committed]);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    m.settleCanvasCardsForGenJob.mockRejectedValue(new Error("canvas write blew up"));

    await expect(reapStaleGenJobs()).resolves.toBe(1);
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });
});
