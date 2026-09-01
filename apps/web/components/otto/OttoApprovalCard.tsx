"use client";
/**
 * OttoApprovalCard — the UNIVERSAL approval card for non-generate approval-gated skills
 * (B4 debt-70, spec §五 5.1·附 touchpoint ①). Shown for APPROVAL_CARD messages.
 *
 * R1 (frozen): the card renders WHAT is being consented to — channel / scheduled time /
 * caption summary via approvalCardView (pure, node-tested) — never a bare id.
 * Confirm calls ottoApprove (approve → resume → the SAME owner-scoped server action);
 * Decline calls ottoReject (STATIC decline — zero external writes, zero LLM resume; internal
 * writes = card terminal-state / confirmation message / audit row). An expired ask → "expired".
 * generate keeps its own OttoPlanCard spend path; this card never handles it.
 */
import React, { useState } from "react";
import { ShieldCheck, CheckCircle2, Loader2, CalendarCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ottoApprove, ottoReject } from "@/lib/otto-client-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import {
  asApprovalCardPayload,
  approvalCardView,
  approvalCardResolutionText,
  type ApprovalCardResolution,
} from "@/lib/approval-card-view";
import { chainedApprovalOf } from "./approval-chain";
// #996 (W2-9): 面板最窄 320px。版式跟着卡自己那只盒子走(容器查询),不跟视口走。
import { CARD_ACTIONS_CLASS, CARD_PAD_CLASS, CARD_ROOT_CLASS } from "./card-narrow";

/** What a resolved approval hands up: the EXACT card, what it resolved to, and the
 *  server's own still-pending set when the resume parked again. The universal approval
 *  path used to report nothing at all, so a thread parked on it kept a stale
 *  "waiting for your go-ahead" panel forever (#580 复审 r1 P1-4). */
export interface ApprovalResolvedOutcome {
  cardId: string;
  resolution: ApprovalCardResolution;
  /** The server's COMPLETE still-pending set when the resume parked again; null when
   *  the response carried no set information. */
  pendingCardIds: string[] | null;
}

export interface OttoApprovalCardProps {
  cardId: string;
  threadId: string;
  payload: unknown;
  /** Called after a confirm/decline resolves so the host refetches the thread (Otto's
   *  reply) and updates its pending-approval set from the outcome. */
  onResolved?: (outcome: ApprovalResolvedOutcome) => void | Promise<void>;
}

type LocalState = "idle" | "approving" | "declining" | "approved" | "rejected" | "expired" | "failed";

export function OttoApprovalCard({ cardId, threadId, payload, onResolved }: OttoApprovalCardProps) {
  const parsed = asApprovalCardPayload(payload);
  const [local, setLocal] = useState<LocalState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!parsed) return null;
  const view = approvalCardView(parsed);

  // Durable payload status wins on reload; local state gives instant feedback in-session.
  const resolved =
    local === "approved" || local === "rejected" || local === "expired" || local === "failed"
      ? local
      : parsed.status !== "pending"
        ? parsed.status
        : null;
  const busy = local === "approving" || local === "declining";

  async function confirm() {
    if (busy || resolved) return;
    setLocal("approving");
    setErrorMsg(null);
    try {
      const res = await ottoApprove({ threadId, cardId });
      if ("error" in res) {
        setErrorMsg(res.error);
        setLocal("idle");
        return;
      }
      const resolution = "alreadyResolved" in res ? res.resolution : "approved";
      setLocal(resolution);
      // Hand up the exact card and the server's own pending set — the host's waiting
      // panel is driven by that set, so it can only be dismissed by an answer.
      await onResolved?.({
        cardId,
        resolution,
        pendingCardIds: chainedApprovalOf(res)?.pendingCardIds ?? null,
      });
    } catch {
      setErrorMsg("Couldn't submit — please try again.");
      setLocal("idle");
    } finally {
      // Approving resumes a PARKED PAID generation, so this is a real charge moment —
      // and an already-resolved/errored outcome can still have spent (#550).
      notifyBalanceRefresh();
    }
  }

  async function decline() {
    if (busy || resolved) return;
    setLocal("declining");
    setErrorMsg(null);
    try {
      const res = await ottoReject({ threadId, cardId });
      if ("error" in res) {
        setErrorMsg(res.error);
        setLocal("idle");
        return;
      }
      const resolution = "alreadyResolved" in res ? res.resolution : "rejected";
      setLocal(resolution);
      // A decline never resumes the run, so it carries no server pending set — but it
      // still settles THIS card, and the host must hear which one.
      await onResolved?.({ cardId, resolution, pendingCardIds: null });
    } catch {
      setErrorMsg("Couldn't submit — please try again.");
      setLocal("idle");
    }
  }

  return (
    <div className={CARD_ROOT_CLASS} style={{ maxWidth: 480 }}>
      <div className={`rounded-[18px] border border-border bg-secondary ${CARD_PAD_CLASS}`}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <CalendarCheck size={20} className="text-foreground" />
          <span className="font-bold text-[0.8125rem] text-foreground">{view.title}</span>
        </div>

        {/* R1: the consent object — channel / time / media details */}
        {view.detailLines.length > 0 && (
          <div className="flex flex-col gap-1 mb-3">
            {view.detailLines.map((line, i) => (
              <div key={i} className="text-[0.8125rem] text-muted-foreground">{line}</div>
            ))}
          </div>
        )}

        {/* R1: the caption being published */}
        {view.captionExcerpt && (
          <div
            className="bg-card rounded-[14px] text-[0.875rem] text-foreground mb-4 whitespace-pre-wrap break-words"
            style={{ padding: "10px 12px" }}
          >
            {view.captionExcerpt}
          </div>
        )}

        {/* Controls / resolution */}
        {resolved === "approved" ? (
          <div className="flex items-center gap-2 text-[0.875rem] text-[var(--success-soft-foreground)]">
            <CheckCircle2 size={16} />
            {/* #851 — from the same authority as the card's title and outcome line. Hardcoded here,
                this sentence contradicted the detail line directly above it: one card said nothing
                is sent, and then, one line down, that the post goes out at its slot. The
                contradicting half was the one a merchant read having just acted. #524 renders the
                other three resolutions through approvalCardResolutionText, whose own "approved"
                arm now reads from this same line — one claim, whichever surface asks. */}
            <span>{view.approvedLine}</span>
          </div>
        ) : resolved === "rejected" ? (
          <div className="text-[0.875rem] text-muted-foreground">
            {approvalCardResolutionText({ ...parsed, status: "rejected" })}
          </div>
        ) : resolved === "expired" ? (
          <div className="text-[0.875rem] text-muted-foreground">
            {approvalCardResolutionText({ ...parsed, status: "expired" })}
          </div>
        ) : resolved === "failed" ? (
          // #524 r5: the consent was spent and the run then died. Saying "Approved" here would be
          // a lie about something the merchant cannot otherwise see. #524 r6: which failure
          // sentence it is depends on what the ledger PROVED (payload.chargeVerdict) — this card
          // never claims "nothing was charged" on its own guess.
          <div className="text-[0.875rem] text-[var(--error-soft-foreground)]">
            {approvalCardResolutionText({ ...parsed, status: "failed" })}
          </div>
        ) : (
          <div className={CARD_ACTIONS_CLASS}>
            <Button variant="default" disabled={busy} onClick={confirm}>
              {local === "approving" ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Approving…
                </span>
              ) : "Approve"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={decline}>
              {local === "declining" ? "Declining…" : "Decline"}
            </Button>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <Alert role="alert" variant="destructive" density="compact" className="mt-2">
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {/* Trust footer */}
        {!resolved && (
          <div className="flex items-center gap-[6px] mt-3 text-[0.75rem] text-muted-foreground/70">
            <ShieldCheck size={15} /> Nothing publishes until you approve it.
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default OttoApprovalCard;
