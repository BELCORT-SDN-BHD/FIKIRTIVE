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
import { ImageIcon, MessageSquarePlus } from "lucide-react";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import { ACCEPT_ATTACH, isVideoFile, defaultFrameTime, frameFileName, FRAME_MAX_SIDE, FRAME_JPEG_QUALITY, REF_VIDEO_MIN_SECONDS, REF_VIDEO_MAX_SECONDS, isRefVideoDurationOk } from "@/lib/video-frame";
import {
  resultJobIds,
  errorJobIds,
  cancelledJobIds as durablyCancelledJobIds,
  cancelledTurnPayload,
  deriveCardState,
  hasWorkingJob as computeHasWorkingJob,
  cardIdsOf,
  injectCardMessage,
  appendMissingCards,
  appendResearchReports,
  syncCardJobIds,
} from "@/lib/otto-inject-helpers";
import { mergeDurableIntoLive, nextPendingApprovalCardIds, type PackApprovalOutcome } from "./approval-chain";
import { OttoPlanCard } from "./OttoPlanCard";
import { OttoActionPlanCard } from "./OttoActionPlanCard";
import { OttoApprovalCard } from "./OttoApprovalCard";
import { OttoAdBuildCard } from "./OttoAdBuildCard";
import { PackCard } from "./PackCard";
import { StoryboardCard } from "./StoryboardCard";
import { ResearchCard } from "./ResearchCard";
import { ResearchReport } from "./ResearchReport";
import { PerformanceCard } from "./PerformanceCard";
import { OttoResult } from "./OttoResult";
import { TextPart } from "./parts/TextPart";
import { StatusLine } from "./parts/StatusLine";
import { OttoTrace } from "./OttoTrace";
import { ReasoningPart } from "./parts/ReasoningPart";
import { OttoStreamErrorNotice } from "./OttoStreamErrorNotice";
import {
  asStatusData,
  asErrorData,
  asStepData,
  dataErrorOf,
  deriveTraceSteps,
  persistedStreamErrorOf,
  persistedStreamErrorUserMessageId,
  shouldShowTracePanel,
  turnCostOf,
} from "@/lib/otto-status-helpers";
import { creditsLabel } from "@/lib/credit-format";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";
import type { OttoErrorData, OttoStatusData, OttoStepData } from "@/lib/otto-stream-bridge";
import type { ReasoningUIPart } from "ai";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import { composerReferencePayload, composerReferencesPlaceholder, removeComposerReference, upsertComposerReference, upsertComposerReferences, type OttoComposerReference } from "@/lib/canvas-chat-reference";

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
  /** Starts a new conversation in this project. Rendered as a persistent button
   *  in the chat header, so it's always reachable — not only via a sidebar hover. */
  onNewConversation?: () => void;
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
  /** Canvas-selected image/video references to attach to the next Otto message. */
  composerReferences?: OttoComposerReference[] | null;
  /** Clears the parent handoff once this stream has copied it into local composer state. */
  onComposerReferencesConsumed?: (requestIds: string[]) => void;
}

type AttachedReference = Omit<OttoComposerReference, "requestId">;

function revokeAttachedPreview(ref: AttachedReference | null): void {
  if (ref?.src.startsWith("blob:")) URL.revokeObjectURL(ref.src);
}

function revokeAttachedPreviews(refs: AttachedReference[]): void {
  refs.forEach(revokeAttachedPreview);
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
  onNewConversation,
  onThreadUpdate,
  onBalanceRefresh,
  pendingFirst,
  onPendingFirstSent,
  composerReferences,
  onComposerReferencesConsumed,
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
  const [streamErrorKind, setStreamErrorKind] = useState<OttoErrorData["kind"] | null>(null);
  const [retryDraft, setRetryDraft] = useState<string | null>(null);
  /** Card ids the run paused on (needs_approval) — drives OttoPlanCard's parked vs.
   *  proposed spend path. Mirrors OttoConversation's pendingApprovalCardIds set. */
  const [pendingApprovalCardIds, setPendingApprovalCardIds] = useState<Set<string>>(new Set());
  /** Card durableIds for which the user has clicked "Make it" (or "Try again") in this
   *  session — drives the optimistic "working" state before the genJobId lands from the
   *  durable thread. Resets on remount (thread switch = component re-key). */
  const [submittedCardIds, setSubmittedCardIds] = useState<Set<string>>(new Set());
  /** Jobs cancelled in this client session. The server refund path does not persist a
   *  TURN_ERROR message, so treat these job ids as terminal for the local poll. */
  const [cancelledJobIds, setCancelledJobIds] = useState<Set<string>>(new Set());
  /** Attachments: generations created from user uploads or canvas selections,
   *  included as sourceGenerationIds / referenceVideoGenerationIds on the next send. */
  const [attachedRefs, setAttachedRefs] = useState<AttachedReference[]>([]);
  /** True while the file is being hashed + uploaded + finalized. */
  const [uploading, setUploading] = useState(false);
  /** Upload error message shown near the attach button; clears on next successful attach. */
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSubmittedTextRef = useRef("");
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
  const seenComposerReferenceIdsRef = useRef<Set<string>>(new Set());

  // Bounded in-flight poll for the async worker result (ported from OttoConversation):
  // a GEN_CARD whose genJobId is set but with no terminal GEN_RESULT/TURN_ERROR keeps
  // hasWorkingJob true; we poll the durable thread and inject the result when it lands.
  const POLL_MS = 2500;
  const MAX_POLLS = 48; // ~2 minutes
  const [pollGaveUp, setPollGaveUp] = useState(false);
  /** Set to true after the user has clicked "Check again" and the second MAX_POLLS round
   *  also exhausted — shows a terminal message instead of re-arming indefinitely. */
  const [pollTerminal, setPollTerminal] = useState(false);
  const [pollRound, setPollRound] = useState<"initial" | "retry">("initial");
  /** Monotonic re-arm token. Bumped on every rearm so the bounded-poll effect below
   *  ALWAYS re-runs (resetting its local pollCount to 0), even when pollGaveUp /
   *  pollTerminal / pollRound are already at their reset values — otherwise React
   *  bails out and a mid-flight poll window carries its spent budget into a
   *  freshly-approved generation, showing "Check again" early. */
  const [pollNonce, setPollNonce] = useState(0);

  function rearmGenerationPoll() {
    setPollGaveUp(false);
    setPollTerminal(false);
    setPollRound("initial");
    setPollNonce((n) => n + 1);
  }

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
        const ids = (body ?? {}) as {
          projectId?: string;
          threadId?: string;
          goalKey?: string;
          entityIds?: string[];
          sourceGenerationId?: string;
          sourceGenerationIds?: string[];
          referenceVideoGenerationId?: string;
          referenceVideoGenerationIds?: string[];
        };
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
            ...(ids.sourceGenerationIds?.length ? { sourceGenerationIds: ids.sourceGenerationIds } : {}),
            ...(ids.sourceGenerationId ? { sourceGenerationId: ids.sourceGenerationId } : {}),
            ...(ids.referenceVideoGenerationIds?.length ? { referenceVideoGenerationIds: ids.referenceVideoGenerationIds } : {}),
            ...(ids.referenceVideoGenerationId ? { referenceVideoGenerationId: ids.referenceVideoGenerationId } : {}),
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
  const [initialIds] = useState(() => new Set(chatInit.messages.map((m) => m.id)));
  const isNewMessage = (id: string) => !initialIds.has(id);

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
        // ChainedApproval.pendingCardIds contract (#498 round-7): the streamed
        // needs_approval carries the COMPLETE set of the thread's parked calls
        // (stream/route.ts passes finalized.pendingCardIds through whole), so it
        // REPLACES the local set — an id the server no longer reports is
        // resolved/expired/superseded, and keeping it would be a stale private
        // ledger. No card fired here, hence the empty approvedCardIds; a
        // malformed part without the array carries no set information and via
        // the same helper leaves the set unchanged.
        if (s.kind === "needs_approval") {
          setPendingApprovalCardIds((cur) => nextPendingApprovalCardIds(cur, [], s.pendingCardIds));
        }
        return;
      }
      const e = asErrorData(part);
      if (e) {
        setStreamError(e.text);
        setStreamErrorKind(e.kind);
        setRetryDraft(e.kind === "error" ? lastSubmittedTextRef.current || null : null);
        return;
      }
      // data-tool-propose: a card tool (propose / proposePack / propose-meta-action /
      // propose-ad-build) persisted durable card(s) synchronously, but the stream part
      // carries only the id(s). Fetch the durable thread ONCE and inject each card
      // (full payload) into the message list, deduped by durableId (F23).
      const cardIds = cardIdsOf(part);
      if (cardIds.length > 0) {
        void (async () => {
          const fresh = await getCoworkThreadClient(thread.id);
          if (fresh) {
            setMessages((cur) =>
              cardIds.reduce((acc, id) => injectCardMessage(acc, fresh, id), cur),
            );
          }
        })();
      }
    },
    onFinish: () => {
      // Sync the parent thread list + make reload authoritative. Non-blocking.
      // Safety net (F23): backfill any card-kind durable the live stream missed
      // (e.g. a dropped data-tool-propose part) so cards never need a reload.
      void (async () => {
        const fresh = await getCoworkThreadClient(thread.id);
        if (fresh) {
          onThreadUpdate(fresh);
          setMessages((cur) => appendMissingCards(cur, fresh));
        }
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

  // The turn's step trace. The stream error is passed in so a turn that ended on a
  // data-error stops its unfinished steps instead of spinning forever (P1-3).
  const traceSteps = deriveTraceSteps(
    stepEvents,
    liveStatus,
    streamErrorKind ? { kind: streamErrorKind, text: streamError ?? "" } : null,
  );

  // Derived from the rendered messages (which carry durable metadata): which jobs
  // already have a result (so the card doesn't also render a dupe result), and
  // whether any approved job is still working (drives the poll + queued state).
  const jobsWithResult = resultJobIds(messages);
  const jobsWithError = errorJobIds(messages);
  // A cancel and a failure land on the SAME durable message kind, so the card needs this second
  // set to tell them apart after a reload (#602 T3).
  const jobsCancelled = durablyCancelledJobIds(messages);
  const hasWorkingJob = computeHasWorkingJob(messages, cancelledJobIds);

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
  // (GEN_RESULT / TURN_ERROR) AND any card-kind durables missing from the list
  // into the useChat list, deduped by durableId. Streamed TEXT is never
  // re-injected; the ONLY TEXTs appended are the chained-park narration ids the
  // server returned (#498 round-5 P2c — a server action streams nothing, so
  // without this the model's narration hid until a reload). Cards matter here
  // (#498 round-4): a chained ottoApprove re-park persists NEW GEN_CARDs via a
  // server action (no live stream part), so the post-approve poll is what makes
  // them render.
  async function pollAndInjectResults(narrationMessageIds?: readonly string[]) {
    const fresh = await getCoworkThreadClient(thread.id);
    if (!fresh) return;
    const prevResultCount = messages.filter(
      (m) => m.metadata?.kind === "GEN_RESULT" || m.metadata?.kind === "TURN_ERROR",
    ).length;
    setMessages((cur) => mergeDurableIntoLive(cur, fresh, narrationMessageIds));
    onThreadUpdate(fresh);
    // A new terminal result landed → a generation settled and credits were spent.
    const freshResultCount = fresh.messages.filter(
      (m) => m.kind === "GEN_RESULT" || m.kind === "TURN_ERROR",
    ).length;
    if (freshResultCount > prevResultCount) void onBalanceRefresh?.();
  }

  async function refetchAndAppendCards() {
    const fresh = await getCoworkThreadClient(thread.id);
    if (!fresh) return;
    setMessages((cur) => appendMissingCards(syncCardJobIds(cur, fresh), fresh));
    onThreadUpdate(fresh);
  }

  async function refetchAndAppendResearchReports() {
    const fresh = await getCoworkThreadClient(thread.id);
    if (!fresh) return;
    setMessages((cur) => appendResearchReports(cur, fresh));
    onThreadUpdate(fresh);
  }

  // Reset the give-up state whenever we switch threads (mirror OttoConversation).
  // Guarded by a prev-id ref so the reset runs only on an actual thread change, not
  // on the mount render (where the state is already fresh) — avoids a cascading render.
  const prevThreadIdRef = useRef(thread.id);
  useEffect(() => {
    if (prevThreadIdRef.current === thread.id) return;
    prevThreadIdRef.current = thread.id;
    rearmGenerationPoll();
  }, [thread.id]);

  // Bounded poll: a worker that fails-closed without writing a terminal message would
  // otherwise keep hasWorkingJob true forever. After ~2 min we stop and show "Check again".
  // If the user clicks "Check again" and we exhaust again, show a terminal message
  // instead of looping forever (pollRound tracks the second exhaustion).
  useEffect(() => {
    if (!hasWorkingJob || pollGaveUp) return;
    let pollCount = 0;
    const t = setInterval(() => {
      pollCount += 1;
      if (pollCount >= MAX_POLLS) {
        if (pollRound === "retry") {
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
  }, [hasWorkingJob, thread.id, pollGaveUp, pollRound, pollNonce]);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();

  // Streaming front door: auto-send the first message ONCE into the empty thread.
  // The per-mount ref guards against double-send; onPendingFirstSent clears the
  // parent's pendingFirst so a later remount (switch away + back) never re-fires.
  const pendingSentRef = useRef(false);
  useEffect(() => {
    if (!pendingFirst || pendingSentRef.current) return;
    pendingSentRef.current = true;
    lastSubmittedTextRef.current = pendingFirst.text;
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
    lastSubmittedTextRef.current = trimmed;
    setText(""); // clear the composer immediately; sendMessage echoes the user msg
    setPickedMentions([]);
    // Reset ephemeral stream state for the new turn.
    setLiveStatus(null);
    setStepEvents([]);
    setStreamError(null);
    setStreamErrorKind(null);
    setRetryDraft(null);
    setAttachError(null);
    // A new turn may queue a new generation — re-arm polling (mirror OttoConversation).
    rearmGenerationPoll();
    // Capture and clear attachments before send. Revoke local preview blob URLs
    // (the source is the generationId, not the blob) so repeated attach/send doesn't leak.
    const attachedNow = attachedRefs;
    revokeAttachedPreviews(attachedNow);
    setAttachedRefs([]);
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
          ...composerReferencePayload(attachedNow),
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
      setAttachedRefs((current) => upsertComposerReference(current, { generationId: res.generationIds[0], src: URL.createObjectURL(file), kind: "image", previewKind: "image", label: "Image ref" }));
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

  useEffect(() => {
    const incoming = (composerReferences ?? []).filter((ref) => ref.requestId && !seenComposerReferenceIdsRef.current.has(ref.requestId));
    if (incoming.length === 0) return;
    incoming.forEach((ref) => {
      if (ref.requestId) seenComposerReferenceIdsRef.current.add(ref.requestId);
    });
    setAttachError(null);
    setUploading(false);
    setVideoPick((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setFrameTime(0);
    setFrameReady(false);
    wholeVideoFileRef.current = null;
    setAttachedRefs((prev) => upsertComposerReferences(prev, incoming.map((ref) => ({
      generationId: ref.generationId,
      src: ref.src,
      kind: ref.kind,
      previewKind: ref.previewKind,
      label: ref.label,
    }))));
    window.requestAnimationFrame(() => {
      document.getElementById("otto-composer")?.focus();
    });
    onComposerReferencesConsumed?.(incoming.map((ref) => ref.requestId!).filter(Boolean));
  }, [composerReferences, onComposerReferencesConsumed]);

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
      setAttachedRefs((current) => upsertComposerReference(current, { generationId: r.generationIds[0], src: preview, kind: "image", previewKind: "image", label: "Image ref" }));
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
      setAttachedRefs((current) => upsertComposerReference(current, { generationId: r.generationIds[0], src: preview, kind: "refVideo", previewKind: "image", label: "Video ref" }));
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
          .otto-send-hint { display: none; }
        }
      `}</style>
      {/* Header — New conversation is always visible here, not only on a sidebar hover. */}
      <div
        className="otto-chat-header flex items-center gap-[9px] border-b border-border bg-card px-4 py-[13px]"
      >
        <OttoAvatar size={22} state={isBusy ? "thinking" : "idle"} />
        <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.90625rem] font-semibold text-foreground">
          {thread.title}
        </div>
        {onNewConversation && (
          <button
            type="button"
            onClick={onNewConversation}
            title="Start a new conversation in this project"
            aria-label="New conversation"
            className="inline-flex shrink-0 items-center gap-[6px] rounded-[9px] border border-border bg-transparent px-[10px] py-[6px] text-[0.8125rem] font-medium text-foreground cursor-pointer transition-colors hover:bg-secondary"
          >
            <MessageSquarePlus size={14} aria-hidden />
            New conversation
          </button>
        )}
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
                      cancelled: jobsCancelled,
                    }),
                    pendingApproval: pendingApprovalCardIds.has(durableId),
                  };
                });
                const packApproved = (outcome: PackApprovalOutcome) => {
                  // #498 round-5: parent state derives from the SAME server-sourced
                  // outcome the pack loop ran on — never a parent-side re-derivation.
                  const stillPending = new Set(outcome.pendingCardIds);
                  // Submitted = actually fired AND not re-reported pending. A card the
                  // server reports as STILL pending must not be marked submitted —
                  // that would render it "working" and bury its approve gate; a card
                  // the loop never reached stays exactly as it was.
                  setSubmittedCardIds((cur) => {
                    const next = new Set(cur);
                    outcome.firedCardIds.forEach((id) => { if (!stillPending.has(id)) next.add(id); });
                    return next;
                  });
                  // ChainedApproval.pendingCardIds contract (#498 round-7): a
                  // server-anchored outcome carries the COMPLETE thread set and
                  // REPLACES ours (stale ids leave; a re-park's cards render
                  // pendingApproval=true so their clicks resume via ottoApprove,
                  // never coworkGenerate). A pack-scoped outcome (no resume
                  // response spoke) only clears the fired cards.
                  setPendingApprovalCardIds((cur) =>
                    nextPendingApprovalCardIds(
                      cur,
                      outcome.firedCardIds,
                      outcome.pendingFromServer ? outcome.pendingCardIds : undefined,
                    ),
                  );
                  rearmGenerationPoll();
                  void onBalanceRefresh?.();
                  // The poll also injects any chained-park narration live (P2c).
                  void pollAndInjectResults(outcome.narrationMessageIds);
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
                      cancelled: jobsCancelled,
                    })}
                    pendingApproval={pendingApprovalCardIds.has(durableId)}
                    onApproved={({ cardId: approvedCardId, chained }) => {
                      // The card hands up WHICH card this was and the SERVER's result —
                      // both facts come from the response, not from this closure (P1-4).
                      // Record submission so the card flips to queued optimistically —
                      // unless the server reports THIS card as still pending (chained).
                      if (!chained?.pendingCardIds.includes(approvedCardId)) {
                        setSubmittedCardIds((cur) => new Set(cur).add(approvedCardId));
                      }
                      // A chained response's COMPLETE set replaces ours; otherwise only
                      // the fired card leaves (ChainedApproval.pendingCardIds contract).
                      // A re-park's cards must render pendingApproval=true so their
                      // clicks resume the RunState via ottoApprove, never coworkGenerate.
                      // The waiting panel's visibility falls out of THIS set, so the new
                      // set is taken from the server response first and the panel decides
                      // afterwards — never hidden ahead of the answer (P1-4).
                      // Re-arm the poll (a freshly-approved card queues a new job even if
                      // a prior job hit the give-up cap; the poll also appends the
                      // chained cards themselves — see pollAndInjectResults).
                      setPendingApprovalCardIds((cur) =>
                        nextPendingApprovalCardIds(cur, [approvedCardId], chained?.pendingCardIds),
                      );
                      rearmGenerationPoll();
                      // No balance announcement here: OttoPlanCard.approve() already makes it
                      // in its own finally, which fires on the failure paths too. Announcing
                      // again from this success-only callback just double-read the balance
                      // (round-2 review P2) — one action, one announcement.
                      // #498 round-5 P2c: inject the chained park's model narration live.
                      void pollAndInjectResults(
                        chained?.narrationMessageId ? [chained.narrationMessageId] : undefined,
                      );
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
                      // Reset the poll round too: the retried job gets the full two-round
                      // stall budget, not a one-round dead-end from an earlier "Check again".
                      rearmGenerationPoll();
                      void refetchAndAppendCards();
                    }}
                    onCancelled={() => {
                      if (genJobId) setCancelledJobIds((cur) => new Set(cur).add(genJobId));
                      // Same as onApproved above: the card's own cancel() finally announces.
                      void pollAndInjectResults();
                    }}
                  />
                </WidgetRow>
              );
            }

            // Meta approval-flow cards (F23) — mirror OttoConversation's branches.
            // The approve buttons inside call the existing gated server actions
            // (approveMetaActionPlan / approveAdBuild); this only renders them.
            if (kind === "ACTION_CARD") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoActionPlanCard cardId={m.metadata!.durableId} payload={m.metadata?.payload} />
                </WidgetRow>
              );
            }

            if (kind === "BUILD_CARD") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoAdBuildCard cardId={m.metadata!.durableId} payload={m.metadata?.payload} />
                </WidgetRow>
              );
            }

            // Universal approval card (B4 debt-70) — a non-generate gated skill parked for the
            // user's consent. Confirm/Decline call ottoApprove/ottoReject inside the card.
            if (kind === "APPROVAL_CARD") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoApprovalCard
                    cardId={m.metadata!.durableId}
                    threadId={thread.id}
                    payload={m.metadata?.payload}
                    onResolved={({ cardId: resolvedCardId, pendingCardIds }) => {
                      // A universal approval settles a parked call too, so it must move
                      // this thread's pending set — otherwise the waiting panel keeps
                      // asking for a go-ahead that was already given (P1-4).
                      setPendingApprovalCardIds((cur) =>
                        nextPendingApprovalCardIds(cur, [resolvedCardId], pendingCardIds ?? undefined),
                      );
                      void refetchAndAppendCards();
                    }}
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
                      rearmGenerationPoll();
                      void refetchAndAppendCards();
                    }}
                  />
                </WidgetRow>
              );
            }

            if (kind === "DENIAL") {
              return (
                <div key={m.id} className="flex items-start gap-3" style={isNewMessage(m.id) ? MSG_ENTER_STYLE : undefined}>
                  <OttoAvatar size={26} state="idle" />
                  <div className="rounded-[5px_14px_14px_14px] bg-error-soft px-[13px] py-[10px] text-[0.875rem] leading-normal text-[var(--error-soft-foreground)]">
                    {/* DENIAL carries its user-facing copy on the durable message text. */}
                    {(m.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text}
                  </div>
                </div>
              );
            }

            if (kind === "TURN_ERROR") {
              const durableText =
                (m.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text ?? "";
              // A cancel is carried by TURN_ERROR (that kind owns the one-terminal-message-per-job
              // index) but it is not an error: no alert styling, and nothing to retry (#602 T3).
              if (cancelledTurnPayload(m.metadata?.payload)) {
                return (
                  <div
                    key={m.id}
                    className="text-[0.875rem] leading-normal text-muted-foreground"
                    style={isNewMessage(m.id) ? MSG_ENTER_STYLE : undefined}
                  >
                    {durableText}
                  </div>
                );
              }
              const durableError = persistedStreamErrorOf(m.metadata?.payload, durableText);
              const failedUserMessageId = persistedStreamErrorUserMessageId(m.metadata?.payload);
              const durableRetryDraft = durableError.kind === "error" && failedUserMessageId
                ? thread.messages.find((message) => message.id === failedUserMessageId && message.role === "USER")?.text ?? null
                : null;
              return (
                <OttoStreamErrorNotice
                  key={m.id}
                  error={durableError}
                  retryDraft={durableRetryDraft}
                  onRetry={(draft) => setText(draft)}
                  style={isNewMessage(m.id) ? MSG_ENTER_STYLE : undefined}
                />
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

            if (kind === "RESEARCH_CARD") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <ResearchCard
                    cardId={m.metadata!.durableId}
                    payload={m.metadata?.payload}
                    balanceUsd={balanceUsd}
                    onBalanceRefresh={() => void onBalanceRefresh?.()}
                    onRefresh={refetchAndAppendResearchReports}
                  />
                </WidgetRow>
              );
            }

            if (kind === "PERFORMANCE_CARD") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <PerformanceCard payload={m.metadata?.payload} />
                </WidgetRow>
              );
            }

            if (kind === "RESEARCH_REPORT") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <ResearchReport cardId={m.metadata!.durableId} payload={m.metadata?.payload} />
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
            // State honesty (宪法 11): a run failure streams a durable `data-error` part
            // into this assistant message. onData mirrors it into `streamError` (the bottom
            // alert); render it here too, off the DURABLE part, so the error still surfaces
            // if that ephemeral state was ever missed. Gated on `!streamError` so it never
            // doubles the live alert; appended AFTER any partial text the turn produced.
            const partError = dataErrorOf(m.parts as ReadonlyArray<{ type: string; data?: unknown }>);
            // #555: every Otto turn is charged. Once it has settled, the route streams a
            // durable `data-cost` part — show the number here, next to the reply it paid
            // for, instead of leaving the merchant to infer it from a moving balance.
            const turnCost = m.role === "user"
              ? null
              : turnCostOf(m.parts as ReadonlyArray<{ type: string; data?: unknown }>);
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
              ...(turnCost !== null
                ? [
                    <div
                      key={`${m.id}:cost`}
                      className="pl-[44px] text-[0.6875rem] text-muted-foreground/70"
                    >
                      This reply used {creditsLabel(turnCost)}.
                    </div>,
                  ]
                : []),
              ...(partError && !streamError
                ? [
                    <OttoStreamErrorNotice
                      key={`${m.id}:err`}
                      error={partError}
                      retryDraft={partError.kind === "error" ? latestUserText(messages.slice(0, mi + 1)) || null : null}
                      onRetry={(draft) => setText(draft)}
                      style={isNewMessage(m.id) ? MSG_ENTER_STYLE : undefined}
                    />,
                  ]
                : []),
            ];
            }); // end renderItems.map
          })()} {/* end IIFE */}

          {/* OTTO's live step-trace — the agent narrating its tool calls (display-only).
              Visibility is decided HERE, from this thread's still-pending approvals
              (#580 复审 r1 P1-4): a parked panel with nothing left to approve describes
              a click that already happened, so it steps aside for the card's own state.
              The old module-level broadcast hid every waiting panel on any card's
              success and was never sent by the universal approval card at all. */}
          {shouldShowTracePanel({ steps: traceSteps, pendingCardIds: pendingApprovalCardIds }) && (
            <div className="my-2 mb-3">
              <OttoTrace steps={traceSteps} />
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
                    setPollRound("retry");
                    setPollGaveUp(false);
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

          {/* Live data-error. The route also persists the same typed failure as a
              TURN_ERROR, so remount/refresh rehydrates this exact presentation. */}
          {streamError && (
            <OttoStreamErrorNotice
              error={{ kind: streamErrorKind ?? "error", text: streamError }}
              retryDraft={retryDraft}
              onRetry={(draft) => {
                setText(draft);
                setStreamError(null);
                setStreamErrorKind(null);
                setRetryDraft(null);
              }}
            />
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

          {/* Reference chips: shown while uploading or when image/video refs are attached */}
          {(uploading || attachedRefs.length > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {uploading ? (
                <div className="inline-flex items-center gap-2 rounded-[14px] border border-border bg-muted px-2 py-1 text-[0.875rem] text-muted-foreground">
                  attaching…
                </div>
              ) : null}
              {attachedRefs.map((ref) => (
                <div key={ref.generationId} className="inline-flex items-center gap-2 rounded-[14px] border border-border bg-muted px-2 py-1">
                  {ref.previewKind === "video" ? (
                    <video
                      src={ref.src}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-10 w-10 rounded-[7px] bg-black object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ref.src}
                      alt="Attached reference"
                      className="h-10 w-10 rounded-[7px] object-cover"
                    />
                  )}
                  <span className="max-w-[110px] truncate text-[0.8125rem] font-medium text-muted-foreground">
                    {ref.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${ref.label}`}
                    onClick={() => {
                      revokeAttachedPreview(ref);
                      setAttachedRefs((current) => removeComposerReference(current, ref.generationId));
                      setAttachError(null);
                    }}
                    className="border-0 bg-transparent p-0 text-[0.875rem] text-muted-foreground cursor-pointer leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
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
              // #739 — the placeholder changes with the attached references and vanishes on
              // the first keystroke; the name stays put.
              aria-label="Reply to Otto"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={isBusy}
              placeholder={composerReferencesPlaceholder(attachedRefs)}
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
                style={{ color: attachedRefs.length ? "var(--primary)" : undefined }}
              >
                <ImageIcon size={18} className={attachedRefs.length ? "text-primary" : "text-muted-foreground"} />
              </button>
              <div className="flex items-center gap-2">
                <span
                  className="otto-send-hint text-[0.75rem] text-muted-foreground"
                  title="Shift+Enter sends. Enter starts a new line."
                >
                  Shift+Enter to send
                </span>
                <Button variant="default" size="sm" disabled={isBusy || !text.trim()} onClick={submit}>
                  {isBusy ? "Sending…" : "Send"}
                </Button>
              </div>
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
