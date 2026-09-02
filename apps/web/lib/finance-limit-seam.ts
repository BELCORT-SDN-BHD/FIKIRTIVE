import "server-only";
/**
 * 撞上人工调账累计闸之后,**对操作员说什么、给 founder 报什么**(MONEY-A14 / 规格 §7.6)。
 *
 * 判定本身在账本层(`packages/db` 的 `assertWithinAdjustWindow`,与写入同事务同一把锁);
 * 这里只做两件事:把 `FinanceAdjustBlocked` 翻成一句人话,以及发一条 founderAlert。三个入口
 * ——租户授信、founder 面调账、人工退款——共用这一份,否则同一个闸会在三个屏幕上说三句不
 * 一样的话,而且总有一个入口的报警会被忘掉。
 */
import { FinanceAdjustBlocked } from "@fikirtive/db";
import { displayCredits, financeRollingLimitMessage } from "@fikirtive/core";
import { founderAlert } from "@/lib/founder-alert";

/** 翻译 + 报警。**永不抛**(报警本身不许把钱路的错误处理再拖垮)。 */
export async function financeAdjustBlockedMessage(
  blocked: FinanceAdjustBlocked,
  ctx: { via: string; entry: string },
): Promise<string> {
  if (blocked.reason === "unknown-org") return "Unknown or closed org.";
  const usedDisplay = displayCredits(blocked.usedInternal ?? 0);
  const limitDisplay = displayCredits(blocked.limitInternal);
  await founderAlert({
    key: "finance.adjust_window_blocked",
    title: `Manual credit movements for ${blocked.orgId} hit the rolling ${limitDisplay}-credit limit.`,
    action:
      "Check the ledger for that workspace. If the movement is genuinely needed, raising the limit is a code change " +
      "(FINANCE_ADJUST_LIMITS in packages/core) plus a founder approval — never a workaround at the action layer.",
    context: { orgId: blocked.orgId, usedDisplay, limitDisplay, via: ctx.via, entry: ctx.entry },
  });
  return financeRollingLimitMessage(usedDisplay);
}
