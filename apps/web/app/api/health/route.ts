/**
 * /api/health — **LIVENESS**(存活):这个进程还答不答得出话。
 *
 * 2026-07-04 盲区修复:此前 prod 出故障没有任何东西会通知 founder。免鉴权
 * (proxy.ts matcher 已排除),零敏感数据:只报 up/stale/unknown,不暴露计数或配置。
 *
 * ## 存活**不依赖任何下游**(#796 判官 r2 P1-2)
 *
 * 这个端点从前会 `await` 一次数据库查询,库不可达就回 503。而平台的**重启**探针指的正是
 * 这里 —— 于是一次数据库故障会变成「重启还活着的 Web」,每一轮重启又跑三次迁移重试,
 * 正好复活本票要消灭的那个重启循环。
 *
 * 所以现在:**进程活着就 200**。心跳那次读取是顺带的(`bestEffort`,1 秒不回就放弃),
 * 读到什么报什么,读不到就如实写 `unknown` —— 状态码一律不因下游而变。
 * 「库好不好、该不该接流量」由 `/api/ready` 专管,那才是平台**部署 / 负载**探针该指的地方。
 *
 * 契约(#796 起):
 *   - HTTP 200 恒定 = 这个 Web 进程活着。别拿它判断整个系统健康。
 *   - `db`:`"up"` / `"unknown"`(读不到就是不知道,**不再**报 down + 503)。
 *   - `worker`:至少有一班在写心跳;按班真相在 `workers` 里。
 *   - `migrations`:本次启动的迁移到底跑成了没有(见 apps/web/scripts/boot.mjs)。
 * 接法见 docs/ops/incident-visibility.md 与 docs/ops/worker-services.md。
 */
import { prisma } from "@fikirtive/db";
import { bestEffort, workersHealth } from "@/lib/health";
import { bootMigrationStatus } from "@/lib/boot-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const migrations = bootMigrationStatus(process.env);
  // #796 判官 r1 P2-2:拆分之后每个角色写自己的心跳行(`worker` / `worker-compute` /
  // `worker-wait`)。顶层 `worker` 字段含义不变(至少一班活着),按班真相在 `workers` 里。
  // bestEffort:失败和挂住是同一个结果 —— 不知道,但我还活着。
  const rows = await bestEffort(() => prisma.workerHeartbeat.findMany());
  if (!rows) {
    return Response.json({ ok: true, db: "unknown", worker: "unknown", workers: {}, migrations }, { status: 200 });
  }
  const { worker, workers } = workersHealth(rows, new Date());
  return Response.json({ ok: true, db: "up", worker, workers, migrations }, { status: 200 });
}
