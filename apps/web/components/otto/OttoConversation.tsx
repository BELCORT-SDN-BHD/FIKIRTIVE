"use client";
import React, { useEffect, useRef, useState } from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { ottoTurn } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { OttoPlanCard } from "./OttoPlanCard";
import { OttoActionPlanCard } from "./OttoActionPlanCard";
import { OttoApprovalCard } from "./OttoApprovalCard";
import { OttoAdBuildCard } from "./OttoAdBuildCard";
import { StoryboardCard } from "./StoryboardCard";
import { ResearchCard } from "./ResearchCard";
import { ResearchReport } from "./ResearchReport";
import { PerformanceCard } from "./PerformanceCard";
import { OttoResult } from "./OttoResult";
import { OttoMarkdown } from "./parts/OttoMarkdown";
import { nextPendingApprovalCardIds } from "./approval-chain";
import { cancelledTurnPayload, deriveCardState } from "@/lib/otto-inject-helpers";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";
import type { EntityDTO, ChatThreadDTO, ChatMessageDTO } from "@/lib/types";

export interface OttoConversationProps {
  projectId: string;
  entities: EntityDTO[];
  thread: ChatThreadDTO;
  balanceUsd: number;
  onRefresh: () => Promise<void>;
  onThreadUpdate: (thread: ChatThreadDTO) => void;
  /** Re-reads the account balance and updates the nav display after a spend event. */
  onBalanceRefresh?: () => void | Promise<void>;
}

export function OttoConversation({
  projectId,
  entities,
  thread,
  balanceUsd,
  onThreadUpdate,
  onBalanceRefresh,
}: OttoConversationProps) {
  const [text, setText] = useState("");
  const [pickedMentions, setPickedMentions] = useState<{id: string; name: string}[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovalCardIds, setPendingApprovalCardIds] = useState<Set<string>>(new Set());
  const [submittedCardIds, setSubmittedCardIds] = useState<Set<string>>(new Set());
  const [cancelledJobIds, setCancelledJobIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  const messages = thread.messages;

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function refreshAndUpdate() {
    const fresh = await getCoworkThreadClient(thread.id);
    if (fresh) onThreadUpdate(fresh);
  }

  function rearmGenerationPoll() {
    setPollGaveUp(false);
    setPollTerminal(false);
    setPollRound("initial");
    setPollNonce((n) => n + 1);
  }

  const mentionSuggestions = mentionQuery !== null
    ? (entities ?? []).filter(e => e.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
    : [];

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const caret = e.target.selectionStart ?? val.length;
    setMentionQuery(activeMentionQuery(val, caret));
    setMentionHighlight(0);
  };

  const selectMention = (entity: {id: string; name: string}) => {
    const textarea = document.getElementById("otto-composer") as HTMLTextAreaElement;
    const caret = textarea?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    const newText = text.slice(0, atIdx) + `@${entity.name} ` + text.slice(caret);
    setText(newText);
    setPickedMentions(prev => prev.some(p => p.id === entity.id) ? prev : [...prev, {id: entity.id, name: entity.name}]);
    setMentionQuery(null);
    setMentionHighlight(0);
    setTimeout(() => textarea?.focus(), 0);
  };

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const entityIds = resolveSentEntityIds(trimmed, pickedMentions);
    // a new turn may queue a new generation — re-arm polling
    rearmGenerationPoll();
    try {
      const res = await ottoTurn({
        threadId: thread.id,
        projectId,
        text: trimmed,
        entityIds,
        variantSel: {},
        simple: true,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (res.status === "needs_approval") {
        // ChainedApproval.pendingCardIds contract (#498 round-7; FOURTH call
        // site, round-9): the non-streaming fallback's needs_approval carries
        // the COMPLETE set of the thread's parked calls (the contract comment
        // in approval-chain.ts, cited by otto-actions.ts too), so it REPLACES
        // the local set — an id the server no longer reports is resolved/
        // expired/superseded, and keeping it would be a stale private ledger.
        // No card fired here, hence the empty approvedCardIds.
        setPendingApprovalCardIds((cur) => nextPendingApprovalCardIds(cur, [], res.pendingCardIds));
      }
      setText("");
      setPickedMentions([]);
      await refreshAndUpdate();
      // A completed turn meters LLM credits — refresh the nav balance display.
      void onBalanceRefresh?.();
    } catch {
      setError("Couldn't reach Otto — please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionSuggestions.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionHighlight(h => Math.max(0, h - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionHighlight(h => Math.min(mentionSuggestions.length - 1, h + 1));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectMention(mentionSuggestions[mentionHighlight]);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionSuggestions[mentionHighlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        setMentionHighlight(0);
        return;
      }
    }
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Track which job ids already have a GEN_RESULT so we don't double-render
  const resultJobIds = new Set(
    messages
      .filter((m) => m.kind === "GEN_RESULT" && m.genJobId)
      .map((m) => m.genJobId as string),
  );
  // Track which job ids have a TURN_ERROR so the card can show a failed state.
  const errorJobIds = new Set(
    messages
      .filter((m) => m.kind === "TURN_ERROR" && m.genJobId)
      .map((m) => m.genJobId as string),
  );
  // …and which of those terminal messages say the MERCHANT stopped it (#602 T3). A cancel and a
  // failure share the message kind, so without this second read the card came back from a reload
  // red, apologising, with a "Try again" button on work the merchant chose to stop. Unioned with
  // the local set below so this press and a durable reload agree.
  const durablyCancelledJobIds = new Set([
    ...cancelledJobIds,
    ...messages
      .filter((m) => m.kind === "TURN_ERROR" && m.genJobId && cancelledTurnPayload(m.payload))
      .map((m) => m.genJobId as string),
  ]);

  // Map genJobId → cardId for the "Make another" path on GEN_RESULT widgets.
  const cardIdByJobId = new Map<string, string>(
    messages
      .filter((m) => m.kind === "GEN_CARD" && m.genJobId)
      .map((m) => [m.genJobId as string, m.id]),
  );

  // A job is "working" once its card is approved (genJobId set) but no terminal
  // message (GEN_RESULT or TURN_ERROR) has landed yet. While any job is working we
  // poll the thread so the async worker result appears without a manual reload.
  const terminalJobIds = new Set<string>(cancelledJobIds);
  for (const jobId of messages
    .filter((m) => (m.kind === "GEN_RESULT" || m.kind === "TURN_ERROR") && m.genJobId)
    .map((m) => m.genJobId as string)) {
    terminalJobIds.add(jobId);
  }
  const hasWorkingJob = messages.some(
    (m) => m.kind === "GEN_CARD" && m.genJobId && !terminalJobIds.has(m.genJobId),
  );

  // Bound the polling: a worker that fails-closed without writing a terminal message
  // would otherwise keep hasWorkingJob true forever (poll-forever + a stuck "making
  // this…" spinner). Video generations can legitimately take several minutes, so
  // match the canvas poll budget before showing the recoverable fallback.
  const POLL_MS = 2500;
  const MAX_POLLS = 192; // ~8 minutes
  const [pollGaveUp, setPollGaveUp] = useState(false);
  /** Set to true after "Check again" exhausts a second MAX_POLLS round — terminal message. */
  const [pollTerminal, setPollTerminal] = useState(false);
  const [pollRound, setPollRound] = useState<"initial" | "retry">("initial");
  /** Monotonic re-arm token — see OttoChatStream. Bumped on every rearm so the poll
   *  effect always re-runs and resets its local pollCount to 0, even when the other
   *  reset setters are no-ops (React would otherwise bail out and keep the stale window). */
  const [pollNonce, setPollNonce] = useState(0);

  // Reset the give-up state whenever we switch threads.
  useEffect(() => {
    setPollGaveUp(false);
    setPollTerminal(false);
    setPollRound("initial");
  }, [thread.id]);

  useEffect(() => {
    if (!hasWorkingJob || pollGaveUp) return;
    let pollCount = 0;
    const t = setInterval(() => {
      pollCount += 1;
      if (pollCount >= MAX_POLLS) {
        if (pollRound === "retry") setPollTerminal(true);
        setPollGaveUp(true);
        clearInterval(t);
        return;
      }
      void refreshAndUpdate();
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkingJob, thread.id, pollGaveUp, pollRound, pollNonce]);

  // leading-[1.5] — design-baseline body line-height (Analytics standard)
  return (
    <div className="gb leading-[1.5]" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @media (max-width: 680px) {
          .otto-conv-scroll { padding: 1rem 0.75rem !important; }
          .otto-conv-composer { padding: 0.75rem 0.75rem !important; }
          .otto-conv-header { padding: 0.75rem 1rem !important; }
        }
      `}</style>
      {/* Header */}
      <div
        className="otto-conv-header flex items-center gap-[9px] border-b border-border bg-card"
        style={{ padding: "13px 16px" }}
      >
        <OttoAvatar size={22} state={busy ? "thinking" : "idle"} />
        <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.90625rem] font-semibold text-foreground">
          {thread.title}
        </div>
      </div>

      {/* Messages */}
      <div className="otto-conv-scroll flex-1 overflow-auto" style={{ padding: "16px" }}>
        <div className="mx-auto flex flex-col gap-[14px]" style={{ maxWidth: 680 }}>
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              entities={entities}
              projectId={projectId}
              threadId={thread.id}
              balanceUsd={balanceUsd}
              onBalanceRefresh={onBalanceRefresh}
              onRefresh={refreshAndUpdate}
              resultJobIds={resultJobIds}
              errorJobIds={errorJobIds}
              cancelledJobIds={durablyCancelledJobIds}
              cardIdByJobId={cardIdByJobId}
              submittedCardIds={submittedCardIds}
              pendingApprovalCardIds={pendingApprovalCardIds}
              onApproved={(cardId) => {
                // Record submission so the card flips to "working" optimistically.
                setSubmittedCardIds((cur) => new Set(cur).add(cardId));
                // ChainedApproval.pendingCardIds contract: this fallback's
                // onApproved carries no chained set (no set information), so
                // via the same helper only the fired card's park is consumed.
                setPendingApprovalCardIds((cur) => nextPendingApprovalCardIds(cur, [cardId]));
                // a freshly-approved card queues a new job — re-arm polling even if a
                // prior job had already hit the give-up cap.
                rearmGenerationPoll();
                // No balance announcement here: OttoPlanCard.approve() already makes it in its
                // own finally, which fires on the failure paths too. Announcing again from
                // this success-only callback just double-read the balance (#555 round-2 P2).
                refreshAndUpdate();
              }}
              onChangeRequest={(seed) => {
                // Prefill the composer with the plan prompt so the user edits from it.
                const ta = document.getElementById("otto-composer") as HTMLTextAreaElement | null;
                if (ta) {
                  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                  nativeInputValueSetter?.call(ta, seed);
                  ta.dispatchEvent(new Event("input", { bubbles: true }));
                  ta.focus();
                }
                setText(seed);
              }}
              onRetry={() => {
                // Fresh card spawned — re-arm poll and refetch so it appears.
                // Reset the poll round too: the retried job gets the full two-round
                // stall budget, not a one-round dead-end from an earlier "Check again".
                rearmGenerationPoll();
                void refreshAndUpdate();
              }}
              onCancelled={(genJobId) => {
                if (genJobId) setCancelledJobIds((cur) => new Set(cur).add(genJobId));
                // Same as onApproved above: the card's own cancel() finally announces.
                void refreshAndUpdate();
              }}
              onMakeAnother={() => {
                // Fresh card spawned via "Make another" — re-arm poll + refetch.
                rearmGenerationPoll();
                void refreshAndUpdate();
              }}
            />
          ))}

          {busy && (
            <div className="flex items-start gap-3">
              <OttoAvatar size={32} state="thinking" />
              <div className="px-[13px] py-[10px] bg-card rounded-[5px_14px_14px_14px] border border-border text-[0.875rem] text-muted-foreground italic">
                Otto is thinking…
              </div>
            </div>
          )}

          {!busy && hasWorkingJob && !pollGaveUp && (
            <div className="flex items-start gap-3">
              <OttoAvatar size={32} state="thinking" />
              <div className="px-4 py-3 bg-card rounded-[0_20px_20px_20px] border border-border text-[0.875rem] text-muted-foreground italic">
                Otto is making this — video can take a few minutes…
              </div>
            </div>
          )}

          {!busy && hasWorkingJob && pollGaveUp && !pollTerminal && (
            <div className="flex items-start gap-3">
              <OttoAvatar size={32} state="idle" />
              <div className="px-4 py-3 bg-card border border-border rounded-[0_20px_20px_20px] text-[0.875rem] text-foreground">
                This is taking longer than usual. Your credits for this are on hold — if it doesn&rsquo;t finish, they&rsquo;re returned to you automatically.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setPollRound("retry");
                    setPollGaveUp(false);
                    void refreshAndUpdate();
                  }}
                  className="bg-transparent border-0 p-0 text-primary font-semibold cursor-pointer underline"
                >
                  Check again
                </button>
              </div>
            </div>
          )}

          {!busy && hasWorkingJob && pollTerminal && (
            <div className="flex items-start gap-3">
              <OttoAvatar size={32} state="idle" />
              <div className="px-4 py-3 bg-card border border-border rounded-[0_20px_20px_20px] text-[0.875rem] text-foreground">
                This looks stuck. Cancel it on the card to get your credits back, or start a new card.
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="px-4 py-3 rounded-[14px] bg-error-soft text-[var(--error-soft-foreground)] text-[0.875rem]"
            >
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div
        className="otto-conv-composer border-t border-border bg-card"
        style={{ padding: "12px" }}
      >
        <div className="relative" style={{ maxWidth: 680, margin: "0 auto" }}>
          {mentionSuggestions.length > 0 && (
            <div
              role="listbox"
              className="absolute bottom-full left-0 mb-1 w-64 rounded-[14px] border border-border bg-card shadow-lg z-50 overflow-hidden"
            >
              {mentionSuggestions.map((e, i) => (
                <button
                  key={e.id}
                  role="option"
                  aria-selected={i === mentionHighlight}
                  onMouseDown={(ev) => { ev.preventDefault(); selectMention(e); }}
                  className={`block w-full text-left px-3 py-2 text-[0.875rem] border-0 cursor-pointer text-foreground ${i === mentionHighlight ? "bg-muted" : "bg-transparent"}`}
                >
                  @{e.name}
                </button>
              ))}
            </div>
          )}
          <div className="bg-background rounded-[14px] border-[1.5px] border-border overflow-hidden shadow-sm">
            <textarea
              id="otto-composer"
              // #739 — a placeholder is not a name: it disappears on the first keystroke,
              // so the product's main input must carry its own accessible name.
              aria-label="Reply to Otto"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={busy}
              placeholder="Reply to Otto…"
              rows={2}
              className="w-full border-0 outline-none resize-none px-4 py-3 text-[0.90625rem] text-foreground bg-transparent leading-normal"
            />
            <div className="flex justify-end px-3 py-2 border-t border-border">
              <Button
                variant="default"
                size="sm"
                disabled={busy || !text.trim()}
                onClick={send}
              >
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message: m,
  entities,
  projectId,
  threadId,
  balanceUsd,
  onBalanceRefresh,
  onRefresh,
  resultJobIds,
  errorJobIds,
  cancelledJobIds,
  cardIdByJobId,
  submittedCardIds,
  pendingApprovalCardIds,
  onApproved,
  onChangeRequest,
  onRetry,
  onCancelled,
  onMakeAnother,
}: {
  message: ChatMessageDTO;
  entities: EntityDTO[];
  projectId: string;
  threadId: string;
  balanceUsd: number;
  onBalanceRefresh?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  resultJobIds: Set<string>;
  errorJobIds: Set<string>;
  /** Terminal messages that say the MERCHANT stopped it — durable, so a reload agrees (#602 T3). */
  cancelledJobIds: Set<string>;
  cardIdByJobId: Map<string, string>;
  submittedCardIds: Set<string>;
  pendingApprovalCardIds: Set<string>;
  onApproved: (cardId: string) => void;
  onChangeRequest: (seed: string) => void;
  onRetry: () => void;
  onCancelled: (genJobId: string | null) => void;
  onMakeAnother: () => void;
}) {
  const isUser = m.role === "USER";

  if (m.kind === "TEXT") {
    if (isUser) {
      return (
        <div className="flex justify-end">
          <div className="max-w-[75%] px-[13px] py-[10px] bg-primary text-primary-foreground rounded-[14px_14px_5px_14px] text-[0.875rem] leading-[1.45] whitespace-pre-wrap break-words">
            {m.text}
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-[9px]">
        <OttoAvatar size={26} state="idle" />
        {/* #586: Otto's own reply is markdown; the user bubble above stays literal. */}
        <div className="max-w-[80%] px-[13px] py-[10px] bg-card border border-border rounded-[5px_14px_14px_14px] text-[0.875rem] leading-[1.5] text-foreground break-words">
          <OttoMarkdown text={m.text} />
        </div>
      </div>
    );
  }

  if (m.kind === "GEN_CARD") {
    // Storyboard first-frame child cards render as thumbnails inside their parent
    // StoryboardCard, not as standalone plan cards. Hide them here (their GenJob is
    // driven by the card's own coworkGenerate + the parent's sync poll — unaffected).
    if (typeof (m.payload as Record<string, unknown> | null)?.storyboardCardId === "string") {
      return null;
    }
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <OttoPlanCard
            cardId={m.id}
            payload={m.payload}
            entities={entities}
            threadId={threadId}
            projectId={projectId}
            cardState={deriveCardState({
              genJobId: m.genJobId,
              submitted: submittedCardIds.has(m.id),
              results: resultJobIds,
              errors: errorJobIds,
              cancelled: cancelledJobIds,
            })}
            pendingApproval={pendingApprovalCardIds.has(m.id)}
            genJobId={m.genJobId}
            onApproved={() => onApproved(m.id)}
            onChangeSomething={onChangeRequest}
            onRetry={onRetry}
            onCancelled={() => onCancelled(m.genJobId)}
          />
        </div>
      </div>
    );
  }

  if (m.kind === "ACTION_CARD") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <OttoActionPlanCard cardId={m.id} payload={m.payload} />
        </div>
      </div>
    );
  }

  if (m.kind === "BUILD_CARD") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <OttoAdBuildCard cardId={m.id} payload={m.payload} />
        </div>
      </div>
    );
  }

  // Universal approval card (B4 debt-70): a non-generate gated skill parked for consent.
  if (m.kind === "APPROVAL_CARD") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <OttoApprovalCard cardId={m.id} threadId={threadId} payload={m.payload} onResolved={onRefresh} />
        </div>
      </div>
    );
  }

  if (m.kind === "STORYBOARD_CARD") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <StoryboardCard
            cardId={m.id}
            payload={m.payload}
            balanceUsd={balanceUsd}
            onBalanceRefresh={() => void onBalanceRefresh?.()}
          />
        </div>
      </div>
    );
  }

  if (m.kind === "RESEARCH_CARD") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <ResearchCard
            cardId={m.id}
            payload={m.payload}
            balanceUsd={balanceUsd}
            onBalanceRefresh={() => void onBalanceRefresh?.()}
            onRefresh={onRefresh}
          />
        </div>
      </div>
    );
  }

  if (m.kind === "PERFORMANCE_CARD") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <PerformanceCard payload={m.payload} />
        </div>
      </div>
    );
  }

  if (m.kind === "RESEARCH_REPORT") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <ResearchReport cardId={m.id} payload={m.payload} />
        </div>
      </div>
    );
  }

  if (m.kind === "GEN_RESULT") {
    const r = m.payload as { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; costUsd?: number } | null;
    const sourceCardId = m.genJobId ? cardIdByJobId.get(m.genJobId) : undefined;
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <OttoResult payload={r} sourceCardId={sourceCardId} onMakeAnother={onMakeAnother} />
        </div>
      </div>
    );
  }

  if (m.kind === "DENIAL" || m.kind === "TURN_ERROR") {
    // A cancel rides on TURN_ERROR because that kind owns the one-terminal-message-per-job index
    // — but it is not an error, and it must not wear the error colour (#602 T3).
    const cancelled = m.kind === "TURN_ERROR" && cancelledTurnPayload(m.payload);
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div
          className={cancelled
            ? "px-4 py-3 bg-muted text-muted-foreground rounded-[0_20px_20px_20px] text-[0.875rem] leading-normal"
            : "px-4 py-3 bg-error-soft text-[var(--error-soft-foreground)] rounded-[0_20px_20px_20px] text-[0.875rem] leading-normal"}
        >
          {m.text}
        </div>
      </div>
    );
  }

  // PLAN messages: skip in simple mode (they're internal reasoning)
  return null;
}

export default OttoConversation;
