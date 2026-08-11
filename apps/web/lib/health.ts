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
