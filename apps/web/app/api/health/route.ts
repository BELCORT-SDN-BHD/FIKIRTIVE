/**
 * /api/health — 外部监控的探测点(2026-07-04 盲区修复:此前 prod 出故障没有任何
 * 东西会通知 founder)。免鉴权(proxy.ts matcher 已排除),零敏感数据:只报
 * up/stale/unknown,不暴露计数或配置。
 *
 * 约定:HTTP 200 = web + DB 活着(worker 状态在 body 里,监控服务用关键词告警
 * "\"worker\":\"up\"");HTTP 503 = DB 不可达(web 本身还活着才答得出 503)。
 * 接法见 docs/ops/incident-visibility.md。
 *
 * #794 ③ 加 `backup` 字段:fresh | stale | missing。
 * - HTTP 状态码**不变**:备份不新鲜不代表 web/DB 不健康,把它算进 503 会让现有监控
 *   在一次备份跑晚时误报整站宕机。备份告警是关键词告警("\"backup\":\"stale\"")。
 * - 仍然零敏感数据:只报三个词,不报 key 名、不报大小、不报时间戳 —— 与 worker 字段
 *   同一条纪律(这个端点免鉴权,任何人都能打)。要看细节去 /admin/system。
 */
import { prisma } from "@fikirtive/db";
import { backupFreshness, workerStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const now = new Date();
    const [hb, lastBackup] = await Promise.all([
      prisma.workerHeartbeat.findUnique({ where: { id: "worker" } }),
      prisma.backupRun.findFirst({
        where: { status: "succeeded" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
    ]);
    return Response.json(
      {
        ok: true,
        db: "up",
        worker: workerStatus(hb?.at ?? null, now),
        backup: backupFreshness(lastBackup?.finishedAt ?? null, now),
      },
      { status: 200 },
    );
  } catch {
    // DB 不可达时备份新鲜度是"不知道",不是"没有" —— 这条记录本身就存在那个库里。
    return Response.json({ ok: false, db: "down", worker: "unknown", backup: "unknown" }, { status: 503 });
  }
}
