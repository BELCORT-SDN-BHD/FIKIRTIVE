/**
 * 共享动作 `createProduct` 的两条边角(规格 `docs/specs/brand-product-identity.md` §1.4/§3)。
 *
 * 四个写入口的行为断言在 `apps/web/lib/__tests__/brand-product-identity.test.ts`(真动作、真会话)。
 * 这里只钉住那条**别的地方看不见**的分支:撞上同名活跃行时,刚建出来的身份必须原样收回 ——
 * 留下一条没人指向的 Entity,商家的 Library 里就会多一张来路不明的产品卡。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "./index.js";
import { createProduct, CreateProductError, updateProductRecord } from "./create-product.js";
import { seedOrg } from "../test/setup.js";

let orgId: string;

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
});

/** 一条真的 Asset 行(内容寻址唯一,所以每次调用都换一个 hash)。 */
async function seedAssetRow(): Promise<string> {
  const asset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgId,
      contentHash: randomUUID().replace(/-/g, "").repeat(2),
      ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD",
    },
  });
  return asset.id;
}

describe("createProduct", () => {
  it("PRODID-A1 一次调用同时落下身份与价签,主图挂在身份上", async () => {
    const asset = await prisma.asset.create({
      data: {
        id: `ast_${randomUUID()}`, ownerId: orgId,
        contentHash: randomUUID().replace(/-/g, "").repeat(2),
        ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD",
      },
    });
    const made = await createProduct({
      ownerId: orgId, data: { name: "Kopi ais", price: "RM 6.50", imageAssetId: asset.id }, source: "user",
    });
    expect(made.created).toBe(true);
    if (!made.created) return;

    const record = await prisma.brandRecord.findFirstOrThrow({
      where: { id: made.id, ownerId: orgId },
      select: { kind: true, nameKey: true, entityId: true, source: true },
    });
    expect(record).toEqual({ kind: "product", nameKey: "kopi ais", entityId: made.entityId, source: "user" });

    const entity = await prisma.entity.findFirstOrThrow({
      where: { id: made.entityId!, ownerId: orgId },
      select: { type: true, name: true, baseAssetId: true },
    });
    expect(entity).toEqual({ type: "PRODUCT", name: "Kopi ais", baseAssetId: asset.id });
    await expect(
      prisma.referenceImage.count({ where: { ownerId: orgId, entityId: made.entityId!, deletedAt: null } }),
    ).resolves.toBe(1);
  }, 60_000);

  it("PRODID-A1 撞上同名活跃行:不建第二件,也不留下无人指向的身份", async () => {
    const first = await createProduct({ ownerId: orgId, data: { name: "Teh tarik" }, source: "user" });
    expect(first.created).toBe(true);

    // 大小写与多余空白都归一到同一个 nameKey —— 这就是既有的幂等键。
    const again = await createProduct({ ownerId: orgId, data: { name: "  TEH   Tarik " }, source: "otto" });
    expect(again.created).toBe(false);
    if (again.created) return;
    expect(again.existingId).toBe((first as { id: string }).id);

    // 身份只有一条 —— 输掉的那一次把自己建出来的 Entity 收回去了。
    await expect(
      prisma.entity.count({ where: { ownerId: orgId, type: "PRODUCT", deletedAt: null } }),
    ).resolves.toBe(1);
  }, 60_000);

  it("PRODID-A7 草稿只落价签,不建身份(理解 worker 提取的产品在确认前没有身份)", async () => {
    const made = await createProduct({
      ownerId: orgId, data: { name: "Mee goreng", price: "RM 8.00" }, source: "otto", contextStatus: "Draft",
    });
    expect(made).toMatchObject({ created: true, entityId: null });
    if (!made.created) return;

    const record = await prisma.brandRecord.findFirstOrThrow({
      where: { id: made.id, ownerId: orgId },
      select: { kind: true, entityId: true, contextStatus: true },
    });
    expect(record).toEqual({ kind: "product", entityId: null, contextStatus: "Draft" });
    // 没有身份,就没有 Library 卡、没有 @ 菜单项 —— 「确认前不出现」由数据本身保证。
    await expect(prisma.entity.count({ where: { ownerId: orgId, type: "PRODUCT" } })).resolves.toBe(0);
    await expect(prisma.referenceImage.count({ where: { ownerId: orgId } })).resolves.toBe(0);
  }, 60_000);

  // 判官第 3 轮 P2-c(PR #1337):这条守卫原先住在 `apps/worker/src/jobs/understand.test.ts`
  // (「ON CONFLICT DO NOTHING,不是一个吞掉一切的 catch」),而建产品那一句搬进共享动作时
  // 它被删掉了,没有在新家补回来。它守的是钱:理解 worker 的产品行与 settle 在**同一个**
  // 交互式事务里,一旦撞名让 Postgres 把事务标成 aborted,后面的 settle 也提交不了 ——
  // 商家被扣了钱、账却结不上。所以这里用真库、真事务把它按行为钉回来。
  it("PRODID-A1 同一个事务里撞上同名产品:事务不 abort,后面的写照样提交得了(settle 保命)", async () => {
    const name = "Nasi lemak";
    await createProduct({ ownerId: orgId, data: { name } , source: "otto" });

    // 理解 worker 的形状:同一张菜单里同名出现两次,产品行与「结算」写在同一个 tx 里。
    const marker = `mkr_${randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      const again = await createProduct({ ownerId: orgId, data: { name }, source: "otto" }, tx);
      expect(again.created).toBe(false);
      // ← 这一句就是 settle 的替身。事务若已被撞名标成 aborted,它会抛
      //   「current transaction is aborted」,整笔连同上面的读一起落空。
      await tx.actionEvent.create({
        data: { id: marker, ownerId: orgId, type: "settle-stand-in", projectId: null },
      });
    });

    await expect(prisma.actionEvent.count({ where: { id: marker, ownerId: orgId } })).resolves.toBe(1);
    await expect(
      prisma.brandRecord.count({ where: { ownerId: orgId, kind: "product", deletedAt: null } }),
    ).resolves.toBe(1);
  }, 60_000);

  it("PRODID-A4 改名换图写的是身份:价签里那两格只是缓存,同事务被追平", async () => {
    const first = await seedAssetRow();
    const second = await seedAssetRow();
    const made = (await createProduct({
      ownerId: orgId, data: { name: "Kopi ais", imageAssetId: first }, source: "user",
    })) as { created: true; id: string; entityId: string };

    const done = await updateProductRecord({
      ownerId: orgId, id: made.id, data: { name: "Kopi O kosong", imageAssetId: second }, source: "user",
    });
    expect(done).toMatchObject({ ok: true });

    // 权威那一边:名字与主图都换了,而且新主图有一条真的 ReferenceImage(不然清扫会当它是孤儿)。
    const entity = await prisma.entity.findFirstOrThrow({
      where: { id: made.entityId, ownerId: orgId },
      select: { name: true, baseAssetId: true },
    });
    expect(entity).toEqual({ name: "Kopi O kosong", baseAssetId: second });
    await expect(
      prisma.referenceImage.count({ where: { ownerId: orgId, entityId: made.entityId, assetId: second, deletedAt: null } }),
    ).resolves.toBe(1);

    // 缓存那一边:同一个事务里追平,连 nameKey(幂等键)一起。
    const row = await prisma.brandRecord.findFirstOrThrow({
      where: { id: made.id, ownerId: orgId }, select: { data: true, nameKey: true },
    });
    expect(row.nameKey).toBe("kopi o kosong");
    expect(row.data).toMatchObject({ name: "Kopi O kosong", imageAssetId: second });
  }, 60_000);

  it("PRODID-A4 改成另一件活着的同名产品:整笔拒绝,两边都不动(规格 §3 不自动合并)", async () => {
    const a = (await createProduct({ ownerId: orgId, data: { name: "Teh tarik" }, source: "user" })) as {
      created: true; id: string; entityId: string;
    };
    await createProduct({ ownerId: orgId, data: { name: "Teh o" }, source: "user" });

    const done = await updateProductRecord({ ownerId: orgId, id: a.id, data: { name: "Teh O" }, source: "user" });
    expect(done).toEqual({ ok: false, reason: "name-taken" });

    // 身份没被改名 —— 拒绝是整笔的,不是「身份改了、价签没改」这种半拉子。
    await expect(
      prisma.entity.findFirstOrThrow({ where: { id: a.entityId, ownerId: orgId }, select: { name: true } }),
    ).resolves.toEqual({ name: "Teh tarik" });
    await expect(
      prisma.brandRecord.findFirstOrThrow({ where: { id: a.id, ownerId: orgId }, select: { nameKey: true } }),
    ).resolves.toEqual({ nameKey: "teh tarik" });
  }, 60_000);

  it("PRODID-A1 已删的 Asset 挂不上主图(墓碑的字节随时会被清扫真删走)", async () => {
    const dead = await seedAssetRow();
    // `updateMany` + ownerId —— tenant-guard 拒绝没有租户过滤的单行 update。
    await prisma.asset.updateMany({ where: { id: dead, ownerId: orgId }, data: { deletedAt: new Date() } });
    const made = (await createProduct({
      ownerId: orgId, data: { name: "Cendol", imageAssetId: dead }, source: "user",
    })) as { created: true; entityId: string };
    await expect(
      prisma.entity.findFirstOrThrow({ where: { id: made.entityId, ownerId: orgId }, select: { baseAssetId: true } }),
    ).resolves.toEqual({ baseAssetId: null });
    await expect(prisma.referenceImage.count({ where: { ownerId: orgId } })).resolves.toBe(0);
  }, 60_000);

  it("PRODID-A1 形状不对就不落库:没有名字的产品建不出来", async () => {
    await expect(createProduct({ ownerId: orgId, data: { name: "   " }, source: "user" })).rejects.toBeInstanceOf(
      CreateProductError,
    );
    await expect(prisma.entity.count({ where: { ownerId: orgId, type: "PRODUCT" } })).resolves.toBe(0);
    await expect(prisma.brandRecord.count({ where: { ownerId: orgId } })).resolves.toBe(0);
  }, 60_000);
});
