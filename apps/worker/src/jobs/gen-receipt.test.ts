/**
 * gen-receipt.test.ts —— #776 生成回执落库的 worker 一站。
 *
 * 引擎在响应里报回来两件事实,此前全被丢掉:它**真正跑的那句提示词**,和这一单它**真收的
 * 计费量**。这里跑**真的** `handleGen`,断言这两件事实真的落到了库里,以及它们落错时不会
 * 变成别的东西。
 *
 * 五条口径:
 *   ① 引擎报了提示词 → 原样落在 `Generation.finalPromptText`,商家写的那句仍在 `promptText`;
 *   ② 引擎没报        → 落 null = **未知**,绝不回落成商家自己那句话冒充引擎跑过;
 *   ③ 全部产出都报了量 → `GenJob.billedUnits` 落总和,与 `spentUsd` 在同一次写入里;
 *   ④ 只有部分报了量   → 落 null。半份求和是一个**偏低**的成本,挨着 spentUsd 躺着会被当成
 *      可对账的数 —— 低估成本比空着危险;
 *   ⑤ 回执只是记录:钱的判定(settle、spent、spentUsd)一个字节都不因它改变。
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

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  // 画布结算与本票无关,但缺了它每条用例都会刷一屏 non-fatal 噪音,把真正的失败盖掉。
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

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
  prompt: "a poster for the weekend sale",
  entityIds: [] as string[],
  variantSel: null,
  count: 1,
  videoOptions: null,
  imageOptions: null,
  generationIds: [] as string[],
  spentUsd: null,
  sourceGenerationId: null,
  tailGenerationId: null,
  referenceVideoGenerationId: null,
};

const videoJob = { ...imageJob, kind: "VIDEO", model: "seedance-2-mini", videoOptions: { seconds: 5, resolution: "720p" } };

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
  m.generationCreate.mockImplementation(async () => ({ id: `gen_out${m.generationCreate.mock.calls.length}` }));
  // distinct hashes per output so a multi-image job really writes several rows
  m.storagePut.mockImplementation(async () => ({ contentHash: String(m.storagePut.mock.calls.length).repeat(64).slice(0, 64) }));
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
});

/** 真跑一次 handleGen,交回它写进库里的东西。 */
async function runWorker(job: Record<string, unknown>) {
  m.genJobFindUnique.mockResolvedValue(job);
  await handleGen({ genJobId: "g1" }, 0);
  const generationRows = m.generationCreate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
  // commit tx 的那一次 updateMany —— 它同时写 generationIds / spent / spentUsd / billedUnits
  const commit = m.genJobUpdateMany.mock.calls
    .map((c) => c[0] as { data: Record<string, unknown> })
    .find((a) => "generationIds" in a.data);
  return { generationRows, commit: commit?.data };
}

describe("#776 引擎自报的提示词落在产出行上", () => {
  it("报了就原样落库,而商家自己那句话仍在 promptText —— 两句分开存,谁也不冒充谁", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { finalPrompt: "a bright poster, weekend sale, bold type", billedUnits: 16_384 } },
    ]);
    const { generationRows } = await runWorker({ ...imageJob });
    expect(generationRows).toHaveLength(1);
    expect(generationRows[0]!.finalPromptText).toBe("a bright poster, weekend sale, bold type");
    expect(generationRows[0]!.promptText).toBe("a poster for the weekend sale");
  });

  it("引擎没报 ⇒ null(未知),绝不回落成商家写的那句", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows } = await runWorker({ ...imageJob });
    expect(generationRows[0]!.finalPromptText).toBeNull();
    // 这一条是本票的全部意义:未知长得像未知,不长得像一个恰好等于商家原话的答案。
    expect(generationRows[0]!.finalPromptText).not.toBe(imageJob.prompt);
  });

  it("多张图:每一张记自己那份回执,不串台", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { finalPrompt: "first rewrite", billedUnits: 10 } },
      { bytes: new Uint8Array([2]), ext: "png", receipt: { finalPrompt: "second rewrite", billedUnits: 20 } },
    ]);
    const { generationRows } = await runWorker({ ...imageJob, count: 2 });
    expect(generationRows.map((r) => r.finalPromptText)).toEqual(["first rewrite", "second rewrite"]);
  });

  it("视频同样落库", async () => {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4", receipt: { finalPrompt: "slow push-in on the product", billedUnits: 108_900 } });
    const { generationRows } = await runWorker({ ...videoJob });
    expect(generationRows[0]!.finalPromptText).toBe("slow push-in on the product");
  });
});

describe("#776 真实计费量与成本估算并排冻结", () => {
  it("全部产出都报了量 ⇒ 落总和,和 spentUsd 同一次写入", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 16_384 } },
      { bytes: new Uint8Array([2]), ext: "png", receipt: { billedUnits: 16_000 } },
    ]);
    const { commit } = await runWorker({ ...imageJob, count: 2 });
    expect(commit!.billedUnits).toBe(32_384);
    // 「估的成本」与「引擎报的量」必须来自同一个瞬间,否则日后对账的两个数说的不是同一单。
    expect(typeof commit!.spentUsd).toBe("number");
    expect(commit!.spent).toBe(true);
  });

  it("只有部分报了量 ⇒ null(未知),绝不落一个偏低的半份求和", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 16_384 } },
      { bytes: new Uint8Array([2]), ext: "png" },
    ]);
    const { commit } = await runWorker({ ...imageJob, count: 2 });
    expect(commit!.billedUnits).toBeNull();
  });

  it("一个都没报 ⇒ null", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { commit } = await runWorker({ ...imageJob });
    expect(commit!.billedUnits).toBeNull();
  });

  it("回执是记录不是计费:有没有回执,settle 与 spentUsd 一模一样", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 16_384, finalPrompt: "rewritten" } }]);
    const withReceipt = await runWorker({ ...imageJob });
    const settleCallsWith = m.settleCredits.mock.calls.length;

    vi.clearAllMocks();
    m.projectFindFirst.mockResolvedValue({ id: "p1" });
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
    m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
    m.creditLedgerFindFirst.mockResolvedValue(null);
    m.assetUpsert.mockResolvedValue({ id: "asset1" });
    m.generationCreate.mockResolvedValue({ id: "gen_out1" });
    m.storagePut.mockResolvedValue({ contentHash: "c".repeat(64) });
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const withoutReceipt = await runWorker({ ...imageJob });

    expect(withoutReceipt.commit!.spentUsd).toBe(withReceipt.commit!.spentUsd);
    expect(withoutReceipt.commit!.spent).toBe(withReceipt.commit!.spent);
    expect(m.settleCredits.mock.calls.length).toBe(settleCallsWith);
  });
});
