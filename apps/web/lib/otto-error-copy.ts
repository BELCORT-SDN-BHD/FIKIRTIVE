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
export function ottoFailureMessage(error: unknown, fallback: string): string {
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
  return fallback;
}
