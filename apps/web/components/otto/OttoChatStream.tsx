"use client";
import React, { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useStickToBottom } from "use-stick-to-bottom";
import { OttoAvatar, Button } from "@/components/fk";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { threadToUiMessages, type OttoUiMessage } from "@/lib/otto-ui-messages";
import { TextPart } from "./parts/TextPart";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";

// Re-export the mapping seam so callers/tests can import it from the component too.
export { threadToUiMessages } from "@/lib/otto-ui-messages";
export type { OttoUiMessage, OttoUiMessageMetadata } from "@/lib/otto-ui-messages";

/** Prop-compatible with how OttoView renders OttoConversation, so Task 6 can swap
 *  this in drop-in. balanceUsd / onRefresh are accepted for parity (unused here). */
export interface OttoChatStreamProps {
  projectId: string;
  entities: EntityDTO[];
  thread: ChatThreadDTO;
  balanceUsd: number;
  onRefresh: () => Promise<void>;
  onThreadUpdate: (thread: ChatThreadDTO) => void;
  onEditByHand: () => void;
}

/** The latest user message's text — what the strict route body needs for `text`. */
function latestUserText(messages: OttoUiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    return m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

export function OttoChatStream({
  projectId,
  thread,
  onThreadUpdate,
}: OttoChatStreamProps) {
  const [text, setText] = useState("");

  // useChat constructs its Chat (and captures `transport` + initial `messages`) ONCE.
  // We build both in a one-time useState initializer so they're stable across renders.
  //
  // The route's coworkTurnRequest is .strict(): the POST body must contain EXACTLY
  // its fields and nothing else — useChat's default body ({ messages, id, trigger,
  // … }) would be rejected. prepareSendMessagesRequest replaces it wholesale, reading
  // the live projectId/threadId from the per-call `body` we pass into sendMessage()
  // (see submit()), so the stable transport never goes stale.
  //
  // Initial messages seed from the persisted thread (TEXT now; placeholders for
  // plan/result/denial — Task 5 swaps those for real widgets). Thread switches are
  // handled by keying this component on thread.id in OttoView (Task 6).
  const [chatInit] = useState(() => ({
    transport: new DefaultChatTransport<OttoUiMessage>({
      api: "/api/otto/stream",
      prepareSendMessagesRequest: ({ messages, body }) => {
        const ids = (body ?? {}) as { projectId?: string; threadId?: string };
        return {
          body: {
            projectId: ids.projectId,
            threadId: ids.threadId,
            text: latestUserText(messages),
            simple: true,
          },
        };
      },
    }),
    messages: threadToUiMessages(thread),
  }));

  const { messages, sendMessage, status, error } = useChat<OttoUiMessage>({
    transport: chatInit.transport,
    messages: chatInit.messages,
    onFinish: () => {
      // Sync the parent thread list + make reload authoritative. Non-blocking.
      void (async () => {
        const fresh = await getCoworkThreadClient(thread.id);
        if (fresh) onThreadUpdate(fresh);
      })();
    },
  });

  const isStreaming = status === "streaming";
  const isBusy = status === "submitted" || status === "streaming";

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    setText(""); // clear the composer immediately; sendMessage echoes the user msg
    // Pass the live projectId/threadId via the per-call body; prepareSendMessagesRequest
    // reads them off `body` and shapes the strict route payload.
    void sendMessage({ text: trimmed }, { body: { projectId, threadId: thread.id } });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // The index of the message that holds the actively-streaming assistant text, so
  // only its last text part gets the blinking caret.
  const lastMessageIsStreamingAssistant =
    isStreaming &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant";

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
        <OttoAvatar size={32} state={isBusy ? "thinking" : "idle"} />
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

      {/* Messages (stick-to-bottom scroll region) */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: "auto", padding: "var(--space-6)", position: "relative" }}
      >
        <div
          ref={contentRef}
          style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
        >
          {messages.map((m, mi) => {
            const isLastMessage = mi === messages.length - 1;
            // Only text parts render in Task 3. Non-text parts (reasoning / data) are
            // ignored here — Task 4 renders the live status line, and Task 5 swaps the
            // placeholder for the real plan-card / result widget using m.metadata
            // (kind / payload / genJobId). Task 5: render real widget here.
            const textParts = m.parts.filter(
              (p): p is { type: "text"; text: string } => p.type === "text",
            );
            return textParts.map((p, pi) => {
              const isLastTextPart = pi === textParts.length - 1;
              const streaming =
                lastMessageIsStreamingAssistant && isLastMessage && isLastTextPart;
              return (
                <TextPart
                  key={`${m.id}:${pi}`}
                  role={m.role === "user" ? "user" : "assistant"}
                  text={p.text}
                  streaming={streaming}
                />
              );
            });
          })}

          {status === "submitted" && (
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

          {status === "error" && (
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
              {error?.message || "Otto hit a snag — please try again."}
            </div>
          )}
        </div>

        {!isAtBottom && (
          <div
            style={{
              position: "sticky",
              bottom: "var(--space-4)",
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <button
              type="button"
              onClick={() => void scrollToBottom()}
              style={{
                pointerEvents: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "var(--space-2) var(--space-3)",
                borderRadius: "var(--radius-full)",
                border: "1px solid var(--border-default)",
                background: "var(--surface-card)",
                boxShadow: "var(--shadow-sm)",
                fontSize: "var(--text-sm)",
                color: "var(--text-body)",
                cursor: "pointer",
              }}
            >
              ↓ Scroll to bottom
            </button>
          </div>
        )}
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
              disabled={isBusy}
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
              <Button variant="primary" size="sm" disabled={isBusy || !text.trim()} onClick={submit}>
                {isBusy ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OttoChatStream;
