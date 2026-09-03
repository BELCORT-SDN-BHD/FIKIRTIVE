import "server-only";
import { type Prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import { storage } from "./storage";

/**
 * 2026-09-03 staging 走查 S4(Founder 裁「现在就修」)——「商家的 data 商家的权利」:商家删掉
 * 演员库/素材库里的一张参考照,存储桶里的字节也必须真的没了,不能只是数据库那一行被隐藏。
 *
 * 判据(共享给 softDeleteEntity / softDeleteReferenceImage / 存量清理脚本三处调用方,7.3
 * 单一权威 —— 别处不得各写一份):候选 Asset 在**这一批**引用被软删之后仍然「独占」(可以
 * 真删对象),当且仅当没有任何东西还指着它 ——
 *   · 没有任何**活的** ReferenceImage 行(不分哪个 entity / variant)—— 同一张照片被去重
 *     挂在两个实体上,或者又被设成某个变体的照片,删掉其中一处不能带走另一处还在用的字节;
 *   · 没有任何 Generation 行,不分 deletedAt —— Generation 的合同是「不可变，永不物理删」
 *     (schema.prisma:345「生成历史：不可变（永不物理删）」),Asset 行本身就是为了这条合同
 *     才活成墓碑(schema.prisma:178「Generation FK Restrict 使行删除永不可行——这是设计而非
 *     缺陷」)。在一个(哪怕已软删的)Generation 底下抽走字节等于替这条合同违约。
 *
 * 账本(CreditLedger)与 GenJob 记录不在这条判据里,这里也从不碰它们 —— 这不是一条钱路。
 */

/**
 * 在调用方已经打开的事务里,把这一批候选 assetId 中「独占」的那些标记 deletedAt。
 * 必须与「把 ReferenceImage 标成 deletedAt」的那一步同一个事务:判「独占」的这一刻与
 * 「引用消失」的那一刻如果隔着两个事务,中间就会有一个窗口——同一时刻另一个请求正在把同一张
 * 照片重新挂到另一个实体上,窗口内的一次读会把它误判成孤儿。
 *
 * 只标行,不动存储字节(storage 的调用不属于数据库事务——见下面的 purgeAssetStorage)。
 * 返回被标记的那些行(带 contentHash/ext,够调用方在事务提交之后拼出 storage key)。
 */
export async function purgeOrphanedReferenceAssets(
  tx: Prisma.TransactionClient,
  ownerId: string,
  candidateAssetIds: readonly string[],
): Promise<{ id: string; ownerId: string; contentHash: string; ext: string }[]> {
  const unique = [...new Set(candidateAssetIds)];
  if (unique.length === 0) return [];

  const [stillReferenced, everGenerated] = await Promise.all([
    tx.referenceImage.findMany({
      where: { assetId: { in: unique }, ownerId, deletedAt: null },
      select: { assetId: true },
    }),
    tx.generation.findMany({
      where: { assetId: { in: unique }, ownerId },
      select: { assetId: true },
    }),
  ]);
  const shared = new Set<string>([
    ...stillReferenced.map((r) => r.assetId),
    ...everGenerated.map((g) => g.assetId),
  ]);
  const exclusiveIds = unique.filter((id) => !shared.has(id));
  if (exclusiveIds.length === 0) return [];

  const assets = await tx.asset.findMany({
    where: { id: { in: exclusiveIds }, ownerId, deletedAt: null },
    select: { id: true, ownerId: true, contentHash: true, ext: true },
  });
  if (assets.length === 0) return [];

  await tx.asset.updateMany({
    where: { id: { in: assets.map((a) => a.id) }, ownerId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return assets;
}

/**
 * 物理删掉刚被 purgeOrphanedReferenceAssets(或存量清理脚本)标了 deletedAt 的那些资产的
 * 存储字节。放在事务**提交之后**调用——一次 R2/磁盘 IO 不属于 Postgres 事务。
 *
 * 逐条 best-effort:一条失败不拦下其余几条(商家这次删除的十张参考照,不该因为其中一张
 * 撞上一次网络抖动就整单看起来失败)。失败只记日志,不抛出——DB 侧那一行已经标了
 * deletedAt,是权威判据;`scripts/tools/purge-deleted-entity-assets.ts` 就是这条重试路径:
 * 它按同一个 Asset 行重新算出同一个 key 再删一次,而 deleteObject 对已经不存在的对象是
 * 一次空操作(两个驱动的合同都是如此),所以重跑永远安全。
 */
export async function purgeAssetStorage(
  assets: readonly { ownerId: string; contentHash: string; ext: string }[],
): Promise<void> {
  for (const asset of assets) {
    try {
      await storage.deleteObject(storageKey(asset.ownerId, asset.contentHash, asset.ext));
    } catch (e) {
      console.error("[asset-purge] storage.deleteObject failed:", e instanceof Error ? e.message : e);
    }
  }
}
