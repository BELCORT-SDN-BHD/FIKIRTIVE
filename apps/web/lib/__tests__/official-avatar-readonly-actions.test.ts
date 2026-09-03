/**
 * **官方演员只读 —— server action 层,真库跑(CREATE-A10 只读半,Codex QA-CRE-003)**
 *
 * Founder 2026-08-30 裁决(`apps/web/design-system/information-architecture/README.md`
 * Elements 行、`core-flows.md` §11):Official avatars 由 Fikirtive 提供、**read-only**;
 * 商家可以 browse / search / preview / favorite / use,但**不能修改 identity**。
 *
 * Codex 2026-09-04 只读 E2E(`docs/audits/creation-e2e-2026-09-04.md` §4.7)在当时的主干上
 * 看到:Library → Cast → Aisyah 详情里 `Use as base`、`Add a variant` 一应俱全,填两项后
 * `Make variant · 1 credit` 就 enabled 了 —— 也就是说,只读只写在设计文档里,产品里没有。
 *
 * 这一份钉的是**最后一层**:UI 不画那些控件只是诚实,而 server action 才是围栏 —— 商家
 * 手搓一次请求、或 Otto 走它自己的 port,都会撞在同一道拒绝上。所以每一条都:
 *   ① 走真动作、真 Postgres、真 `requireOwner`(auth() 逐测可控,不绕过租户);
 *   ② 断言**钱一分没动**:ledger 零新增行、RefGenJob/GenJob 零新增行、余额与预留不变;
 *   ③ 断言拒绝发生在花钱之前 —— 上面那三个零就是「之前」的可检查形式。
 *
 * 判据一律是 `Entity.catalogKey`(域层 `packages/core/src/entity-policy.ts`),不是名字:
 * 最后一条用例专门证明商家自己建的同名 Aisyah 照旧全权可改。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// 与 entity-type-change.test.ts / cross-tenant-write.test.ts 同一套 harness:
// auth() 逐测可控、allowlist 由 env 驱动,`requireOwner` 与租户约束全是真的。
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  isImpersonating: async () => false,
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
// 写动作都会 revalidatePath,而 vitest 下没有 Next 请求上下文。
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// 开关读取与队列都不是本份要证的东西;**付费那一段(建单 + 同事务 reserve)照旧是真的**,
// 所以「零新增行」才是一句有内容的话。
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));
vi.mock("../queue", () => ({ getBoss: vi.fn(async () => ({ send: vi.fn(async () => `q-${randomUUID()}`) })) }));

const A_EMAIL = `officialA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `officialB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { OFFICIAL_CATALOG_REFUSAL } = await import("@fikirtive/core/entity-policy");
const { ACTOR_LIBRARY } = await import("@fikirtive/core/actor-library");
const {
  createVariant, deleteVariant, regenerateVariant, renameVariant, setBaseAsset,
} = await import("@/lib/refgen-actions");
const {
  addEntityAlias, removeEntityAlias, softDeleteEntity, softDeleteReferenceImage, updateEntity,
} = await import("@/lib/actions");

async function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

/**
 * 这个 org **真正播种进来的**那位官方演员(Aisyah)。
 *
 * 不自己造一行:`requireOwner` 的 org 引导会调 `seedActorLibrary(orgId)`,所以这里拿到的
 * 就是产品里商家看到的同一行 —— 同一个 `catalogKey`、同一对定妆照。播不出来就直接失败,
 * 绝不静默降级成一行自制的替身(那会让这份测试变成在证自己写的 fixture)。
 *
 * 官方演员本身**没有**变体;下面那一行 EntityVariant 是测试自己落的,唯一用途是把
 * regenerate / rename / delete 三个按 variantId 取实体的动作真的送到守卫面前。
 */
async function officialElement(ownerId: string) {
  const entity = await prisma.entity.findFirst({
    where: { ownerId, catalogKey: AISYAH_KEY, deletedAt: null },
    select: {
      id: true,
      baseAssetId: true,
      referenceImages: {
        where: { deletedAt: null, variantId: null },
        orderBy: { position: "asc" },
        select: { id: true, assetId: true },
      },
    },
  });
  if (!entity) throw new Error(`演员库没播进 ${ownerId} —— 见 apps/web/lib/actor-library-seed.ts`);
  expect(entity.referenceImages.length).toBeGreaterThanOrEqual(2);
  const variantId = `var_${randomUUID()}`;
  await prisma.entityVariant.create({
    data: {
      id: variantId, ownerId, entityId: entity.id,
      name: "Chef whites", handle: `chef-${randomUUID().slice(0, 8)}`, prompt: "in a chef jacket",
    },
  });
  return {
    entityId: entity.id,
    baseAssetId: entity.baseAssetId,
    assetIds: entity.referenceImages.map((r) => r.assetId),
    refIds: entity.referenceImages.map((r) => r.id),
    variantId,
  };
}

/** 商家自己建的一位:两张参考照 + 一个变体,`catalogKey` 为 null。 */
async function seedElement(ownerId: string, name: string, catalogKey: string | null) {
  const entityId = `ent_${randomUUID()}`;
  const assetIds: string[] = [];
  const refIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const assetId = `ast_${randomUUID()}`;
    await prisma.asset.create({
      data: {
        id: assetId, ownerId, contentHash: randomUUID().replace(/-/g, "").repeat(2),
        ext: "jpg", mime: "image/jpeg", sizeBytes: BigInt(1024),
        originalFilename: `${name}-${i}.jpg`, source: "UPLOAD",
      },
    });
    assetIds.push(assetId);
  }
  await prisma.entity.create({
    data: { id: entityId, ownerId, type: "CHARACTER", name, catalogKey, baseAssetId: assetIds[0] },
  });
  for (const [position, assetId] of assetIds.entries()) {
    const refId = `ref_${randomUUID()}`;
    await prisma.referenceImage.create({ data: { id: refId, ownerId, entityId, assetId, position } });
    refIds.push(refId);
  }
  const variantId = `var_${randomUUID()}`;
  await prisma.entityVariant.create({
    data: { id: variantId, ownerId, entityId, name: "Chef whites", handle: `chef-${randomUUID().slice(0, 8)}`, prompt: "in a chef jacket" },
  });
  return { entityId, assetIds, refIds, variantId };
}

/** 钱与作业的当前快照 —— 拒绝路径必须与它逐字相等。 */
async function moneySnapshot(orgId: string) {
  const [account, ledger, refJobs, genJobs] = await Promise.all([
    prisma.creditAccount.findUnique({ where: { orgId }, select: { balance: true, reserved: true } }),
    prisma.creditLedger.count({ where: { orgId } }),
    prisma.refGenJob.count({ where: { ownerId: orgId } }),
    prisma.genJob.count({ where: { ownerId: orgId } }),
  ]);
  return { balance: account?.balance ?? null, reserved: account?.reserved ?? null, ledger, refJobs, genJobs };
}

let orgA: string, orgB: string;
let official: Awaited<ReturnType<typeof officialElement>>;
let mine: Awaited<ReturnType<typeof seedElement>>;
let bOfficial: Awaited<ReturnType<typeof officialElement>>;

// 用真名单里的目录键,不发明一个 —— 判据认的就是这一格。
const AISYAH_KEY = ACTOR_LIBRARY[0]!.catalogKey;

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  official = await officialElement(orgA);
  mine = await seedElement(orgA, "Aisyah", null); // 与官方那位**同名**,但是商家自己的
  bOfficial = await officialElement(orgB);

  // 余额够花:否则「零新增行」可能只是没钱,不是围栏。
  await prisma.creditAccount.upsert({
    where: { orgId: orgA }, update: { balance: 10_000_000, reserved: 0 },
    create: { orgId: orgA, balance: 10_000_000, reserved: 0 },
  });
});

afterAll(async () => {
  for (const ownerId of [orgA, orgB]) {
    if (!ownerId) continue;
    await prisma.actionEvent.deleteMany({ where: { ownerId } });
    await prisma.refGenJob.deleteMany({ where: { ownerId } });
    await prisma.referenceImage.deleteMany({ where: { ownerId } });
    await prisma.entityVariant.deleteMany({ where: { ownerId } });
    await prisma.entity.deleteMany({ where: { ownerId } });
    await prisma.asset.deleteMany({ where: { ownerId } });
    await prisma.creditLedger.deleteMany({ where: { orgId: ownerId } });
  }
});

describe("CREATE-A10 官方演员只读 —— 五个 refgen 动作在花钱之前拒绝", () => {
  it("CREATE-A10: 五个动作逐一拒绝,且 ledger / RefGenJob / GenJob / 余额一格未动", async () => {
    await asUser(A_EMAIL);
    const before = await moneySnapshot(orgA);
    expect(before.balance).toBe(10_000_000);

    const results = {
      setBaseAsset: await setBaseAsset(official.entityId, official.assetIds[1]!),
      // 这两个是**付费**动作:下面就是 dispatchVariantJob(建单 + 同事务 reserve)。
      createVariant: await createVariant(official.entityId, "Red dress", "in an elegant red gown"),
      regenerateVariant: await regenerateVariant(official.variantId),
      renameVariant: await renameVariant(official.variantId, "Renamed by the merchant"),
      deleteVariant: await deleteVariant(official.variantId),
    };

    for (const [action, res] of Object.entries(results)) {
      expect(res, action).toEqual({ error: OFFICIAL_CATALOG_REFUSAL });
    }
    // 钱路的三个零 —— 「拒绝发生在 reserve / 建单之前」的可检查形式。
    expect(await moneySnapshot(orgA)).toEqual(before);
  });

  it("CREATE-A10: 被拒之后,行本身一个字节没动(定锚图、变体名、变体活着)", async () => {
    const entity = await prisma.entity.findFirst({
      where: { id: official.entityId, ownerId: orgA },
      select: { baseAssetId: true, name: true, deletedAt: true },
    });
    expect(entity).toEqual({ baseAssetId: official.baseAssetId, name: ACTOR_LIBRARY[0]!.name, deletedAt: null });
    const variant = await prisma.entityVariant.findFirst({
      where: { id: official.variantId, ownerId: orgA },
      select: { name: true, deletedAt: true },
    });
    expect(variant).toEqual({ name: "Chef whites", deletedAt: null });
  });
});

describe("CREATE-A10 官方演员只读 —— identity 那一组动作同样拒绝", () => {
  it("CREATE-A10: 改名 / 改类型 / 加别名 / 删别名 / 删参考照 / 删演员,六条全拒", async () => {
    await asUser(A_EMAIL);
    const before = await moneySnapshot(orgA);

    const results = {
      rename: await updateEntity(official.entityId, { name: "Bob" }),
      changeType: await updateEntity(official.entityId, { type: "PRODUCT" }),
      addAlias: await addEntityAlias(official.entityId, "Ash"),
      removeAlias: await removeEntityAlias(official.entityId, "Ash"),
      deleteRefImage: await softDeleteReferenceImage(official.refIds[1]!),
      deleteEntity: await softDeleteEntity(official.entityId),
    };
    for (const [action, res] of Object.entries(results)) {
      expect(res, action).toEqual({ error: OFFICIAL_CATALOG_REFUSAL });
    }

    const row = await prisma.entity.findFirst({
      where: { id: official.entityId, ownerId: orgA },
      select: { name: true, type: true, aliases: true, deletedAt: true },
    });
    expect(row).toEqual({ name: ACTOR_LIBRARY[0]!.name, type: "CHARACTER", aliases: [], deletedAt: null });
    const liveRefs = await prisma.referenceImage.count({ where: { entityId: official.entityId, ownerId: orgA, deletedAt: null } });
    expect(liveRefs).toBe(official.refIds.length);
    expect(await moneySnapshot(orgA)).toEqual(before);
  });
});

describe("CREATE-A10 官方演员只读 —— 商家自己的元素照旧全权可改", () => {
  it("CREATE-A10: 同名但 catalogKey 为 null 的元素:改名、换定锚图、建变体都走得通", async () => {
    await asUser(A_EMAIL);
    expect(await updateEntity(mine.entityId, { name: "My own Aisyah" })).toEqual({ ok: true });
    expect(await setBaseAsset(mine.entityId, mine.assetIds[1]!)).toEqual({ ok: true });

    const before = await moneySnapshot(orgA);
    const created = await createVariant(mine.entityId, "Red dress", "in an elegant red gown");
    expect(created, JSON.stringify(created)).not.toHaveProperty("error");
    const after = await moneySnapshot(orgA);
    // 商家自己的元素 —— 这一条**确实**建单并预留了,所以上面那些「零」不是因为整条路都断了。
    expect(after.refJobs).toBe(before.refJobs + 1);
    expect(after.ledger).toBeGreaterThan(before.ledger);
    expect(after.balance!).toBeLessThan(before.balance!);
  });
});

describe("CREATE-A10 官方演员只读 —— 租户约束不因这道新围栏松动", () => {
  it("CREATE-A10: 甲店拿乙店的官方演员 id,拿到的是「找不到」,不是只读提示", async () => {
    await asUser(A_EMAIL);
    // 拒绝的理由必须是租户,不是只读 —— 否则这道回答就在替乙店确认「这个 id 存在」。
    expect(await setBaseAsset(bOfficial.entityId, bOfficial.assetIds[1]!)).toEqual({ error: "Element not found." });
    expect(await createVariant(bOfficial.entityId, "X", "y")).toEqual({ error: "Element not found." });
    expect(await regenerateVariant(bOfficial.variantId)).toEqual({ error: "Variant not found." });
    expect(await renameVariant(bOfficial.variantId, "X")).toEqual({ error: "Variant not found." });
    expect(await deleteVariant(bOfficial.variantId)).toEqual({ error: "Variant not found." });
    expect(await updateEntity(bOfficial.entityId, { name: "X" })).toEqual({ error: "Entity not found." });
    expect(await softDeleteEntity(bOfficial.entityId)).toEqual({ error: "Entity not found." });

    const bRow = await prisma.entity.findFirst({
      where: { id: bOfficial.entityId, ownerId: orgB },
      select: { name: true, baseAssetId: true, deletedAt: true },
    });
    expect(bRow).toEqual({ name: ACTOR_LIBRARY[0]!.name, baseAssetId: bOfficial.baseAssetId, deletedAt: null });
  });

  it("CREATE-A10: 乙店自己去改自己的官方演员,拿到的是只读拒绝(围栏按来源,不按租户)", async () => {
    await asUser(B_EMAIL);
    expect(await setBaseAsset(bOfficial.entityId, bOfficial.assetIds[1]!)).toEqual({ error: OFFICIAL_CATALOG_REFUSAL });
    expect(await softDeleteEntity(bOfficial.entityId)).toEqual({ error: OFFICIAL_CATALOG_REFUSAL });
  });
});
