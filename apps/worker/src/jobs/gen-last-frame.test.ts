/**
 * gen-last-frame.test.ts —— #782 分镜自动接续的 worker 一站。
 *
 * 这里跑**真的** `handleGen`,断言它真正做了三件事,而不是断言源码里写着什么:
 *   ① 每条视频作业都向引擎**要**末帧(免费,不新增计费点);图片作业不受影响;
 *   ② 引擎给了末帧就把它接住 —— 落 R2、建 Asset、写 `GenJob.lastFrameAssetId`,
 *      而且**不建 Generation**(那会让商家的候选区每出一条片就多一张没人要过的静图);
 *   ③ 末帧这一路的任何失败都**不许**弄坏那条已经付过钱的片子:作业照样 DONE。
 *
 * ③ 是这份文件里最要紧的一条。末帧是免费附件,片子是付费产物;让免费附件有能力把付费
 * 产物拖失败,就等于用一个不要钱的东西去赌商家的钱。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const generationFindMany = vi.fn();
  const generationUpdate = vi.fn();
  const shotFindFirst = vi.fn();
  const shotUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const assetUpsert = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const settleCanvasCardsForGenJob = vi.fn();
  const generateImages = vi.fn();
  const generateVideo = vi.fn();
  const storagePresignedGet = vi.fn();
  const storagePut = vi.fn();
  const storage = { presignedGet: storagePresignedGet, put: storagePut };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst, create: generationCreate, findMany: generationFindMany, update: generationUpdate },
    shot: { findFirst: shotFindFirst, updateMany: shotUpdateMany },
    asset: { upsert: assetUpsert },
    entity: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    entityVariant: { findFirst: vi.fn() },
    referenceImage: { findMany: vi.fn(async () => []) },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, generationFindFirst,
    generationCreate, generationFindMany, generationUpdate, shotFindFirst, shotUpdateMany,
    chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, assetUpsert,
    refundReservation, settleCredits, settleCanvasCardsForGenJob,
    generateImages, generateVideo, storagePresignedGet, storagePut, storage,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: m.settleCanvasCardsForGenJob,
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { handleGen } from "./gen.js";

const videoJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: "th1",
  shotId: null,
  status: "QUEUED",
  kind: "VIDEO",
  model: "seedance-2-mini",
  prompt: "the car rolls out",
  entityIds: [] as string[],
  variantSel: null,
  count: 1,
  videoOptions: { seconds: 5, resolution: "720p" },
  imageOptions: null,
  generationIds: [] as string[],
  spentUsd: null,
  sourceGenerationId: "src1",
  tailGenerationId: null,
  referenceVideoGenerationId: null,
};

const TAIL = { bytes: new Uint8Array([9, 9, 9, 9]), ext: "png" };

beforeEach(() => {
  vi.clearAllMocks();
  m.storage.presignedGet = m.storagePresignedGet;
  m.storage.put = m.storagePut;
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
  m.assetUpsert.mockResolvedValue({ id: "asset_clip" });
  m.generationCreate.mockResolvedValue({ id: "gen_out1" });
  m.generationFindFirst.mockResolvedValue({ id: "src1", asset: { ownerId: "o1", contentHash: "a".repeat(64), ext: "png" } });
  m.storagePut.mockResolvedValue({ contentHash: "c".repeat(64) });
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4", lastFrame: TAIL });
  m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
});

/** 这一单最终有没有 DONE —— 「免费附件不许拖垮付费产物」那条断言的判据。 */
function jobWentDone(): boolean {
  return m.genJobUpdate.mock.calls.some(
    (c) => (c[0] as { data?: { status?: string } }).data?.status === "DONE",
  );
}

describe("#782 worker:引擎免费附送的末帧", () => {
  it("每条视频作业都向引擎要末帧(免费,不新增计费点)", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...videoJob });
    await handleGen({ genJobId: "g1" }, 0);
    expect(m.generateVideo).toHaveBeenCalledTimes(1);
    expect((m.generateVideo.mock.calls[0]![0] as { returnLastFrame?: boolean }).returnLastFrame).toBe(true);
  });

  it("图片作业与末帧无关(两条路互不串台)", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...videoJob, kind: "IMAGE", model: "seedream", sourceGenerationId: null });
    await handleGen({ genJobId: "g1" }, 0);
    expect(m.generateVideo).not.toHaveBeenCalled();
    const tailWrite = m.genJobUpdateMany.mock.calls.find(
      (c) => (c[0] as { data?: Record<string, unknown> }).data?.lastFrameAssetId !== undefined,
    );
    expect(tailWrite).toBeUndefined();
  });

  it("末帧被接住:落 R2 + 建 Asset + 写 GenJob.lastFrameAssetId", async () => {
    m.assetUpsert.mockImplementation(async (args: { create: { contentHash: string } }) =>
      ({ id: args.create.contentHash === "d".repeat(64) ? "asset_tail" : "asset_clip" }));
    m.storagePut.mockImplementation(async (_owner: string, bytes: Uint8Array) =>
      ({ contentHash: (bytes.byteLength === TAIL.bytes.byteLength ? "d" : "c").repeat(64) }));
    m.genJobFindUnique.mockResolvedValue({ ...videoJob });

    await handleGen({ genJobId: "g1" }, 0);

    // 末帧的字节真的被送去存了(不是「打算存」)。
    const tailPut = m.storagePut.mock.calls.find((c) => (c[1] as Uint8Array).byteLength === TAIL.bytes.byteLength);
    expect(tailPut, "末帧字节必须真的落 R2").toBeDefined();
    // 作业行指向的就是那一行 Asset。
    const tailWrite = m.genJobUpdateMany.mock.calls.find(
      (c) => (c[0] as { data?: { lastFrameAssetId?: string } }).data?.lastFrameAssetId !== undefined,
    );
    expect(tailWrite).toBeDefined();
    expect((tailWrite![0] as { data: { lastFrameAssetId: string } }).data.lastFrameAssetId).toBe("asset_tail");
    // 而且**只**为片子建了一行 Generation —— 末帧此刻还只是素材,不是作品。
    expect(m.generationCreate).toHaveBeenCalledTimes(1);
    expect(jobWentDone()).toBe(true);
  });

  it("引擎没给末帧 → 什么都不写,片子照常交付", async () => {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
    m.genJobFindUnique.mockResolvedValue({ ...videoJob });
    await handleGen({ genJobId: "g1" }, 0);
    const tailWrite = m.genJobUpdateMany.mock.calls.find(
      (c) => (c[0] as { data?: Record<string, unknown> }).data?.lastFrameAssetId !== undefined,
    );
    expect(tailWrite).toBeUndefined();
    expect(jobWentDone()).toBe(true);
  });

  it("末帧存不进去也绝不弄坏那条已经付过钱的片子", async () => {
    // 免费附件不许有能力把付费产物拖失败。R2 在末帧那一次 put 上直接炸,作业仍必须 DONE。
    m.storagePut.mockImplementation(async (_owner: string, bytes: Uint8Array) => {
      if (bytes.byteLength === TAIL.bytes.byteLength) throw new Error("R2 down");
      return { contentHash: "c".repeat(64) };
    });
    m.genJobFindUnique.mockResolvedValue({ ...videoJob });
    await expect(handleGen({ genJobId: "g1" }, 0)).resolves.toBeUndefined();
    expect(jobWentDone()).toBe(true);
    const tailWrite = m.genJobUpdateMany.mock.calls.find(
      (c) => (c[0] as { data?: Record<string, unknown> }).data?.lastFrameAssetId !== undefined,
    );
    expect(tailWrite).toBeUndefined();
  });
});
