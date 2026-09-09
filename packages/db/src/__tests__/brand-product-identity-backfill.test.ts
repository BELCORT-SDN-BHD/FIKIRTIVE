/**
 * PRODID-A8 —— 回填迁移 20260910120000_brand_product_identity 到底做了什么
 * (规格 `docs/specs/brand-product-identity.md` §1.4 与验收表 PRODID-A8;票 #1321)。
 *
 * 这份迁移在生产上只跑一次,而它动的是 Founder 自己的数据(规格 §4 的第一风险)。所以这里
 * 不复述那段 SQL,而是**把迁移文件原样读出来执行**:老形状的行 → 跑一次 → 逐条核对。
 * 改了那份 SQL 而没有改这里,这里就红。
 *
 * 老形状怎么造:迁移最后加的外键与 CHECK 会拒绝「没有身份的 product 行」,所以每个用例先
 * 把这两条约束松开、插入老行,再让迁移自己把它们装回去 —— 全新库仍按迁移顺序跑,这里要验
 * 的正是「回填当时读到的是什么」。packages/db 的 vitest 是 singleFork 串行跑的,这几句 DDL
 * 不会撞上别的测试文件;setup.ts 的 beforeEach 每条用例前把 Organization 整棵 TRUNCATE 掉。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { prisma } from "../index.js";
import { seedOrg } from "../../test/setup.js";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations/20260910120000_brand_product_identity/migration.sql",
);
const MIGRATION_SQL = readFileSync(MIGRATION, "utf8");

/**
 * 整份迁移一次送进去。用 `pg` 的简单查询协议而不是 Prisma —— 迁移是多语句 ＋ 显式
 * BEGIN/COMMIT ＋ DO $$ 块,`$executeRawUnsafe` 送不了这种东西。
 */
async function runMigration(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(MIGRATION_SQL);
  } finally {
    await client.end();
  }
}

/** 把迁移最后装上的两条约束松开,好让老形状(product 行没有 entityId)插得进去。 */
async function loosenConstraints(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_product_needs_entity"`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_entityId_ownerId_fkey"`,
  );
}

async function seedLegacyProduct(
  ownerId: string,
  name: string,
  extra: { deletedAt?: Date; imageAssetId?: string } = {},
): Promise<string> {
  const id = `brc_${randomUUID()}`;
  await prisma.brandRecord.create({
    data: {
      id,
      ownerId,
      brandId: null,
      kind: "product",
      nameKey: name.trim().toLowerCase().replace(/\s+/g, " "),
      data: { name, ...(extra.imageAssetId ? { imageAssetId: extra.imageAssetId } : {}) },
      status: "active",
      source: "user",
      pinned: false,
      ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {}),
    },
  });
  return id;
}

async function seedAsset(ownerId: string): Promise<string> {
  const id = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id,
      ownerId,
      contentHash: randomUUID().replace(/-/g, "").repeat(2),
      ext: "png",
      mime: "image/png",
      sizeBytes: BigInt(10),
      source: "UPLOAD",
    },
  });
  return id;
}

let orgId: string;
let otherOrgId: string;

beforeEach(async () => {
  // 上一条用例若在约束松开的状态下失败,这一句把它们装回去(迁移可重跑,空库上是 no-op)。
  await runMigration();
  orgId = `org_${randomUUID()}`;
  otherOrgId = `org_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
  await seedOrg(otherOrgId, 100_000);
});

describe("PRODID-A8 回填迁移", () => {
  it("PRODID-A8 N 条旧记录 → N 个 Entity,计数一致,每条 entityId 非空", async () => {
    await loosenConstraints();
    const assetId = await seedAsset(orgId);
    const names = ["Kopi ais", "Teh tarik", "Nasi lemak"];
    const ids: string[] = [];
    for (const name of names) ids.push(await seedLegacyProduct(orgId, name, { imageAssetId: assetId }));
    // 一条软删的旧产品 —— 它也要拿到身份(否则恢复它时 CHECK 会炸),但那条身份同样是软删的。
    const deletedId = await seedLegacyProduct(orgId, "Retired roti", { deletedAt: new Date() });
    // 一条 segment —— 它没有身份那一半,回填一个字节都不该碰它。
    const segmentId = `brc_${randomUUID()}`;
    await prisma.brandRecord.create({
      data: {
        id: segmentId, ownerId: orgId, brandId: null, kind: "segment", nameKey: "office crowd",
        data: { name: "Office crowd", who: "Office workers nearby" },
        status: "active", source: "user", pinned: false,
      },
    });

    const liveProductsBefore = await prisma.brandRecord.count({
      where: { ownerId: orgId, kind: "product", deletedAt: null },
    });
    expect(liveProductsBefore).toBe(names.length);

    await runMigration();

    // ① 每条 product 行(含软删)都有 entityId。
    const products = await prisma.brandRecord.findMany({
      where: { ownerId: orgId, kind: "product" },
      select: { id: true, entityId: true, deletedAt: true },
    });
    expect(products).toHaveLength(names.length + 1);
    expect(products.every((r) => !!r.entityId)).toBe(true);

    // ② 活跃 Entity(PRODUCT) 数 ≥ 迁移前活跃 BrandRecord(product) 数。
    const liveEntities = await prisma.entity.count({
      where: { ownerId: orgId, type: "PRODUCT", deletedAt: null },
    });
    expect(liveEntities).toBeGreaterThanOrEqual(liveProductsBefore);
    expect(liveEntities).toBe(names.length);

    // ③ 名字与主图挂在身份上。
    for (let i = 0; i < ids.length; i++) {
      const record = products.find((r) => r.id === ids[i])!;
      const entity = await prisma.entity.findFirstOrThrow({
        where: { id: record.entityId!, ownerId: orgId },
        select: { name: true, type: true, baseAssetId: true, deletedAt: true },
      });
      expect(entity).toMatchObject({ name: names[i], type: "PRODUCT", baseAssetId: assetId, deletedAt: null });
      const refs = await prisma.referenceImage.findMany({
        where: { ownerId: orgId, entityId: record.entityId! },
        select: { assetId: true, position: true },
      });
      expect(refs).toEqual([{ assetId, position: 0 }]);
    }

    // ④ 软删那条的身份同样是软删的 —— 它在 Library、@ 菜单里都不存在。
    const deletedRecord = products.find((r) => r.id === deletedId)!;
    const deletedEntity = await prisma.entity.findFirstOrThrow({
      where: { id: deletedRecord.entityId!, ownerId: orgId },
      select: { deletedAt: true },
    });
    expect(deletedEntity.deletedAt).not.toBeNull();

    // ⑤ segment 一个字节没动。
    const segment = await prisma.brandRecord.findFirstOrThrow({
      where: { id: segmentId, ownerId: orgId },
      select: { entityId: true },
    });
    expect(segment.entityId).toBeNull();
  }, 60_000);

  it("PRODID-A8 预检对一条人造跨租户行报错,且整条迁移不落库", async () => {
    await loosenConstraints();
    // 另一个租户的身份。
    const foreignEntityId = `ent_${randomUUID()}`;
    await prisma.entity.create({
      data: { id: foreignEntityId, ownerId: otherOrgId, type: "PRODUCT", name: "Someone else's kopi" },
    });
    // 人造的跨租户行:ownerId 是我们,entityId 指着别人。
    const badId = await seedLegacyProduct(orgId, "Smuggled kopi");
    await prisma.$executeRawUnsafe(
      `UPDATE "BrandRecord" SET "entityId" = $1 WHERE "id" = $2`,
      foreignEntityId,
      badId,
    );
    // 同一批里还有一条正常的待回填行 —— 用它证明「不落库」是整条,不是只跳过坏的那一条。
    const goodId = await seedLegacyProduct(orgId, "Honest kopi");

    await expect(runMigration()).rejects.toThrow(/预检①失败/);

    const rows = await prisma.brandRecord.findMany({
      where: { ownerId: orgId, kind: "product" },
      select: { id: true, entityId: true },
    });
    expect(rows.find((r) => r.id === goodId)!.entityId).toBeNull();
    expect(rows.find((r) => r.id === badId)!.entityId).toBe(foreignEntityId);
    // 一条身份都没造出来。
    await expect(
      prisma.entity.count({ where: { ownerId: orgId, type: "PRODUCT" } }),
    ).resolves.toBe(0);
  }, 60_000);

  it("PRODID-A8 预检对同租户同名冲突报错,且整条迁移不落库", async () => {
    await loosenConstraints();
    // 商家已经在 Library 里自己建过一件同名的产品元素 —— 是不是同一件,回填不猜(规格 §3)。
    await prisma.entity.create({
      data: { id: `ent_${randomUUID()}`, ownerId: orgId, type: "PRODUCT", name: "  Kopi   Ais " },
    });
    const clashId = await seedLegacyProduct(orgId, "Kopi ais");

    await expect(runMigration()).rejects.toThrow(/预检②失败/);

    const row = await prisma.brandRecord.findFirstOrThrow({
      where: { id: clashId, ownerId: orgId },
      select: { entityId: true },
    });
    expect(row.entityId).toBeNull();
  }, 60_000);

  it("PRODID-A8 fresh DB:空库上跑迁移无错,外键与 CHECK 都在位", async () => {
    // beforeEach 已经跑过一次 —— 再跑一次证明它可重跑(生产回滚后重上就是这个路径)。
    await expect(runMigration()).resolves.toBeUndefined();

    const constraints = await prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE conrelid = '"BrandRecord"'::regclass ORDER BY conname`,
    );
    const names = constraints.map((c) => c.conname);
    expect(names).toContain("BrandRecord_entityId_ownerId_fkey");
    expect(names).toContain("BrandRecord_product_needs_entity");
  }, 60_000);
});
