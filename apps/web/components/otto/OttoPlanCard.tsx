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
import { runStateOfCard } from "@/lib/otto-status-helpers";
import type { EntityDTO } from "@/lib/types";
import type { CardState } from "@/lib/otto-inject-helpers";
// The authoritative card contract, straight from the server package. Type-only, so it
// is erased at build time and drags no server code into the client bundle.
import type { CardPayload as ServerCardPayload } from "@fikirtive/otto";

/** What a successful approve hands up. Carries the EXACT card it happened on plus the
 *  SERVER's own result — the parent never has to infer either from a closure or from a
 *  module-level broadcast (#580 复审 r1 P1-4). */
export interface PlanApproveOutcome {
  /** The card the merchant actually clicked. */
  cardId: string;
  /** The resume parked again (chained needs_approval) and this is the server's COMPLETE
   *  still-pending set; null when this resume ran to completion. */
  chained: ChainedApproval | null;
}

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
  /** Called after a successful approve, with the exact card id and the server's result
   *  (#498 round-4 chained needs_approval rides along so the parent can mark the new
   *  card ids pendingApproval and render them). */
  onApproved: (outcome: PlanApproveOutcome) => void;
  /** Called when the user clicks "Change something". Receives the current
   *  structuredPrompt as a seed so the caller can prefill the composer. */
  onChangeSomething: (seed: string) => void;
  /** Called after a fresh-card retry spawns a new card (failed state only). */
  onRetry?: () => void;
  /** Called after a successful cancel + refund so the parent can refresh. */
  onCancelled?: () => void;
}

/**
 * The GEN_CARD payload as the card reads it — **derived from the server contract, not
 * re-declared beside it** (#580 复审 r1 P1-1: a hand-kept copy plus an `as` cast let a
 * drifting contract and a malformed payload both sail past tsc and the tests).
 *
 * `import type` is erased at build time, so this costs the client bundle nothing.
 * Every field is optional because a durable card written before a field existed must
 * still render — but the field NAMES and their TYPES now come from `CardPayload`
 * itself, so the two cannot drift apart.
 */
export type OttoPlanCardPayload = Partial<ServerCardPayload>;

/** Fallback disclosure for a card that is flagged downgraded but predates the
 *  server-built note — silence is the one thing this state may never be. */
export const DOWNGRADE_FALLBACK_NOTE =
  "Some of what you asked for isn't available here — the details above are what you'll get.";

/** Shown instead of a plan when the durable payload can't be read as one. Never a
 *  blank card and never a guessed price: an unreadable plan is not approvable. */
export const UNREADABLE_PLAN_NOTE =
  "I can't read this plan any more — ask me to put it together again and I'll make a fresh one.";

/** Shown when SOME fields of an otherwise readable plan were malformed. The merchant
 *  is told the card is incomplete rather than being shown a confident half-truth. */
export const PARTIAL_PLAN_NOTE =
  "Some details of this plan didn't come through — what you see below is all I can vouch for.";

/** A durable payload after runtime parsing at the DTO boundary. */
export interface ParsedPlanCardPayload {
  value: OttoPlanCardPayload;
  /** Contract fields this card carried with the WRONG type — dropped rather than
   *  rendered, and surfaced on the card. A silent drop is what #580 is about. */
  malformedFields: string[];
}

function str(v: unknown): v is string {
  return typeof v === "string";
}
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parse an unknown durable payload into the card's view of it — the runtime half of
 * the type alignment. The static type says what the server MAY send; this says what
 * this particular durable row ACTUALLY carries. Anything typed wrong is dropped into
 * `malformedFields` so the card can disclose it, never silently rendered.
 *
 * Returns null when the payload isn't an object at all — there is no plan to show.
 * Same structural-parse idiom as `asApprovalCardPayload` (no new dependency).
 */
export function parsePlanCardPayload(raw: unknown): ParsedPlanCardPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const value: OttoPlanCardPayload = {};
  const malformedFields: string[] = [];

  /** Take `key` only when the durable value passes `ok`; otherwise record it. */
  function take<K extends keyof OttoPlanCardPayload>(
    key: K,
    ok: (v: unknown) => boolean,
    read: (v: unknown) => OttoPlanCardPayload[K],
  ): void {
    const v = p[key as string];
    if (v === undefined || v === null) return;
    if (!ok(v)) {
      malformedFields.push(key as string);
      return;
    }
    value[key] = read(v);
  }

  take("kind", (v) => v === "image" || v === "video", (v) => v as "image" | "video");
  take("model", str, (v) => v as string);
  take("reason", str, (v) => v as string);
  take("structuredPrompt", str, (v) => v as string);
  take("goal", str, (v) => v as string);
  take("sourceGenerationId", str, (v) => v as string);
  take("referenceVideoGenerationId", str, (v) => v as string);
  take("downgradeNote", str, (v) => v as string);
  take("downgraded", (v) => typeof v === "boolean", (v) => v as boolean);
  take("estimatedPriceUsd", num, (v) => v as number);
  take("estimatedCredits", num, (v) => v as number);
  take("entityIds", (v) => Array.isArray(v) && v.every(str), (v) => v as string[]);
  take(
    "variantSel",
    (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(str),
    (v) => v as Record<string, string>,
  );
  // The spec line the merchant reads. Built ONCE, server-side, from what execution
  // really honours — the card renders it verbatim and derives no spec of its own.
  take("specChips", (v) => Array.isArray(v) && v.every(str), (v) => v as string[]);
  take(
    "params",
    (v) => !!v && typeof v === "object" && !Array.isArray(v),
    (v) => {
      const q = v as Record<string, unknown>;
      return {
        ...(str(q.aspectRatio) ? { aspectRatio: q.aspectRatio } : {}),
        ...(str(q.resolution) ? { resolution: q.resolution } : {}),
        ...(num(q.durationSeconds) ? { durationSeconds: q.durationSeconds } : {}),
        ...(typeof q.audio === "boolean" ? { audio: q.audio } : {}),
        count: num(q.count) ? q.count : 1,
      };
    },
  );
  take(
    "videoStep",
    (v) => !!v && typeof v === "object" && num((v as Record<string, unknown>).estimatedCredits),
    (v) => ({ estimatedCredits: (v as { estimatedCredits: number }).estimatedCredits }),
  );

  return { value, malformedFields };
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
  // Runtime parse at the DTO boundary — no `as` cast. A payload we can't read is shown
  // as unreadable, never rendered as a confident plan (#580 复审 r1 P1-1).
  const parsed = parsePlanCardPayload(payload);
  const p: OttoPlanCardPayload = parsed?.value ?? {};
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
  // The one number the merchant decides on. A card that carries NEITHER credits nor a
  // USD estimate has no price we can vouch for, so it is not approvable (below) — the
  // old code quietly rendered "1 credit" for it.
  const priceKnown = typeof p.estimatedCredits === "number" || typeof p.estimatedPriceUsd === "number";
  // Show the real charge in CREDITS (= what startGen reserves). New cards carry
  // estimatedCredits; for older cards fall back to the displayed-credit equivalent
  // of the (record-only) USD estimate so nothing renders "$0.00".
  const credits =
    typeof p.estimatedCredits === "number"
      ? p.estimatedCredits
      : Math.max(1, Math.ceil((typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : 0) / 0.1));
  const videoCredits = isTwoStep ? (p.videoStep!.estimatedCredits as number) : 0;
  const desc = p.structuredPrompt || (isVideo ? "A short video" : isTwoStep ? "Starting picture for your video" : "An image");
  // The spec the merchant reads, built server-side from what execution really honours.
  // The card renders it VERBATIM — it derives no spec of its own any more, because two
  // derivations of one fact is exactly how the card came to promise things the
  // generator never received (#580 复审 r1 P1-2).
  const specChips = p.specChips ?? [];
  // The card's honest run state. `working` maps to "queued": the card knows a job was
  // created, not that it started — so it must not say "making this now" (P1-3).
  const runState = runStateOfCard(cardState);
  /** A plan we can read AND price. Anything less is disclosed, not approved. */
  const readable = parsed !== null && priceKnown;

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
    // Fail closed on a plan we could not read or price: no button renders in that state,
    // and no spend may start from it either.
    if (busy || cardState !== "idle" || !readable) return;
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
      // #498 P1b (round-4): an ottoApprove resume can park AGAIN on further
      // approval(s). Surface the server's localized receipt here, and hand the
      // chained card ids UP via onApproved so the parent marks them
      // pendingApproval and renders them — their clicks must resume the RunState
      // (ottoApprove), never coworkGenerate. (This card's own generation DID
      // start; onApproved stays correct either way.)
      //
      // #591 / P1-4: the parked step-trace above also has to stop asking for a click
      // that already happened — but it learns that from the parent's NEW pending set
      // (derived from `chained` right here), not from a module-level broadcast that
      // hid every waiting panel on the page.
      const chained = chainedApprovalOf(res);
      if (chained) setChainedReceipt(chained.fallbackReply);
      onApproved({ cardId, chained });
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

  // A payload we can't read (or can't price) is disclosed as such. It never renders as a
  // plan with a guessed price and an approve button next to it.
  if (!readable) {
    return (
      <div className="gb leading-[1.5]" style={{ maxWidth: 480 }}>
        <div className="rounded-[14px] border border-border bg-secondary p-[13px]">
          <div className="mb-[9px] flex items-center gap-[7px]">
            <ClipboardList size={15} className="text-muted-foreground" />
            <span className="text-[0.8125rem] font-bold text-foreground">A plan I can&rsquo;t read</span>
          </div>
          <div className="text-[0.8125rem] text-muted-foreground">{UNREADABLE_PLAN_NOTE}</div>
          <div className="mt-3">
            <Button variant="secondary" size="sm" className="rounded-[11px]" onClick={handleChangeSomething}>
              Ask again
            </Button>
          </div>
        </div>
      </div>
    );
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

        {/* #580 — the full spec, in the merchant's words, exactly as the server built it
            from what execution really honours. Rendered verbatim: the card adds nothing
            and drops nothing, so it cannot promise what the generator won't receive.
            An older card with no specChips shows no spec rather than a guessed one. */}
        {specChips.length > 0 && (
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
        )}

        {/* A payload that carried malformed fields is disclosed, not quietly patched. */}
        {parsed.malformedFields.length > 0 && (
          <div className="mt-[9px] text-[0.75rem] text-[var(--warning-soft-foreground)]">
            {PARTIAL_PLAN_NOTE}
          </div>
        )}

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

        {runState === "failed" ? (
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
        ) : runState === "done" ? (
          <div className="mt-4">
            <div className="text-[0.875rem] font-semibold text-[var(--success-soft-foreground)]">
              ✓ Done
            </div>
            {/* Spend-traceability line — pure copy, no charge logic. */}
            <div className="mt-2 text-[0.75rem] text-muted-foreground/70">
              ✓ You approved this — it used {creditsLabel(credits)}.
            </div>
          </div>
        ) : runState === "queued" ? (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              {/* P1-3: the card knows a job exists, not that it started (the thread DTO
                  folds QUEUED and GENERATING into one "working"). So it says queued —
                  the one thing that is true either way — instead of "making this now". */}
              <span className="text-[0.875rem] font-semibold text-[var(--success-soft-foreground)]">
                ✓ Approved — in the queue · {formatElapsed(elapsed)} · usually ~{usualSeconds(isVideo)}s
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
