/**
 * **给存量 org 补播演员库五人**(CREATE-A10;规格 `docs/specs/creation-engine.md` §8.1③)。
 *
 * 新 org 在引导时(`bootstrapPersonalOrg`)就自动播好了。这个脚本管的是**演员库上线之前
 * 就已经存在**的那些 org —— 它们不会再走一次引导,所以库里是空的,而 A9 的拦截会告诉
 * 商家「去 Library 里挑一位」。一次性跑一遍,把话补齐。
 *
 * 用的是 `apps/web/lib/actor-library-seed.ts` 里**同一个** `seedActorLibrary`,不另写一份
 * 播种逻辑:入库形状、像素完整性核对、幂等口径只能有一处(7.3)。
 *
 * 幂等:每个 org 已有的演员按 `(ownerId, catalogKey)` 跳过,重跑安全。
 * 只写自己那一份目录数据(Asset / Entity / ReferenceImage),不碰钱、不碰租户成员关系、
 * 不删任何东西。
 *
 * ── 为什么这里的 import 长这样 ──────────────────────────────────────────────
 * `scripts/` 不是 workspace 包,解析不到 `@fikirtive/*` 这样的裸标识符。仓库里既有的做法
 * (`scripts/check-margin-floor.mjs`)是按绝对路径动态 import 各包的 `dist/` —— 这里沿用它。
 * `apps/web/lib/actor-library-seed` 走相对路径,它自己的裸 import 由 apps/web 的
 * node_modules 解析;pnpm 的软链让两条路径落到同一个真实文件,所以 Prisma 客户端只有一份。
 *
 * 跑法(仓库根;`--conditions=react-server` 是给 `server-only` 标记包用的,
 * 没有它 node 会在 import 的第一行就抛):
 *
 *   pnpm install && pnpm --filter "./packages/*" build
 *   DATABASE_URL=… node --conditions=react-server \
 *     --import ./apps/worker/node_modules/tsx/dist/loader.mjs \
 *     scripts/ops/seed-actor-library.ts [--dry-run]
 *
 * `--dry-run` 只列出每个 org 现在有几位,不写任何一行。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedActorLibrary } from "../../apps/web/lib/actor-library-seed";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distImport = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

const dryRun = process.argv.includes("--dry-run");

// 顶层 await 用不了(仓库根没有 "type": "module",tsx 按 CJS 转译这个目录),
// 所以两份 dist 在 main 里取。
async function main(): Promise<void> {
  const { prisma } = (await distImport("packages/db/dist/src/index.js")) as {
    prisma: import("@prisma/client").PrismaClient;
  };
  const { ACTOR_LIBRARY } = (await distImport("packages/core/dist/actor-library.js")) as {
    ACTOR_LIBRARY: readonly { catalogKey: string }[];
  };
  try {
    await run(prisma, ACTOR_LIBRARY);
  } finally {
    await prisma.$disconnect();
  }
}

async function run(
  prisma: import("@prisma/client").PrismaClient,
  ACTOR_LIBRARY: readonly { catalogKey: string }[],
): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  console.log(`actor-library: ${orgs.length} live org(s); ${ACTOR_LIBRARY.length} cast members per org`);

  let seeded = 0;
  let skipped = 0;
  let failed = 0;
  for (const org of orgs) {
    if (dryRun) {
      const have = await prisma.entity.count({
        where: { ownerId: org.id, catalogKey: { not: null }, deletedAt: null },
      });
      console.log(`  [dry-run] ${org.id}: ${have}/${ACTOR_LIBRARY.length} already in library`);
      continue;
    }
    const result = await seedActorLibrary(org.id);
    seeded += result.seeded.length;
    skipped += result.skipped.length;
    failed += result.failed.length;
    console.log(
      `  ${org.id}: seeded ${result.seeded.length}, skipped ${result.skipped.length}, failed ${result.failed.length}`,
    );
  }

  if (!dryRun) {
    console.log(`actor-library: done — seeded ${seeded}, skipped ${skipped}, failed ${failed}`);
    // 有失败就用非零码退出:ops 跑完要能一眼看出「还有人没进库」,而不是靠翻日志。
    if (failed > 0) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("actor-library: seeding run failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
