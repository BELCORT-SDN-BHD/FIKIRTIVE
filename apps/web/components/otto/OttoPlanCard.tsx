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
// The ONE contract layer: runtime parse + the ONE price-guarantee predicate. The render
// gate and approve() both read this — they cannot disagree any more (#580 复审 r2 P1-1).
import { guaranteedCredits, planCardGate, type OttoPlanCardPayload } from "./plan-card-contract";
// #774 判官 r2 P1 —— 卡上那行「引擎会被告知这些照片是谁」的措辞,与真正送出去的名字
// 共用同一个纯函数(同一把长度尺),所以卡说的不可能比做的多。走**子路径**而不是包根:
// `@fikirtive/core` 的桶文件带出 `node:crypto`(hash.ts),那会被拖进客户端包。
import { approvedEntitiesNote } from "@fikirtive/core/reference-budget";

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

/** Fallback disclosure for a card that is flagged downgraded but predates the
 *  server-built note — silence is the one thing this state may never be. */
export const DOWNGRADE_FALLBACK_NOTE =
  "Some of what you asked for isn't available here — the details above are what you'll get.";

/** Shown instead of a plan when the durable payload can't be read as one, or carries no
 *  price we can vouch for. Never a blank card and never a guessed price: a plan with no
 *  guaranteed price is not approvable. */
export const UNREADABLE_PLAN_NOTE =
  "I can't read this plan any more — ask me to put it together again and I'll make a fresh one.";

/** Shown when SOME fields of an otherwise readable plan were malformed. The card is
 *  incomplete, so it is disclosed AND withheld from approval — a card that admits it
 *  didn't read itself fully must not be the one the merchant pays on (r2 P1-2). */
export const PARTIAL_PLAN_NOTE =
  "Some details of this plan didn't come through, so I won't run it as it stands — ask me to put it together again and I'll make a fresh one.";

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
  // ONE gate for this card: runtime parse at the DTO boundary (no `as` cast) plus the
  // ONE price-guarantee predicate. Everything below — what renders, and whether approve()
  // may spend — reads this same object, so the display and the spend can't disagree
  // (#580 复审 r1 P1-1 / r2 P1-1).
  const gate = planCardGate(payload);
  const p: OttoPlanCardPayload = gate.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "no-api">("idle");
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

  const isVideo = p.kind === "video";
  // The one number the merchant decides on — the real charge in CREDITS (= what startGen
  // reserves). There is no USD→credits fallback any more: the record-only fal cost divided
  // by $0.10 was never a quote, and guessing one is how an unpriced card got an approve
  // button (#580 复审 r2 P1-1). Guaranteed or absent, nothing in between.
  const credits = gate.credits;
  // The follow-on video estimate rides the SAME predicate — an estimate we can't vouch
  // for is not shown as a number, so the two-step total is never half-guessed.
  const videoCredits = guaranteedCredits({ estimatedCredits: p.videoStep?.estimatedCredits });
  const isTwoStep = !isVideo && videoCredits !== null;
  const desc = p.structuredPrompt || (isVideo ? "A short video" : isTwoStep ? "Starting picture for your video" : "An image");
  // The spec the merchant reads, built server-side from what execution really honours.
  // The card renders it VERBATIM — it derives no spec of its own any more, because two
  // derivations of one fact is exactly how the card came to promise things the
  // generator never received (#580 复审 r1 P1-2).
  const specChips = p.specChips ?? [];
  const referenceNamesNote = approvedEntitiesNote(p.approvedEntities ?? []);
  // The card's honest run state. `working` maps to "queued": the card knows a job was
  // created, not that it started — so it must not say "making this now" (P1-3).
  const runState = runStateOfCard(cardState);

  // Two ways this card can know it was stopped, and it needs both (#602 T3). The local flag is
  // this press, right now, before any durable message exists; `runState` is the DURABLE answer,
  // which is what a reload — or another tab — has to go on. Only the local one existed before, so
  // the cancelled face survived exactly until the page was refreshed, and then the same card came
  // back red with a "Try again" button on it.
  const [locallyCancelled, setLocallyCancelled] = useState(false);
  const cancelled = locallyCancelled || runState === "cancelled";

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
      setLocallyCancelled(true);
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

  /** The merchant's approval, in ONE press (#896). The button carries the price, so the
   *  press IS the approval — there is no second "are you sure" screen showing the same
   *  number a second time. Everything money-shaped below is untouched: same approval
   *  chain, same idempotency, same server actions, same fail-closed gate. */
  async function approve() {
    // Fail closed on the SAME gate the render used: a plan we couldn't read, couldn't
    // price, or couldn't read in full renders no approve button — and may not start a
    // spend either, whatever path got here.
    if (busy || cardState !== "idle" || !gate.approvable) return;
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
    onChangeSomething(p.structuredPrompt ?? "");
  }

  // A payload we can't read (or can't price) is disclosed as such. It never renders as a
  // plan with a guessed price and an approve button next to it.
  // `credits === null` is redundant with `!gate.readable` at run time — it is spelled out
  // so the compiler narrows `credits` to a number for the whole render below, instead of
  // being talked past with a `!`.
  if (!gate.readable || credits === null) {
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
                <Button
                  type="button"
                  variant="link"
                  onClick={() => setExpanded((v) => !v)}
                  className="h-auto w-auto p-0 text-[0.75rem] text-muted-foreground/70 underline"
                >
                  {expanded ? "show less" : "show more"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  onClick={handleCopy}
                  className={`h-auto w-auto p-0 text-[0.75rem] underline ${
                    copyState === "copied" ? "text-[var(--success-soft-foreground)]" : "text-muted-foreground/70"
                  }`}
                >
                  {copyState === "copied"
                    ? "Copied"
                    : copyState === "no-api"
                    ? "Long-press to copy"
                    : "Copy"}
                </Button>
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

        {/* #774 —— 引擎认人用的那几个名字,商家在花钱之前就看得见。卡上写的这几个字
            就是付费提示词里那几个字:名字冻结在这张卡上,批准之后谁也改不动它,worker
            只认这一份(改名不会偷偷换掉已经批准的指令)。老卡没有这份快照 → 不显示这行,
            而不是猜一个。 */}
        {referenceNamesNote && (
          <div className="mt-[9px] text-[0.75rem] text-muted-foreground">
            {referenceNamesNote}
          </div>
        )}

        {/* A payload that carried malformed fields is disclosed, not quietly patched —
            and, since r2 P1-2, not approvable either (see the button block below). */}
        {gate.malformedFields.length > 0 && (
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
          {isTwoStep && videoCredits !== null ? (
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

        {/* Cancelled is asked FIRST (#602 T3). The two states arrive on the same durable message,
            so whichever is tested first wins — and a merchant's own decision must never be dressed
            up as a failure with a "Try again" button attached to it. */}
        {cancelled ? (
          <div className="mt-4 text-[0.875rem] text-muted-foreground">
            Cancelled — you weren&rsquo;t charged.
          </div>
        ) : runState === "failed" ? (
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
        ) : !gate.approvable ? (
          // r2 P1-2: the card read itself only partially. It still shows what it managed
          // to read (above) and says so (PARTIAL_PLAN_NOTE), but the path to spending on
          // it does not exist — no confirm step, no approve button, and approve() refuses.
          <div className="mt-4 flex gap-3">
            <Button variant="secondary" size="sm" className="rounded-[11px]" onClick={handleChangeSomething}>
              Ask again
            </Button>
          </div>
        ) : (
          // ONE press (#896, Founder 2026-08-13). The price is on the button, so pressing it
          // IS the approval — the old "Review cost" step showed this same number again and
          // charged nothing, which is a click that buys the merchant nothing.
          <div className="mt-4 flex gap-3">
            <Button variant="default" size="sm" className="rounded-[11px]" disabled={busy} onClick={approve}>
              {busy ? "Starting…" : `Generate · ${creditsLabel(credits)}`}
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
