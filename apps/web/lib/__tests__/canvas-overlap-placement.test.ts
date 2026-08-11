/**
 * #549 — a new card never lands on top of a card that is already there.
 *
 * The walkthrough's shape: three paid images on the board, then a video that landed pixel-for-
 * pixel on top of image 2. The picture underneath was still on the board and still paid for, and
 * completely out of reach — it could not be clicked, and keyboard focus stopped on it while the
 * eye saw the video, so the merchant acted on the wrong card.
 *
 * The rule "put it in the first free spot" existed, and exactly one writer kept it: the board
 * component, against ITS OWN TAB's snapshot of the board. Every other writer handed the database
 * a raw coordinate and the database took it:
 *
 *   · Otto's `place` has no board to look at, so its default spot is the board ORIGIN (80, 80)
 *     — the merchant's first picture, on every board that is not empty.
 *   · A second press inside the seconds a generation takes to be accepted read the same board as
 *     the first and chose the same "free" slot.
 *   · A second tab, or a phone, never saw the other's cards at all.
 *
 * So the rule now lives at the WRITE, which is the one place every writer passes through and the
 * only place the whole board is visible. These cases drive the real server actions against a real
 * database. Nothing here calls a provider or spends a credit: generations are seeded rows.
 *
 * The geometry these cases assert — no two live cards overlap — is what makes every paid card
 * reachable at all, including by keyboard. That the keyboard then reaches each of them one at a
 * time is proved in canvas-keyboard-reach.test.ts, which drives the real board.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { CanvasRect } from "@/lib/canvas-batch-layout";

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
const { prisma } = await import("@fikirtive/db");
const { storage } = await import("@/lib/storage");
const { createCanvasNode, deleteCanvasNode, listCanvasNodes, moveCanvasNode } = await import("@/lib/canvas-actions");
const { canvasRectsOverlap } = await import("@/lib/canvas-batch-layout");

const EMAIL = `canvas549-${randomUUID()}@fikirtive.test`;
const CARD = { w: 320, h: 320 };
/** Where every writer's first card goes — and, before this fix, every one of Otto's. */
const ORIGIN = { x: 80, y: 80 };

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
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Overlap board" } });
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

/** A delivered paid job, exactly as the worker leaves one. */
async function seedDoneJob(generationIds: string[], kind: "IMAGE" | "VIDEO" = "IMAGE"): Promise<string> {
  const jobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId, projectId, prompt: "a cup steaming", kind, model: "seedream",
      count: generationIds.length, status: "DONE", generationIds, spent: true, spentUsd: 0.12,
      startedAt: new Date(), finishedAt: new Date(),
    },
  });
  return jobId;
}

/** One paid card, placed the way the browser places one: a job, an output, and a requested spot. */
async function placePaidCard(
  at: { x: number; y: number },
  type: "image" | "video" = "image",
): Promise<{ id: string; rect: CanvasRect; generationId: string }> {
  const generationId = await seedStoredGeneration();
  const genJobId = await seedDoneJob([generationId], type === "video" ? "VIDEO" : "IMAGE");
  const created = await createCanvasNode({
    projectId, type, ...at, ...CARD, prompt: "a cup steaming", generationId, genJobId, status: "done",
  });
  if ("error" in created) throw new Error(created.error);
  return { id: created.id, rect: { x: created.x, y: created.y, w: created.w, h: created.h }, generationId };
}

/** Every live card on the board, as rectangles. */
async function liveRects(): Promise<CanvasRect[]> {
  const rows = await prisma.canvasNode.findMany({
    where: { ownerId, projectId, status: { not: "deleted" } },
    select: { x: true, y: true, w: true, h: true },
  });
  return rows.map((row) => ({ x: row.x, y: row.y, w: row.w, h: row.h }));
}

function overlappingPairs(rects: readonly CanvasRect[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (canvasRectsOverlap(rects[i]!, rects[j]!)) pairs.push([i, j]);
    }
  }
  return pairs;
}

describe("#549 — the durable write never buries a card that is already on the board", () => {
  it("keeps the requested spot when it is genuinely free", async () => {
    const first = await placePaidCard(ORIGIN);

    expect(first.rect).toEqual({ ...ORIGIN, ...CARD });
  });

  it("moves Otto's card off the merchant's first picture instead of covering it", async () => {
    // Otto's `place` tool defaults to the board origin, which is where the merchant's first
    // paid picture already is. Before #549 this wrote (80, 80) and the picture disappeared
    // under it while still costing what it cost.
    const paid = await placePaidCard(ORIGIN);
    const generationId = await seedStoredGeneration();

    const placed = await createCanvasNode({
      projectId, type: "image", ...ORIGIN, ...CARD, generationId, status: "done",
    });
    if ("error" in placed) throw new Error(placed.error);

    expect(canvasRectsOverlap(paid.rect, { x: placed.x, y: placed.y, w: placed.w, h: placed.h })).toBe(false);
    // The paid card did not move to make room — new work yields to old, never the other way.
    const kept = await prisma.canvasNode.findFirstOrThrow({ where: { id: paid.id, ownerId, projectId }, select: { x: true, y: true, generationId: true } });
    expect(kept).toMatchObject({ ...ORIGIN, generationId: paid.generationId });
  });

  it("separates two presses that both read the board before either card existed", async () => {
    // The browser picks a free slot at press time and the card only reaches the board once the
    // generation has been accepted — seconds later. Two presses inside that window ask for the
    // same slot; both were written there.
    const first = await placePaidCard(ORIGIN);
    const second = await placePaidCard(ORIGIN);

    expect(canvasRectsOverlap(first.rect, second.rect)).toBe(false);
    expect(second.generationId).not.toBe(first.generationId);
  });

  it("leaves no two live cards overlapping, however many ask for the same spot", async () => {
    const placed = [];
    for (let i = 0; i < 6; i += 1) placed.push(await placePaidCard(ORIGIN));

    const rects = await liveRects();
    expect(rects).toHaveLength(6);
    expect(overlappingPairs(rects)).toEqual([]);
    // Every paid output is on the board exactly once — nudging a card never drops or duplicates
    // one of them.
    const board = await listCanvasNodes(projectId);
    if ("error" in board) throw new Error(board.error);
    expect([...board.map((node) => node.generationId)].sort())
      .toEqual([...placed.map((card) => card.generationId)].sort());
  });

  it("puts the video where the image it was made from left room, and does not shove it elsewhere", async () => {
    // "Beside the card it was made from" is the browser's intent and it survives: a free spot is
    // kept exactly as asked for, so a merchant still finds the video next to its image.
    await placePaidCard(ORIGIN);
    const beside = { x: ORIGIN.x + CARD.w + 20, y: ORIGIN.y };

    const video = await placePaidCard(beside, "video");

    expect(video.rect).toEqual({ ...beside, ...CARD });
  });

  it("frees a removed card's space again — a tombstone reserves nothing", async () => {
    const paid = await placePaidCard(ORIGIN);
    const removed = await deleteCanvasNode(projectId, paid.id);
    expect(removed).toEqual({ ok: true });

    const next = await placePaidCard(ORIGIN);

    expect(next.rect).toEqual({ ...ORIGIN, ...CARD });
  });

  it("never moves a text card onto a paid picture either", async () => {
    const paid = await placePaidCard(ORIGIN);

    const text = await createCanvasNode({ projectId, type: "text", ...ORIGIN, w: 240, h: 120, text: "", status: "done" });
    if ("error" in text) throw new Error(text.error);

    expect(canvasRectsOverlap(paid.rect, { x: text.x, y: text.y, w: text.w, h: text.h })).toBe(false);
  });

  it("still lets the merchant arrange their own board, overlaps included", async () => {
    // The guard is about cards being PUT DOWN, not about where a merchant chooses to keep them.
    // Dragging one card onto another is an arrangement they asked for, and it is theirs to make.
    const first = await placePaidCard(ORIGIN);
    const second = await placePaidCard(ORIGIN);

    const moved = await moveCanvasNode(projectId, second.id, { ...ORIGIN, ...CARD });

    expect(moved).toEqual({ ok: true });
    const rects = await liveRects();
    expect(overlappingPairs(rects)).toHaveLength(1);
    expect(first.rect).toEqual({ ...ORIGIN, ...CARD });
  });
});
