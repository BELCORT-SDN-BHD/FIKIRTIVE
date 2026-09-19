/**
 * derived-image-lineage —— R3-F30 的**入队那一侧**:两条派生路径各自在任务行上留下
 * 「这一单是从哪张图派生出来的」,而且那个编号只能由服务端写。
 *
 * 规格:`docs/specs/brand-product-identity.md` §5 2026-09-18 行(Founder 2026-09-18 裁
 * 「本版修,派生图继承源图记录」),承同节 2026-09-17 R3-F30 登记行。
 *
 * 分工:继承本身(worker 那一个 `entitySnapshot` 写入点真的把源图那一份写进派生行)由
 * `apps/worker/src/jobs/gen-derived-lineage-db.test.ts` 在真库上证;这个文件只证入队:
 *   · 画布 Create variations ⇒ `GenJob.sourceGenerationId` 指回源图(源图真被送进引擎当
 *     底图,所以答案已经在这一格,不另存第二遍);
 *   · Library Regenerate ⇒ 引擎手上没有那张照片、`sourceGenerationId` 是 null,谱系落在
 *     R3-F30 新增的 `GenJob.lineageGenerationId`,值 = `startAssetGen` 已按 ownerId 查过库
 *     的那个锚点;
 *   · 浏览器自带一个 `lineageGenerationId` ⇒ 整单被拒(它不是 `genRequest` 的字段),$0、
 *     零 GenJob —— 租户身份只来自服务端 principal,谱系这一格同样不收客户端说法。
 *
 * 真 Postgres(*_test)、真 Prisma、真 `startGen`;只有 web 管线周边是替身(auth guard、
 * impersonation、queue、guardian、model registry、next/cache),与
 * `asset-idempotency-ledger.test.ts` / `canvas-variation-confirm-ledger.test.ts` 同一套。
 * 零 provider 调用、零真实花费。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { startAssetGen, startCanvasGen, getActiveGenModels } = await import("../gen-actions");
const { prisma } = await import("@fikirtive/db");

const ACTIVE = await getActiveGenModels();
const PROMPT = "our pandan kaya jar on a linen table, morning light";

async function seedOrg(): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance: 1000, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Derived image lineage" } });
  return id;
}
/** 商家工作区里那张首生图 —— 带着产品记录,派生动作就锚在它身上。 */
async function seedSourceImage(ownerId: string, projectId: string): Promise<string> {
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId, ownerId, contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), ext: "jpg",
      mime: "image/jpeg", sizeBytes: BigInt(120_000), source: "GENERATED",
    },
  });
  const genId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: genId, ownerId, projectId, shotId: null, assetId, source: "GENERATED", promptText: PROMPT,
      entitySnapshot: { entities: [{ id: `ent_${randomUUID()}`, name: "Pandan kaya jar", type: "PRODUCT", variantId: null, refHashes: ["f7ca334a4006"] }] },
    },
  });
  return genId;
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}
async function jobOf(ownerId: string, id: string) {
  return prisma.genJob.findFirstOrThrow({
    where: { id, ownerId },
    select: { sourceGenerationId: true, lineageGenerationId: true, entityIds: true, idempotencyKey: true },
  });
}
function idOf(res: { id: string } | { error: string }): string {
  if ("error" in res) throw new Error(res.error);
  return res.id;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("R3-F30 —— 派生动作在任务行上记下它锚在哪张图", () => {
  it("Library Regenerate:没有引擎底图,谱系落 lineageGenerationId(值 = 服务端核过的锚点)", async () => {
    const ownerId = await seedOrg();
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedSourceImage(ownerId, projectId);

    const id = idOf(await startAssetGen({
      expectedCredits: 1,
      assetOp: "regen",
      assetAnchorGenerationId: anchor,
      assetIntentId: randomUUID(),
      projectId,
      prompt: PROMPT,
      entityIds: [],
      count: 1,
      kind: "image",
      model: ACTIVE.image,
      aspectRatio: "1:1",
    }));

    const job = await jobOf(ownerId, id);
    expect(job.idempotencyKey).toMatch(/^asset:regen:[0-9a-f]{64}$/);
    // 这条路不送底图(引擎手上没有那张照片),所以修好之前这一行的来源是**一格都没有**。
    expect(job.sourceGenerationId).toBeNull();
    expect(job.lineageGenerationId).toBe(anchor);
    // 谱系不改引用:元素那一列仍然是空的,发给引擎的图与价钱一格不动。
    expect(job.entityIds).toEqual([]);
  });

  it("画布 Create variations:来源已经是引擎底图,同一个编号不在一行里存两遍", async () => {
    const ownerId = await seedOrg();
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const source = await seedSourceImage(ownerId, projectId);

    const id = idOf(await startCanvasGen({
      actionId: `canvas-action-${randomUUID()}`,
      expectedCredits: 1,
      projectId,
      prompt: PROMPT,
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      aspectRatio: "1:1",
      sourceGenerationId: source,
    }));

    const job = await jobOf(ownerId, id);
    expect(job.sourceGenerationId).toBe(source);
    expect(job.lineageGenerationId).toBeNull(); // 「派生自哪张图」读作 sourceGenerationId ?? lineageGenerationId
    expect(job.entityIds).toEqual([]);
  });

  it("浏览器自带一个 lineageGenerationId ⇒ 整单被拒,$0、零 GenJob", async () => {
    const ownerId = await seedOrg();
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedSourceImage(ownerId, projectId);
    // 别家租户的一张图 —— 伪造面要挡的正是「客户端自己指一个谱系来源」。
    const otherOwner = await seedOrg();
    const otherProject = await seedProject(otherOwner);
    const foreign = await seedSourceImage(otherOwner, otherProject);

    const res = await startAssetGen({
      expectedCredits: 1,
      assetOp: "regen",
      assetAnchorGenerationId: anchor,
      assetIntentId: randomUUID(),
      projectId,
      prompt: PROMPT,
      entityIds: [],
      count: 1,
      kind: "image",
      model: ACTIVE.image,
      aspectRatio: "1:1",
      lineageGenerationId: foreign,
    });

    expect(res).toEqual({ error: "That generation request is out of bounds." });
    expect(await prisma.genJob.count({ where: { ownerId, projectId } })).toBe(0);
    expect(await prisma.creditLedger.count({ where: { orgId: ownerId } })).toBe(0);
  });
});
