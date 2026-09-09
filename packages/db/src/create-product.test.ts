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
import { createProduct, CreateProductError } from "./create-product.js";
import { seedOrg } from "../test/setup.js";

let orgId: string;

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
});

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
      where: { id: made.entityId, ownerId: orgId },
      select: { type: true, name: true, baseAssetId: true },
    });
    expect(entity).toEqual({ type: "PRODUCT", name: "Kopi ais", baseAssetId: asset.id });
    await expect(
      prisma.referenceImage.count({ where: { ownerId: orgId, entityId: made.entityId, deletedAt: null } }),
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

  it("PRODID-A1 形状不对就不落库:没有名字的产品建不出来", async () => {
    await expect(createProduct({ ownerId: orgId, data: { name: "   " }, source: "user" })).rejects.toBeInstanceOf(
      CreateProductError,
    );
    await expect(prisma.entity.count({ where: { ownerId: orgId, type: "PRODUCT" } })).resolves.toBe(0);
    await expect(prisma.brandRecord.count({ where: { ownerId: orgId } })).resolves.toBe(0);
  }, 60_000);
});
