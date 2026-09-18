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
 * 为什么测在这一层:`Generation.entitySnapshot` 全产品线只有**一个**写入点
 * (`apps/worker/src/jobs/gen.ts` 那一处快照构造 + 同文件的 `tx.generation.create`),两条派生
 * 路径的差别只在它们给任务行留下的**来源那一格**:
 *   · 画布 Create variations —— 源图真被送进引擎当底图 ⇒ `GenJob.sourceGenerationId`;
 *   · Library Regenerate —— 引擎手上没有那张照片 ⇒ `GenJob.lineageGenerationId`(R3-F30 新增
 *     的纯谱系列,入队时由服务端按 ownerId 核过归属之后写)。
 * 所以这个文件用这两种**任务行形状**各跑一次真的 `handleGen`,断言库里那一行。入队那一侧
 * (哪个入口写哪一格、值从哪来)由 `apps/web/lib/__tests__/derived-image-lineage.test.ts` 证。
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
async function seedDerivedJob(shape: { sourceGenerationId?: string; lineageGenerationId?: string; entityIds?: string[] }) {
  const jobId = `gen_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: "another take of the same jar",
      kind: "IMAGE", model: "seedream", count: 1, status: "QUEUED",
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
    // 越租户的编号只能从伪造来 —— 这一格由服务端写,产线上进不来;真进来了也必须什么都拿不到。
    const jobId = await seedDerivedJob({ lineageGenerationId: foreignGenId });

    await handleGen({ genJobId: jobId }, 0);

    const { gen } = await deliveredGeneration(jobId);
    expect(gen.entitySnapshot).toEqual({ entities: [] });
  }, DB_CASE_TIMEOUT_MS);
});
