"use client";
import React, { useState, useEffect } from "react";
import { formatElapsed, usualSeconds } from "@/lib/progress-format";
import { ClipboardList, Film, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate, coworkVaryCard, cancelGenJob } from "@/lib/cowork-actions";
import { creditsLabel } from "@/lib/credit-format";
import type { EntityDTO } from "@/lib/types";
import type { CardState } from "@/lib/otto-inject-helpers";

export interface OttoPlanCardProps {
  cardId: string;
  payload: unknown;
  entities: EntityDTO[];
  threadId: string;
  projectId: string;
  /** The generation job id — present once the card is approved and a job is queued. */
  genJobId?: string | null;
  cardState: CardState;
  pendingApproval: boolean;
  onApproved: () => void;
  /** Called when the user clicks "Change something". Receives the current
   *  structuredPrompt as a seed so the caller can prefill the composer. */
  onChangeSomething: (seed: string) => void;
  /** Called after a fresh-card retry spawns a new card (failed state only). */
  onRetry?: () => void;
  /** Called after a successful cancel + refund so the parent can refresh. */
  onCancelled?: () => void;
}

type CardPayload = {
  kind?: string;
  structuredPrompt?: string;
  estimatedPriceUsd?: number;
  /** The real charge in credits (= what startGen reserves). Shown on the card. */
  estimatedCredits?: number;
  /** Present only when this image card is step 1 of a two-step video plan. Display only. */
  videoStep?: { estimatedCredits?: number };
  entityIds?: string[];
  variantSel?: Record<string, string>;
};

/** The plan card — Otto's "Here's what I'll make" with the one total and the approve gate.
 *  Approve resumes the parked generate via ottoApprove (the metered spend path). */
export function OttoPlanCard({
  cardId,
  payload,
  threadId,
  genJobId,
  cardState,
  pendingApproval,
  onApproved,
  onChangeSomething,
  onRetry,
  onCancelled,
}: OttoPlanCardProps) {
  const p = (payload ?? {}) as CardPayload;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "no-api">("idle");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (cardState !== "working") { setElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [cardState]);

  useEffect(() => {
    if (cardState !== "idle") setConfirming(false);
  }, [cardState]);

  const isVideo = p.kind === "video";
  const isTwoStep = !isVideo && typeof p.videoStep?.estimatedCredits === "number";
  // Show the real charge in CREDITS (= what startGen reserves). New cards carry
  // estimatedCredits; for older cards fall back to the displayed-credit equivalent
  // of the (record-only) USD estimate so nothing renders "$0.00".
  const credits =
    typeof p.estimatedCredits === "number"
      ? p.estimatedCredits
      : Math.max(1, Math.ceil((typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : 0) / 0.1));
  const videoCredits = isTwoStep ? (p.videoStep!.estimatedCredits as number) : 0;
  const desc = p.structuredPrompt || (isVideo ? "A short video" : isTwoStep ? "Starting picture for your video" : "An image");

  const [cancelled, setCancelled] = useState(false);

  async function cancel() {
    if (!genJobId || busy || cancelled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cancelGenJob({ jobId: genJobId });
      if (!res || "error" in res) { setError("error" in res ? res.error : "Couldn't cancel."); return; }
      if ("alreadyStarted" in res) {
        setError("It already started — can't cancel at this point.");
        return;
      }
      setCancelled(true);
      onCancelled?.();
    } catch {
      setError("Couldn't cancel — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await coworkVaryCard({ cardId });
      if (res && "error" in res) { setError(res.error); return; }
      onRetry?.();
    } catch {
      setError("Couldn't queue a retry — please try again.");
    } finally {
      setBusy(false);
    }
  }

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
      setConfirming(false);
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
    setConfirming(false);
    onChangeSomething(p.structuredPrompt ?? "");
  }

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ maxWidth: 480 }}>
      {/* Card variant="tint": bg-accent (--brand-tint=#F4F4F3), border, rounded-[18px], p-6 */}
      <div className="rounded-[14px] border border-border bg-secondary p-[13px]">
        <div className="mb-[9px] flex items-center gap-[7px]">
          <ClipboardList size={15} className="text-foreground" />
          <span className="text-[0.8125rem] font-bold text-foreground">
            Here&rsquo;s what I&rsquo;ll make
          </span>
        </div>

        <div className="flex items-start gap-[9px] rounded-[14px] bg-card px-[14px] py-3">
          {/* Icon avatar: --brand-soft in .fk.gb-skin = #ECECEA (neutral) → bg-accent; --on-brand-soft = ink → text-foreground */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent text-foreground">
            {isVideo ? <Film size={15} /> : <ImageIcon size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.8125rem] font-bold text-foreground">
              {isVideo ? "A short video" : isTwoStep ? "Starting picture for your video" : "An image"}
            </div>
            <div
              className={`text-[0.75rem] text-muted-foreground${
                expanded ? " whitespace-pre-wrap break-words" : " overflow-hidden text-ellipsis whitespace-nowrap"
              }`}
            >
              {desc}
            </div>
            {/* Expand/collapse + copy row — only when there's a real prompt */}
            {p.structuredPrompt && (
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="cursor-pointer border-none bg-transparent p-0 text-[0.75rem] text-muted-foreground/70 underline"
                >
                  {expanded ? "show less" : "show more"}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`cursor-pointer border-none bg-transparent p-0 text-[0.75rem] underline ${
                    copyState === "copied" ? "text-[var(--success-soft-foreground)]" : "text-muted-foreground/70"
                  }`}
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

        <div className="mt-4 border-t border-border pt-4">
          {isTwoStep ? (
            <div>
              <div className="mb-1 text-[0.75rem] text-muted-foreground">
                Two-step plan
              </div>
              <div className="font-mono text-[11.5px] text-muted-foreground">
                Step 1 of 2 &mdash; ~{creditsLabel(credits)} now
              </div>
              <div className="mt-1 text-[0.875rem] text-muted-foreground">
                Then the video &mdash; ~{creditsLabel(videoCredits)}
              </div>
            </div>
          ) : (
            <div className="font-mono text-[11.5px] text-muted-foreground">
              About {creditsLabel(credits)}
            </div>
          )}
        </div>

        {cardState === "failed" ? (
          <div className="mt-4">
            <div className="text-[0.875rem] font-semibold text-foreground">
              😕 This one didn&rsquo;t come through — and you weren&rsquo;t charged.
            </div>
            <div className="mt-3 flex gap-3">
              <Button variant="default" size="sm" className="rounded-[11px]" disabled={busy} onClick={retry}>
                {busy ? "Queuing…" : "Try again"}
              </Button>
              <Button variant="secondary" size="sm" className="rounded-[11px]" disabled={busy} onClick={handleChangeSomething}>
                Change something
              </Button>
            </div>
          </div>
        ) : cancelled ? (
          <div className="mt-4 text-[0.875rem] text-muted-foreground">
            Cancelled — you weren&rsquo;t charged.
          </div>
        ) : cardState === "done" ? (
          <div className="mt-4">
            <div className="text-[0.875rem] font-semibold text-[var(--success-soft-foreground)]">
              ✓ Done
            </div>
            {/* Spend-traceability line — pure copy, no charge logic. */}
            <div className="mt-2 text-[0.75rem] text-muted-foreground/70">
              ✓ You approved this — it used {creditsLabel(credits)}.
            </div>
          </div>
        ) : cardState === "working" ? (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <span className="text-[0.875rem] font-semibold text-[var(--success-soft-foreground)]">
                ✓ On it — making this now · {formatElapsed(elapsed)} · usually ~{usualSeconds(isVideo)}s
              </span>
              {genJobId && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={cancel}>
                  {busy ? "Cancelling…" : "Cancel"}
                </Button>
              )}
            </div>
            {/* Spend-traceability line — pure copy, no charge logic. */}
            <div className="mt-2 text-[0.75rem] text-muted-foreground/70">
              ✓ You approved this — it used {creditsLabel(credits)}.
            </div>
          </div>
        ) : confirming ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="text-[0.875rem] text-foreground">
              Generate this {isVideo ? "video" : "image"} for {creditsLabel(credits)}? This will spend real credits.
            </div>
            <div className="flex gap-3">
              <Button variant="default" size="sm" className="rounded-[11px]" disabled={busy} onClick={approve}>
                {busy ? "Starting…" : `Confirm generate · ${creditsLabel(credits)}`}
              </Button>
              <Button variant="secondary" size="sm" className="rounded-[11px]" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-3">
            <Button variant="default" size="sm" className="rounded-[11px]" disabled={busy} onClick={() => setConfirming(true)}>
              Review cost · {creditsLabel(credits)}
            </Button>
            <Button variant="secondary" size="sm" className="rounded-[11px]" disabled={busy} onClick={handleChangeSomething}>
              Change something
            </Button>
          </div>
        )}

        {error ? (
          <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {error}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-[6px] text-[0.75rem] text-muted-foreground/70">
            <ShieldCheck size={15} /> Otto only makes this after you approve. (Chatting with Otto uses a little credit.)
          </div>
        )}
      </div>
    </div>
  );
}

export default OttoPlanCard;
