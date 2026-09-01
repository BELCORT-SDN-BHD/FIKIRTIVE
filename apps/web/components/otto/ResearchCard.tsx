"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { parseResearchCardPayload, RESEARCH_TIER_LABELS, type ResearchStatusView } from "@/lib/research-card";
import { approveResearch, getResearchCard } from "@/lib/research-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { creditsLabel } from "@/lib/credit-format";
import { TopUpNotice } from "@/components/exits/Exits";
import { canAffordPack } from "./pack-credit-math";
import { SpendConfirmation, SpendProgress } from "./spend-state";

export interface ResearchCardProps {
  /** The durable RESEARCH_CARD message id — the cardId approveResearch/getResearchCard scope off. */
  cardId: string;
  payload: unknown;
  /** Org spendable balance in USD (for the client-side afford gate — same seam as StoryboardCard).
   *  A missing value reads as 0 and defers to the SERVER pre-check + worker withLlmBudget guards. */
  balanceUsd?: number;
  /** Nudge the nav balance to refetch after an approve (the worker will start spending). */
  onBalanceRefresh?: () => void;
  /** Refetch the durable thread so the RESEARCH_REPORT row appears once research finishes (S4). */
  onRefresh?: () => void | Promise<void>;
}

// Research runs minutes-long (deep = 24 steps of search→read→synthesize). Poll on the slow
// cadence StoryboardCard uses for videos: 3s ticks, cap ~40 (≈2 min) before giving up quietly.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40;

/** Otto 的深度研究计划卡(RESEARCH_CARD)。样式镜像审批卡外观。
 *  planned:一颗带价按钮,按下即调 approveResearch(客户端唯一花钱触发点 —— approve 本身 $0,
 *  真扣在 worker 的 withLlmBudget)→ 本地转 running + 轮询卡 status。
 *  running:每 3s 读 getResearchCard($0 只读)看 status;done → 「Report ready below」(REPORT 另渲,S4)+
 *  onRefresh 让报告行冒出来;failed → 失败提示 +「重试 = 让 Otto 再出一张新卡」(不复用旧卡,refId 已 settle)。 */
export function ResearchCard({ cardId, payload, balanceUsd, onBalanceRefresh, onRefresh }: ResearchCardProps) {
  const view = parseResearchCardPayload(payload);
  const tierLabel = RESEARCH_TIER_LABELS[view.tier];

  // Local status overlay: approve flips this to "running" instantly; the poll then advances it to
  // done/failed off the server. Seeded from the payload and RE-SEEDED when the parent re-injects a
  // fresh payload (thread refetch), so history renders authoritative.
  const [status, setStatus] = useState<ResearchStatusView>(view.status);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState(false);
  const [polling, setPolling] = useState(view.status === "running");
  const pollTriesRef = useRef(0);

  // Re-seed local status when the parent injects a fresh payload (identity change), UNLESS we're
  // mid-approve/polling locally (our optimistic "running" is newer than a stale re-render).
  const prevPayloadRef = useRef(payload);
  const localAdvancedRef = useRef(false);
  useEffect(() => {
    if (prevPayloadRef.current === payload) return;
    prevPayloadRef.current = payload;
    if (localAdvancedRef.current) return;
    setStatus(parseResearchCardPayload(payload).status);
  }, [payload]);

  // DISPLAYED credits (derived from the worker's reserve), or null when this durable card
  // carries no quote we can vouch for. #896 r2 P0-b: a missing/malformed estimate used to read
  // as 0, which then passed the afford gate and put an enabled "Run research · 0 credits" in
  // front of the merchant while the server ran the tier's real, positive budget.
  const estimate = view.estimatedCredits;
  const affordable = estimate !== null && canAffordPack(estimate, balanceUsd ?? 0);
  // ONE gate, read by both the button and the action below — a disabled button is a hint,
  // the gate is what actually refuses.
  const approveBlocked = estimate === null || !affordable;

  // --- Poll the card status ($0 read) until it leaves "running" -----------------------
  const pollOnce = useCallback(async (): Promise<boolean> => {
    // returns true while still running (keep polling), false once terminal / on error.
    try {
      const res = await getResearchCard({ cardId });
      if ("error" in res) return false;
      const next = parseResearchCardPayload(res.payload).status;
      setStatus(next);
      if (next === "done") {
        // The RESEARCH_REPORT is a separate durable message — refetch the thread so it renders.
        void onRefresh?.();
        // Approve returns a jobId BEFORE the worker spends, so the approve-time callback
        // always reports a pre-charge balance. THIS is where the money actually landed (#550).
        notifyBalanceRefresh();
        return false;
      }
      if (next === "failed") {
        // A failed research run is refunded — the merchant should see it come back.
        notifyBalanceRefresh();
        return false;
      }
      return true; // still planned/running → keep polling
    } catch {
      return false;
    }
  }, [cardId, onRefresh]);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      pollTriesRef.current += 1;
      const stillRunning = await pollOnce();
      if (cancelled) return;
      if (!stillRunning || pollTriesRef.current >= POLL_MAX_TRIES) setPolling(false);
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [polling, pollOnce]);

  // --- The ONLY spend trigger in this component (approve itself is $0 server-side) -----
  /** ONE press (#896, Founder 2026-08-13): the button carries the estimate, so pressing it
   *  is the approval. The afford gate, the server pre-check and the worker's own budget
   *  guard are all unchanged — only the second screen that re-read the same number is gone. */
  async function confirmApprove() {
    if (approving || approveBlocked) return;
    setApproving(true);
    setError(null);
    setInsufficient(false);
    try {
      const res = await approveResearch({ cardId });
      if ("error" in res) {
        if (res.code === "insufficient_credits") setInsufficient(true);
        else setError(res.error);
        return;
      }
      // jobId returned → the worker will start spending. Flip to running + poll.
      localAdvancedRef.current = true;
      setStatus("running");
      pollTriesRef.current = 0;
      setPolling(true);
    } catch {
      setError("Couldn't start research — please try again.");
    } finally {
      setApproving(false);
      onBalanceRefresh?.();
    }
  }

  return (
    <Card size="sm" className="gb w-full max-w-[480px] leading-[1.5]">
      <CardHeader className="flex-row items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Search size={18} aria-hidden="true" />
            <span className="truncate">{view.topic || "Research"}</span>
          </CardTitle>
          {view.goal && <CardDescription>{view.goal}</CardDescription>}
        </div>
        <Badge variant="outline">{tierLabel}</Badge>
      </CardHeader>

      {view.questions.length > 0 && (
        <CardContent>
          <ol className="flex flex-col gap-2">
            {view.questions.map((question, index) => (
              <li key={index} className="flex items-start gap-3 rounded-lg bg-muted p-3 text-sm text-foreground">
                <Badge variant="default">Q{index + 1}</Badge>
                <span>{question}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      )}

      <CardFooter className="flex-col items-stretch">
        {status === "planned" ? (
          <div className="flex flex-col gap-2">
            {/* #707 — one notice for one fact, whether the shortfall was visible up front
                (`!affordable`) or the server refused at confirm time (`insufficient`). It
                used to be written out twice, both times as text with nowhere to click.
                The two states never overlap: approving clears `insufficient` first, and a
                merchant who cannot afford it never reaches the button. */}
            {/* An unpriced card is not a short balance — saying "top up" there would send the
                merchant to Billing for a problem money cannot fix (#896 r2 P0-b). */}
            {(insufficient || (estimate !== null && !affordable)) && (
              <TopUpNotice need="run this research" />
            )}
            <SpendConfirmation
              title={estimate === null ? "Cost unavailable" : "Research quote"}
              description={
                estimate === null
                  ? "Otto is still checking the cost. Nothing can start until the quote is ready."
                  : `${creditsLabel(estimate)}. Research starts as soon as you approve.`
              }
            >
              {/* #896: one press, with the estimate on it. No estimate ⇒ nothing to approve. */}
              <Button
                variant="default"
                size="sm"
                disabled={approving || approveBlocked}
                onClick={() => void confirmApprove()}
              >
                {approving && <Spinner data-icon="inline-start" aria-label="Starting research" />}
                {approving
                  ? "Starting research…"
                  : estimate === null
                  ? "Checking cost…"
                  : `Run research · ${creditsLabel(estimate)}`}
              </Button>
            </SpendConfirmation>
          </div>
        ) : status === "running" ? (
          <SpendProgress title="Researching" description="This can take a few minutes." />
        ) : status === "failed" ? (
          <Alert role="alert" variant="destructive" density="compact">
            <AlertTitle>Research didn&apos;t finish</AlertTitle>
            <AlertDescription>
              Ask Otto to research this again — Otto will propose a fresh plan.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="success" density="compact">
            <AlertTitle>Report ready below</AlertTitle>
            <AlertDescription>Otto&apos;s findings are in the next message.</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert role="alert" variant="destructive" density="compact">
            <AlertTitle>Research wasn&apos;t started</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardFooter>
    </Card>
  );
}

export default ResearchCard;
