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
  type DispatchFounderAlertOptions,
  type FounderAlert,
  type FounderAlertOutcome,
} from "@fikirtive/core/founder-alert";

/**
 * 钱路事故的完整报警(Sentry + 邮件 + Telegram)。**永不抛**。
 *
 * `opts` 与 worker 侧(apps/worker/src/alerting.ts)同一份签名 —— 两边发出来的报警要逐字是
 * 同一种东西,「同一件事重复了」的表达方式也不该各写一套。SHARE-A12 的存储故障报警靠它:
 * 一场故障里第一条完整推送,之后的 `repeat` 只进 Sentry,不再吵人。
 */
export async function founderAlert(
  alert: FounderAlert,
  opts: DispatchFounderAlertOptions = {},
): Promise<FounderAlertOutcome[]> {
  try {
    return await dispatchFounderAlert(alert, createFounderAlertChannels(Sentry), opts);
  } catch (e) {
    console.error(`[founder-alert] ${alert.key}: dispatch itself failed:`, e instanceof Error ? e.message : e);
    return [];
  }
}
