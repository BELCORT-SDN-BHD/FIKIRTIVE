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
import { bootMigrationStatus } from "@/lib/boot-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const migrations = bootMigrationStatus(process.env);
  // 迁移没跑成:进程活着,但没准备好。先答,不必去碰数据库 —— 这个判断跟 DB 无关。
  if (migrations === "failed") {
    return Response.json(
      { ready: false, reason: "migrations-not-applied", db: "unknown", migrations },
      { status: 503 },
    );
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ready: true, db: "up", migrations }, { status: 200 });
  } catch {
    // 连不上数据库的容器接了流量也只会回一堆 500 —— 同样不该被切过去。
    return Response.json({ ready: false, reason: "database-unreachable", db: "down", migrations }, { status: 503 });
  }
}
