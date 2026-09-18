/**
 * gen-derived-lineage-db.test.ts —— R3-F30:**派生出来的图继承源图的商品／人物记录**,
 * 在真库上、由真的 `handleGen` 写出来的那一行上证。
 *
 * 缺口原样(staging 第三轮付费旅程第三组实证,`docs/audits/fullstack-staging-2026-09-14/`
 * `local-logs/staging-r3-paid/real-04-06-08.json` `findings[6]`):画布 Create variations 与
 * Library Regenerate 做出来的新 `Generation`,`entitySnapshot` 都是空数组 —— 而它们的源图那
 * 一行带着完整的产品与 `refHash`。一张首生图之后,「这张图用了哪个商品」在每一条派生路径上
 * 都断了一跳。Founder 2026-09-18 裁:本版修,派生图继承源图记录(规格
 * `docs/specs/brand-product-identity.md` §5 2026-09-18 行)。
 *
 * **规则如实写(复审 P2,2026-09-18)**:代码里的判据不是「变体与重生成」这两个名字,而是
 * **凡这一单自己不挂任何引用(`GenJob.entityIds` 为空)、且有谱系来源的任务,都继承来源那一
 * 行的记录**。今天真的走到这条规则的商家动作有五个,一个都不特殊:
 *   · 画布 Create variations —— 源图真被送进引擎当底图 ⇒ `GenJob.sourceGenerationId`;
 *   · Library Regenerate —— 引擎手上没有那张照片 ⇒ `GenJob.lineageGenerationId`(R3-F30 新增
 *     的纯谱系列,入队时由服务端按 ownerId 核过归属之后写);
 *   · Library「Edit this image」—— `components/asset/DetailPanel.tsx` 的 `editIds` 起手就是
 *     空数组,而 `sourceGenerationId` 恒等于商家正在看的那张图 ⇒ 与变体同一种任务行形状;
 *   · 模板跑一次(`components/otto/TemplateModal.tsx` 的 `startTemplateJob`,同样只带
 *     `sourceGenerationId`、不带元素)⇒ 同上;
 *   · Animate(图生视频)⇒ `kind=VIDEO` + `sourceGenerationId`;快照那一格由 `gen.ts` 提到
 *     image / video 两个分支**之前**算,两个分支共用同一份,所以视频那一跳同样继承。
 * 所以下面**逐条路径各跑一次真的 `handleGen`**,断言库里那一行。前四条在 worker 眼里落到的
 * 任务行形状其实只有两种(带不带引擎底图),用例仍按商家动作分开写:这份文件要回答的是
 * 「商家按下哪一颗按钮之后记录还在」,不是「代码里有几个分支」。入队那一侧(哪个入口写哪一
 * 格、值从哪来)由 `apps/web/lib/__tests__/derived-image-lineage.test.ts` 证。
 *
 * 为什么测在这一层:**付费产出**这条路上,`Generation.entitySnapshot` 只有一个写入点
 * (`apps/worker/src/jobs/gen.ts` 那一处快照构造 + 同文件 `tx.generation.create`),上面五条
 * 派生路径全部从那里出图。全仓另外三处也写这一格,都不在派生路上,如实列出(复审 P3):
 *   · `apps/web/lib/upload-actions.ts:394` —— 上传落库,快照按商家**这一次上传时挂的元素**
 *     现建(`buildEntitySnapshot`),没有来源可继承;
 *   · `apps/web/lib/actions.ts:981` —— 画布里直接塞一张图进来,写死 `{entities: []}`;
 *   · `apps/web/lib/asset-actions.ts:325`(`saveCroppedGeneration`)—— 裁剪,同样写死
 *     `{entities: []}`。裁剪其实也是一种派生(裁一张商品图,记录一样会丢),但它不经任何付费
 *     任务、没有 `GenJob`、没有 `entityIds` 可判,不在本票判据里 —— 登记在这里,不顺手改。
 *
 * 只 mock 付费引擎与对象存储(与 `gen-receipt-db.test.ts` 同一套);库、钱、事务全是真的。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  submitVideo: vi.fn(),
  pollVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, submitVideo: m.submitVideo, pollVideo: m.pollVideo } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { prisma, reserveCredits } from "@fikirtive/db";
import { handleGen } from "./gen.js";

// 与其它真库用例同一道守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000;

let orgId: string;
let projectId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));
  m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);

  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: 100_000, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Derived image lineage" } });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 一件真的产品身份 —— 继承来的那一格里写的就是它的 id。 */
async function seedProduct(ownerId: string, name: string): Promise<string> {
  const id = `ent_${randomUUID()}`;
  await prisma.entity.create({ data: { id, ownerId, type: "PRODUCT", name } });
  return id;
}

/** 商家工作区里那张**首生图**:带着完整的产品记录与 refHash,正是派生图今天丢掉的那一份。 */
async function seedSourceImage(entityId: string) {
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId, ownerId: orgId, contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), ext: "jpg",
      mime: "image/jpeg", sizeBytes: BigInt(120_000), source: "GENERATED",
    },
  });
  const id = `gen_${randomUUID()}`;
  const entitySnapshot = {
    entities: [{ id: entityId, name: "Pandan kaya jar", type: "PRODUCT", variantId: null, refHashes: ["f7ca334a4006"] }],
  };
  await prisma.generation.create({
    data: {
      id, ownerId: orgId, projectId, shotId: null,
      assetId, source: "GENERATED", promptText: "our pandan kaya jar on a linen table",
      entitySnapshot,
    },
  });
  return { id, entitySnapshot };
}

/** 一张派生任务行 + 真的预扣。`shape` 决定它长得像哪一条派生路径。 */
async function seedDerivedJob(shape: {
  sourceGenerationId?: string;
  lineageGenerationId?: string;
  entityIds?: string[];
  /** 商家在那一条路上真正打的字 —— 只为让每条用例读起来是它自己那个动作。 */
  prompt?: string;
  /** Animate 那一条:同一条继承规则,`kind=VIDEO` 的任务行。 */
  video?: boolean;
}) {
  const jobId = `gen_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: shape.prompt ?? "another take of the same jar",
      kind: shape.video ? "VIDEO" : "IMAGE",
      model: shape.video ? "seedance-2-mini" : "seedream",
      count: 1, status: "QUEUED",
      ...(shape.video ? { videoOptions: { seconds: 5, resolution: "480p" } } : {}),
      sourceGenerationId: shape.sourceGenerationId ?? null,
      lineageGenerationId: shape.lineageGenerationId ?? null,
      entityIds: shape.entityIds ?? [],
    },
  });
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
  return jobId;
}

/** 这一单真正交付出来的那一行(worker 自己记下的 `generationIds`,不是测试猜的)。 */
async function deliveredGeneration(jobId: string) {
  const job = await prisma.genJob.findFirstOrThrow({
    where: { id: jobId, ownerId: orgId },
    select: { status: true, generationIds: true, entityIds: true, approvedEntities: true },
  });
  expect(job.status).toBe("DONE");
  expect(job.generationIds).toHaveLength(1);
  const gen = await prisma.generation.findFirstOrThrow({
    where: { id: job.generationIds[0]!, ownerId: orgId },
    select: { entitySnapshot: true },
  });
  return { job, gen };
}

/**
 * 复审 P3(2026-09-18)—— **这一族用例证的是结果,不是那一行 where 的写法。**
 *
 * 租户闸门的真身是 `handleGen` 外面那一层 `runAsTenant(job.ownerId)` 帧 + Prisma 的
 * tenant guard(`packages/db/src/tenant-guard.ts`:`ownerId` 一族恒在 enforce 挡位,帧里的
 * 租户号会被**就地注进**每一条 where)。`gen.ts` 继承那一读上写着的 `ownerId: job.ownerId`
 * 因此是**双保险**,不是唯一的闸:2026-09-18 亲手删掉那一格跑过一遍 —— 本文件七条全绿。
 *
 * 如实写在这里,而不是让那条用例冒充成「这个过滤条件的证据」。真要钉住那个过滤条件,得把
 * 这一读搬到帧外面去跑,那是另一件事(而且会拆掉 worker 自己的租户纪律),不做。
 */
describe("R3-F30 派生图继承源图的商品／人物记录(真库,真 handleGen)", () => {
  it("画布 Create variations:派生图的 entitySnapshot 逐字等于源图的,钱路一格不动", async () => {
    const entityId = await seedProduct(orgId, "Pandan kaya jar");
    const source = await seedSourceImage(entityId);
    const jobId = await seedDerivedJob({ sourceGenerationId: source.id });

    await handleGen({ genJobId: jobId }, 0);

    const { job, gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual(source.entitySnapshot);
    // 继承的是**记录**,不是引用:这一单自己一个元素都没挂,所以任务行那两格保持原样 ——
    // 把 id 塞进 entityIds 会真的改变发给引擎的图与它的价钱,那是另一件事,不是谱系。
    expect(job.entityIds).toEqual([]);
    expect(job.approvedEntities).toBeNull();
    const ledger = await prisma.creditLedger.findMany({ where: { orgId, refId: jobId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);

  it("Library Regenerate:没有引擎底图,靠 lineageGenerationId 也继承到同一份记录", async () => {
    const entityId = await seedProduct(orgId, "Pandan kaya jar");
    const source = await seedSourceImage(entityId);
    // 这条路引擎手上没有那张照片,所以任务行的 sourceGenerationId 是 null —— 与产线一致。
    const jobId = await seedDerivedJob({ lineageGenerationId: source.id });

    await handleGen({ genJobId: jobId }, 0);

    const { job, gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual(source.entitySnapshot);
    expect(job.entityIds).toEqual([]);
    expect(job.approvedEntities).toBeNull();
    // 送给引擎的那一趟一张图都没有 —— 继承只碰记录,不碰引擎输入。
    expect((m.generateImages.mock.calls[0]![0] as { inputImageUrls: string[] }).inputImageUrls).toEqual([]);
  }, DB_CASE_TIMEOUT_MS);

  /* ── 复审 P2 —— 规则不只落在「变体与重生成」两条路上,下面三条同样吃到它 ──────────── */

  it("Library「Edit this image」:编辑框里一个元素都没挂 ⇒ 同样继承源图那一份记录", async () => {
    const entityId = await seedProduct(orgId, "Pandan kaya jar");
    const source = await seedSourceImage(entityId);
    // 详情面板那条路:`editIds` 起手是空数组(商家不另外 @ 东西就一直是空),
    // `sourceGenerationId` 恒等于他正在看的那张图 —— 所以任务行与变体同形。
    const jobId = await seedDerivedJob({
      sourceGenerationId: source.id,
      prompt: "make the label a bit bigger and keep the linen table",
    });

    await handleGen({ genJobId: jobId }, 0);

    const { job, gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual(source.entitySnapshot);
    expect(job.entityIds).toEqual([]);
    // 与 Regenerate 那一条的差别在这里、也只在这里:编辑**真的**把底图送进了引擎,
    // 继承照样发生 —— 判据是「自己没挂引用」,不是「有没有送图」。
    expect((m.generateImages.mock.calls[0]![0] as { inputImageUrls: string[] }).inputImageUrls).toHaveLength(1);
  }, DB_CASE_TIMEOUT_MS);

  it("模板跑一次:模板自己不挂元素 ⇒ 出来的图仍记得这是哪件商品", async () => {
    const entityId = await seedProduct(orgId, "Pandan kaya jar");
    const source = await seedSourceImage(entityId);
    // `TemplateModal` 的 `startTemplateJob` 只带 `sourceGenerationId` 与模板拼出来的提示词,
    // 从不带 `entityIds` —— 所以商家用模板做出来的图从前也是一张没有记录的图。
    const jobId = await seedDerivedJob({
      sourceGenerationId: source.id,
      prompt: "marketplace main image: product centred on a clean white background",
    });

    await handleGen({ genJobId: jobId }, 0);

    const { job, gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual(source.entitySnapshot);
    expect(job.entityIds).toEqual([]);
  }, DB_CASE_TIMEOUT_MS);

  it("Animate(图生视频):同一条规则跨过 image→video 那一跳,片子也带着源图的记录", async () => {
    const entityId = await seedProduct(orgId, "Pandan kaya jar");
    const source = await seedSourceImage(entityId);
    const jobId = await seedDerivedJob({ sourceGenerationId: source.id, video: true, prompt: "slow push in on the jar" });

    // 视频是两趟投递:先提交、放开 worker 槽位,下一趟才轮询到成片(#1435 零排队)。
    m.submitVideo.mockResolvedValue({ providerTaskId: `task-${randomUUID()}` });
    const submitted = await handleGen({ genJobId: jobId }, 0);
    expect(submitted).toMatchObject({ awaitingVideoPoll: true });
    m.pollVideo.mockResolvedValue({ status: "succeeded", video: { bytes: new Uint8Array([9]), ext: "mp4" } });
    await handleGen({ genJobId: jobId }, 0);

    const { job, gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual(source.entitySnapshot);
    expect(job.entityIds).toEqual([]);
    const ledger = await prisma.creditLedger.findMany({ where: { orgId, refId: jobId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);

  it("派生时自己换了引用:快照跟着新引用走,一个字都不从源图借", async () => {
    const oldProduct = await seedProduct(orgId, "Pandan kaya jar");
    const newProduct = await seedProduct(orgId, "Gula melaka syrup");
    const source = await seedSourceImage(oldProduct);
    const jobId = await seedDerivedJob({ sourceGenerationId: source.id, entityIds: [newProduct] });

    await handleGen({ genJobId: jobId }, 0);

    const { gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual({
      entities: [{ id: newProduct, name: "Gula melaka syrup", type: "PRODUCT", variantId: null, refHashes: [] }],
    });
  }, DB_CASE_TIMEOUT_MS);

  it("源图是别家租户的:什么都继承不到,派生图照旧落空数组", async () => {
    const otherOrg = `org_${randomUUID()}`;
    await prisma.organization.create({ data: { id: otherOrg } });
    const otherProject = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: otherProject, ownerId: otherOrg, name: "Someone else's shop" } });
    const otherEntity = await seedProduct(otherOrg, "Someone else's jar");
    const assetId = `ast_${randomUUID()}`;
    await prisma.asset.create({
      data: {
        id: assetId, ownerId: otherOrg, contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), ext: "jpg",
        mime: "image/jpeg", sizeBytes: BigInt(120_000), source: "GENERATED",
      },
    });
    const foreignGenId = `gen_${randomUUID()}`;
    await prisma.generation.create({
      data: {
        id: foreignGenId, ownerId: otherOrg, projectId: otherProject, shotId: null, assetId,
        source: "GENERATED", promptText: "not this shop's picture",
        entitySnapshot: { entities: [{ id: otherEntity, name: "Someone else's jar", type: "PRODUCT", variantId: null, refHashes: ["deadbeef"] }] },
      },
    });
    // 那一行**确实**装着一份继承得动的记录 —— 先钉住这一点,下面的空数组才只可能是租户闸
    // 挡下来的,而不是「源图本来就没东西可继承」这个软绵绵的理由。
    const foreign = await prisma.generation.findFirstOrThrow({
      where: { id: foreignGenId, ownerId: otherOrg },
      select: { entitySnapshot: true },
    });
    expect((foreign.entitySnapshot as { entities: unknown[] }).entities).toHaveLength(1);
    // 越租户的编号只能从伪造来 —— 这一格由服务端写,产线上进不来;真进来了也必须什么都拿不到。
    const jobId = await seedDerivedJob({ lineageGenerationId: foreignGenId });

    await handleGen({ genJobId: jobId }, 0);

    const { gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual({ entities: [] });
  }, DB_CASE_TIMEOUT_MS);
});
