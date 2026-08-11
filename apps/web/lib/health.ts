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

/**
 * 存活探针允许等下游多久(#796 判官 r2 P1-2)。
 *
 * 存活的问题是「这个进程还答不答得出话」,而不是「数据库好不好」。所以心跳那次读取是
 * **顺带的**:1 秒内回来就报,回不来就如实写 unknown —— 绝不让一次慢查询把存活探针拖到
 * 超时。库好不好由 /api/ready 专管。
 */
export const HEALTH_DOWNSTREAM_TIMEOUT_MS = 1_000;

/**
 * 就绪探针等数据库的上限。比存活那条宽:这里 DB 是**判断依据**,值得多给一点时间;
 * 但仍然有界 —— 一个永远不回话的查询等同于「没准备好」,不该把探针一起拖到平台超时。
 */
export const READY_DATABASE_TIMEOUT_MS = 3_000;

/**
 * 顺带读:成功返回值,失败或超时返回 null。**永不抛**。
 *
 * 为什么必须有这个:r2 的存活端点直接 `await` 了一次数据库查询,库不可达时它回 503。
 * 而文档又把它指定成平台的**重启**探针 —— 于是「数据库故障」会变成「重启还活着的 Web」,
 * 每一轮重启又跑三次迁移重试,正好复活本票要消灭的那个重启循环。
 * 一次挂住的查询和一次失败的查询在这里必须是同一个结果:不知道,但我还活着。
 */
export async function bestEffort<T>(work: () => Promise<T>, timeoutMs = HEALTH_DOWNSTREAM_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const started = work().catch(() => null); // 落单的拒绝必须就地吞掉,否则会变成 unhandledRejection
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    return await Promise.race([started, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 同一时刻只允许**一个**在途查询,后来的探针共享它(#796 判官 r3 P2-1)。
 *
 * 单有 `bestEffort` 不够:超时只是**放弃等待**,底层那次查询还挂在那儿占着一条连接。
 * 库持续挂住时,每来一次探针就多积一个永不结束的任务 —— 100 次探针 = 100 条被占住的连接,
 * 于是一个「只读一行心跳」的端点反而把连接池压垮,顺手把真正要用库的请求一起拖下水。
 *
 * 有了它:100 次探针只会有 1 次查询在途;那次查询一旦结束(成功或失败),下一次探针才会
 * 重新发起 —— 所以库恢复之后不需要任何额外动作就能自己报回 up。
 */
export function singleFlight<T>(work: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    // `finally` 里清空:成功、失败都算「这一趟结束了」,下一次探针可以重新发起。
    const attempt = work().finally(() => { if (pending === attempt) pending = null; });
    pending = attempt;
    return attempt;
  };
}
