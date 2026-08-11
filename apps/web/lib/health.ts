/**
 * health — /api/health 的纯逻辑(2026-07-04 盲区修复)。
 *
 * 背景:此前 prod 出故障没有任何东西会通知 founder(审计原话:一个坏掉的 prod
 * 流程 "live and undetected")。/api/health 是外部监控服务(UptimeRobot 等)的
 * 探测点;worker 每 60s 把心跳 upsert 进 WorkerHeartbeat 单行表,这里按时间差
 * 判活。逻辑纯函数化,便于单测;阈值 5 分钟 = 容忍一次部署重启窗口。
 */

/** worker 心跳超过这个毫秒数没更新 = stale。 */
export const WORKER_STALE_MS = 5 * 60_000;

export type WorkerStatus = "up" | "stale" | "unknown";

/** 心跳行缺失 → unknown;超窗 → stale;否则 up。未来时间戳(时钟偏移)按 up 处理,
 *  绝不因 skew 误报。 */
export function workerStatus(heartbeatAt: Date | null, now: Date): WorkerStatus {
  if (!heartbeatAt) return "unknown";
  return now.getTime() - heartbeatAt.getTime() >= WORKER_STALE_MS ? "stale" : "up";
}

/**
 * #796 判官 r1 P2-2 —— 拆成算力/等待两班之后,每班写自己的心跳行。
 *
 * `worker` 这个**顶层字段的含义一个字都没变**:「至少有一班在写心跳」。不这么定就会出一个
 * 新的假警报 —— 从 `all` 切到拆分之后,旧的 `"worker"` 行再没人写,取「最差」会让这个字段
 * 永远卡在 stale。真正的按班真相在 `workers` 里,一行一班,谁死了看得见。
 *
 * 按班告警的接线归 #793;这里先把数据摆出来。
 */
export function workersHealth(
  rows: { id: string; at: Date }[],
  now: Date,
): { worker: WorkerStatus; workers: Record<string, WorkerStatus> } {
  const workers: Record<string, WorkerStatus> = {};
  for (const row of rows) workers[row.id] = workerStatus(row.at, now);
  const statuses = Object.values(workers);
  const worker: WorkerStatus = statuses.includes("up") ? "up" : statuses.includes("stale") ? "stale" : "unknown";
  return { worker, workers };
}
