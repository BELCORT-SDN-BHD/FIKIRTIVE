/**
 * /api/health — **LIVENESS**(存活):这个进程还答不答得出话。
 *
 * 2026-07-04 盲区修复:此前 prod 出故障没有任何东西会通知 founder。免鉴权
 * (proxy.ts matcher 已排除),零敏感数据:只报 up/stale/unknown,不暴露计数或配置。
 *
 * 约定:HTTP 200 = web + DB 活着(worker 状态在 body 里,监控服务用关键词告警
 * "\"worker\":\"up\"");HTTP 503 = DB 不可达(web 本身还活着才答得出 503)。
 * 接法见 docs/ops/incident-visibility.md。
 *
 * ⚠️ **平台的部署健康探针要指 `/api/ready`,不是这里**(#796 判官 r1 P1-2)。
 * 存活和就绪是两件事:迁移没跑成的新容器是**活着**的(它答得出话),但它**没准备好**接
 * 流量 —— 拿存活当探针,平台会把流量从好用的旧容器切给跑在旧结构上的新代码。
 *
 * 本端点仍如实带 `migrations`,供人和日志阅读;做「切不切流量」这个判断的是 /api/ready。
 */
import { prisma } from "@fikirtive/db";
import { workersHealth } from "@/lib/health";
import { bootMigrationStatus } from "@/lib/boot-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const migrations = bootMigrationStatus(process.env);
  try {
    // #796 判官 r1 P2-2:拆分之后每个角色写自己的心跳行(`worker` / `worker-compute` /
    // `worker-wait`)。顶层 `worker` 字段含义不变(至少一班活着),按班真相在 `workers` 里。
    const rows = await prisma.workerHeartbeat.findMany();
    const { worker, workers } = workersHealth(rows, new Date());
    return Response.json({ ok: true, db: "up", worker, workers, migrations }, { status: 200 });
  } catch {
    return Response.json({ ok: false, db: "down", worker: "unknown", workers: {}, migrations }, { status: 503 });
  }
}
