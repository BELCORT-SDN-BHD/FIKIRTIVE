/**
 * PRODID-A4 / PRODID-A9 —— 「挂上第一张参考图就自动成为封面」这条规则本身
 * (规格 `docs/specs/brand-product-identity.md` §5;Founder 2026-09-15 裁决)。
 *
 * ── 裁决(原话) ────────────────────────────────────────────────────────────
 * 「未钉封面时的显示规则:挂上第一张参考图时自动设为封面并写回 `Entity.baseAssetId`,商家随时
 *   可换;存量数据一次补齐迁移;Library 与 Brand 从此同一张图。」
 *
 * 这份文件盯两样东西,它们是那句裁决的两半:
 *   ① 写路 `reconcileEntityCover` —— 从今往后挂上的图。
 *   ② 回填迁移 20260915120000_entity_cover_autopin —— 裁决之前就挂着的存量图。**原样读那份
 *      SQL 文件执行**(与 `brand-product-identity-backfill.test.ts` 同一手法):改了 SQL 而
 *      没改这里,这里就红。
 *
 * 读路那一半(Library 与 Brand 画出来是不是同一张)在
 * `apps/web/lib/__tests__/library-brand-cover-parity.test.ts` —— 那边有真的读模型函数。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { prisma } from "../index.js";
import { reconcileEntityCover } from "../entity-cover.js";
import { createProduct, updateProductRecord } from "../create-product.js";
import { seedOrg } from "../../test/setup.js";

const MIGRATION_SQL = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../prisma/migrations/20260915120000_entity_cover_autopin/migration.sql",
  ),
  "utf8",
);

/** 整份迁移一次送进去:它是多语句 ＋ 显式 BEGIN/COMMIT,`$executeRawUnsafe` 送不了。 */
async function runMigration(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(MIGRATION_SQL);
  } finally {
    await client.end();
  }
}

let orgId: string;

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
});

/** 一条真的 Asset 行(内容寻址唯一,所以每次调用都换一个 hash)。 */
async function seedAsset(ownerId = orgId): Promise<string> {
  const asset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId,
      contentHash: randomUUID().replace(/-/g, "").repeat(2),
      ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD",
    },
  });
  return asset.id;
}

/** 一条**没有封面**的身份 —— 裁决之前那种形状。 */
async function seedEntity(ownerId = orgId): Promise<string> {
  const id = `ent_${randomUUID()}`;
  await prisma.entity.create({
    data: { id, ownerId, type: "PRODUCT", name: `P ${randomUUID().slice(0, 8)}`, baseAssetId: null },
  });
  return id;
}

/** 挂一张基础层参考图(不钉封面)—— 回填要修的就是这种行。 */
async function attachRef(
  entityId: string,
  assetId: string,
  position: number,
  opts: { ownerId?: string; variantId?: string | null; deletedAt?: Date } = {},
): Promise<string> {
  const id = `ri_${randomUUID()}`;
  await prisma.referenceImage.create({
    data: {
      id, ownerId: opts.ownerId ?? orgId, entityId, assetId, position,
      variantId: opts.variantId ?? null,
      ...(opts.deletedAt ? { deletedAt: opts.deletedAt } : {}),
    },
  });
  return id;
}

async function coverOf(entityId: string, ownerId = orgId): Promise<string | null> {
  // `ownerId` 少不得:tenant-guard 拒绝任何没有租户过滤的读(它正是 PRODID-A9 的守门人)。
  const row = await prisma.entity.findFirstOrThrow({
    where: { id: entityId, ownerId }, select: { baseAssetId: true },
  });
  return row.baseAssetId;
}

describe("PRODID-A4 挂上第一张参考图就自动成为封面(reconcileEntityCover)", () => {
  it("PRODID-A4 挂上第一张图 ⇒ 它就是封面,并写回 Entity.baseAssetId", async () => {
    const entityId = await seedEntity();
    const first = await seedAsset();
    expect(await coverOf(entityId)).toBeNull();

    await attachRef(entityId, first, 0);
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(first);

    // 裁决的正面:写**回库里**,不是读的时候现算一张。
    expect(await coverOf(entityId)).toBe(first);
  }, 60_000);

  it("PRODID-A4 再挂第二张 ⇒ 封面一个字不动(不会把商家看惯的那张换掉)", async () => {
    const entityId = await seedEntity();
    const first = await seedAsset();
    await attachRef(entityId, first, 0);
    await reconcileEntityCover(prisma, { ownerId: orgId, entityId });

    const second = await seedAsset();
    await attachRef(entityId, second, 1);
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(first);
    expect(await coverOf(entityId)).toBe(first);
  }, 60_000);

  it("PRODID-A4 商家亲手换封面之后,再挂图也盖不掉它(「商家随时可换」)", async () => {
    const entityId = await seedEntity();
    const first = await seedAsset();
    const second = await seedAsset();
    await attachRef(entityId, first, 0);
    await attachRef(entityId, second, 1);
    await reconcileEntityCover(prisma, { ownerId: orgId, entityId });
    expect(await coverOf(entityId)).toBe(first);

    // 商家在 Library 把封面挑成第二张(逐字复刻 setBaseAsset:图先在,再把 baseAssetId 指过去)。
    await prisma.entity.updateMany({ where: { id: entityId, ownerId: orgId }, data: { baseAssetId: second } });

    const third = await seedAsset();
    await attachRef(entityId, third, 2);
    // 这一句是整条规则最要命的一格:自动钉封面**绝不许**回头盖掉商家自己挑的那张。
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(second);
    expect(await coverOf(entityId)).toBe(second);
  }, 60_000);

  it("PRODID-A4 拔掉当封面的那一张 ⇒ 落到下一张;拔光了才是 null", async () => {
    const entityId = await seedEntity();
    const first = await seedAsset();
    const second = await seedAsset();
    const firstRef = await attachRef(entityId, first, 0);
    const secondRef = await attachRef(entityId, second, 1);
    await reconcileEntityCover(prisma, { ownerId: orgId, entityId });
    expect(await coverOf(entityId)).toBe(first);

    // 拔掉封面那一张(软删,与 softDeleteReferenceImage 同一形状)。
    await prisma.referenceImage.updateMany({ where: { id: firstRef, ownerId: orgId }, data: { deletedAt: new Date() } });
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(second);
    expect(await coverOf(entityId)).toBe(second);

    // 最后一张也拔掉 ⇒ 诚实变回 null,不留一个指着墓碑的封面。
    await prisma.referenceImage.updateMany({ where: { id: secondRef, ownerId: orgId }, data: { deletedAt: new Date() } });
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBeNull();
    expect(await coverOf(entityId)).toBeNull();
  }, 60_000);

  it("PRODID-A4 变体图(variantId 非空)不参加封面判据", async () => {
    const entityId = await seedEntity();
    const variant = await prisma.entityVariant.create({
      data: { id: `evr_${randomUUID()}`, ownerId: orgId, entityId, name: "Red", handle: "red" },
    });
    const variantAsset = await seedAsset();
    await attachRef(entityId, variantAsset, 0, { variantId: variant.id });

    // 只有变体图 ⇒ 身份还是没有脸(封面是身份的,不是某个变体的)。
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBeNull();

    // 基础层挂上一张之后,封面是它,而不是更早挂上的那张变体图。
    const base = await seedAsset();
    await attachRef(entityId, base, 1);
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(base);
  }, 60_000);

  it("PRODID-A4 写路与回填对**墓碑资产**同一口径:只有墓碑可挑 ⇒ 不钉;钉着的那张成了墓碑 ⇒ 落到下一张", async () => {
    // 复核 P2-②:回填迁移一直 `JOIN "Asset" … deletedAt IS NULL`,而写路从前只看
    // `ReferenceImage.deletedAt` —— 同一个库跑迁移与跑写路会得到两个不同的封面。这条盯住两边一致。
    //
    // ① 只有墓碑可挑:不钉。墓碑资产的字节随时被 30 天清扫真删走,钉上去就是一张永远坏掉的封面。
    const tombstoneOnly = await seedEntity();
    const dead = await seedAsset();
    await attachRef(tombstoneOnly, dead, 0);
    await prisma.asset.updateMany({ where: { id: dead, ownerId: orgId }, data: { deletedAt: new Date() } });
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId: tombstoneOnly })).resolves.toBeNull();
    expect(await coverOf(tombstoneOnly)).toBeNull();

    // ② 钉着的那张成了墓碑,但还有别的活图:落到下一张,不留一个指着墓碑的封面。
    const entityId = await seedEntity();
    const first = await seedAsset();
    const second = await seedAsset();
    await attachRef(entityId, first, 0);
    await attachRef(entityId, second, 1);
    await reconcileEntityCover(prisma, { ownerId: orgId, entityId });
    expect(await coverOf(entityId)).toBe(first);

    await prisma.asset.updateMany({ where: { id: first, ownerId: orgId }, data: { deletedAt: new Date() } });
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(second);
    expect(await coverOf(entityId)).toBe(second);
  }, 60_000);

  it("PRODID-A4 幂等:同一个身份连跑两次,结果一样", async () => {
    const entityId = await seedEntity();
    const first = await seedAsset();
    await attachRef(entityId, first, 0);
    const once = await reconcileEntityCover(prisma, { ownerId: orgId, entityId });
    const twice = await reconcileEntityCover(prisma, { ownerId: orgId, entityId });
    expect(once).toBe(first);
    expect(twice).toBe(first);
  }, 60_000);

  it("PRODID-A4 显式「清空封面」在还有图时落回第一张 —— 不变量是全量的", async () => {
    // Founder 2026-09-15 裁决 ＋ 复核 P2-③:一件还挂着基础层参考图的产品**永远**有一张封面。
    // 所以 `imageAssetId: null`(Brand 页那条显式清空意图)不再留下一件没有脸的产品,而是落回
    // 最早那一张。Brand 页那颗「Remove from product」于是永远改不动任何东西,本票把它撤掉。
    const first = await seedAsset();
    const second = await seedAsset();
    const made = (await createProduct({
      ownerId: orgId, data: { name: `Kuih ${randomUUID().slice(0, 8)}` }, source: "user",
      assetIds: [first, second],
    })) as { created: true; id: string; entityId: string };
    expect(await coverOf(made.entityId)).toBe(first);

    // 商家挑第二张当封面 —— 显式意图,照旧说了算。
    await expect(
      updateProductRecord({ ownerId: orgId, id: made.id, data: {}, imageAssetId: second, source: "user" }),
    ).resolves.toMatchObject({ ok: true });
    expect(await coverOf(made.entityId)).toBe(second);

    // 显式清空:不是「没有封面」,而是落回第一张。
    await expect(
      updateProductRecord({ ownerId: orgId, id: made.id, data: {}, imageAssetId: null, source: "user" }),
    ).resolves.toMatchObject({ ok: true });
    expect(await coverOf(made.entityId)).toBe(first);

    // 清空之后再挂一张:封面仍是第一张,新挂的不抢。
    const third = await seedAsset();
    await attachRef(made.entityId, third, 2);
    await reconcileEntityCover(prisma, { ownerId: orgId, entityId: made.entityId });
    expect(await coverOf(made.entityId)).toBe(first);
  }, 60_000);

  it("PRODID-A4 一张基础层参考图都没有时,清空封面仍然是「没有封面」", async () => {
    // 「没有封面」只剩这一种成因 —— 不变量全量之后,它不再能由商家的一次点击造出来。
    const entityId = await seedEntity();
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBeNull();
    expect(await coverOf(entityId)).toBeNull();
  }, 60_000);

  it("PRODID-A9 B 租户改不动 A 的封面", async () => {
    const orgB = `org_${randomUUID()}`;
    await seedOrg(orgB, 100_000);

    const entityId = await seedEntity(orgId);
    const first = await seedAsset(orgId);
    await attachRef(entityId, first, 0);
    await reconcileEntityCover(prisma, { ownerId: orgId, entityId });
    expect(await coverOf(entityId)).toBe(first);

    // B 拿着 A 的 entityId 来调:每一句 where 都带 ownerId,所以它连那条身份都读不到。
    await expect(reconcileEntityCover(prisma, { ownerId: orgB, entityId })).resolves.toBeNull();
    // A 的封面一个字没变。
    expect(await coverOf(entityId)).toBe(first);

    // 拔图那一面同样:B 软删不掉 A 的引用,A 的封面照旧。
    const { count } = await prisma.referenceImage.updateMany({
      where: { entityId, ownerId: orgB, deletedAt: null }, data: { deletedAt: new Date() },
    });
    expect(count).toBe(0);
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(first);
  }, 60_000);
});

describe("PRODID-A4 存量补齐(迁移 20260915120000_entity_cover_autopin)", () => {
  it("PRODID-A4 回填挑的是**最早挂上**的那一张,且只补没钉过的", async () => {
    // ① 没钉过、挂着三张 ⇒ 补上 position 最小的那一张。
    const bare = await seedEntity();
    const a1 = await seedAsset();
    const a2 = await seedAsset();
    const a3 = await seedAsset();
    await attachRef(bare, a2, 1);
    await attachRef(bare, a1, 0); // 挂的顺序故意打乱,排序认的是 position
    await attachRef(bare, a3, 2);

    // ② 商家已经挑过封面 ⇒ 回填一个字都不许动。
    const pinned = await seedEntity();
    const p1 = await seedAsset();
    const p2 = await seedAsset();
    await attachRef(pinned, p1, 0);
    await attachRef(pinned, p2, 1);
    await prisma.entity.updateMany({ where: { id: pinned, ownerId: orgId }, data: { baseAssetId: p2 } });

    // ③ 一张图都没有 ⇒ 还是 null,不编一张。
    const empty = await seedEntity();

    await runMigration();

    expect(await coverOf(bare)).toBe(a1);
    expect(await coverOf(pinned)).toBe(p2);
    expect(await coverOf(empty)).toBeNull();
  }, 60_000);

  it("PRODID-A4 回填跳过软删的引用与已成墓碑的资产,不造一张永远坏掉的封面", async () => {
    // 软删的引用不算数:它在商家眼里已经不存在了。
    const withDead = await seedEntity();
    const dead = await seedAsset();
    const live = await seedAsset();
    await attachRef(withDead, dead, 0, { deletedAt: new Date() });
    await attachRef(withDead, live, 1);

    // 资产是墓碑(Asset.deletedAt 非空):字节随时被 30 天清扫真删走,钉上去等于给商家
    // 一张永远坏掉的图,而且没有入口修得好。
    const tombstoneOnly = await seedEntity();
    const tombstone = await seedAsset();
    await attachRef(tombstoneOnly, tombstone, 0);
    await prisma.asset.updateMany({ where: { id: tombstone, ownerId: orgId }, data: { deletedAt: new Date() } });

    await runMigration();

    expect(await coverOf(withDead)).toBe(live);
    expect(await coverOf(tombstoneOnly)).toBeNull();
  }, 60_000);

  it("PRODID-A4 回填可重跑:第二次影响 0 行,且不改变任何封面", async () => {
    const entityId = await seedEntity();
    const a1 = await seedAsset();
    const a2 = await seedAsset();
    await attachRef(entityId, a1, 0);
    await attachRef(entityId, a2, 1);

    await runMigration();
    expect(await coverOf(entityId)).toBe(a1);

    await runMigration();
    expect(await coverOf(entityId)).toBe(a1);
  }, 60_000);

  it("PRODID-A9 回填逐个身份补,跨不到别的租户", async () => {
    const orgB = `org_${randomUUID()}`;
    await seedOrg(orgB, 100_000);

    const aEntity = await seedEntity(orgId);
    const aAsset = await seedAsset(orgId);
    await attachRef(aEntity, aAsset, 0, { ownerId: orgId });

    const bEntity = await seedEntity(orgB);
    const bAsset = await seedAsset(orgB);
    await attachRef(bEntity, bAsset, 0, { ownerId: orgB });

    await runMigration();

    // 各补各的 —— 补出来的封面绝不会是别家的资产。
    expect(await coverOf(aEntity, orgId)).toBe(aAsset);
    expect(await coverOf(bEntity, orgB)).toBe(bAsset);
  }, 60_000);

  it("PRODID-A4 回填之后,写路再跑一次不会改主意(两处 ORDER BY 逐字同一套)", async () => {
    const entityId = await seedEntity();
    const a1 = await seedAsset();
    const a2 = await seedAsset();
    await attachRef(entityId, a2, 1);
    await attachRef(entityId, a1, 0);

    await runMigration();
    const backfilled = await coverOf(entityId);
    expect(backfilled).toBe(a1);

    // 迁移与 reconcileEntityCover 各有一套「最早那张」的排序。它们挑出不同的图,商家就会
    // 在某一次挂图之后看到封面莫名其妙换了一张 —— 这一句把两处钉死在一起。
    await expect(reconcileEntityCover(prisma, { ownerId: orgId, entityId })).resolves.toBe(backfilled);
  }, 60_000);
});
