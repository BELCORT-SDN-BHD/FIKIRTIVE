"use client";
import React, { useEffect, useRef, useState } from "react";
import { MSG_ENTER_STYLE } from "./parts/motion";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useStickToBottom } from "use-stick-to-bottom";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { threadToUiMessages, type OttoUiMessage } from "@/lib/otto-ui-messages";
import { ImageIcon } from "lucide-react";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import { ACCEPT_ATTACH, isVideoFile, defaultFrameTime, frameFileName, FRAME_MAX_SIDE, FRAME_JPEG_QUALITY, REF_VIDEO_MIN_SECONDS, REF_VIDEO_MAX_SECONDS, isRefVideoDurationOk } from "@/lib/video-frame";
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
import { PackCard } from "./PackCard";
import { StoryboardCard } from "./StoryboardCard";
import { OttoResult } from "./OttoResult";
import { TextPart } from "./parts/TextPart";
import { StatusLine } from "./parts/StatusLine";
import { OttoTrace } from "./OttoTrace";
import { ReasoningPart } from "./parts/ReasoningPart";
import { asStatusData, asErrorData, asStepData, deriveTraceSteps } from "@/lib/otto-status-helpers";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";
import type { OttoStatusData, OttoStepData } from "@/lib/otto-stream-bridge";
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
  pendingFirst?: { text: string; goalKey?: string; entityIds?: string[] };
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
  balanceUsd,
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
  /** Ordered agent step events for this turn (data-step) → the live OttoTrace. Reset per turn. */
  const [stepEvents, setStepEvents] = useState<OttoStepData[]>([]);
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
  /** Attachment: a generation created from a user-uploaded file, included as
   *  sourceGenerationId (image) or referenceVideoGenerationId (whole clip) on the
   *  next send. Null when nothing is attached. */
  const [attached, setAttached] = useState<{ generationId: string; src: string; kind: "image" | "refVideo" } | null>(null);
  /** True while the file is being hashed + uploaded + finalized. */
  const [uploading, setUploading] = useState(false);
  /** Upload error message shown near the attach button; clears on next successful attach. */
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoPick, setVideoPick] = useState<{ url: string; duration: number } | null>(null);
  const [frameTime, setFrameTime] = useState(0);
  // F28: only true once a frame has actually been drawn to the canvas (onSeeked), so "Use this
  // frame" can't attach a blank JPEG before the first paint.
  const [frameReady, setFrameReady] = useState(false);
  /** The original video File for the current videoPick — used by "Use whole video"
   *  to upload the clip itself (not an extracted frame). */
  const wholeVideoFileRef = useRef<File | null>(null);

  // Bounded in-flight poll for the async worker result (ported from OttoConversation):
  // a GEN_CARD whose genJobId is set but with no terminal GEN_RESULT/TURN_ERROR keeps
  // hasWorkingJob true; we poll the durable thread and inject the result when it lands.
  const POLL_MS = 2500;
  const MAX_POLLS = 48; // ~2 minutes
  const [pollGaveUp, setPollGaveUp] = useState(false);
  /** Set to true after the user has clicked "Check again" and the second MAX_POLLS round
   *  also exhausted — shows a terminal message instead of re-arming indefinitely. */
  const [pollTerminal, setPollTerminal] = useState(false);
  const pollCountRef = useRef(0);
  /** Track whether the user has already clicked "Check again" once (armed → gave up → terminal). */
  const checkAgainUsedRef = useRef(false);

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
        const ids = (body ?? {}) as { projectId?: string; threadId?: string; goalKey?: string; entityIds?: string[]; sourceGenerationId?: string; referenceVideoGenerationId?: string };
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
            ...(ids.referenceVideoGenerationId
              ? { referenceVideoGenerationId: ids.referenceVideoGenerationId }
              : ids.sourceGenerationId ? { sourceGenerationId: ids.sourceGenerationId } : {}),
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
      // data-step: a tool boundary — append to the ordered step list for the trace.
      const step = asStepData(part);
      if (step) { setStepEvents((prev) => [...prev, step]); return; }
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

  // Map genJobId → cardId so GEN_RESULT widgets can pass sourceCardId to OttoResult
  // for "Make another" (coworkVaryCard needs the card, not the job).
  const cardIdByJobId = new Map<string, string>();
  for (const m of messages) {
    const meta = m.metadata;
    if (meta?.kind === "GEN_CARD" && meta.genJobId && meta.durableId) {
      cardIdByJobId.set(meta.genJobId, meta.durableId);
    }
  }

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
    setPollTerminal(false);
    pollCountRef.current = 0;
    checkAgainUsedRef.current = false;
  }, [thread.id]);

  // Bounded poll: a worker that fails-closed without writing a terminal message would
  // otherwise keep hasWorkingJob true forever. After ~2 min we stop and show "Check again".
  // If the user clicks "Check again" and we exhaust again, show a terminal message
  // instead of looping forever (checkAgainUsedRef guards the second exhaustion).
  useEffect(() => {
    if (!hasWorkingJob || pollGaveUp) return;
    const t = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLLS) {
        if (checkAgainUsedRef.current) {
          // Second exhaustion after "Check again" → terminal, stop re-arming.
          setPollTerminal(true);
        }
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
      { body: { projectId, threadId: thread.id, ...(pendingFirst.goalKey ? { goalKey: pendingFirst.goalKey } : {}), ...(pendingFirst.entityIds?.length ? { entityIds: pendingFirst.entityIds } : {}) } }, // F30: carry entity conditioning into the first streamed turn
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
    setStepEvents([]);
    setStreamError(null);
    setStreamErrorKind(null);
    setAttachError(null);
    // A new turn may queue a new generation — re-arm polling (mirror OttoConversation).
    setPollGaveUp(false);
    setPollTerminal(false);
    pollCountRef.current = 0;
    checkAgainUsedRef.current = false;
    // Capture and clear the attachment before send. Revoke the local preview blob URL
    // (the source is the generationId, not the blob) so repeated attach/send doesn't leak.
    const attachedNow = attached;
    if (attachedNow?.src.startsWith("blob:")) URL.revokeObjectURL(attachedNow.src);
    setAttached(null);
    // Pass the live projectId/threadId, optional @mention entityIds, and optional
    // sourceGenerationId (attached image) or referenceVideoGenerationId (attached whole
    // clip) via the per-call body; prepareSendMessagesRequest reads them off `body` and
    // shapes the strict route payload.
    void sendMessage(
      { text: trimmed },
      {
        body: {
          projectId,
          threadId: thread.id,
          ...(entityIds.length ? { entityIds } : {}),
          ...(attachedNow?.kind === "refVideo"
            ? { referenceVideoGenerationId: attachedNow.generationId }
            : attachedNow ? { sourceGenerationId: attachedNow.generationId } : {}),
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

    // Video → open the frame picker instead of uploading the clip. A frame is
    // extracted in the browser and uploaded as an image through the same path.
    if (isVideoFile(file)) {
      if (videoPick) URL.revokeObjectURL(videoPick.url);
      const url = URL.createObjectURL(file);
      setVideoPick({ url, duration: 0 });
      wholeVideoFileRef.current = file;
      return;
    }

    // Image → existing behavior.
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
      setAttached({ generationId: res.generationIds[0], src: URL.createObjectURL(file), kind: "image" });
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // Called once the hidden <video> has its metadata: set duration + seek to the default frame.
  function handleVideoMeta() {
    const v = videoElRef.current;
    if (!v) return;
    // F28: MediaRecorder-produced webm reports Infinity/NaN duration until the browser is forced
    // to compute it. Seek past the end to trigger that; the real duration arrives via
    // onDurationChange (below) — without this the picker dead-ends (duration stays 0 → button
    // permanently disabled). ACCEPT_ATTACH explicitly allows video/webm, so this IS reachable.
    if (!Number.isFinite(v.duration) || v.duration <= 0) {
      v.currentTime = Number.MAX_SAFE_INTEGER;
      return;
    }
    const t = defaultFrameTime(v.duration);
    setVideoPick((p) => (p ? { ...p, duration: v.duration } : p));
    setFrameTime(t);
    v.currentTime = t;
  }

  // F28: once the forced seek resolves the real (finite) duration for a webm, record it and
  // seek back to the default frame (we're currently parked past the end).
  function handleDurationChange() {
    const v = videoElRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    setVideoPick((p) => (p && p.duration > 0 ? p : p ? { ...p, duration: v.duration } : p));
    if (v.currentTime > v.duration) {
      const t = defaultFrameTime(v.duration);
      setFrameTime(t);
      v.currentTime = t;
    }
  }

  // Draw the current video frame into the preview canvas (longest side capped).
  function drawCurrentFrame() {
    const v = videoElRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    setFrameReady(true); // a real frame is now on the canvas
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    setFrameTime(t);
    setFrameReady(false); // wait for the next onSeeked paint before allowing capture
    if (videoElRef.current) videoElRef.current.currentTime = t;
  }

  function closeVideoPick() {
    if (videoPick) URL.revokeObjectURL(videoPick.url);
    setVideoPick(null);
    setFrameTime(0);
    setFrameReady(false);
  }

  async function useSelectedFrame() {
    const c = canvasRef.current;
    if (!c) return;
    setUploading(true);
    try {
      const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/jpeg", FRAME_JPEG_QUALITY));
      if (!blob) { setAttachError("Couldn't capture that frame — try another moment."); return; }
      const file = new File([blob], frameFileName(frameTime), { type: "image/jpeg" });
      const preview = c.toDataURL("image/jpeg", FRAME_JPEG_QUALITY);
      const outcome = await uploadFilesDirect([file], () => {});
      if (outcome.files.length === 0) {
        setAttachError(outcome.failures[0]?.reason ?? "Upload failed.");
        return;
      }
      const r = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in r || !r.generationIds?.[0]) {
        setAttachError("error" in r ? r.error : "Could not attach frame.");
        return;
      }
      setAttached({ generationId: r.generationIds[0], src: preview, kind: "image" });
      closeVideoPick();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function useWholeVideo() {
    const v = videoElRef.current;
    if (!v || !isRefVideoDurationOk(v.duration)) {
      setAttachError(`Reference video must be ${REF_VIDEO_MIN_SECONDS}–${REF_VIDEO_MAX_SECONDS}s.`);
      return;
    }
    if (!wholeVideoFileRef.current) return;
    setUploading(true);
    try {
      const outcome = await uploadFilesDirect([wholeVideoFileRef.current], () => {});
      if (outcome.files.length === 0) { setAttachError(outcome.failures[0]?.reason ?? "Upload failed."); return; }
      const r = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in r || !r.generationIds?.[0]) { setAttachError("error" in r ? r.error : "Could not attach video."); return; }
      const preview = canvasRef.current?.toDataURL("image/jpeg", FRAME_JPEG_QUALITY) ?? "";
      setAttached({ generationId: r.generationIds[0], src: preview, kind: "refVideo" });
      closeVideoPick();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed.");
    } finally { setUploading(false); }
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
    if (e.key === "Enter" && e.shiftKey) {
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

  // leading-[1.5] — design-baseline body line-height (Analytics standard)
  return (
    <div className="gb leading-[1.5]" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
          .otto-chat-scroll { padding: 1rem 0.75rem !important; }
          .otto-chat-composer { padding: 0.75rem 0.75rem !important; }
          .otto-chat-header { padding: 0.75rem 1rem !important; }
        }
      `}</style>
      {/* Header */}
      <div
        className="otto-chat-header flex items-center gap-[9px] border-b border-border bg-card px-4 py-[13px]"
      >
        <OttoAvatar size={22} state={isBusy ? "thinking" : "idle"} />
        <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.90625rem] font-semibold text-foreground">
          {thread.title}
        </div>
      </div>

      {/* Messages (stick-to-bottom scroll region) */}
      <div
        ref={scrollRef}
        className="otto-chat-scroll relative flex-1 overflow-auto p-4"
      >
        <div
          ref={contentRef}
          className="mx-auto flex max-w-[680px] flex-col gap-[14px]"
        >
          {(() => {
            // Pre-pass: coalesce consecutive GEN_CARD messages that share the same
            // non-empty packId into a single pack group. Non-pack GEN_CARDs (packId
            // absent or empty) and all other message kinds pass through unchanged.
            type RenderItem =
              | { type: "pack"; packId: string; packTitle: string; msgs: typeof messages; animateIn: boolean }
              | { type: "single"; m: (typeof messages)[number]; mi: number };

            const renderItems: RenderItem[] = [];
            let i = 0;
            while (i < messages.length) {
              const m = messages[i];
              const kind = m.metadata?.kind;
              const payload = m.metadata?.payload as Record<string, unknown> | undefined;

              // Storyboard first-frame child GEN_CARDs render INSIDE their parent
              // StoryboardCard (thumbnails), not as standalone cards in the chat.
              // Skip them here — polling (hasWorkingJob) reads the raw messages array,
              // so hiding the render leaves the child's job unaffected.
              const isStoryboardChild = kind === "GEN_CARD" && typeof payload?.storyboardCardId === "string";
              if (isStoryboardChild) {
                i++;
                continue;
              }

              const packId = kind === "GEN_CARD" && payload?.packId && typeof payload.packId === "string" ? payload.packId : null;

              if (packId) {
                // Collect the consecutive run of GEN_CARDs with the same packId.
                const packMsgs = [m];
                const packTitle = typeof payload?.packTitle === "string" ? payload.packTitle : "Pack";
                const animateIn = isNewMessage(m.id);
                let j = i + 1;
                while (j < messages.length) {
                  const next = messages[j];
                  const np = next.metadata?.payload as Record<string, unknown> | undefined;
                  if (next.metadata?.kind === "GEN_CARD" && np?.packId === packId) {
                    packMsgs.push(next);
                    j++;
                  } else {
                    break;
                  }
                }
                renderItems.push({ type: "pack", packId, packTitle, msgs: packMsgs, animateIn });
                i = j;
              } else {
                renderItems.push({ type: "single", m, mi: i });
                i++;
              }
            }

            return renderItems.map((item) => {
              if (item.type === "pack") {
                const { packId, packTitle, msgs, animateIn } = item;
                const packCards = msgs.map((m) => {
                  const genJobId = m.metadata?.genJobId ?? null;
                  const durableId = m.metadata!.durableId;
                  return {
                    cardId: durableId,
                    payload: m.metadata?.payload,
                    threadId: thread.id,
                    genJobId,
                    cardState: deriveCardState({
                      genJobId,
                      submitted: submittedCardIds.has(durableId),
                      results: jobsWithResult,
                      errors: jobsWithError,
                    }),
                    pendingApproval: pendingApprovalCardIds.has(durableId),
                  };
                });
                const packApproved = () => {
                  msgs.forEach((m) => {
                    const durableId = m.metadata!.durableId;
                    setSubmittedCardIds((cur) => new Set(cur).add(durableId));
                    setPendingApprovalCardIds((cur) => {
                      const next = new Set(cur);
                      next.delete(durableId);
                      return next;
                    });
                  });
                  setPollGaveUp(false);
                  pollCountRef.current = 0;
                  void onBalanceRefresh?.();
                  void pollAndInjectResults();
                };
                return (
                  <WidgetRow key={`pack:${packId}`} animateIn={animateIn}>
                    <PackCard
                      packTitle={packTitle}
                      cards={packCards}
                      balanceUsd={balanceUsd}
                      onApproved={packApproved}
                    />
                  </WidgetRow>
                );
              }

              // Single message render (unchanged from original).
              const { m, mi } = item;
              const isLastMessage = mi === messages.length - 1;
              const kind = m.metadata?.kind;

              // Defensive double-guard: a storyboard first-frame child is already
              // dropped in the pre-pass, but never render one even if it reaches here.
              if (kind === "GEN_CARD" && typeof (m.metadata?.payload as Record<string, unknown> | undefined)?.storyboardCardId === "string") {
                return null;
              }

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
                    genJobId={genJobId}
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
                    onRetry={() => {
                      // A fresh card was spawned — re-arm poll and refetch so it appears.
                      // Reset checkAgainUsedRef too: the retried job gets the full two-round
                      // stall budget, not a one-round dead-end from an earlier "Check again".
                      setPollGaveUp(false);
                      setPollTerminal(false);
                      pollCountRef.current = 0;
                      checkAgainUsedRef.current = false;
                      void pollAndInjectResults();
                    }}
                    onCancelled={() => void pollAndInjectResults()}
                  />
                </WidgetRow>
              );
            }

            if (kind === "GEN_RESULT") {
              const r = (m.metadata?.payload ?? null) as
                | { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; costUsd?: number }
                | null;
              const sourceCardId = m.metadata?.genJobId ? cardIdByJobId.get(m.metadata.genJobId) : undefined;
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoResult
                    payload={r}
                    sourceCardId={sourceCardId}
                    onMakeAnother={() => {
                      setPollGaveUp(false);
                      pollCountRef.current = 0;
                      void pollAndInjectResults();
                    }}
                  />
                </WidgetRow>
              );
            }

            if (kind === "DENIAL" || kind === "TURN_ERROR") {
              return (
                <div key={m.id} className="flex items-start gap-3" style={isNewMessage(m.id) ? MSG_ENTER_STYLE : undefined}>
                  <OttoAvatar size={26} state="idle" />
                  <div className="rounded-[5px_14px_14px_14px] bg-error-soft px-[13px] py-[10px] text-[0.875rem] leading-normal text-[var(--error-soft-foreground)]">
                    {/* DENIAL/TURN_ERROR carry their user-facing copy on the durable
                        message text, which threadToUiMessages put into the text part. */}
                    {(m.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text}
                  </div>
                </div>
              );
            }

            if (kind === "STORYBOARD_CARD") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <StoryboardCard
                    cardId={m.metadata!.durableId}
                    payload={m.metadata?.payload}
                    balanceUsd={balanceUsd}
                    onBalanceRefresh={() => void onBalanceRefresh?.()}
                  />
                </WidgetRow>
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
            }); // end renderItems.map
          })()} {/* end IIFE */}

          {/* OTTO's live step-trace — the agent narrating its tool calls (display-only). */}
          {stepEvents.length > 0 && (
            <div className="my-2 mb-3">
              <OttoTrace steps={deriveTraceSteps(stepEvents, liveStatus)} />
            </div>
          )}

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
            <div className="flex items-start gap-3" style={MSG_ENTER_STYLE}>
              <OttoAvatar size={26} state="idle" />
              <div className="rounded-[5px_14px_14px_14px] border border-border bg-card px-4 py-3 text-[0.875rem] text-foreground">
                {liveStatus.text}
              </div>
            </div>
          )}

          {/* Async generation in progress: a card was approved (genJobId set) and the
              worker hasn't written a terminal result yet. Ported from OttoConversation. */}
          {!isBusy && hasWorkingJob && !pollGaveUp && (
            <div className="flex items-start gap-3">
              <OttoAvatar size={26} state="thinking" />
              <div className="rounded-[5px_14px_14px_14px] border border-border bg-card px-4 py-3 text-[0.875rem] italic text-muted-foreground">
                Otto is making this — this can take a moment…
              </div>
            </div>
          )}

          {!isBusy && hasWorkingJob && pollGaveUp && !pollTerminal && (
            <div className="flex items-start gap-3">
              <OttoAvatar size={26} state="idle" />
              <div className="rounded-[5px_14px_14px_14px] border border-border bg-card px-4 py-3 text-[0.875rem] text-foreground">
                This is taking longer than usual. Your credits for this are on hold — if it doesn&rsquo;t finish, they&rsquo;re returned to you automatically.{" "}
                <button
                  type="button"
                  onClick={() => {
                    checkAgainUsedRef.current = true;
                    setPollGaveUp(false);
                    pollCountRef.current = 0;
                    void pollAndInjectResults();
                  }}
                  className="border-0 bg-transparent p-0 text-primary font-semibold cursor-pointer underline"
                >
                  Check again
                </button>
              </div>
            </div>
          )}

          {!isBusy && hasWorkingJob && pollTerminal && (
            <div className="flex items-start gap-3">
              <OttoAvatar size={26} state="idle" />
              <div className="rounded-[5px_14px_14px_14px] border border-border bg-card px-4 py-3 text-[0.875rem] text-foreground">
                This looks stuck. Cancel it on the card to get your credits back, or start a new card.
              </div>
            </div>
          )}

          {/* data-error: stays visible after the turn ends — it's the only user
              feedback when the route errors before persisting an assistant message
              (insufficient_credits / run errors surfaced via data-error parts). */}
          {streamError && (
            <div
              role="alert"
              className="rounded-[14px] bg-error-soft px-4 py-3 text-[0.875rem] text-[var(--error-soft-foreground)]"
            >
              {streamError}
              {streamErrorKind === "insufficient_credits" && (
                <>
                  {" "}
                  <a
                    href="/billing"
                    className="font-semibold text-[var(--error-soft-foreground)] underline"
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
              className="rounded-[14px] bg-error-soft px-4 py-3 text-[0.875rem] text-[var(--error-soft-foreground)]"
            >
              {error?.message || "Otto hit a snag — please try again."}
            </div>
          )}
        </div>

        {!isAtBottom && (
          <div className="sticky bottom-4 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={() => void scrollToBottom()}
              aria-label="Scroll to bottom"
              className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-2 shadow-sm text-[0.875rem] text-foreground cursor-pointer"
            >
              ↓ Scroll to bottom
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        className="otto-chat-composer border-t border-border bg-card p-3"
      >
        <div className="relative mx-auto max-w-[680px]">
          {mentionSuggestions.length > 0 && (
            <div
              role="listbox"
              className="absolute bottom-full left-0 mb-1 w-64 overflow-hidden rounded-[14px] border border-border bg-card shadow-lg z-50"
            >
              {mentionSuggestions.map((e, i) => (
                <button
                  key={e.id}
                  role="option"
                  aria-selected={i === mentionHighlight}
                  onMouseDown={(ev) => { ev.preventDefault(); selectMention(e); }}
                  className="block w-full cursor-pointer border-none bg-transparent px-3 py-2 text-left text-[0.875rem] text-foreground"
                  style={{ background: i === mentionHighlight ? "var(--accent)" : "transparent" }}
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
            accept={ACCEPT_ATTACH}
            className="hidden"
            onChange={handleFilePick}
          />

          {/* Video frame picker: pick a frame to use as the image reference */}
          {videoPick && (
            <div className="mb-2 rounded-[14px] border border-border bg-muted p-2">
              <video
                ref={videoElRef}
                src={videoPick.url}
                muted
                playsInline
                preload="metadata"
                className="hidden"
                onLoadedMetadata={handleVideoMeta}
                onDurationChange={handleDurationChange}
                onSeeked={drawCurrentFrame}
                onError={() => { setAttachError("Couldn't read that video — try an MP4."); closeVideoPick(); }}
              />
              <canvas ref={canvasRef} className="mb-2 max-h-40 w-full rounded-[10px] object-contain" />
              {videoPick.duration > 0 && (
                <input
                  type="range"
                  min={0}
                  max={videoPick.duration}
                  step={0.05}
                  value={frameTime}
                  onChange={handleScrub}
                  aria-label="Pick a video frame"
                  className="w-full"
                />
              )}
              {videoPick.duration > 0 && !isRefVideoDurationOk(videoPick.duration) && (
                <div className="text-[0.8rem] text-muted-foreground">Whole-video reference needs a {REF_VIDEO_MIN_SECONDS}–{REF_VIDEO_MAX_SECONDS}s clip.</div>
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={closeVideoPick} disabled={uploading}>Cancel</Button>
                <Button variant="default" size="sm" onClick={useWholeVideo} disabled={uploading || !isRefVideoDurationOk(videoPick.duration)}>
                  {uploading ? "Attaching…" : "Use whole video"}
                </Button>
                {/* F28: gated on frameReady — the whole-video button above doesn't need it
                    (it uploads the original file, not the canvas frame). */}
                <Button variant="default" size="sm" onClick={useSelectedFrame} disabled={uploading || videoPick.duration === 0 || !frameReady}>
                  {uploading ? "Attaching…" : "Use this frame"}
                </Button>
              </div>
            </div>
          )}

          {/* Thumbnail chip: shown while uploading or when an image is attached */}
          {(uploading || attached) && (
            <div className="mb-2 flex items-center gap-2">
              {uploading ? (
                <div className="inline-flex items-center gap-2 rounded-[14px] border border-border bg-muted px-2 py-1 text-[0.875rem] text-muted-foreground">
                  attaching…
                </div>
              ) : attached ? (
                <div className="inline-flex items-center gap-2 rounded-[14px] border border-border bg-muted px-2 py-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attached.src}
                    alt="Attached reference"
                    className="h-10 w-10 rounded-[7px] object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove attached image"
                    onClick={() => {
                    if (attached?.src.startsWith("blob:")) URL.revokeObjectURL(attached.src);
                    setAttached(null);
                    setAttachError(null);
                  }}
                    className="border-0 bg-transparent p-0 text-[0.875rem] text-muted-foreground cursor-pointer leading-none"
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Attach error */}
          {attachError && (
            <div className="mb-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
              {attachError}
            </div>
          )}

          <div className="overflow-hidden rounded-[14px] border-[1.5px] border-border bg-background shadow-sm">
            <textarea
              id="otto-composer"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={isBusy}
              placeholder="Reply to Otto…"
              rows={2}
              className="w-full resize-none border-0 bg-transparent px-4 py-3 text-[0.90625rem] text-foreground outline-none leading-normal"
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              {/* Attach image button */}
              <button
                type="button"
                aria-label="Attach reference image"
                disabled={isBusy || uploading || !!videoPick}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center border-0 bg-transparent p-1 cursor-pointer disabled:cursor-default disabled:opacity-50"
                style={{ color: attached ? "var(--primary)" : undefined }}
              >
                <ImageIcon size={18} className={attached ? "text-primary" : "text-muted-foreground"} />
              </button>
              <Button variant="default" size="sm" disabled={isBusy || !text.trim()} onClick={submit}>
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
    <div className="flex items-start gap-[9px]" style={animateIn ? MSG_ENTER_STYLE : undefined}>
      <OttoAvatar size={26} state="idle" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default OttoChatStream;
