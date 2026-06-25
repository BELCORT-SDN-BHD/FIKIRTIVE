"use client";
import React, { useState } from "react";
import { ClipboardList, Film, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import type { EntityDTO } from "@/lib/types";

export interface OttoPlanCardProps {
  cardId: string;
  payload: unknown;
  entities: EntityDTO[];
  threadId: string;
  projectId: string;
  alreadyGenerated: boolean;
  hasDurableResult: boolean;
  pendingApproval: boolean;
  onApproved: () => void;
  onChangeSomething: () => void;
}

type CardPayload = {
  kind?: string;
  structuredPrompt?: string;
  estimatedPriceUsd?: number;
  entityIds?: string[];
  variantSel?: Record<string, string>;
};

/** The plan card — Otto's "Here's what I'll make" with the one total and the approve gate.
 *  Approve resumes the parked generate via ottoApprove (the metered spend path). */
export function OttoPlanCard({
  cardId,
  payload,
  threadId,
  alreadyGenerated,
  hasDurableResult,
  pendingApproval,
  onApproved,
  onChangeSomething,
}: OttoPlanCardProps) {
  const p = (payload ?? {}) as CardPayload;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadyGenerated);

  const isVideo = p.kind === "video";
  const price = typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : 0;
  const desc = p.structuredPrompt || (isVideo ? "A short video" : "An image");
  const settled = done || hasDurableResult;

  async function approve() {
    if (busy || settled) return;
    setBusy(true);
    setError(null);
    try {
      // Two spend paths. If Otto PARKED a generate (the turn returned needs_approval),
      // resume it via ottoApprove. Otherwise this is a freshly PROPOSED card — trigger
      // generation directly with coworkGenerate. (ottoApprove on a proposed card fails
      // with "That card isn't awaiting approval", which is why generation never started.)
      const res = pendingApproval
        ? await ottoApprove({ threadId, cardId })
        : await coworkGenerate({
            cardId,
            prompt: p.structuredPrompt ?? "",
            entityIds: Array.isArray(p.entityIds) ? p.entityIds : [],
            variantSel: p.variantSel && typeof p.variantSel === "object" ? p.variantSel : {},
          });
      if (res && "error" in res) {
        setError(res.error);
        return;
      }
      setDone(true);
      onApproved();
    } catch {
      setError("Couldn't start that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <Card variant="tint" padding="md">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <ClipboardList size={20} color="var(--brand)" />
          <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-base)", color: "var(--text-strong)" }}>
            Here&rsquo;s what I&rsquo;ll make
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
          <span style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: "var(--brand-soft)", color: "var(--on-brand-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isVideo ? <Film size={21} /> : <ImageIcon size={21} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-sm)", color: "var(--text-strong)" }}>
              {isVideo ? "A short video" : "An image"}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {desc}
            </div>
          </div>
        </div>

        <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-xl)", color: "var(--text-strong)" }}>
            About ${price.toFixed(2)}
          </div>
        </div>

        {settled ? (
          <div style={{ marginTop: "var(--space-4)", fontSize: "var(--text-sm)", color: "var(--success-700)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"] }}>
            ✓ On it — making this now.
          </div>
        ) : (
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
            <Button variant="primary" size="md" disabled={busy} onClick={approve}>
              {busy ? "Starting…" : `Make it · $${price.toFixed(2)}`}
            </Button>
            <Button variant="secondary" size="md" disabled={busy} onClick={onChangeSomething}>
              Change something
            </Button>
          </div>
        )}

        {error ? (
          <div role="alert" style={{ marginTop: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-700)" }}>
            {error}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
            <ShieldCheck size={15} /> Nothing is charged until you approve — and you can always undo.
          </div>
        )}
      </Card>
    </div>
  );
}

export default OttoPlanCard;
