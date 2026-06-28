"use client";
import React, { useEffect, useRef, useState } from "react";
import { OttoAvatar, Button } from "@/components/fk";
import { ottoTurn } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { OttoPlanCard } from "./OttoPlanCard";
import { OttoActionPlanCard } from "./OttoActionPlanCard";
import { OttoResult } from "./OttoResult";
import { deriveCardState } from "@/lib/otto-inject-helpers";
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
  onRefresh,
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
    setPollGaveUp(false);
    setPollTerminal(false);
    pollCountRef.current = 0;
    checkAgainUsedRef.current = false;
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
      if (res.status === "needs_approval" && res.pendingCardIds?.length) {
        setPendingApprovalCardIds((cur) => {
          const next = new Set(cur);
          res.pendingCardIds!.forEach((id: string) => next.add(id));
          return next;
        });
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
    if (e.key === "Enter" && !e.shiftKey) {
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

  // Map genJobId → cardId for the "Make another" path on GEN_RESULT widgets.
  const cardIdByJobId = new Map<string, string>(
    messages
      .filter((m) => m.kind === "GEN_CARD" && m.genJobId)
      .map((m) => [m.genJobId as string, m.id]),
  );

  // A job is "working" once its card is approved (genJobId set) but no terminal
  // message (GEN_RESULT or TURN_ERROR) has landed yet. While any job is working we
  // poll the thread so the async worker result appears without a manual reload.
  const terminalJobIds = new Set(
    messages
      .filter((m) => (m.kind === "GEN_RESULT" || m.kind === "TURN_ERROR") && m.genJobId)
      .map((m) => m.genJobId as string),
  );
  const hasWorkingJob = messages.some(
    (m) => m.kind === "GEN_CARD" && m.genJobId && !terminalJobIds.has(m.genJobId),
  );

  // Bound the polling: a worker that fails-closed without writing a terminal message
  // would otherwise keep hasWorkingJob true forever (poll-forever + a stuck "making
  // this…" spinner). After ~2 min we stop and show a recoverable fallback.
  const POLL_MS = 2500;
  const MAX_POLLS = 48; // ~2 minutes
  const [pollGaveUp, setPollGaveUp] = useState(false);
  /** Set to true after "Check again" exhausts a second MAX_POLLS round — terminal message. */
  const [pollTerminal, setPollTerminal] = useState(false);
  const pollCountRef = useRef(0);
  const checkAgainUsedRef = useRef(false);

  // Reset the give-up state whenever we switch threads.
  useEffect(() => {
    setPollGaveUp(false);
    setPollTerminal(false);
    pollCountRef.current = 0;
    checkAgainUsedRef.current = false;
  }, [thread.id]);

  useEffect(() => {
    if (!hasWorkingJob || pollGaveUp) return;
    const t = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLLS) {
        if (checkAgainUsedRef.current) setPollTerminal(true);
        setPollGaveUp(true);
        clearInterval(t);
        return;
      }
      void refreshAndUpdate();
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkingJob, thread.id, pollGaveUp]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @media (max-width: 680px) {
          .otto-conv-scroll { padding: var(--space-4) var(--space-3) !important; }
          .otto-conv-composer { padding: var(--space-3) var(--space-3) !important; }
          .otto-conv-header { padding: var(--space-3) var(--space-4) !important; }
        }
      `}</style>
      {/* Header */}
      <div
        className="otto-conv-header"
        style={{
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <OttoAvatar size={32} state={busy ? "thinking" : "idle"} />
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-semibold)",
            fontSize: "var(--text-base)",
            color: "var(--text-strong)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {thread.title}
        </div>
      </div>

      {/* Messages */}
      <div className="otto-conv-scroll" style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              entities={entities}
              projectId={projectId}
              threadId={thread.id}
              resultJobIds={resultJobIds}
              errorJobIds={errorJobIds}
              cardIdByJobId={cardIdByJobId}
              submittedCardIds={submittedCardIds}
              pendingApprovalCardIds={pendingApprovalCardIds}
              busy={busy}
              onApproved={(cardId) => {
                // Record submission so the card flips to "working" optimistically.
                setSubmittedCardIds((cur) => new Set(cur).add(cardId));
                setPendingApprovalCardIds((cur) => {
                  const next = new Set(cur);
                  next.delete(cardId);
                  return next;
                });
                // a freshly-approved card queues a new job — re-arm polling even if a
                // prior job had already hit the give-up cap.
                setPollGaveUp(false);
                pollCountRef.current = 0;
                // An approve reserves credits — refresh the nav balance immediately.
                void onBalanceRefresh?.();
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
                // Reset checkAgainUsedRef too: the retried job gets the full two-round
                // stall budget, not a one-round dead-end from an earlier "Check again".
                setPollGaveUp(false);
                setPollTerminal(false);
                pollCountRef.current = 0;
                checkAgainUsedRef.current = false;
                void refreshAndUpdate();
              }}
              onCancelled={() => void refreshAndUpdate()}
              onMakeAnother={() => {
                // Fresh card spawned via "Make another" — re-arm poll + refetch.
                setPollGaveUp(false);
                pollCountRef.current = 0;
                void refreshAndUpdate();
              }}
            />
          ))}

          {busy && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
              <OttoAvatar size={32} state="thinking" />
              <div
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--surface-card)",
                  borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                }}
              >
                Otto is thinking…
              </div>
            </div>
          )}

          {!busy && hasWorkingJob && !pollGaveUp && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
              <OttoAvatar size={32} state="thinking" />
              <div
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--surface-card)",
                  borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                }}
              >
                Otto is making this — this can take a moment…
              </div>
            </div>
          )}

          {!busy && hasWorkingJob && pollGaveUp && !pollTerminal && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
              <OttoAvatar size={32} state="idle" />
              <div
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-body)",
                }}
              >
                This is taking longer than usual. Your credits for this are on hold — if it doesn&rsquo;t finish, they&rsquo;re returned to you automatically.{" "}
                <button
                  type="button"
                  onClick={() => {
                    checkAgainUsedRef.current = true;
                    setPollGaveUp(false);
                    pollCountRef.current = 0;
                    void refreshAndUpdate();
                  }}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--brand)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], cursor: "pointer", textDecoration: "underline" }}
                >
                  Check again
                </button>
              </div>
            </div>
          )}

          {!busy && hasWorkingJob && pollTerminal && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
              <OttoAvatar size={32} state="idle" />
              <div
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-body)",
                }}
              >
                This looks stuck. Cancel it on the card to get your credits back, or start a new card.
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                padding: "var(--space-3) var(--space-4)",
                borderRadius: "var(--radius-md)",
                background: "var(--error-100)",
                color: "var(--error-700)",
                fontSize: "var(--text-sm)",
              }}
            >
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div
        className="otto-conv-composer"
        style={{
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          padding: "var(--space-4) var(--space-6)",
        }}
      >
        <div style={{ maxWidth: 680, margin: "0 auto", position: "relative" }}>
          {mentionSuggestions.length > 0 && (
            <div
              role="listbox"
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                marginBottom: 4,
                width: 256,
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border-default)",
                background: "var(--surface-card)",
                boxShadow: "var(--shadow-lg)",
                zIndex: 50,
                overflow: "hidden",
              }}
            >
              {mentionSuggestions.map((e, i) => (
                <button
                  key={e.id}
                  role="option"
                  aria-selected={i === mentionHighlight}
                  onMouseDown={(ev) => { ev.preventDefault(); selectMention(e); }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "var(--space-2) var(--space-3)",
                    fontSize: "var(--text-sm)",
                    background: i === mentionHighlight ? "var(--bg-muted, var(--surface-raised))" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-body)",
                  }}
                >
                  @{e.name}
                </button>
              ))}
            </div>
          )}
          <div
            style={{
              background: "var(--bg-page)",
              borderRadius: "var(--radius-xl)",
              border: "1.5px solid var(--border-default)",
              overflow: "hidden",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <textarea
              id="otto-composer"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={busy}
              placeholder="Reply to Otto…"
              rows={2}
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                resize: "none",
                padding: "var(--space-3) var(--space-4)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-base)",
                color: "var(--text-body)",
                background: "transparent",
                lineHeight: "var(--leading-relaxed)",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "var(--space-2) var(--space-3)",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <Button
                variant="primary"
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
  resultJobIds,
  errorJobIds,
  cardIdByJobId,
  submittedCardIds,
  pendingApprovalCardIds,
  busy,
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
  resultJobIds: Set<string>;
  errorJobIds: Set<string>;
  cardIdByJobId: Map<string, string>;
  submittedCardIds: Set<string>;
  pendingApprovalCardIds: Set<string>;
  busy: boolean;
  onApproved: (cardId: string) => void;
  onChangeRequest: (seed: string) => void;
  onRetry: () => void;
  onCancelled: () => void;
  onMakeAnother: () => void;
}) {
  const isUser = m.role === "USER";

  if (m.kind === "TEXT") {
    if (isUser) {
      return (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              maxWidth: "75%",
              padding: "var(--space-3) var(--space-4)",
              background: "var(--brand)",
              color: "var(--text-on-brand)",
              borderRadius: "var(--radius-lg) var(--radius-lg) var(--space-1) var(--radius-lg)",
              fontSize: "var(--text-sm)",
              lineHeight: "var(--leading-normal)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {m.text}
          </div>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <OttoAvatar size={32} state="idle" />
        <div
          style={{
            maxWidth: "80%",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-normal)",
            color: "var(--text-body)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {m.text}
        </div>
      </div>
    );
  }

  if (m.kind === "GEN_CARD") {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <OttoAvatar size={32} state="idle" />
        <div style={{ flex: 1, minWidth: 0 }}>
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
            })}
            pendingApproval={pendingApprovalCardIds.has(m.id)}
            genJobId={m.genJobId}
            onApproved={() => onApproved(m.id)}
            onChangeSomething={onChangeRequest}
            onRetry={onRetry}
            onCancelled={onCancelled}
          />
        </div>
      </div>
    );
  }

  if (m.kind === "ACTION_CARD") {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <OttoAvatar size={32} state="idle" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <OttoActionPlanCard cardId={m.id} payload={m.payload} />
        </div>
      </div>
    );
  }

  if (m.kind === "GEN_RESULT") {
    const r = m.payload as { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; costUsd?: number } | null;
    const sourceCardId = m.genJobId ? cardIdByJobId.get(m.genJobId) : undefined;
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <OttoAvatar size={32} state="idle" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <OttoResult payload={r} sourceCardId={sourceCardId} onMakeAnother={onMakeAnother} />
        </div>
      </div>
    );
  }

  if (m.kind === "DENIAL" || m.kind === "TURN_ERROR") {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <OttoAvatar size={32} state="idle" />
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "var(--error-100)",
            color: "var(--error-700)",
            borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-normal)",
          }}
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
