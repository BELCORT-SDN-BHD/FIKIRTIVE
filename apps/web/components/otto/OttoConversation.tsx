"use client";
import React, { useEffect, useRef, useState } from "react";
import { OttoAvatar, Button } from "@/components/fk";
import { ottoTurn } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { OttoPlanCard } from "./OttoPlanCard";
import { OttoResult } from "./OttoResult";
import type { EntityDTO, ChatThreadDTO, ChatMessageDTO } from "@/lib/types";

export interface OttoConversationProps {
  projectId: string;
  entities: EntityDTO[];
  thread: ChatThreadDTO;
  balanceUsd: number;
  onRefresh: () => Promise<void>;
  onThreadUpdate: (thread: ChatThreadDTO) => void;
  onEditByHand: () => void;
}

export function OttoConversation({
  projectId,
  entities,
  thread,
  balanceUsd,
  onRefresh,
  onThreadUpdate,
  onEditByHand,
}: OttoConversationProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovalCardIds, setPendingApprovalCardIds] = useState<Set<string>>(new Set());
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

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await ottoTurn({
        threadId: thread.id,
        projectId,
        text: trimmed,
        entityIds: [],
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
      await refreshAndUpdate();
    } catch {
      setError("Couldn't reach Otto — please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Track which job ids already have a GEN_RESULT so we don't double-render
  const resultJobIds = new Set(
    messages
      .filter((m) => m.kind === "GEN_RESULT" && m.genJobId)
      .map((m) => m.genJobId as string),
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

  useEffect(() => {
    if (!hasWorkingJob) return;
    const t = setInterval(() => {
      void refreshAndUpdate();
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkingJob, thread.id]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div
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
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              entities={entities}
              projectId={projectId}
              threadId={thread.id}
              resultJobIds={resultJobIds}
              pendingApprovalCardIds={pendingApprovalCardIds}
              busy={busy}
              onApproved={(cardId) => {
                setPendingApprovalCardIds((cur) => {
                  const next = new Set(cur);
                  next.delete(cardId);
                  return next;
                });
                refreshAndUpdate();
              }}
              onChangeRequest={() => {
                // Focus the composer for a change request
                const ta = document.getElementById("otto-composer") as HTMLTextAreaElement | null;
                ta?.focus();
              }}
              onEditByHand={onEditByHand}
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

          {!busy && hasWorkingJob && (
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
        style={{
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          padding: "var(--space-4) var(--space-6)",
        }}
      >
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
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
              onChange={(e) => setText(e.target.value)}
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
  pendingApprovalCardIds,
  busy,
  onApproved,
  onChangeRequest,
  onEditByHand,
}: {
  message: ChatMessageDTO;
  entities: EntityDTO[];
  projectId: string;
  threadId: string;
  resultJobIds: Set<string>;
  pendingApprovalCardIds: Set<string>;
  busy: boolean;
  onApproved: (cardId: string) => void;
  onChangeRequest: () => void;
  onEditByHand: () => void;
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
            alreadyGenerated={!!m.genJobId}
            hasDurableResult={!!m.genJobId && resultJobIds.has(m.genJobId)}
            pendingApproval={pendingApprovalCardIds.has(m.id)}
            onApproved={() => onApproved(m.id)}
            onChangeSomething={onChangeRequest}
          />
        </div>
      </div>
    );
  }

  if (m.kind === "GEN_RESULT") {
    const r = m.payload as { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; costUsd?: number } | null;
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <OttoAvatar size={32} state="idle" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <OttoResult payload={r} onEditByHand={onEditByHand} />
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
