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
 *   - `backup`(#794 ③):`"fresh"` / `"stale"` / `"missing"` / `"unknown"`。
 * 接法见 docs/ops/incident-visibility.md 与 docs/ops/worker-services.md。
 *
 * ## 备份新鲜度也是一个字段,不是一个状态码(#794 ③)
 *
 * 备份不新鲜**不改状态码**:它不代表这个 Web 进程活不活着,把它算进状态码会让现有监控
 * 在一次备份跑晚时误报整站宕机。备份告警走关键词("\"backup\":\"stale\"")。
 * 读不到就写 `unknown` —— 与 `db` 同一条纪律:不知道,但我还活着。
 * 仍然零敏感数据:只报一个词,不报 key 名、不报大小、不报时间戳(这个端点免鉴权,
 * 任何人都能打)。要看细节去 /admin/system。
 */
import { prisma } from "@fikirtive/db";
import { backupFreshness, bestEffort, singleFlight, workersHealth } from "@/lib/health";
import { bootMigrationStatus } from "@/lib/boot-status";

export const dynamic = "force-dynamic";

/**
 * 心跳读取:**同一时刻只有一个在途查询**(#796 判官 r3 P2-1)。
 *
 * `bestEffort` 的超时只是放弃等待,底层查询还挂着占一条连接;库持续挂住时,每次探针都
 * 多积一个永不结束的任务 —— 100 次探针 = 100 条被占住的连接。一个只读一行心跳的端点
 * 反而把连接池压垮,这不能接受。加上 single-flight 之后:100 次探针共享 1 次查询。
 */
const readHeartbeats = singleFlight(() => prisma.workerHeartbeat.findMany());

/**
 * 最近一次**成功**备份的完成时间(#794 ③),同样 single-flight。
 *
 * 包一层对象而不是直接返回行:`bestEffort` 的 `null` 必须只意味着「读不到」。裸 `findFirst`
 * 的 `null` 还可能意味着「从来没成功过」—— 两者混在一起,一次数据库故障就会被报成
 * `missing`(从没备份过),而那正是最该被看见、最不该被伪造的那个状态。
 */
const readLastBackup = singleFlight(async () => {
  const row = await prisma.backupRun.findFirst({
    where: { status: "succeeded" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  return { finishedAt: row?.finishedAt ?? null };
});

export async function GET(): Promise<Response> {
  const migrations = bootMigrationStatus(process.env);
  // #796 判官 r1 P2-2:拆分之后每个角色写自己的心跳行(`worker` / `worker-compute` /
  // `worker-wait`)。顶层 `worker` 字段含义不变(至少一班活着),按班真相在 `workers` 里。
  // bestEffort:失败和挂住是同一个结果 —— 不知道,但我还活着。
  // 两次读**并行**各自 bestEffort:备份那次慢或挂,不该把 worker 那格一起抹成 unknown。
  const [rows, lastBackup] = await Promise.all([bestEffort(readHeartbeats), bestEffort(readLastBackup)]);
  const now = new Date();
  const backup = lastBackup ? backupFreshness(lastBackup.finishedAt, now) : "unknown";
  if (!rows) {
    return Response.json({ ok: true, db: "unknown", worker: "unknown", workers: {}, backup, migrations }, { status: 200 });
  }
  const { worker, workers } = workersHealth(rows, now);
  return Response.json({ ok: true, db: "up", worker, workers, backup, migrations }, { status: 200 });
}
