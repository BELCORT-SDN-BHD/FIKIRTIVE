import "server-only";

/**
 * founder-alert(web 侧接线,整顿 C1a)。
 *
 * 规则、通道与文案全在 packages/core/src/founder-alert.ts —— 这里只负责把 web 进程自己的
 * Sentry 实例接上去,好让 web 与 worker 发出来的报警**逐字是同一种东西**。
 */
import * as Sentry from "@sentry/node";
import {
  createFounderAlertChannels,
  dispatchFounderAlert,
  type FounderAlert,
  type FounderAlertOutcome,
} from "@fikirtive/core/founder-alert";

/** 钱路事故的完整报警(Sentry + 邮件 + Telegram)。**永不抛**。 */
export async function founderAlert(alert: FounderAlert): Promise<FounderAlertOutcome[]> {
  try {
    return await dispatchFounderAlert(alert, createFounderAlertChannels(Sentry));
  } catch (e) {
    console.error(`[founder-alert] ${alert.key}: dispatch itself failed:`, e instanceof Error ? e.message : e);
    return [];
  }
}
