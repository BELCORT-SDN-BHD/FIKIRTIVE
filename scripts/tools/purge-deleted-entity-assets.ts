/**
 * purge-deleted-entity-assets —— 存量清理:补齐这次修复**之前**就已经被删掉的演员/元素
 * (`Entity.deletedAt` 不为 null)漏下的参考照 —— 当时 `softDeleteEntity` 只软删了 Entity
 * 那一行,底下的 `ReferenceImage` 行没有跟着被标记,存储桶里的字节自然也一直没人删过。
 *
 * 2026-09-03 staging 走查 S4(Founder 裁「现在就修」)——「商家的 data 商家的权利」。
 * 规格:`docs/specs/creation-engine.md` §5 变更登记 2026-09-03。
 *
 * 判据与 `apps/web/lib/asset-purge.ts`(`softDeleteEntity` / `softDeleteReferenceImage` 现在
 * 也在用的同一处权威)完全一致 —— 这里直接 import 复用那个函数,不另写一份(7.3 单一权威):
 * 一个候选 Asset 只有在**没有任何活的 ReferenceImage**(不分哪个实体/变体)、也**没有任何
 * Generation 行**(不分 deletedAt —— 生成历史永不物理删)指着它时,才算这批实体「独占」,
 * 才会被标记 deletedAt 并真删存储对象。共享引用只解引用(软删 ReferenceImage 那一行),
 * 从不动对象。账本(CreditLedger)与 GenJob 不在这条判据里,本脚本也从不碰它们。
 *
 * 幂等:处理过一次之后,同一批实体的 ReferenceImage 已经是 deletedAt 不为 null,不会再被
 * 选中 —— 重跑是空操作,可以放心重复执行(包括对同一个存储对象重复调用 deleteObject——
 * 两个驱动都把它定义成对已经不存在的对象的空操作)。
 *
 * 默认 DRY RUN:只打印计数(几个实体、几张参考照、几个资产可真删),不写任何一行、不删任何
 * 一个存储对象——包括「会被判定独占」这条计数,也是真的跑了一遍同样的事务再回滚算出来的,
 * 不是估算。真正执行要显式加 --apply。
 *
 * 输出只有计数,不打印 entity id、asset id、content hash 或 storage key 这类可能带租户/
 * 内容指纹的字符串。
 *
 * ── 为什么这里的 import 长这样 ──────────────────────────────────────────────
 * `scripts/` 不是 workspace 包,解析不到 `@fikirtive/*` 这样的裸标识符 —— 沿用仓库既有做法
 * (`scripts/ops/seed-actor-library.ts`):按绝对路径动态 import 各包的 `dist/`;
 * `apps/web/lib/asset-purge` 走相对路径,由 `apps/web` 的 node_modules 解析裸 import,
 * pnpm 的软链让两条路径落到同一个真实 Prisma 客户端。
 *
 * 跑法(仓库根;`--conditions=react-server` 满足 `asset-purge.ts` 顶部 `server-only` 标记的
 * 解析 —— 没有它 node 会在 import 的第一行就抛):
 *
 *   pnpm install && pnpm --filter "./packages/*" build
 *   DATABASE_URL=… node --conditions=react-server \
 *     --import ./apps/worker/node_modules/tsx/dist/loader.mjs \
 *     scripts/tools/purge-deleted-entity-assets.ts                 # dry run(默认)
 *   … 同上 … scripts/tools/purge-deleted-entity-assets.ts --apply   # 真删
 *   … 加 --owner <ownerId> 把范围收窄到一个租户(调试/staging 定点清理用)
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { purgeOrphanedReferenceAssets } from "../../apps/web/lib/asset-purge";

type PrismaClient = import("@prisma/client").PrismaClient;
type Storage = import("@fikirtive/storage").Storage;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distImport = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ownerFilter = flag("--owner");

type ExclusiveAsset = { id: string; ownerId: string; contentHash: string; ext: string };
type EntityStats = { refImagesFound: number; exclusiveAssets: ExclusiveAsset[] };

/** Dry-run mode still RUNS the real cascade inside a transaction (so the "would purge N
 *  assets" count is exact, not an estimate) — it just throws this to roll the writes back
 *  instead of letting the transaction commit. */
class DryRunRollback extends Error {
  constructor(public stats: EntityStats) {
    super("dry-run rollback — not a real failure");
  }
}

async function processEntity(
  prisma: PrismaClient,
  entity: { id: string; ownerId: string },
): Promise<EntityStats> {
  try {
    return await prisma.$transaction(async (tx) => {
      const liveRefs = await tx.referenceImage.findMany({
        where: { entityId: entity.id, ownerId: entity.ownerId, deletedAt: null },
        select: { assetId: true },
      });
      if (liveRefs.length === 0) return { refImagesFound: 0, exclusiveAssets: [] };

      await tx.referenceImage.updateMany({
        where: { entityId: entity.id, ownerId: entity.ownerId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      const exclusiveAssets = await purgeOrphanedReferenceAssets(
        tx as unknown as Parameters<typeof purgeOrphanedReferenceAssets>[0],
        entity.ownerId,
        liveRefs.map((r) => r.assetId),
      );
      const stats: EntityStats = { refImagesFound: liveRefs.length, exclusiveAssets };
      if (!apply) throw new DryRunRollback(stats); // roll back — dry run writes nothing
      return stats;
    });
  } catch (e) {
    if (e instanceof DryRunRollback) return e.stats;
    throw e;
  }
}

async function main(): Promise<void> {
  const { prisma } = (await distImport("packages/db/dist/src/index.js")) as { prisma: PrismaClient };
  const { storageKey } = (await distImport("packages/core/dist/index.js")) as {
    storageKey: (ownerId: string, contentHash: string, ext: string) => string;
  };
  const { createStorage } = (await distImport("packages/storage/dist/index.js")) as {
    createStorage: (localRoot: string) => Storage;
  };
  // Anchored to the repo root (not process.cwd()) so local-disk mode resolves correctly no
  // matter where this script is invoked from — STORAGE_DRIVER still picks r2 vs local disk.
  const storage = createStorage(path.join(ROOT, ".data", "storage"));

  try {
    await run(prisma, storage, storageKey);
  } finally {
    await prisma.$disconnect();
  }
}

async function run(
  prisma: PrismaClient,
  storage: Storage,
  storageKey: (ownerId: string, contentHash: string, ext: string) => string,
): Promise<void> {
  const entities = await prisma.entity.findMany({
    where: {
      deletedAt: { not: null },
      ...(ownerFilter ? { ownerId: ownerFilter } : {}),
      referenceImages: { some: { deletedAt: null } },
    },
    select: { id: true, ownerId: true },
    orderBy: { id: "asc" },
  });

  let entitiesWithLeftovers = 0;
  let refImagesTotal = 0;
  const exclusiveAssets: ExclusiveAsset[] = [];
  for (const entity of entities) {
    const stats = await processEntity(prisma, entity);
    if (stats.refImagesFound === 0) continue;
    entitiesWithLeftovers += 1;
    refImagesTotal += stats.refImagesFound;
    exclusiveAssets.push(...stats.exclusiveAssets);
  }

  console.log(`purge-deleted-entity-assets: ${apply ? "APPLY" : "DRY RUN"}${ownerFilter ? " (scoped to one owner)" : ""}`);
  console.log(`  soft-deleted entities scanned      : ${entities.length}`);
  console.log(`  entities with leftover live refs   : ${entitiesWithLeftovers}`);
  console.log(`  reference images ${apply ? "soft-deleted" : "that would be soft-deleted"}   : ${refImagesTotal}`);
  console.log(`  assets ${apply ? "purged (deletedAt set + object removed)" : "that would be purged (exclusive — no other live reference, never used by a Generation)"} : ${exclusiveAssets.length}`);

  if (!apply) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply to soft-delete those reference images,`);
    console.log(`mark their exclusive assets deletedAt, and delete the underlying storage objects.`);
    return;
  }

  let objectsDeleted = 0;
  let objectFailures = 0;
  for (const asset of exclusiveAssets) {
    try {
      await storage.deleteObject(storageKey(asset.ownerId, asset.contentHash, asset.ext));
      objectsDeleted += 1;
    } catch (e) {
      objectFailures += 1;
      console.error("  storage delete failed for one asset:", e instanceof Error ? e.message : e);
    }
  }
  console.log(`  storage objects deleted            : ${objectsDeleted}${objectFailures > 0 ? ` (${objectFailures} failed — re-run this script to retry; deleteObject is a no-op on an already-missing object)` : ""}`);
  if (objectFailures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("purge-deleted-entity-assets: run failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
