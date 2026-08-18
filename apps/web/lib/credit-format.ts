// Subpath imports, not the barrel: this module is reachable from client components, and
// the barrel is Node-capable (guarded by lib/__tests__/client-core-imports.test.ts).
import { OTTO_CONVERSATION_TURN_RESERVE_INTERNAL } from "@fikirtive/core/otto-budget";
import { displayCredits } from "@fikirtive/core/spend";

/**
 * User-facing credit formatting (the money UI's words).
 *
 * The product shows CREDITS everywhere — never dollars (founder decision 2026-06-26).
 * 1 displayed credit = $0.10 internally (see packages/core spend.ts), but that conversion
 * is never surfaced here. Balances can be fractional (an Otto LLM-turn settle debits the
 * exact token cost); per-action generation charges are whole credits.
 */

/** Format a displayed-credit amount: thousands-separated, rounded to at most 1 decimal —
 *  fractional credits are real signal at any magnitude (an Otto-turn settle can land a
 *  real balance on 1,234.6; this helper backs real balances/ledger/confirm copy, so it
 *  must never change the amount, only how it's grouped). The same 1-decimal rule applies
 *  regardless of size — no separate "round to whole credit at 1000+" branch (that used to
 *  silently turn 1,234.6 into 1,235). Locale is fixed ("en-US", never the browser/Node
 *  default) so server and client render byte-identical text. */
export function formatCredits(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "1 credit" / "20 credits" — singular only for exactly 1. */
export function creditsLabel(n: number): string {
  return `${formatCredits(n)} ${n === 1 ? "credit" : "credits"}`;
}

/** The ONE thing a merchant is told when a generation costs more credits than they hold (#699).
 *
 *  It replaced three copies of one line that got three things wrong at once (#699 quotes the
 *  original verbatim). It called the balance a closed-beta allowance — there is no beta and the
 *  credits are sold; the signup page calls the same welcome grant "free credits". It told the
 *  merchant to reply, but a toast is not a mailbox, so that pointed nowhere. And at the one
 *  moment they had already decided to spend, it sent them to wait on a human instead of to
 *  Billing, one click away in the sidebar. This single function keeps the three exits from
 *  drifting again.
 *
 *  Takes the DISPLAYED credits the action was quoted at (same unit as every other helper here),
 *  never a hand-written number — so the amount named is always the amount actually attempted. */
export function outOfCreditsMessage(quotedCredits: number): string {
  return `Not enough credits — this needs ${creditsLabel(quotedCredits)}. ${TOP_UP_CTA}`;
}

/** 每一句「钱不够」的收尾 —— **也是这句话唯一的出口**(#979)。
 *
 *  #699 把三份措辞收成一份,并把商家指向 Billing。可这几句话是**服务端动作返回的字符串**,
 *  卡片那一层从来只是 `{error}` 一段死文字:beta 录像 10:32,商家在批准按钮上撞到
 *  「Not enough credits — this needs 22 credits. Top up in Billing.」,然后在原地停了 40 秒 ——
 *  他已经决定要付钱了,产品却让他自己去找 Billing 在哪。
 *
 *  所以这句 CTA 从字符串里提出来成为常量:句子照旧由服务端拼(数字必须是真的那一次报价),
 *  而渲染层拿这同一个常量把结尾换成一条真的能点的链接(`components/exits/Exits.tsx` 的
 *  `ErrorWithTopUp`)。两边钉着同一份字面量,所以「句子改了、链接认不出来了」这件事会当场红,
 *  不会悄悄退回一段死文字。 */
export const TOP_UP_CTA = "Top up in Billing.";

/** The ONE thing a merchant is told when THEIR OWN spend cap stopped an action (#524).
 *
 *  Deliberately not the out-of-credits line: they are not out of credits, and sending them to
 *  Billing to top up would not unblock anything. The limit is theirs, it lives in Settings,
 *  and it is the only thing that moves. Both numbers are named for the same reason the
 *  out-of-credits line names its own — a refusal that hides the number it was judged against
 *  reads as a fault in the product.
 *
 *  `capCredits === null` is the fail-closed arm: the cap could not be read, so the action was
 *  refused rather than run against an unknown ceiling. Saying that plainly beats inventing a
 *  number or blaming the merchant's balance. Both amounts are DISPLAYED credits. */
export function spendCapBlockedMessage(quotedCredits: number, capCredits: number | null): string {
  if (capCredits === null) {
    return "Paused — your spend cap couldn't be read, so nothing was charged. Try again in a moment.";
  }
  return `Paused by your spend cap — this needs ${creditsLabel(quotedCredits)} and your cap is ${creditsLabel(capCredits)} per action. Raise the cap in Settings to run it.`;
}

/** What a merchant is told when a CONVERSATION turn can't start for lack of CREDITS (#791-7,
 *  #898). A turn stopped by the merchant's own spend cap is a different sentence and a different
 *  exit — see `spendCapBlockedMessage` above; sending them to Billing over a cap they set would
 *  be untrue and would not unblock anything.
 *
 *  It replaced "You're out of credits." — a sentence that was usually not true. A turn HOLDS
 *  an amount up front, so a merchant sitting on 3.9 credits, who has spent nothing, was told
 *  they had none while their own balance was on screen saying otherwise. That reads as a
 *  broken product, not as a limit.
 *
 *  #898 moved the door itself: the hold now shrinks to fit the balance
 *  (OTTO_CHAT_MIN_START_INTERNAL), so 3.9 credits sends a message like any other balance and
 *  this sentence only appears below 1 credit. The number it names is therefore the MINIMUM to
 *  start, not the hold — saying "holds 1 credit first" would be false the moment the merchant
 *  tops up and the hold goes back to 4.
 *
 *  Names both real numbers: what they hold now, and what starting a message needs. Falls back
 *  to the shared out-of-credits line when the balance can't be read — better to say one true
 *  thing than to invent a number. Both are DISPLAYED credits. */
export function chatHoldShortfallMessage(
  balanceCredits: number | null,
  minimumCredits: number,
): string {
  if (balanceCredits === null) return outOfCreditsMessage(minimumCredits);
  return `You have ${creditsLabel(balanceCredits)} — starting a message with Otto needs at least ${creditsLabel(minimumCredits)}. ${TOP_UP_CTA}`;
}

/** The early warning, shown BEFORE they try (#791-7): the balance is under what one video
 *  costs. Said while they still have a choice, instead of at the moment they are stopped.
 *
 *  States the fact only — the way OUT (top up in Billing) is rendered as a real link by the
 *  caller via components/exits, which is this repo's one rule for "next step" copy: never
 *  write the direction as text the merchant cannot click. */
export function lowBalanceForVideoMessage(
  balanceCredits: number,
  videoCredits: number,
): string {
  return `You have ${creditsLabel(balanceCredits)} left — a short video costs ${creditsLabel(videoCredits)}.`;
}

/** The ONE disclosure for what an Otto conversation costs (#555; Founder's second ruling
 *  2026-08-18 put conversation back on usage pricing).
 *
 *  It has now been three sentences. "Chatting with Otto uses a little credit." was untrue — a
 *  measured session put 89% of its credits on conversation, one turn costing as much as three
 *  images. "Chatting with Otto is free" was true for a few hours, between the two rulings of the
 *  same day. This is the third and it matches the code: a turn charges what it actually used, at
 *  the provider's cost plus 5% (OTTO_CONVERSATION_TURN_MARGIN in @fikirtive/core).
 *
 *  IT CARRIES NO MAGNITUDE CLAIM, and that is the point it keeps failing on. A draft of this
 *  sentence said "usually a fraction of one per message"; at the 1.05 multiplier the measured
 *  reply is 1.4 displayed credits and most of the #536 band sits ABOVE one credit, so the clause
 *  was the same species of untruth as "a little credit" — and it read as a contradiction of
 *  CHAT_HOLD_NOTE ("holds up to 4 credits") rendered directly beneath it. Any future softening
 *  needs a measurement behind it, at the price of the day.
 *
 *  Says "what it uses" rather than a number, because there is no number to give — the price is
 *  the turn's real usage. Deliberately says "your charges are listed", NOT "every charge": the
 *  history is a window over the most recent items and names its own cut (round-1 review P1① —
 *  the copy must not promise more than the page delivers). */
export const CHAT_SPEND_NOTE =
  "Chatting with Otto costs credits for what it uses — your charges are listed in Billing.";

/** The ONE disclosure of the conversation HOLD (#791-9, live again with the second ruling).
 *
 *  A turn reserves an amount before the model is called, settles the actual token cost, and
 *  refunds the remainder in the same transaction (settleCredits: A = min(actual, held), the
 *  difference goes back to balance). Merchants were never told any of it — they saw the balance
 *  dip and partly come back, with nothing explaining either move, which reads like an accounting
 *  bug. Saying it plainly costs nothing: the real behaviour is more generous than what anyone
 *  guesses from a silent dip.
 *
 *  The number is DERIVED from the hold constant, never typed out — a hand-written "4" would
 *  become a lie the next time the hold is tuned.
 *
 *  #898: "up to". The hold is min(the constant, the balance) — a merchant with 1.2 credits has
 *  1.2 held, not 4 — so the flat "holds 4 credits" would be wrong for exactly the merchants who
 *  read this line hardest. */
export const CHAT_HOLD_NOTE =
  `Each message holds up to ${creditsLabel(displayCredits(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL))} up front, charges only what it uses, and returns the rest right away.`;
