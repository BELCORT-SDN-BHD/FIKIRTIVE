/**
 * CREATE-A1 —— 商家在 Otto 卡上按下确认之后，那张卡**当场出现在画布上**，做完了原地换成结果。
 *
 * 触发：2026-09-04 staging 走查 P0-1（`scratchpad/creation-friction-audit.html`）。原状：Otto 卡
 * 从「✓ Approved — in the queue」一路走到「✓ Done · it used 1 credit」，余额 73 → 72，而画布
 * **全程一片空白**；按一次 F5，图就在那儿 —— 一直都在，只是没人告诉画板。
 *
 * 病根不在这一层：服务端的 chat→canvas 桥（`syncOttoCanvasNodes`）本来就会为一个在飞的付费
 * 任务放下一张占位卡，画板也本来就会在 `activity` 翻转时重读自己。缺的是把两者接起来的那一句话
 * （`NorthstarCanvasWorkspace` → `FlowCanvas.activity`，见 canvas-otto-activity 那一份测试）。
 *
 * 这一份守的是**桥这一半**，跑在真库上：一次批准之后画板该长什么样，做完之后又该长什么样。
 * 全程零供应商、零 credit —— GenJob 与 Generation 都是种进去的行，没有任何一次 startGen。
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
const { prisma } = await import("@fikirtive/db");
const { storage } = await import("@/lib/storage");
const { syncOttoCanvasNodes } = await import("@/lib/otto-canvas-bridge");

const EMAIL = `seam-p0-1-${randomUUID()}@fikirtive.test`;

let ownerId: string;
let projectId: string;
let threadId: string;

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
  threadId = `thr_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Kaya jar board" } });
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Kaya jar ad" } });
});

afterAll(async () => {
  await prisma.canvasNode.deleteMany({ where: { ownerId } });
});

/** 一次真的付费产出：字节进存储，加上 worker 落的 Asset + Generation。 */
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

/**
 * 商家刚刚按下「Generate · 1 credit」之后，库里长的样子：一张 GEN_CARD，加上批准动作
 * 建起来、还在排队的那个付费任务。批准动作本身不在这一层（那是 ottoApprove 的活）。
 */
async function seedApprovedCard(kind: "image" | "video" = "image"): Promise<{ cardId: string; genJobId: string }> {
  const cardId = `msg_${randomUUID()}`;
  const genJobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: genJobId, ownerId, projectId,
      prompt: "a pandan kaya jar on a warm morning kitchen counter",
      kind: kind === "video" ? "VIDEO" : "IMAGE", model: "seedream", count: 1,
      status: "QUEUED", generationIds: [], idempotencyKey: `cowork:${cardId}`,
    },
  });
  await prisma.chatMessage.create({
    data: {
      id: cardId, threadId, ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1,
      text: "", genJobId,
      payload: {
        kind,
        structuredPrompt: "a pandan kaya jar on a warm morning kitchen counter",
        estimatedCredits: 1,
        specChips: ["1:1", "Brand and product photo"],
        params: { count: 1, aspectRatio: "1:1" },
      },
    },
  });
  return { cardId, genJobId };
}

/** worker 交货：任务落成 DONE 并挂上产出，与画布自己那条路完全一样。 */
async function deliver(genJobId: string): Promise<string> {
  const generationId = await seedStoredGeneration();
  await prisma.genJob.updateMany({
    where: { id: genJobId, ownerId },
    data: { status: "DONE", generationIds: [generationId], spent: true, spentUsd: 0.04, finishedAt: new Date() },
  });
  return generationId;
}

describe("CREATE-A1 · 确认之后画布当场有东西，做完原地换成结果（走查 P0-1）", () => {
  it("CREATE-A1 · 批准的那一刻画板上就出现一张 generating 占位卡", async () => {
    const { genJobId } = await seedApprovedCard();

    const board = await syncOttoCanvasNodes(projectId);
    if ("error" in board) throw new Error(board.error);

    // 走查里这一步是「画布完全空白」——一张卡都没有，商家已经付了钱。
    expect(board).toHaveLength(1);
    const [card] = board;
    expect(card.genJobId).toBe(genJobId);
    expect(card.type).toBe("image");
    // 还没有产出，所以它是一张**在生成中**的卡，不是一张失败卡、也不是一张空白卡。
    // `queued` 是画板自己的在飞脸之一（`isInFlightCardFace`），卡上画的是「排队中」的
    // 生成态 —— 卡片只知道任务建起来了，不知道它已经开跑，所以不许说「正在做」。
    expect(card.status).toBe("queued");
    expect(card.url).toBeNull();
    // 这张卡认得自己是从哪条对话来的，也认得自己是 Otto 那边的活。
    expect(card.threadId).toBe(threadId);
    expect(card.origin).toBe("otto");
  });

  it("CREATE-A1 · 做完之后是**同一张卡**换上产出，不是旁边多长一张", async () => {
    const { genJobId } = await seedApprovedCard();
    const first = await syncOttoCanvasNodes(projectId);
    if ("error" in first) throw new Error(first.error);
    const placedId = first[0].id;

    const generationId = await deliver(genJobId);
    const after = await syncOttoCanvasNodes(projectId);
    if ("error" in after) throw new Error(after.error);

    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(placedId);
    expect(after[0].generationId).toBe(generationId);
    expect(after[0].status).toBe("done");
    expect(after[0].url).toBeTruthy();
  });

  it("CREATE-A1 · 重复读画板不会给同一个任务放第二张卡", async () => {
    await seedApprovedCard();
    await syncOttoCanvasNodes(projectId);
    await syncOttoCanvasNodes(projectId);
    const board = await syncOttoCanvasNodes(projectId);
    if ("error" in board) throw new Error(board.error);

    expect(board).toHaveLength(1);
  });

  it("CREATE-A1 · 视频卡也走同一条路（画布上是一张 video 卡）", async () => {
    const { genJobId } = await seedApprovedCard("video");

    const board = await syncOttoCanvasNodes(projectId);
    if ("error" in board) throw new Error(board.error);

    expect(board).toHaveLength(1);
    expect(board[0].type).toBe("video");
    expect(board[0].genJobId).toBe(genJobId);
  });

  it("CREATE-A1 · 还没批准的卡（没有任务）不占画布的位置", async () => {
    // 一张只被提议、还没人按确认的卡：没有 GenJob，就没有花钱，画板上也不该有东西。
    await prisma.chatMessage.create({
      data: {
        id: `msg_${randomUUID()}`, threadId, ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1,
        text: "", genJobId: null,
        payload: { kind: "image", structuredPrompt: "a jar", estimatedCredits: 1 },
      },
    });

    const board = await syncOttoCanvasNodes(projectId);
    if ("error" in board) throw new Error(board.error);

    expect(board).toHaveLength(0);
  });
});
