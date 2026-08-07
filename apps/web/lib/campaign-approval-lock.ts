/**
 * campaign-approval-lock — the ONE gate that keeps "what the merchant approved" and "what the
 * merchant is charged for" from disagreeing (#744 判官 r1 P1-2 / r2 P1).
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
 * HOW — AND WHY THE GATE LIVES INSIDE THE MONEY TRANSACTION
 * A PostgreSQL transaction-scoped advisory lock keyed by campaign, taken by BOTH sides:
 *   - undo/remove take it, check dispatch history and write the plan inside one transaction;
 *   - each paid dispatch takes it INSIDE THE TRANSACTION THAT COMMITS THE CHARGE — startGen's
 *     create+reserve+enqueue transaction — and re-reads the persisted plan under it before
 *     anything is created or reserved.
 *
 * The second half is the whole point of this rewrite. An earlier shape wrapped startGen in an
 * OUTER transaction that held the lock: because startGen opens its own transaction, the outer
 * one could time out (or lose its connection) and release the lock while the inner charge was
 * still uncommitted. An undo could then take the lock, see no GenJob (it was not committed yet),
 * write "proposed" — and the charge would commit afterwards. Exactly `charged && !approved`.
 * Handing the gate to the charging transaction removes the window by construction: the lock is
 * released by the same COMMIT that makes the charge visible, so an undo that gets the lock can
 * never fail to see a charge that happened.
 *
 * The two survivors are then exactly the two legal outcomes: "still approved and charged", or
 * "undone and not charged".
 *
 * LOCK ORDER
 * This key is per CAMPAIGN and startGen's own is per PROJECT, and this one is taken FIRST inside
 * that transaction — campaign then project, always the same order, so no cycle exists. The undo
 * side takes the campaign key only.
 *
 * FAIL-CLOSED BY CONSTRUCTION
 * A failure to take the lock, to re-read the plan, or to re-derive the approval fingerprint all
 * raise {@link CampaignApprovalGateRefused} from inside the money transaction: it rolls back
 * before create/reserve, so nothing is dispatched and nothing is charged.
 *
 * SERVER PROVENANCE
 * The gate travels on the in-process request object through a module-local WeakMap, the same
 * device gen-actions already uses for its trusted canvas/cowork/asset requests: a serialized
 * client payload can never be a member of it. Note the direction of trust — a gate can only
 * REFUSE a dispatch, never authorize one, so a forged one could not buy anything.
 */
import type { PrismaClient } from "@fikirtive/db";

/** Copy that says what happened, in the merchant's terms: their own edit won the race. */
export const CAMPAIGN_PLAN_CHANGED_MID_DISPATCH =
  "This campaign's approved list changed while this was starting, so nothing was started for it. Review the updated plan and confirm again.";

/** Copy for "we could not check", which is NOT the same as "it was fine". Nothing was charged
 *  because the check runs before create/reserve inside the same transaction. */
export const CAMPAIGN_APPROVAL_CHECK_UNKNOWN =
  "We couldn't confirm this campaign's approved list before starting, so nothing was started and nothing was charged. Try again.";

/** Server-derived lock name. One derivation, so both sides cannot drift onto different locks. */
export function campaignApprovalLockKey(campaignId: string): string {
  return `campaign-approval:${campaignId}`;
}

/**
 * What a dispatch must still be true for. `stillApproved` is the caller's re-derivation of the
 * approval it is spending against, evaluated against the plan as persisted RIGHT NOW.
 */
export interface CampaignApprovalGate {
  ownerId: string;
  campaignId: string;
  stillApproved: (planJson: unknown) => boolean;
}

/** The surface the gate needs from the money transaction's client — read + lock only. */
export type ApprovalGateClient = Pick<PrismaClient, "$executeRaw" | "campaign">;

/**
 * Gates ride on the exact in-process request object handed to startGen. They are never removed:
 * the entry dies with the request object, and a gate can only ever add a refusal, so a lingering
 * one cannot loosen anything.
 */
const CAMPAIGN_APPROVAL_GATES = new WeakMap<object, CampaignApprovalGate>();

/** Bind a gate to THIS request object and hand the object straight on to startGen. */
export function attachCampaignApprovalGate<T extends object>(req: T, gate: CampaignApprovalGate): T {
  CAMPAIGN_APPROVAL_GATES.set(req, gate);
  return req;
}

/** The gate this request carries, if any. Requests without one are dispatched unchanged. */
export function campaignApprovalGateFor(req: unknown): CampaignApprovalGate | undefined {
  if (req === null || typeof req !== "object") return undefined;
  return CAMPAIGN_APPROVAL_GATES.get(req as object);
}

/** Raised inside the money transaction so it rolls back before create/reserve. */
export class CampaignApprovalGateRefused extends Error {
  constructor(
    readonly userError: string,
    /** `conflict` = a decided "no" (the plan moved); `retryable` = we could not tell, and
     *  stopped before spending, so the same logical action may be retried as itself. */
    readonly refusal: "conflict" | "retryable",
  ) {
    super("CAMPAIGN_APPROVAL_GATE_REFUSED");
    this.name = "CampaignApprovalGateRefused";
  }
}

/**
 * Run the gate inside the transaction that is about to commit the charge. Call it FIRST, before
 * the project lock and before anything is created or reserved.
 */
export async function applyCampaignApprovalGate(
  tx: ApprovalGateClient,
  gate: CampaignApprovalGate,
): Promise<void> {
  const lockKey = campaignApprovalLockKey(gate.campaignId);
  let approved: boolean;
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
    const campaign = await tx.campaign.findFirst({
      where: { id: gate.campaignId, ownerId: gate.ownerId, deletedAt: null },
      select: { planJson: true },
    });
    approved = campaign !== null && gate.stillApproved(campaign.planJson);
  } catch (error) {
    console.warn(
      "campaign-approval-lock: approval check failed before dispatch (nothing charged):",
      error instanceof Error ? error.message : error,
    );
    throw new CampaignApprovalGateRefused(CAMPAIGN_APPROVAL_CHECK_UNKNOWN, "retryable");
  }
  if (!approved) throw new CampaignApprovalGateRefused(CAMPAIGN_PLAN_CHANGED_MID_DISPATCH, "conflict");
}

/** The ONE translation from a gate refusal to a caller-visible result, so every caller (and
 *  every test double standing in for startGen) reports the same thing. */
export function campaignApprovalGateRefusal(
  error: unknown,
): { error: string; disposition: "conflict" | "retryable" } | null {
  return error instanceof CampaignApprovalGateRefused
    ? { error: error.userError, disposition: error.refusal }
    : null;
}
