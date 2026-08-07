/**
 * credit-direction — the ONE judgment of "did this credit entry take money, add money, or
 * merely hold it" (#684).
 *
 * WHY IT LIVES IN core: three merchant-facing surfaces have to agree on the word "charge" —
 * /billing's spend history, the Billing-and-credits feed in Otto settings, and Otto's own
 * readSpending answer. The first two are apps/web; the third is packages/otto, which may not
 * import a web module. Left to itself each side grew its own test, and the ledger's own
 * arithmetic then disagreed with the sentence printed above it: a workspace holding nothing
 * but its signup grant was told it had "1 credit charge so far".
 *
 * The rules, stated once:
 *   - a top-up or a grant ADDS credits and is never a charge;
 *   - an open hold is not a charge YET — its amount is the reservation ceiling, and the real
 *     cost is only known when it settles;
 *   - a hold that came back in full moved no money at all;
 *   - everything else that took credits is a charge.
 *
 * PURE and money-safe: it decides a WORD, never an amount, and touches no ledger.
 */

export type CreditDirection =
  /** Credits really left the balance and the amount is final. */
  | "charge"
  /** Credits are reserved for work in flight; the final cost is not known yet. */
  | "hold"
  /** Credits came in — a top-up, a grant, or a standalone refund. */
  | "addition"
  /** Nothing moved — e.g. a hold that was refunded in full. */
  | "unchanged";

/**
 * Classify one merchant-facing credit entry from its NET signed amount (in displayed credits)
 * and whether its hold is still open.
 *
 * Callers pass the two facts rather than a shaped object on purpose: apps/web calls the field
 * `delta` and Otto's port calls it `credits`, and neither name should become the other's
 * problem. The judgment itself exists only here.
 */
export function creditDirection(signedCredits: number, pending: boolean): CreditDirection {
  if (signedCredits > 0) return "addition";
  if (signedCredits === 0) return "unchanged";
  return pending ? "hold" : "charge";
}
