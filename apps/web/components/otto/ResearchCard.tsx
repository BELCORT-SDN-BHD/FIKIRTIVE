"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseResearchCardPayload, RESEARCH_TIER_LABELS, type ResearchStatusView } from "@/lib/research-card";
import { approveResearch, getResearchCard } from "@/lib/research-actions";
import { creditsLabel } from "@/lib/credit-format";
import { canAffordPack } from "./pack-credit-math";

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
 *  planned:「Approve & run」确认后调 approveResearch(客户端唯一花钱触发点 —— approve 本身 $0,
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
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState(false);
  const [polling, setPolling] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const estimate = view.estimatedCredits; // DISPLAYED credits (derived from the worker's reserve)
  const affordable = canAffordPack(estimate, balanceUsd ?? 0);

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
        return false;
      }
      if (next === "failed") return false;
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

  // Reload-mid-research recovery: if we mount already "running", start polling (never spends).
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (status === "running") { pollTriesRef.current = 0; setPolling(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- The ONLY spend trigger in this component (approve itself is $0 server-side) -----
  async function confirmApprove() {
    if (approving) return;
    setApproving(true);
    setError(null);
    setInsufficient(false);
    try {
      const res = await approveResearch({ cardId });
      if ("error" in res) {
        if (res.code === "insufficient_credits") setInsufficient(true);
        else setError(res.error);
        setConfirming(false);
        return;
      }
      // jobId returned → the worker will start spending. Flip to running + poll.
      localAdvancedRef.current = true;
      setStatus("running");
      setConfirming(false);
      pollTriesRef.current = 0;
      setPolling(true);
    } catch {
      setError("Couldn't start research — please try again.");
      setConfirming(false);
    } finally {
      setApproving(false);
      onBalanceRefresh?.();
    }
  }

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Search size={20} className="text-foreground" />
          <span className="font-bold text-[0.8125rem] text-foreground">
            {view.topic || "Research"}
          </span>
          {/* tier badge */}
          <span className="ml-auto text-[0.75rem] font-semibold px-[7px] py-[2px] rounded-full bg-card text-muted-foreground">
            {tierLabel}
          </span>
        </div>

        {/* Goal */}
        {view.goal && (
          <div className="text-[0.875rem] text-muted-foreground mb-4">{view.goal}</div>
        )}

        {/* Sub-questions */}
        {view.questions.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {view.questions.map((q, i) => (
              <div
                key={i}
                className="bg-card rounded-[14px] text-[0.8125rem] text-foreground"
                style={{ padding: "10px 12px" }}
              >
                {q}
              </div>
            ))}
          </div>
        )}

        {/* Estimated credits */}
        <div className="pt-3 border-t border-border mb-4">
          <span className="text-[0.75rem] text-muted-foreground">
            Estimated {creditsLabel(estimate)}
          </span>
        </div>

        {/* Status area */}
        {status === "planned" ? (
          <div className="flex flex-col gap-2">
            {insufficient && (
              <div role="alert" className="text-[0.875rem] text-[var(--error-soft-foreground)]">
                Not enough credits — top up to run this research.
              </div>
            )}
            {confirming ? (
              <>
                <div className="text-[0.875rem] text-foreground">
                  Run research for ~{creditsLabel(estimate)}? This will spend real credits.
                </div>
                <div className="flex gap-3">
                  <Button variant="default" disabled={approving || !affordable} onClick={() => void confirmApprove()}>
                    {approving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : `Confirm — run research (~${creditsLabel(estimate)})`}
                  </Button>
                  <Button variant="secondary" disabled={approving} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="default"
                disabled={!affordable}
                onClick={() => { setInsufficient(false); setError(null); setConfirming(true); }}
              >
                Approve &amp; run — ~{creditsLabel(estimate)}
              </Button>
            )}
            {!affordable && !confirming && (
              <span className="text-[0.75rem] text-[var(--error-soft-foreground)]">
                Not enough credits — top up to run this research.
              </span>
            )}
          </div>
        ) : status === "running" ? (
          <div className="flex items-center gap-2 text-[0.875rem] text-muted-foreground">
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Researching… this can take a few minutes.
          </div>
        ) : status === "failed" ? (
          <div className="flex flex-col gap-1">
            <div role="alert" className="text-[0.875rem] text-[var(--error-soft-foreground)]">
              Research didn&apos;t finish.
            </div>
            <span className="text-[0.75rem] text-muted-foreground">
              Ask Otto to research this again — it&apos;ll propose a fresh plan.
            </span>
          </div>
        ) : (
          <div className="text-[0.875rem] text-[var(--success)]">Report ready below</div>
        )}

        {error && (
          <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">{error}</div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default ResearchCard;
