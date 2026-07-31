"use client";
import React, { useState, useEffect } from "react";
import { formatElapsed, usualSeconds } from "@/lib/progress-format";
import { ClipboardList, Film, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate, coworkVaryCard, cancelGenJob } from "@/lib/cowork-actions";
import { CHAT_SPEND_NOTE, creditsLabel } from "@/lib/credit-format";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { chainedApprovalOf, type ChainedApproval } from "./approval-chain";
import { notifyPlanApproved } from "./OttoTrace";
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
  /** Called after a successful approve. When the ottoApprove resume parked AGAIN
   *  (chained needs_approval), the chained outcome rides along so the parent can
   *  mark the new card ids pendingApproval and render them (#498 round-4). */
  onApproved: (chained?: ChainedApproval) => void;
  /** Called when the user clicks "Change something". Receives the current
   *  structuredPrompt as a seed so the caller can prefill the composer. */
  onChangeSomething: (seed: string) => void;
  /** Called after a fresh-card retry spawns a new card (failed state only). */
  onRetry?: () => void;
  /** Called after a successful cancel + refund so the parent can refresh. */
  onCancelled?: () => void;
}

/** The GEN_CARD payload as the card reads it. Mirrors the SERVER contract
 *  (`CardPayload` in @fikirtive/otto) field for field — every field optional here
 *  because a durable card written before a field existed must still render.
 *  otto-plan-card-detail.test.ts is the machine gate that keeps the two in step
 *  (#580: the card used to declare 7 of the server's fields and silently drop
 *  every spec the merchant was paying for). */
export type OttoPlanCardPayload = {
  kind?: string;
  /** Routing / re-quoting id only. NEVER rendered — the engine stays confidential. */
  model?: string;
  params?: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    audio?: boolean;
    count?: number;
  };
  /** Server-side audit note. Carries the engine name, so it is NEVER rendered —
   *  `specSummary` is the sanitized line meant for the card. */
  reason?: string;
  /** Engine-free spec summary built server-side. Safe to render. */
  specSummary?: string;
  /** True when the plan could not honour part of what the merchant asked for. */
  downgraded?: boolean;
  /** The explicit "you asked for X — this will be Y" line for a downgraded plan. */
  downgradeNote?: string;
  structuredPrompt?: string;
  entityIds?: string[];
  variantSel?: Record<string, string>;
  estimatedPriceUsd?: number;
  /** The real charge in credits (= what startGen reserves). Shown on the card. */
  estimatedCredits?: number;
  /** Present only when this image card is step 1 of a two-step video plan. Display only. */
  videoStep?: { estimatedCredits?: number };
  sourceGenerationId?: string;
  /** What this creative is for (the propose information gate). */
  goal?: string;
  referenceVideoGenerationId?: string;
};

/** Fallback disclosure for a card that is flagged downgraded but predates the
 *  server-built note — silence is the one thing this state may never be. */
export const DOWNGRADE_FALLBACK_NOTE =
  "Some of what you asked for isn't available here — the details above are what you'll get.";

/** The card's spec chips, in the order the merchant reads them:
 *  length / shape / how many / sound / quality. Only fields that apply to the
 *  kind AND that the server actually sent are shown, and nothing here can carry
 *  the engine name (it is read off `params`, never off `model`/`reason`). */
export function specChipsOf(p: OttoPlanCardPayload): string[] {
  const params = p.params;
  if (!params) return [];
  const isVideo = p.kind === "video";
  const chips: string[] = [];
  if (isVideo && typeof params.durationSeconds === "number") chips.push(`${params.durationSeconds}s`);
  if (params.aspectRatio) chips.push(params.aspectRatio);
  if (typeof params.count === "number" && params.count > 1) chips.push(`${params.count} images`);
  if (isVideo && typeof params.audio === "boolean") chips.push(params.audio ? "With sound" : "No sound");
  if (isVideo && params.resolution) chips.push(params.resolution);
  return chips;
}

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
  const p = (payload ?? {}) as OttoPlanCardPayload;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "no-api">("idle");
  const [confirming, setConfirming] = useState(false);
  /** #498: set when THIS approve's resume parked again on more approvals (chained
   *  needs_approval) — the story didn't end with this card, and hiding that is the
   *  same silent death one click deeper. Holds the SERVER's localized receipt
   *  (fallbackReply) verbatim; null when no chained pause was observed OR the model
   *  narrated its own text (round-5: the parent injects that narration into the
   *  chat live via its narrationMessageId — see pollAndInjectResults). */
  const [chainedReceipt, setChainedReceipt] = useState<string | null>(null);

  useEffect(() => {
    if (cardState !== "working") {
      queueMicrotask(() => setElapsed(0));
      return;
    }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [cardState]);

  useEffect(() => {
    if (cardState !== "idle") queueMicrotask(() => setConfirming(false));
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
  const specChips = specChipsOf(p);

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
      // In a finally on purpose (#550): a successful cancel REFUNDS the hold, and an
      // "already started" or transport failure leaves the outcome unknown — either way the
      // displayed balance can no longer be trusted.
      notifyBalanceRefresh();
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
      // coworkVaryCard queues a NEW paid generation; a transport failure cannot prove it
      // didn't reserve, so announce on every exit (#550).
      notifyBalanceRefresh();
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
      // #591: the click landed, so the parked step-trace above must stop telling the
      // merchant that nothing is running and to confirm on the card. Display only —
      // no spend, no run state.
      notifyPlanApproved();
      // #498 P1b (round-4): an ottoApprove resume can park AGAIN on further
      // approval(s). Surface the server's localized receipt here, and hand the
      // chained card ids UP via onApproved so the parent marks them
      // pendingApproval and renders them — their clicks must resume the RunState
      // (ottoApprove), never coworkGenerate. (This card's own generation DID
      // start; onApproved stays correct either way.)
      const chained = chainedApprovalOf(res);
      if (chained) setChainedReceipt(chained.fallbackReply);
      onApproved(chained ?? undefined);
    } catch {
      setError("Couldn't start that — please try again.");
    } finally {
      setBusy(false);
      // The charge moment: both branches reserve credits (ottoApprove resumes a parked paid
      // generation, coworkGenerate dispatches a fresh one). Announced in a finally because a
      // failed response never proves zero spend (#550).
      notifyBalanceRefresh();
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

        {/* #580 — the full spec, in the merchant's words. Read off params only, so the
            engine name can never ride along; `specSummary` is the server's sanitized
            fallback for cards whose params predate this row. */}
        {specChips.length > 0 ? (
          <div className="mt-[9px] flex flex-wrap gap-[6px]">
            {specChips.map((chip) => (
              <span
                key={chip}
                className="rounded-[7px] border border-border bg-card px-[7px] py-[2px] font-mono text-[11px] text-muted-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : p.specSummary ? (
          <div className="mt-[9px] font-mono text-[11px] text-muted-foreground">{p.specSummary}</div>
        ) : null}

        {/* #580 — a downgrade is never silent. If the plan couldn't honour what was
            asked for, the card says so before the merchant spends. */}
        {p.downgraded && (
          <div className="mt-[9px] text-[0.75rem] text-[var(--warning-soft-foreground)]">
            {p.downgradeNote || DOWNGRADE_FALLBACK_NOTE}
          </div>
        )}

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

        {/* #498 (round-4): chained needs_approval after THIS approve — the honest
            "not done yet" state, shown as the SERVER's localized receipt verbatim
            (no hardcoded-English copy; the same text is durable in the thread).
            The remaining parked cards keep their own approve gates (no spend
            logic here). */}
        {chainedReceipt && (
          <div className="mt-2 text-[0.75rem] text-muted-foreground">
            {chainedReceipt}
          </div>
        )}

        {error ? (
          <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {error}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-[6px] text-[0.75rem] text-muted-foreground/70">
            <ShieldCheck size={15} /> Otto only makes this after you approve. {CHAT_SPEND_NOTE}
          </div>
        )}
      </div>
    </div>
  );
}

export default OttoPlanCard;
