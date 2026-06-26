/**
 * User-facing credit formatting (closed-beta money UI).
 *
 * The product shows CREDITS everywhere — never dollars (founder decision 2026-06-26).
 * 1 displayed credit = $0.10 internally (see packages/core spend.ts), but that conversion
 * is never surfaced here. Balances can be fractional (an Otto LLM-turn settle debits the
 * exact token cost); per-action generation charges are whole credits.
 */

/** Format a displayed-credit amount: thousands-separated, at most 1 decimal. */
export function formatCredits(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "1 credit" / "20 credits" — singular only for exactly 1. */
export function creditsLabel(n: number): string {
  return `${formatCredits(n)} ${n === 1 ? "credit" : "credits"}`;
}
