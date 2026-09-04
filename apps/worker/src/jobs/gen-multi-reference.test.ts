/**
 * gen-multi-reference.test.ts —— 商家挂了几张,引擎就真收到几张(Codex staging 走查
 * CRE-STG-P1-003,2026-09-04)。
 *
 * 规格 `docs/specs/creation-engine.md`,验收 **CREATE-A1**(花钱前看得见:卡上说的张数
 * 必须等于引擎真收到的张数)与 **CREATE-A2**(素材指派:哪一件坐哪一格)。
 *
 * ── 走查那一轮 ────────────────────────────────────────────────────────────
 * composer 上两个芯片(人物 + 产品),Otto 说两张都收到了,而确认卡只列得出一件,付费
 * 请求里也只有一件 —— 第二张在铸卡那一步无声消失。web 侧的对表在
 * `apps/web/lib/__tests__/creation-multi-reference-card.test.ts`;这一份钉的是**另一端**:
 * 任务落到 worker 之后,`provider.generate` 真正收到的 `inputImageUrls` 是不是那几张、
 * 次序对不对。两端各钉一半,中间那段(卡 → GenJob)才不会有人偷偷改成别的。
 *
 * 与 `gen-reference-budget.test.ts` 同一条纪律,也共用它的写法:不断言手抄的期望值,
 * 而是**跑真的 `handleGen`**,拿它交给 provider 的那一个数组对表。
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

import { referenceBudget, MAX_CONDITIONING_IMAGES, cardReferenceRoleLabel } from "@fikirtive/core";
import { handleGen } from "./gen.js";

/** content hash 必须是 64 位小写 hex(storageKey 会校验)。 */
const hashOf = (seed: number) => seed.toString(16).padStart(64, "0");
/** presignedGet 替身返回 `url:<storageKey>`,所以每张图有一个可辨认的 URL。 */
const urlOf = (contentHash: string) => `url:u/o1/${contentHash}.png`;

/** 商家挂的第 n 张图(0 = 编辑底图 = `<Image_1>`)。 */
const ATTACHED = [0, 1, 2].map((i) => ({ id: `gen_att${i}`, hash: hashOf(900 + i) }));
const attachedUrl = (i: number) => urlOf(ATTACHED[i]!.hash);

/** 某个元素的第 `refIndex` 张活参考照。 */
const elementHash = (entityIndex: number, refIndex: number) => hashOf((entityIndex + 1) * 1000 + refIndex);
const elementUrl = (entityIndex: number, refIndex: number) => urlOf(elementHash(entityIndex, refIndex));
const refsFor = (entityIndex: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ asset: { ownerId: "o1", contentHash: elementHash(entityIndex, i), ext: "png" } }));

const imageJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: null,
  shotId: null,
  status: "QUEUED",
  kind: "IMAGE",
  model: "seedream",
  prompt: "put my tumbler in her hands",
  entityIds: [] as string[],
  variantSel: null as Record<string, string> | null,
  count: 1,
  videoOptions: null,
  imageOptions: null as unknown,
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
  m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.entityFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, type: "PRODUCT", name: `LIVE-${where.id}` }));
  m.entityVariantFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  m.referenceImageFindMany.mockResolvedValue([]);
  // 挂图逐个解析 —— **每一个 id 一张不同的图**,所以「第几张是谁」看得出来。
  m.generationFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const hit = ATTACHED.find((a) => a.id === where.id);
    return hit ? { id: hit.id, asset: { ownerId: "o1", contentHash: hit.hash, ext: "png" } } : null;
  });
});

/** 真跑一次 handleGen,交回 provider 真正收到的那一整个参数。 */
async function paidImageCall(job: Record<string, unknown>): Promise<{ inputImageUrls: string[]; prompt: string }> {
  m.genJobFindUnique.mockResolvedValue(job);
  await handleGen({ genJobId: "g1" }, 0);
  expect(m.generateImages, "the paid call must have happened for this case to mean anything").toHaveBeenCalledTimes(1);
  return m.generateImages.mock.calls[0]![0] as { inputImageUrls: string[]; prompt: string };
}

describe("CREATE-A1 商家挂了几张,引擎就收到几张(CRE-STG-P1-003)", () => {
  it("CREATE-A1 两张挂图都上车,次序 = 商家挂的次序", async () => {
    const call = await paidImageCall({
      ...imageJob,
      sourceGenerationId: ATTACHED[0]!.id,
      imageOptions: { aspectRatio: "9:16", referenceGenerationIds: [ATTACHED[1]!.id] },
    });

    // 走查那一天这里只有一张 —— 第二张(人物)在铸卡那一步就没了。
    expect(call.inputImageUrls).toEqual([attachedUrl(0), attachedUrl(1)]);
  });

  it("CREATE-A2 挂图排在 @元素之前:第 0 位仍是编辑底图,也就是 <Image_1>", async () => {
    m.referenceImageFindMany.mockImplementation(async ({ where }: { where: { entityId: string } }) =>
      where.entityId === "e0" ? refsFor(0, 2) : [],
    );

    const call = await paidImageCall({
      ...imageJob,
      entityIds: ["e0"],
      sourceGenerationId: ATTACHED[0]!.id,
      imageOptions: { aspectRatio: "1:1", referenceGenerationIds: [ATTACHED[1]!.id, ATTACHED[2]!.id] },
    });

    expect(call.inputImageUrls).toEqual([
      attachedUrl(0), attachedUrl(1), attachedUrl(2),
      elementUrl(0, 0), elementUrl(0, 1),
    ]);
    // 编号句说的第 1 张,就是商家挂的第一张 —— `<Image_1>` 不许指向别人。
    expect(call.prompt.split("\n")[0]).toContain("<Image_1>");
  });

  it("CREATE-A2 编号句说的角色 = 卡上写的角色:第一张在编辑,第 2 张起是参考", async () => {
    const call = await paidImageCall({
      ...imageJob,
      sourceGenerationId: ATTACHED[0]!.id,
      imageOptions: { aspectRatio: "9:16", referenceGenerationIds: [ATTACHED[1]!.id] },
    });

    const lines = call.prompt.split("\n")[0]!;
    // 卡上第一条回执写 `Base image`,给引擎的第一句就得是「在编辑它」。
    expect(cardReferenceRoleLabel("baseImage")).toBe("Base image");
    expect(lines).toContain("<Image_1> is the image being edited.");
    // 卡上第二条回执写 `Reference` —— 那么引擎收到的第二句**不许**也说「在编辑它」。
    // 说成编辑就是同一件事在卡面与付费请求里各说一套(CRE-STG-P1-003 修的正是这类分家)。
    expect(cardReferenceRoleLabel("reference")).toBe("Reference");
    expect(lines).toContain("<Image_2> is a reference image.");
    expect(lines).not.toContain("<Image_2> is the image being edited.");
  });

  it("CREATE-A1 挂 1 张:编号句与这条修改之前逐字相同(只有底图那一句)", async () => {
    const call = await paidImageCall({
      ...imageJob,
      sourceGenerationId: ATTACHED[0]!.id,
      imageOptions: { aspectRatio: "9:16" },
    });
    expect(call.prompt.split("\n")[0]).toBe("<Image_1> is the image being edited.");
  });

  it("CREATE-A1 卡面说的张数 = 引擎真收到的张数(超限时挂图从 @元素的名额里扣格)", async () => {
    // 一个元素有 9 张活图,商家又挂了 3 张:总数不许超过引擎的输入上限。
    m.referenceImageFindMany.mockImplementation(async ({ where }: { where: { entityId: string } }) =>
      where.entityId === "e0" ? refsFor(0, 9) : [],
    );

    const call = await paidImageCall({
      ...imageJob,
      entityIds: ["e0"],
      sourceGenerationId: ATTACHED[0]!.id,
      imageOptions: { aspectRatio: "1:1", referenceGenerationIds: [ATTACHED[1]!.id, ATTACHED[2]!.id] },
    });

    const predicted = referenceBudget({
      kind: "image",
      perEntityLiveCounts: [9],
      hasBaseImage: true,
      attachedImageCount: 3,
    });
    expect(call.inputImageUrls.length).toBe(predicted.used);
    // 天花板没有被悄悄放宽:仍是「上限张 @元素照 + 第一张挂图」。
    expect(call.inputImageUrls.length).toBeLessThanOrEqual(MAX_CONDITIONING_IMAGES + 1);
    // 三张挂图全在车上,被截掉的是 @元素那一侧(卡面照实说 truncated)。
    expect(call.inputImageUrls.slice(0, 3)).toEqual([attachedUrl(0), attachedUrl(1), attachedUrl(2)]);
    expect(predicted.truncated).toBe(true);
  });

  it("CREATE-A2 挂图里有一张取不到:整单 fail-closed 退款,一张都不发", async () => {
    m.generationFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === ATTACHED[0]!.id
        ? { id: ATTACHED[0]!.id, asset: { ownerId: "o1", contentHash: ATTACHED[0]!.hash, ext: "png" } }
        : null,
    );

    m.genJobFindUnique.mockResolvedValue({
      ...imageJob,
      sourceGenerationId: ATTACHED[0]!.id,
      imageOptions: { aspectRatio: "1:1", referenceGenerationIds: [ATTACHED[1]!.id] },
    });
    await handleGen({ genJobId: "g1" }, 0);

    // 商家批的是两张参考,发一张就是交付另一样东西 —— 所以付费调用根本没发生。
    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalled();
  });

  it("CREATE-A1 挂 0/1 张的既有任务:行为与这条修改之前逐字相同", async () => {
    m.referenceImageFindMany.mockImplementation(async ({ where }: { where: { entityId: string } }) =>
      where.entityId === "e0" ? refsFor(0, 2) : [],
    );

    // 老行连 imageOptions 都没有(迁移前),仍然只送底图 + 元素照。
    const call = await paidImageCall({
      ...imageJob,
      entityIds: ["e0"],
      sourceGenerationId: ATTACHED[0]!.id,
      imageOptions: null,
    });

    expect(call.inputImageUrls).toEqual([attachedUrl(0), elementUrl(0, 0), elementUrl(0, 1)]);
  });
});
