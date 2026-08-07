/**
 * campaign-approval-lock — the ONE gate that keeps "what the merchant approved" and "what the
 * merchant is charged for" from disagreeing (#744 判官 r1 P1-2).
 *
 * THE RACE IT CLOSES
 * Confirming a campaign reads the approved set, then dispatches it cell by cell. Undo/remove
 * writes the approved set. With no shared gate the two interleave as:
 *
 *     confirm reads "entry X approved" ─┐
 *                                       ├─ undo checks history (nothing charged yet) → writes proposed ✔
 *     confirm dispatches X, charges  ───┘
 *
 * and the merchant ends on the one state that must never exist: the entry is gone from the plan
 * and the credits are gone from the balance.
 *
 * HOW
 * A PostgreSQL transaction-scoped advisory lock keyed by campaign, taken by BOTH sides:
 *   - undo/remove take it, check dispatch history and write the plan inside one transaction;
 *   - each paid dispatch takes it, RE-READS the persisted plan under it, and only then calls
 *     startGen — so a dispatch either happens before the undo (and the undo is then refused,
 *     because the GenJob it can now see proves the charge) or after it (and the re-read shows
 *     the plan changed, so nothing is dispatched).
 * The two survivors are exactly the two legal outcomes: "still approved and charged", or
 * "undone and not charged".
 *
 * WHY THIS SHAPE AND NOT A LONGER TRANSACTION
 * The lock is held for ONE cell, not for the whole batch. `startGen` owns the money transaction
 * (create + reserve + enqueue under its own project lock) and must keep owning it, so this gate
 * wraps each individual dispatch instead of hoisting the batch into one long transaction that
 * would hold two pooled connections for its entire length and time out mid-batch after some
 * cells had already been charged. The key is per CAMPAIGN and startGen's is per PROJECT — two
 * different keys always taken in the same order (campaign then project), so no cycle exists.
 *
 * Failure is fail-closed by construction: if the lock or the re-read cannot complete, the
 * dispatch never runs.
 */
import type { PrismaClient } from "@fikirtive/db";

/** Copy that says what happened, in the merchant's terms: their own edit won the race. */
export const CAMPAIGN_PLAN_CHANGED_MID_DISPATCH =
  "This campaign's approved list changed while this was starting, so nothing was started for it. Review the updated plan and confirm again.";

/** Server-derived lock name. One derivation, so both sides cannot drift onto different locks. */
export function campaignApprovalLockKey(campaignId: string): string {
  return `campaign-approval:${campaignId}`;
}

export type ApprovalLockClient = Pick<PrismaClient, "$transaction">;

/**
 * Run one paid dispatch under the campaign's approval lock.
 *
 * `stillApproved` is re-evaluated against the plan as persisted RIGHT NOW, inside the lock. It
 * returns false when the approved set the caller confirmed is no longer the approved set on
 * record; `dispatch` then never runs and the caller is told the plan moved.
 */
export async function underCampaignApprovalLock<T>(
  db: ApprovalLockClient,
  args: {
    ownerId: string;
    campaignId: string;
    stillApproved: (planJson: unknown) => boolean;
  },
  dispatch: () => Promise<T>,
): Promise<T | { error: string; disposition: "conflict" }> {
  const lockKey = campaignApprovalLockKey(args.campaignId);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
      const campaign = await tx.campaign.findFirst({
        where: { id: args.campaignId, ownerId: args.ownerId, deletedAt: null },
        select: { planJson: true },
      });
      if (!campaign || !args.stillApproved(campaign.planJson)) {
        return { error: CAMPAIGN_PLAN_CHANGED_MID_DISPATCH, disposition: "conflict" as const };
      }
      return dispatch();
    },
    // One cell's enqueue, not a batch. Generous enough that a slow queue write cannot abandon a
    // dispatch mid-flight, short enough that a stuck cell cannot block undo indefinitely.
    { maxWait: 10_000, timeout: 30_000 },
  );
}
