/**
 * /api/health — 外部监控的探测点(2026-07-04 盲区修复:此前 prod 出故障没有任何
 * 东西会通知 founder)。免鉴权(proxy.ts matcher 已排除),零敏感数据:只报
 * up/stale/unknown,不暴露计数或配置。
 *
 * 约定:HTTP 200 = web + DB 活着(worker 状态在 body 里,监控服务用关键词告警
 * "\"worker\":\"up\"");HTTP 503 = DB 不可达(web 本身还活着才答得出 503)。
 * 接法见 docs/ops/incident-visibility.md。
 */
import { prisma } from "@fikirtive/db";
import { workerStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const hb = await prisma.workerHeartbeat.findUnique({ where: { id: "worker" } });
    return Response.json({ ok: true, db: "up", worker: workerStatus(hb?.at ?? null, new Date()) }, { status: 200 });
  } catch {
    return Response.json({ ok: false, db: "down", worker: "unknown" }, { status: 503 });
  }
}
