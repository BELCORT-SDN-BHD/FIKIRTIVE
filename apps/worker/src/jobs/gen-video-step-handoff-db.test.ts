/**
 * gen-video-step-handoff-db.test —— 两步任务的**接力**,在真库上、跑真 `handleGen` 证。
 *
 * Codex 只读 E2E E2E-CRE-PAV-004:商家说「Xinyi 举起 tumbler 喝一口再对镜头笑,5 秒、9:16、
 * 无声」,Otto 拆成两步却只铸得出第一张卡,然后叫商家「把那张图带回来」。这里钉的是补上的
 * 那一段 —— Step 1 出图之后,第二张确认卡由服务端自己铸出来。
 *
 * 为什么必须是真库:这条接力的三条硬约束全在库里,mock 证不了 ——
 *   ① **恰一张**:重投/恢复再跑一次不许出现第二张(靠 GEN_RESULT 那个部分唯一索引);
 *   ② **零扣费**:卡出现 ≠ 收钱,这一单的账本只能有 RESERVE + SETTLE 两行;
 *   ③ **失败零卡**:Step 1 没出图就不许出现下一步(那会变成一张指着虚空的付费卡)。
 *
 * 只 mock 两件事:付费引擎(绝不真调用)与对象存储。库、钱、事务全是真的。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  generateVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, generateVideo: m.generateVideo } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { prisma, reserveCredits } from "@fikirtive/db";
import { buildProposeCard } from "@fikirtive/otto";
import { handleGen } from "./gen.js";

// 同别的真库用例:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000;

const VIDEO_PROMPT = "Xinyi raises the tumbler, takes a sip, then smiles at the camera";

let orgId: string;
let projectId: string;
let threadId: string;
let cardId: string;
let jobId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

/** Step 1 的卡 payload —— 走**真正的铸卡函数**,不是手抄一份 JSON:
 *  手抄的那一份改了字段名不会红,而接力恰恰是照那些字段名读的。 */
function step1Payload() {
  const { cardPayload } = buildProposeCard(
    {
      kind: "image",
      structuredPrompt: "Xinyi holding the tumbler in a warm-toned cafe, tall vertical frame",
      entityIds: [],
      variantSel: {},
      desiredAspect: "9:16",
      forVideo: true,
      videoPrompt: VIDEO_PROMPT,
      desiredDuration: 5,
      desiredAudio: false,
    },
    {
      orgId,
      userId: orgId,
      projectId,
      threadId,
      disabledModels: [],
      sourceGenerationId: null,
    },
    [],
  );
  return cardPayload;
}

beforeEach(async () => {
  vi.clearAllMocks();
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));

  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  threadId = `thr_${randomUUID()}`;
  cardId = `msg_${randomUUID()}`;
  jobId = `gen_${randomUUID()}`;

  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: 100_000, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Cafe launch" } });
  await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId, title: "Untitled" } });
  await prisma.chatMessage.create({
    data: {
      id: cardId, threadId, ownerId: orgId, role: "AGENT", kind: "GEN_CARD", seq: 1, text: "",
      payload: step1Payload() as never,
    },
  });
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, threadId,
      // 卡与作业之间那把权威的键 —— 接力就是照它找回 Step 1 的卡。
      idempotencyKey: `cowork:${cardId}`,
      prompt: "Xinyi holding the tumbler in a warm-toned cafe, tall vertical frame",
      kind: "IMAGE", model: "seedream", count: 1, status: "QUEUED",
    },
  });
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 这一轮里被接力铸出来的那些卡(血缘字段指着 Step 1 那张)。 */
async function stepTwoCards() {
  return prisma.chatMessage.findMany({
    where: { threadId, ownerId: orgId, kind: "GEN_CARD", payload: { path: ["videoStepOf"], equals: cardId } },
    select: { id: true, seq: true, payload: true, genJobId: true },
    orderBy: { seq: "asc" },
  });
}

/** 这一单在钱上留下的全部痕迹 —— 张数,不是文字。 */
async function ledgerKinds() {
  const rows = await prisma.creditLedger.findMany({
    where: { orgId, refId: jobId },
    select: { kind: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.kind);
}

describe("CREATE-A1 两步任务的接力(真库)", () => {
  it("CREATE-A1 Step 1 出图 ⇒ 恰一张第二步的视频确认卡,首帧就是刚出的那张图", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);

    await handleGen({ genJobId: jobId }, 0);

    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: orgId }, select: { status: true, generationIds: true } });
    expect(job.status).toBe("DONE");

    const cards = await stepTwoCards();
    expect(cards).toHaveLength(1);
    const p = cards[0]!.payload as Record<string, unknown>;
    expect(p.kind).toBe("video");
    // 商家不必再找图:第二张卡自己指着 Step 1 真正交付的那一张。
    expect(p.sourceGenerationId).toBe(job.generationIds[0]);
    // 规格就是他在第一张卡上批准的那一份(5 秒、无声)。
    expect((p.params as Record<string, unknown>).durationSeconds).toBe(5);
    expect((p.params as Record<string, unknown>).audio).toBe(false);
    expect(p.structuredPrompt).toBe(VIDEO_PROMPT);
    // 回执在 —— 少了它这张卡在前端根本按不下去(planCardGate 判它读不全)。
    expect((p.mediaReferences as { generationId: string }[])[0]!.generationId).toBe(job.generationIds[0]);
    // 还没被批准:它自己的付费幂等域是 `cowork:<新卡 id>`,现在一条作业都没有。
    expect(cards[0]!.genJobId).toBeNull();
    expect(await prisma.genJob.count({ where: { ownerId: orgId, idempotencyKey: `cowork:${cards[0]!.id}` } })).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A2 第二张卡出现 ≠ 扣费:这一单的账本只有 RESERVE + SETTLE,零新增行", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);

    const before = await prisma.creditLedger.count({ where: { orgId } });
    await handleGen({ genJobId: jobId }, 0);

    expect(await stepTwoCards()).toHaveLength(1);
    expect(await ledgerKinds()).toEqual(["RESERVE", "SETTLE"]);
    // 整个 org 的账本也只多了 Step 1 自己那一笔结算 —— 接力一行都没写。
    expect(await prisma.creditLedger.count({ where: { orgId } })).toBe(before + 1);
    const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
    expect(account.reserved).toBe(0);
    expect(account.balance).toBe(100_000 - HOLD);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A1 重投再跑一次 ⇒ 还是恰一张(第二张卡与 GEN_RESULT 同事务,撞唯一索引一起回滚)", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);

    await handleGen({ genJobId: jobId }, 0);
    await handleGen({ genJobId: jobId }, 1); // 同一条消息被再投一次

    expect(await stepTwoCards()).toHaveLength(1);
    expect(await ledgerKinds()).toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A2 Step 1 没出图(引擎失败)⇒ 零张第二步的卡,钱原路退回", async () => {
    m.generateImages.mockRejectedValue(new Error("provider exploded"));

    await handleGen({ genJobId: jobId }, 0).catch(() => {});
    // 重试用尽,走到终态失败 —— 这一条路上永远不该出现下一步的卡。
    await handleGen({ genJobId: jobId }, 9).catch(() => {});

    expect(await stepTwoCards()).toHaveLength(0);
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: orgId }, select: { status: true } });
    expect(job.status).toBe("FAILED");
    expect(await ledgerKinds()).toEqual(["RESERVE", "REFUND"]);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A2 普通图片卡(没有冻结的第二步)⇒ 一张接力卡都不铸,老行为一格不动", async () => {
    // 把 Step 1 的卡换成老形状:只有那一行片段预估,没有 `videoStep.next`。
    const payload = step1Payload() as unknown as Record<string, unknown>;
    const videoStep = payload.videoStep as Record<string, unknown>;
    delete videoStep.next;
    await prisma.chatMessage.updateMany({ where: { id: cardId, ownerId: orgId }, data: { payload: payload as never } });

    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);
    await handleGen({ genJobId: jobId }, 0);

    expect(await stepTwoCards()).toHaveLength(0);
    // 结果那一行照旧写下去 —— 接力不接,交付不受任何影响。
    expect(await prisma.chatMessage.count({ where: { threadId, ownerId: orgId, kind: "GEN_RESULT" } })).toBe(1);
    expect(await ledgerKinds()).toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);
});
