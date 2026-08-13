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
 * 真相出处(`apps/worker/src/jobs/gen.ts`):
 *   元素参考照 round-robin,聚合上限 = `conditioningCap(...)`(core 与 worker 共用的
 *     那一个函数;image 恒为 MAX_CONDITIONING_IMAGES=10);
 *   image 分支把编辑底图 unshift 到第 0 位 —— **在上限之外再加一张**。
 *
 * worker 的选片规则一旦漂移(改上限、改成先放底图再截断、改 round-robin 为顺序装满),
 * 这里当场红,逼着 core 里那份副本跟着改,卡面于是自动开始说新话。
 *
 * #785 起,文件下半段把同一道闸装到了**视频**那一侧 —— 元素参考照不再是「算了就丢」,
 * 它们真的进视频引擎,于是「说的张数 = 送的张数 = 送的次序」也必须钉住。
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
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { referenceBudget, MAX_CONDITIONING_IMAGES, MAX_VIDEO_IMAGE_PARTS } from "@fikirtive/core";
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
function expectedRoundRobinUrls(perEntityLiveCounts: number[], cap = MAX_CONDITIONING_IMAGES): string[] {
  const picked: string[] = [];
  for (let round = 0; picked.length < cap; round++) {
    let progressed = false;
    for (let e = 0; e < perEntityLiveCounts.length; e++) {
      if (round >= perEntityLiveCounts[e]!) continue;
      picked.push(elementUrl(e, round));
      progressed = true;
      if (picked.length >= cap) break;
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

});

// ---------------------------------------------------------------------------
// #785 —— 视频侧的同一道等价闸。
//
// 在这一票之前,`inputImageUrls` 对 VIDEO 分支是**算了就丢**:商家 @ 的产品图与代言人
// 一张都到不了视频引擎,卡面也就干脆一个数字都不报。现在它们真的上车了,所以同一条纪律
// 必须跟过来 —— 卡面说的张数、worker 真送的张数、送出去的次序,三者由**同一条规则**派生
// (`conditioningCap` 是 core 与 worker 共用的那一处),并在这里拿真 `handleGen` 对表。
//
// 场景判据(`videoReferencesRide`):首帧 / 首+末帧 / 整段参考视频是引擎的三个互斥场景,
// 那三档一张元素照都不带;纯文生视频才带,名额 = MAX_VIDEO_IMAGE_PARTS(9)。
// ---------------------------------------------------------------------------
describe("#785 —— 视频卡说的张数 = worker 真正发给视频引擎的参考照", () => {
  const videoJob = { ...imageJob, kind: "VIDEO", model: "seedance-2-mini" };

  /** 真跑一次 handleGen,交回 provider.generateVideo 真正收到的 refImageUrls。 */
  async function refImageUrlsFromRealWorker(job: Record<string, unknown>): Promise<string[]> {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
    m.genJobFindUnique.mockResolvedValue(job);
    await handleGen({ genJobId: "g1" }, 0);
    expect(m.generateVideo, "the paid call must have happened for this case to mean anything").toHaveBeenCalledTimes(1);
    return (m.generateVideo.mock.calls[0]![0].refImageUrls as string[] | undefined) ?? [];
  }

  function mockRefs(perEntityLiveCounts: number[]): string[] {
    const entityIds = perEntityLiveCounts.map((_, i) => `e${i}`);
    const byEntity = new Map(entityIds.map((id, i) => [id, refsFor(i, perEntityLiveCounts[i]!)]));
    m.referenceImageFindMany.mockImplementation(async ({ where }: { where: { entityId: string } }) =>
      byEntity.get(where.entityId) ?? [],
    );
    return entityIds;
  }

  it.each([
    // [名字, 每个元素的活图数]
    ["零元素", []],
    ["两个元素,远未到名额", [3, 3]],
    ["刚好压线(= 9 个 image_url 名额)", [5, 4]],
    ["超限 17 → 9", [9, 8]],
    ["一个元素独占很多图,另一个只有一张(round-robin 不许饿死后者)", [20, 1]],
  ])("纯文生视频:%s", async (_label, perEntityLiveCounts) => {
    const entityIds = mockRefs(perEntityLiveCounts);
    const actual = await refImageUrlsFromRealWorker({ ...videoJob, entityIds });

    const predicted = referenceBudget({ kind: "video", perEntityLiveCounts, hasBaseImage: false, attachedImageCount: 0 });

    // ① 实发集与次序逐张对表 —— 次序就是编号,一张都不许变、不许重排。
    expect(actual).toEqual(expectedRoundRobinUrls(perEntityLiveCounts, MAX_VIDEO_IMAGE_PARTS));
    // ② 卡面说的张数 = 引擎真收到的张数。
    expect(actual.length).toBe(predicted.used);
    // ③ 商家一共给了几张,也不许说错。
    const elementTotal = perEntityLiveCounts.reduce((s, n) => s + n, 0);
    expect(predicted.total).toBe(elementTotal);
    // ④ 截断这件事本身也不许说错。
    expect(predicted.truncated).toBe(Math.min(elementTotal, MAX_VIDEO_IMAGE_PARTS) < elementTotal);
  });

  it.each([
    ["首帧(i2v)", { sourceGenerationId: "gen_src" }],
    ["首+末帧", { sourceGenerationId: "gen_src", tailGenerationId: "gen_tail" }],
    ["整段参考视频", { referenceVideoGenerationId: "gen_vid" }],
  ])("%s 这一档一张元素照都不发 —— 而且卡面照实说 0", async (_label, shape) => {
    const entityIds = mockRefs([17]);
    // 整段参考视频那一档:worker 会去解析它,并按 Asset.durationS 复核窗口。
    m.generationFindFirst.mockResolvedValue({
      id: "gen_x",
      asset: { ownerId: "o1", contentHash: BASE_HASH, ext: "referenceVideoGenerationId" in shape ? "mp4" : "png", durationS: 5 },
    });

    const actual = await refImageUrlsFromRealWorker({ ...videoJob, entityIds, ...shape });

    expect(actual).toEqual([]);
    const predicted = referenceBudget({
      kind: "video",
      perEntityLiveCounts: [17],
      hasBaseImage: false,
      attachedImageCount: 0,
      hasVideoStartFrame: "sourceGenerationId" in shape,
      hasVideoTailFrame: "tailGenerationId" in shape,
      hasReferenceVideo: "referenceVideoGenerationId" in shape,
    });
    expect(predicted).toEqual({ used: 0, total: 17, truncated: true });
  });

  it("没有 @元素时,发给视频引擎的请求里根本没有 refImageUrls 这个字段(旧行为逐字不变)", async () => {
    m.referenceImageFindMany.mockImplementation(async () => []);
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
    m.genJobFindUnique.mockResolvedValue({ ...videoJob, entityIds: [] });
    await handleGen({ genJobId: "g1" }, 0);
    expect(m.generateVideo.mock.calls[0]![0]).not.toHaveProperty("refImageUrls");
  });
});
