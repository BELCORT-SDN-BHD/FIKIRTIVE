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
import { Button } from "@/components/ui/button";
import { ottoApprove, ottoReject } from "@/lib/otto-client-actions";
import { asApprovalCardPayload, approvalCardView } from "@/lib/approval-card-view";

export interface OttoApprovalCardProps {
  cardId: string;
  threadId: string;
  payload: unknown;
  /** Called after a confirm/decline resolves so the host refetches the thread (Otto's reply). */
  onResolved?: () => void | Promise<void>;
}

type LocalState = "idle" | "approving" | "declining" | "approved" | "rejected" | "expired";

export function OttoApprovalCard({ cardId, threadId, payload, onResolved }: OttoApprovalCardProps) {
  const parsed = asApprovalCardPayload(payload);
  const [local, setLocal] = useState<LocalState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!parsed) return null;
  const view = approvalCardView(parsed);

  // Durable payload status wins on reload; local state gives instant feedback in-session.
  const resolved =
    local === "approved" || local === "rejected" || local === "expired"
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
      if ("alreadyResolved" in res) {
        setLocal(res.resolution);
      } else {
        setLocal("approved");
      }
      await onResolved?.();
    } catch {
      setErrorMsg("Couldn't submit — please try again.");
      setLocal("idle");
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
      if ("alreadyResolved" in res) {
        setLocal(res.resolution);
      } else {
        setLocal("rejected");
      }
      await onResolved?.();
    } catch {
      setErrorMsg("Couldn't submit — please try again.");
      setLocal("idle");
    }
  }

  return (
    <div className="gb leading-[1.5]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
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
            <span>Approved — it will publish as scheduled.</span>
          </div>
        ) : resolved === "rejected" ? (
          <div className="text-[0.875rem] text-muted-foreground">
            Declined — nothing was published.
          </div>
        ) : resolved === "expired" ? (
          <div className="text-[0.875rem] text-muted-foreground">
            This request expired — ask Otto to request approval again.
          </div>
        ) : (
          <div className="flex gap-3">
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
          <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {errorMsg}
          </div>
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
