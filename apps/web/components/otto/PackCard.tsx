"use client";
import React, { useState } from "react";
import { ClipboardList, Film, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { creditsLabel } from "@/lib/credit-format";
import { chainedApprovalOf, type ChainedApproval } from "./approval-chain";
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
  /** Called once the loop settles. When an ottoApprove resume parked AGAIN, the
   *  chained outcome (ids still pending + server's localized receipt) rides along
   *  so the parent can mark those cards pendingApproval (#498 round-4). */
  onApproved: (chained?: ChainedApproval) => void;
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

    // #498 round-4: an ottoApprove resume mid-loop can park AGAIN (chained
    // needs_approval). Collect the still-pending ids + the server's localized
    // receipt across the loop; ids this same loop subsequently fires drop out.
    const chainedIds = new Set<string>();
    let chainedNotice: string | null = null;
    const firedIds = new Set<string>();
    const collectChained = (): ChainedApproval | undefined => {
      firedIds.forEach((id) => chainedIds.delete(id));
      return chainedIds.size > 0
        ? { pendingCardIds: [...chainedIds], fallbackReply: chainedNotice }
        : undefined;
    };

    for (let i = 0; i < idleCards.length; i++) {
      const c = idleCards[i];
      setCurrentIdx(i);
      try {
        const res = c.pendingApproval
          ? await ottoApprove({ threadId: c.threadId, cardId: c.cardId })
          : await coworkGenerate({
              cardId: c.cardId,
              prompt: c.p.structuredPrompt ?? "",
              entityIds: Array.isArray(c.p.entityIds) ? c.p.entityIds : [],
              variantSel: c.p.variantSel && typeof c.p.variantSel === "object" ? c.p.variantSel : {},
            });
        if (res && "error" in res) {
          setError(`Card ${i + 1} of ${idleCards.length}: ${res.error}`);
          setRunning(false);
          setCurrentIdx(null);
          // F11: earlier cards in this loop were already charged + started — poll them even
          // though a later card failed, so their paid results still surface (don't strand them).
          const chained = collectChained();
          setChainedReceipt(chained?.fallbackReply ?? null);
          if (i > 0 || chained) onApproved(chained);
          return;
        }
        const chained = chainedApprovalOf(res);
        if (chained) {
          chained.pendingCardIds.forEach((id) => chainedIds.add(id));
          if (chained.fallbackReply) chainedNotice = chained.fallbackReply;
        }
        firedIds.add(c.cardId);
        setDoneCardIds((prev) => new Set(prev).add(c.cardId));
      } catch {
        setError(`Card ${i + 1} of ${idleCards.length} failed — please try again.`);
        setRunning(false);
        setCurrentIdx(null);
        const chained = collectChained();
        setChainedReceipt(chained?.fallbackReply ?? null);
        if (i > 0 || chained) onApproved(chained); // F11: poll the earlier already-charged cards
        return;
      }
    }

    setRunning(false);
    setCurrentIdx(null);
    const chained = collectChained();
    setChainedReceipt(chained?.fallbackReply ?? null);
    onApproved(chained);
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
