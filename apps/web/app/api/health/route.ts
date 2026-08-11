/**
 * /api/health — 外部监控的探测点(2026-07-04 盲区修复:此前 prod 出故障没有任何
 * 东西会通知 founder)。免鉴权(proxy.ts matcher 已排除),零敏感数据:只报
 * up/stale/unknown,不暴露计数或配置。
 *
 * 约定:HTTP 200 = web + DB 活着(worker 状态在 body 里,监控服务用关键词告警
 * "\"worker\":\"up\"");HTTP 503 = DB 不可达(web 本身还活着才答得出 503)。
 * 接法见 docs/ops/incident-visibility.md。
 *
 * #796 新增 `migrations`:`"applied"` = 本次启动的迁移已就位;`"failed"` = 迁移没跑成,
 * 站点是在**旧 schema** 上带病运行的(见 apps/web/scripts/boot.mjs 里那条选择及其代价)。
 * 它仍然回 200 —— 站点确实活着,谎报 503 会让监控和 Railway 都误判 —— 所以这个关键词
 * 就是那条选择的安全带,监控要盯 `"migrations":"applied"` 是否还在。
 */
import { prisma } from "@fikirtive/db";
import { workerStatus } from "@/lib/health";
import { bootMigrationStatus } from "@/lib/boot-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const migrations = bootMigrationStatus(process.env);
  try {
    const hb = await prisma.workerHeartbeat.findUnique({ where: { id: "worker" } });
    return Response.json({ ok: true, db: "up", worker: workerStatus(hb?.at ?? null, new Date()), migrations }, { status: 200 });
  } catch {
    return Response.json({ ok: false, db: "down", worker: "unknown", migrations }, { status: 503 });
  }
}
