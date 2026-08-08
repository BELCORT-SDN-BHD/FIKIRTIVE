/**
 * gen-reference-budget.test.ts —— #619 E-5 等价闸。
 *
 * 卡面在**花钱之前**告诉商家「这一趟会用你 N 张参考照里的 M 张」。那句话的数字由
 * `referenceBudget`(`@fikirtive/core`)算出,而真相住在 `handleGen` 里。两处各算各的
 * 就是本仓库反复重学的「说的与做的失同步」——所以这里不断言手抄的期望值,而是
 * **跑真的 `handleGen`**,拿它真正交给 `provider.generate` 的 `inputImageUrls` 对表。
 *
 * 断言分两层,缺一层就漏得掉一整类漂移:
 *   ① **张数** = 卡面那句话用的 `referenceBudget(...).used`(数字不许说错);
 *   ② **实发集与次序** = 逐张比对 URL(哪几张上车、谁排第几,也不许变)。
 *      只钉张数是不够的:`[20, 1]` 这种偏斜案例下,「把第一个元素装满 10 张、把第二个
 *      元素饿死」张数照样是 10,却让商家 @ 到的那个元素**一张都没进引擎**——他为一个
 *      看不见的元素付了钱。所以这里钉死 A0,B0,A1…A8。
 *
 * 真相出处(main @ 6b6c537c,`apps/worker/src/jobs/gen.ts` —— 本票不改这个文件,
 * 它属于 E-6/T2 的范围):
 *   `:519-532` 元素参考照 round-robin,聚合上限 MAX_CONDITIONING_IMAGES(10);
 *   `:650-659` image 分支把编辑底图 unshift 到第 0 位 —— **在上限之外再加一张**。
 *
 * worker 的选片规则一旦漂移(改上限、改成先放底图再截断、改 round-robin 为顺序装满),
 * 这里当场红,逼着 core 里那份副本跟着改,卡面于是自动开始说新话。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const entityFindFirst = vi.fn();
  const entityVariantFindFirst = vi.fn();
  const referenceImageFindMany = vi.fn();
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
    entity: { findFirst: entityFindFirst, findMany: vi.fn(async () => []) },
    entityVariant: { findFirst: entityVariantFindFirst },
    referenceImage: { findMany: referenceImageFindMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, generationFindFirst,
    generationCreate, entityFindFirst, entityVariantFindFirst, referenceImageFindMany,
    chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, assetUpsert, refundReservation,
    settleCredits, generateImages, generateVideo, storagePresignedGet, storagePut, storage,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits }));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { referenceBudget, MAX_CONDITIONING_IMAGES } from "@fikirtive/core";
import { handleGen } from "./gen.js";

const BASE_HASH = "b".repeat(64);

const imageJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: null,
  shotId: null,
  status: "QUEUED",
  kind: "IMAGE",
  model: "seedream",
  prompt: "keep the product, beach background",
  entityIds: [] as string[],
  variantSel: null as Record<string, string> | null,
  count: 1,
  videoOptions: null,
  generationIds: [] as string[],
  spentUsd: null,
  sourceGenerationId: null as string | null,
  tailGenerationId: null,
  referenceVideoGenerationId: null,
};

/** content hash 必须是 64 位小写 hex(storageKey 会校验),所以这里按序号铸。 */
function hexHash(seed: number): string {
  return seed.toString(16).padStart(64, "0");
}

/** `n` 张属于某元素的活参考照(worker 只读 asset 的三个字段)。 */
function refsFor(entityIndex: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    asset: { ownerId: "o1", contentHash: hexHash((entityIndex + 1) * 1000 + i), ext: "png" },
  }));
}

/** 每张图在 `inputImageUrls` 里长什么样(presignedGet 替身返回 `url:<storageKey>`)。 */
const urlOf = (contentHash: string) => `url:u/o1/${contentHash}.png`;
/** 第 `entityIndex` 个元素的第 `refIndex` 张图 —— 与 refsFor 同一把尺。 */
const elementUrl = (entityIndex: number, refIndex: number) =>
  urlOf(hexHash((entityIndex + 1) * 1000 + refIndex));
const BASE_URL = urlOf(BASE_HASH);

/**
 * 期望的实发集与次序 —— 按 worker 的 round-robin **独立**推一遍(gen.ts:521-532)。
 * 刻意不复用 `referenceBudget`:那个函数只回张数,推不出次序,所以这里不存在
 * 「拿被测对象自己当答案」的循环论证。
 */
function expectedRoundRobinUrls(perEntityLiveCounts: number[]): string[] {
  const picked: string[] = [];
  for (let round = 0; picked.length < MAX_CONDITIONING_IMAGES; round++) {
    let progressed = false;
    for (let e = 0; e < perEntityLiveCounts.length; e++) {
      if (round >= perEntityLiveCounts[e]!) continue;
      picked.push(elementUrl(e, round));
      progressed = true;
      if (picked.length >= MAX_CONDITIONING_IMAGES) break;
    }
    if (!progressed) break;
  }
  return picked;
}

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
  m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
  // 每个 asset 一个可辨认的 URL —— 底图是否真的在第 0 位,靠它证明。
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  // 元素一律用 PRODUCT:CHARACTER 无 base 图会被 worker 提前拒付,那是另一条规则。
  m.entityFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, type: "PRODUCT" }));
  m.entityVariantFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  // 编辑底图(sourceGenerationId)解析。
  m.generationFindFirst.mockResolvedValue({ id: "gen_src", asset: { ownerId: "o1", contentHash: BASE_HASH, ext: "png" } });
});

/** 真跑一次 handleGen,交回 provider 真正收到的 inputImageUrls。 */
async function inputImageUrlsFromRealWorker(job: Record<string, unknown>): Promise<string[]> {
  m.genJobFindUnique.mockResolvedValue(job);
  await handleGen({ genJobId: "g1" }, 0);
  expect(m.generateImages, "the paid call must have happened for this case to mean anything").toHaveBeenCalledTimes(1);
  return m.generateImages.mock.calls[0]![0].inputImageUrls as string[];
}

describe("#619 E-5 —— 卡面数字 = worker 真正发出去的参考图张数", () => {
  it.each([
    // [名字, 每个元素的活图数, 是否带底图, 商家挂了几张图]
    ["零元素、零挂图", [], false, 0],
    ["零元素 + 一张挂图(底图独占第 0 位)", [], true, 1],
    ["挂图 + 元素未到上限", [3, 3], true, 1],
    ["元素刚好压线(=上限)", [5, 5], false, 0],
    ["挂图 + 元素刚好压线 —— 底图在上限之外再加一张", [5, 5], true, 1],
    ["元素超限 17 → 10", [9, 8], false, 0],
    ["挂图 + 元素超限 17 → 10 + 1", [9, 8], true, 3],
    ["一个元素独占很多图,另一个只有一张(round-robin 不许饿死后者)", [20, 1], false, 0],
  ])("%s", async (_label, perEntityLiveCounts, hasBaseImage, attachedImageCount) => {
    const entityIds = perEntityLiveCounts.map((_, i) => `e${i}`);
    const byEntity = new Map(entityIds.map((id, i) => [id, refsFor(i, perEntityLiveCounts[i]!)]));
    m.referenceImageFindMany.mockImplementation(async ({ where }: { where: { entityId: string } }) =>
      byEntity.get(where.entityId) ?? [],
    );

    const actual = await inputImageUrlsFromRealWorker({
      ...imageJob,
      entityIds,
      ...(hasBaseImage ? { sourceGenerationId: "gen_src" } : {}),
    });

    const predicted = referenceBudget({
      kind: "image",
      perEntityLiveCounts,
      hasBaseImage,
      attachedImageCount,
    });

    // ① **实发集与次序**逐张对表 —— 哪几张上车、谁排第几,一张都不许变。
    //    (只钉 length 的话,「把第一个元素装满、饿死第二个」也会通过。)
    expect(actual).toEqual([
      ...(hasBaseImage ? [BASE_URL] : []),
      ...expectedRoundRobinUrls(perEntityLiveCounts),
    ]);
    // ② 卡面说的张数 = 引擎真收到的张数。
    expect(actual.length).toBe(predicted.used);
    // ③ 商家一共给了几张,也不许说错(挂了但没当底图的那些不进引擎,但仍是他给的)。
    const elementTotal = perEntityLiveCounts.reduce((s, n) => s + n, 0);
    expect(predicted.total).toBe(elementTotal + Math.max(attachedImageCount, hasBaseImage ? 1 : 0));
    // ④ 截断这件事本身也不许说错。
    expect(predicted.truncated).toBe(Math.min(elementTotal, MAX_CONDITIONING_IMAGES) < elementTotal);
  });

  // 偏斜案例单独钉一遍字面量 —— 上面的期望值是推出来的,这里的是**写死**的,
  // 所以「推导器和被测行为一起漂移」也逃不掉。商家 @ 的第二个元素必须真的上车:
  // 顺序装满(A0…A9)张数同样是 10,但他为一个引擎从没见过的元素付了钱。
  it("[20, 1] 的实发集必须是 A0,B0,A1…A8 —— 不是「先把 A 装满」", async () => {
    const byEntity = new Map([["e0", refsFor(0, 20)], ["e1", refsFor(1, 1)]]);
    m.referenceImageFindMany.mockImplementation(async ({ where }: { where: { entityId: string } }) =>
      byEntity.get(where.entityId) ?? [],
    );

    const actual = await inputImageUrlsFromRealWorker({ ...imageJob, entityIds: ["e0", "e1"] });

    expect(actual).toEqual([
      elementUrl(0, 0), elementUrl(1, 0),
      elementUrl(0, 1), elementUrl(0, 2), elementUrl(0, 3), elementUrl(0, 4),
      elementUrl(0, 5), elementUrl(0, 6), elementUrl(0, 7), elementUrl(0, 8),
    ]);
    // 那唯一一张属于第二个元素的图,确实在车上。
    expect(actual).toContain(elementUrl(1, 0));
  });

  it("元素图一张都到不了视频引擎 —— 所以视频卡不许报参考照数字", async () => {
    // 真相:handleGen 的 VIDEO 分支调 provider.generateVideo,它只吃 imageUrl /
    // tailImageUrl / refVideoUrl(gen.ts:636-644),inputImageUrls 根本不在参数里。
    m.referenceImageFindMany.mockImplementation(async () => refsFor(0, 17));
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });

    m.genJobFindUnique.mockResolvedValue({
      ...imageJob,
      kind: "VIDEO",
      model: "seedance-2-mini",
      entityIds: ["e0"],
      sourceGenerationId: "gen_src",
    });
    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).toHaveBeenCalledTimes(1);
    expect(m.generateVideo.mock.calls[0]![0]).not.toHaveProperty("inputImageUrls");
    // 于是卡面对视频一个参考照数字都不报（used/total 皆 0，truncated 为 false）。
    expect(referenceBudget({ kind: "video", perEntityLiveCounts: [17], hasBaseImage: true, attachedImageCount: 1 }))
      .toEqual({ used: 0, total: 0, truncated: false });
  });
});
