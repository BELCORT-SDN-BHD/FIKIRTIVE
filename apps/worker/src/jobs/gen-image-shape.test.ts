/**
 * gen-image-shape.test.ts —— #642 T1 图片形状的 worker 一站。
 *
 * 规格从入队那一刻起就冻在作业行上(`GenJob.imageOptions`)。这里跑**真的** `handleGen`,
 * 断言它真正交给 `provider.generate` 的那一个 `aspectRatio` —— 不断言手抄的期望值,也不
 * 读源码字符串:链路上少传一站、传错一站,这里当场红。
 *
 * 三条口径:
 *   ① 快照里的画幅原样透传(不打折、不改写);
 *   ② 快照为 null(迁移前的历史行)→ 诚实回落默认方图,与它们当年真实的产出一致;
 *   ③ 视频作业完全不受影响(两条规格路互不串台)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const assetUpsert = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateImages = vi.fn();
  const generateVideo = vi.fn();
  const storagePresignedGet = vi.fn();
  const storagePut = vi.fn();
  const storage = { presignedGet: storagePresignedGet, put: storagePut };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst, create: generationCreate },
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
    generationCreate, chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, assetUpsert,
    refundReservation, settleCredits, generateImages, generateVideo, storagePresignedGet, storagePut, storage,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits }));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { GEN_IMAGE_ASPECTS } from "@fikirtive/core";
import { handleGen } from "./gen.js";

const imageJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: null,
  shotId: null,
  status: "QUEUED",
  kind: "IMAGE",
  model: "seedream",
  prompt: "a poster",
  entityIds: [] as string[],
  variantSel: null,
  count: 1,
  videoOptions: null,
  imageOptions: null as { aspectRatio: string } | null,
  generationIds: [] as string[],
  spentUsd: null,
  sourceGenerationId: null as string | null,
  tailGenerationId: null,
  referenceVideoGenerationId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.storage.presignedGet = m.storagePresignedGet;
  m.storage.put = m.storagePut;
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
  m.assetUpsert.mockResolvedValue({ id: "asset1" });
  m.generationCreate.mockResolvedValue({ id: "gen_out1" });
  m.storagePut.mockResolvedValue({ contentHash: "c".repeat(64) });
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
  m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
});

/** 真跑一次 handleGen,交回 provider 真正收到的那一次图片请求。 */
async function imageRequestFromRealWorker(job: Record<string, unknown>) {
  m.genJobFindUnique.mockResolvedValue(job);
  await handleGen({ genJobId: "g1" }, 0);
  expect(m.generateImages, "付费调用必须真的发生过,这条断言才有意义").toHaveBeenCalledTimes(1);
  return m.generateImages.mock.calls[0]![0] as { aspectRatio?: string; count: number; model: string };
}

describe("#642 worker 透传图片规格", () => {
  it.each([...GEN_IMAGE_ASPECTS])("快照里的画幅 %s 原样送到适配器", async (aspect) => {
    const req = await imageRequestFromRealWorker({ ...imageJob, imageOptions: { aspectRatio: aspect } });
    expect(req.aspectRatio).toBe(aspect);
  });

  it("快照为 null(迁移前的历史行)→ 诚实回落默认方图", async () => {
    const req = await imageRequestFromRealWorker({ ...imageJob, imageOptions: null });
    expect(req.aspectRatio).toBe("1:1");
  });

  it("快照存在但字段是垃圾 → 同样回落默认,绝不把引擎收不下的值发出去", async () => {
    const req = await imageRequestFromRealWorker({ ...imageJob, imageOptions: { aspectRatio: 42 } });
    expect(req.aspectRatio).toBe("1:1");
  });

  it("多张一批时每张都用同一个画幅(一批里不许混形状)", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png" },
      { bytes: new Uint8Array([2]), ext: "png" },
    ]);
    const req = await imageRequestFromRealWorker({ ...imageJob, count: 2, imageOptions: { aspectRatio: "3:4" } });
    expect(req).toEqual(expect.objectContaining({ count: 2, aspectRatio: "3:4" }));
  });

  it("视频作业不受影响:图片规格一个字都不进视频请求", async () => {
    m.genJobFindUnique.mockResolvedValue({
      ...imageJob,
      kind: "VIDEO",
      model: "seedance-2-mini",
      sourceGenerationId: "gen_src",
      imageOptions: { aspectRatio: "9:16" },
      videoOptions: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true },
    });
    m.generationFindFirst.mockResolvedValue({ id: "gen_src", asset: { ownerId: "o1", contentHash: "b".repeat(64), ext: "png" } });
    await handleGen({ genJobId: "g1" }, 0);
    expect(m.generateVideo).toHaveBeenCalledTimes(1);
    const vreq = m.generateVideo.mock.calls[0]![0] as Record<string, unknown>;
    expect(vreq.aspectRatio).toBe("16:9");
    expect(m.generateImages).not.toHaveBeenCalled();
  });
});
