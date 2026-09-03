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
 *   - nextPendingApprovalCardIds: apply a server response to the pending set —
 *     a chained response's COMPLETE set replaces it wholesale (round-7, see the
 *     ChainedApproval.pendingCardIds contract); a chained card MUST render with
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
  /**
   * CONTRACT (#498 round-7) — the single fact source for BOTH sides of this
   * seam; otto-actions.ts's needs_approval constructions cite this comment.
   *
   * `pendingCardIds` is the COMPLETE set of the thread's currently-parked
   * approval-gated calls after this response — NOT a "new this round"
   * increment. Every still-undecided park re-interrupts on every resume and is
   * re-collected whole (finalizeOttoTurn → collectApprovalInterruptions), with
   * STABLE ids across rounds: a generate park rides its pre-persisted GEN_CARD
   * id; a non-generate re-park dedupes to its EXISTING APPROVAL_CARD id
   * (persistPendingApprovalCards). Consequences consumers rely on:
   *   - a needs_approval response REPLACES any client-held pending set — an id
   *     absent from it is no longer pending (resolved / expired / superseded),
   *     and keeping it would be a stale private ledger;
   *   - a status:"done" resume response implies the set is EMPTY — a run
   *     cannot complete past an undecided park.
   */
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

/** Next pending-approval set after an approve. When the response parked again
 *  (`chainedPendingCardIds` present) that array is the server's COMPLETE set
 *  (ChainedApproval.pendingCardIds contract) and REPLACES the local set — an id
 *  the server no longer reports leaves with it, and a just-clicked card stays
 *  pending iff re-reported. Without a chained outcome the response carried no
 *  set information, so only the fired ids leave. Never mutates the input set. */
export function nextPendingApprovalCardIds(
  cur: ReadonlySet<string>,
  approvedCardIds: readonly string[],
  chainedPendingCardIds?: readonly string[],
): Set<string> {
  if (chainedPendingCardIds) return new Set(chainedPendingCardIds);
  const next = new Set(cur);
  approvedCardIds.forEach((id) => next.delete(id));
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
  /** The still-pending ids after the last server response. Thread-authoritative
   *  only when `pendingFromServer` is true. */
  pendingCardIds: string[];
  /** True when a resume response anchored `pendingCardIds` to the server's
   *  COMPLETE thread set (a needs_approval replaced it, or a completed resume
   *  proved it empty). False ⇒ no resume response spoke: the set is only the
   *  pack's render-time seed minus fired cards, and callers must NOT replace
   *  thread-level state with it. */
  pendingFromServer: boolean;
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
 *     knowledge), then updated ONLY from server responses (the single fact
 *     source): a needs_approval response's COMPLETE set replaces the whole set
 *     (ChainedApproval.pendingCardIds contract — a fired card survives iff
 *     re-reported, a stale id leaves), a completed resume empties it, and any
 *     other success consumes just the fired card;
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
  let pendingFromServer = false;

  const outcome = (failure: PackApprovalOutcome["failure"]): PackApprovalOutcome => ({
    firedCardIds,
    pendingCardIds: [...pending],
    pendingFromServer,
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
    // Server response = the sole fact source for the pending set
    // (ChainedApproval.pendingCardIds contract):
    const chained = chainedApprovalOf(res);
    if (chained) {
      // needs_approval carries the COMPLETE thread set — replace wholesale. The
      // fired card survives iff re-reported; an id the server dropped leaves
      // (keeping it would be a stale private ledger). Narration ids and the
      // latest receipt ride along.
      pending.clear();
      chained.pendingCardIds.forEach((id) => pending.add(id));
      pendingFromServer = true;
      if (chained.fallbackReply) fallbackReply = chained.fallbackReply;
      if (chained.narrationMessageId) narrationMessageIds.push(chained.narrationMessageId);
    } else if (res && typeof res === "object" && (res as { status?: unknown }).status === "done") {
      // A COMPLETED resume proves the RunState holds no parks at all (a run
      // cannot complete past an undecided one — only ottoApprove returns the
      // lowercase "done"; GenStatus strings are uppercase). Empty the set so
      // later cards route to the generate channel, never a doomed ottoApprove.
      pending.clear();
      pendingFromServer = true;
    } else {
      // No set information (coworkGenerate ok / already-resolved / degraded /
      // stale): the fired card's park is consumed; nothing else moves.
      pending.delete(card.cardId);
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
 *  no OTHER text is ever re-injected (streamed replies already rendered) —
 *  deliberately NOT `backfillMissingAssistantText` (P2-1) here: this poll runs
 *  repeatedly while a generation is in flight, mid-turn, well before the server
 *  has necessarily persisted any narration for THIS turn — guessing at a TEXT
 *  here would risk pulling in an unrelated durable line (`approval-chain.
 *  test.ts`'s "un-named TEXT is never re-injected" pins exactly this). The
 *  backfill instead runs once, at the live turn's own `onFinish`
 *  (`OttoChatStream.tsx`) — the one moment "this turn's live text, or none" is
 *  actually decided. */
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
