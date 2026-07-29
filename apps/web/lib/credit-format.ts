/**
 * User-facing credit formatting (closed-beta money UI).
 *
 * The product shows CREDITS everywhere — never dollars (founder decision 2026-06-26).
 * 1 displayed credit = $0.10 internally (see packages/core spend.ts), but that conversion
 * is never surfaced here. Balances can be fractional (an Otto LLM-turn settle debits the
 * exact token cost); per-action generation charges are whole credits.
 */

/** Format a displayed-credit amount: thousands-separated, denoised by magnitude.
 *  Under 1000 keeps up to 1 decimal — fractional credits are real signal at that scale
 *  (an Otto-turn settle can land a balance on 42.3). At 1000+ a tenth of a credit is
 *  noise, not signal, so it rounds to the nearest whole credit — a sidebar balance
 *  reads as "12,340" instead of "12,340.3". Locale is fixed ("en-US", never the
 *  browser/Node default) so server and client render byte-identical text. */
export function formatCredits(n: number): string {
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("en-US");
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "1 credit" / "20 credits" — singular only for exactly 1. */
export function creditsLabel(n: number): string {
  return `${formatCredits(n)} ${n === 1 ? "credit" : "credits"}`;
}
