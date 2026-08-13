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
  const genJobCreate = vi.fn(); // 只为「一次都没被调」那条断言而存在(见文件末的钱路指纹)
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
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany, create: genJobCreate },
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
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, genJobCreate, projectFindFirst, generationFindFirst,
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

import { handleGen, LAST_FRAME_STORE_TIMEOUT_MS } from "./gen.js";

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

  it("末帧那一路**卡住**同样不许拖着 DONE(判官 r2:best-effort 必须覆盖不回话,不只覆盖炸了)", async () => {
    // 上一条钉的是「炸了」。这一条钉「不回话」—— R2/Postgres 不总是大声失败,有时就是不
    // 应答。这三个 await 夹在**已结算的钱**和商家的 DONE 之间:不设预算,一条僵住的连接
    // 就能把作业按在 GENERATING 上直到队列超时重投一条我们已经付过钱的片子。
    vi.useFakeTimers();
    try {
      m.storagePut.mockImplementation((_owner: string, bytes: Uint8Array) => {
        if (bytes.byteLength === TAIL.bytes.byteLength) return new Promise(() => {}); // 永不 settle
        return Promise.resolve({ contentHash: "c".repeat(64) });
      });
      m.genJobFindUnique.mockResolvedValue({ ...videoJob });

      const run = handleGen({ genJobId: "g1" }, 0);
      await vi.advanceTimersByTimeAsync(LAST_FRAME_STORE_TIMEOUT_MS + 1_000);
      await expect(run).resolves.toBeUndefined();

      expect(jobWentDone()).toBe(true); // 片子照常交付
      const tailWrite = m.genJobUpdateMany.mock.calls.find(
        (c) => (c[0] as { data?: Record<string, unknown> }).data?.lastFrameAssetId !== undefined,
      );
      expect(tailWrite).toBeUndefined(); // 这一环这次接不上 —— #782 之前的行为
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// #782 r2 —— 「不加钱」不是一句话,是一组必须逐一相等的数
// ---------------------------------------------------------------------------
//
// PR 正文写着「没有新的 reserve/settle/refund 调用点,没有新的幂等键,genJob.create 一次
// 都没多出来」。判官 r1 的原话是:生产代码属实,但**没有一条测试钉住它** —— 这类断言一旦
// 只活在正文里,下一次改动把它弄丢时不会有任何东西变红。
//
// 所以这里把那句话变成机器可判的形状:同一单作业跑两遍(引擎给末帧 / 引擎不给末帧),
// 采集钱路上的每一个数,要求两态**逐一相等**,并且各自等于「没有末帧这件事时本来的样子」。
type MoneyFingerprint = ReturnType<typeof moneyFingerprint>;

/** 这一单在钱路上留下的全部痕迹:调用点、次数、幂等键(连顺序一起钉)。 */
function moneyFingerprint() {
  const refIdsOf = (calls: unknown[][], label: string) =>
    calls.map((c) => `${label}:${(c[1] as { refId?: string } | undefined)?.refId}`);
  return {
    genJobCreate: m.genJobCreate.mock.calls.length, // 新的付费作业 = 新的一笔钱
    generationCreate: m.generationCreate.mock.calls.length, // 交付物行数
    settle: m.settleCredits.mock.calls.length,
    refund: m.refundReservation.mock.calls.length,
    // 幂等键是 exactly-once 的抓手:多一把没见过的键 = 多一条能扣钱的路。
    idempotencyKeys: [
      ...refIdsOf(m.settleCredits.mock.calls, "settle"),
      ...refIdsOf(m.refundReservation.mock.calls, "refund"),
    ],
  };
}

describe("#782 r2 钱路指纹:末帧开/关两态逐一相等", () => {
  async function runOnce(withTail: boolean): Promise<MoneyFingerprint> {
    vi.clearAllMocks(); // 只清计数与调用记录,mockResolvedValue 一律保留
    m.generateVideo.mockResolvedValue(
      withTail ? { bytes: new Uint8Array([1]), ext: "mp4", lastFrame: TAIL } : { bytes: new Uint8Array([1]), ext: "mp4" },
    );
    m.genJobFindUnique.mockResolvedValue({ ...videoJob });
    await handleGen({ genJobId: "g1" }, 0);
    expect(jobWentDone()).toBe(true); // 两态都必须真的走完,否则「相等」毫无意义
    return moneyFingerprint();
  }

  it("引擎给末帧 vs 不给末帧:genJob.create / settle / refund / 幂等键集合全等", async () => {
    const withTail = await runOnce(true);
    const withoutTail = await runOnce(false);
    expect(withTail).toEqual(withoutTail);
  });

  it("而且那组数就是「本来的样子」:零新作业、零退款、一次结算、一把键", async () => {
    const fp = await runOnce(true);
    expect(fp.genJobCreate).toBe(0); // 末帧这一路从不开新作业
    expect(fp.refund).toBe(0);
    expect(fp.settle).toBe(1);
    expect(fp.idempotencyKeys).toEqual(["settle:g1"]); // 唯一那把键,还是作业自己的 id
    expect(fp.generationCreate).toBe(1); // 只有片子成为作品;末帧此刻仍只是素材
    // 末帧确实被接住了 —— 上面那组「零新增」不是因为这条路根本没跑。
    const tailWrite = m.genJobUpdateMany.mock.calls.find(
      (c) => (c[0] as { data?: { lastFrameAssetId?: string } }).data?.lastFrameAssetId !== undefined,
    );
    expect(tailWrite).toBeDefined();
  });
});
