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
 *  2. Opening the board writes nothing whatsoever. That was the precondition for #613 T2d, and
 *     since T2d it is also the whole contract: the read paths carry no repair logic of their own,
 *     so an unfinished board stays exactly as it is until the job's own completion path — or the
 *     backfill sweep behind it — finishes it. The cases below that used to compare "the board the
 *     browser wrote" against "the board the server wrote" now assert that pair instead: the read
 *     changed nothing, and the backstop produced the server's board.
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
const { prisma, settleCanvasCardsForGenJob, findCanvasSettlementBacklog, canvasJobPlacementLockKey } = await import("@fikirtive/db");
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

/**
 * A chat generation exactly as production leaves it (#613 r2, cross-family judge P1).
 *
 * The durable part is the GEN_CARD, stamped with its job id: `coworkGenerate` writes that stamp
 * after startGen returns (apps/web/lib/cowork-actions.ts:136-143) and it stays in the thread for
 * ever. Fixtures that seeded only a GEN_RESULT never exercised the bridge's in-flight placement at
 * all, so they walked straight past the seam where a reload can still put a card on the board.
 */
async function seedChatCardJob(input: {
  outputs: number;
  status?: "QUEUED" | "GENERATING" | "DONE" | "FAILED" | "CANCELLED";
}): Promise<{ jobId: string; generationIds: string[]; threadId: string; cardId: string }> {
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
  const { jobId, generationIds } = await seedDoneJob(input.outputs);
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { threadId } });
  if (input.status && input.status !== "DONE") {
    await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: input.status } });
  }
  const cardId = `msg_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: {
      id: cardId, threadId, ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1,
      text: "", genJobId: jobId,
      payload: { kind: "image", model: "seedream", structuredPrompt: "a cup steaming" },
    },
  });
  return { jobId, generationIds, threadId, cardId };
}

/**
 * #613 r4 (cross-family judge P1) — WHAT AN UNBOUND CARD IS ALLOWED TO SHOW.
 *
 * The settlement refuses to bind an extra anchor to an output another card already carries (r3).
 * The DISPLAY had no such rule: both readers replaced an unbound card's null generationId with the
 * job's first output that has a thumbnail, so the extra anchor rendered as `done` holding the paid
 * picture anyway — the duplication the projection had just refused, put back on the screen.
 *
 * The shape is seeded directly. It can no longer be created (r3 closed the double insert), but the
 * display rule has to be honest about a row that exists, whatever put it there.
 */
describe("a job that ended up with an extra unbound card", () => {
  /** The board r3's projection leaves behind: one real anchor bound, the extra still unbound. */
  async function seedDuplicateAnchorBoard(): Promise<{ jobId: string; outputs: string[]; extraId: string }> {
    projectId = await freshProject();
    const { jobId, generationIds } = await seedDoneJob(2);
    await seedCard({ jobId, x: 0, y: 0, status: "done", generationId: generationIds[0] });
    await seedCard({ jobId, x: 340, y: 0, status: "done", generationId: generationIds[1] });
    const extraId = await seedCard({ jobId, x: 680, y: 0, status: "pending", generationId: null });
    return { jobId, outputs: generationIds, extraId };
  }

  /** What the merchant sees, per card: which output it shows and whether it has a picture. */
  function seen(
    cards: unknown,
    outputs: readonly string[],
  ): Array<{ status: string; carries: string; hasPicture: boolean }> {
    expect(Array.isArray(cards)).toBe(true);
    return (cards as Array<{ status: string; generationId: string | null; url?: string | null }>)
      .map((card) => ({
        status: card.status,
        carries: card.generationId ? `output-${outputs.indexOf(card.generationId)}` : "nothing",
        hasPicture: typeof card.url === "string" && card.url.length > 0,
      }))
      .sort((a, b) => a.carries.localeCompare(b.carries) || a.status.localeCompare(b.status));
  }

  // Sorted by `carries`, so "nothing" leads. The extra shows no paid picture at all: `missing` is
  // the word the board already uses for a delivered job's card that carries nothing, and it is the
  // truth about this row. Each paid output appears exactly once.
  const honestBoard = [
    { status: "missing", carries: "nothing", hasPicture: false },
    { status: "done", carries: "output-0", hasPicture: true },
    { status: "done", carries: "output-1", hasPicture: true },
  ];

  it("does not hand the extra card a picture another card already shows — canvas reader", async () => {
    const board = await seedDuplicateAnchorBoard();

    expect(seen(await listCanvasNodes(projectId), board.outputs)).toEqual(honestBoard);
  });

  it("does not hand the extra card a picture another card already shows — chat reader", async () => {
    const board = await seedDuplicateAnchorBoard();

    expect(seen(await syncOttoCanvasNodes(projectId), board.outputs)).toEqual(honestBoard);
  });

  it("shows neither of two unbound cards a paid picture, in either reader", async () => {
    // Before any settlement pass: nothing on the board says which of the two is the real anchor,
    // so neither may claim an output. One of them showing the picture would be a coin toss.
    projectId = await freshProject();
    const { jobId, generationIds } = await seedDoneJob(2);
    await seedCard({ jobId, x: 0, y: 0, status: "pending", generationId: null });
    await seedCard({ jobId, x: 340, y: 0, status: "pending", generationId: null });

    const nothingShown = [
      { status: "missing", carries: "nothing", hasPicture: false },
      { status: "missing", carries: "nothing", hasPicture: false },
    ];
    expect(seen(await listCanvasNodes(projectId), generationIds)).toEqual(nothingShown);
    expect(seen(await syncOttoCanvasNodes(projectId), generationIds)).toEqual(nothingShown);
  });

  /**
   * THE GUARDRAIL FOR WHAT THE FALLBACK IS FOR.
   *
   * A card pressed from the canvas promptbar persists only its job id, so between delivery and the
   * settlement binding it there is a card whose row carries no output. Without the fallback the
   * merchant sees a blank card, and "Make video" / "Detail" no-op on it because the client needs a
   * generationId. That is the whole purpose — the job's SOLE card, before its settlement lands.
   */
  it("still shows a delivered job's only card its picture before the settlement lands", async () => {
    projectId = await freshProject();
    const { jobId, generationIds } = await seedDoneJob(2);
    await seedCard({ jobId, x: 0, y: 0, status: "pending", generationId: null });

    const shown = [{ status: "done", carries: "output-0", hasPicture: true }];
    expect(seen(await listCanvasNodes(projectId), generationIds)).toEqual(shown);
    expect(seen(await syncOttoCanvasNodes(projectId), generationIds)).toEqual(shown);
  });
});

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
 * ONE WRITER, one board (#613 T2d).
 *
 * These cases used to run each scenario twice — once settled by the worker, once "settled" by
 * opening the board — and require the two boards to match, because a merchant must not get a
 * different board depending on whether a tab happened to be open. There is no second writer to
 * compare against any more: the board reader was deleted along with its idea of what a batch
 * should look like. So the same scenarios now assert the thing that replaced that guarantee:
 * opening the board writes NOTHING, and the board is finished by the server's own backstop — the
 * sweep offers the unfinished board, the one settlement writes it, and the result is the board the
 * delivery path would have written in the first place.
 */
describe("what a board reader does to an unfinished board", () => {
  /** The backstop, exactly as the worker's sweep runs it: the sweep names the board, the one
   *  settlement writes it. Returns whether the sweep offered this board at all. */
  async function backstop(jobId: string): Promise<boolean> {
    const due = await findCanvasSettlementBacklog({ now: new Date(), graceMs: 0, limit: 200 });
    const board = due.find((job) => job.id === jobId);
    if (board) await settleCanvasCardsForGenJob(board.id, board.ownerId);
    return !!board;
  }

  it("writes nothing to a half-deleted batch, and the backstop finishes it the server's way", async () => {
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
    const untouched = await boardRows(browser.pid);
    await listCanvasNodes(browser.pid);
    expect(await boardRows(browser.pid)).toEqual(untouched);

    expect(await backstop(browser.jobId)).toBe(true);
    expect(shape(await boardRows(browser.pid), browser))
      .toEqual(shape(await boardRows(server.pid), server));
  });

  it("writes nothing to a batch made FROM an earlier card either", async () => {
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
    const untouched = await boardRows(browser.pid);
    await listCanvasNodes(browser.pid);
    expect(await boardRows(browser.pid)).toEqual(untouched);

    expect(await backstop(browser.jobId)).toBe(true);
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
 * depended on whether a chat happened to be open, and on who reached the job lock first. #601 T2b
 * replaced that writer with a call to the ONE settlement; #613 T2d removed the call as well, so a
 * GEN_RESULT message writes nothing at all and the board is the job's own to finish.
 */
describe("a batch that arrived as a chat result", () => {
  async function seedChatResultJob(outputs: number): Promise<{ jobId: string; generationIds: string[]; threadId: string }> {
    const { jobId, generationIds, threadId } = await seedChatCardJob({ outputs });
    await prisma.chatMessage.create({
      data: {
        id: `msg_${randomUUID()}`, threadId, ownerId, role: "AGENT", kind: "GEN_RESULT", seq: 2,
        text: "a cup steaming", genJobId: jobId,
        payload: { kind: "image", model: "seedream", generationIds },
      },
    });
    return { jobId, generationIds, threadId };
  }

  it("is not placed by the chat reader, and the backstop places it the server's way", async () => {
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
      return { pid: projectId, jobId: seeded.jobId, outputs: seeded.generationIds };
    })();

    // Opening the chat wrote nothing: a delivered batch is not this reader's to place.
    expect(await boardRows(chat.pid)).toHaveLength(0);

    const due = await findCanvasSettlementBacklog({ now: new Date(), graceMs: 0, limit: 200 });
    const board = due.find((job) => job.id === chat.jobId);
    expect(board).toBeDefined();
    await settleCanvasCardsForGenJob(board!.id, board!.ownerId);

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

/**
 * #613 r2 (cross-family judge P1) — THE ONE WRITE THE READ PATH KEPT, and who it is for.
 *
 * The bridge still places the IN-FLIGHT card of a batch the merchant just started from a chat,
 * because the settlement deliberately projects nothing for a job that has not finished. That
 * placement was not gated on the job's status, and the durable GEN_CARD outlives the job — so a
 * job that FINISHED but whose settlement write fell over could be handed a fresh `pending` anchor
 * by an ordinary board reload. Two things go wrong at once:
 *
 *   - the card is placed at the bridge's linear position, so when the backstop later settles the
 *     batch it lays the whole thing out around THAT card instead of the free spot it would have
 *     chosen — opening the board changes the merchant's final layout, which is the entire defect
 *     T2d exists to remove;
 *   - for a job that ended badly it is worse than layout: the terminal projection never creates a
 *     card on purpose, and this route manufactures one, so a reload announces a failure on a board
 *     the merchant may never have had a card on.
 *
 * A finished-but-unsettled job is the BACKSTOP's business. The read must walk past it.
 */
describe("a finished job whose settlement write fell over, reloaded from the chat", () => {
  async function backstop(jobId: string): Promise<boolean> {
    const due = await findCanvasSettlementBacklog({ now: new Date(), graceMs: 0, limit: 200 });
    const board = due.find((job) => job.id === jobId);
    if (board) await settleCanvasCardsForGenJob(board.id, board.ownerId);
    return !!board;
  }

  it("is not given an in-flight card by the reload, and the backstop lays the batch out its own way", async () => {
    // Work already on the board, so the settlement's free-spot search has something to avoid —
    // and so "the bridge's linear position" and "the settlement's origin" are different places.
    const server = await (async () => {
      projectId = await freshProject();
      await seedCard({ jobId: null, x: 80, y: 80, status: "done", generationId: await seedStoredGeneration() });
      const seeded = await seedChatCardJob({ outputs: 4 });
      await settleCanvasCardsForGenJob(seeded.jobId, ownerId);
      return { pid: projectId, outputs: seeded.generationIds };
    })();

    const chat = await (async () => {
      projectId = await freshProject();
      await seedCard({ jobId: null, x: 80, y: 80, status: "done", generationId: await seedStoredGeneration() });
      const seeded = await seedChatCardJob({ outputs: 4 });
      return { pid: projectId, jobId: seeded.jobId, outputs: seeded.generationIds };
    })();

    // The reload. A DONE job is finished work: the read may not put a card down for it.
    const untouched = await boardRows(chat.pid);
    await syncOttoCanvasNodes(chat.pid);
    expect(await boardRows(chat.pid)).toEqual(untouched);

    // Only the backstop settles it — and the board is the one the delivery path would have written.
    expect(await backstop(chat.jobId)).toBe(true);
    expect(await boardRows(chat.pid)).toHaveLength(5);
    expect(shape(await boardRows(chat.pid), chat)).toEqual(shape(await boardRows(server.pid), server));
  });

  it.each(["FAILED", "CANCELLED"] as const)(
    "is never handed a card at all after a %s job — a terminal creates nothing",
    async (status) => {
      projectId = await freshProject();
      const seeded = await seedChatCardJob({ outputs: 0, status });
      await prisma.genJob.update({
        where: { id: seeded.jobId, ownerId },
        data: { finishedAt: new Date(Date.now() - 30 * 60_000) },
      });

      await syncOttoCanvasNodes(projectId);

      // No card was invented for an ending, by the reader or by anything behind it.
      expect(await boardRows()).toHaveLength(0);
      expect(await backstop(seeded.jobId)).toBe(false);
      expect(await boardRows()).toHaveLength(0);
    },
  );

  it("still places the in-flight card of a job that really is running", async () => {
    // The guardrail for the gate above: this is the one thing the bridge is still for.
    for (const status of ["QUEUED", "GENERATING"] as const) {
      projectId = await freshProject();
      const seeded = await seedChatCardJob({ outputs: 0, status });

      await syncOttoCanvasNodes(projectId);

      const rows = await boardRows();
      expect(rows.map((row) => ({ status: row.status, genJobId: row.genJobId })))
        .toEqual([{ status: "pending", genJobId: seeded.jobId }]);
    }
  });

  /**
   * TWO STALE RELOADS, ONE CARD (#613 r3, cross-family judge P1).
   *
   * Two tabs — or one tab and a retry — can reload at the same instant. Both planners read a board
   * with no card, both plan one, and both reach the placement. The advisory lock serializes them,
   * but serializing is not the same as agreeing: in READ COMMITTED a statement's snapshot is taken
   * when the STATEMENT starts, so as long as the "does a card already exist?" test lives in the
   * same statement that acquires the lock, the second writer evaluates it against a snapshot
   * predating the first writer's commit and inserts a second anchor.
   *
   * `CanvasNode.genJobId` carries no uniqueness (schema.prisma), so nothing below catches it, and
   * the damage is durable: the settlement binds one anchor to the batch's first output now and the
   * other to the SAME output on a later pass, so a merchant ends up with one paid picture shown
   * twice and a phantom card in its lineage.
   *
   * This forces the interleaving rather than hoping for it: a third connection holds the placement
   * lock while both reloads take their snapshots and queue behind it, then releases.
   */
  it("gives a job exactly one card when two stale reloads race for it", async () => {
    projectId = await freshProject();
    const seeded = await seedChatCardJob({ outputs: 2, status: "GENERATING" });
    const pid = projectId;

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      const lockKey = canvasJobPlacementLockKey(ownerId, pid, seeded.jobId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
      // Both reloads read the empty board and queue at the lock. Their snapshots are now fixed,
      // and neither can see what the other is about to write.
      first = syncOttoCanvasNodes(pid);
      second = syncOttoCanvasNodes(pid);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }, { maxWait: 10_000, timeout: 60_000 });
    await Promise.all([first, second]);

    const rows = await boardRows(pid);
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => ({ status: row.status, genJobId: row.genJobId })))
      .toEqual([{ status: "pending", genJobId: seeded.jobId }]);

    // …and the batch that follows carries each paid output exactly once.
    await prisma.genJob.update({
      where: { id: seeded.jobId, ownerId },
      data: { status: "DONE", finishedAt: new Date(Date.now() - 30 * 60_000) },
    });
    expect(await backstop(seeded.jobId)).toBe(true);
    const settled = await boardRows(pid);
    expect(settled.map((row) => row.generationId).sort()).toEqual([...seeded.generationIds].sort());
  }, 60_000);

  /**
   * THE READ→WRITE WINDOW, from both sides.
   *
   * The planner decides "still running?" from rows read moments earlier, and the job can change
   * while the placement queues behind somebody else's hold on its lock. Both cases below force
   * that queue deterministically: a third connection holds the lock, the reload takes its
   * snapshot and blocks, and the hold is released.
   *
   * The pair matters. The first proves the placement REALLY HAPPENS on the far side of that wait —
   * without it, the second would be satisfied by a placement that had quietly stopped working at
   * all (#613 r3, judge P2). The second proves the window is closed: because the lock is taken in
   * its own statement, the INSERT that follows reads a snapshot taken after the lock was granted
   * and sees the job's committed ending. An earlier revision of this branch measured the opposite
   * and said so; taking the lock out of the INSERT's own statement is what changed the answer.
   */
  async function whileTheLockIsHeld(
    jobId: string,
    pid: string,
    duringTheHold?: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>,
  ): Promise<void> {
    let reload!: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      const lockKey = canvasJobPlacementLockKey(ownerId, pid, jobId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
      await duringTheHold?.(tx);
      // The reload reads the board and the job (this transaction has not committed), plans a
      // card, and queues at the placement lock.
      reload = syncOttoCanvasNodes(pid);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }, { maxWait: 10_000, timeout: 60_000 });
    await reload;
  }

  it("does place the card once the wait is over, when the job is still running", async () => {
    projectId = await freshProject();
    const seeded = await seedChatCardJob({ outputs: 0, status: "GENERATING" });
    const pid = projectId;

    await whileTheLockIsHeld(seeded.jobId, pid);

    const rows = await boardRows(pid);
    expect(rows.map((row) => ({ status: row.status, genJobId: row.genJobId })))
      .toEqual([{ status: "pending", genJobId: seeded.jobId }]);
  }, 60_000);

  it("places nothing when the job finishes while the placement waits for the lock", async () => {
    projectId = await freshProject();
    const seeded = await seedChatCardJob({ outputs: 3, status: "QUEUED" });
    const pid = projectId;

    await whileTheLockIsHeld(seeded.jobId, pid, async (tx) => {
      // The job finishes — not yet visible to anyone else, and the lock is not yet released.
      await tx.genJob.updateMany({
        where: { id: seeded.jobId, ownerId },
        data: { status: "DONE", finishedAt: new Date(Date.now() - 30 * 60_000) },
      });
    });

    // The INSERT woke up into a DONE job and wrote nothing; the backstop owns it from here, and
    // the board it produces carries each paid output exactly once.
    expect(await boardRows(pid)).toHaveLength(0);
    expect(await backstop(seeded.jobId)).toBe(true);
    const rows = await boardRows(pid);
    expect(rows.map((row) => row.generationId).sort()).toEqual([...seeded.generationIds].sort());
    expect(rows.every((row) => row.status === "done")).toBe(true);
  }, 60_000);
});

describe("the chat-side board reader writes nothing either", () => {
  it("leaves a half-deleted batch untouched, and the backstop finishes it the server's way", async () => {
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
    const untouched = await boardRows(chat.pid);
    await syncOttoCanvasNodes(chat.pid);
    expect(await boardRows(chat.pid)).toEqual(untouched);

    const due = await findCanvasSettlementBacklog({ now: new Date(), graceMs: 0, limit: 200 });
    const board = due.find((job) => job.id === chat.jobId);
    expect(board).toBeDefined();
    await settleCanvasCardsForGenJob(board!.id, board!.ownerId);

    expect(shape(await boardRows(chat.pid), chat))
      .toEqual(shape(await boardRows(server.pid), server));
  });
});

/**
 * The other half of "the board is the merchant's home": it has to open even when somebody else
 * is writing it.
 *
 * This was the #611 problem — a read that settled had to WAIT for the job's placement lock, and an
 * unbounded wait meant a merchant sat looking at nothing while the worker held it. #613 T2d
 * dissolves the problem rather than bounding it: a read takes no job lock at all, so there is
 * nothing left to wait for. These cases hold the lock for real anyway and require both readers to
 * come back promptly with the board as it stands — so if a read ever starts taking that lock
 * again, this is where it is caught.
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
