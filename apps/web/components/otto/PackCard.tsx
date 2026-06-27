"use client";
import React, { useState } from "react";
import { ClipboardList, Film, Image as ImageIcon } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { creditsLabel } from "@/lib/credit-format";
import type { CardState } from "@/lib/otto-inject-helpers";

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

function payloadCredits(p: SlimPayload): number {
  if (typeof p.estimatedCredits === "number") return p.estimatedCredits;
  return Math.max(1, Math.ceil((typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : 0) / 0.1));
}

export interface PackCardProps {
  packTitle: string;
  cards: PackCardItem[];
  balanceUsd: number;
  onApproved: () => void;
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

  const parsedCards = cards.map((c) => {
    const p = (c.payload ?? {}) as SlimPayload;
    return { ...c, p, credits: payloadCredits(p) };
  });

  const totalCredits = parsedCards.reduce((sum, c) => sum + c.credits, 0);

  // The balance prop is in USD; 1 displayed credit = $0.10 per credit-format.ts convention.
  const balanceCredits = balanceUsd / 0.1;
  const canAfford = balanceCredits >= totalCredits;

  // Only idle (not yet submitted / not already working/done) cards need firing.
  const idleCards = parsedCards.filter((c) => c.cardState === "idle");

  // If all cards are non-idle (all working/done/failed), the pack is fully running.
  const allSubmitted = idleCards.length === 0;

  async function makeAll() {
    if (running) return;
    setConfirming(false);
    setRunning(true);
    setError(null);

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
          return;
        }
        setDoneCardIds((prev) => new Set(prev).add(c.cardId));
      } catch {
        setError(`Card ${i + 1} of ${idleCards.length} failed — please try again.`);
        setRunning(false);
        setCurrentIdx(null);
        return;
      }
    }

    setRunning(false);
    setCurrentIdx(null);
    onApproved();
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <Card variant="tint" padding="md">
        {/* Pack header */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <ClipboardList size={20} color="var(--brand)" />
          <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-base)", color: "var(--text-strong)" }}>
            {packTitle}
          </span>
          <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--text-muted)", background: "var(--surface-raised)", borderRadius: "var(--radius-full)", padding: "2px 8px" }}>
            {cards.length} {cards.length === 1 ? "item" : "items"}
          </span>
        </div>

        {/* Per-card compact rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {parsedCards.map((c, idx) => {
            const isVideo = c.p.kind === "video";
            const desc = c.p.structuredPrompt || (isVideo ? "A short video" : "An image");
            const isDone = doneCardIds.has(c.cardId) || c.cardState === "done" || c.cardState === "working";
            const isFailed = c.cardState === "failed";
            const isGenerating = running && currentIdx === idleCards.indexOf(parsedCards.find((p) => p.cardId === c.cardId) ?? c);

            return (
              <div
                key={c.cardId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  background: "var(--surface-card)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                  opacity: isFailed ? 0.6 : 1,
                }}
              >
                <span style={{ width: 32, height: 32, flex: "none", borderRadius: 8, background: "var(--brand-soft)", color: "var(--on-brand-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isVideo ? <Film size={17} /> : <ImageIcon size={17} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-strong)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {desc}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    ~{creditsLabel(c.credits)}
                  </div>
                </div>
                <div style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}>
                  {isFailed ? (
                    <span style={{ color: "var(--error-700)" }}>failed</span>
                  ) : isDone ? (
                    <span style={{ color: "var(--success-700)" }}>✓</span>
                  ) : isGenerating ? (
                    <span style={{ color: "var(--text-muted)" }}>starting…</span>
                  ) : (
                    <span style={{ color: "var(--text-faint)" }}>queued</span>
                  )}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", flexShrink: 0 }}>
                  #{idx + 1}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pack footer */}
        <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
          {!allSubmitted && (
            <>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-xl)", color: "var(--text-strong)", marginBottom: "var(--space-3)" }}>
                Total ~{creditsLabel(totalCredits)}
              </div>

              {!canAfford && (
                <div role="alert" style={{ marginBottom: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--error-700)" }}>
                  Not enough credits to make all {cards.length} — top up or approve individually.
                </div>
              )}

              {confirming ? (
                <div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-strong)", marginBottom: "var(--space-3)" }}>
                    Make all {idleCards.length} {idleCards.length === 1 ? "item" : "items"} for ~{creditsLabel(totalCredits)}? This will spend real credits.
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-3)" }}>
                    <Button variant="primary" size="md" disabled={running} onClick={() => void makeAll()}>
                      {running ? "Starting…" : "Confirm — make all"}
                    </Button>
                    <Button variant="secondary" size="md" disabled={running} onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  disabled={!canAfford || running}
                  onClick={() => setConfirming(true)}
                >
                  Make all ({idleCards.length} · ~{creditsLabel(totalCredits)})
                </Button>
              )}
            </>
          )}

          {allSubmitted && !running && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--success-700)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"] }}>
              ✓ All {cards.length} {cards.length === 1 ? "item" : "items"} started
            </div>
          )}
        </div>

        {error && (
          <div role="alert" style={{ marginTop: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-700)" }}>
            {error}
          </div>
        )}
      </Card>
    </div>
  );
}

export default PackCard;
