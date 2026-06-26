"use client";
import React, { useState, useEffect } from "react";
import { formatElapsed, usualSeconds } from "@/lib/progress-format";
import { ClipboardList, Film, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { creditsLabel } from "@/lib/credit-format";
import type { EntityDTO } from "@/lib/types";
import type { CardState } from "@/lib/otto-inject-helpers";

export interface OttoPlanCardProps {
  cardId: string;
  payload: unknown;
  entities: EntityDTO[];
  threadId: string;
  projectId: string;
  cardState: CardState;
  pendingApproval: boolean;
  onApproved: () => void;
  /** Called when the user clicks "Change something". Receives the current
   *  structuredPrompt as a seed so the caller can prefill the composer. */
  onChangeSomething: (seed: string) => void;
}

type CardPayload = {
  kind?: string;
  structuredPrompt?: string;
  estimatedPriceUsd?: number;
  /** The real charge in credits (= what startGen reserves). Shown on the card. */
  estimatedCredits?: number;
  entityIds?: string[];
  variantSel?: Record<string, string>;
};

/** The plan card — Otto's "Here's what I'll make" with the one total and the approve gate.
 *  Approve resumes the parked generate via ottoApprove (the metered spend path). */
export function OttoPlanCard({
  cardId,
  payload,
  threadId,
  cardState,
  pendingApproval,
  onApproved,
  onChangeSomething,
}: OttoPlanCardProps) {
  const p = (payload ?? {}) as CardPayload;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "no-api">("idle");

  useEffect(() => {
    if (cardState !== "working") { setElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [cardState]);

  const isVideo = p.kind === "video";
  // Show the real charge in CREDITS (= what startGen reserves). New cards carry
  // estimatedCredits; for older cards fall back to the displayed-credit equivalent
  // of the (record-only) USD estimate so nothing renders "$0.00".
  const credits =
    typeof p.estimatedCredits === "number"
      ? p.estimatedCredits
      : Math.max(1, Math.ceil((typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : 0) / 0.1));
  const desc = p.structuredPrompt || (isVideo ? "A short video" : "An image");

  async function approve() {
    if (busy || cardState !== "idle") return;
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
      onApproved();
    } catch {
      setError("Couldn't start that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    if (!p.structuredPrompt) return;
    if (!navigator.clipboard) {
      setCopyState("no-api");
      return;
    }
    navigator.clipboard.writeText(p.structuredPrompt).then(
      () => {
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 2000);
      },
      () => {
        setCopyState("no-api");
      }
    );
  }

  function handleChangeSomething() {
    onChangeSomething(p.structuredPrompt ?? "");
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

        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
          <span style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: "var(--brand-soft)", color: "var(--on-brand-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isVideo ? <Film size={21} /> : <ImageIcon size={21} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-sm)", color: "var(--text-strong)" }}>
              {isVideo ? "A short video" : "An image"}
            </div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                ...(expanded
                  ? { whiteSpace: "pre-wrap", wordBreak: "break-word" }
                  : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
              }}
            >
              {desc}
            </div>
            {/* Expand/collapse + copy row — only when there's a real prompt */}
            {p.structuredPrompt && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-faint)",
                    textDecoration: "underline",
                  }}
                >
                  {expanded ? "show less" : "show more"}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: "var(--text-xs)",
                    color: copyState === "copied" ? "var(--success-700)" : "var(--text-faint)",
                  }}
                >
                  {copyState === "copied"
                    ? "Copied"
                    : copyState === "no-api"
                    ? "Long-press to copy"
                    : "Copy"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-xl)", color: "var(--text-strong)" }}>
            About {creditsLabel(credits)}
          </div>
        </div>

        {cardState === "failed" ? (
          <div style={{ marginTop: "var(--space-4)" }}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-strong)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"] }}>
              😕 This one didn&rsquo;t come through — and you weren&rsquo;t charged.
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
              <Button variant="secondary" size="md" disabled={busy} onClick={handleChangeSomething}>
                Change something
              </Button>
            </div>
          </div>
        ) : cardState === "working" || cardState === "done" ? (
          <div style={{ marginTop: "var(--space-4)" }}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--success-700)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"] }}>
              {cardState === "done" ? "✓ Done" : `✓ On it — making this now · ${formatElapsed(elapsed)} · usually ~${usualSeconds(isVideo)}s`}
            </div>
            {/* Spend-traceability line — pure copy, no charge logic. Shows when the card
                has moved past idle (approved by button click or by typing "ok go ahead"). */}
            <div style={{ marginTop: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
              ✓ You approved this — it used {creditsLabel(credits)}.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
            <Button variant="primary" size="md" disabled={busy} onClick={approve}>
              {busy ? "Starting…" : `Make it · ${creditsLabel(credits)}`}
            </Button>
            <Button variant="secondary" size="md" disabled={busy} onClick={handleChangeSomething}>
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
            <ShieldCheck size={15} /> Otto only makes this after you approve. (Chatting with Otto uses a little credit.)
          </div>
        )}
      </Card>
    </div>
  );
}

export default OttoPlanCard;
