import "server-only";
import { InsufficientCredits, SpendCapBlocked } from "@fikirtive/db";
import { displayCredits, OTTO_CHAT_MIN_START_INTERNAL } from "@fikirtive/core";
import { chatHoldShortfallMessage, spendCapBlockedMessage } from "@/lib/credit-format";

/**
 * The ONE translation from a failed Otto turn into the sentence the merchant reads (#810 P2-2).
 *
 * #791-7 taught the STREAMING route to stop saying "You're out of credits." when that was not
 * true — a turn HOLDS a fixed amount up front, so a merchant with 3.9 credits who had spent
 * nothing was told they had none. But it taught only that one route. The non-streaming entries
 * (ottoTurn, ottoApprove) still swallowed the same typed refusal into "Couldn't reach Otto" /
 * "Couldn't approve", which is worse than the old copy: it reports a fault in the product for
 * something that is not a fault and does not name the two numbers that would explain it. Brand
 * Memory still talks to Otto through those entries, so this was live, not theoretical.
 *
 * Money behaviour is untouched — the reserve already refused, nothing was charged. What changes
 * is only what the refusal is called out loud, and that every entry now calls it the same thing.
 *
 * `fallback` stays per-entry ("Couldn't reach Otto" vs "Couldn't approve"): a genuine fault
 * should still say which action failed.
 */
/**
 * 供应商侧不可恢复的失败(#3310 走查实证:我们这边的 Anthropic 账户余额不足,服务端拿到
 * `AI_APICallError` status=400「Your credit balance is too low…」)。
 *
 * 病灶:这一类失败被包成 `Otto hit a snag — please try again.`,而那句话在瞬时错误上成立、
 * 在「我们这边坏了」上是**误导** —— 商家照它说的再试,永远失败,而且每试一次都重新走一遍
 * 预扣/退款。分类与文案因此必须同源:一处判、一处说,三门共用。
 *
 * 判据是**结构化**的(与 `packages/otto/src/model.ts` 的 `isOverloadError` 同一种形状),
 * 不做泛文本匹配:
 *   401 / 403  鉴权(我们的钥匙无效或被禁)
 *   404        型号不存在(我们的 manifest 指错)
 *   429        配额/限流(我们的账户被限)
 *   ≥500       供应商故障(含 529 —— 同层失败转移已经试过兄弟型号还是没成)
 *   400        **只有**报文点名计费/额度时才算(重试同一条请求必然同样失败);其余 400
 *              留给瞬时句 —— 那一档里有「这条消息本身有问题」的可能,而它改了再试是能成的。
 * `seen` 防环(a.cause = b; b.cause = a),与 `isOverloadError` 同一个理由。
 */
function statusOf(e: Record<string, unknown>): number | null {
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.status === "number") return e.status;
  return null;
}

/** 400 报文里点名了计费/额度 —— 供应商给这一档的唯一信号就在文本里(与 `isOverloadError`
 *  读 `responseBody` 里的 `overloaded_error` 同一种取证)。 */
function namesBillingLimit(e: Record<string, unknown>): boolean {
  const parts: string[] = [];
  if (typeof e.message === "string") parts.push(e.message);
  if (typeof e.responseBody === "string") parts.push(e.responseBody);
  const data = e.data as { error?: { message?: unknown } } | undefined;
  if (typeof data?.error?.message === "string") parts.push(data.error.message);
  return /credit balance|billing|quota|payment required/i.test(parts.join(" "));
}

export function isProviderSideFailure(error: unknown, seen: Set<unknown> = new Set()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const e = error as Record<string, unknown>;
  const status = statusOf(e);
  if (status !== null) {
    if (status === 401 || status === 403 || status === 404 || status === 429 || status >= 500) return true;
    if (status === 400 && namesBillingLimit(e)) return true;
  }
  // AI SDK 的重试壳把真正的那个错误挂在 `lastError`,普通包装挂 `cause`。
  return isProviderSideFailure(e.lastError, seen) || isProviderSideFailure(e.cause, seen);
}

/** 「这一轮没收钱」的唯一字面量。ENGINE-A4 的退款分支与供应商侧的诚实句共用它 ——
 *  ⑤段登记里留的「把这两句收进 `otto-error-copy.ts`」正是这一步。 */
export const TURN_NOT_CHARGED_SENTENCE = "This turn wasn't charged.";

/** 截断降级句(ENGINE-A4)。三门此前各抄一份字面量,现在读同一处。 */
export const OTTO_DEGRADE_SENTENCE = "I got a bit tangled up — try asking again.";

/** 供应商侧不可恢复失败的诚实句。不点名供应商、不露技术栈;「later」是这句话的重点 ——
 *  马上再试一次只会再失败一次。 */
export const OTTO_PROVIDER_UNAVAILABLE_SENTENCE = "Otto is unavailable right now on our side.";

const TRY_AGAIN_LATER_SENTENCE = "Please try again later.";

/** ENGINE-A4:整笔退了的那一轮才说「没收钱」,否则这句话不出现(不说没发生的事)。 */
export function ottoDegradeText(chargedNothing: boolean): string {
  return chargedNothing
    ? `${OTTO_DEGRADE_SENTENCE} ${TURN_NOT_CHARGED_SENTENCE}`
    : OTTO_DEGRADE_SENTENCE;
}

/** 供应商侧诚实句 ＋(证明属实时)没收钱 ＋ 支持把手。 */
export function providerUnavailableText(
  opts: { chargedNothing?: boolean; errorId?: string | null } = {},
): string {
  return [
    OTTO_PROVIDER_UNAVAILABLE_SENTENCE,
    opts.chargedNothing ? TURN_NOT_CHARGED_SENTENCE : null,
    TRY_AGAIN_LATER_SENTENCE,
    opts.errorId ? `Reference: ${opts.errorId}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function ottoFailureMessage(
  error: unknown,
  fallback: string,
  opts: { chargedNothing?: boolean; errorId?: string | null } = {},
): string {
  // #524 — the merchant's own spend cap refused the turn's hold. Not a shortfall and not a
  // fault: naming it as either would send them to Billing for a limit that lives in Settings.
  if (error instanceof SpendCapBlocked) {
    return spendCapBlockedMessage(
      displayCredits(error.requiredInternal),
      error.capInternal === null ? null : displayCredits(error.capInternal),
    );
  }
  if (error instanceof InsufficientCredits) {
    // The balance travels on the error from inside the failing reserve, so it is the number the
    // refusal was actually judged against — never a second, possibly-moved read.
    // #898: the fallback is the minimum to START a message, not the hold — the reserve now
    // shrinks to fit the balance, so the hold is no longer a number a refusal can quote.
    return chatHoldShortfallMessage(
      error.balanceInternal === null ? null : displayCredits(error.balanceInternal),
      displayCredits(error.requiredInternal ?? OTTO_CHAT_MIN_START_INTERNAL),
    );
  }
  // #3310:我们这边坏了。瞬时句在这里是误导 —— 再试一次永远失败,而商家会一直试下去。
  if (isProviderSideFailure(error)) return providerUnavailableText(opts);
  return fallback;
}
