import "server-only";
import { readSpendCap, displayCredits } from "@fikirtive/core";
import { spendCapBlockedMessage } from "./credit-format";
import type { Prisma } from "@fikirtive/db";

/**
 * A READ-ONLY look at the merchant's spend cap, for the one case where finding out too late
 * costs them something they cannot get back (#524 r2, judge P1-2).
 *
 * WHAT IT IS NOT. It is not an authority and it does not gate spending. `reserveCredits` decides
 * whether money moves, in the same transaction as the job it pays for, and it decides that again
 * regardless of what this function returned. Nothing here can let a charge through that the
 * reserve would refuse; this only lets a caller find out EARLY.
 *
 * WHY IT EXISTS. `ottoApprove` consumes the approval card — a one-shot consent, atomically flipped
 * pending→approved — BEFORE resuming the metered turn. When the cap then refused inside the
 * reserve, the merchant had paid nothing and received nothing, yet their approval was spent: they
 * had to raise the cap AND approve the same action a second time. Consent is the thing that must
 * not be burned by a refusal that was knowable one line earlier.
 *
 * It reads the cap through `readSpendCap` — the same single reading the ledger writer uses — so
 * the preflight cannot answer a question differently from the gate. It takes the cost in INTERNAL
 * credits (what the reserve will actually ask for, from `llmHoldInternal`), never a re-derived
 * estimate, so it can neither over-refuse nor under-refuse relative to the real hold.
 *
 * Returns the merchant-facing sentence when the cap WILL refuse — deliberately the same words the
 * authority produces — or `null` when the action may proceed to the real gate.
 */
export async function spendCapRefusal(
  db: Pick<Prisma.TransactionClient, "organization">,
  orgId: string,
  costInternal: number,
): Promise<string | null> {
  // A free action cannot exceed a ceiling; reserveCredits returns early on cost <= 0 too.
  if (!Number.isFinite(costInternal) || costInternal <= 0) return null;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  // Fail closed, exactly as the gate does: a ceiling we cannot see refuses.
  const cap = org ? readSpendCap(org.settings) : ({ kind: "unreadable" } as const);
  if (cap.kind === "unreadable") return spendCapBlockedMessage(displayCredits(costInternal), null);
  if (cap.kind === "cap" && costInternal > cap.internal) {
    return spendCapBlockedMessage(displayCredits(costInternal), displayCredits(cap.internal));
  }
  return null;
}
