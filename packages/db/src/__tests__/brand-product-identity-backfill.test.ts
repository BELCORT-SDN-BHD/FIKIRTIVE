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

const MIGRATION_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations/20260910120000_brand_product_identity",
);
const MIGRATION_SQL = readFileSync(resolve(MIGRATION_DIR, "migration.sql"), "utf8");
const ROLLBACK_SQL = readFileSync(resolve(MIGRATION_DIR, "rollback.sql"), "utf8");

/**
 * 整份迁移一次送进去。用 `pg` 的简单查询协议而不是 Prisma —— 迁移是多语句 ＋ 显式
 * BEGIN/COMMIT ＋ DO $$ 块,`$executeRawUnsafe` 送不了这种东西。
 */
async function runSql(sql: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function runMigration(): Promise<void> {
  await runSql(MIGRATION_SQL);
}

/** 同目录的 rollback.sql,同样原样读出来执行 —— 改了那份 SQL 而没有改这里,这里就红。 */
async function runRollback(): Promise<void> {
  await runSql(ROLLBACK_SQL);
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

  /**
   * 预检②(**Founder 2026-09-10 裁,#1321 评论**):同名不再一律拒绝,而是**一次性链接**。
   *
   * 为什么破例:这条预检在开发库上 100% 命中 —— 存量 Library 产品卡与 Brand 价签本来就是同一件
   * 东西被记了两处,一律拒绝等于这份迁移永远上不了线。裁决只覆盖**这一次迁移**:运行时新增同名
   * 仍然不自动合并(规格 §3 不变,`createProduct` 撞名照旧返回 `{ created:false, existingId }`)。
   *
   * 三种情况各一例。
   */
  it("PRODID-A8 同名一次性链接:没有同名的 Library 卡 → 照旧新建身份", async () => {
    await loosenConstraints();
    // 同租户有一张 PRODUCT 卡,但名字不同;另一个租户有一张同名的 —— 两张都不该被认领。
    await prisma.entity.create({
      data: { id: `ent_${randomUUID()}`, ownerId: orgId, type: "PRODUCT", name: "Teh o ais" },
    });
    await prisma.entity.create({
      data: { id: `ent_${randomUUID()}`, ownerId: otherOrgId, type: "PRODUCT", name: "Kopi ais" },
    });
    const recordId = await seedLegacyProduct(orgId, "Kopi ais");

    await runMigration();

    const row = await prisma.brandRecord.findFirstOrThrow({
      where: { id: recordId, ownerId: orgId }, select: { entityId: true },
    });
    expect(row.entityId).toBe(`prodid_${recordId}`);
  }, 60_000);

  it("PRODID-A8 同名一次性链接:恰有一张同名活跃 Library 卡 → 指向它、不新建身份、主图挂上去", async () => {
    await loosenConstraints();
    const assetId = await seedAsset(orgId);
    // 商家自己在 Library 建的那张卡 —— 名字带多余空白,归一化之后与价签的 nameKey 相同。
    const cardId = `ent_${randomUUID()}`;
    await prisma.entity.create({
      data: { id: cardId, ownerId: orgId, type: "PRODUCT", name: "  Kopi   Ais " },
    });
    // 同名的价签(带主图)+ 一条没有同名卡的价签,用来对照「没同名的照旧新建」。
    const linkedId = await seedLegacyProduct(orgId, "Kopi ais", { imageAssetId: assetId });
    const freshId = await seedLegacyProduct(orgId, "Teh tarik");
    // 一条软删的同名价签:它不参与链接(链接只给活跃价签),照旧各建各的身份。
    const deletedId = await seedLegacyProduct(orgId, "Kopi ais", { deletedAt: new Date() });

    const liveTagsBefore = await prisma.brandRecord.count({
      where: { ownerId: orgId, kind: "product", deletedAt: null },
    });
    await runMigration();

    // ① 价签指向的是**商家那张卡**,不是回填新造的身份。
    const linked = await prisma.brandRecord.findFirstOrThrow({
      where: { id: linkedId, ownerId: orgId }, select: { entityId: true },
    });
    expect(linked.entityId).toBe(cardId);
    // ② 没有同名卡的那条照旧新建;软删那条也照旧各建各的。
    await expect(
      prisma.brandRecord.findFirstOrThrow({ where: { id: freshId, ownerId: orgId }, select: { entityId: true } }),
    ).resolves.toEqual({ entityId: `prodid_${freshId}` });
    await expect(
      prisma.brandRecord.findFirstOrThrow({ where: { id: deletedId, ownerId: orgId }, select: { entityId: true } }),
    ).resolves.toEqual({ entityId: `prodid_${deletedId}` });
    // 复用的那条**没有**新造身份 —— 这正是「不新建」的凭据。
    await expect(
      prisma.entity.count({ where: { ownerId: orgId, id: `prodid_${linkedId}` } }),
    ).resolves.toBe(0);

    // ③ 价签的主图挂到了那张卡上(它自己原本没有主图),而且有一条真的 ReferenceImage ——
    //    只写 baseAssetId 这条软指针的话,那张图会在下一次清扫里被当成孤儿。
    const card = await prisma.entity.findFirstOrThrow({
      where: { id: cardId, ownerId: orgId }, select: { name: true, baseAssetId: true },
    });
    expect(card).toEqual({ name: "  Kopi   Ais ", baseAssetId: assetId }); // 名字一个字节没动
    await expect(
      prisma.referenceImage.count({
        where: { ownerId: orgId, entityId: cardId, assetId, deletedAt: null },
      }),
    ).resolves.toBe(1);

    // ④ 身份计数口径(Founder 裁的那一句):每条活跃价签 entityId 非空,而且
    //    活跃 PRODUCT Entity 数 ≥ 迁移前活跃价签数 − 复用数。
    const liveTags = await prisma.brandRecord.findMany({
      where: { ownerId: orgId, kind: "product", deletedAt: null },
      select: { entityId: true },
    });
    expect(liveTags.every((r) => !!r.entityId)).toBe(true);
    const liveEntities = await prisma.entity.count({
      where: { ownerId: orgId, type: "PRODUCT", deletedAt: null },
    });
    expect(liveEntities).toBeGreaterThanOrEqual(liveTagsBefore - 1); // 复用数 = 1
  }, 60_000);

  it("PRODID-A8 同名一次性链接:两张同名 Library 卡 → 拒绝并报出,整条迁移零落库", async () => {
    await loosenConstraints();
    for (const name of ["  Kopi   Ais ", "KOPI AIS"]) {
      await prisma.entity.create({
        data: { id: `ent_${randomUUID()}`, ownerId: orgId, type: "PRODUCT", name },
      });
    }
    const clashId = await seedLegacyProduct(orgId, "Kopi ais");
    // 同一批里还有一条本来没问题的行 —— 用它证明「不落库」是整条,不是只跳过坏的那一条。
    const goodId = await seedLegacyProduct(orgId, "Nasi lemak");

    await expect(runMigration()).rejects.toThrow(/预检②失败/);

    const rows = await prisma.brandRecord.findMany({
      where: { ownerId: orgId, kind: "product" }, select: { id: true, entityId: true },
    });
    expect(rows.find((r) => r.id === clashId)!.entityId).toBeNull();
    expect(rows.find((r) => r.id === goodId)!.entityId).toBeNull();
    // 一条身份都没造出来(商家原有的两张卡照旧在,回填的一条都没有)。
    await expect(
      prisma.entity.count({ where: { ownerId: orgId, id: { startsWith: "prodid_" } } }),
    ).resolves.toBe(0);
  }, 60_000);

  /**
   * 「回滚 → 重上」会在一个**已经有草稿**的库上再跑一次这份文件(草稿是本票引入的状态,
   * 上线那一刻还没有,但回滚之后就有了)。草稿此刻就该没有身份 —— 规格 §1.9 与验收
   * PRODID-A7 的「确认前不出现在 Library 与 @ 菜单」靠的正是这一点。少了过滤,回填会替商家
   * 确认一批 AI 猜出来的产品,甚至让草稿去认领商家自己那张 Library 卡。
   */
  it("PRODID-A7 重上时草稿不回填:不建身份、也不认领同名的 Library 卡", async () => {
    await loosenConstraints();
    // 商家自己那张卡(同名)—— 活跃、恰好一张,正是一次性链接会认领的形状。
    const cardId = `ent_${randomUUID()}`;
    await prisma.entity.create({
      data: { id: cardId, ownerId: orgId, type: "PRODUCT", name: "Kopi ais" },
    });
    const draftId = `brc_${randomUUID()}`;
    await prisma.brandRecord.create({
      data: {
        id: draftId, ownerId: orgId, brandId: null, kind: "product", nameKey: "kopi ais",
        data: { name: "Kopi ais" }, status: "active", source: "otto", pinned: false,
        contextStatus: "Draft",
      },
    });

    await runMigration();

    const draft = await prisma.brandRecord.findFirstOrThrow({
      where: { id: draftId, ownerId: orgId },
      select: { entityId: true, contextStatus: true },
    });
    expect(draft).toEqual({ entityId: null, contextStatus: "Draft" });
    // 商家那张卡一个字节没动(没被认领、没被挂图)。
    await expect(
      prisma.entity.findFirstOrThrow({
        where: { id: cardId, ownerId: orgId }, select: { baseAssetId: true, deletedAt: true },
      }),
    ).resolves.toEqual({ baseAssetId: null, deletedAt: null });
    // 也没有替它新造一条身份。
    await expect(
      prisma.entity.count({ where: { ownerId: orgId, id: `prodid_${draftId}` } }),
    ).resolves.toBe(0);
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

/**
 * 判官第 1 轮 P1(PR #1337):rollback.sql 的安全网在**真实生产状态**下成立吗?
 *
 * 这份迁移正是把存量产品第一次送进 Library 与 @ 菜单,所以「回填出来的身份被商家用过」是上线
 * 之后的常态:@ 进一个镜头(ShotEntityRef)、在 Library 补第二张照片(普通 ULID 的
 * ReferenceImage,`prodidimg\_%` 删不到)。这两条都是必填 ＋ RESTRICT 的外键,原来的
 * `DELETE FROM "Entity" WHERE "id" LIKE 'prodid\_%'` 会被数据库拒绝,而整份回滚包在一个事务
 * 里 —— 一条挡住就一句都不落地。这个用例把那一格造出来,证明回滚现在跑得完。
 */
describe("判官 P1 回滚演练:被商家用过的回填身份不挡回滚", () => {
  it("PRODID-A8 回滚:被 @ 进镜头 / 补过照片的回填身份原样留下,其余删净,整份跑得完", async () => {
    await loosenConstraints();
    const assetId = await seedAsset(orgId);
    const usedInShot = await seedLegacyProduct(orgId, "Kopi ais", { imageAssetId: assetId });
    const extraPhoto = await seedLegacyProduct(orgId, "Teh tarik", { imageAssetId: assetId });
    const untouched = await seedLegacyProduct(orgId, "Nasi lemak", { imageAssetId: assetId });

    await runMigration();

    // ① 一条被 @ 进镜头(ShotEntityRef)。
    const projectId = `prj_${randomUUID()}`;
    const shotId = `sht_${randomUUID()}`;
    await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Raya" } });
    await prisma.shot.create({ data: { id: shotId, ownerId: orgId, projectId, number: 1 } });
    await prisma.shotEntityRef.create({
      data: { shotId, ownerId: orgId, entityId: `prodid_${usedInShot}` },
    });
    // ② 一条在 Library 补了第二张照片(普通 ULID —— rollback 的 prodidimg_ 前缀删不到)。
    const second = await seedAsset(orgId);
    await prisma.referenceImage.create({
      data: {
        id: `rimg_${randomUUID()}`, ownerId: orgId, entityId: `prodid_${extraPhoto}`,
        assetId: second, position: 1,
      },
    });

    await expect(runRollback()).resolves.toBeUndefined();

    // 用过的两条原样留下(商家自己看得见、可以自己删);没人用的那条删净。
    const left = await prisma.entity.findMany({
      where: { ownerId: orgId, type: "PRODUCT" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(left.map((e) => e.id).sort()).toEqual([`prodid_${extraPhoto}`, `prodid_${usedInShot}`].sort());
    // 留下的身份连它那张回填主图一起留(否则商家看到一条没有封面的孤儿元素)。
    await expect(
      prisma.referenceImage.count({ where: { ownerId: orgId, id: `prodidimg_${usedInShot}` } }),
    ).resolves.toBe(1);
    await expect(
      prisma.referenceImage.count({ where: { ownerId: orgId, id: `prodidimg_${untouched}` } }),
    ).resolves.toBe(0);

    // 价签一条不少,列已经退回去了。
    await expect(prisma.brandRecord.count({ where: { ownerId: orgId, kind: "product" } })).resolves.toBe(3);
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'BrandRecord' AND column_name = 'entityId'`,
    );
    expect(cols).toHaveLength(0);

    // 回滚之后**直接**重上:留下来的那两条身份与它们的价签同名,而 Founder 2026-09-10 裁的
    // 一次性链接(#1321 评论)正是「恰有一张同名活跃卡就认回去」—— 所以价签指回原来那两条,
    // 不再新建第二份身份。这条裁决之前这里是 fail closed(预检②一律拒绝、人工处理),
    // 「回滚 → 重上」因此曾经是一条死路;现在它自己走得通。
    await expect(runMigration()).resolves.toBeUndefined();
    const back = await prisma.brandRecord.findMany({
      where: { ownerId: orgId, kind: "product" },
      select: { id: true, entityId: true },
    });
    expect(back.find((r) => r.id === usedInShot)!.entityId).toBe(`prodid_${usedInShot}`);
    expect(back.find((r) => r.id === extraPhoto)!.entityId).toBe(`prodid_${extraPhoto}`);
    // 没有同名卡剩下的那一条照旧新建。
    expect(back.find((r) => r.id === untouched)!.entityId).toBe(`prodid_${untouched}`);
    // 身份数没有翻倍 —— 认回去的两条不会被再造一次。
    await expect(
      prisma.entity.count({ where: { ownerId: orgId, type: "PRODUCT", deletedAt: null } }),
    ).resolves.toBe(3);
  }, 60_000);
});

/**
 * 判官第 3 轮 P1-2(PR #1337):`migrate deploy` 预检失败之后,库里**一个字节都没变** ——
 * 列不存在、约束不存在。而上一版 rollback.sql 第 44 行是一句裸的
 * `UPDATE "BrandRecord" SET "entityId" = NULL ...`,在那种状态下自己会报 42703
 * undefined_column,整份回滚一句都不落地 —— 也就是说,**最需要它的那一刻它跑不了**。
 *
 * 而这一刻恰好还叠着 P3009:`_prisma_migrations` 里留着一行 started_at 有值、finished_at
 * 为 NULL 的失败记录,之后任何 migrate deploy 都直接被拒。恢复顺序写在 rollback.sql 的文件头
 * (resolve --rolled-back → 跑 rollback.sql → 处理数据 → 重上),真机演练的命令与输出在 PR 描述里。
 * 这个用例钉住的是其中可以自动化的那一半:**任何状态下 rollback.sql 都跑得完**。
 */
describe("判官 P1-2 回滚幂等:迁移一个字节都没落时,rollback 也跑得完", () => {
  it("PRODID-A8 回滚幂等:列/约束都不存在时 rollback.sql 照样跑完,连跑两次也一样", async () => {
    // 「这份迁移从来没成功过」的库形状:列不在,外键与 CHECK 跟着列一起没了。
    await prisma.$executeRawUnsafe(`ALTER TABLE "BrandRecord" DROP COLUMN IF EXISTS "entityId"`);
    const before = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'BrandRecord' AND column_name = 'entityId'`,
    );
    expect(before).toHaveLength(0);

    // 上一版在这里报 42703。现在每一步都自己判断「那东西在不在」。
    await expect(runRollback()).resolves.toBeUndefined();
    await expect(runRollback()).resolves.toBeUndefined();

    // 回滚跑得完,重上也就通了 —— 这正是恢复步骤 ④。同时把库的形状还给后面的测试文件。
    await expect(runMigration()).resolves.toBeUndefined();
    const after = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'BrandRecord' AND column_name = 'entityId'`,
    );
    expect(after).toHaveLength(1);
  }, 60_000);
});
