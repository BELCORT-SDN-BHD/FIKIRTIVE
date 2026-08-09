"use client";
import React, { useState } from "react";
import { ClipboardList, Film, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { creditsLabel } from "@/lib/credit-format";
import { TopUpNotice } from "@/components/exits/Exits";
import { runPackApprovalLoop, type PackApprovalOutcome } from "./approval-chain";
import type { CardState } from "@/lib/otto-inject-helpers";
import { packTotalCredits, canAffordPack } from "./pack-credit-math";
// r2 P1-3: the pack reads its cards through the SAME contract parser and the SAME price
// predicate as the single card. It used to hand-roll a `SlimPayload` cast and guess a
// price from the record-only USD estimate, so a pack could offer "Make all" on a total
// the server never quoted.
import { planCardGate } from "./plan-card-contract";

/** The per-card shape PackCard receives from OttoChatStream. */
export interface PackCardItem {
  cardId: string;
  payload: unknown;
  threadId: string;
  genJobId: string | null;
  cardState: CardState;
  pendingApproval: boolean;
}

/** Shown in a row whose card carries no price we can vouch for — never a guessed number. */
export const PACK_UNPRICED_ROW = "price unavailable";

/** Shown instead of the pack total + "Make all" when any card in the pack has no
 *  guaranteed price (or didn't read in full). Batch approval is all-or-nothing, so one
 *  unpriceable card takes the whole batch button with it. */
export const PACK_UNPRICED_NOTE =
  "I can't put a firm price on every item here, so I won't run them as a batch — ask me to put this together again and I'll make a fresh set.";

export interface PackCardProps {
  packTitle: string;
  cards: PackCardItem[];
  balanceUsd: number;
  /** Called once the loop settles with at least one successful fire (#498
   *  round-5): the loop's server-sourced outcome — what actually fired, the
   *  authoritative still-pending ids, the latest localized receipt, and any
   *  persisted narration ids — so the parent derives its state from the SAME
   *  facts (no parent-side re-derivation). */
  onApproved: (outcome: PackApprovalOutcome) => void;
}

/** Renders a group of GEN_CARD messages that share a packId as one unit.
 *  Shows a "Make all (N · X credits)" primary button that fires generation
 *  SEQUENTIALLY for each card via the same per-card paths (coworkGenerate /
 *  ottoApprove) as OttoPlanCard — no new server action.
 *
 *  Money path: unchanged. The confirm step and the insufficient-balance guard
 *  fulfil the "confirm before spending real money" rule. */
export function PackCard({ packTitle, cards, balanceUsd, onApproved }: PackCardProps) {
  const [confirming, setConfirming] = useState(false);
  /** The ONE row whose per-item confirm step is open (#786). Same shape as `confirming`
   *  above, one level down: nothing spends until the merchant confirms. */
  const [confirmingCardId, setConfirmingCardId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** The card the loop is firing right now. Held by id, not by index into idleCards:
   *  a per-item run fires a SUBSET, so an index would point at the wrong row (#786). */
  const [currentCardId, setCurrentCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track which cards finished in this session so we can show per-row feedback.
  const [doneCardIds, setDoneCardIds] = useState<Set<string>>(new Set());

  /** #498 round-4: the SERVER's localized receipt when an approve in this pack's
   *  loop parked again (chained needs_approval). Display copy only, verbatim. */
  const [chainedReceipt, setChainedReceipt] = useState<string | null>(null);

  // One gate per card — the same one OttoPlanCard uses. `p` is the PARSED payload
  // (malformed fields dropped and accounted for), `credits` is guaranteed or null.
  const parsedCards = cards.map((c) => {
    const gate = planCardGate(c.payload);
    return { ...c, p: gate.value, credits: gate.credits, approvable: gate.approvable };
  });

  // null ⇒ at least one card has no price we can vouch for, so this pack has no total
  // and no batch approval (see the footer).
  const totalCredits = packTotalCredits(cards);
  const canAfford = totalCredits !== null && canAffordPack(totalCredits, balanceUsd);

  // Only idle (not yet submitted / not already working/done) cards need firing.
  const idleCards = parsedCards.filter((c) => c.cardState === "idle");

  // The items this merchant could still start ONE AT A TIME (#786). Each is judged by its
  // OWN gate — readable, priced, no malformed field — and its own price against the wallet.
  // This is what makes "or approve them individually" a fact rather than a suggestion: the
  // notice may only name that option while this list has something in it, and the per-item
  // controls below render for exactly these rows.
  const affordableIdleCards = idleCards.filter(
    (c) => c.approvable && c.credits !== null && canAffordPack(c.credits, balanceUsd),
  );

  // If all cards are non-idle (all working/done/failed), the pack is fully running.
  const allSubmitted = idleCards.length === 0;
  // The one state in which the product offers the per-item route: the batch is priced and
  // out of reach, and at least one item is not. `alternative` on the notice below is fed
  // from THIS SAME flag, so the sentence and the controls cannot disagree.
  const offerIndividual = !allSubmitted && totalCredits !== null && !canAfford && affordableIdleCards.length > 0;
  // F11: "failed" cards are non-idle too, so allSubmitted alone would show a green success footer
  // even when every card failed. Count only the non-failed (actually started) ones.
  const startedCount = parsedCards.filter((c) => c.cardState !== "failed").length;

  /** Fire `targets` through the pack loop. ONE body for both ways in — "Make all" hands it
   *  every idle card, a per-item approve hands it exactly one (#786) — so the two cannot
   *  drift apart: same server actions, same pending-set contract, same outcome handed up.
   *  Nothing money-shaped is added here; a subset is just a shorter list. */
  async function runCards(targets: typeof idleCards) {
    if (running || targets.length === 0) return;
    // Fail closed on the SAME gate the rows render from: a card we couldn't read, couldn't
    // price, or couldn't read in full may not start a spend, whatever path got here.
    if (targets.some((c) => !c.approvable || c.credits === null)) return;
    setConfirming(false);
    setConfirmingCardId(null);
    setRunning(true);
    setError(null);

    // #498 round-5: the loop itself is the pure runPackApprovalLoop — ONE
    // authoritative pending set (seeded from pendingApproval, updated only from
    // each server response), channel picked AT CALL TIME, and a card the server
    // re-reports pending is never settled (its approve gate survives). This
    // component only wires the real server actions and maps outcome → state.
    const outcome = await runPackApprovalLoop({
      cards: targets,
      fire: (c, pendingApproval) =>
        pendingApproval
          ? ottoApprove({ threadId: c.threadId, cardId: c.cardId })
          : coworkGenerate({
              cardId: c.cardId,
              prompt: c.p.structuredPrompt ?? "",
              entityIds: Array.isArray(c.p.entityIds) ? c.p.entityIds : [],
              variantSel: c.p.variantSel && typeof c.p.variantSel === "object" ? c.p.variantSel : {},
            }),
      onCardStart: (i) => setCurrentCardId(targets[i].cardId),
      onCardSettled: (cardId, cleared) => {
        // A re-reported-pending card gets no ✓ — it still needs its approval.
        if (cleared) setDoneCardIds((prev) => new Set(prev).add(cardId));
        // Per card, not just per pack: a ten-card pack should show the balance draining
        // as it goes rather than jumping once at the end (#550).
        notifyBalanceRefresh();
      },
    });

    setRunning(false);
    setCurrentCardId(null);
    notifyBalanceRefresh();
    if (outcome.failure) {
      const { index, message } = outcome.failure;
      // "Card 2 of 5" only means something in a batch. A single-item run says which card
      // it was by being the one the merchant just pressed.
      const where = targets.length > 1 ? `Card ${index + 1} of ${targets.length}` : null;
      setError(
        message
          ? where
            ? `${where}: ${message}`
            : message
          : where
          ? `${where} failed — please try again.`
          : "That one didn't start — please try again.",
      );
    }
    // The receipt only makes sense while something is still awaiting approval.
    setChainedReceipt(outcome.pendingCardIds.length > 0 ? outcome.fallbackReply : null);
    // F11: earlier cards in this loop were already charged + started — hand the
    // outcome up even when a later card failed, so their paid results still
    // surface (don't strand them). Nothing fired ⇒ nothing changed ⇒ no call
    // (the pending set can only move on a server response).
    if (outcome.firedCardIds.length > 0) onApproved(outcome);
  }

  /** The batch. Fails closed on the footer's own gate: no guaranteed pack total ⇒ no
   *  batch spend, whatever path got here. */
  function makeAll() {
    if (totalCredits === null) return;
    return runCards(idleCards);
  }

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ maxWidth: 520 }}>
      {/* Pack card: bg-accent = --brand-tint (#F4F4F3 neutral tint) in .fk.gb-skin context */}
      <div className="rounded-[var(--radius-card)] border border-border bg-secondary p-6">
        {/* Pack header */}
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList size={20} className="text-primary" />
          <span className="text-[1rem] font-bold text-foreground">
            {packTitle}
          </span>
          <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-[0.75rem] text-muted-foreground">
            {cards.length} {cards.length === 1 ? "item" : "items"}
          </span>
        </div>

        {/* Per-card compact rows */}
        <div className="flex flex-col gap-2">
          {parsedCards.map((c, idx) => {
            const isVideo = c.p.kind === "video";
            const desc = c.p.structuredPrompt || (isVideo ? "A short video" : "An image");
            const isDone = doneCardIds.has(c.cardId) || c.cardState === "done" || c.cardState === "working";
            const isFailed = c.cardState === "failed";
            // The merchant stopped this one. Not a failure, so no dimming and no red word
            // — without its own branch it fell through to the "queued" row and sat there
            // for ever, which is the pack's version of the eternal spinner (#602 r2).
            const isCancelled = c.cardState === "cancelled";
            const isGenerating = c.cardState === "idle" && running && currentCardId === c.cardId;
            // #786 — the row-level way out the footer's notice names. Offered exactly where
            // it is promised: the batch is out of reach, but THIS item is not. (When the
            // whole batch is affordable the pack's own "Make all" is the way through, so
            // nothing is claimed and nothing is rendered — widening it to that case would
            // be a product change nobody asked for.)
            const canMakeThis = offerIndividual && affordableIdleCards.some((a) => a.cardId === c.cardId);

            return (
              <React.Fragment key={c.cardId}>
                <div
                  className="flex items-center gap-3 rounded-[14px] bg-card px-3 py-2.5"
                  style={{ opacity: isFailed || isCancelled ? 0.6 : 1 }}
                >
                  {/* Icon bubble: --brand-soft in .fk.gb-skin = neutral gray #ECECEA = .gb --accent */}
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-accent text-foreground">
                    {isVideo ? <Film size={17} /> : <ImageIcon size={17} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] font-semibold text-foreground">
                      {desc}
                    </div>
                    <div className="text-[0.75rem] text-muted-foreground">
                      {c.credits === null ? PACK_UNPRICED_ROW : creditsLabel(c.credits)}
                    </div>
                  </div>
                  <div className="shrink-0 text-[0.75rem]">
                    {isCancelled ? (
                      <span className="text-muted-foreground">cancelled</span>
                    ) : isFailed ? (
                      <span className="text-[var(--error-soft-foreground)]">failed</span>
                    ) : isDone ? (
                      <span className="text-[var(--success)]">✓</span>
                    ) : isGenerating ? (
                      <span className="text-muted-foreground">starting…</span>
                    ) : canMakeThis ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-[11px]"
                        disabled={running}
                        onClick={() => setConfirmingCardId(c.cardId)}
                      >
                        Make this
                      </Button>
                    ) : (
                      <span className="text-muted-foreground/70">queued</span>
                    )}
                  </div>
                  <div className="shrink-0 text-[0.75rem] text-muted-foreground">
                    #{idx + 1}
                  </div>
                </div>

                {/* The per-item confirm step — the same "say the price, then spend" shape the
                    batch and the single plan card both use. */}
                {confirmingCardId === c.cardId && c.credits !== null && (
                  <div className="rounded-[14px] bg-card px-3 py-2.5">
                    <div className="mb-3 text-[0.875rem] text-foreground">
                      Make item {idx + 1} for {creditsLabel(c.credits)}? This will spend real credits.
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="default"
                        size="sm"
                        className="rounded-[11px]"
                        disabled={running}
                        onClick={() => void runCards([c])}
                      >
                        {running ? "Starting…" : "Confirm — make this"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-[11px]"
                        disabled={running}
                        onClick={() => setConfirmingCardId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Pack footer */}
        <div className="mt-4 border-t border-border pt-4">
          {!allSubmitted && totalCredits === null && (
            <div role="alert" className="text-[0.875rem] text-[var(--warning-soft-foreground)]">
              {PACK_UNPRICED_NOTE}
            </div>
          )}

          {!allSubmitted && totalCredits !== null && (
            <>
              <div className="mb-3 text-[1.375rem] font-bold text-foreground">
                Total {creditsLabel(totalCredits)}
              </div>

              {!canAfford && (
                // #707 gave the top-up half a real link. #786 makes the other half true: the
                // pack renders as ONE card, so "approve them individually" pointed at controls
                // that did not exist. The alternative is now named only when `offerIndividual`
                // says the rows above really carry it — TopUpNotice's own rule is "no
                // alternative unless there really is one", and this is that rule being kept.
                <div className="mb-3">
                  <TopUpNotice
                    need={`make all ${cards.length}`}
                    alternative={offerIndividual ? "approve them individually" : undefined}
                  />
                </div>
              )}

              {confirming ? (
                <div>
                  <div className="mb-3 text-[0.875rem] text-foreground">
                    Make all {idleCards.length} {idleCards.length === 1 ? "item" : "items"} for {creditsLabel(totalCredits)}? This will spend real credits.
                  </div>
                  <div className="flex gap-3">
                    <Button variant="default" size="default" disabled={running} onClick={() => void makeAll()}>
                      {running ? "Starting…" : "Confirm — make all"}
                    </Button>
                    <Button variant="secondary" size="default" disabled={running} onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="default"
                  size="default"
                  disabled={!canAfford || running}
                  onClick={() => setConfirming(true)}
                >
                  Make all ({idleCards.length} · {creditsLabel(totalCredits)})
                </Button>
              )}
            </>
          )}

          {allSubmitted && !running && startedCount > 0 && (
            <div className="text-[0.875rem] font-semibold text-[var(--success)]">
              ✓ {startedCount === cards.length ? `All ${cards.length}` : `${startedCount} of ${cards.length}`} {cards.length === 1 ? "item" : "items"} started
            </div>
          )}

          {/* #498 round-4: chained needs_approval observed in this loop — the SERVER's
              localized receipt verbatim (the still-pending cards keep their own
              approve gates; no spend logic here). */}
          {chainedReceipt && (
            <div className="mt-2 text-[0.75rem] text-muted-foreground">
              {chainedReceipt}
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default PackCard;
