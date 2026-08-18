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
  return `Not enough credits — this needs ${creditsLabel(quotedCredits)}. Top up in Billing.`;
}

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
  return `You have ${creditsLabel(balanceCredits)} — starting a message with Otto needs at least ${creditsLabel(minimumCredits)}. Top up in Billing.`;
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

/** The ONE disclosure for what an Otto conversation costs (#555, Founder ruling 2026-08-18).
 *
 *  It used to read "Chatting with Otto uses a little credit.", then "uses credits — your
 *  charges are listed in Billing." Both were true when a reply was metered per token; neither
 *  is true now. Chat replies cost nothing: credits are spent on GENERATION only
 *  (OTTO_CONVERSATION_TURN_MARGIN in @fikirtive/core), so a conversation turn writes no charge
 *  at all — there is no per-reply number to show and nothing for Billing to list.
 *
 *  It still names credits, because the merchant does spend them here — one line further on,
 *  when they confirm an image or a video. Saying "free" without saying what is not free would
 *  just move the surprise. */
export const CHAT_SPEND_NOTE =
  "Chatting with Otto is free — credits are only used when you make an image or a video.";
