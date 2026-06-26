"use client";
import React, { useEffect, useRef, useState } from "react";
import { MSG_ENTER_STYLE } from "./parts/motion";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useStickToBottom } from "use-stick-to-bottom";
import { OttoAvatar, Button } from "@/components/fk";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { threadToUiMessages, type OttoUiMessage } from "@/lib/otto-ui-messages";
import { ImageIcon } from "lucide-react";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import {
  resultJobIds,
  errorJobIds,
  deriveCardState,
  hasWorkingJob as computeHasWorkingJob,
  proposeCardId,
  injectCardMessage,
  appendDurableResults,
  syncCardJobIds,
} from "@/lib/otto-inject-helpers";
import { OttoPlanCard } from "./OttoPlanCard";
import { OttoResult } from "./OttoResult";
import { TextPart } from "./parts/TextPart";
import { StatusLine } from "./parts/StatusLine";
import { ReasoningPart } from "./parts/ReasoningPart";
import { asStatusData, asErrorData } from "@/lib/otto-status-helpers";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";
import type { OttoStatusData } from "@/lib/otto-stream-bridge";
import type { ReasoningUIPart } from "ai";
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
  /** Re-reads the account balance and updates the nav display after a spend event. */
  onBalanceRefresh?: () => void | Promise<void>;
  /** Streaming front door: a first message to auto-send ONCE into a freshly-created
   *  (empty) thread on mount. The thread row already exists (createEmptyCoworkThread),
   *  so the route's existing-thread branch handles it. */
  pendingFirst?: { text: string; goalKey?: string };
  /** Called right after the pendingFirst message is dispatched, so the parent can
   *  clear it (prevents a re-send if this thread is remounted later). */
  onPendingFirstSent?: () => void;
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
  entities,
  thread,
  onThreadUpdate,
  onBalanceRefresh,
  pendingFirst,
  onPendingFirstSent,
}: OttoChatStreamProps) {
  const [text, setText] = useState("");
  const [pickedMentions, setPickedMentions] = useState<{id: string; name: string}[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  /** Latest data-status received for the in-flight turn; reset on each new turn. */
  const [liveStatus, setLiveStatus] = useState<OttoStatusData | null>(null);
  /** data-error text for the in-flight turn; stays visible after the turn ends. */
  const [streamError, setStreamError] = useState<string | null>(null);
  /** data-error kind; "insufficient_credits" drives the Top-up link. */
  const [streamErrorKind, setStreamErrorKind] = useState<string | null>(null);
  /** Card ids the run paused on (needs_approval) — drives OttoPlanCard's parked vs.
   *  proposed spend path. Mirrors OttoConversation's pendingApprovalCardIds set. */
  const [pendingApprovalCardIds, setPendingApprovalCardIds] = useState<Set<string>>(new Set());
  /** Card durableIds for which the user has clicked "Make it" (or "Try again") in this
   *  session — drives the optimistic "working" state before the genJobId lands from the
   *  durable thread. Resets on remount (thread switch = component re-key). */
  const [submittedCardIds, setSubmittedCardIds] = useState<Set<string>>(new Set());
  /** Image attachment: a generation created from a user-uploaded file, included as
   *  sourceGenerationId on the next send. Null when no image is attached. */
  const [attached, setAttached] = useState<{ generationId: string; src: string } | null>(null);
  /** True while the file is being hashed + uploaded + finalized. */
  const [uploading, setUploading] = useState(false);
  /** Upload error message shown near the attach button; clears on next successful attach. */
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bounded in-flight poll for the async worker result (ported from OttoConversation):
  // a GEN_CARD whose genJobId is set but with no terminal GEN_RESULT/TURN_ERROR keeps
  // hasWorkingJob true; we poll the durable thread and inject the result when it lands.
  const POLL_MS = 2500;
  const MAX_POLLS = 48; // ~2 minutes
  const [pollGaveUp, setPollGaveUp] = useState(false);
  const pollCountRef = useRef(0);

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
        const ids = (body ?? {}) as { projectId?: string; threadId?: string; goalKey?: string; entityIds?: string[]; sourceGenerationId?: string };
        return {
          body: {
            projectId: ids.projectId,
            threadId: ids.threadId,
            text: latestUserText(messages),
            simple: true,
            // goalKey only on the first message of a goal-seeded thread; coworkTurnRequest
            // accepts it as an optional field, so include it only when present.
            ...(ids.goalKey ? { goalKey: ids.goalKey } : {}),
            ...(ids.entityIds?.length ? { entityIds: ids.entityIds } : {}),
            ...(ids.sourceGenerationId ? { sourceGenerationId: ids.sourceGenerationId } : {}),
          },
        };
      },
    }),
    messages: threadToUiMessages(thread),
  }));

  // Track which message ids were present at mount (seeded from thread history).
  // Only messages NOT in this set should play the entry animation — messages that
  // ARRIVE during this session (optimistic echo, streamed replies, injected results).
  // This component is keyed by thread.id in OttoView, so a thread switch remounts
  // with a fresh seed — the new thread's history won't waterfall-animate either.
  const initialIdsRef = useRef<Set<string>>(new Set(chatInit.messages.map((m) => m.id)));
  const isNewMessage = (id: string) => !initialIdsRef.current.has(id);

  const { messages, setMessages, sendMessage, status, error } = useChat<OttoUiMessage>({
    transport: chatInit.transport,
    messages: chatInit.messages,
    // onData fires for each data-* part as it streams in. We capture data-status
    // (ephemeral live progress + needs_approval card ids), data-error (must stay
    // visible — the only user feedback when no assistant message persisted), and
    // data-tool-propose (a card was proposed mid-turn → fetch the durable thread and
    // inject the full GEN_CARD so the plan card renders inline promptly).
    onData: (part) => {
      const s = asStatusData(part);
      if (s) {
        setLiveStatus(s);
        // A paused run reports the cards awaiting approval — track them so the plan
        // card uses the parked (ottoApprove) spend path instead of coworkGenerate.
        if (s.kind === "needs_approval" && s.pendingCardIds?.length) {
          setPendingApprovalCardIds((cur) => {
            const next = new Set(cur);
            s.pendingCardIds.forEach((id) => next.add(id));
            return next;
          });
        }
        return;
      }
      const e = asErrorData(part);
      if (e) { setStreamError(e.text); setStreamErrorKind(e.kind); return; }
      // data-tool-propose: the propose tool persisted a durable GEN_CARD synchronously,
      // but the stream part carries only { cardId, … }. Fetch the durable thread and
      // inject the GEN_CARD (full payload) into the message list, deduped by cardId.
      const cardId = proposeCardId(part);
      if (cardId) {
        void (async () => {
          const fresh = await getCoworkThreadClient(thread.id);
          if (fresh) setMessages((cur) => injectCardMessage(cur, fresh, cardId));
        })();
      }
    },
    onFinish: () => {
      // Sync the parent thread list + make reload authoritative. Non-blocking.
      void (async () => {
        const fresh = await getCoworkThreadClient(thread.id);
        if (fresh) onThreadUpdate(fresh);
      })();
      // A completed turn meters LLM credits — refresh the nav balance display.
      void onBalanceRefresh?.();
    },
  });

  const isStreaming = status === "streaming";
  const isBusy = status === "submitted" || status === "streaming";

  // True once the first assistant token has arrived — drives skeleton → real bubble swap.
  const lastMsg = messages[messages.length - 1];
  const hasAssistantText =
    isBusy &&
    !!lastMsg &&
    lastMsg.role === "assistant" &&
    lastMsg.parts.some((p): p is { type: "text"; text: string } => p.type === "text" && p.text.length > 0);

  // Derived from the rendered messages (which carry durable metadata): which jobs
  // already have a result (so the card shows "making this now" not a dupe result),
  // and whether any approved job is still working (drives the poll + working state).
  const jobsWithResult = resultJobIds(messages);
  const jobsWithError = errorJobIds(messages);
  const hasWorkingJob = computeHasWorkingJob(messages);

  // Refetch the durable thread and inject any new worker-output messages
  // (GEN_RESULT / TURN_ERROR) into the useChat list, deduped by durableId. NEVER
  // re-injects TEXT or GEN_CARD — those already arrived via the stream / card injection.
  async function pollAndInjectResults() {
    const fresh = await getCoworkThreadClient(thread.id);
    if (!fresh) return;
    const prevResultCount = messages.filter(
      (m) => m.metadata?.kind === "GEN_RESULT" || m.metadata?.kind === "TURN_ERROR",
    ).length;
    setMessages((cur) => appendDurableResults(syncCardJobIds(cur, fresh), fresh));
    onThreadUpdate(fresh);
    // A new terminal result landed → a generation settled and credits were spent.
    const freshResultCount = fresh.messages.filter(
      (m) => m.kind === "GEN_RESULT" || m.kind === "TURN_ERROR",
    ).length;
    if (freshResultCount > prevResultCount) void onBalanceRefresh?.();
  }

  // Reset the give-up state whenever we switch threads (mirror OttoConversation).
  // Guarded by a prev-id ref so the reset runs only on an actual thread change, not
  // on the mount render (where the state is already fresh) — avoids a cascading render.
  const prevThreadIdRef = useRef(thread.id);
  useEffect(() => {
    if (prevThreadIdRef.current === thread.id) return;
    prevThreadIdRef.current = thread.id;
    setPollGaveUp(false);
    pollCountRef.current = 0;
  }, [thread.id]);

  // Bounded poll: a worker that fails-closed without writing a terminal message would
  // otherwise keep hasWorkingJob true forever. After ~2 min we stop and show "Check again".
  useEffect(() => {
    if (!hasWorkingJob || pollGaveUp) return;
    const t = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLLS) {
        setPollGaveUp(true);
        clearInterval(t);
        return;
      }
      void pollAndInjectResults();
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkingJob, thread.id, pollGaveUp]);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();

  // Streaming front door: auto-send the first message ONCE into the empty thread.
  // The per-mount ref guards against double-send; onPendingFirstSent clears the
  // parent's pendingFirst so a later remount (switch away + back) never re-fires.
  const pendingSentRef = useRef(false);
  useEffect(() => {
    if (!pendingFirst || pendingSentRef.current) return;
    pendingSentRef.current = true;
    void sendMessage(
      { text: pendingFirst.text },
      { body: { projectId, threadId: thread.id, ...(pendingFirst.goalKey ? { goalKey: pendingFirst.goalKey } : {}) } },
    );
    onPendingFirstSent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFirst]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    const entityIds = resolveSentEntityIds(trimmed, pickedMentions);
    setText(""); // clear the composer immediately; sendMessage echoes the user msg
    setPickedMentions([]);
    // Reset ephemeral stream state for the new turn.
    setLiveStatus(null);
    setStreamError(null);
    setStreamErrorKind(null);
    setAttachError(null);
    // A new turn may queue a new generation — re-arm polling (mirror OttoConversation).
    setPollGaveUp(false);
    pollCountRef.current = 0;
    // Capture and clear the attachment before send. Revoke the local preview blob URL
    // (the source is the generationId, not the blob) so repeated attach/send doesn't leak.
    const attachedNow = attached;
    if (attachedNow?.src.startsWith("blob:")) URL.revokeObjectURL(attachedNow.src);
    setAttached(null);
    // Pass the live projectId/threadId, optional @mention entityIds, and optional
    // sourceGenerationId (attached image) via the per-call body; prepareSendMessagesRequest
    // reads them off `body` and shapes the strict route payload.
    void sendMessage(
      { text: trimmed },
      {
        body: {
          projectId,
          threadId: thread.id,
          ...(entityIds.length ? { entityIds } : {}),
          ...(attachedNow ? { sourceGenerationId: attachedNow.generationId } : {}),
        },
      },
    );
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be picked again if the user re-attaches.
    e.target.value = "";
    if (!file) return;
    setAttachError(null);
    setUploading(true);
    try {
      const outcome = await uploadFilesDirect([file], () => {});
      if (outcome.files.length === 0) {
        setAttachError(outcome.failures[0]?.reason ?? "Upload failed.");
        return;
      }
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res || !res.generationIds?.[0]) {
        setAttachError("error" in res ? res.error : "Could not attach image.");
        return;
      }
      setAttached({ generationId: res.generationIds[0], src: URL.createObjectURL(file) });
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
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
      <style>{`
        @keyframes otto-caret-blink { 50% { opacity: 0; } }
        @keyframes otto-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes otto-msg-enter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes otto-status-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes otto-shimmer      { from {} to {} }
          @keyframes otto-msg-enter    { from {} to {} }
          @keyframes otto-status-fadein { from {} to {} }
        }
        @media (max-width: 680px) {
          .otto-chat-scroll { padding: var(--space-4) var(--space-3) !important; }
          .otto-chat-composer { padding: var(--space-3) var(--space-3) !important; }
          .otto-chat-header { padding: var(--space-3) var(--space-4) !important; }
        }
      `}</style>
      {/* Header */}
      <div
        className="otto-chat-header"
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
        className="otto-chat-scroll"
        style={{ flex: 1, overflow: "auto", padding: "var(--space-6)", position: "relative" }}
      >
        <div
          ref={contentRef}
          style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
        >
          {messages.map((m, mi) => {
            const isLastMessage = mi === messages.length - 1;
            const kind = m.metadata?.kind;

            // Durable non-TEXT messages render as their REAL widget (the placeholder
            // text from threadToUiMessages is ignored — metadata carries the payload).
            // Live-streamed text/reasoning has no durable metadata (kind undefined) and
            // falls through to the text/reasoning renderer below.
            if (kind === "GEN_CARD") {
              const genJobId = m.metadata?.genJobId ?? null;
              const durableId = m.metadata!.durableId;
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoPlanCard
                    cardId={durableId}
                    payload={m.metadata?.payload}
                    entities={entities}
                    threadId={thread.id}
                    projectId={projectId}
                    cardState={deriveCardState({
                      genJobId,
                      submitted: submittedCardIds.has(durableId),
                      results: jobsWithResult,
                      errors: jobsWithError,
                    })}
                    pendingApproval={pendingApprovalCardIds.has(durableId)}
                    onApproved={() => {
                      // Record submission so the card flips to "working" optimistically.
                      setSubmittedCardIds((cur) => new Set(cur).add(durableId));
                      // Drop from the pending set; re-arm the poll (a freshly-approved
                      // card queues a new job even if a prior job hit the give-up cap).
                      setPendingApprovalCardIds((cur) => {
                        const next = new Set(cur);
                        next.delete(durableId);
                        return next;
                      });
                      setPollGaveUp(false);
                      pollCountRef.current = 0;
                      // An approve reserves credits — refresh the nav balance immediately.
                      void onBalanceRefresh?.();
                      void pollAndInjectResults();
                    }}
                    onChangeSomething={(seed) => {
                      const ta = document.getElementById("otto-composer") as HTMLTextAreaElement | null;
                      if (ta) {
                        // Prefill with the plan prompt so the user edits from it.
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                        nativeInputValueSetter?.call(ta, seed);
                        ta.dispatchEvent(new Event("input", { bubbles: true }));
                        ta.focus();
                        setText(seed); // mirror OttoConversation — sync React state directly
                      }
                    }}
                  />
                </WidgetRow>
              );
            }

            if (kind === "GEN_RESULT") {
              const r = (m.metadata?.payload ?? null) as
                | { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; costUsd?: number }
                | null;
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoResult payload={r} />
                </WidgetRow>
              );
            }

            if (kind === "DENIAL" || kind === "TURN_ERROR") {
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", ...(isNewMessage(m.id) ? MSG_ENTER_STYLE : undefined) }}>
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
                    {/* DENIAL/TURN_ERROR carry their user-facing copy on the durable
                        message text, which threadToUiMessages put into the text part. */}
                    {(m.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text}
                  </div>
                </div>
              );
            }

            // PLAN messages are internal reasoning — skip in simple mode.
            if (kind === "PLAN") return null;

            // TEXT (or live-streamed, metadata-less) messages → text + reasoning parts.
            const textParts = m.parts.filter(
              (p): p is { type: "text"; text: string } => p.type === "text",
            );
            const reasoningParts = m.parts.filter(
              (p): p is ReasoningUIPart => p.type === "reasoning",
            );
            return [
              ...textParts.map((p, pi) => {
                const isLastTextPart = pi === textParts.length - 1;
                const streaming =
                  lastMessageIsStreamingAssistant && isLastMessage && isLastTextPart;
                return (
                  <TextPart
                    key={`${m.id}:t${pi}`}
                    role={m.role === "user" ? "user" : "assistant"}
                    text={p.text}
                    streaming={streaming}
                    animateIn={isNewMessage(m.id)}
                  />
                );
              }),
              ...reasoningParts.map((p, ri) => (
                // Graceful: only rendered when reasoning arrives; most models omit it.
                <ReasoningPart key={`${m.id}:r${ri}`} part={p} />
              )),
            ];
          })}

          {/* Live status line: shows "Otto is thinking…" or the planning text while
              in-flight; hides automatically once isBusy is false (replaces the
              static "Otto is thinking…" block from Task 3). */}
          <StatusLine
            isBusy={isBusy}
            liveStatus={liveStatus}
            chatStatus={status}
            hasAssistantText={hasAssistantText}
          />

          {/* Terminal degrade/stale status: shown after an abnormal turn end.
              Clears automatically when submit() calls setLiveStatus(null). */}
          {!isBusy && (liveStatus?.kind === "degraded" || liveStatus?.kind === "stale") && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", ...MSG_ENTER_STYLE }}>
              <OttoAvatar size={32} state="idle" />
              <div
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--surface-card)",
                  borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-body)",
                }}
              >
                {liveStatus.text}
              </div>
            </div>
          )}

          {/* Async generation in progress: a card was approved (genJobId set) and the
              worker hasn't written a terminal result yet. Ported from OttoConversation. */}
          {!isBusy && hasWorkingJob && !pollGaveUp && (
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

          {!isBusy && hasWorkingJob && pollGaveUp && (
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
                    setPollGaveUp(false);
                    pollCountRef.current = 0;
                    void pollAndInjectResults();
                  }}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--brand)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], cursor: "pointer", textDecoration: "underline" }}
                >
                  Check again
                </button>
              </div>
            </div>
          )}

          {/* data-error: stays visible after the turn ends — it's the only user
              feedback when the route errors before persisting an assistant message
              (insufficient_credits / run errors surfaced via data-error parts). */}
          {streamError && (
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
              {streamError}
              {streamErrorKind === "insufficient_credits" && (
                <>
                  {" "}
                  <a
                    href="/billing"
                    style={{ color: "var(--error-700)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], textDecoration: "underline" }}
                  >
                    Top up
                  </a>
                </>
              )}
            </div>
          )}

          {/* useChat transport-level error (network / parse failures distinct from
              route data-error). Kept as a fallback alongside stream-level errors. */}
          {status === "error" && !streamError && (
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
              aria-label="Scroll to bottom"
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
        className="otto-chat-composer"
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
          {/* Hidden file input — triggered by the attach button below */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={handleFilePick}
          />

          {/* Thumbnail chip: shown while uploading or when an image is attached */}
          {(uploading || attached) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-2)",
              }}
            >
              {uploading ? (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-1) var(--space-2)",
                    background: "var(--surface-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    fontSize: "var(--text-sm)",
                    color: "var(--text-muted)",
                  }}
                >
                  attaching…
                </div>
              ) : attached ? (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-1) var(--space-2)",
                    background: "var(--surface-raised)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attached.src}
                    alt="Attached reference"
                    style={{ width: 40, height: 40, objectFit: "cover", borderRadius: "var(--radius-sm)" }}
                  />
                  <button
                    type="button"
                    aria-label="Remove attached image"
                    onClick={() => {
                    if (attached?.src.startsWith("blob:")) URL.revokeObjectURL(attached.src);
                    setAttached(null);
                    setAttachError(null);
                  }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      lineHeight: 1,
                      padding: 0,
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Attach error */}
          {attachError && (
            <div
              style={{
                marginBottom: "var(--space-2)",
                fontSize: "var(--text-sm)",
                color: "var(--error-700)",
              }}
            >
              {attachError}
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
                justifyContent: "space-between",
                alignItems: "center",
                padding: "var(--space-2) var(--space-3)",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              {/* Attach image button */}
              <button
                type="button"
                aria-label="Attach reference image"
                disabled={isBusy || uploading}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: "none",
                  border: "none",
                  cursor: isBusy || uploading ? "default" : "pointer",
                  color: attached ? "var(--brand)" : "var(--text-muted)",
                  padding: "var(--space-1)",
                  display: "inline-flex",
                  alignItems: "center",
                  opacity: isBusy || uploading ? 0.5 : 1,
                }}
              >
                <ImageIcon size={18} />
              </button>
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

/** Avatar + flexible body row used for the inline plan card / result widgets
 *  (mirrors OttoConversation's MessageRow layout for GEN_CARD / GEN_RESULT). */
function WidgetRow({ children, animateIn }: { children: React.ReactNode; animateIn?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", ...(animateIn ? MSG_ENTER_STYLE : undefined) }}>
      <OttoAvatar size={32} state="idle" />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

export default OttoChatStream;
