/**
 * alerting — worker 侧的报警出口(整顿 C1a)。
 *
 * 两个函数,分别对应两种严重程度:
 *   · {@link captureMoneyPathError} —— 钱路上一个**被吞掉的**错误。这些 catch 全都是刻意
 *     不抛的(一行坏数据不许拖垮整趟巡检、退款失败下一轮重试),但「刻意不抛」到今天为止
 *     等于「只有日志知道」。补一次 Sentry 上报,让它至少可数、可查、可聚类。
 *   · {@link founderAlert} —— 需要**人**来做决定的钱路事故。Sentry + 邮件 + Telegram
 *     三条通道,规则见 packages/core/src/founder-alert.ts。
 *
 * 两个都吞掉自己的异常:报警是旁路,它把一条钱路的代码路径拖垮,就成了自己要报的那种事故。
 */
import * as Sentry from "@sentry/node";
import {
  createFounderAlertChannels,
  dispatchFounderAlert,
  type FounderAlert,
  type FounderAlertOutcome,
} from "@fikirtive/core/founder-alert";

/** 定位一条钱路事故需要的字段。永远是 id / 金额 / 状态,不放密钥、不放商家内容。 */
export type MoneyPathContext = {
  /** 稳定的机器键,如 `gen.reaper_self_heal_failed`。Sentry 靠它聚类。 */
  event: string;
  orgId?: string;
  jobId?: string;
} & Record<string, unknown>;

export function captureMoneyPathError(err: unknown, context: MoneyPathContext): void {
  try {
    Sentry.captureException(err, { tags: { money_path: context.event }, extra: { ...context } });
  } catch {
    // Sentry 自己坏了不许影响钱路。调用点旁边的 console 行已经把事实写进日志。
  }
}

/** 钱路事故的完整报警。返回逐通道结果,便于测试与调用点记账;**永不抛**。 */
export async function founderAlert(alert: FounderAlert): Promise<FounderAlertOutcome[]> {
  try {
    return await dispatchFounderAlert(alert, createFounderAlertChannels(Sentry));
  } catch (e) {
    console.error(`[founder-alert] ${alert.key}: dispatch itself failed:`, e instanceof Error ? e.message : e);
    return [];
  }
}
