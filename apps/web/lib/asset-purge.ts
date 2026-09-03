import "server-only";
import { prisma, type Prisma } from "@fikirtive/db";
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
 *
 * 2026-09-03 判官第一轮复审 P1-1 —— 「同一个事务」本身还不够:判「独占」是先读
 * ReferenceImage/Generation 再写 Asset.deletedAt,读与写之间即使在同一事务里也有一段没有
 * 锁的窗口。这段窗口内,另一个并发事务把一条新的 ReferenceImage 挂到这个 assetId 上——它的
 * 外键 `ReferenceImage.assetId → Asset.[id, ownerId]` 插入前会先对被引用的 Asset 行要一把
 * `FOR KEY SHARE` 锁(Postgres 对外键引用的父行做的锁,不是我们额外加的)——如果我们自己先
 * 对这些候选 Asset 行拿一把 `FOR UPDATE`(与 `FOR KEY SHARE` 互斥),那笔并发插入就会一直
 * 卡在这里,直到我们的事务提交或回滚,判「独占」这一刻起就再也不会被中途插进来的引用打破。
 * 与 `packages/db/src/credits.ts` 的 `lockOrgForAdjust`(同一个「先排他锁、再判断」形状,
 * 那边的注释把这条 Postgres 行为写得更细)同一套手法,不是新发明。
 */
export async function purgeOrphanedReferenceAssets(
  tx: Prisma.TransactionClient,
  ownerId: string,
  candidateAssetIds: readonly string[],
): Promise<{ id: string; ownerId: string; contentHash: string; ext: string }[]> {
  const unique = [...new Set(candidateAssetIds)];
  if (unique.length === 0) return [];

  // 锁必须是判「独占」的第一步,不是先读再补锁——先锁住这些候选行(顺带把 ownerId/
  // deletedAt IS NULL 的过滤一起做了,不满足的行直接不在锁定结果里),后面所有的
  // 「还有没有人指着它」的判断都在锁已经拿到之后才做。
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Asset"
    WHERE "id" = ANY(${unique}::text[]) AND "ownerId" = ${ownerId} AND "deletedAt" IS NULL
    FOR UPDATE
  `;
  if (locked.length === 0) return [];
  const lockedIds = locked.map((r) => r.id);

  const [stillReferenced, everGenerated] = await Promise.all([
    tx.referenceImage.findMany({
      where: { assetId: { in: lockedIds }, ownerId, deletedAt: null },
      select: { assetId: true },
    }),
    tx.generation.findMany({
      where: { assetId: { in: lockedIds }, ownerId },
      select: { assetId: true },
    }),
  ]);
  const shared = new Set<string>([
    ...stillReferenced.map((r) => r.assetId),
    ...everGenerated.map((g) => g.assetId),
  ]);
  const exclusiveIds = lockedIds.filter((id) => !shared.has(id));
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
 * 撞上一次网络抖动就整单看起来失败)。
 *
 * 2026-09-03 判官第一轮复审 P1-2 —— 事务提交与这里的真删之间有一个窗口:唯一能把
 * `Asset.deletedAt` 改回 null 的路径是 `assetUpsert`(`actions.ts`)——同一 owner、同一内容
 * 哈希的一次重新上传会在**它自己的事务里**先复活这一行再挂新的 ReferenceImage,两步同一个
 * 事务提交才对外可见。所以这里只需要在真删前重读一次这一行的 deletedAt:仍非空就说明从
 * `purgeOrphanedReferenceAssets` 判定独占的那一刻起没有任何重新上传复活过它,可以真删;
 * 已经变回 null 就是被复活了,这份字节现在是别人正在用的那份内容,必须跳过。
 *
 * 2026-09-03 判官第一轮复审 P1-3 —— 删除失败(catch 分支)只记日志、不重试的问题,不在这里
 * 加 schema 或新表:`scripts/tools/purge-deleted-entity-assets.ts` 现在会另跑一趟「凡是
 * deletedAt 非空但对象仍在」的重扫(不管这一行是这个脚本自己漏删的、还是这条动作路径删
 * 失败留下的,判据完全一样),这条 console.error 就是那趟重扫要捞的痕迹——留痕但不假装
 * 「已经处理好了」:action 对商家仍然诚实地回「已删除」(数据库那一行已经是权威的 deletedAt
 * 墓碑),但字节层面的失败在服务端是可发现、可重跑的,不是无声消失。
 */
export async function purgeAssetStorage(
  assets: readonly { id: string; ownerId: string; contentHash: string; ext: string }[],
): Promise<void> {
  for (const asset of assets) {
    const fresh = await prisma.asset.findFirst({
      where: { id: asset.id, ownerId: asset.ownerId },
      select: { deletedAt: true },
    });
    if (!fresh || fresh.deletedAt === null) continue; // resurrected by a re-upload — do not touch the bytes
    try {
      await storage.deleteObject(storageKey(asset.ownerId, asset.contentHash, asset.ext));
    } catch (e) {
      // 留痕但不重试于此处——见上方 P1-3:scripts/tools/purge-deleted-entity-assets.ts 的
      // 「deletedAt 非空但对象仍在」重扫是这条失败的权威重试路径。
      console.error("[asset-purge] storage.deleteObject failed (will be retried by the leftover sweep in scripts/tools/purge-deleted-entity-assets.ts):", e instanceof Error ? e.message : e);
    }
  }
}
