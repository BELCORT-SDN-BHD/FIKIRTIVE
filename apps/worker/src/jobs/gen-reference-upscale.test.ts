/**
 * gen-reference-upscale.test.ts —— FSE-001：无人像商品参考图自动放大（Founder 2026-09-09 裁）。
 *
 * 探针三场实测（USD 0.74）：视频端在**建任务之前**就查参考图尺寸，闸是**宽与高各 ≥300px**
 * （逐字回执 `expected the height to be at least 300px, but received a 300x200px image
 * instead`）；短边落在 [100, 300) 的商品照按整数倍 lanczos 放大后收，出片商品可辨度高。
 *
 * 这里跑**真的 `handleGen`**，拿它真正交给 `provider.generateVideo` 的那一份对表 —— 断言
 * 分三层，缺一层就漏得掉一整类病：
 *   ① 商品图真的按 `referenceUpscalePlan` 的目标尺寸放大，并作 `image_url` 部件送出；
 *   ② **原件一个字节都没动**：不写 R2、不改 asset 行，原始 buffer 的 sha256 前后一致；
 *   ③ **演员的参考照永不过 sharp**：血统信任的标记在像素里（规格 §5「像素完整性铁律」，
 *      2026-08-30 裁剪实证 = 视频端拒收 `may contain real person`）。这一条用对 `sharp`
 *      的调用录音证明，而不是靠读代码相信。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const generationUpdate = vi.fn();
  const assetUpdate = vi.fn();
  const entityFindFirst = vi.fn();
  const entityVariantFindFirst = vi.fn();
  const referenceImageFindMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const assetUpsert = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateVideo = vi.fn();
  const storagePresignedGet = vi.fn();
  const storagePut = vi.fn();
  const storageGet = vi.fn();
  const storage = { presignedGet: storagePresignedGet, put: storagePut, get: storageGet };
  /** 每一次 `sharp(bytes)` 的入参录音 —— 「演员照绝不过 sharp」靠它证明。 */
  const sharpInputs: Uint8Array[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst, create: generationCreate, update: generationUpdate, updateMany: vi.fn() },
    asset: { upsert: assetUpsert, update: assetUpdate },
    entity: { findFirst: entityFindFirst, findMany: vi.fn(async () => []) },
    entityVariant: { findFirst: entityVariantFindFirst },
    referenceImage: { findMany: referenceImageFindMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdateMany, projectFindFirst, generationFindFirst,
    generationCreate, assetUpdate, entityFindFirst, entityVariantFindFirst, referenceImageFindMany,
    chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, assetUpsert, refundReservation,
    settleCredits, generateVideo, storagePresignedGet, storagePut, storageGet, storage, sharpInputs,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: vi.fn(async () => undefined),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: vi.fn() } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));
// 真 sharp 照跑（放大必须是真的重采样，不是一个替身说「我放大过了」），只是每次调用
// 先把入参录一份。演员照有没有被送进这个函数，是这份录音直接回答的问题。
vi.mock("sharp", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: typeof import("sharp") };
  return {
    default: (input: Uint8Array, ...rest: unknown[]) => {
      m.sharpInputs.push(input);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.default as any)(input, ...rest);
    },
  };
});

import sharpReal from "sharp";
import { referenceUpscalePlan } from "@fikirtive/core";
import { handleGen } from "./gen.js";

const hexHash = (seed: number) => seed.toString(16).padStart(64, "0");
const ACTOR_HASH = hexHash(11);
const PRODUCT_HASH = hexHash(22);
const actorKey = `u/o1/${ACTOR_HASH}.png`;
const productKey = `u/o1/${PRODUCT_HASH}.jpeg`;

const videoJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: null,
  shotId: null,
  status: "QUEUED",
  kind: "VIDEO",
  model: "seedance-2-mini",
  prompt: "the woman holds the shoe up to the camera",
  entityIds: ["e0"],
  variantSel: null as Record<string, string> | null,
  count: 1,
  generationIds: [] as string[],
  spentUsd: null,
  sourceGenerationId: null as string | null,
  tailGenerationId: null,
  referenceVideoGenerationId: null,
  videoOptions: {
    seconds: 5, resolution: "480p", aspectRatio: "9:16", fps: 24, audio: false,
    referenceGenerationIds: ["gen_shoe"],
  },
};

/** 一张真的 JPEG —— 探针 T2 那张鞋照的尺寸(275×183),放大目标由 core 的计划函数说了算。 */
async function jpegOf(width: number, height: number): Promise<Buffer> {
  return sharpReal({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let productBytes: Buffer;

beforeEach(async () => {
  vi.clearAllMocks();
  productBytes = await jpegOf(275, 183);
  // 铸样图那一步自己也走 sharp —— 录音在样图铸好之后才归零,所以下面数到的每一次调用
  // 都真的来自被测代码。
  m.sharpInputs.length = 0;
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
  m.assetUpsert.mockResolvedValue({ id: "asset1" });
  m.generationCreate.mockResolvedValue({ id: "gen_out1" });
  m.storagePut.mockResolvedValue({ contentHash: "c".repeat(64) });
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storageGet.mockImplementation(async (key: string) => {
    if (key === productKey) return productBytes;
    throw new Error(`unexpected storage.get(${key})`);
  });
  // 演员:一个 CHARACTER 元素 + 一张定妆照(走 Entity 的 referenceImages,不经挂图那条路)。
  m.entityFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id, type: "CHARACTER", name: `LIVE-${where.id}`,
  }));
  m.entityVariantFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  m.referenceImageFindMany.mockImplementation(async () => [
    { asset: { ownerId: "o1", contentHash: ACTOR_HASH, ext: "png" } },
  ]);
  m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
});

/** 商家挂的那张商品图这一行长什么样。 */
function productRow(over: Record<string, unknown> = {}) {
  return {
    id: "gen_shoe",
    entitySnapshot: null,
    asset: { ownerId: "o1", contentHash: PRODUCT_HASH, ext: "jpeg", width: 275, height: 183 },
    ...over,
  };
}

/**
 * 真跑一次 `handleGen`,交回 provider 真正收到的那一整个参数。
 *
 * 可重试的失败(`REFERENCE_ASSET_UNREACHABLE`)会由 handleGen 重新抛出交给队列 —— 那本身
 * 就是被测行为的一部分,所以这里吞掉异常,让断言去看「花了钱没有」而不是「抛没抛」。
 */
async function paidVideoCall(): Promise<{ refImageUrls?: string[]; imageUrl: string } | undefined> {
  m.genJobFindUnique.mockResolvedValue(videoJob);
  await handleGen({ genJobId: "g1" }, 0).catch(() => undefined);
  return m.generateVideo.mock.calls[0]?.[0] as { refImageUrls?: string[]; imageUrl: string } | undefined;
}

/** `data:` 部件里那张图真实的像素尺寸 —— 不信 URL 前缀,直接解码量一遍。 */
async function decodedSize(dataUrl: string): Promise<{ width?: number; height?: number; format?: string }> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const meta = await sharpReal(Buffer.from(base64, "base64")).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

describe("FSE-001 —— 无人像商品参考图自动放大", () => {
  it("FSE-001 / CREATE-A2: 275×183 的商品图按计划放大到 550×366 才进 image_url 部件", async () => {
    m.generationFindFirst.mockResolvedValue(productRow());

    const call = await paidVideoCall();

    expect(call?.refImageUrls).toHaveLength(2);
    // 演员那一张原样走签名 URL —— 一个字节都没经过我们的手。
    expect(call?.refImageUrls?.[0]).toBe(`url:${actorKey}`);
    // 商品那一张变成了进程内交付的 data URL(不落库、不写 R2,见下面两条断言)。
    const product = call?.refImageUrls?.[1] ?? "";
    expect(product.startsWith("data:image/jpeg;base64,")).toBe(true);
    // 尺寸不在测试里手抄:目标由 core 的那一份计划算,与铸卡侧读的是同一个函数。
    const plan = referenceUpscalePlan({ width: 275, height: 183 });
    expect(plan).toEqual({ action: "upscale", factor: 2, width: 550, height: 366 });
    await expect(decodedSize(product)).resolves.toEqual({ width: 550, height: 366, format: "jpeg" });
  });

  it("FSE-001 / CREATE-A2: 放大产物只活在这一次请求里 —— 不写 R2、不改 asset 行、原件 sha256 不变", async () => {
    m.generationFindFirst.mockResolvedValue(productRow());
    const before = sha256(productBytes);

    await paidVideoCall();

    // 原件字节对象没有被就地改写(像素完整性铁律的最小可测形式)。
    expect(sha256(productBytes)).toBe(before);
    // 唯一一次 `storage.put` 是成片视频,不是参考图。
    expect(m.storagePut).toHaveBeenCalledTimes(1);
    expect(m.storagePut.mock.calls[0]![2]).toBe("mp4");
    // asset 行一格没动。
    expect(m.assetUpdate).not.toHaveBeenCalled();
  });

  it("FSE-001 / CREATE-A10: 演员的参考照永不过 sharp(血统信任的标记在像素里)", async () => {
    m.generationFindFirst.mockResolvedValue(productRow());

    await paidVideoCall();

    // 唯二两次调用都是那张商品图(读元数据一次、重采样一次)。演员照连读都没读。
    expect(m.sharpInputs).toHaveLength(2);
    for (const input of m.sharpInputs) expect(sha256(input)).toBe(sha256(productBytes));
    expect(m.storageGet).toHaveBeenCalledTimes(1);
    expect(m.storageGet).toHaveBeenCalledWith(productKey);
  });

  it("FSE-001 / CREATE-A10: 带演员血统的挂图不许动像素 —— 原样送,一次 sharp 都不跑", async () => {
    m.generationFindFirst.mockResolvedValue(
      productRow({ entitySnapshot: { entities: [{ id: "e0", type: "CHARACTER", name: "Aisyah" }] } }),
    );

    const call = await paidVideoCall();

    expect(call?.refImageUrls?.[1]).toBe(`url:${productKey}`);
    expect(m.sharpInputs).toHaveLength(0);
    expect(m.storageGet).not.toHaveBeenCalled();
  });

  it("FSE-001 / CREATE-A2: 已经够大的商品图一格不动(与这条修改之前逐字相同的那条路)", async () => {
    m.generationFindFirst.mockResolvedValue(
      productRow({ asset: { ownerId: "o1", contentHash: PRODUCT_HASH, ext: "jpeg", width: 550, height: 366 } }),
    );

    const call = await paidVideoCall();

    expect(call?.refImageUrls?.[1]).toBe(`url:${productKey}`);
    expect(m.storageGet).not.toHaveBeenCalled();
  });

  // 本站生成的资产没有宽高那两格(`gen.ts` 出图时不写),而本站出图短边最小 1344px
  // (`GEN_IMAGE_SIZES`),不可能小于 300 —— 所以「读不出尺寸」这一档不读字节、不放大,
  // 走的是与本次修改之前逐字相同的签名 URL 路。
  it("FSE-001 / CREATE-A2: 读不出尺寸的挂图不读字节、不放大(零额外 R2 读)", async () => {
    m.generationFindFirst.mockResolvedValue(
      productRow({ asset: { ownerId: "o1", contentHash: PRODUCT_HASH, ext: "jpeg", width: null, height: null } }),
    );

    const call = await paidVideoCall();

    expect(call?.refImageUrls?.[1]).toBe(`url:${productKey}`);
    expect(m.storageGet).not.toHaveBeenCalled();
    expect(m.sharpInputs).toHaveLength(0);
  });

  // 放大在**付费调用之前**。它失败时必须落成那句商家读得懂的、可重试的话,
  // 而不是让一个图像库的异常裸奔到通用失败文案 —— 并且这一趟一分钱都不能花。
  it("FSE-001 / CREATE-A2: 放大失败 ⇒ 零付费调用、可重试、不留半条已付费的失败", async () => {
    m.generationFindFirst.mockResolvedValue(productRow());
    m.storageGet.mockRejectedValue(new Error("r2 unreachable"));

    const call = await paidVideoCall();

    expect(call).toBeUndefined();
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.settleCredits).not.toHaveBeenCalled();
  });

  // 跨租户:别家店的 Generation id 在 worker 侧同样读不出行 —— 归属只走
  // `generationReferenceScope(job.ownerId, …)`,`ownerId` 来自 job,不从卡收。
  it("FSE-001 / CREATE-A2: 商品图解析只在本租户范围内,读不出来 ⇒ 退款、零付费调用", async () => {
    m.generationFindFirst.mockResolvedValue(null);

    const call = await paidVideoCall();

    expect(m.generationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "gen_shoe", ownerId: "o1", deletedAt: null }),
      }),
    );
    expect(call).toBeUndefined();
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalled();
    expect(m.settleCredits).not.toHaveBeenCalled();
  });
});
