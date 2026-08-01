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
const { prisma, settleCanvasCardsForGenJob } = await import("@fikirtive/db");
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

/** Every stored fact about this board, including updatedAt — so "a read wrote nothing" is provable. */
async function boardRows() {
  return prisma.canvasNode.findMany({
    where: { ownerId, projectId },
    orderBy: [{ y: "asc" }, { x: "asc" }],
  });
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
    await prisma.genJob.update({ where: { id: jobId }, data: { threadId } });
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
