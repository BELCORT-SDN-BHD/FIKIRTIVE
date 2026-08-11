/**
 * #794 ③ — 备份新鲜度在 admin 里长什么样。
 *
 * 纯函数,和 `byteplus-pack-alert.ts` 同一形态:admin 的读模型只负责把 DB 里的行喂进来,
 * 「这算不算健康、该显示什么话」全在这里,可以单测。
 *
 * 三个 founder 真正会问的问题,一格全答:
 *   1. 上一次成功备份是什么时候?     → status / detail 里的小时数
 *   2. 之后有没有失败过?             → 最近一次失败会写进 detail(成功行不会被失败行覆盖)
 *   3. 备份用的是不是隔离凭据?       → credentialMode,来自那一行真实记录,不是读 env 猜的
 */
import { backupAgeHours, backupFreshness, type BackupFreshness } from "./health";

export type BackupSignalTone = "neutral" | "info" | "success" | "warning" | "danger";

export type BackupRunSnapshot = {
  finishedAt: Date | null;
  key: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  trigger: string;
  credentialMode: string;
} | null;

export type BackupFailureSnapshot = {
  finishedAt: Date | null;
  error: string | null;
} | null;

export type BackupSignal = {
  freshness: BackupFreshness;
  status: string;
  /** 距上次成功备份的小时数;从没成功过 → 0(面板上配合 "never" 文案读)。 */
  count: number;
  detail: string;
  tone: BackupSignalTone;
  /** 面板行的时间戳:上次成功时间,没有就用 now。 */
  updatedAt: string;
};

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function buildBackupSignal(args: {
  lastSuccess: BackupRunSnapshot;
  lastFailure: BackupFailureSnapshot;
  now: Date;
}): BackupSignal {
  const { lastSuccess, lastFailure, now } = args;
  const lastSucceededAt = lastSuccess?.finishedAt ?? null;
  const freshness = backupFreshness(lastSucceededAt, now);
  const ageHours = backupAgeHours(lastSucceededAt, now);

  // 失败只有在**发生在上一次成功之后**时才值得说 —— 一次早已被后续成功覆盖的旧失败
  // 挂在面板上,只会训练人忽略这一格。
  const failureAfterSuccess =
    lastFailure?.finishedAt && (!lastSucceededAt || lastFailure.finishedAt > lastSucceededAt) ? lastFailure : null;

  if (!lastSuccess || ageHours === null) {
    return {
      freshness: "missing",
      status: "never run",
      count: 0,
      detail: failureAfterSuccess
        ? `No database backup has ever completed. Last attempt failed: ${failureAfterSuccess.error ?? "no detail recorded"}.`
        : "No database backup has ever completed. Nothing here can be restored yet.",
      tone: "danger",
      updatedAt: now.toISOString(),
    };
  }

  const parts: string[] = [];
  parts.push(`Last backup ${ageHours}h ago`);
  if (lastSuccess.sizeBytes !== null) parts.push(humanBytes(lastSuccess.sizeBytes));
  if (lastSuccess.durationMs !== null) parts.push(`${Math.max(1, Math.round(lastSuccess.durationMs / 1000))}s to write`);
  parts.push(`${lastSuccess.trigger} trigger`);
  parts.push(
    lastSuccess.credentialMode === "isolated"
      ? "isolated backup credential"
      : "shared content credential (not isolated)",
  );
  let detail = `${parts.join(" · ")}.`;
  if (failureAfterSuccess) {
    detail += ` A later attempt failed: ${failureAfterSuccess.error ?? "no detail recorded"}.`;
  }

  if (freshness === "stale") {
    return { freshness, status: "stale", count: ageHours, detail, tone: "danger", updatedAt: lastSucceededAt!.toISOString() };
  }
  if (failureAfterSuccess) {
    return { freshness, status: "retry failed", count: ageHours, detail, tone: "warning", updatedAt: lastSucceededAt!.toISOString() };
  }
  // 新鲜但仍然共用内容凭据 —— 备份存在,但和它要保护的东西挂在同一把钥匙上。
  if (lastSuccess.credentialMode !== "isolated") {
    return { freshness, status: "fresh", count: ageHours, detail, tone: "warning", updatedAt: lastSucceededAt!.toISOString() };
  }
  return { freshness, status: "fresh", count: ageHours, detail, tone: "success", updatedAt: lastSucceededAt!.toISOString() };
}
