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
 * 一个存储对象——包括「会被判定独占」这条计数,也是真的把全部候选实体按 --apply 会发生的
 * 同一个顺序在同一个事务里跑一遍再整体回滚算出来的(2026-09-03 判官第一轮复审 P1-6:旧版
 * 每个实体各开各的事务、各自独立回滚,会在「两个已删实体共享同一张照片」这种输入下把
 * dry-run 的数算少——见 runDryRunSimulation 的 doc 注释),不是估算,也不是分实体各自回滚
 * 拼出来的近似值。真正执行要显式加 --apply。
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
 *
 * 2026-09-03 判官第一轮复审 P1-7 —— 不带 `--owner` 的默认模式(平台全量扫)之前会被
 * `packages/db/src/tenant-guard.ts` 拒绝:列出「哪些已软删实体还漏着活参考照」这条查询没有
 * 单一租户,租户闸看不到任何 ownerId 就 fail closed。修法:这一条跨租户列表读现在包在
 * `runAsSystem("entity-asset-purge-sweep", …)` 里(见 `packages/db/src/principal.ts`)——
 * 仅此一条读是系统帧,下游每一条按实体/资产处理的查询本来就自带显式 `ownerId` 过滤,不需要
 * 也没有再套租户帧。
 *
 * 2026-09-03 判官第一轮复审 P1-3 / P1-5 —— 第二阶段「遗留字节重扫」:凡是 `Asset.deletedAt`
 * 已经非空、但存储对象仍然在(不管这一行是这个脚本上一趟自己删失败留下的,还是
 * `apps/web/lib/asset-purge.ts` 的 `softDeleteEntity`/`softDeleteReferenceImage` 那条动作
 * 路径删失败留下的——两条路径的失败留痕判据完全一样,都是「deletedAt 非空 + 对象仍在」),
 * 这里都会重新尝试删一次,幂等,可无限重跑。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { purgeOrphanedReferenceAssets } from "../../apps/web/lib/asset-purge";

type PrismaClient = import("@prisma/client").PrismaClient;
type Storage = import("@fikirtive/storage").Storage;
type RunAsSystem = <T>(reason: "entity-asset-purge-sweep", fn: () => T) => T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distImport = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

const args = process.argv.slice(2);
const apply = args.includes("--apply");
// P2-4(判官第二轮复审):`--owner --apply`(漏写了 owner 的值,下一个 token 恰好是另一个
// flag)之前会被静默当成 `ownerFilter = "--apply"` —— 不是真实 ownerId,查不到任何实体,
// 脚本会"成功"跑完但什么都没扫到,像是数据库空空如也而不是命令行打错了字。value 若以
// `--` 开头就当作缺值,直接报错退出,不静默空转。
const flag = (name: string): string | null => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} needs a value (got ${value === undefined ? "nothing" : `"${value}"`} — looks like a missing/misplaced argument)`);
  }
  return value;
};
const ownerFilter = flag("--owner");

type ExclusiveAsset = { id: string; ownerId: string; contentHash: string; ext: string };
type EntityStats = { refImagesFound: number; exclusiveAssets: ExclusiveAsset[] };
type Tx = Parameters<typeof purgeOrphanedReferenceAssets>[0];

/** P1-6(判官第一轮复审)—— shared per-entity step, used by BOTH the apply loop and the dry-run
 *  simulation below, so they run byte-for-byte the same logic; only the TRANSACTION SHAPE
 *  wrapped around calls to this differs between them. */
async function processEntityInTx(tx: Tx, entity: { id: string; ownerId: string }): Promise<EntityStats> {
  const liveRefs = await tx.referenceImage.findMany({
    where: { entityId: entity.id, ownerId: entity.ownerId, deletedAt: null },
    select: { assetId: true },
  });
  if (liveRefs.length === 0) return { refImagesFound: 0, exclusiveAssets: [] };

  await tx.referenceImage.updateMany({
    where: { entityId: entity.id, ownerId: entity.ownerId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  const exclusiveAssets = await purgeOrphanedReferenceAssets(tx, entity.ownerId, liveRefs.map((r) => r.assetId));
  return { refImagesFound: liveRefs.length, exclusiveAssets };
}

/** APPLY mode: one COMMITTED transaction per entity — a later entity throwing must not undo
 *  an earlier entity's already-durable soft-delete/purge. */
async function processEntityApply(prisma: PrismaClient, entity: { id: string; ownerId: string }): Promise<EntityStats> {
  return prisma.$transaction((tx) => processEntityInTx(tx as unknown as Tx, entity));
}

/** Always-thrown sentinel that rolls the dry-run simulation transaction back without treating
 *  it as a real failure. */
class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback — not a real failure");
  }
}

/**
 * DRY RUN mode. P1-6(判官第一轮复审)—— 旧版每个实体各开各的事务、各自独立回滚:「两个已经
 * deletedAt 的实体共享同一张还活着的照片」这种输入下,dry-run 会把它算成「不独占,不会被
 * 真删」,因为每个实体单独看的时候,另一个实体的软删从未真正提交过,它永远还看得见对方那条
 * 活引用;而 --apply 真跑起来,第一个实体的软删是真提交的,第二个实体处理时就会发现「没有
 * 活引用了」从而真删——dry-run 报的数比真实会发生的少,数字不可信。
 *
 * 修法:dry-run 也让全部实体按 apply 会发生的**同一个顺序**在**同一个事务**里依次处理
 * (这样第 N 个实体的软删对第 N+1 个实体的检查可见,跟 apply 分开提交时的可见性完全一致),
 * 最后整个事务一次性回滚,不落一行、不删一个对象。
 *
 * 2026-09-03 判官第二轮复审(P2 顺手记录,登记 issue #359)——已知代价:全部候选实体挤进
 * **一个**事务意味着这一次 dry-run 最长可能握住这份连带的行锁/事务连接长达 `timeout`
 * (120s)。存量足够大的平台级扫(尤其不带 --owner)会比旧版「一实体一事务」更长时间占着一条
 * 数据库连接。目前认为可接受(dry-run 是运维手动跑的一次性命令,不是常驻服务路径),但如果
 * 平台数据量涨到让这个变成真实痛点,需要重新考虑(比如分批,每批一个大事务)。
 */
async function runDryRunSimulation(
  prisma: PrismaClient,
  entities: readonly { id: string; ownerId: string }[],
): Promise<{ entitiesWithLeftovers: number; refImagesTotal: number; exclusiveAssets: ExclusiveAsset[] }> {
  let entitiesWithLeftovers = 0;
  let refImagesTotal = 0;
  const exclusiveAssets: ExclusiveAsset[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const entity of entities) {
          const stats = await processEntityInTx(tx as unknown as Tx, entity);
          if (stats.refImagesFound === 0) continue;
          entitiesWithLeftovers += 1;
          refImagesTotal += stats.refImagesFound;
          exclusiveAssets.push(...stats.exclusiveAssets);
        }
        throw new DryRunRollback(); // always roll back — dry run writes nothing, ever
      },
      { timeout: 120_000, maxWait: 10_000 }, // a platform-wide sweep may walk many entities in sequence
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return { entitiesWithLeftovers, refImagesTotal, exclusiveAssets };
}

async function main(): Promise<void> {
  const { prisma } = (await distImport("packages/db/dist/src/index.js")) as { prisma: PrismaClient };
  const { storageKey } = (await distImport("packages/core/dist/index.js")) as {
    storageKey: (ownerId: string, contentHash: string, ext: string) => string;
  };
  const { createStorage } = (await distImport("packages/storage/dist/index.js")) as {
    createStorage: (localRoot: string) => Storage;
  };
  const { runAsSystem } = (await distImport("packages/db/dist/src/principal.js")) as {
    runAsSystem: RunAsSystem;
  };
  // Anchored to the repo root (not process.cwd()) so local-disk mode resolves correctly no
  // matter where this script is invoked from — STORAGE_DRIVER still picks r2 vs local disk.
  const storage = createStorage(path.join(ROOT, ".data", "storage"));

  try {
    await run(prisma, storage, storageKey, runAsSystem);
  } finally {
    await prisma.$disconnect();
  }
}

async function run(
  prisma: PrismaClient,
  storage: Storage,
  storageKey: (ownerId: string, contentHash: string, ext: string) => string,
  runAsSystem: RunAsSystem,
): Promise<void> {
  // P1-7: the ONLY cross-tenant query in this script (no ownerId filter when --owner is
  // omitted) — wrapped in the read-only system frame; everything downstream already carries
  // an explicit ownerId and needs no frame of its own.
  const entities = await runAsSystem("entity-asset-purge-sweep", () =>
    prisma.entity.findMany({
      where: {
        deletedAt: { not: null },
        ...(ownerFilter ? { ownerId: ownerFilter } : {}),
        referenceImages: { some: { deletedAt: null } },
      },
      select: { id: true, ownerId: true },
      orderBy: { id: "asc" },
    }),
  );

  // P1-6: apply commits each entity's own transaction as it goes (so a later entity sees an
  // earlier one's already-durable state); dry-run simulates that exact same visibility inside
  // one big transaction it rolls back at the end — see runDryRunSimulation's doc comment.
  let entitiesWithLeftovers: number;
  let refImagesTotal: number;
  let exclusiveAssets: ExclusiveAsset[];
  if (apply) {
    entitiesWithLeftovers = 0;
    refImagesTotal = 0;
    exclusiveAssets = [];
    for (const entity of entities) {
      const stats = await processEntityApply(prisma, entity);
      if (stats.refImagesFound === 0) continue;
      entitiesWithLeftovers += 1;
      refImagesTotal += stats.refImagesFound;
      exclusiveAssets.push(...stats.exclusiveAssets);
    }
  } else {
    ({ entitiesWithLeftovers, refImagesTotal, exclusiveAssets } = await runDryRunSimulation(prisma, entities));
  }

  console.log(`purge-deleted-entity-assets: ${apply ? "APPLY" : "DRY RUN"}${ownerFilter ? " (scoped to one owner)" : ""}`);
  console.log(`  soft-deleted entities scanned      : ${entities.length}`);
  console.log(`  entities with leftover live refs   : ${entitiesWithLeftovers}`);
  console.log(`  reference images ${apply ? "soft-deleted" : "that would be soft-deleted"}   : ${refImagesTotal}`);
  // P2-1: this line only ever reports how many assets became exclusive (deletedAt set) — it
  // must NOT claim the object is gone too; the real, post-deletion object count is its own
  // line below ("storage objects deleted"), computed only after the delete loop runs.
  console.log(`  assets ${apply ? "marked deletedAt (exclusive)" : "that would be purged (exclusive — no other live reference, never used by a Generation)"} : ${exclusiveAssets.length}`);

  let objectFailuresThisRun = 0;
  if (apply) {
    let objectsDeleted = 0;
    for (const asset of exclusiveAssets) {
      try {
        await storage.deleteObject(storageKey(asset.ownerId, asset.contentHash, asset.ext));
        objectsDeleted += 1;
      } catch (e) {
        objectFailuresThisRun += 1;
        console.error("  storage delete failed for one asset:", e instanceof Error ? e.message : e);
      }
    }
    console.log(`  storage objects deleted            : ${objectsDeleted}${objectFailuresThisRun > 0 ? ` (${objectFailuresThisRun} failed — the leftover sweep below retries them; re-run --apply to retry sooner)` : ""}`);
  }

  // P1-3 / P1-5: retry pass for ANY Asset already tombstoned (deletedAt set) whose object is
  // still physically present — whether that's this script's own earlier --apply failure, or
  // apps/web/lib/asset-purge.ts's live softDeleteEntity/softDeleteReferenceImage action path
  // swallowing a storage.deleteObject failure. Same predicate either way, so one sweep covers
  // both. Runs every invocation (dry run only counts; --apply also deletes).
  const leftover = await sweepLeftoverTombstonedAssets(prisma, storage, storageKey, runAsSystem);
  console.log(`  tombstoned assets with bytes still present : ${leftover.checked}`);
  if (apply) {
    console.log(`  leftover objects purged this run           : ${leftover.purged}${leftover.failed > 0 ? ` (${leftover.failed} still failing — re-run to retry)` : ""}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply to soft-delete those reference images,`);
    console.log(`mark their exclusive assets deletedAt, and delete the underlying storage objects.`);
    return;
  }

  if (objectFailuresThisRun > 0 || leftover.failed > 0) process.exitCode = 1;
}

/**
 * P1-3 / P1-5 —— second-phase retry. Lists every Asset row this owner scope has already
 * tombstoned, and for any whose object is STILL on disk/R2, retries the delete (after a
 * per-row re-check, same shape as asset-purge.ts's P1-2 fix, in case a re-upload resurrected
 * it between the listing and now). Idempotent: an already-deleted object's `storage.exists`
 * check alone excludes it, no delete attempt at all.
 *
 * 2026-09-03 判官第二轮复审(P2 顺手记录,登记 issue #359)——判据故意比 asset-purge.ts 的
 * 单一权威(`purgeOrphanedReferenceAssets`:无活 ReferenceImage + 无 Generation)更宽:这里
 * 只看 `Asset.deletedAt IS NOT NULL`,不重新核验「无引用/无 Generation」。这是刻意的,不是
 * 疏漏——deletedAt 本身就是那条判据算完之后才会被打上的墓碑(唯一的写手是
 * purgeOrphanedReferenceAssets 那次 updateMany),这条重扫信的是"这行已经被判过一次独占",
 * 不是重新去判。前提仍然是 assetUpsert 是唯一的复活路径(见 asset-purge.ts 顶部注释的同一条
 * 已知边界)——这条重扫和那条边界共享同一个假设,不是两条互相独立的信任来源。
 */
async function sweepLeftoverTombstonedAssets(
  prisma: PrismaClient,
  storage: Storage,
  storageKey: (ownerId: string, contentHash: string, ext: string) => string,
  runAsSystem: RunAsSystem,
): Promise<{ checked: number; purged: number; failed: number }> {
  const tombstoned = await runAsSystem("entity-asset-purge-sweep", () =>
    prisma.asset.findMany({
      where: { deletedAt: { not: null }, ...(ownerFilter ? { ownerId: ownerFilter } : {}) },
      select: { id: true, ownerId: true, contentHash: true, ext: true },
      orderBy: { id: "asc" },
    }),
  );

  let checked = 0;
  let purged = 0;
  let failed = 0;
  for (const asset of tombstoned) {
    const key = storageKey(asset.ownerId, asset.contentHash, asset.ext);
    if (!(await storage.exists(key))) continue; // already gone — nothing to retry
    checked += 1;
    if (!apply) continue; // dry run: count only, touch nothing

    // re-check right before deleting: a re-upload (assetUpsert) may have resurrected this row
    // between the listing above and now — explicit ownerId in the where, so no principal
    // frame is needed for this read (mirrors every other query in this script).
    const fresh = await prisma.asset.findFirst({
      where: { id: asset.id, ownerId: asset.ownerId },
      select: { deletedAt: true },
    });
    if (!fresh || fresh.deletedAt === null) continue; // resurrected — do not touch the bytes

    try {
      await storage.deleteObject(key);
      purged += 1;
    } catch (e) {
      failed += 1;
      console.error("  leftover-sweep storage delete failed for one asset:", e instanceof Error ? e.message : e);
    }
  }
  return { checked, purged, failed };
}

main().catch((e) => {
  console.error("purge-deleted-entity-assets: run failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
