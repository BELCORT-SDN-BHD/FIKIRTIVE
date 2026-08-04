/**
 * #612 T2c — what a merchant sees when a job ends badly, and what a CLOSED TAB may still do.
 *
 * Two halves, both against a REAL database with the real server actions running:
 *
 *  1. THE LATE-WRITE BARRIER (a confirmed defect on main). A tab the merchant closed keeps
 *     polling until its own patience runs out, then reports "timeout" for the card it placed.
 *     That report can arrive long after the server settled the whole batch — and it used to be
 *     applied as written: the card was knocked from `done` back to `timeout` AND its
 *     `generationId` was erased. The merchant's paid picture came off the card; what put it back
 *     on screen was a read-time fallback that hands EVERY orphaned card the batch's FIRST output,
 *     so a four-image batch showed image 1 four times and images 2–4 nowhere. A report about an
 *     older state of the world must never undo a settled one.
 *
 *  2. TERMINAL SETTLEMENT. A job that ends failed or cancelled has its cards written by the
 *     SERVER, once, with one name per terminal — so an abandoned board stops spinning without a
 *     browser having to be there, and "cancelled" reads as cancelled rather than as a failure.
 *
 * Harness: only the session is mocked (same dialect as canvas-settlement-browser-absent.test.ts)
 * — requireOwner, Prisma, the media store and the real server actions all run.
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
const { prisma, settleCanvasCardsForGenJob } = await import("@fikirtive/db");
const { storage } = await import("@/lib/storage");
const { listCanvasNodes, resolveCanvasNode } = await import("@/lib/canvas-actions");

const EMAIL = `canvas612-${randomUUID()}@fikirtive.test`;
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
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Terminal board" } });
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

/** A job that ended badly, exactly as the worker leaves it: terminal, refunded, no outputs. */
async function seedTerminalJob(status: "FAILED" | "CANCELLED"): Promise<string> {
  const jobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId, projectId, prompt: "a cup steaming", kind: "IMAGE", model: "seedream",
      count: 1, status, generationIds: [], spent: false,
      startedAt: new Date(), finishedAt: new Date(),
      error: status === "FAILED" ? "provider said no" : "",
    },
  });
  return jobId;
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

async function boardRows() {
  return prisma.canvasNode.findMany({ where: { ownerId, projectId }, orderBy: [{ y: "asc" }, { x: "asc" }] });
}

/** What the merchant actually sees: one entry per visible card, output index and picture. */
async function visibleBoard(outputs: readonly string[]) {
  const cards = await listCanvasNodes(projectId);
  expect(Array.isArray(cards)).toBe(true);
  return (cards as Array<{ status: string; generationId: string | null; url?: string | null }>).map((card) => ({
    status: card.status,
    carries: card.generationId ? `output-${outputs.indexOf(card.generationId)}` : "nothing",
    hasPicture: typeof card.url === "string" && card.url.length > 0,
  }));
}

describe("a closed tab reporting back late", () => {
  it("cannot take the merchant's paid picture off a settled card", async () => {
    const { jobId, generationIds } = await seedDoneJob(2);
    await seedPendingAnchor(jobId);
    await settleCanvasCardsForGenJob(jobId, ownerId);

    const settled = await boardRows();
    expect(settled).toHaveLength(2);
    const stranded = settled.find((row) => row.generationId === generationIds[1]);
    expect(stranded).toBeDefined();

    // The tab the merchant closed gives up waiting and reports what IT last knew.
    await resolveCanvasNode(projectId, stranded!.id, { status: "timeout" });

    const after = await boardRows();
    // The card still carries the output the merchant paid for, still finished.
    expect(after.map((row) => ({ status: row.status, generationId: row.generationId })))
      .toEqual(settled.map((row) => ({ status: row.status, generationId: row.generationId })));
    // …and the board still shows BOTH pictures, each exactly once. Before the barrier the
    // orphaned card fell back to the batch's first output, so output-0 appeared twice.
    expect(await visibleBoard(generationIds)).toEqual([
      { status: "done", carries: "output-0", hasPicture: true },
      { status: "done", carries: "output-1", hasPicture: true },
    ]);
  });

  it("cannot fail a settled card either", async () => {
    const { jobId, generationIds } = await seedDoneJob(1);
    await seedPendingAnchor(jobId);
    await settleCanvasCardsForGenJob(jobId, ownerId);
    const settled = await boardRows();

    await resolveCanvasNode(projectId, settled[0]!.id, { status: "failed" });

    expect(await boardRows()).toEqual(settled);
    expect(await visibleBoard(generationIds)).toEqual([
      { status: "done", carries: "output-0", hasPicture: true },
    ]);
  });

  it("still lets a card nobody has settled reach its own terminal", async () => {
    const jobId = `gjb_${randomUUID()}`;
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId, projectId, prompt: "a cup steaming", kind: "IMAGE", model: "seedream",
        count: 1, status: "GENERATING", generationIds: [], startedAt: new Date(),
      },
    });
    const cardId = await seedPendingAnchor(jobId);

    await expect(resolveCanvasNode(projectId, cardId, { status: "timeout" })).resolves.toEqual({ ok: true });

    const [row] = await boardRows();
    expect(row?.status).toBe("timeout");
    expect(row?.generationId).toBeNull();
  });
});

describe("a job that ended badly", () => {
  it("leaves a failed card the merchant can read, without a browser being there", async () => {
    const jobId = await seedTerminalJob("FAILED");
    await seedPendingAnchor(jobId);

    await settleCanvasCardsForGenJob(jobId, ownerId);

    const [row] = await boardRows();
    expect(row?.status).toBe("failed");
    expect(row?.generationId).toBeNull();
    expect(await visibleBoard([])).toEqual([{ status: "failed", carries: "nothing", hasPicture: false }]);
  });

  it("shows a cancelled job as cancelled, not as a failure", async () => {
    const jobId = await seedTerminalJob("CANCELLED");
    await seedPendingAnchor(jobId);

    await settleCanvasCardsForGenJob(jobId, ownerId);

    const [row] = await boardRows();
    expect(row?.status).toBe("cancelled");
    expect(await visibleBoard([])).toEqual([{ status: "cancelled", carries: "nothing", hasPicture: false }]);
  });

  it("writes the same terminal however many times it is settled, and never twice differently", async () => {
    const jobId = await seedTerminalJob("FAILED");
    await seedPendingAnchor(jobId);

    const first = await settleCanvasCardsForGenJob(jobId, ownerId);
    const settled = await boardRows();
    const second = await settleCanvasCardsForGenJob(jobId, ownerId);

    expect(first).toMatchObject({ status: "settled", updated: 1 });
    expect(second).toMatchObject({ status: "settled", updated: 0 });
    expect(await boardRows()).toEqual(settled);
  });

  it("never touches a card that already carries a paid output", async () => {
    // A legacy shape the free-delivery guard can still produce: outputs on the row, terminal job.
    const { jobId, generationIds } = await seedDoneJob(1);
    await seedPendingAnchor(jobId);
    await settleCanvasCardsForGenJob(jobId, ownerId);
    const delivered = await boardRows();
    await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "FAILED" } });

    await settleCanvasCardsForGenJob(jobId, ownerId);

    expect(await boardRows()).toEqual(delivered);
    expect(delivered[0]?.generationId).toBe(generationIds[0]);
  });

  it("honours a card the merchant deleted while the job was running", async () => {
    const jobId = await seedTerminalJob("FAILED");
    const cardId = await seedPendingAnchor(jobId);
    await prisma.canvasNode.update({ where: { id: cardId, ownerId }, data: { status: "deleted" } });
    const deleted = await boardRows();

    const outcome = await settleCanvasCardsForGenJob(jobId, ownerId);

    expect(outcome.status).toBe("suppressed");
    expect(await boardRows()).toEqual(deleted);
  });
});
