/**
 * User-facing credit formatting (closed-beta money UI).
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
 *  It used to read "You've used up your beta credits — reply and we'll top you up." in three
 *  separate exits, and three things were wrong with it at once. The product has no beta and the
 *  credits are sold — the signup page calls the same 20 "free starter credits". A toast is not a
 *  mailbox, so "reply" pointed nowhere. And at the one moment the merchant had already decided to
 *  spend, it sent them to wait on a human instead of to Billing, which is one click away in the
 *  sidebar. This single function keeps the three exits from drifting again.
 *
 *  Takes the DISPLAYED credits the action was quoted at (same unit as every other helper here),
 *  never a hand-written number — so the amount named is always the amount actually attempted. */
export function outOfCreditsMessage(quotedCredits: number): string {
  return `Not enough credits — this needs ${creditsLabel(quotedCredits)}. Top up in Billing.`;
}

/** The ONE disclosure for what an Otto conversation costs (#555).
 *
 *  It used to read "Chatting with Otto uses a little credit." in three separate places. A
 *  measured session put 89% of its credits on conversation turns, one turn costing as much
 *  as three images — "a little" was not true, and there was nowhere to check. This single
 *  constant keeps the three surfaces from drifting again, and points at the place that can
 *  now answer the question (Billing's spend history).
 *
 *  Deliberately says "your charges are listed", NOT "every charge": the history is a window
 *  over the most recent items and names its own cut (round-1 review P1① — the copy must not
 *  promise more than the page delivers). */
export const CHAT_SPEND_NOTE =
  "Chatting with Otto uses credits — your charges are listed in Billing.";
