/**
 * /api/ready — **READINESS**(就绪):这个容器该不该接流量。
 *
 * #796 判官 r1 P1-2。启动脚本在迁移跑不成时仍然把站点起起来(旧结构上的站点强过没有站点),
 * 但 r1 只做了一半:它把这件事写进 `/api/health` 的 body,而那个端点照样回 200。
 * 于是在一次**滚动发布**里,平台看到新容器「健康」,就把流量从好用的旧容器切了过来 ——
 * 新代码跑在旧结构上,商家看到的是一堆报错。等于说「起得来就算好」,而那正是错的。
 *
 * 分成两个端点之后,两件事各归各:
 *   - `/api/health`(存活)—— 进程还活着吗。**平台的重启探针**指这里。回 200 就别重启我。
 *   - `/api/ready`(就绪)—— 我能接流量吗。**平台的部署/负载探针**指这里。
 *     迁移没跑成 ⇒ 503 ⇒ 新容器不接流量,**旧部署继续承载**,直到人把迁移修好。
 *
 * 免鉴权(proxy.ts matcher 已排除),与 /api/health 同样零敏感数据。
 */
import { prisma } from "@fikirtive/db";
import { READY_DATABASE_TIMEOUT_MS, bestEffort, singleFlight } from "@/lib/health";
import { bootMigrationStatus } from "@/lib/boot-status";

export const dynamic = "force-dynamic";

/**
 * 就绪探针也必须**有界**且**不堆积**(#796 判官 r3 P2-1 的同一条道理)。
 *
 * 它跟存活探针不同的地方只有一处:这里 DB 查不通就是「没准备好」,该回 503。相同的地方是
 * 两条 —— 不许无限期挂着(挂住 = 探针超时,平台照样判不就绪,但我们已经白占了一条连接),
 * 也不许每来一次探针就多积一个永不结束的查询。所以同样是 single-flight + 有界等待。
 */
const pingDatabase = singleFlight(async () => {
  await prisma.$queryRaw`SELECT 1`;
  return true as const;
});

export async function GET(): Promise<Response> {
  const migrations = bootMigrationStatus(process.env);
  // 迁移没跑成:进程活着,但没准备好。先答,不必去碰数据库 —— 这个判断跟 DB 无关。
  if (migrations === "failed") {
    return Response.json(
      { ready: false, reason: "migrations-not-applied", db: "unknown", migrations },
      { status: 503 },
    );
  }
  // 连不上、或久到不回话的数据库:容器接了流量也只会回一堆 500 —— 同样不该被切过去。
  const reachable = await bestEffort(pingDatabase, READY_DATABASE_TIMEOUT_MS);
  if (!reachable) {
    return Response.json({ ready: false, reason: "database-unreachable", db: "down", migrations }, { status: 503 });
  }
  return Response.json({ ready: true, db: "up", migrations }, { status: 200 });
}
