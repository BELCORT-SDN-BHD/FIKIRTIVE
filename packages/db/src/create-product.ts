/**
 * `createProduct` —— 建一件产品的**唯一**一条写路(规格 docs/specs/brand-product-identity.md
 * §1.4;票 #1321)。
 *
 * 商家在 Brand 页、Library、Otto 对话或网站理解里建的产品是同一件东西。做到这句话只有一个
 * 办法:身份(`Entity(type=PRODUCT)`,名字与主图)和价签(`BrandRecord(kind='product')`,价格、
 * 卖点、分类)在**同一个事务**里一起出生,谁也不能单独存在。四个写入口全部落到这里 ——
 * 人工 UI 与 Otto 走同一层业务动作(仓库家规「shared actions」),不复制第二套实现。
 *
 * 围栏:除了这个文件,仓库里任何地方都不许 `brandRecord.create(kind='product')`
 * (源码扫描测试 packages/db/src/__tests__/create-product-fence.test.ts)。数据库那一半是
 * CHECK `BrandRecord_product_needs_entity` —— 就算绕过围栏,没有 entityId 的 product 行也
 * 进不了库(唯一的口子是草稿,见下一段)。
 *
 * 草稿(`contextStatus: "Draft"`):规格 §1.2 / §1.9 与验收 PRODID-A7 要的是「网站／素材理解
 * 自动提取**先进草稿**,商家在 Brand 页确认后才建身份」——「确认前不出现在 Library 与 @ 菜单」
 * 只有一种做法不靠每一条读路各自记得过滤:草稿这一刻**根本没有身份**。所以 Draft 只落价签
 * (`entityId` 为 null,`entityId` 是 null 时那条复合外键按 MATCH SIMPLE 不检查),身份留给
 * 确认那一步(Brand②③,票 #1322 / #1330)。数据库那一半的 CHECK 因此写成
 * 「product 要么是 Draft,要么有 entityId」。
 *
 * 钱:一分不碰(PRODID-A10)。没有 reserve / settle / ledger,没有 GenJob。
 * 租户:`ownerId` 只能是调用方从服务端 principal 拿到的那一个;复合外键
 * (entityId, ownerId) → Entity(id, ownerId) 让跨租户连线在数据库层就不可能(ADR 0002)。
 *
 * 幂等:沿用既有的 `(ownerId, brandId, kind, nameKey)` 活跃唯一索引。这里只负责**建**;
 * 撞上同名活跃行时不猜、不合并(规格 §3「同名旧产品自动合并」是非目标),把身份原样收回,
 * 返回 `{ created: false, existingId }`,由调用方按自己那一面的语义决定转 update 还是报错。
 */
import { newId, normalizeNameKey, productRecordData } from "@fikirtive/core";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./client.js";

/** 交互式事务里的 client;裸 `prisma` 也满足这个形状。 */
type Tx = Prisma.TransactionClient;

export class CreateProductError extends Error {
  readonly code = "INVALID_PRODUCT";

  constructor(message: string) {
    super(message);
    this.name = "CreateProductError";
  }
}

export type CreateProductInput = {
  /** 只来自已认证的服务端 principal。调用方传不进客户端给的值。 */
  ownerId: string;
  brandId?: string | null;
  /** 价签字段。这里再 zod 一次(fail closed):模型与表单都不是可信输入。 */
  data: Record<string, unknown>;
  source: "otto" | "user";
  status?: "active" | "archived";
  /**
   * 价签的上下文状态。`"Draft"` = 草稿:只落价签、**不建身份**(见文件顶部「草稿」一段;
   * 规格 §1.9 / PRODID-A7)。省略即 `"Ready"`,身份与价签同事务一起出生。
   */
  contextStatus?: "Ready" | "Draft";
  origin?: string;
  originDetail?: string | null;
  updatedById?: string | null;
  /**
   * 额外挂到身份上的图(Library「新建元素 → 产品」一次可以传多张)。
   * `data.imageAssetId` 永远排在最前,第一张即主图(`Entity.baseAssetId`)。
   */
  assetIds?: string[];
};

export type CreateProductOutcome =
  /** `entityId` 只有草稿是 null —— 草稿的身份要等商家确认(规格 §1.9)。 */
  | { created: true; id: string; entityId: string | null }
  | { created: false; existingId: string | null };

/**
 * @param db 已经在事务里就把那个 tx 传进来(理解 worker 与 settle 同事务,MONEY-A9 不变量②)。
 *           不传就自己开一个事务 —— 身份与价签要么一起落,要么一起没有。
 */
export async function createProduct(
  input: CreateProductInput,
  db?: Tx,
): Promise<CreateProductOutcome> {
  if (db) return createProductIn(db, input);
  return prisma.$transaction((tx) => createProductIn(tx, input));
}

async function createProductIn(tx: Tx, input: CreateProductInput): Promise<CreateProductOutcome> {
  const parsed = productRecordData.safeParse(input.data);
  if (!parsed.success) {
    throw new CreateProductError(
      `Invalid product: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  const data = parsed.data;
  const nameKey = normalizeNameKey(data.name);
  if (!nameKey) throw new CreateProductError("A product needs a name.");

  const { ownerId } = input;
  const brandId = input.brandId ?? null;

  // 主图在最前,其余按传入顺序;去重后**逐一回库核对归属**。挂一张别人的图会被
  // ReferenceImage 的复合外键当场拒绝,而那个拒绝会炸掉整个事务(理解 worker 里连
  // settle 都提交不了)。所以先问清楚,不存在或不是自己的就诚实不挂,而不是编一张图。
  const wanted = [...new Set([data.imageAssetId, ...(input.assetIds ?? [])].filter((v): v is string => !!v))];
  const owned = wanted.length
    ? new Set(
        (await tx.asset.findMany({ where: { id: { in: wanted }, ownerId }, select: { id: true } })).map((a) => a.id),
      )
    : new Set<string>();
  const assetIds = wanted.filter((id) => owned.has(id));

  // 草稿不建身份(规格 §1.9 / PRODID-A7)。主图仍然只以 `data.imageAssetId` 这条软指针存在,
  // 而那条软指针现在也被 asset-purge 的「独占」判据认账,所以它不会被别处的删除带走字节。
  const entityId = input.contextStatus === "Draft" ? null : newId();
  if (entityId) {
    await tx.entity.create({
      data: {
        id: entityId,
        ownerId,
        type: "PRODUCT",
        name: data.name.slice(0, 120),
        brandId,
        baseAssetId: assetIds[0] ?? null,
      },
    });
    for (let i = 0; i < assetIds.length; i++) {
      await tx.referenceImage.create({
        data: { id: newId(), ownerId, entityId, assetId: assetIds[i]!, position: i, brandId },
      });
    }
  }

  const id = newId();
  // `createMany({ skipDuplicates })` 而不是 create + catch(P2002):在交互式事务里捕获唯一
  // 冲突是**假的**保护 —— 冲突已经让 Postgres 把整个事务标成 aborted,之后连别的写入都提交
  // 不了(理解 worker 的原注释,20260818 那一版)。ON CONFLICT DO NOTHING 让「同名活跃行已
  // 存在」变成 count=0 这个可以处理的结果。
  const { count } = await tx.brandRecord.createMany({
    data: [
      {
        id,
        ownerId,
        brandId,
        kind: "product",
        nameKey,
        entityId,
        data: data as unknown as Prisma.InputJsonObject,
        status: input.status ?? "active",
        source: input.source,
        pinned: false,
        ...(input.contextStatus !== undefined ? { contextStatus: input.contextStatus } : {}),
        ...(input.origin !== undefined ? { origin: input.origin } : {}),
        ...(input.originDetail !== undefined ? { originDetail: input.originDetail } : {}),
        ...(input.updatedById !== undefined ? { updatedById: input.updatedById } : {}),
      },
    ],
    skipDuplicates: true,
  });
  if (count === 1) return { created: true, id, entityId };

  // 撞名了:把刚建出来的身份原样收回。这两句是普通 DELETE,不会让事务 abort,所以调用方
  // (以及理解 worker 那条与 settle 同事务的路径)还能继续走自己的 update 分支。
  // 草稿这一刻没有身份可收(entityId 为 null),直接跳过。
  if (entityId) {
    await tx.referenceImage.deleteMany({ where: { entityId, ownerId } });
    await tx.entity.delete({ where: { id_ownerId: { id: entityId, ownerId } } });
  }
  const existing = await tx.brandRecord.findFirst({
    where: { ownerId, brandId, kind: "product", nameKey, deletedAt: null },
    select: { id: true },
  });
  return { created: false, existingId: existing?.id ?? null };
}
