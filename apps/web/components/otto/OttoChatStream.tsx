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
// FSE-002/003/004 —— 「这一轮带着什么引用」只有一份形状与一份到请求体的映射。
import {
  EMPTY_TURN_REFERENCES,
  hasTurnReferences,
  mergeTurnReferences,
  restoredReferencesNote,
  richerTurnReferenceDraft,
  turnReferenceBody,
  turnReferenceDraftFromMessage,
  turnReferencesFromComposerPayload,
  type TurnReferenceDraft,
  type TurnReferences,
} from "@/lib/turn-reference-draft";
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
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

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
  /**
   * 反方向的那一句（FSE-005）：**画板上此刻有没有画布直接动作的付费生成在跑**。
   *
   * 上面那条回调把「Otto 这边在跑」告诉画板，2026-09-04「P0-1」修的是那一半；这一格是
   * 另一半。画布节点级动作那张 GEN_CARD 是服务端在钱事务里写的（`lib/canvas-thread-log.ts`），
   * 本地 `messages` 里没有 —— 而下面那扇观察窗的开关（`hasWorkingJob`）恰恰要求本地先有
   * 一张带 genJobId 的卡才启动。「要 refetch 才有的东西」被「有了才 refetch」挡住，于是
   * 商家在画布上按下 Create variations，节点都失败了，这边还写着上一轮的 Done，刷新才诚实。
   *
   * 这一格只报事实（板上有在飞的付费卡），不带任何画板状态：它翻 true 就立刻回库读一次
   * 并把观察窗重新上膛，翻 false（终态到了）再读一次 —— 同一扇窗、同一套档位，不新起
   * 第二只计时器。
   */
  canvasJobActive?: boolean;
  /** Streaming front door: a first message to auto-send ONCE into a freshly-created
   *  (empty) thread on mount. The thread row already exists (createEmptyCoworkThread),
   *  so the route's existing-thread branch handles it. */
  pendingFirst?: {
    text: string;
    goalKey?: string;
    entityIds?: string[];
    /** FRONT-A10:第一句话 `@` 到的对象(类型化 ID),落进 ChatMessage.referenceRefs 供回链。 */
    references?: string[];
    /** 起步页在 Create 上挂的素材(规格 §7.3⑨)。首轮走的是与手动送出**同一份**
     *  `composerReferencePayload` 映射,不另开一条引用通道。 */
    sourceGenerationIds?: string[];
    referenceVideoGenerationIds?: string[];
  };
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

/**
 * FSE-003 复修轮四（判官 2026-09-08 P2）—— 卡上那颗 Send 被「上一轮还在飞」挡下，而输入框里
 * 商家正打着下一句。从前这一刻把卡的原话直接塞进输入框，他打的字无声消失；现在输入框原样
 * 不动，由这一句说出那颗键为什么没反应，并点名那个真能修好它的动作（等这一轮跑完再按一次）。
 */
export const COMPOSER_BUSY_NOTICE =
  "Otto is still working on the last one — ask for that change again once it's done.";

/** The latest user message — the one this turn started from. */
function latestUserMessage(messages: OttoUiMessage[]): OttoUiMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

function messageText(message: OttoUiMessage | null): string {
  return (message?.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** The latest user message's text — what the strict route body needs for `text`. */
function latestUserText(messages: OttoUiMessage[]): string {
  return messageText(latestUserMessage(messages));
}

/**
 * FSE-004 —— 一轮失败之后的**重试草稿**：那句话 ＋ 那一轮的原引用 ＋ 源任务标识。
 *
 * 拿的是这一轮开头那条 USER 消息本身，而不是只读它的字：刷新之后它带着服务端解析过的
 * `references`（typed refs，可回链）与 `payload`（真正挂上路的媒体与元素）—— 也就是这一轮
 * 当初到底带了什么的**唯一权威记录**。走查的复现路径正是「失败 → 刷新 → Edit and retry」，
 * 那一刻客户端手上只剩这条消息。
 */
function retryDraftFrom(messages: OttoUiMessage[]): TurnReferenceDraft | null {
  const message = latestUserMessage(messages);
  const text = messageText(message);
  if (!text) return null;
  return turnReferenceDraftFromMessage(message, text);
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
  canvasJobActive = false,
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
  /** FSE-004:这一轮直播失败之后的重试草稿(那句话 ＋ 这一轮真正带着的引用)。 */
  const [retryDraft, setRetryDraft] = useState<TurnReferenceDraft | null>(null);
  /**
   * FSE-004 —— 从一轮失败里**恢复回来**的那份草稿的引用一半。
   *
   * 文字放回输入框（商家看得见、改得动），引用没有输入框可放，所以留在这里，随下一次送出
   * 一起上路，并在输入框上方以名字列出来 —— 「带回来了」与「没带回来」不能在屏幕上长得
   * 一模一样。送出（或商家自己清掉）之后归零。
   *
   * 恢复回来的每一件都会在服务端重新按当前 principal 解析：已删的 / 别家的会让那一轮被整轮
   * 拒绝并说出那一句，商家重新挑一件 —— 而不是稀里糊涂地拿到一次无条件生成。
   */
  const [restoredDraft, setRestoredDraft] = useState<TurnReferenceDraft | null>(null);
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
  /**
   * FSE-003 复修轮四：卡上那颗 Send 被「上一轮还在飞」挡下，而输入框里商家正在打字 ——
   * 那句话不能被覆盖，所以这一行代它说出「为什么没送出去」。下一次真送出时清掉。
   */
  const [composerBusyNotice, setComposerBusyNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSubmittedTextRef = useRef("");
  /** FSE-004:刚送出去那一轮的整份草稿 —— 直播失败时它就是重试草稿(文字 ＋ 引用)。 */
  const lastSentDraftRef = useRef<TurnReferenceDraft | null>(null);
  /** Codex QA-CRE-FE9-013:这一轮送出去的草稿与附件,留到**知道服务端收下了**为止。
   *  服务端因为某件参考取不到而整轮拒绝时,它们原样放回输入框(附件条里就是他要移掉的那一件);
   *  正常收尾或别的错误则在这里释放 —— blob 预览的 revoke 也跟着挪到那一刻,不然放回去的
   *  芯片会是一张已经被撤销的图。 */
  const lastSubmittedRef = useRef<
    {
      text: string;
      refs: AttachedReference[];
      /** FSE-002/004:这一轮**除附件之外**带的那份引用（`@` 到的、恢复回来的、卡上冻着的）。
       *  附件有芯片可以放回去，这一份没有 —— 不留着它，被退回的那一轮再送一次就悄悄少了它。 */
      turn: TurnReferenceDraft | null;
    } | null
  >(null);
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
          /** FSE-003/004:这一轮是「改那张卡」或「重试那一轮」时,源任务的消息 id。 */
          replyToMessageId?: string;
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
            // FSE-003/004:源任务标识。请求 schema 早就有这一格(`replyToMessageId`),所以
            // 「这一轮改的是哪张卡 / 重试的是哪一轮」在记录里说得出来,不必新开字段。
            ...(ids.replyToMessageId ? { replyToMessageId: ids.replyToMessageId } : {}),
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
        // FSE-004:重试草稿是**整份**的 —— 只把文字放回去,再送一次就是一次无条件生成。
        setRetryDraft(e.kind === "error" ? liveRetryDraft(lastSentDraftRef.current) : null);
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
   * FSE-004 复修轮三(判官 2026-09-08 P1)—— **直播那一刻**那份重试草稿,一个作者两条失败路。
   *
   * 一轮可以死在两个地方,而从前只有一个地方给得出重试草稿:
   *
   *   · 流开着时服务端判死(`data-error`)—— 这条路早就设 `retryDraft`;
   *   · 流**还没打开**就断了(`status === "error"`:网络断、解析炸,以及本片自己新造的
   *     「有一件参考取不到」那条 400)—— 这条路一次都不设。
   *
   * 于是画布那颗 Edit and retry 在传输级失败之后只读得到落库消息那一份,而直播那一刻手上
   * 那条 USER 消息只是 `sendMessage({text})` 的乐观回显(`metadata` 一格都没有)——
   * 放回去的就是「那句话 ＋ 零引用」,而屏幕上一个字都不说。下一次送出就是一次无条件生成。
   *
   * `source` 是这一轮**真正带了什么**的现场记录:传输级那两条路各自给的不一样(见下面
   * 那个 effect),所以判断留在调用处,这里只负责「没有现场记录时也别把文字弄丢」。
   */
  function liveRetryDraft(source: TurnReferenceDraft | null): TurnReferenceDraft | null {
    if (source) return source;
    return lastSubmittedTextRef.current
      ? { text: lastSubmittedTextRef.current, refs: EMPTY_TURN_REFERENCES, labels: [], sourceMessageId: null }
      : null;
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
    const draft = lastSubmittedRef.current;
    if (!sentence) {
      releaseSubmitted();
      // FSE-004 复修轮三:附件的芯片跟着 `releaseSubmitted` 一起没了(blob 预览已撤销),
      // 所以这一路的重试草稿是**合过附件的整份**(`lastSentDraftRef`)—— 输入框里此刻
      // 一件引用都没有,不整份放回去就是少了。
      setRetryDraft(liveRetryDraft(lastSentDraftRef.current));
      return;
    }
    lastSubmittedRef.current = null;
    // 与卡上那个计时器同一条写法(`OttoPlanCard` 的 `queueMicrotask(() => setElapsed(0))`):
    // 在 effect 里同步 setState 会把这一帧再渲染一遍,而这里三个更新本来就属于同一次「放回去」。
    queueMicrotask(() => {
      setAttachError(sentence);
      // FSE-004 复修轮三:这一路的附件**已经原样回到附件条**,所以重试草稿只取附件之外
      // 那一份(`draft.turn`)。放合过附件的那一份进去,商家移掉取不到的那件芯片之后再送,
      // 它还会从这份草稿里悄悄爬回请求体 —— 那正是这颗键该拦的事。
      setRetryDraft(liveRetryDraft(draft?.turn ?? null));
      if (!draft) return;
      setText((current) => (current.trim() ? current : draft.text));
      setAttachedRefs((current) => (current.length ? current : draft.refs));
      // FSE-002/004:附件之外那一份引用也要回到原处。少了这一步,被「有一件参考取不到」退回的
      // 那一轮再按一次送出就是一次**无条件生成** —— 商家读到的是「移掉那一件再试」,而系统悄悄
      // 把剩下那几件也一起丢了。他现在看得见它们还在,移掉那一件(或整块清掉)再送。
      if (draft.turn && hasTurnReferences(draft.turn.refs)) setRestoredDraft(draft.turn);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const isStreaming = status === "streaming";
  const isBusy = status === "submitted" || status === "streaming";
  // 送出那一下的闸,键盘与发送键读同一个判据(判官 #1242)。`isBusy` 只说「这一轮还在路上」,
  // 而一张还在传的参考此刻还没有 generationId —— 让 Enter 抢在它前面送出,那件参考就无声不上车。
  // 起步页 `StartSomething.tsx` 的 `busy = pending || uploading` 是同一个形状。
  const composerBusy = isBusy || uploading;

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
  // FSE-005：本地列表说的「有活在跑」，与画板说的那一句，是同一个判据的两个来源。画布
  // 直接动作的卡还没被读回来之前，只有画板知道钱已经花出去了。
  const hasWorkingJob = computeHasWorkingJob(messages, cancelledJobIds) || canvasJobActive;

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
      // 断网时这一读会被拒（服务端动作打不通）。窗不因此熄火：下一格照问，网回来的那一格
      // 自己收敛（FSE-005 的第四态）。
      void pollAndInjectResults().catch(() => undefined);
    }, gear.intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkingJob, thread.id, pollGear, pollNonce]);

  // FSE-005 —— 画布直接动作那条路的开跑与收工，就是这一句话的两端。
  //
  // 翻 true：钱已经在服务端的那笔事务里花掉了，USER 请求句与那张已批准的卡也已经落库，
  // 而本地列表一无所知 —— 立刻读一次把它们接回来（读回来之后 `hasWorkingJob` 就由消息
  // 自己接手）。翻 false：终态到了 —— 再读一次，结果／失败／退款那一条与余额一起落地。
  // 两端都把观察窗重新上膛（免得上一轮用剩的额度被这一次继承，与送出那一刻同一句话），
  // 走的都是**已有**的那一条路（`pollAndInjectResults` → `mergeDurableIntoLive`）：
  // 不新起第二只计时器，也不用整页刷新掩盖。
  const prevCanvasJobActiveRef = useRef(false);
  useEffect(() => {
    if (prevCanvasJobActiveRef.current === canvasJobActive) return;
    prevCanvasJobActiveRef.current = canvasJobActive;
    rearmGenerationPoll();
    void pollAndInjectResults().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasJobActive, thread.id]);

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
      {
        body: {
          projectId,
          threadId: thread.id,
          ...(pendingFirst.goalKey ? { goalKey: pendingFirst.goalKey } : {}),
          ...(pendingFirst.entityIds?.length ? { entityIds: pendingFirst.entityIds } : {}), // F30: carry entity conditioning into the first streamed turn
          // FRONT-A10:第一句话 `@` 到的对象也进首轮 —— 少了这一格,从前门开出来的每一条对话
          // 从第一句起就没有引用可回链。
          ...(pendingFirst.references?.length ? { references: pendingFirst.references } : {}),
          // FRONT §7.3⑨:起步页挂的素材也进首轮。走的是手动送出用的**那一个**映射函数,
          // 所以「一件参考在 body 里长什么样」全仓只有一个作者。
          ...composerReferencePayload([
            ...(pendingFirst.sourceGenerationIds ?? []).map((generationId) => ({ generationId, kind: "image" as const })),
            ...(pendingFirst.referenceVideoGenerationIds ?? []).map((generationId) => ({ generationId, kind: "refVideo" as const })),
          ]),
        },
      },
    );
    onPendingFirstSent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFirst]);

  /**
   * FSE-002/003/004 —— **送出这一轮**：一条路，三个入口（输入框、确认卡的 Send、重试后的重送）。
   *
   * 从前只有输入框这一个入口，于是确认卡那颗 Send 走不通就干脆什么都不做（FSE-003），而重试
   * 只把文字塞回输入框（FSE-004）。三件事各自接线的代价是三种「这一轮到底带了什么」。现在
   * 引用的形状与到请求体的映射都只有一份（`lib/turn-reference-draft.ts`），这里只负责这一轮
   * 的善后：锁、清空、重装轮询、失败时把草稿与附件放回原处。
   *
   * **双击不重复**：`submitLockRef` 与 `composerBusy` 是同一道闸，三个入口共用它 —— 所以
   * 「Send 按两下」与「Enter 按两下」在这里是同一件事，只送一轮。
   *
   * **`composerOwned`（判官 2026-09-08 P2）**：这一轮是不是从输入框开出来的。
   * 输入框那一份状态（那句半成品、`@` 挑好的对象、附件条、恢复回来的引用）属于**商家此刻
   * 正在打的下一句**，不属于这一轮。确认卡那颗 Send 走的是自己的一份草稿（卡上冻着的引用
   * 与卡的原话），它既不读也不清输入框 —— 从前它照着输入框那条路走，于是商家一边打字一边
   * 按下卡上的 Send，打了一半的那句话**无声消失**，附件也跟着被这一轮吃掉。
   */
  function sendTurn(
    draft: {
      text: string;
      refs: TurnReferences;
      /** 商家读得懂的名字（有就带上）—— 只用于失败之后那一行「References kept: …」。 */
      labels?: string[];
      sourceMessageId?: string | null;
    },
    composerOwned = true,
  ): boolean {
    const trimmed = draft.text.trim();
    if (!trimmed || composerBusy || submitLockRef.current) return false;
    submitLockRef.current = true;
    lastSubmittedTextRef.current = trimmed;
    if (composerOwned) {
      setText(""); // clear the composer immediately; sendMessage echoes the user msg
      picker.clearPicked();
      setRestoredDraft(null);
    }
    // Reset ephemeral stream state for the new turn.
    setLiveStatus(null);
    setStepEvents([]);
    setStreamError(null);
    setStreamErrorKind(null);
    setRetryDraft(null);
    setAttachError(null);
    setComposerBusyNotice(null);
    // A new turn may queue a new generation — re-arm polling.
    rearmGenerationPoll();
    // Capture and clear attachments before send. The local preview blob URLs are NOT revoked
    // here any more (QA-CRE-FE9-013): the server can still refuse this whole turn because one of
    // these references is gone, and the chips have to go back into the composer intact. They are
    // revoked the moment the turn is known to have been accepted (onFinish) or to have failed for
    // any other reason — `releaseSubmitted()`.
    // 附件条也属于输入框（判官 P2）：卡上那颗 Send 不吃商家挂着等下一句用的那几件。
    const attachedNow = composerOwned ? attachedRefs : [];
    const carried: TurnReferenceDraft = {
      text: trimmed,
      refs: draft.refs,
      labels: draft.labels ?? [],
      sourceMessageId: draft.sourceMessageId ?? null,
    };
    lastSubmittedRef.current = { text: trimmed, refs: attachedNow, turn: carried };
    if (composerOwned) setAttachedRefs([]);
    // 附件那一份的作者仍是 `composerReferencePayload`；这里只是把它并进同一份形状，
    // 不是拿它去覆盖 —— 覆盖正是「@ 的图与挂的图只剩一份」那一类缺陷的做法。
    const refs = mergeTurnReferences(
      draft.refs,
      turnReferencesFromComposerPayload(composerReferencePayload(attachedNow)),
    );
    // FSE-004:这一轮**真的带了什么**,原样留着。直播失败时它就是重试草稿,不必再猜一次。
    lastSentDraftRef.current = {
      text: trimmed,
      refs,
      // 附件那几件自己就有名字(芯片上那一行),`@` 到的那几件的名字要等服务端解析才回得来 ——
      // 所以这里只念得出名字的那几件,念不出的由「N references kept」兜底,绝不编一个名字。
      labels: [...(draft.labels ?? []), ...attachedNow.map((r) => r.label)].filter(Boolean),
      sourceMessageId: draft.sourceMessageId ?? null,
    };
    void Promise.resolve(
      sendMessage(
        { text: trimmed },
        {
          body: {
            projectId,
            threadId: thread.id,
            ...turnReferenceBody(refs),
            ...(draft.sourceMessageId ? { replyToMessageId: draft.sourceMessageId } : {}),
          },
        },
      ),
    ).catch(() => {
      submitLockRef.current = false;
    });
    return true;
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || composerBusy || submitLockRef.current) return;
    // FRONT-A10:「这条消息提到了谁」—— 与 entityIds(生成条件)是两条路,一起上行。
    // FSE-004:恢复回来的那一份也在这里合流 —— 商家改完那句话再送,原引用照旧跟着走。
    const fromComposer: TurnReferences = {
      entityIds: picker.entityIdsForSend(trimmed),
      references: picker.referencesForSend(trimmed),
      sourceGenerationIds: [],
      referenceVideoGenerationIds: [],
    };
    sendTurn({
      text: trimmed,
      refs: mergeTurnReferences(fromComposer, restoredDraft?.refs ?? EMPTY_TURN_REFERENCES),
      labels: restoredDraft?.labels ?? [],
      sourceMessageId: restoredDraft?.sourceMessageId ?? null,
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

  /**
   * 确认卡那张小表单送回来的那句话,落进输入框(清单 A5 / P2-013)。
   *
   * 从前这里收到的是**这张卡的原话**(送给供应商的那段机器措辞),商家得自己在它上面改;
   * 现在收到的是 `changeRequestSeed` 拼好的那一份 —— 他写的那句在前,卡的原话跟在后面。
   * 这一层一个字都不改它:拼句子的口径住在 `CardOptionControls.tsx`,两处各拼一遍就是
   * 第二份口径。抽屉里那张卡与画布上那张确认卡按的仍是同一个动作,所以它只有一份实现。
   */
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

  /**
   * FSE-004 —— 「Edit and retry」：那句话回输入框，原引用留在 `restoredDraft` 等着一起上路。
   *
   * 刻意**不**发送：商家按这颗键就是因为上一次没成，他要先改。发送在他自己按下之后。
   *
   * 复修轮四（判官 2026-09-08 P3）——「回输入框」只在输入框**是空的**时候发生，与那条 400
   * 放回文字的口径逐字相同（`setText(current => current.trim() ? current : draft.text)`）。
   * 商家按下这颗键之后改过的那句话（或者他此刻正在打的下一句）不是任何一条恢复路径的空地：
   * 覆盖回原话，屏幕上没有一处说过他改的字去哪了。引用照旧回来 —— 它们不占输入框。
   *
   * 返回值＝那句话有没有真的放回去，调用处据此决定要不要另外说一句。
   */
  function restoreDraft(draft: TurnReferenceDraft): boolean {
    const seeded = !text.trim();
    if (seeded) seedComposer(draft.text);
    setRestoredDraft(hasTurnReferences(draft.refs) ? draft : null);
    return seeded;
  }

  /**
   * FSE-003 —— 确认卡那张小表单按下「Send to Otto」：**真发送**。
   *
   * 走查里这颗键只往输入框里塞了一段字，没有新消息、没有回复，而键上写着 Send。送不出去时
   * （上一轮还在飞、闸锁着）退回从前那个行为：草稿落进输入框，商家自己按下去 —— 那是一个
   * 他看得见的状态，不是又一次「按了没反应」。
   */
  function sendChangeRequest(draft: TurnReferenceDraft) {
    if (sendTurn(draft, false)) return;
    // 没送出去只有两种原因。上一轮还在飞（`composerBusy`）——那是商家看得见的状态，草稿交还
    // 给他，他自己按下去。另一种是双击的第二下：闸还锁着，而第一下**已经送出去了** ——
    // 那一下什么都不做，不然一次双击既送出一轮、又把同一段字塞进输入框（判官 P2 的另一半）。
    if (!composerBusy) return;
    // 复修轮四（判官 2026-09-08 P2）：交还草稿从前是**无条件**往输入框里塞 —— 商家一边打
    // 下一句、一边在卡上按 Send 被闸挡下，他打了一半的那句话当场被卡的原话换掉，而屏幕上一个
    // 字都不说。输入框有字就不动它，改成说出那颗键为什么没送出去；引用照旧留在 `restoredDraft`。
    if (!restoreDraft(draft)) setComposerBusyNotice(COMPOSER_BUSY_NOTICE);
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
  // FSE-004 复修轮(判官 2026-09-08 P1-2):**两个**来源,带得动引用的那一份赢。
  // 直播那一刻手上那条 USER 消息只是 `sendMessage({text})` 的乐观回显(没有 metadata),
  // 所以只读它的话,「没刷新就点 Edit and retry」会一件引用都不带回来 —— 而画布形态下抽屉
  // 是折起的,那张会说话的告示商家根本看不见,于是下一次送出就是一次无条件生成。
  // 齐全的那一份一直就在 `lastSentDraftRef`(经 `retryDraft` state),这里把它接上。
  const canvasRetryDraft =
    turnTerminal?.outcome === "failed" && turnTerminal.error?.kind === "error"
      ? richerTurnReferenceDraft(retryDraftFrom(messages), retryDraft)
      : null;
  // 出路按**类型**分岔(#1225 判官残留):充值那一种给 Top up、上限那一种给 Open Billing &
  // credits、供应商侧那一档一个键都不给。判据与抽屉里那张告示逐字同一个,卡自己不解析措辞。
  const canvasErrorKind: OttoErrorData["kind"] | null =
    turnTerminal?.outcome === "failed" ? turnTerminal.error?.kind ?? null : null;
  const canvasLayout = layout === "canvas";
  // FSE-004:输入框上方那一行(「References kept: …」)。没有恢复回来的引用就一个字都不说。
  // 复修轮四:附件条上已经看得见的那几件不在这一行里再数一遍 —— 一件东西在屏幕上说两次,
  // 商家会以为它上了两次车(而请求体里 `mergeTurnReferences` 早就把它收敛成一件)。
  const restoredNote = restoredDraft
    ? restoredReferencesNote(restoredDraft, {
        ids: attachedRefs.map((ref) => ref.generationId),
        labels: attachedRefs.map((ref) => ref.label),
      })
    : null;

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
          onApproved={({ cardId: approvedCardId, chained, approved = true }) => {
            // 与抽屉里那张卡按下去之后**逐字相同**的善后:同一份 pending 集合合并规矩、
            // 同一次轮询重装、同一条注入路径。两个按钮,一套状态机。
            // FSE-012（判官第 6 轮 P1）:`approved:false` = 报价被拒的那一趟。链上事实照落,
            // 但这张卡什么都没生成 —— 标成已提交会让它显示成「在跑」并埋掉它自己的按钮。
            if (approved && !chained?.pendingCardIds.includes(approvedCardId)) {
              setSubmittedCardIds((cur) => new Set(cur).add(approvedCardId));
            }
            setPendingApprovalCardIds((cur) =>
              nextPendingApprovalCardIds(cur, approved ? [approvedCardId] : [], chained?.pendingCardIds),
            );
            rearmGenerationPoll();
            void pollAndInjectResults(
              chained?.narrationMessageId ? [chained.narrationMessageId] : undefined,
            );
          }}
          onChangeSomething={sendChangeRequest}
          onEditAndRetry={restoreDraft}
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
              title={`Start a new conversation in this ${PRODUCT_VOCABULARY.canvas}`}
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
                    onApproved={({ cardId: approvedCardId, chained, approved = true }) => {
                      // The card hands up WHICH card this was and the SERVER's result —
                      // both facts come from the response, not from this closure (P1-4).
                      // Record submission so the card flips to queued optimistically —
                      // unless the server reports THIS card as still pending (chained).
                      // FSE-012（判官第 6 轮 P1）:报价被拒的那一趟也会走到这里(它带着链上
                      // 事实),那时 `approved` 是 false —— 什么都没生成的卡不许被标成已提交。
                      if (approved && !chained?.pendingCardIds.includes(approvedCardId)) {
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
                        nextPendingApprovalCardIds(cur, approved ? [approvedCardId] : [], chained?.pendingCardIds),
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
                    onChangeSomething={sendChangeRequest}
                    onSeedComposer={seedComposer}
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
              // FSE-004:刷新之后点 Edit and retry 走的正是这一支。落库那条 USER 消息上两格齐全
              // (服务端解析过的 typed refs ＋ 这一轮挂上路的媒体),所以草稿是**整份**的。
              const failedUserMessage = durableError.kind === "error" && failedUserMessageId
                ? thread.messages.find((message) => message.id === failedUserMessageId && message.role === "USER") ?? null
                : null;
              const durableRetryDraft = failedUserMessage
                ? turnReferenceDraftFromMessage(failedUserMessage, failedUserMessage.text)
                : null;
              return (
                <ConversationItem key={m.id} messageId={m.id} animateIn={isNewMessage(m.id)}>
                  <OttoStreamErrorNotice
                    error={durableError}
                    retryDraft={durableRetryDraft}
                    onRetry={restoreDraft}
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
                      // FSE-004 复修轮:与画布那颗键同一条规矩 —— 带得动引用的那一份赢。
                      // 直播那一份(`retryDraft`)只属于**最后**那一轮,所以只在最后一条上兜底;
                      // 拿它去补一条更早的失败,补进去的就是别人那一轮的引用。
                      retryDraft={
                        partError.kind === "error"
                          ? richerTurnReferenceDraft(
                              retryDraftFrom(messages.slice(0, mi + 1)),
                              mi === messages.length - 1 ? retryDraft : null,
                            )
                          : null
                      }
                      onRetry={restoreDraft}
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
                  restoreDraft(draft);
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

          {/* FSE-003 复修轮四 —— 卡上那颗 Send 被「上一轮还在飞」挡下,而输入框里商家正打着
              下一句:那句话原样留着,没送出去这件事由这一行说出口(从前它无声无息)。 */}
          {composerBusyNotice && (
            <div
              data-slot="composer-busy-notice"
              role="status"
              className="mb-2 text-[0.75rem] text-muted-foreground"
            >
              {composerBusyNotice}
            </div>
          )}

          {/* FSE-004 —— 从一轮失败里带回来的那几件引用。那句话回了输入框,这一行说的是「它们也
              回来了」:少了这一行,「带回来了」与「没带回来」在屏幕上长得一模一样,而照后者
              再送一次就是一次商家没要过的无条件生成。他也可以在这里把它们全部去掉。 */}
          {restoredNote && (
            <div
              data-slot="restored-references"
              className="mb-2 flex items-center gap-2 text-[0.75rem] text-muted-foreground"
            >
              <span className="min-w-0 truncate">{restoredNote}</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => setRestoredDraft(null)}
              >
                Remove references
              </Button>
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
                          {`Choose from ${PRODUCT_VOCABULARY.library}`}
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
                  <InputGroupButton variant="default" size="sm" disabled={composerBusy || !text.trim()} onClick={submit}>
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
