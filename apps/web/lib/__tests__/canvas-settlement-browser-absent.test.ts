/**
 * #601 T2b — the board a merchant comes back to, against a REAL database and REAL stored media.
 *
 * The scenario every case here shares: the merchant pressed Make, closed the tab, and never came
 * back until now. The only writer that ran was the delivered job's completion path (the worker's
 * `settleCanvasCardsForGenJob`, called directly here — the worker's own wiring is pinned in
 * apps/worker/src/jobs/gen-canvas-settlement.test.ts).
 *
 * What that lets this file prove:
 *  1. Opening the board shows every paid output, with its picture — no browser placed anything.
 *  2. Opening the board then has nothing left to fix. The read path still carries its own repair
 *     logic (deleting that is T2d); these cases show it now finds a board that already matches
 *     the job, which is the precondition T2d needs before any of it can be removed.
 *
 * Harness: only the session is mocked (same dialect as cross-tenant-write.test.ts) — requireOwner,
 * Prisma, the media store and the real server actions all run.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin: () => false, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma, settleCanvasCardsForGenJob, canvasJobPlacementLockKey } = await import("@fikirtive/db");
const { storage } = await import("@/lib/storage");
const { listCanvasNodes } = await import("@/lib/canvas-actions");
const { syncOttoCanvasNodes } = await import("@/lib/otto-canvas-bridge");

const EMAIL = `canvas601-${randomUUID()}@fikirtive.test`;
let ownerId: string;
let projectId: string;

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = EMAIL;
  await prisma.user.upsert({ where: { email: EMAIL }, update: {}, create: { id: `usr_${randomUUID()}`, email: EMAIL } });
  mockAuth.mockResolvedValue({ user: { email: EMAIL } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  ownerId = gate.ownerId;
});

beforeEach(async () => {
  projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Comeback board" } });
});

afterAll(async () => {
  await prisma.canvasNode.deleteMany({ where: { ownerId } });
});

/** A real paid output: bytes in the store, plus the Asset + Generation the worker commits. */
async function seedStoredGeneration(): Promise<string> {
  const bytes = new Uint8Array(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)));
  const { contentHash } = await storage.put(ownerId, bytes, "png");
  const asset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId, contentHash, ext: "png",
      mime: "image/png", sizeBytes: BigInt(bytes.byteLength), source: "GENERATED",
    },
  });
  const generation = await prisma.generation.create({
    data: { id: `gen_${randomUUID()}`, ownerId, projectId, assetId: asset.id, source: "GENERATED", entitySnapshot: {} },
  });
  return generation.id;
}

async function seedDoneJob(outputs: number): Promise<{ jobId: string; generationIds: string[] }> {
  const generationIds: string[] = [];
  for (let i = 0; i < outputs; i += 1) generationIds.push(await seedStoredGeneration());
  const jobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId, projectId, prompt: "a cup steaming", kind: "IMAGE", model: "seedream",
      count: outputs, status: "DONE", generationIds, spent: true, spentUsd: 0.12,
      startedAt: new Date(), finishedAt: new Date(),
    },
  });
  return { jobId, generationIds };
}

/** The in-flight card the browser placed before the tab was closed. */
async function seedPendingAnchor(jobId: string): Promise<string> {
  const id = `cnd_${randomUUID()}`;
  await prisma.canvasNode.create({
    data: {
      id, ownerId, projectId, type: "image", x: 100, y: 50, w: 320, h: 320,
      prompt: "a cup steaming", genJobId: jobId, status: "pending",
    },
  });
  return id;
}

async function seedCard(input: {
  jobId: string | null;
  x: number;
  y: number;
  status?: string;
  generationId?: string | null;
}): Promise<string> {
  const id = `cnd_${randomUUID()}`;
  await prisma.canvasNode.create({
    data: {
      id, ownerId, projectId, type: "image", x: input.x, y: input.y, w: 320, h: 320,
      prompt: "a cup steaming", genJobId: input.jobId, generationId: input.generationId ?? null,
      status: input.status ?? "pending",
    },
  });
  return id;
}

/**
 * What a board LOOKS like, free of the ids that differ between two runs of the same scenario:
 * each card is described by where it sits, what state it is in, WHICH output of the batch it
 * carries, and which card it points at. Two boards that are the same board have the same shape.
 */
function shape(
  rows: Array<{ x: number; y: number; status: string; generationId: string | null; sourceNodeId: string | null }>,
  context: { anchorId?: string; outputs?: string[] } = {},
) {
  const outputs = context.outputs ?? [];
  return rows
    .map((row) => {
      const index = row.generationId ? outputs.indexOf(row.generationId) : -1;
      return {
        x: row.x, y: row.y, status: row.status,
        carries: row.generationId === null ? "nothing" : index >= 0 ? `output-${index}` : "another-job",
        sourceNodeId: row.sourceNodeId === null ? null : row.sourceNodeId === context.anchorId ? "the-anchor" : "elsewhere",
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x || a.carries.localeCompare(b.carries));
}

/** Every stored fact about this board, including updatedAt — so "a read wrote nothing" is provable. */
async function boardRows(pid: string = projectId) {
  return prisma.canvasNode.findMany({
    where: { ownerId, projectId: pid },
    orderBy: [{ y: "asc" }, { x: "asc" }],
  });
}

/** A second board, so the same scenario can be run twice — once per writer. */
async function freshProject(): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Comeback board" } });
  return id;
}

describe("coming back to a board nobody was watching", () => {
  it("shows every output of the batch, with its picture", async () => {
    const { jobId, generationIds } = await seedDoneJob(4);
    await seedPendingAnchor(jobId);

    await settleCanvasCardsForGenJob(jobId, ownerId);
    const cards = await listCanvasNodes(projectId);

    expect(Array.isArray(cards)).toBe(true);
    const board = (cards as Array<{ status: string; url?: string | null; generationId: string | null }>);
    expect(board).toHaveLength(4);
    expect(board.map((card) => card.status)).toEqual(["done", "done", "done", "done"]);
    expect(board.map((card) => card.generationId).sort()).toEqual([...generationIds].sort());
    expect(board.every((card) => typeof card.url === "string" && card.url.length > 0)).toBe(true);
  });

  it("leaves the read path with nothing left to repair", async () => {
    const { jobId } = await seedDoneJob(3);
    await seedPendingAnchor(jobId);
    await settleCanvasCardsForGenJob(jobId, ownerId);

    const before = await boardRows();
    await listCanvasNodes(projectId);
    await listCanvasNodes(projectId);
    const after = await boardRows();

    expect(after).toEqual(before);
  });

  it("leaves the chat-side board reader with nothing left to repair either", async () => {
    const threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
    const { jobId, generationIds } = await seedDoneJob(2);
    await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { threadId } });
    await settleCanvasCardsForGenJob(jobId, ownerId);
    await syncOttoCanvasNodes(projectId);

    const before = await boardRows();
    const synced = await syncOttoCanvasNodes(projectId);
    const after = await boardRows();

    expect(Array.isArray(synced)).toBe(true);
    expect((synced as unknown[]).length).toBe(2);
    expect(after).toEqual(before);
    expect(before.map((row) => row.generationId).sort()).toEqual([...generationIds].sort());
  });
});

/**
 * Two writers, one board. The worker writes a delivered job's cards; opening the board writes
 * whatever it finds missing. They take turns (one lock), but taking turns only stops them
 * corrupting each other — it does not make them AGREE. These cases run the identical scenario
 * twice, once per writer, and require the resulting board to be the same either way. A merchant
 * must not get a different board because a tab happened to be open.
 */
describe("the board is the same whichever writer got there first", () => {
  it("puts the missing card of a half-deleted batch in the same place either way", async () => {
    // A batch of two where only the SECOND card is still on the board.
    async function scenario(): Promise<{ pid: string; jobId: string; anchorId: string; outputs: string[] }> {
      projectId = await freshProject();
      const { jobId, generationIds } = await seedDoneJob(2);
      const anchorId = await seedCard({ jobId, x: 500, y: 200, status: "done", generationId: generationIds[1] });
      return { pid: projectId, jobId, anchorId, outputs: generationIds };
    }

    const server = await scenario();
    await settleCanvasCardsForGenJob(server.jobId, ownerId);

    const browser = await scenario();
    await listCanvasNodes(browser.pid);

    expect(shape(await boardRows(browser.pid), browser))
      .toEqual(shape(await boardRows(server.pid), server));
  });

  it("gives a batch made FROM an earlier card the same cards either way", async () => {
    async function scenario(): Promise<{ pid: string; jobId: string; anchorId: string; outputs: string[] }> {
      projectId = await freshProject();
      const sourceGenerationId = await seedStoredGeneration();
      await seedCard({ jobId: null, x: 80, y: 80, status: "done", generationId: sourceGenerationId });
      const { jobId, generationIds } = await seedDoneJob(2);
      await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { sourceGenerationId } });
      const anchorId = await seedCard({ jobId, x: 500, y: 500, status: "pending" });
      return { pid: projectId, jobId, anchorId, outputs: generationIds };
    }

    const server = await scenario();
    await settleCanvasCardsForGenJob(server.jobId, ownerId);

    const browser = await scenario();
    await listCanvasNodes(browser.pid);

    expect(shape(await boardRows(browser.pid), browser))
      .toEqual(shape(await boardRows(server.pid), server));
  });

  it("ends up in one state when both writers run at the same moment", async () => {
    const { jobId, generationIds } = await seedDoneJob(4);
    const anchorId = await seedPendingAnchor(jobId);

    // Both writers race for the same job. Whoever loses the lock must find the board already
    // right and add nothing of its own.
    await Promise.all([
      settleCanvasCardsForGenJob(jobId, ownerId),
      listCanvasNodes(projectId),
      syncOttoCanvasNodes(projectId),
    ]);
    const raced = await boardRows();

    // The same scenario settled by the server alone — the reference the race must reproduce.
    const alone = await freshProject();
    const previous = projectId;
    projectId = alone;
    const { jobId: aloneJob, generationIds: aloneOutputs } = await seedDoneJob(4);
    const aloneAnchor = await seedPendingAnchor(aloneJob);
    await settleCanvasCardsForGenJob(aloneJob, ownerId);
    projectId = previous;

    expect(raced).toHaveLength(4);
    expect(shape(raced, { anchorId, outputs: generationIds }))
      .toEqual(shape(await boardRows(alone), { anchorId: aloneAnchor, outputs: aloneOutputs }));
  });
});

/**
 * The chat bridge's OWN writer, which the cases above never reached: a GEN_RESULT message.
 *
 * Until #601 r3 that message made the bridge place the batch itself, one card per output in a
 * left-to-right line, and its own writes then made the shared pre-check report the board as
 * finished — so the settlement never got to correct it. Which board a merchant ended up with
 * depended on whether a chat happened to be open, and on who reached the job lock first.
 */
describe("a batch that arrived as a chat result", () => {
  async function seedChatResultJob(outputs: number): Promise<{ jobId: string; generationIds: string[]; threadId: string }> {
    const threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
    const { jobId, generationIds } = await seedDoneJob(outputs);
    await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { threadId } });
    await prisma.chatMessage.create({
      data: {
        id: `msg_${randomUUID()}`, threadId, ownerId, role: "AGENT", kind: "GEN_RESULT", seq: 1,
        text: "a cup steaming", genJobId: jobId,
        payload: { kind: "image", model: "seedream", generationIds },
      },
    });
    return { jobId, generationIds, threadId };
  }

  it("gets the same board from the chat reader as from the server, card for card", async () => {
    const server = await (async () => {
      projectId = await freshProject();
      const seeded = await seedChatResultJob(4);
      await settleCanvasCardsForGenJob(seeded.jobId, ownerId);
      return { pid: projectId, outputs: seeded.generationIds };
    })();

    const chat = await (async () => {
      projectId = await freshProject();
      const seeded = await seedChatResultJob(4);
      await syncOttoCanvasNodes(projectId);
      return { pid: projectId, outputs: seeded.generationIds };
    })();

    expect(await boardRows(chat.pid)).toHaveLength(4);
    expect(shape(await boardRows(chat.pid), chat)).toEqual(shape(await boardRows(server.pid), server));
  });

  it("ends up in one state when the chat reader and the server settle at the same moment", async () => {
    projectId = await freshProject();
    const raced = await seedChatResultJob(4);
    // The chat reader is dispatched FIRST on purpose — it is the writer that used to place this
    // batch itself, so this is the ordering that gives it the best chance at the lock. HONEST
    // LIMIT: which writer actually reaches the lock first is not under this test's control (the
    // settlement won every observed run, before and after the fix), so this case proves
    // CONVERGENCE, not the defect. The red for the defect is the deterministic parity case above.
    await Promise.all([
      syncOttoCanvasNodes(projectId),
      settleCanvasCardsForGenJob(raced.jobId, ownerId),
      listCanvasNodes(projectId),
    ]);
    const racedRows = await boardRows(projectId);
    const racedPid = projectId;

    // The same scenario settled by the server alone — the reference the race must reproduce.
    projectId = await freshProject();
    const alone = await seedChatResultJob(4);
    await settleCanvasCardsForGenJob(alone.jobId, ownerId);

    expect(racedRows).toHaveLength(4);
    expect(shape(racedRows, { outputs: raced.generationIds }))
      .toEqual(shape(await boardRows(projectId), { outputs: alone.generationIds }));
    expect(racedPid).not.toBe(projectId);
  });
});

describe("the chat-side board reader agrees too", () => {
  it("places a half-deleted batch's missing card exactly where the server would", async () => {
    async function scenario(): Promise<{ pid: string; jobId: string; anchorId: string; outputs: string[] }> {
      projectId = await freshProject();
      const threadId = `thr_${randomUUID()}`;
      await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
      const { jobId, generationIds } = await seedDoneJob(2);
      await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { threadId } });
      const anchorId = await seedCard({ jobId, x: 500, y: 200, status: "done", generationId: generationIds[1] });
      return { pid: projectId, jobId, anchorId, outputs: generationIds };
    }

    const server = await scenario();
    await settleCanvasCardsForGenJob(server.jobId, ownerId);

    const chat = await scenario();
    await syncOttoCanvasNodes(chat.pid);

    expect(shape(await boardRows(chat.pid), chat))
      .toEqual(shape(await boardRows(server.pid), server));
  });
});

/**
 * The other half of "the board is the merchant's home": it has to open even when somebody else
 * is writing it.
 *
 * The settlement bounds its wait for the job's placement lock inside PostgreSQL, so a contended
 * board gives up in about two seconds instead of hanging (#611). Giving up is a REJECTION, and
 * these cases hold the lock for real while a real board is opened: both readers must come back
 * with the board as it stands — the merchant's existing cards — instead of an error page.
 * What this read could not finish, the backfill sweep finishes later.
 */
describe("opening a board another writer is already holding", () => {
  /** Hold that job's placement lock for real, and run the reader while it is held. */
  async function whileJobLockIsHeld<T>(jobId: string, pid: string, read: () => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const lockKey = canvasJobPlacementLockKey(ownerId, pid, jobId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
      // Nothing releases this lock until the read has returned, so a read that waited without a
      // bound would never return at all.
      return read();
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  it("gives the canvas reader the board as it stands, and writes nothing", async () => {
    const { jobId } = await seedDoneJob(2);
    await seedPendingAnchor(jobId);
    const before = await boardRows();

    const startedAt = Date.now();
    const board = await whileJobLockIsHeld(jobId, projectId, () => listCanvasNodes(projectId));

    expect(Array.isArray(board)).toBe(true);
    expect(board as unknown[]).toHaveLength(1);
    expect(await boardRows()).toEqual(before);
    // The DB-side bound is 2s; anything near this ceiling means the wait was not bounded at all.
    expect(Date.now() - startedAt).toBeLessThan(15_000);
  }, 60_000);

  it("gives the chat-side reader the board as it stands too", async () => {
    const threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
    const { jobId, generationIds } = await seedDoneJob(2);
    await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { threadId } });
    await prisma.chatMessage.create({
      data: {
        id: `msg_${randomUUID()}`, threadId, ownerId, role: "AGENT", kind: "GEN_RESULT", seq: 1,
        text: "a cup steaming", genJobId: jobId,
        payload: { kind: "image", model: "seedream", generationIds },
      },
    });
    await seedPendingAnchor(jobId);
    const before = await boardRows();

    const synced = await whileJobLockIsHeld(jobId, projectId, () => syncOttoCanvasNodes(projectId));

    expect(Array.isArray(synced)).toBe(true);
    expect(synced as unknown[]).toHaveLength(1);
    expect(await boardRows()).toEqual(before);
  }, 60_000);
});
