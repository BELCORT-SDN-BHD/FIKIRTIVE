/**
 * health — /api/health 的纯逻辑(2026-07-04 盲区修复)。
 *
 * 背景:此前 prod 出故障没有任何东西会通知 founder(审计原话:一个坏掉的 prod
 * 流程 "live and undetected")。/api/health 是外部监控服务(UptimeRobot 等)的
 * 探测点;worker 每 60s 把心跳 upsert 进 WorkerHeartbeat 单行表,这里按时间差
 * 判活。逻辑纯函数化,便于单测;阈值 5 分钟 = 容忍一次部署重启窗口。
 */
import { commitShaFrom, shortSha } from "@fikirtive/core/env-contract";

/** worker 心跳超过这个毫秒数没更新 = stale。 */
export const WORKER_STALE_MS = 5 * 60_000;

export type WorkerStatus = "up" | "stale" | "unknown";

/** 心跳行缺失 → unknown;超窗 → stale;否则 up。未来时间戳(时钟偏移)按 up 处理,
 *  绝不因 skew 误报。 */
export function workerStatus(heartbeatAt: Date | null, now: Date): WorkerStatus {
  if (!heartbeatAt) return "unknown";
  return now.getTime() - heartbeatAt.getTime() >= WORKER_STALE_MS ? "stale" : "up";
}

/* ─── 备份新鲜度(#794 ③)────────────────────────────────────────────────────── */

/**
 * 备份从「成功了会写一行日志」变成「新鲜不新鲜是可查的一格」。
 *
 * 之前这个问题在系统里没有答案:备份成功只进 worker 的 stdout,失败只进 Sentry,
 * /api/health 与 admin 都读不到。一个没人看得见新鲜度的备份,和没有备份的区别只在
 * 出事那天才知道 —— 这正是工程评估债 #2 的原话「备份从未被证明能恢复」的另一半。
 *
 * 门槛 30 小时:备份每 KL 日一份(cron 定在 03:00 KL)。24 小时是节拍本身,
 * 留 6 小时余量吸收「跑晚了/重试了/部署窗口错开了」,同时仍然能抓住整晚漏跑
 * (漏一晚 = 48 小时,远超门槛)。门槛调紧到 26 小时会因为一次跑慢就误报,
 * 调松到 48 小时会漏掉整整一晚 —— 30 小时是「不误报也不漏晚」的那一格。
 */
export const BACKUP_STALE_MS = 30 * 60 * 60_000;

export type BackupFreshness = "fresh" | "stale" | "missing";

/**
 * 最近一次**成功**备份的完成时间 → 新鲜度。
 * 从没成功过 → missing(这是最该被看见的状态,不是 stale 的一种)。
 * 未来时间戳(时钟偏移)按 fresh 处理,与 workerStatus 同一条纪律:绝不因 skew 误报。
 */
export function backupFreshness(lastSucceededAt: Date | null, now: Date): BackupFreshness {
  if (!lastSucceededAt) return "missing";
  return now.getTime() - lastSucceededAt.getTime() >= BACKUP_STALE_MS ? "stale" : "fresh";
}

/** 距上次成功备份过去了多少小时(向下取整);从没成功过 → null。 */
export function backupAgeHours(lastSucceededAt: Date | null, now: Date): number | null {
  if (!lastSucceededAt) return null;
  return Math.max(0, Math.floor((now.getTime() - lastSucceededAt.getTime()) / 3_600_000));
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

/* ─── 构建身份(2026-09-04 Codex staging 审计)─────────────────────────────── */

export type BuildInfo = { sha: string | null; ref: string | null };

const isSet = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/**
 * 这次响应到底是哪次部署吐出来的——此前 /api/health 完全不报,Codex 的 staging E2E
 * 审计(docs/audits/creation-staging-product-avatar-video-2026-09-04.md,"Version and
 * evidence boundary")因此没法把任何发现绑定到一次具体部署。
 *
 * sha 复用 packages/core 的 commitShaFrom/shortSha——worker 心跳(apps/worker/src/heartbeat.ts)
 * 与 admin 的部署对比面板(apps/web/lib/deploy-fingerprint.ts)已经是同一对函数的权威读法,
 * 这里不再另起一套(§7.3 单一权威)。平台今天只在 Railway 上跑,取值优先级仍按平台注入的
 * 变量名区分:RAILWAY_GIT_COMMIT_SHA/RAILWAY_GIT_BRANCH 在先,VERCEL_GIT_COMMIT_SHA/
 * VERCEL_GIT_COMMIT_REF 作后备(今天恒为空,只是不假设永远只有一个平台)。本机两者都没有
 * 就是 null——绝不在运行时现取 git,也絶不假造一个。
 *
 * 只回 sha 与 ref 两个字段:不含 configFingerprint(那一格照 deploy-fingerprint.ts 的既有
 * 纪律留在鉴权后的 admin 面),不含任何路径、变量名或时间戳——这是一个免鉴权端点。
 */
export function buildInfo(env: Record<string, string | undefined>): BuildInfo {
  const sha = commitShaFrom(env) ?? (isSet(env.VERCEL_GIT_COMMIT_SHA) ? env.VERCEL_GIT_COMMIT_SHA.trim() : null);
  const ref = isSet(env.RAILWAY_GIT_BRANCH)
    ? env.RAILWAY_GIT_BRANCH.trim()
    : isSet(env.VERCEL_GIT_COMMIT_REF)
      ? env.VERCEL_GIT_COMMIT_REF.trim()
      : null;
  return { sha: shortSha(sha), ref };
}
