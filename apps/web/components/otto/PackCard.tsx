"use client";
import React, { useState } from "react";
import { ClipboardList, Film, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { creditsLabel } from "@/lib/credit-format";
import { runPackApprovalLoop, type PackApprovalOutcome } from "./approval-chain";
import type { CardState } from "@/lib/otto-inject-helpers";
import { packTotalCredits, canAffordPack } from "./pack-credit-math";

/** The per-card shape PackCard receives from OttoChatStream. */
export interface PackCardItem {
  cardId: string;
  payload: unknown;
  threadId: string;
  genJobId: string | null;
  cardState: CardState;
  pendingApproval: boolean;
}

/** Payload fields PackCard reads from each card's payload (same shape as OttoPlanCard). */
type SlimPayload = {
  kind?: string;
  structuredPrompt?: string;
  estimatedCredits?: number;
  estimatedPriceUsd?: number;
  entityIds?: string[];
  variantSel?: Record<string, string>;
};

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
  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track which cards finished in this session so we can show per-row feedback.
  const [doneCardIds, setDoneCardIds] = useState<Set<string>>(new Set());

  /** #498 round-4: the SERVER's localized receipt when an approve in this pack's
   *  loop parked again (chained needs_approval). Display copy only, verbatim. */
  const [chainedReceipt, setChainedReceipt] = useState<string | null>(null);

  const parsedCards = cards.map((c) => {
    const p = (c.payload ?? {}) as SlimPayload;
    // Inline credit calculation for each card: match payloadCredits logic
    const credits =
      typeof p.estimatedCredits === "number"
        ? p.estimatedCredits
        : Math.max(1, Math.ceil((typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : 0) / 0.1));
    return { ...c, p, credits };
  });

  const totalCredits = packTotalCredits(cards);
  const canAfford = canAffordPack(totalCredits, balanceUsd);

  // Only idle (not yet submitted / not already working/done) cards need firing.
  const idleCards = parsedCards.filter((c) => c.cardState === "idle");

  // If all cards are non-idle (all working/done/failed), the pack is fully running.
  const allSubmitted = idleCards.length === 0;
  // F11: "failed" cards are non-idle too, so allSubmitted alone would show a green success footer
  // even when every card failed. Count only the non-failed (actually started) ones.
  const startedCount = parsedCards.filter((c) => c.cardState !== "failed").length;

  async function makeAll() {
    if (running) return;
    setConfirming(false);
    setRunning(true);
    setError(null);

    // #498 round-5: the loop itself is the pure runPackApprovalLoop — ONE
    // authoritative pending set (seeded from pendingApproval, updated only from
    // each server response), channel picked AT CALL TIME, and a card the server
    // re-reports pending is never settled (its approve gate survives). This
    // component only wires the real server actions and maps outcome → state.
    const outcome = await runPackApprovalLoop({
      cards: idleCards,
      fire: (c, pendingApproval) =>
        pendingApproval
          ? ottoApprove({ threadId: c.threadId, cardId: c.cardId })
          : coworkGenerate({
              cardId: c.cardId,
              prompt: c.p.structuredPrompt ?? "",
              entityIds: Array.isArray(c.p.entityIds) ? c.p.entityIds : [],
              variantSel: c.p.variantSel && typeof c.p.variantSel === "object" ? c.p.variantSel : {},
            }),
      onCardStart: (i) => setCurrentIdx(i),
      onCardSettled: (cardId, cleared) => {
        // A re-reported-pending card gets no ✓ — it still needs its approval.
        if (cleared) setDoneCardIds((prev) => new Set(prev).add(cardId));
        // Per card, not just per pack: a ten-card pack should show the balance draining
        // as it goes rather than jumping once at the end (#550).
        notifyBalanceRefresh();
      },
    });

    setRunning(false);
    setCurrentIdx(null);
    notifyBalanceRefresh();
    if (outcome.failure) {
      const { index, message } = outcome.failure;
      setError(
        message
          ? `Card ${index + 1} of ${idleCards.length}: ${message}`
          : `Card ${index + 1} of ${idleCards.length} failed — please try again.`,
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
            const isGenerating = c.cardState === "idle" && running && idleCards.findIndex((ic) => ic.cardId === c.cardId) === currentIdx;

            return (
              <div
                key={c.cardId}
                className="flex items-center gap-3 rounded-[14px] bg-card px-3 py-2.5"
                style={{ opacity: isFailed ? 0.6 : 1 }}
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
                    {creditsLabel(c.credits)}
                  </div>
                </div>
                <div className="shrink-0 text-[0.75rem]">
                  {isFailed ? (
                    <span className="text-[var(--error-soft-foreground)]">failed</span>
                  ) : isDone ? (
                    <span className="text-[var(--success)]">✓</span>
                  ) : isGenerating ? (
                    <span className="text-muted-foreground">starting…</span>
                  ) : (
                    <span className="text-muted-foreground/70">queued</span>
                  )}
                </div>
                <div className="shrink-0 text-[0.75rem] text-muted-foreground">
                  #{idx + 1}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pack footer */}
        <div className="mt-4 border-t border-border pt-4">
          {!allSubmitted && (
            <>
              <div className="mb-3 text-[1.375rem] font-bold text-foreground">
                Total {creditsLabel(totalCredits)}
              </div>

              {!canAfford && (
                <div role="alert" className="mb-3 text-[0.875rem] text-[var(--error-soft-foreground)]">
                  Not enough credits to make all {cards.length} — top up or approve individually.
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
