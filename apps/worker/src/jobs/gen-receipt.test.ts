/**
 * gen-receipt.test.ts —— #776 生成回执落库的 worker 一站(**接线**这一层)。
 *
 * 引擎在响应里报回来两件事实,此前全被丢掉:它**真正跑的那句提示词**,和这一单它**真收的
 * 计费量**。这里跑**真的** `handleGen`(Prisma 是 mock),断言这两件事实被写到了正确的列上、
 * 用了正确的取舍。
 *
 * 分工写清楚,因为 r1 的判词正是冲着这一点来的:这个文件**只**证明接线,凡是「写不进去时
 * 会怎样」的主张一律不在这里 —— 一个 mock 的 `$transaction` 永远不会真的失败,拿它去证明
 * 「回执写失败不影响结算」就是假绿。那些主张全部搬去 `gen-receipt-db.test.ts`,在**真库**上
 * 注入**真失败**来证。
 *
 * 五条口径:
 *   ① 引擎报了提示词 → 落在 `Generation.finalPromptText`,商家写的那句仍在 `promptText`;
 *   ② 引擎没报        → 那一列**不写** = 留 null = 未知,绝不回落成商家自己那句话冒充引擎跑过;
 *   ③ 全部产出都报了量 → `GenJob.billedUnits` 落总和;
 *   ④ 只有部分报了量   → 不写 = 未知。半份求和是一个**偏低**的成本,挨着 spentUsd 躺着会被当成
 *      可对账的数 —— 低估成本比空着危险;
 *   ⑤ 回执写在钱的事务**之外**:commit 那一笔(generationIds / spent / spentUsd / settle)与
 *      #776 之前逐字节相同,回执一列都不在里面。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const generationUpdateMany = vi.fn();
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
    generation: { findFirst: generationFindFirst, create: generationCreate, updateMany: generationUpdateMany },
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
    generationCreate, generationUpdateMany, chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, assetUpsert,
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


/**
 * 真跑一次 handleGen,把它写进库里的东西按**写入位置**分好交回来。
 *
 * 位置本身就是断言的一部分:`commit` 是钱那一笔(事务内),`receiptPrompts` / `receiptUnits`
 * 是回执那几笔(事务外)。r1 把回执塞在 commit 里,于是一个记账字段有了否决交付的权力;
 * 分开取值,任何一次悄悄挪回去都会让下面的用例红。
 */
async function runWorker(job: Record<string, unknown>) {
  m.genJobFindUnique.mockResolvedValue(job);
  await handleGen({ genJobId: "g1" }, 0);
  const generationRows = m.generationCreate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
  const genJobWrites = m.genJobUpdateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> });
  return {
    generationRows,
    // commit tx 的那一次 —— generationIds / spent / spentUsd(钱)
    commit: genJobWrites.find((a) => "generationIds" in a.data)?.data,
    // 回执补写:提示词逐行、计费量整单,都在事务之外
    receiptPrompts: m.generationUpdateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> }),
    receiptUnits: genJobWrites.find((a) => "billedUnits" in a.data)?.data.billedUnits,
  };
}

describe("#776 引擎自报的提示词落在产出行上", () => {
  it("报了就原样落库,而商家自己那句话仍在 promptText —— 两句分开存,谁也不冒充谁", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { finalPrompt: "a bright poster, weekend sale, bold type", billedUnits: 1 } },
    ]);
    const { generationRows, receiptPrompts } = await runWorker({ ...imageJob });
    expect(generationRows).toHaveLength(1);
    expect(generationRows[0]!.promptText).toBe("a poster for the weekend sale");
    expect(receiptPrompts).toHaveLength(1);
    expect(receiptPrompts[0]!.data.finalPromptText).toBe("a bright poster, weekend sale, bold type");
    // 租户约束跟着回执写走 —— 补写不是「反正是自己的行」就可以不带 ownerId 的理由。
    expect(receiptPrompts[0]!.where.ownerId).toBe("o1");
  });

  it("引擎没报 ⇒ 那一列**不写**(留 null = 未知),绝不回落成商家写的那句", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows, receiptPrompts } = await runWorker({ ...imageJob });
    expect(receiptPrompts).toHaveLength(0);
    // 这一条是本票的全部意义:未知长得像未知,不长得像一个恰好等于商家原话的答案。
    expect(generationRows[0]!.finalPromptText).toBeUndefined();
  });

  it("多张图:每一张记自己那份回执,不串台", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { finalPrompt: "first rewrite", billedUnits: 1 } },
      { bytes: new Uint8Array([2]), ext: "png", receipt: { finalPrompt: "second rewrite", billedUnits: 1 } },
    ]);
    const { receiptPrompts } = await runWorker({ ...imageJob, count: 2 });
    expect(receiptPrompts.map((u) => u.data.finalPromptText)).toEqual(["first rewrite", "second rewrite"]);
    // 每一句写到**自己**那一行上(id 取自 commit 返回的顺序,不是事后按内容猜)
    expect(receiptPrompts.map((u) => u.where.id)).toEqual(["gen_out1", "gen_out2"]);
  });

  it("视频同样落库", async () => {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4", receipt: { finalPrompt: "slow push-in on the product", billedUnits: 108_900 } });
    const { receiptPrompts } = await runWorker({ ...videoJob });
    expect(receiptPrompts[0]!.data.finalPromptText).toBe("slow push-in on the product");
  });
});

describe("#914 r2(判官 r1 P1)requestedPrompt 落在产出行上,而且在 commit 事务里", () => {
  it("GenJob 带 requestedPrompt(coworkGenerate 的拼装步骤真的改了什么)⇒ 原样落到 Generation.requestedPromptText,与 promptText 同一次写入", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows } = await runWorker({ ...imageJob, requestedPrompt: "a poster for the weekend sale, moody lighting" });
    expect(generationRows).toHaveLength(1);
    expect(generationRows[0]!.promptText).toBe("a poster for the weekend sale"); // 拼装之后,实际送出的那句
    expect(generationRows[0]!.requestedPromptText).toBe("a poster for the weekend sale, moody lighting"); // 拼装之前
  });

  it("GenJob 没有 requestedPrompt(直接走 composer / Otto 对话 generate 技能 / 拼装无变化)⇒ 那一列不写,不是「未知」而是「没有可分家的两句话」", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows } = await runWorker({ ...imageJob });
    expect(generationRows[0]).not.toHaveProperty("requestedPromptText");
  });

  it("多张图:GenJob 一份 requestedPrompt,每一张产出行都抄同一份(拼装发生在整单唯一的 prompt 字段上,不是逐张的)", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png" },
      { bytes: new Uint8Array([2]), ext: "png" },
    ]);
    const { generationRows } = await runWorker({ ...imageJob, count: 2, requestedPrompt: "a poster for the weekend sale, moody lighting" });
    expect(generationRows.map((r) => r.requestedPromptText)).toEqual([
      "a poster for the weekend sale, moody lighting",
      "a poster for the weekend sale, moody lighting",
    ]);
  });

  it("不像 finalPromptText/billedUnits 那样搬到事务外 —— 它是我们自己已校验过长度的数据,不是引擎能撑爆的输入", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows, receiptPrompts } = await runWorker({ ...imageJob, requestedPrompt: "a poster for the weekend sale, moody lighting" });
    // 落在 generationCreate 的 data 里(commit tx 内),不是 generationUpdateMany(事务外的补写)。
    expect(generationRows[0]!.requestedPromptText).toBe("a poster for the weekend sale, moody lighting");
    expect(receiptPrompts.every((u) => !("requestedPromptText" in u.data))).toBe(true);
  });
});

describe("#776 真实计费量:全报才求和", () => {
  it("全部产出都报了量 ⇒ 落总和(图片按张:两张 = 2)", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1 } },
      { bytes: new Uint8Array([2]), ext: "png", receipt: { billedUnits: 1 } },
    ]);
    const { commit, receiptUnits } = await runWorker({ ...imageJob, count: 2 });
    expect(receiptUnits).toBe(2);
    expect(typeof commit!.spentUsd).toBe("number"); // 估算照旧,由我们的价目表冻结
    expect(commit!.spent).toBe(true);
  });

  it("只有部分报了量 ⇒ 不写(未知),绝不落一个偏低的半份求和", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1 } },
      { bytes: new Uint8Array([2]), ext: "png" },
    ]);
    const { receiptUnits } = await runWorker({ ...imageJob, count: 2 });
    expect(receiptUnits).toBeUndefined();
  });

  it("一个都没报 ⇒ 不写", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { receiptUnits } = await runWorker({ ...imageJob });
    expect(receiptUnits).toBeUndefined();
  });
});

describe("#776 回执在钱的事务之外", () => {
  it("commit 那一笔只写钱与 resume marker —— 回执一列都不在里面", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1, finalPrompt: "rewritten" } }]);
    const { commit, generationRows } = await runWorker({ ...imageJob });
    // 这两条是 r1 的病灶所在:回执写在事务里,写不进去就回滚掉一单已经付过钱的生成。
    expect(commit).not.toHaveProperty("billedUnits");
    expect(generationRows[0]).not.toHaveProperty("finalPromptText");
  });

  it("回执是记录不是计费:有没有回执,settle 与 spentUsd 一模一样", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1, finalPrompt: "rewritten" } }]);
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
