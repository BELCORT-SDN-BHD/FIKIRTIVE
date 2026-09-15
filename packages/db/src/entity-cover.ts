/**
 * `reconcileEntityCover` —— 封面(`Entity.baseAssetId`)的**唯一**一条写路
 * (规格 docs/specs/brand-product-identity.md §5;Founder 2026-09-15 裁决;验收 PRODID-A4)。
 *
 * ── Founder 2026-09-15 裁决(原话) ──────────────────────────────────────────
 * 「未钉封面时的显示规则:挂上第一张参考图时自动设为封面并写回 `Entity.baseAssetId`,商家随时
 *   可换;存量数据一次补齐迁移;Library 与 Brand 从此同一张图。」
 *
 * ── 这条规则为什么住在这里,而不是每个挂图的地方各写一遍 ────────────────────
 * 裁决之前,「没钉封面时显示哪一张」是**读路**各自决定的:Library 读路沿用第一张
 * (`apps/web/lib/library-elements.ts`)、Stuff 读路也沿用第一张、而 Brand 读路
 * (`packages/core/src/brand-records.ts:withProductIdentity`)直接当作没有主图。同一件产品于是
 * 有两张脸 —— 商家在 Library 看到一张图,在 Brand 页看到一个空位。
 *
 * 把「第一张即封面」写进**写路**就只需要一处:身份上钉的那一格从此永远是真的,四条读路
 * 一律照着它画,谁也不必再各自猜一遍(家规 §7.3 单一权威)。
 *
 * ── 不变量(这个函数是它的全部定义) ────────────────────────────────────────
 *   身份上钉的封面必须是一条**活着的基础层**参考图(`deletedAt IS NULL AND variantId IS NULL`);
 *   没钉过、或钉的那一条已经不在了,就钉**最早挂上的**那一张;一张都没有才是 NULL。
 *
 * 这一句话同时管住四种情形,所以调用处不需要分支:
 *   · 挂上第一张图      → 原本是 NULL ⇒ 钉上它(裁决的正面)。
 *   · 再挂第二、三张    → 已经钉着一条活的 ⇒ 一个字不动(不会把商家的封面换掉)。
 *   · 商家亲手换封面    → 换成的那张也是活的基础层参考图 ⇒ 一个字不动(「商家随时可换」)。
 *   · 拔掉当封面的那张  → 钉着的那条不再 live ⇒ 落到下一张,没有了才是 NULL。
 *
 * 幂等且**全量**:同一个实体连跑两次结果一样,所以它可以无脑挂在每一条挂图/拔图的尾巴上,
 * 不必判断「这次到底有没有改到封面」—— 判断正是上一版每条读路各写一遍的老毛病。
 *
 * ── 为什么只认 `variantId IS NULL` ─────────────────────────────────────────
 * 封面是**身份**的脸,而变体(EntityVariant)的图是那个变体的,不是身份的。Library 的读路
 * (`library-elements.ts`)与既有的拔图重指(`apps/web/lib/actions.ts:softDeleteReferenceImage`)
 * 本来就都只看基础层,这里逐字同一口径 —— 于是 refgen 生成变体图不会顶掉商家的产品封面。
 *
 * ── 排序:`position` 优先,`createdAt`/`id` 兜底 ────────────────────────────
 * 「最早挂上的那一张」按 (position, createdAt, id) 取。`position` 排第一是因为它就是商家在参考图
 * 那一排里**看到的**顺序(挂图时按 0,1,2… 顺序写),拿它当「第一张」与商家眼里的第一张是同一张;
 * `createdAt` 与 `id` 只做打平,保证同一个库跑两次拿到同一条(回填迁移逐字同一个 ORDER BY)。
 *
 * ── 钱与租户 ──────────────────────────────────────────────────────────────
 * 钱:一分不碰(PRODID-A10)。没有 reserve / settle / ledger。
 * 租户:`ownerId` 只能是调用方从服务端 principal 拿到的那一个,每一句 where 都带着它;
 *       跨租户改不动别人的封面(验收 PRODID-A9,测试逐条盯着)。
 */
import { Prisma } from "../generated/prisma/client.js";

/** 交互式事务里的 client;裸 `prisma` 也满足这个形状。 */
type Tx = Prisma.TransactionClient;

/**
 * 把这个身份的封面调回不变量(见文件头)。**挂图与拔图之后都要调一次**,而且要在同一个事务里
 * —— 挂了图却没钉上封面的那一瞬间若被别的读路看见,商家就会看到一件没有脸的产品。
 *
 * @returns 调完之后身份上钉着的那张图(没有任何参考图时是 `null`)。
 */
export async function reconcileEntityCover(
  tx: Tx,
  args: { ownerId: string; entityId: string },
): Promise<string | null> {
  const { ownerId, entityId } = args;

  const entity = await tx.entity.findFirst({
    where: { id: entityId, ownerId, deletedAt: null },
    select: { baseAssetId: true },
  });
  // 身份已被删(或根本不是自己的):没有可写的权威,不凭空造一条。
  if (!entity) return null;

  // 钉着的那一条还活着吗?活着就什么都不做 —— 商家亲手挑的封面在这里受保护。
  if (entity.baseAssetId) {
    const pinned = await tx.referenceImage.findFirst({
      where: { ownerId, entityId, assetId: entity.baseAssetId, variantId: null, deletedAt: null },
      select: { id: true },
    });
    if (pinned) return entity.baseAssetId;
  }

  // 没钉过,或钉的那张已经不在了 ⇒ 落到最早挂上的那一张(没有就是 NULL)。
  const earliest = await tx.referenceImage.findFirst({
    where: { ownerId, entityId, variantId: null, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { assetId: true },
  });
  const next = earliest?.assetId ?? null;
  if (next === (entity.baseAssetId ?? null)) return next;

  // `updateMany` 而不是 `update`:where 必须带 `ownerId`(tenant-guard 拒绝没有租户过滤的单行
  // update),那条过滤也正是跨租户改不动别人封面的凭据(PRODID-A9)。
  await tx.entity.updateMany({
    where: { id: entityId, ownerId, deletedAt: null },
    data: { baseAssetId: next },
  });
  return next;
}
