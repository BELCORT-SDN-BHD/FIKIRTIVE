/**
 * approval-chain — PURE client-side helpers for the #498 chained-approval seam
 * (round-4). When an ottoApprove resume parks AGAIN (status "needs_approval"),
 * the server has already persisted the new GEN_CARDs and a localized receipt
 * (fallbackReply); these helpers carry that state through the client so the
 * chain never breaks:
 *
 *   - chainedApprovalOf: parse an approve result into the chained outcome
 *     (OttoPlanCard / PackCard hand it up via onApproved).
 *   - nextPendingApprovalCardIds: drop the approved card(s) from the pending
 *     set and ADD the chained ids — a chained card MUST render with
 *     pendingApproval=true so its click resumes the RunState via ottoApprove,
 *     never coworkGenerate (which would refuse a parked card).
 *   - mergeDurableIntoLive: the post-approve poll merge — results AND any new
 *     cards, so a chained park's fresh cards render without a reload.
 *
 * No spend logic here: everything money-adjacent stays in ottoApprove/startGen.
 * Mirrors the pack-credit-math.ts pattern (pure module beside the components,
 * unit-tested in apps/web/lib/__tests__/approval-chain.test.ts).
 */
import type { OttoUiMessage } from "@/lib/otto-ui-messages";
import type { ChatThreadDTO } from "@/lib/types";
import { appendDurableResults, appendMissingCards, syncCardJobIds } from "@/lib/otto-inject-helpers";

/** A resume that parked again: the still-pending card ids plus the server's
 *  localized receipt (null when the model narrated its own text). */
export type ChainedApproval = { pendingCardIds: string[]; fallbackReply: string | null };

/** Parse an approve/generate action result into its chained outcome, or null when
 *  the run completed (or the result is an error / any other shape). */
export function chainedApprovalOf(res: unknown): ChainedApproval | null {
  if (!res || typeof res !== "object") return null;
  const r = res as { status?: unknown; pendingCardIds?: unknown; fallbackReply?: unknown };
  if (r.status !== "needs_approval") return null;
  const pendingCardIds = Array.isArray(r.pendingCardIds)
    ? r.pendingCardIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    pendingCardIds,
    fallbackReply: typeof r.fallbackReply === "string" ? r.fallbackReply : null,
  };
}

/** Next pending-approval set after an approve: the approved ids leave, the chained
 *  ids join. Order matters — a card the server reports as STILL pending stays
 *  pending even if it was just clicked. Never mutates the input set. */
export function nextPendingApprovalCardIds(
  cur: ReadonlySet<string>,
  approvedCardIds: readonly string[],
  chainedPendingCardIds?: readonly string[],
): Set<string> {
  const next = new Set(cur);
  approvedCardIds.forEach((id) => next.delete(id));
  (chainedPendingCardIds ?? []).forEach((id) => next.add(id));
  return next;
}

/** Merge the polled durable thread into the live useChat list: sync genJobIds,
 *  append worker results (GEN_RESULT / TURN_ERROR), AND append any card-kind
 *  durables missing from the list — a chained park's new GEN_CARDs arrive via a
 *  server action (no live stream), so without this they never render until a
 *  reload. All three helpers dedupe by durableId; TEXT is never re-injected. */
export function mergeDurableIntoLive(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
): OttoUiMessage[] {
  return appendMissingCards(appendDurableResults(syncCardJobIds(messages, fresh), fresh), fresh);
}
