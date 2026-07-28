/**
 * approval-chain — PURE client-side helpers for the #498 chained-approval seam
 * (round-4, reworked in round-5). When an ottoApprove resume parks AGAIN (status
 * "needs_approval"), the server has already persisted the new GEN_CARDs plus a
 * visible reply (model narration, or a synthesized localized receipt as
 * fallbackReply); these helpers carry that state through the client so the
 * chain never breaks:
 *
 *   - chainedApprovalOf: parse an approve result into the chained outcome
 *     (OttoPlanCard / PackCard hand it up via onApproved).
 *   - runPackApprovalLoop (#498 round-5): the pack "Make all" loop as a REAL,
 *     executable unit. ONE authoritative pending set, updated only from each
 *     server response's pendingCardIds; every card picks its channel
 *     (ottoApprove vs coworkGenerate) from that set AT CALL TIME.
 *   - nextPendingApprovalCardIds: drop the fired card(s) from the pending set
 *     and ADD the server-reported ids — a chained card MUST render with
 *     pendingApproval=true so its click resumes the RunState via ottoApprove,
 *     never coworkGenerate (which would refuse a parked card).
 *   - mergeDurableIntoLive: the post-approve poll merge — results, any new
 *     cards, AND (round-5) the chained park's model narration, so everything the
 *     server persisted renders without a reload.
 *
 * No spend logic here: everything money-adjacent stays in ottoApprove/startGen.
 * Mirrors the pack-credit-math.ts pattern (pure module beside the components,
 * unit-tested in apps/web/lib/__tests__/approval-chain.test.ts).
 */
import type { OttoUiMessage } from "@/lib/otto-ui-messages";
import type { ChatThreadDTO } from "@/lib/types";
import { appendChainedNarrations, appendDurableResults, appendMissingCards, syncCardJobIds } from "@/lib/otto-inject-helpers";

/** A resume that parked again: the still-pending card ids, the server's localized
 *  receipt (null when the model narrated its own text), and — when the model DID
 *  narrate — the persisted narration TEXT's durable id for live injection. */
export type ChainedApproval = {
  pendingCardIds: string[];
  fallbackReply: string | null;
  narrationMessageId: string | null;
};

/** Parse an approve/generate action result into its chained outcome, or null when
 *  the run completed (or the result is an error / any other shape). */
export function chainedApprovalOf(res: unknown): ChainedApproval | null {
  if (!res || typeof res !== "object") return null;
  const r = res as { status?: unknown; pendingCardIds?: unknown; fallbackReply?: unknown; narrationMessageId?: unknown };
  if (r.status !== "needs_approval") return null;
  const pendingCardIds = Array.isArray(r.pendingCardIds)
    ? r.pendingCardIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    pendingCardIds,
    fallbackReply: typeof r.fallbackReply === "string" ? r.fallbackReply : null,
    narrationMessageId: typeof r.narrationMessageId === "string" ? r.narrationMessageId : null,
  };
}

/** Next pending-approval set after an approve: the fired ids leave, the server-
 *  reported ids join. Order matters — a card the server reports as STILL pending
 *  stays pending even if it was just clicked. Never mutates the input set. */
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

// ─────────────────────────────────────────────────────────────────────────────
// runPackApprovalLoop — the pack "Make all" loop (#498 round-5)
// ─────────────────────────────────────────────────────────────────────────────

/** What the pack loop hands up when it settles. Parent state derives from THIS
 *  (same server-sourced facts the loop itself ran on), never from its own
 *  re-derivation. */
export type PackApprovalOutcome = {
  /** Cards that received a successful server response, in firing order. */
  firedCardIds: string[];
  /** The authoritative still-pending ids after the last server response. */
  pendingCardIds: string[];
  /** The latest server-localized receipt observed (display copy, verbatim);
   *  meaningful only while pendingCardIds is non-empty. */
  fallbackReply: string | null;
  /** Durable TEXT ids of model narration persisted by chained parks along the
   *  way — the poll injects these so they render live (P2c). */
  narrationMessageIds: string[];
  /** Set when a card errored/threw; the loop stopped at that card. */
  failure: { index: number; message: string | null } | null;
};

/** Run the pack's sequential fire loop over `cards` with ONE authoritative
 *  pending set as the only routing state:
 *
 *   - seeded from each card's pendingApproval flag (the parent's render-time
 *     knowledge), then updated ONLY from server responses: a fired card leaves
 *     the set unless THAT response re-reports it, and every response's
 *     pendingCardIds are merged in on arrival (the single fact source);
 *   - each card picks ottoApprove vs coworkGenerate from the set AT CALL TIME —
 *     so a card an EARLIER response in this same loop parked is approved, never
 *     re-generated (render-time snapshots cannot see mid-loop parks);
 *   - a card the server re-reports as pending is NOT settled (`cleared=false`),
 *     so its approve gate survives (no submitted mark, no ✓).
 *
 *  `fire` performs the actual server call (injected so this loop stays pure and
 *  really executable in the node harness); it receives the call-time channel.
 *  No spend logic here — both channels are the same per-card server actions the
 *  individual card buttons use. */
export async function runPackApprovalLoop<C extends { cardId: string; pendingApproval: boolean }>(opts: {
  cards: readonly C[];
  fire: (card: C, pendingApproval: boolean) => Promise<unknown>;
  /** UI hook: the loop reached card `index` (progress display). */
  onCardStart?: (index: number) => void;
  /** UI hook: card got a successful response; `cleared=false` when the server
   *  re-reported it pending (its approve gate must survive). */
  onCardSettled?: (cardId: string, cleared: boolean) => void;
}): Promise<PackApprovalOutcome> {
  const pending = new Set(opts.cards.filter((c) => c.pendingApproval).map((c) => c.cardId));
  const firedCardIds: string[] = [];
  const narrationMessageIds: string[] = [];
  let fallbackReply: string | null = null;

  const outcome = (failure: PackApprovalOutcome["failure"]): PackApprovalOutcome => ({
    firedCardIds,
    pendingCardIds: [...pending],
    fallbackReply,
    narrationMessageIds,
    failure,
  });

  for (let i = 0; i < opts.cards.length; i++) {
    const card = opts.cards[i];
    opts.onCardStart?.(i);
    let res: unknown;
    try {
      res = await opts.fire(card, pending.has(card.cardId));
    } catch {
      return outcome({ index: i, message: null });
    }
    if (res && typeof res === "object" && "error" in res) {
      const message = (res as { error?: unknown }).error;
      return outcome({ index: i, message: typeof message === "string" ? message : null });
    }
    // Server response = the sole fact source for the pending set: the fired
    // card's park is consumed unless THIS response re-reports it; the response's
    // pendingCardIds merge in; narration ids and the latest receipt ride along.
    pending.delete(card.cardId);
    const chained = chainedApprovalOf(res);
    if (chained) {
      chained.pendingCardIds.forEach((id) => pending.add(id));
      if (chained.fallbackReply) fallbackReply = chained.fallbackReply;
      if (chained.narrationMessageId) narrationMessageIds.push(chained.narrationMessageId);
    }
    firedCardIds.push(card.cardId);
    opts.onCardSettled?.(card.cardId, !pending.has(card.cardId));
  }
  return outcome(null);
}

/** Merge the polled durable thread into the live useChat list: sync genJobIds,
 *  append worker results (GEN_RESULT / TURN_ERROR), append any card-kind
 *  durables missing from the list — a chained park's new GEN_CARDs arrive via a
 *  server action (no live stream), so without this they never render until a
 *  reload — and (#498 round-5 P2c) append the chained park's model narration
 *  TEXTs identified by `narrationMessageIds`. All helpers dedupe by durableId;
 *  no OTHER text is ever re-injected (streamed replies already rendered). */
export function mergeDurableIntoLive(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
  narrationMessageIds?: readonly string[],
): OttoUiMessage[] {
  return appendChainedNarrations(
    appendMissingCards(appendDurableResults(syncCardJobIds(messages, fresh), fresh), fresh),
    fresh,
    narrationMessageIds,
  );
}
