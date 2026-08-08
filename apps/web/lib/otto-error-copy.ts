import "server-only";
import { InsufficientCredits } from "@fikirtive/db";
import { displayCredits, OTTO_CONVERSATION_TURN_RESERVE_INTERNAL } from "@fikirtive/core";
import { chatHoldShortfallMessage } from "@/lib/credit-format";

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
export function ottoFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof InsufficientCredits) {
    // The balance travels on the error from inside the failing reserve, so it is the number the
    // refusal was actually judged against — never a second, possibly-moved read.
    return chatHoldShortfallMessage(
      error.balanceInternal === null ? null : displayCredits(error.balanceInternal),
      displayCredits(error.requiredInternal ?? OTTO_CONVERSATION_TURN_RESERVE_INTERNAL),
    );
  }
  return fallback;
}
