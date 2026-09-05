"use client";
import React, { useEffect, useRef, useState } from "react";
import { MSG_ENTER_STYLE } from "./parts/motion";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { ReferencePickerMenu } from "@/components/reference-picker/ReferencePickerMenu";
import { useReferencePicker } from "@/components/reference-picker/useReferencePicker";
import { MessageReferences } from "@/components/reference-picker/MessageReferences";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { getCoworkThreadClient, getOlderCoworkThreadMessagesClient } from "@/lib/cowork-fetch";
import { threadToUiMessages, type OttoUiMessage } from "@/lib/otto-ui-messages";
import { ChevronDown, ImagesIcon, MessageSquarePlus, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { UPLOAD_FAILURE_COPY } from "@fikirtive/core/upload";
// Codex QA-CRE-FE9-013 —— 「这句话是不是我们写给商家的那两句之一」的白名单。走**子路径**:
// `@fikirtive/core` 的桶文件带出 `node:crypto`,那会被拖进客户端包。
import { referenceUnavailableSentence } from "@fikirtive/core/gen-failure";
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
  backfillMissingAssistantText,
  syncCardJobIds,
  GENERATION_WATCH_GEARS,
} from "@/lib/otto-inject-helpers";
// 观察窗「到顶不等于放弃」的那一条规则,只有这一份实现(#782 r7,判官 r6 P1-A)。
import { nextSyncPhase, type SyncPhase } from "@/lib/storyboard-card";
import { mergeDurableIntoLive, nextPendingApprovalCardIds, type PackApprovalOutcome } from "./approval-chain";
import { UnderstandingCostHint } from "./UnderstandingCostHint";
import { SearchCostHint } from "./SearchCostHint";
import { ConversationCostHint } from "./ConversationCostHint";
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
import { OttoTurnCard, type CanvasConfirmCard } from "./OttoTurnCard";
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
// 画布那张始终可见的 Otto 卡片,此刻该说什么(走查 P0-3/P0-4/P1-1)。判据全在纯函数里,
// 组件只渲染 —— 与 otto-status-helpers 同一条纪律。
import {
  activeStepLabel,
  canvasTurnStatus,
  canvasTurnText,
  currentTurnStartIndex,
  latestTurnTerminal,
} from "@/lib/otto-canvas-turn";
import { creditsLabel } from "@/lib/credit-format";
import { OTTO_TRANSIENT_FAILURE_SENTENCE } from "@/lib/otto-stream-bridge";
import type { OttoErrorData, OttoStatusData, OttoStepData } from "@/lib/otto-stream-bridge";
import type { ReasoningUIPart } from "ai";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import { composerReferencePayload, composerReferencesPlaceholder, removeComposerReference, upsertComposerReference, upsertComposerReferences, type OttoComposerReference } from "@/lib/canvas-chat-reference";
import { CANVAS_OTTO_DOCK_ATTR } from "@/lib/canvas-otto-dock";
import { CanvasLibraryPicker } from "@/components/canvas/CanvasLibraryPicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Re-export the mapping seam so callers/tests can import it from the component too.
export { threadToUiMessages } from "@/lib/otto-ui-messages";
export type { OttoUiMessage, OttoUiMessageMetadata } from "@/lib/otto-ui-messages";

/** balanceUsd / onRefresh are accepted for parity with the earlier non-streaming Otto
 *  chat this replaced (removed); unused here. */
export interface OttoChatStreamProps {
  projectId: string;
  entities: EntityDTO[];
  thread: ChatThreadDTO;
  balanceUsd: number;
  /** Starts a new conversation in this project. Rendered as a persistent button in the
   *  side panel's chat header — that surface has its own `OttoThreadList`, so an older
   *  conversation stays reachable. The canvas does NOT offer it (QA-CRE-FE9-005). */
  onNewConversation?: () => void;
  onRefresh: () => Promise<void>;
  onThreadUpdate: (thread: ChatThreadDTO) => void;
  /** Re-reads the account balance and updates the nav display after a spend event. */
  onBalanceRefresh?: () => void | Promise<void>;
  /**
   * 这条对话此刻**有没有付费生成在跑**(走查 P0-1)。
   *
   * 画板与这块对话是两个兄弟组件,同时挂在 `NorthstarCanvasWorkspace` 里。批准之后余额
   * 会刷新、卡片会变成排队,唯独画板什么都不知道 —— 商家付了钱,板上一片空白,按 F5 图才
   * 出现。画板本来就有一条现成的路(`FlowCanvas` 的 `activity` → 重读画板 → 服务端
   * chat→canvas 桥放下在飞的占位卡),缺的只是有人告诉它。这个回调就是那一句话:
   * 只报事实,不带画板状态,不新起第二套机制。
   */
  onGenerationActivityChange?: (active: boolean) => void;
  /** Streaming front door: a first message to auto-send ONCE into a freshly-created
   *  (empty) thread on mount. The thread row already exists (createEmptyCoworkThread),
   *  so the route's existing-thread branch handles it. */
  pendingFirst?: { text: string; goalKey?: string; entityIds?: string[]; references?: string[] };
  /** Called right after the pendingFirst message is dispatched, so the parent can
   *  clear it (prevents a re-send if this thread is remounted later). */
  onPendingFirstSent?: () => void;
  /** Canvas-selected image/video references to attach to the next Otto message. */
  composerReferences?: OttoComposerReference[] | null;
  /** Clears the parent handoff once this stream has copied it into local composer state. */
  onComposerReferencesConsumed?: (requestIds: string[]) => void;
  /** Canvas keeps the same chat state/action tree, but places current turn, history and composer
   *  around the spatial board instead of rendering a second full-height chat page. */
  layout?: "default" | "canvas";
}

type AttachedReference = Omit<OttoComposerReference, "requestId">;

function revokeAttachedPreview(ref: AttachedReference | null): void {
  if (ref?.src.startsWith("blob:")) URL.revokeObjectURL(ref.src);
}

function revokeAttachedPreviews(refs: AttachedReference[]): void {
  refs.forEach(revokeAttachedPreview);
}

/**
 * Codex QA-CRE-FE9-013 —— 路由在流打开之前拒绝这一轮时,body 是一段 JSON(`{"error":"…"}`)。
 * `DefaultChatTransport` 把它原样塞进 `Error.message`,所以这里只做一件事:把那一层信封拆掉。
 * 拆不开就原样交出去 —— 判断「这句话是不是我们写的」是白名单的事,不是这里的事。
 */
function errorBodyText(message: string | undefined): string | null {
  const raw = (message ?? "").trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string") {
      return (parsed as { error: string }).error;
    }
  } catch {
    // 不是 JSON —— 那就是普通的传输层文本,原样交给白名单去否决它。
  }
  return raw;
}

/**
 * 传输级失败(fetch / 解析在流打开之前就断了)对商家说的那一句。`error.message` 是开发者
 * 看的原文(#949 A2),不上屏;这一句是它唯一的替身,底下那条 Alert 与画布那张始终可见的
 * Otto 卡片读的是同一份 —— 一种失败一句话(#699 的破折号围栏也钉在这个文件上)。
 *
 * #1224 判官 P2-3:这一句从前在三个文件里各写死一份(这里、路由的 onError 兜底、
 * `lib/otto-stream-errors.ts`)。现在只剩单源一份,这里只是给它起个本地名字。
 */
const TRANSPORT_FAILURE_TEXT = OTTO_TRANSIENT_FAILURE_SENTENCE;

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
  onGenerationActivityChange,
  pendingFirst,
  onPendingFirstSent,
  composerReferences,
  onComposerReferencesConsumed,
  layout = "default",
}: OttoChatStreamProps) {
  const [text, setText] = useState("");
  // The one `@` reference picker (spec §7.3③) — the same hook the front door uses. Its rows come
  // from the server search, not from the `entities` prop this file used to filter in the browser.
  const picker = useReferencePicker({
    text,
    setText,
    getTextarea: () => document.getElementById("otto-composer") as HTMLTextAreaElement | null,
  });
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
   *  proposed spend path. */
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
  /** Codex QA-CRE-FE9-013:这一轮送出去的草稿与附件,留到**知道服务端收下了**为止。
   *  服务端因为某件参考取不到而整轮拒绝时,它们原样放回输入框(附件条里就是他要移掉的那一件);
   *  正常收尾或别的错误则在这里释放 —— blob 预览的 revoke 也跟着挪到那一刻,不然放回去的
   *  芯片会是一张已经被撤销的图。 */
  const lastSubmittedRef = useRef<{ text: string; refs: AttachedReference[] } | null>(null);
  const submitLockRef = useRef(false);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoPick, setVideoPick] = useState<{ url: string; duration: number } | null>(null);
  const [frameTime, setFrameTime] = useState(0);
  // F28: only true once a frame has actually been drawn to the canvas (onSeeked), so "Use this
  // frame" can't attach a blank JPEG before the first paint.
  const [frameReady, setFrameReady] = useState(false);
  const [canvasHistoryOpen, setCanvasHistoryOpen] = useState(false);
  /** "Choose from Library" — the second of the pattern's Add-context ways in. */
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(Boolean(thread.hasOlderMessages));
  const [oldestSeq, setOldestSeq] = useState<number | null>(thread.messages[0]?.seq ?? null);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [olderMessagesError, setOlderMessagesError] = useState<string | null>(null);
  /** The original video File for the current videoPick — used by "Use whole video"
   *  to upload the clip itself (not an extracted frame). */
  const wholeVideoFileRef = useRef<File | null>(null);
  const seenComposerReferenceIdsRef = useRef<Set<string>>(new Set());

  // Bounded in-flight poll for the async worker result (ported from the earlier
  // non-streaming chat, removed):
  // a GEN_CARD whose genJobId is set but with no terminal GEN_RESULT/TURN_ERROR keeps
  // hasWorkingJob true; we poll the durable thread and inject the result when it lands.
  //
  // Codex E2E-CRE-PAV-003:这扇窗从前只有一档,打满两分钟就不再问了 —— 而服务端那一头
  // 一个失败的生成走完自己的重投序列本来就可能更久,于是「库里已经 FAILED 并退款、屏幕上
  // 还写着 Generating,刷新才诚实」。齿轮与判词都在 `GENERATION_WATCH_GEARS` 上,规则本身
  // 是 StoryboardCard 早就判过的那一条(`nextSyncPhase`,#782 r7 判官 r6 P1-A):**到顶不
  // 等于放弃**。这里一个新状态机都不建,只是把那条规则用在一直缺第二档的这条窗上。
  /** 这扇窗此刻在哪一档。`"off"` 由 `nextSyncPhase` 的规则保留给「服务端已经给了终局」,
   *  而这条效应本来就被 `hasWorkingJob` 挡着,所以实际只在 fast → slow → exhausted 上走。 */
  const [pollGear, setPollGear] = useState<SyncPhase>("fast");
  /** 快轮的额度用完了 —— 抽屉里那句「比平常久」与「Check again」读的是这个。 */
  const pollGaveUp = pollGear !== "fast";
  /** 慢轮也用完了:我们**放弃**了,不是它**结束**了(SyncPhase 分这两档的原因)。 */
  const pollTerminal = pollGear === "exhausted";
  /** Monotonic re-arm token. Bumped on every rearm so the bounded-poll effect below
   *  ALWAYS re-runs (resetting its local pollCount to 0), even when pollGear is already
   *  back at "fast" — otherwise React bails out and a mid-flight poll window carries its
   *  spent budget into a freshly-approved generation, showing "Check again" early. */
  const [pollNonce, setPollNonce] = useState(0);

  function rearmGenerationPoll() {
    setPollGear("fast");
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
          references?: string[];
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
            // FRONT-A10:这一轮 `@` 到的对象(类型化 ID),落进 ChatMessage.referenceRefs 供回链。
            ...(ids.references?.length ? { references: ids.references } : {}),
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
      // The turn was accepted and ran — the held draft/attachments are no longer a restore
      // candidate, so their blob previews can go (QA-CRE-FE9-013).
      releaseSubmitted();
      // Sync the parent thread list + make reload authoritative. Non-blocking.
      // Safety net (F23): backfill any card-kind durable the live stream missed
      // (e.g. a dropped data-tool-propose part) so cards never need a reload.
      // P2-1(判官二轮复核):也在这一刻补一句可读 TEXT——某些轮次直播结束时,live 列表里
      // 这一轮最终没有任何 text 部件(叙述文字这次没有随流下来),画布卡在这个 turn-end
      // 才会落回空态句;`backfillMissingAssistantText` 只在 live 列表读不出话时才动手,
      // 天然不会把已经画出来的那条 TEXT 再叠一遍。
      void (async () => {
        const fresh = await getCoworkThreadClient(thread.id);
        if (fresh) {
          onThreadUpdate(fresh);
          setMessages((cur) => backfillMissingAssistantText(appendMissingCards(cur, fresh), fresh));
        }
      })();
      // A completed turn meters LLM credits — refresh the nav balance display.
      void onBalanceRefresh?.();
    },
  });

  // useChat's own `error` is transport-level only (fetch/network/parse failures before
  // the route's data-error protocol even starts — business errors arrive as a streamed
  // data-error part and render via OttoStreamErrorNotice instead, see below). Its raw
  // `.message` (e.g. "Failed to fetch") is developer-facing, not merchant-facing (#949
  // A2) — log it for diagnosis, keep the friendly copy on screen.
  //
  // Codex QA-CRE-FE9-013 —— **一个例外,而且只有这一个**:挂上来的参考取不到时,路由在流
  // 打开之前就回一个普通 400,body 是我们自己写的那一句。`referenceUnavailableSentence` 是
  // 一份白名单(与 `GenJob.error` 那份同一条纪律):只有这个文件写给商家的句子才认得出来,
  // 别的一律留给上面那句友好兜底。认出来时:那句话上屏,而且**把这一轮的草稿与附件放回去**——
  // 商家要移掉的那一件就在附件条里,草稿丢了他就得重打一遍。
  /** 放开这一轮扣在手里的草稿与附件(并撤销它们的本地 blob 预览)。 */
  function releaseSubmitted(): void {
    const held = lastSubmittedRef.current;
    lastSubmittedRef.current = null;
    if (held) revokeAttachedPreviews(held.refs);
  }

  /**
   * 这一次被退回的整轮,白名单认得出的那句**具体**话（认不出来就是 null）。
   *
   * 判一次,两处用（#1225 判官残留）：输入框旁那条附件错误，与画布上那张始终可见的状态卡。
   * 从前只有输入框那一处判，画布卡走的是传输级那句通用兜底 —— 同一次失败，两张脸各说一套：
   * 卡上写的是那句通用兜底（照它说的再送一次，那件参考照样取不到），
   * 输入框旁边写的才是真正的原因。一句话一个产地。
   */
  const transportRefusalSentence = error
    ? referenceUnavailableSentence(errorBodyText(error.message))
    : null;

  useEffect(() => {
    if (!error) return;
    console.error("[OttoChatStream] transport error:", error);
    const sentence = transportRefusalSentence;
    if (!sentence) {
      releaseSubmitted();
      return;
    }
    const draft = lastSubmittedRef.current;
    lastSubmittedRef.current = null;
    // 与卡上那个计时器同一条写法(`OttoPlanCard` 的 `queueMicrotask(() => setElapsed(0))`):
    // 在 effect 里同步 setState 会把这一帧再渲染一遍,而这里三个更新本来就属于同一次「放回去」。
    queueMicrotask(() => {
      setAttachError(sentence);
      if (!draft) return;
      setText((current) => (current.trim() ? current : draft.text));
      setAttachedRefs((current) => (current.length ? current : draft.refs));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const isStreaming = status === "streaming";
  const isBusy = status === "submitted" || status === "streaming";

  async function loadOlderMessages() {
    if (!hasOlderMessages || oldestSeq === null || loadingOlderMessages) return;
    setLoadingOlderMessages(true);
    setOlderMessagesError(null);
    try {
      const page = await getOlderCoworkThreadMessagesClient(thread.id, oldestSeq);
      if (!page) {
        setOlderMessagesError("Earlier messages couldn't be loaded — please try again.");
        return;
      }
      const older = threadToUiMessages(page);
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [...older.filter((message) => !currentIds.has(message.id)), ...current];
      });
      setOldestSeq(page.messages[0]?.seq ?? oldestSeq);
      setHasOlderMessages(Boolean(page.hasOlderMessages));
    } catch {
      setOlderMessagesError("Earlier messages couldn't be loaded — please try again.");
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  useEffect(() => {
    if (!isBusy) submitLockRef.current = false;
  }, [isBusy]);

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

  // Reset the give-up state whenever we switch threads.
  // Guarded by a prev-id ref so the reset runs only on an actual thread change, not
  // on the mount render (where the state is already fresh) — avoids a cascading render.
  const prevThreadIdRef = useRef(thread.id);
  useEffect(() => {
    if (prevThreadIdRef.current === thread.id) return;
    prevThreadIdRef.current = thread.id;
    rearmGenerationPoll();
  }, [thread.id]);

  // Bounded poll: a worker that fails-closed without writing a terminal message would
  // otherwise keep hasWorkingJob true forever, so the window is bounded — but it is bounded
  // in TWO gears, not one (Codex E2E-CRE-PAV-003). The fast gear is unchanged (~2 min); when
  // it runs out and the server still has not written a terminal message, we keep asking at
  // the slow gear rather than falling silent, and only the slow gear's own cap is terminal.
  // The rule is `nextSyncPhase` — the same one StoryboardCard was given in #782 r7.
  useEffect(() => {
    if (!hasWorkingJob || pollGear === "off" || pollGear === "exhausted") return;
    const gear = GENERATION_WATCH_GEARS[pollGear];
    let pollCount = 0;
    const t = setInterval(() => {
      pollCount += 1;
      if (pollCount >= gear.maxTries) {
        clearInterval(t);
        // 「到顶」不等于「放弃」:fast → slow → exhausted,判据不在这里,在那条纯函数里。
        setPollGear(nextSyncPhase({
          phase: pollGear,
          triesUsed: pollCount,
          maxTries: gear.maxTries,
          stillPending: hasWorkingJob,
        }));
        return;
      }
      void pollAndInjectResults();
    }, gear.intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkingJob, thread.id, pollGear, pollNonce]);

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
      { body: { projectId, threadId: thread.id, ...(pendingFirst.goalKey ? { goalKey: pendingFirst.goalKey } : {}), ...(pendingFirst.entityIds?.length ? { entityIds: pendingFirst.entityIds } : {}), ...(pendingFirst.references?.length ? { references: pendingFirst.references } : {}) } }, // F30: carry entity conditioning into the first streamed turn; FRONT-A10: and the typed references it named
    );
    onPendingFirstSent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFirst]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || isBusy || submitLockRef.current) return;
    submitLockRef.current = true;
    const entityIds = picker.entityIdsForSend(trimmed);
    // FRONT-A10:「这条消息提到了谁」—— 与 entityIds(生成条件)是两条路,一起上行。
    const references = picker.referencesForSend(trimmed);
    lastSubmittedTextRef.current = trimmed;
    setText(""); // clear the composer immediately; sendMessage echoes the user msg
    picker.clearPicked();
    // Reset ephemeral stream state for the new turn.
    setLiveStatus(null);
    setStepEvents([]);
    setStreamError(null);
    setStreamErrorKind(null);
    setRetryDraft(null);
    setAttachError(null);
    // A new turn may queue a new generation — re-arm polling.
    rearmGenerationPoll();
    // Capture and clear attachments before send. The local preview blob URLs are NOT revoked
    // here any more (QA-CRE-FE9-013): the server can still refuse this whole turn because one of
    // these references is gone, and the chips have to go back into the composer intact. They are
    // revoked the moment the turn is known to have been accepted (onFinish) or to have failed for
    // any other reason — `releaseSubmitted()`.
    const attachedNow = attachedRefs;
    lastSubmittedRef.current = { text: trimmed, refs: attachedNow };
    setAttachedRefs([]);
    // Pass the live projectId/threadId, optional @mention entityIds, and optional
    // sourceGenerationId (attached image) or referenceVideoGenerationId (attached whole
    // clip) via the per-call body; prepareSendMessagesRequest reads them off `body` and
    // shapes the strict route payload.
    void Promise.resolve(
      sendMessage(
        { text: trimmed },
        {
          body: {
            projectId,
            threadId: thread.id,
            ...(entityIds.length ? { entityIds } : {}),
            ...(references.length ? { references } : {}),
            ...composerReferencePayload(attachedNow),
          },
        },
      ),
    ).catch(() => {
      submitLockRef.current = false;
    });
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
        setAttachError(outcome.failures[0]?.reason ?? UPLOAD_FAILURE_COPY.blocked);
        return;
      }
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res || !res.generationIds?.[0]) {
        setAttachError("error" in res ? res.error : "Could not attach image.");
        return;
      }
      setAttachedRefs((current) => upsertComposerReference(current, { generationId: res.generationIds[0], src: URL.createObjectURL(file), kind: "image", previewKind: "image", label: "Image ref" }));
    } catch {
      // 2026-09-03 走查 S2 —— 这里曾把任何一层抛上来的 `err.message` 原样上屏,
      // 商家读到的那句「Unknown error」就是这么来的。底层原文只进日志。
      setAttachError(UPLOAD_FAILURE_COPY.blocked);
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
        setAttachError(outcome.failures[0]?.reason ?? UPLOAD_FAILURE_COPY.blocked);
        return;
      }
      const r = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in r || !r.generationIds?.[0]) {
        setAttachError("error" in r ? r.error : "Could not attach frame.");
        return;
      }
      setAttachedRefs((current) => upsertComposerReference(current, { generationId: r.generationIds[0], src: preview, kind: "image", previewKind: "image", label: "Image ref" }));
      closeVideoPick();
    } catch {
      // 2026-09-03 走查 S2 —— 这里曾把任何一层抛上来的 `err.message` 原样上屏,
      // 商家读到的那句「Unknown error」就是这么来的。底层原文只进日志。
      setAttachError(UPLOAD_FAILURE_COPY.blocked);
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
      if (outcome.files.length === 0) { setAttachError(outcome.failures[0]?.reason ?? UPLOAD_FAILURE_COPY.blocked); return; }
      const r = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in r || !r.generationIds?.[0]) { setAttachError("error" in r ? r.error : "Could not attach video."); return; }
      const preview = canvasRef.current?.toDataURL("image/jpeg", FRAME_JPEG_QUALITY) ?? "";
      setAttachedRefs((current) => upsertComposerReference(current, { generationId: r.generationIds[0], src: preview, kind: "refVideo", previewKind: "image", label: "Video ref" }));
      closeVideoPick();
    } catch {
      setAttachError(UPLOAD_FAILURE_COPY.blocked);
    } finally { setUploading(false); }
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    picker.handleTextChange(val, e.target.selectionStart ?? val.length);
  };

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // the picker gets first refusal: while its menu is open, arrows / Enter / Tab / Escape are
    // navigation, not composition
    if (picker.handleKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  /** 「Change something」把这张卡的原话塞回输入框,让商家在它上面改。抽屉里那张卡与画布上
   *  那张确认卡按的是同一个动作,所以它只能有一份实现。 */
  function seedComposer(seed: string) {
    const ta = document.getElementById("otto-composer") as HTMLTextAreaElement | null;
    if (!ta) return;
    // Prefill with the plan prompt so the user edits from it.
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    nativeInputValueSetter?.call(ta, seed);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    setText(seed); // sync React state directly
  }

  // The index of the message that holds the actively-streaming assistant text, so
  // only its last text part gets the blinking caret.
  const lastMessageIsStreamingAssistant =
    isStreaming &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant";

  // 画布卡的正文。走查 P1-1 修掉了「🖼 result」那种内部占位串;Codex QA-CRE-004 修掉了它的
  // 另一半 —— 那句话从前**不比时间**,于是一条落库的 TEXT 永远是「最后一句」,哪怕后来又落了
  // 一条 GEN_RESULT。现在在「Otto 后来说的话」与「这一轮的终局」之间取更新的那个。判据全在
  // 纯函数里,连同测试。
  //
  // 2026-09-05 走查修复一:这一轮的失败还要**立刻**上脸。`data-error` 那一种自己就挂在
  // 消息上,纯函数直接读得到;传输级那一种(流还没开就断了)消息上什么都没有,只活在
  // `useChat` 的 status 里 —— 作为 `liveError` 走进同一条投影,而不是在这里长出第二个
  // 「卡该说什么」的判断。
  // 那一句具体的原因(参考取不到)优先于通用兜底 —— 与输入框旁那条读的是同一次判定。
  const transportTurnError: OttoErrorData | null =
    status === "error"
      ? { kind: "error", text: transportRefusalSentence ?? TRANSPORT_FAILURE_TEXT }
      : null;
  const latestAssistantText = canvasTurnText(messages, transportTurnError);
  // 这一轮的终局(直播 data-error / 传输级失败 / 落库的 GEN_RESULT・TURN_ERROR),
  // 状态词与正文读的是**同一个**。
  const turnTerminal = latestTurnTerminal(messages, transportTurnError);
  // 失败那一轮的出路:能重试的那一种(`error`)才给键,商家原来打的那句话就是这一轮开头
  // 那条 user 消息 —— 与抽屉里那张告示同一条判据,不靠任何只活一瞬的 ref。
  const canvasRetryDraft =
    turnTerminal?.outcome === "failed" && turnTerminal.error?.kind === "error"
      ? latestUserText(messages) || null
      : null;
  // 出路按**类型**分岔(#1225 判官残留):充值那一种给 Top up、上限那一种给 Open Billing &
  // credits、供应商侧那一档一个键都不给。判据与抽屉里那张告示逐字同一个,卡自己不解析措辞。
  const canvasErrorKind: OttoErrorData["kind"] | null =
    turnTerminal?.outcome === "failed" ? turnTerminal.error?.kind ?? null : null;
  const canvasLayout = layout === "canvas";

  // ── 画布卡这一刻的脸(走查 P0-3 / P0-4)────────────────────────────────────────
  // 每一张 GEN_CARD 的运行态,与抽屉里那张卡读的是同一个 `deriveCardState`。
  const genCardStates = messages
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.metadata?.kind === "GEN_CARD" && m.metadata.durableId)
    .map(({ m, index }) => ({
      index,
      message: m,
      durableId: m.metadata!.durableId,
      state: deriveCardState({
        genJobId: m.metadata?.genJobId ?? null,
        submitted: submittedCardIds.has(m.metadata!.durableId),
        results: jobsWithResult,
        errors: jobsWithError,
        cancelled: jobsCancelled,
      }),
    }));
  // 等商家按确认的卡。`idle` 就是「有卡、没开跑」—— 与卡自己的 approve 门同一个判据。
  // 只取**这一轮**的(最后一条商家发言之后):这张卡是「当前回合」卡,更早几轮没按的卡
  // 仍在对话抽屉里、照旧可以批准,不该在这里堆成一叠让商家在里面挑一个付钱。
  const turnStart = currentTurnStartIndex(messages);
  const confirmCards: CanvasConfirmCard[] = genCardStates
    .filter((c) => c.state === "idle" && c.index >= turnStart)
    .map((c) => ({
      cardId: c.durableId,
      threadId: thread.id,
      payload: c.message.metadata?.payload,
      pendingApproval: pendingApprovalCardIds.has(c.durableId),
    }));
  /**
   * 三格（张数／形状／精修）改完之后，服务端重铸的那张卡落回**这条消息**（复审 r1 P1-1）。
   *
   * 为什么必须落在这里而不是卡自己手里：同一个 cardId 今天有两处确认位 —— 对话抽屉里那张
   * `OttoPlanCard` 与画布上那张 `OttoTurnCard`，而画布形态下抽屉只是 CSS 隐藏（上面那个
   * `canvasHistoryOpen ? "flex" : "hidden"`），不是卸载。两处各留一份「重铸后的 payload」，
   * 就是同一张卡上一处写着新价、另一处仍按旧价出 Generate；批准请求不带价（服务端从库里
   * 那张卡重建），所以陈旧那一侧按下去照旧按新价预扣。写进 metadata.payload 之后两处读的
   * 是同一份，下一帧一起换。
   *
   * 这里不算钱、不改任何别的格：整张卡逐字来自服务端那一次 $0 重铸。轮询回来的库里那一份
   * （`mergeDurableIntoLive` / `appendMissingCards`）照旧压过它 —— 库永远是权威。
   */
  function applyRemintedCard(cardId: string, payload: unknown) {
    setMessages((cur) =>
      cur.map((m) =>
        m.metadata?.kind === "GEN_CARD" && m.metadata.durableId === cardId
          ? { ...m, metadata: { ...m.metadata, payload } }
          : m,
      ),
    );
  }
  const workingCardCount = genCardStates.filter((c) => c.state === "working").length;
  // 「屏幕上多久没变了」的输入。变的定义 = 状态词 + 那句进度话 + 消息条数,任一变化就重新计时。
  const canvasProgressKey = `${isBusy}|${liveStatus?.kind ?? ""}|${activeStepLabel(traceSteps) ?? ""}|${messages.length}|${workingCardCount}|${confirmCards.length}`;
  const [progressKey, setProgressKey] = useState(canvasProgressKey);
  const [secondsSinceProgress, setSecondsSinceProgress] = useState(0);
  if (progressKey !== canvasProgressKey) {
    // Render-phase "adjust state when an input changes" (React docs pattern) — not setState-in-effect.
    // 计秒本身不在这里读时钟(渲染必须是纯的):秒数只归零,由下面那个每秒 +1 的计时器数。
    setProgressKey(canvasProgressKey);
    setSecondsSinceProgress(0);
  }
  const canvasTurnBusy = isBusy || workingCardCount > 0;
  useEffect(() => {
    if (!canvasLayout || !canvasTurnBusy) return;
    const t = setInterval(() => setSecondsSinceProgress((n) => n + 1), 1000);
    return () => clearInterval(t);
    // progressKey 进依赖:屏幕上一变化,这只计时器就重开,从刚归零的那一秒重新数起。
  }, [canvasLayout, canvasTurnBusy, progressKey]);
  const canvasStatus = canvasTurnStatus({
    isBusy,
    hasAssistantText: !!hasAssistantText,
    liveStatus,
    steps: traceSteps,
    workingCardCount,
    pendingConfirmCount: confirmCards.length,
    terminal: turnTerminal,
    secondsSinceProgress,
  });

  // 画板要知道「这条对话此刻有没有付费任务在跑」——`activity` 一翻 true,FlowCanvas 就去
  // 重读画板,服务端的 chat→canvas 桥把在飞的那张占位卡放上去;翻 false 再读一次,产出把
  // 占位卡换掉(走查 P0-1)。这里只报事实,不碰画板的任何状态,也不新起第二套机制。
  const generationActive = workingCardCount > 0;
  useEffect(() => {
    onGenerationActivityChange?.(generationActive);
  }, [generationActive, onGenerationActivityChange]);

  // leading-[1.5] — design-baseline body line-height (Analytics standard)
  return (
    <div
      // 画布形态下这一层是**定位框**,不是一张纸,所以它不带 `gb`(2026-09-03 走查 D1 的另一半)。
      // `.gb` 是 token 根,而 token 根在 globals.css 里自己 `background-color: var(--background)`:
      // 一个 `inset-0` 的 `.gb` 就是一张铺满整块画板的不透明纸,盖在 z-index 5 的画布之上。它
      // `pointer-events: none`,所以 `elementFromPoint` 照样穿得过去 —— 只有商家的眼睛穿不过去。
      // 实测(1440×900 生产构建):点阵底纹、工具条、板上的卡全被它遮掉;设成透明,画板立刻回来。
      // 画布路由永远渲染在 `.gb.ns-immersive` 壳根里,token 本来就继承得到;这一份嵌套的 `gb`
      // 只多做了两件坏事:铺纸,以及把沉浸壳的 scoped 覆盖重置回全局值。
      // 面板形态那一支不动:那里它真的是一面纸,自己该有底色。
      className={canvasLayout
        ? "pointer-events-none absolute inset-0 z-30 leading-[1.5]"
        : "gb flex min-h-0 flex-1 flex-col overflow-hidden leading-[1.5]"}
    >
      <style>{`
        @keyframes otto-caret-blink { 50% { opacity: 0; } }
        @keyframes otto-msg-enter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes otto-status-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
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
      {canvasLayout ? (
        <OttoTurnCard
          status={canvasStatus}
          text={latestAssistantText}
          streaming={lastMessageIsStreamingAssistant}
          confirmCards={confirmCards}
          retryDraft={canvasRetryDraft}
          errorKind={canvasErrorKind}
          onApproved={({ cardId: approvedCardId, chained }) => {
            // 与抽屉里那张卡按下去之后**逐字相同**的善后:同一份 pending 集合合并规矩、
            // 同一次轮询重装、同一条注入路径。两个按钮,一套状态机。
            if (!chained?.pendingCardIds.includes(approvedCardId)) {
              setSubmittedCardIds((cur) => new Set(cur).add(approvedCardId));
            }
            setPendingApprovalCardIds((cur) =>
              nextPendingApprovalCardIds(cur, [approvedCardId], chained?.pendingCardIds),
            );
            rearmGenerationPoll();
            void pollAndInjectResults(
              chained?.narrationMessageId ? [chained.narrationMessageId] : undefined,
            );
          }}
          onChangeSomething={(seed) => seedComposer(seed)}
          onOptionsChanged={applyRemintedCard}
        />
      ) : null}
      {/* Header. QA-CRE-FE9-005（Founder 2026-09-04 07:05 裁决）：**画布上没有 New conversation**。
          一张画布就是它那一条按时间的 Conversation —— 画布从来没有 thread 切换器，所以那颗键
          只会造出「写得进、找不回」的对话（Codex 只读走查 Stage 7）。beta 先收掉它；多对话切换
          列表登记下一轮。侧栏 Otto 面板不受影响：那一面有自己的 `OttoThreadList`，旧对话找得回，
          所以下面 `!canvasLayout` 那一支照旧带这颗键。 */}
      {canvasLayout ? (
        <div className="otto-chat-header pointer-events-auto absolute bottom-4 left-4 flex h-10 w-[280px] items-center gap-1 rounded-[var(--radius-card)] border border-border bg-card p-1 shadow-[var(--shadow-sm)]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={canvasHistoryOpen}
            className="min-w-0 flex-1 justify-between px-2"
            onClick={() => setCanvasHistoryOpen((open) => !open)}
          >
            <span className="truncate">Conversation</span>
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground tabular-nums">
              {messages.length}
              <ChevronDown className={`size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none ${canvasHistoryOpen ? "rotate-180" : ""}`} aria-hidden />
            </span>
          </Button>
        </div>
      ) : (
        <div className="otto-chat-header flex items-center gap-[9px] border-b border-border bg-card px-4 py-[13px]">
          <OttoAvatar size={22} state={isBusy ? "thinking" : "idle"} />
          <div className="min-w-0 flex-1 truncate text-[0.90625rem] font-semibold text-foreground">
            {thread.title}
          </div>
          {onNewConversation && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onNewConversation}
              title="Start a new conversation in this Canvas"
              aria-label="New conversation"
              className="shrink-0"
            >
              <MessageSquarePlus data-icon="inline-start" aria-hidden />
              New conversation
            </Button>
          )}
        </div>
      )}

      {/* Messages — shadcn owns follow, anchoring, and jump-to-latest behavior. */}
      <MessageScrollerProvider autoScroll>
        <MessageScroller className={canvasLayout
          // THE PATTERN'S OWN CONVERSATION DOCK (Founder 2026-09-03: 生产界面严格按 UIUX 设计走).
          // `design-system/patterns/canvas/CanvasReference.tsx` gives it `w-[280px]` and a
          // `max-h-[260px]` scrolling list — the same 280 as the current-turn card above it and
          // the toggle below it, so the whole left column is one width.
          //
          // 380px was not just wider, it OVERLAPPED. The board's creation band starts at
          // `left: 300px` (globals.css `.cv-creation-band` / `.cv-bottom-stack`, the pattern's own
          // number), and `left-4` + 380px reaches 396px — so on any window narrow enough for the
          // band to matter, the open history sat across the canvas's own tool column. At 280px it
          // ends at 296px and clears it by 4px at every width, which is why the pattern picks 280.
          ? `${canvasHistoryOpen ? "flex" : "hidden"} pointer-events-auto absolute bottom-16 left-4 max-h-[min(46vh,260px)] w-[280px] overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-md)]`
          : "min-h-0 flex-1"}
        >
          <MessageScrollerViewport>
            <MessageScrollerContent
              className="otto-chat-scroll mx-auto w-full max-w-[680px] gap-[14px] p-4"
              role="log"
              aria-live="polite"
              aria-label="Conversation with Otto"
            >
          {hasOlderMessages ? (
            <div className="flex flex-col items-center gap-2 pb-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={loadingOlderMessages}
                onClick={() => void loadOlderMessages()}
              >
                {loadingOlderMessages ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
                {loadingOlderMessages ? "Loading…" : "Load earlier messages"}
              </Button>
              {olderMessagesError ? (
                <span role="alert" className="text-xs text-destructive">{olderMessagesError}</span>
              ) : null}
            </div>
          ) : null}
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
                  <WidgetRow key={`pack:${packId}`} messageId={`pack:${packId}`} animateIn={animateIn}>
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
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
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
                    onChangeSomething={(seed) => seedComposer(seed)}
                    onOptionsChanged={applyRemintedCard}
                    onRetry={() => {
                      // A fresh card was spawned — re-arm poll and refetch so it appears.
                      // Back to the fast gear too: the retried job gets the full watch window,
                      // not the spent remainder of an earlier job's.
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

            // Meta approval-flow cards (F23).
            // The approve buttons inside call the existing gated server actions
            // (approveMetaActionPlan / approveAdBuild) and Deny calls ottoReject — the same
            // action the universal approval card uses (FRONT-A12); this only renders them.
            if (kind === "ACTION_CARD") {
              return (
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoActionPlanCard cardId={m.metadata!.durableId} threadId={thread.id} payload={m.metadata?.payload} />
                </WidgetRow>
              );
            }

            if (kind === "BUILD_CARD") {
              return (
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoAdBuildCard cardId={m.metadata!.durableId} threadId={thread.id} payload={m.metadata?.payload} />
                </WidgetRow>
              );
            }

            // Universal approval card (B4 debt-70) — a non-generate gated skill parked for the
            // user's consent. Confirm/Decline call ottoApprove/ottoReject inside the card.
            if (kind === "APPROVAL_CARD") {
              return (
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
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
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
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
                <ConversationItem key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
                  <Message align="start">
                    <MessageAvatar aria-hidden>
                      <OttoAvatar size={32} state="idle" />
                    </MessageAvatar>
                    <MessageContent>
                      <MessageHeader>Otto</MessageHeader>
                      <Bubble variant="destructive">
                        <BubbleContent>
                          {/* DENIAL carries its user-facing copy on the durable message text. */}
                          {(m.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </ConversationItem>
              );
            }

            if (kind === "TURN_ERROR") {
              const durableText =
                (m.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text ?? "";
              // A cancel is carried by TURN_ERROR (that kind owns the one-terminal-message-per-job
              // index) but it is not an error: no alert styling, and nothing to retry (#602 T3).
              if (cancelledTurnPayload(m.metadata?.payload)) {
                return (
                  <ConversationItem key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
                    <Marker variant="separator">
                      <MarkerContent>{durableText}</MarkerContent>
                    </Marker>
                  </ConversationItem>
                );
              }
              const durableError = persistedStreamErrorOf(m.metadata?.payload, durableText);
              const failedUserMessageId = persistedStreamErrorUserMessageId(m.metadata?.payload);
              const durableRetryDraft = durableError.kind === "error" && failedUserMessageId
                ? thread.messages.find((message) => message.id === failedUserMessageId && message.role === "USER")?.text ?? null
                : null;
              return (
                <ConversationItem key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoStreamErrorNotice
                    error={durableError}
                    retryDraft={durableRetryDraft}
                    onRetry={(draft) => setText(draft)}
                  />
                </ConversationItem>
              );
            }

            if (kind === "STORYBOARD_CARD") {
              return (
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
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
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
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
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
                  <PerformanceCard payload={m.metadata?.payload} />
                </WidgetRow>
              );
            }

            if (kind === "RESEARCH_REPORT") {
              return (
                <WidgetRow key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
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
            // #555: every charged Otto turn says what it cost. Once the turn settles, the route
            // streams a durable `data-cost` part — show the number here, next to the reply it
            // paid for, instead of leaving the merchant to infer it from a moving balance.
            // A turn that settled to nothing (a refunded failure, a mock runtime) streams no
            // part at all, and turnCostOf refuses any non-positive number, so this line is
            // never a "0 credits" artifact.
            const turnCost = m.role === "user"
              ? null
              : turnCostOf(m.parts as ReadonlyArray<{ type: string; data?: unknown }>);
            const showPartError = partError && !streamError;
            if (!textParts.length && !reasoningParts.length && turnCost === null && !showPartError) {
              return null;
            }
            return (
              <ConversationItem
                key={m.id}
                messageId={m.id}
                scrollAnchor={m.role === "user"}
                animateIn={isNewMessage(m.id)}
              >
                <MessageGroup>
                  {textParts.map((p, pi) => {
                    const isLastTextPart = pi === textParts.length - 1;
                    const streaming =
                      lastMessageIsStreamingAssistant && isLastMessage && isLastTextPart;
                    return (
                      <TextPart
                        key={`${m.id}:t${pi}`}
                        role={m.role === "user" ? "user" : "assistant"}
                        text={p.text}
                        streaming={streaming}
                      />
                    );
                  })}
                  {reasoningParts.map((p, ri) => (
                    // Graceful: only rendered when reasoning arrives; most models omit it.
                    <ReasoningPart key={`${m.id}:r${ri}`} part={p} />
                  ))}
                  {/* FRONT-A10 回链:这一条消息 `@` 到的对象,点得回去。名字与地址来自服务端
                      那一次 owner-scoped 解析(lib/reference-refs.ts),客户端不自己拼。
                      刚发出去那一条还没有 —— 它要等这一轮落库、下一次取数才带上引用。 */}
                  {m.metadata?.references?.length ? (
                    <MessageReferences references={m.metadata.references} />
                  ) : null}
                  {turnCost !== null && (
                    <Marker>
                      <MarkerContent>This reply used {creditsLabel(turnCost)}.</MarkerContent>
                    </Marker>
                  )}
                  {showPartError && (
                    <OttoStreamErrorNotice
                      error={partError}
                      retryDraft={partError.kind === "error" ? latestUserText(messages.slice(0, mi + 1)) || null : null}
                      onRetry={(draft) => setText(draft)}
                    />
                  )}
                </MessageGroup>
              </ConversationItem>
            );
            }); // end renderItems.map
          })()} {/* end IIFE */}

          {/* OTTO's live step-trace — the agent narrating its tool calls (display-only).
              Visibility is decided HERE, from this thread's still-pending approvals
              (#580 复审 r1 P1-4): a parked panel with nothing left to approve describes
              a click that already happened, so it steps aside for the card's own state.
              The old module-level broadcast hid every waiting panel on any card's
              success and was never sent by the universal approval card at all. */}
          {shouldShowTracePanel({ steps: traceSteps, pendingCardIds: pendingApprovalCardIds }) && (
            <ConversationItem messageId="live-trace">
              <OttoTrace steps={traceSteps} />
            </ConversationItem>
          )}

          {/* Live status line: narrates the turn's current phase in one short sentence
              (#996 — copy lives in lib/otto-turn-narration.ts); hides automatically once
              the first token arrives or isBusy goes false. */}
          {isBusy && !hasAssistantText && (
            <ConversationItem messageId="live-status">
              <StatusLine
                isBusy={isBusy}
                liveStatus={liveStatus}
                hasAssistantText={hasAssistantText}
              />
            </ConversationItem>
          )}

          {/* Terminal degrade/stale status: shown after an abnormal turn end.
              Clears automatically when submit() calls setLiveStatus(null). */}
          {!isBusy && (liveStatus?.kind === "degraded" || liveStatus?.kind === "stale") && (
            <ConversationItem messageId={`live-${liveStatus.kind}`} animateIn>
              <OttoStatusMessage>{liveStatus.text}</OttoStatusMessage>
            </ConversationItem>
          )}

          {/* Async generation in progress: a card was approved (genJobId set) and the
              worker hasn't written a terminal result yet. */}
          {!isBusy && hasWorkingJob && !pollGaveUp && (
            <ConversationItem messageId="working-generation">
              <OttoStatusMessage state="thinking">
                Otto is making this — this can take a moment…
              </OttoStatusMessage>
            </ConversationItem>
          )}

          {!isBusy && hasWorkingJob && pollGaveUp && !pollTerminal && (
            <ConversationItem messageId="working-generation-delayed">
              <OttoStatusMessage>
                This is taking longer than usual. Your credits for this are on hold — if it doesn&rsquo;t finish, they&rsquo;re returned to you automatically.{" "}
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => {
                    // 商家自己按的这一下,把窗口拨回快轮 —— 慢轮本来也一直在问,这只是
                    // 「现在就问」。它不再是从前那个「第二轮用完就死路」的唯一出口。
                    rearmGenerationPoll();
                    void pollAndInjectResults();
                  }}
                >
                  Check again
                </Button>
              </OttoStatusMessage>
            </ConversationItem>
          )}

          {!isBusy && hasWorkingJob && pollTerminal && (
            <ConversationItem messageId="working-generation-stuck">
              <OttoStatusMessage>
                This looks stuck. Cancel it on the card to get your credits back, or start a new card.
              </OttoStatusMessage>
            </ConversationItem>
          )}

          {/* Live data-error. The route also persists the same typed failure as a
              TURN_ERROR, so remount/refresh rehydrates this exact presentation. */}
          {streamError && (
            <ConversationItem messageId="live-stream-error">
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
            </ConversationItem>
          )}

          {/* useChat transport-level error (network / parse failures distinct from
              route data-error). Kept as a fallback alongside stream-level errors.
              Always the friendly copy — `error.message` is raw transport text
              ("Failed to fetch" and the like), not something a merchant can act on;
              it's logged above instead (#949 A2). */}
          {status === "error" && !streamError && (
            <ConversationItem messageId="transport-error">
              <Alert role="alert" variant="destructive">
                <AlertTitle>Otto couldn&apos;t finish this turn</AlertTitle>
                <AlertDescription>{TRANSPORT_FAILURE_TEXT}</AlertDescription>
              </Alert>
            </ConversationItem>
          )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton variant="secondary" />
        </MessageScroller>
      </MessageScrollerProvider>

      {/* Composer —— 画布形态下它坐在已批准 pattern 的创作带里(`.cv-creation-band`:
          `bottom-4 left-[300px] right-[160px]`、居中、`max-w-[620px]`,数字只在 globals.css
          声明一次)。原来的 `left-[calc(50%+140px)] w-[min(620px,100%-340px)]` 不给右边留位,
          于是它会压住 pattern 放在右下角的缩放簇;带子改回 pattern 的样子,右边那 160px
          就是缩放簇的角。
          这一块占掉画布底边多少高度由 NorthstarCanvasWorkspace 量出来,交给画布创作列让位
          (2026-09-03 走查 D1,病根全文在 `lib/canvas-otto-dock.ts`)。记号只在画布形态挂:
          面板形态里它是正常流里的一行,没有谁需要为它让位。 */}
      <div
        {...(canvasLayout ? { [CANVAS_OTTO_DOCK_ATTR]: "" } : {})}
        className={canvasLayout
          ? "otto-chat-composer cv-creation-band pointer-events-auto rounded-[var(--radius-card)] border border-border bg-card p-2 shadow-[var(--shadow-md)]"
          : "otto-chat-composer border-t border-border bg-card p-3"}
      >
        <div className="relative mx-auto max-w-[680px]">
          {/* Hidden file input — triggered by the attach button below */}
          <Input
            ref={fileInputRef}
            type="file"
            aria-label="Attach a file"
            accept={ACCEPT_ATTACH}
            className="hidden"
            onChange={handleFilePick}
          />

          {/* Attaching a reference spends nothing — it is context the composer carries until the
              merchant sends their own message. */}
          <CanvasLibraryPicker
            open={libraryPickerOpen}
            onOpenChange={setLibraryPickerOpen}
            onPick={(reference) => {
              setAttachError(null);
              setAttachedRefs((current) => upsertComposerReference(current, reference));
            }}
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
                <Input
                  type="range"
                  min={0}
                  max={videoPick.duration}
                  step={0.05}
                  value={frameTime}
                  onChange={handleScrub}
                  aria-label="Pick a video frame"
                  className="h-auto w-full border-0 bg-transparent p-0 shadow-none"
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
            <AttachmentGroup className="mb-2">
              {uploading ? (
                <Attachment state="uploading" size="sm">
                  <AttachmentMedia>
                    <Spinner aria-label="Attaching reference" />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>Attaching reference</AttachmentTitle>
                    <AttachmentDescription>Preparing upload</AttachmentDescription>
                  </AttachmentContent>
                </Attachment>
              ) : null}
              {attachedRefs.map((ref) => (
                <Attachment key={ref.generationId} state="done" size="sm">
                  <AttachmentMedia variant="image">
                    {ref.previewKind === "video" ? (
                      <video
                        src={ref.src}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ref.src} alt="Attached reference" />
                    )}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{ref.label}</AttachmentTitle>
                    <AttachmentDescription>
                      {ref.previewKind === "video" ? "Video reference" : "Image reference"}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      type="button"
                      aria-label={`Remove ${ref.label}`}
                      onClick={() => {
                        revokeAttachedPreview(ref);
                        setAttachedRefs((current) => removeComposerReference(current, ref.generationId));
                        setAttachError(null);
                      }}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          )}

          {/* Attach error */}
          {attachError && (
            <Alert role="alert" variant="destructive" density="compact" className="mb-2">
              <AlertTitle>Reference couldn&apos;t be attached</AlertTitle>
              <AlertDescription>{attachError}</AlertDescription>
            </Alert>
          )}

          {/* MONEY-A9 §7.3 — mounted directly above the composer box, which is where the
              attach button lives: the price is on screen while the file picker is still
              closed (披露先于扣费), and it does not squeeze the composer's bottom toolbar.
              MONEY-A10 §7.4 sits beside it: the chat turn's OTHER non-obvious charge is the
              web search the merchant's own question triggers, and until now its only
              disclosure lived inside Otto's system prompt.
              ENGINE-A3 §7.4/§7.6 处置一 —— 第三条:**这一轮对话本身**要钱。⑦段把画布上那条
              直出的出图路撤了,同一张图从此必须先经过至少一轮对话;那一轮的钱在这里说出口,
              而不是等商家从账单里发现(`ConversationCostHint` 的文件头有全文)。 */}
          <div className="mb-2 flex flex-col gap-0.5">
            <UnderstandingCostHint />
            <SearchCostHint />
            <ConversationCostHint />
          </div>

          <ReferencePickerMenu {...picker.menuProps}>
            <InputGroup className="overflow-hidden rounded-[var(--radius-card)] bg-card shadow-[var(--shadow-sm)]">
              <InputGroupTextarea
                id="otto-composer"
                // #739 — the placeholder changes with the attached references and vanishes on
                // the first keystroke; the name stays put.
                aria-label="Reply to Otto"
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                {...picker.ariaProps}
                disabled={isBusy}
                placeholder={composerReferencesPlaceholder(attachedRefs)}
                rows={2}
                // #920 判官 r1 P2 — ui/textarea's own field-sizing-content would grow this
                // fixed-chrome composer box taller with every line typed; field-sizing-fixed
                // restores the original rows-locked height.
                className="field-sizing-fixed min-h-0 w-full px-4 text-[0.90625rem]"
              />
              <InputGroupAddon align="block-end" className="justify-between border-t border-border">
                {/* ADD CONTEXT — the approved pattern's own menu, not a bare attach icon
                    (`design-system/patterns/canvas/CreationComposer.tsx`: a `+` trigger labelled
                    "Add a reference", the words "Add context" beside it, and three ways in).
                    Two of the three are wired to capabilities that already exist; the third is
                    not rendered, because it has no production contract (Founder 2026-09-03 rule ①):
                    · Upload — the file picker this composer already owns.
                    · Choose from Library — `getGenerationHistory`, the owner-gated action the
                      Library page reads, mapped through the board's own reference mapping.
                    · Add URL — the only URL import in the repo is `ctx.mediaImport.fromUrl`
                      (`lib/otto-media-port.ts`), a tool Otto calls inside its own turn. There is
                      no server action a composer can call, so the item is absent rather than a
                      button that does nothing. */}
                <div className="flex min-w-0 items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Add a reference"
                        disabled={isBusy || uploading || !!videoPick}
                        className={attachedRefs.length ? "text-primary" : "text-muted-foreground"}
                      >
                        <PlusIcon aria-hidden="true" />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Add a reference</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                          <UploadIcon aria-hidden="true" />
                          {/* The pattern's item reads "Upload image"; this picker genuinely takes
                              a video too (that is what the frame picker below is for), so the
                              label says both rather than the pattern's shorter half-truth. */}
                          Upload image or video
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setLibraryPickerOpen(true)}>
                          <ImagesIcon aria-hidden="true" />
                          Choose from Library
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="hidden text-[0.75rem] text-muted-foreground sm:inline">Add context</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="otto-send-hint text-[0.75rem] text-muted-foreground"
                    title="Enter sends. Shift+Enter starts a new line."
                  >
                    Enter to send
                  </span>
                  {/* 走查 P0-4:这颗按钮从前整整 49 秒都写着「Sending…」,读起来是请求挂住了,
                      而不是 Otto 在做事。发送与做事是两件事,`status` 本来就分得清:
                      submitted = 请求还在路上,streaming = 回信已经在写了。 */}
                  <InputGroupButton variant="default" size="sm" disabled={isBusy || !text.trim()} onClick={submit}>
                    {isBusy && <Spinner data-icon="inline-start" aria-label={isStreaming ? "Otto is working" : "Sending message"} />}
                    {isBusy ? (isStreaming ? "Working…" : "Sending…") : "Send"}
                  </InputGroupButton>
                </div>
              </InputGroupAddon>
            </InputGroup>
          </ReferencePickerMenu>
        </div>
      </div>
    </div>
  );
}

function ConversationItem({
  messageId,
  children,
  scrollAnchor = false,
  animateIn = false,
}: {
  messageId: string;
  children: React.ReactNode;
  scrollAnchor?: boolean;
  animateIn?: boolean;
}) {
  return (
    <MessageScrollerItem
      messageId={messageId}
      scrollAnchor={scrollAnchor}
      style={animateIn ? MSG_ENTER_STYLE : undefined}
    >
      {children}
    </MessageScrollerItem>
  );
}

function OttoStatusMessage({
  children,
  state = "idle",
}: {
  children: React.ReactNode;
  state?: "idle" | "thinking";
}) {
  return (
    <Message align="start">
      <MessageAvatar aria-hidden>
        <OttoAvatar size={32} state={state} />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>Otto</MessageHeader>
        <Bubble variant="status">
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/** Avatar + flexible body row used for inline plan cards and result widgets. */
function WidgetRow({
  messageId,
  children,
  animateIn,
}: {
  messageId: string;
  children: React.ReactNode;
  animateIn?: boolean;
}) {
  return (
    <ConversationItem messageId={messageId} animateIn={animateIn}>
      <Message align="start">
        <MessageAvatar aria-hidden>
          <OttoAvatar size={32} state="idle" />
        </MessageAvatar>
        <MessageContent>{children}</MessageContent>
      </Message>
    </ConversationItem>
  );
}

export default OttoChatStream;
