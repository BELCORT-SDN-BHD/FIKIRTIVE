"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReactFlow, Background, type Edge, type Node, type NodeChange, applyNodeChanges, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode, imageNodeActionable } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode, type CanvasTextSaveOutcome } from "./nodes/TextNode";
import {
  useCanvasGen,
  isInFlightPaidGen,
  freshCanvasActionId,
  loadCanvasActionReceipts,
} from "./useCanvasGen";
import { toast } from "@/components/ui/toast";
import { listCanvasNodes, moveCanvasNode, deleteCanvasNode, updateTextNode, createCanvasNode, type CanvasNodeDTO } from "../../lib/canvas-actions";
import { uploadReference } from "../../lib/actions";
import { syncOttoCanvasNodes } from "../../lib/otto-canvas-bridge";
import { OttoCanvasStatus } from "../otto/OttoTrace";
import { UnderstandingCostHint } from "@/components/otto/UnderstandingCostHint";
import DetailPanel from "@/components/asset/DetailPanel";
import { MentionInput } from "@/components/MentionInput";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Hand, Maximize2, MousePointer2, RefreshCw, Type, Video, ZoomIn, ZoomOut } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TooltipButton } from "@/components/ui/tooltip-button";
import { cn } from "@/lib/utils";
import type { EntityDTO } from "@/lib/types";
import { convoColor } from "@/lib/convo-canvas";
import { creditsLabel } from "@/lib/credit-format";
import {
  CANVAS_IMAGE_DEFAULT_COUNT,
  genCostHint,
  type CanvasGenCostQuote,
} from "@/lib/canvas-gen-costs";
import {
  CANVAS_CARD_GAP,
  canvasBatchFootprint,
  nearestFreeCanvasSlot,
  nextCanvasSpawnOrigin,
  type CanvasRect,
} from "@/lib/canvas-batch-layout";
import { buildCanvasLineageEdges, type CanvasNodeLineage } from "@/lib/canvas-lineage";
import { VideoSpecPicker } from "@/components/gen/VideoSpecPicker";
import type { CanvasVideoSpecs } from "@/components/canvas/useCanvasGen";
import type { VideoSpec } from "@/lib/video-spec";
import {
  canvasBatchFrameLabel,
  canvasBatchGroups,
  canvasComparePair,
  canvasRecordedFacts,
} from "@/lib/canvas-batch-identity";
import { buildCanvasLineageTree } from "@/lib/canvas-lineage-tree";
import { CanvasLineagePanel } from "./CanvasLineagePanel";
import { CanvasComparePanel, type CanvasCompareCard } from "./CanvasComparePanel";
import {
  CANVAS_DIALOG_SELECTOR,
  CANVAS_EDITABLE_SELECTOR,
  canvasBatchDeleteCopy,
  canvasBatchSelection,
  canvasDeleteKeyIds,
  canvasDownloadFileName,
  mergeReloadedCanvasNodes,
} from "@/lib/canvas-selection";
import {
  CANVAS_FIT_EMPTY_RECT,
  CANVAS_FIT_OVERLAY_SELECTORS,
  canvasFitPadding,
  canvasFitPaddingPx,
  type CanvasFitPaddingPx,
} from "@/lib/canvas-fit-padding";
import { isTerminalCardStatus } from "@/lib/canvas-card-status";
import { sameOriginDownloadUrl } from "@/lib/download-url";
import {
  CANVAS_OTTO_CHAT_REQUIRED,
  canvasComposerReferenceForNode,
  canvasSendToOttoTitle,
  type OttoComposerReference,
} from "@/lib/canvas-chat-reference";
import {
  canvasMediaNodeSize,
  canvasTerminalNodeSize,
  DEFAULT_CANVAS_MEDIA_NODE_SIDE,
  hasCanvasNodeSizeChanged,
  type CanvasMediaDimensions,
} from "@/lib/canvas-node-size";

type CanvasFlowNode = Node & {
  threadId: string | null;
  /** Which paid press produced this card — the key every same-batch frame groups on. */
  genJobId?: string | null;
  /** The card this one's paid job was made FROM — the only thing that draws a line (#603 T4). */
  madeFromNodeId?: string | null;
  /** Batch identity as the server settled it. Position and size, never a coordinate or a count. */
  batchIndex?: number | null;
  batchSize?: number | null;
};
const CANVAS_CARD_SIDE = 320;
/**
 * WHAT THE BOARD SAYS WHEN A WRITE NEVER REACHED THE SERVER (接线盘点 L1 · FRONT-A12).
 *
 * Every canvas write that can now be reported answers with the SERVER'S own sentence when there
 * is one ("Not authorized.", "Project not found.", "Node not found."). This is the other case:
 * the action threw, so there is no server sentence to quote — the request never got an answer at
 * all. It is not a new piece of product copy; it is the sentence this product already gives a
 * merchant for exactly that (`lib/memory-actions.ts`, `lib/schedule-actions.ts`,
 * `lib/brand-record-actions.ts`), reused so the canvas does not become the one surface that says
 * the same thing differently.
 */
const CANVAS_SAVE_FAILED = "Couldn't save that — please try again.";
/**
 * #643 T2 —— 一张卡默认会交付的形状：它自己记着的那一格（板子读回来的 lineage），
 * 记不到就退回输入条当前的形状。纯函数：只看传进来的这张卡，不碰任何 ref。
 */
function recordedImageShape(
  node: { data?: unknown } | undefined,
  fallback: string | null,
): string | undefined {
  const lineage = (node?.data as { lineage?: CanvasNodeLineage | null } | undefined)?.lineage;
  return (lineage?.settings.aspectRatio || fallback) ?? undefined;
}
/** What a card calls itself when it takes keyboard focus (#604 r2 P3). */
function canvasNodeAriaLabel(n: { type?: string; data?: unknown }): string {
  const kind = n.type === "video" ? "Video card" : n.type === "text" ? "Text card" : "Image card";
  const d = n.data as { prompt?: string | null; text?: string | null } | undefined;
  const said = (d?.prompt ?? d?.text ?? "").trim();
  if (!said) return kind;
  return `${kind}: ${said.length > 60 ? `${said.slice(0, 60)}…` : said}`;
}
/**
 * How long a finished JOB waits before the board is re-read for its traceability record.
 *
 * The card's record is written server-side while the card is being placed, so this short wait
 * lets that settle. It also coalesces two jobs finishing together into one read. It is NOT what
 * makes a batch cost one read — that is the job-level signal (`onBatchSettled`) this timer hangs
 * off; a batch places its cards a server round trip apart, which is longer than any window worth
 * waiting, so per-card triggering read the board once per card (r3 review P2-1).
 */
const LINEAGE_RELOAD_COALESCE_MS = 600;
type CanvasMediaSize = Required<Pick<CanvasMediaDimensions, "width" | "height">>;
type FlowCanvasProps = {
  projectId: string;
  entities?: EntityDTO[];
  activeThreadId?: string | null;
  activity?: Set<string>;
  skin?: "gb";
  onBalanceRefresh?: () => void | Promise<void>;
  onActivityRefresh?: () => void | Promise<void>;
  onReferenceInChat?: (refs: Omit<OttoComposerReference, "requestId">[]) => void;
};

// Must be stable (defined outside component) per ReactFlow requirements
/**
 * The frame drawn around the cards of ONE paid press (#603 T4 · spec #599 D5).
 *
 * A merchant who writes one sentence and gets four pictures got four pictures — not a mother and
 * three daughters. The board used to say the second, third and fourth "came from" the first and
 * drew the lines to prove it. Same batch is a frame; made from is a line; they are different
 * things and now they look different. Purely decoration: never picked, never dragged, never
 * deleted, and always behind the cards it holds.
 */
export function BatchFrameNode({ data }: { data: { label: string } }) {
  return (
    <div
      aria-hidden
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 18,
        border: "1px dashed var(--muted-foreground, #9ca3af)",
        opacity: 0.55,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          // Top-RIGHT, not top-left: every card wears its own type pill above its left corner,
          // and a frame label there lands on top of the first card's pill.
          top: -10,
          right: 12,
          zIndex: 1,
          padding: "0 8px",
          borderRadius: 999,
          background: "var(--card, #fff)",
          font: "500 10px/16px ui-monospace, monospace",
          color: "var(--muted-foreground, #6b7280)",
          whiteSpace: "nowrap",
        }}
      >
        {data.label}
      </span>
    </div>
  );
}

const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode, batchFrame: BatchFrameNode };

/** A board read that came back as a list of cards this component can actually place. */
type CanvasBoardRead =
  | { rows: Array<CanvasNodeDTO & { url?: string | null }> }
  /** Anything else at all. The board keeps its cards; the tree says it cannot confirm them. */
  | { unavailable: true };

/** Everything a card must carry for the board to place it. Anything short of this is not a card. */
function isPlaceableCanvasRow(row: unknown): boolean {
  if (typeof row !== "object" || row === null) return false;
  const card = row as Record<string, unknown>;
  return typeof card.id === "string" && card.id.length > 0
    && typeof card.type === "string"
    && ["x", "y", "w", "h"].every((key) => Number.isFinite(card[key]));
}

/**
 * One board read, with every way it can fail folded into one answer.
 *
 * The two reads answer a refusal as `{ error }`; a transport failure throws; and a read can also
 * come back as something that is not a list of cards at all. All three used to be handled
 * differently and two of them badly (#605 r1 judge P2-1): a thrown read was swallowed whole, so
 * the tree carried on drawing relationships nobody had confirmed since; `null` threw again inside
 * the caller; and a non-list object was first declared readable and only then blew up mid-render,
 * leaving the previous relationships on screen with no sign anything was wrong.
 *
 * So the shape is checked here, once, and a read is either a list of placeable cards or it is
 * unavailable. Fail-closed: the cards are paid work and stay on the board, but nothing is said
 * about how they relate until a read can actually say it.
 */
async function readCanvasBoard(
  skin: "gb" | undefined,
  projectId: string,
): Promise<CanvasBoardRead> {
  let answer: unknown;
  try {
    answer = skin === "gb"
      ? await syncOttoCanvasNodes(projectId)
      : await listCanvasNodes(projectId);
  } catch {
    return { unavailable: true };
  }
  if (!Array.isArray(answer) || !answer.every(isPlaceableCanvasRow)) return { unavailable: true };
  return { rows: answer as Array<CanvasNodeDTO & { url?: string | null }> };
}
/** How far the same-batch frame stands off the cards it holds. */
const BATCH_FRAME_PAD = 14;
const CANVAS_REF_MAX_BYTES = 10 * 1024 * 1024;

export default function FlowCanvas({
  projectId,
  entities = [],
  activeThreadId = null,
  activity,
  skin,
  onBalanceRefresh,
  onActivityRefresh,
  onReferenceInChat,
}: FlowCanvasProps) {
  const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
  // holds the generationId whose detail panel is open (null = closed)
  const [detailFor, setDetailFor] = useState<string | null>(null);
  // Canvas tool: pan (grab hand, drag pans the board) vs select (arrow cursor,
  // drag box-selects). The toolbar's cursor button toggles this. Display-only.
  const [panMode, setPanMode] = useState(true);
  // Deleting a canvas card asks for confirmation first (they were too easy to
  // remove by accident). Holds the node id awaiting confirm; null = no dialog.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Same confirm, for a whole multi-card selection (#547 B6). Holds the ids awaiting
  // confirm; null = no dialog.
  const [pendingBatchDeleteIds, setPendingBatchDeleteIds] = useState<string[] | null>(null);
  // #643 T2：一张卡「再来一张」默认交付的形状。菜单与默认值都来自服务端（`imageShapes`）——
  // 界面一格都不写死。ENGINE-A3(⑦段)退役直出 composer 之后，这份菜单在画布上只剩这一个
  // 读者：`nodeImageShape` 用它当「这张卡没记形状」时的兜底档。要换形状请在对话里说，
  // Otto 把它写进确认卡。
  const [imageShape, setImageShape] = useState<string | null>(null);

  // #645 T4：这条片子的规格（长度 / 清晰度 / 形状）。菜单、默认档与每一档的价格都来自
  // 服务端解析（`videoSpecs`）—— 界面一格都不写死，一分钱都不自己算。
  // t2v 与 Animate 各记各的：前者默认 16:9，后者默认 Adaptive（跟着首帧走），两条路的
  // 默认值不同，混用一个 state 就会把其中一条悄悄改成另一条的默认值。
  const [videoSpecMenu, setVideoSpecMenu] = useState<CanvasVideoSpecs | null>(null);
  const [t2vSpec, setT2vSpec] = useState<VideoSpec | null>(null);
  const [animateSpec, setAnimateSpec] = useState<VideoSpec | null>(null);
  // Making a video costs credits — clicking "Make video" opens a confirm first.
  // Holds the source image node id awaiting confirm; null = no dialog.
  const [pendingAnimateId, setPendingAnimateId] = useState<string | null>(null);
  // Motion choice for the "Make a video?" dialog (Phase 1a). Custom falls back to
  // the gentle default so the paid prompt is never empty.
  const [motion, setMotion] = useState<"gentle" | "dynamic" | "custom">("gentle");
  const [customMotion, setCustomMotion] = useState("");
  // Dragging an image file over the canvas (drop = upload it as an image node).
  const [dragOver, setDragOver] = useState(false);
  // The lineage tree — "where did this card come from?" — for whichever single card is picked
  // (#605 T6). Display state only: it opens on request and reads the facts already on the board.
  const [lineageOpen, setLineageOpen] = useState(false);
  // The last board read failed, so nothing on screen can be confirmed as current. The tree says
  // "unavailable" rather than keep drawing relationships from a snapshot that may be stale
  // (#605 验收③, fail closed). Cleared by the next read that lands.
  const [lineageUnavailable, setLineageUnavailable] = useState(false);
  // Two cards being looked at side by side. Holds their ids; null = no comparison open.
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);
  // double-submit guard
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  /** 哪张卡的付费图片动作正在被接受（「再来一张」是这条路上唯一的按键 —— 卡下方那条
   *  改写输入条按 Founder 2026-09-03 裁决①已退场）。 */
  const [pendingImageAction, setPendingImageAction] = useState<{ nodeId: string } | null>(null);
  /**
   * QA-CRE-FE9-001（Founder 2026-09-04 07:05 裁决）——「Create variations」按下去的**意图**，
   * 还不是一次付费动作。这一格里没有 action id、没有预留、没有 job：它只是这张卡此刻要送去的
   * 那份材料，等商家在确认卡上按 `Generate · N credits` 才交给 `runImageEvolve`。
   *
   * 这条路此前走的是宪法例外①「余额即闸」（图片直出、不弹确认，Founder 2026-07-06 拍板）。
   * 变体这一条按 07:05 裁决回到设计权威的 variation journey
   * （`design-system/patterns/canvas/stitch-image-video-parity-spec.md:149`
   *   `Select image → Variations → count/range/aspects → confirmation → side-by-side variants`）；
   * 创作输入条那条直出路不在本次裁决范围内，一格没动。
   */
  const [pendingVariant, setPendingVariant] = useState<
    { nodeId: string; prompt: string; aspect?: string; sourceUrl?: string } | null
  >(null);
  const [costQuote, setCostQuote] = useState<CanvasGenCostQuote | null>(null);

  const videoActionRef = useRef<{ material: string; actionId: string } | null>(null);

  // Per-node data refs so stable onAnimate closures can read current generationId + position
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  const nodeDataRef = useRef<Record<string, { generationId?: string; pos: { x: number; y: number } }>>({});
  const referenceHandlerRef = useRef<typeof onReferenceInChat>(onReferenceInChat);
  const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | null>(null);
  /**
   * Cards taken off THIS board because they are deleted (#612 r5).
   *
   * A read already in flight left before the deletion and still carries the card, so it puts it
   * back when it lands — and a captured TERMINAL row is not in flight, which stops the re-read
   * loop with a deleted card on screen for good. This memory is what makes deletion outrank a
   * snapshot whenever that snapshot departed. Per board: a fresh load's reads are all taken after
   * the deletion, and reads omit tombstones, so nothing needs to survive a reload.
   */
  const removedNodeIdsRef = useRef<Set<string>>(new Set());
  const reloadRef = useRef<(() => Promise<void>) | null>(null);
  // Counts board reads so a late answer from an overtaken read can be recognised and dropped.
  const reloadSeqRef = useRef(0);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const fittedScopeRef = useRef<string | null>(null);
  const fitTimerRef = useRef<number | null>(null);
  const lineageReloadTimerRef = useRef<number | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [boardStatus, setBoardStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const requestReload = useCallback(() => {
    void (async () => {
      await Promise.resolve(onActivityRefresh?.()).catch(() => undefined);
      await reloadRef.current?.();
      await Promise.resolve(onActivityRefresh?.()).catch(() => undefined);
    })();
  }, [onActivityRefresh]);

  /**
   * Where a new card goes.
   *
   * The old rule counted cards (`80 + n * 340`), so a new card landed on top of an existing
   * one the moment anything was deleted or a batch put more than one card on the board — and
   * a covered card is an invisible card the merchant already paid for. This asks the board for
   * its first genuinely free slot, sized for the WHOLE batch so all of its images land side by
   * side and stay visible (#547 A2).
   *
   * A card made FROM another card (Make video, More like this, an edited prompt) passes that
   * card as `anchorNodeId` and lands next to it instead: a board-wide scan sent it to the first
   * hole anywhere, so on a busy board the merchant had to go looking for what they just paid
   * for, and the line joining the two ran across the whole canvas (review P2-3).
   */
  const spawnRect = useCallback((
    count = 1,
    anchorNodeId?: string | null,
  ): { x: number; y: number; w: number; h: number } => {
    const rectOf = (n: CanvasFlowNode): CanvasRect => ({
      x: n.position.x,
      y: n.position.y,
      w: Number(n.style?.width ?? CANVAS_CARD_SIDE),
      h: Number(n.style?.height ?? CANVAS_CARD_SIDE),
    });
    const occupied: CanvasRect[] = nodesRef.current.map(rectOf);
    const card = { w: CANVAS_CARD_SIDE, h: CANVAS_CARD_SIDE };
    const footprint = canvasBatchFootprint(count, card);
    const anchorNode = anchorNodeId ? nodesRef.current.find((n) => n.id === anchorNodeId) : undefined;
    const beside = anchorNode ? nearestFreeCanvasSlot(occupied, rectOf(anchorNode), footprint) : null;
    const origin = beside ?? nextCanvasSpawnOrigin(occupied, footprint, {
      step: { x: card.w + CANVAS_CARD_GAP, y: card.h + CANVAS_CARD_GAP },
    });
    return { ...origin, ...card };
  }, []);

  // Keep a ref to animate() so per-node closures don't go stale
  const animateFnRef = useRef<ReturnType<typeof useCanvasGen>["animate"] | null>(null);

  // Build a stable per-node onAnimate that reads generationId at call time
  const onAnimateByNode = useRef<Record<string, () => void>>({});

  /**
   * 「摆好这块板」要给固定覆盖层让出的四边留白 —— 量出来的,不是写死的(FRONT-A15)。
   *
   * 从前这里传的是一个标量 `0.22`,而标量在 React Flow 里是「四边各留 22%」。画布上钉住的东西
   * 一个都不对称(Otto 当前轮卡在左上、Otto 输入框在下方正中、工具条纵列在它上面、模式条与
   * 缩放簇在右侧),所以对称留白摆出来的画有一部分就压在覆盖层底下:走查实测「Fit to screen」
   * 之后一张视频卡 45% 被压住,点它落在 Otto 输入框上(QA-CRE-008)。算法与选择器清单都在
   * `lib/canvas-fit-padding.ts` 一处。
   *
   * **这块板上只有这一条摆位路**。从前 `<ReactFlow fitView fitViewOptions={{ padding: 0.22 }}>`
   * 在挂载时先按老规矩摆一次,下面那条「每个项目摆一次」的 effect 再按安全区摆第二次 ——
   * 两份留白,谁最后落地取决于时序,于是同一份代码有时把最上排的卡摆在安全区边上(操作条
   * 伸出画板、被顶栏盖住 → 旅程 17 第⑤步红),有时摆在 22% 的对称留白里(绿)。挂载那一份
   * 已经删掉:摆位只剩这一个来源。
   */
  const fitPadding = useCallback((): CanvasFitPaddingPx => {
    const board = canvasHostRef.current?.getBoundingClientRect() ?? CANVAS_FIT_EMPTY_RECT;
    const overlays = CANVAS_FIT_OVERLAY_SELECTORS
      .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
      .map((element) => element.getBoundingClientRect());
    // 带 `px` 交出去:光秃秃的数字在 React Flow 里是比例,不是像素(见 canvasFitPaddingPx)。
    return canvasFitPaddingPx(canvasFitPadding(board, overlays));
  }, []);

  const fitBoard = useCallback((duration: number) => {
    void flowRef.current?.fitView({ padding: fitPadding(), duration });
  }, [fitPadding]);

  const scheduleFitView = useCallback(() => {
    if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    fitTimerRef.current = window.setTimeout(() => {
      fitTimerRef.current = null;
      fitBoard(160);
    }, 80);
  }, [fitBoard]);

  useEffect(() => () => {
    if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    if (lineageReloadTimerRef.current) window.clearTimeout(lineageReloadTimerRef.current);
  }, []);

  /**
   * A paid job just finished in this browser — read the board once so its cards carry their record.
   *
   * The client poll knows the media URL, and nothing else: when it was made, what it cost, what
   * settings produced it and what it was made from all live on the server. Until this ran, a
   * card the merchant had just watched finish opened an Info panel that said "No generation
   * record for this card", and stayed that way — the only thing that reloaded the board was the
   * in-flight poller, and finishing is exactly what stops it (#547 B4 review P1-2).
   *
   * Driven by the JOB, not by each card: `useCanvasGen` calls this once, after the last sibling
   * of a batch is placed, so a batch of four costs one read no matter how slow the placement was.
   */
  const scheduleLineageReload = useCallback(() => {
    if (lineageReloadTimerRef.current) window.clearTimeout(lineageReloadTimerRef.current);
    lineageReloadTimerRef.current = window.setTimeout(() => {
      lineageReloadTimerRef.current = null;
      void reloadRef.current?.();
    }, LINEAGE_RELOAD_COALESCE_MS);
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    referenceHandlerRef.current = onReferenceInChat;
  }, [onReferenceInChat]);

  useLayoutEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const check = () => {
      const rect = host.getBoundingClientRect();
      setCanvasReady(rect.width > 0 && rect.height > 0);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const getOnAnimate = useCallback((id: string): (() => void) => {
    if (!onAnimateByNode.current[id]) {
      // "Make video" is a paid image→video generation, so clicking it only OPENS
      // a confirm; the actual spend happens in runAnimate() after the owner says OK.
      onAnimateByNode.current[id] = () => {
        if (!nodeDataRef.current[id]?.generationId) {
          toast.error("This image is not ready for video yet.");
          return;
        }
        setCostQuote(null);
        setPendingAnimateId(id);
      };
    }
    return onAnimateByNode.current[id]!;
  }, []);

  // The actual paid image→video generation — invoked only after the owner confirms
  // in the "Make a video?" dialog. Spend path is unchanged: same generationId, same
  // default motion prompt, same animate() call as before — just gated behind the OK.
  // Synchronous double-fire guard for the paid video paths (i2v + t2v). The video
  // action identity is minted at this UI boundary and retained while the exact same
  // material is retried, so an outcome-unknown response never turns the next click into
  // a second paid job. The dialog closing isn't a guaranteed double-submit guard.
  // True only during the ~1-2s startGen setup (poll isn't awaited), so it blocks a
  // same-tick double-fire without serializing separate generations.
  const videoBusyRef = useRef(false);
  const runAnimate = useCallback(async (id: string, motionPrompt: string): Promise<boolean> => {
    if (!costQuote) {
      toast.error("Wait for the exact video cost before confirming.");
      return false;
    }
    const entry = nodeDataRef.current[id];
    if (videoBusyRef.current) {
      return false;
    }
    if (!entry?.generationId || !animateFnRef.current) {
      toast.error("This image is not ready for video yet.");
      return false;
    }
    videoBusyRef.current = true;
    setVideoSubmitting(true);
    // #645 T4：规格会改价（10 秒的片子是 5 秒的两倍钱），所以它是商家授权内容的一部分 ——
    // 选完 5 秒再改成 10 秒是**另一个**动作，不是同一个动作的重试。因此它进材料。
    const spec = videoSpecMenu ? animateSpec : null;
    const material = JSON.stringify({
      projectId,
      threadId: activeThreadId ?? null,
      kind: "animate",
      sourceNodeId: id,
      sourceGenerationId: entry.generationId,
      prompt: motionPrompt,
      spec,
    });
    if (videoActionRef.current?.material !== material) {
      videoActionRef.current = { material, actionId: freshCanvasActionId() };
    }
    const actionId = videoActionRef.current.actionId;
    // genRequest requires a non-empty prompt (.trim().min(1)); the dialog guarantees a
    // non-empty motion prompt (custom falls back to the gentle default), so the paid
    // i2v never no-ops on an empty prompt.
    try {
      const accepted = await animateFnRef.current(
        entry.generationId,
        id,
        motionPrompt,
        // The video belongs beside the image it was made from.
        spawnRect(1, id),
        actionId,
        {},
        { ...(spec ? { spec } : {}) },
      );
      if (
        accepted
        || !loadCanvasActionReceipts(projectId).some((receipt) => receipt.actionId === actionId)
      ) {
        videoActionRef.current = null;
      }
      return accepted;
    } finally {
      videoBusyRef.current = false;
      setVideoSubmitting(false);
    }
  }, [activeThreadId, costQuote, projectId, spawnRect, animateSpec, videoSpecMenu]);

  // Build a stable per-node onOpenDetail that reads generationId at call time
  const onOpenDetailByNode = useRef<Record<string, () => void>>({});
  const getOnOpenDetail = useCallback((id: string): (() => void) => {
    if (!onOpenDetailByNode.current[id]) {
      onOpenDetailByNode.current[id] = () => {
        const entry = nodeDataRef.current[id];
        if (!entry?.generationId) {
          toast.error("This asset is not ready for details yet.");
          return;
        }
        setDetailFor(entry.generationId);
      };
    }
    return onOpenDetailByNode.current[id]!;
  }, []);

  /**
   * "Send to Otto" — the explicit action (#604 · spec #599 D6, 体检 Q5=C).
   *
   * Clicking a card used to BE this: the whole picture was a button, so simply looking at the
   * board pushed references into Otto's box, scolded the merchant with a red error when no
   * conversation was open, and — once several cards were picked — turned one click into a pile
   * of references. Picking a card is now just picking it up; handing anything to Otto happens
   * only when the merchant presses this.
   *
   * It reads the CURRENT SELECTION, so several picked cards go over together, one reference
   * each, in one hand-off. Nothing here spends: a reference is text the composer carries until
   * the merchant sends their own message.
   */
  const sendSelectionToOtto = useCallback(() => {
    const refs = nodesRef.current
      .filter((n) => n.selected === true && (n.type === "image" || n.type === "video"))
      .map((node) => {
        const data = node.data as { generationId?: unknown; url?: unknown } | undefined;
        return canvasComposerReferenceForNode({
          type: typeof node.type === "string" ? node.type : null,
          generationId: typeof data?.generationId === "string"
            ? data.generationId
            : nodeDataRef.current[node.id]?.generationId ?? null,
          src: typeof data?.url === "string" ? data.url : null,
        });
      })
      .filter((item): item is Omit<OttoComposerReference, "requestId"> => !!item);
    if (refs.length === 0) {
      toast.message("Pick a finished image or video first, then send it to Otto.");
      return;
    }
    // No conversation open is not a mistake the merchant made — it is a next step. Said plainly,
    // in a plain note rather than an error (#604) — and, since #548, said in the control's own
    // title BEFORE this press too, out of the one constant below.
    if (!referenceHandlerRef.current) {
      toast.message(CANVAS_OTTO_CHAT_REQUIRED);
      return;
    }
    referenceHandlerRef.current(refs);
    toast.success(
      refs.length === 1 ? `${refs[0]!.label} added to Otto chat.` : `${refs.length} references added to Otto chat.`,
    );
  }, []);

  /**
   * ONE voice for a board-wide refusal — PER REFUSAL, not per session.
   *
   * A refit fires once per card as each picture resolves, so the thing that stops one write — an
   * expired session, a board deleted in another tab — stops all of them at once. Reported straight,
   * a board of twelve pictures answers a single expiry with twelve identical toasts stacked over
   * the work. The merchant needs to be told once; twelve times is the same fact made unreadable.
   *
   * So the memory is of WHAT WAS SAID, not of "something was said". A latch that simply stopped
   * after the first report would be this whole ticket's bug reintroduced one level down: the
   * second, different failure later in the same session — a genuinely new refusal the merchant has
   * never seen — would go to nobody, and `FRONT-A12` asks that ANY write failure be reported. Two
   * different sentences are two different facts and each gets said once.
   */
  const sizeSaveReportedRef = useRef<Set<string>>(new Set());
  const reportSizeSaveFailure = useCallback((message: string) => {
    if (sizeSaveReportedRef.current.has(message)) return;
    sizeSaveReportedRef.current.add(message);
    toast.error(message);
  }, []);

  /**
   * A card takes the shape of the picture it just loaded — AND KEEPS IT (接线盘点 L1 · FRONT-A12).
   *
   * The refit itself is old: a 320×320 placeholder resolves its media, learns the real aspect, and
   * snaps to it. What it never did was tell anyone. The new size lived in `style` and nowhere else,
   * so the board wrote it to the screen and the database went on holding 320×320 — reload, and
   * every card the merchant had watched settle into shape was a square again, and the tidy board
   * they left was not the board they came back to.
   *
   * Persisting it needs no new path and no new permission: this is the same `moveCanvasNode` a
   * drag and a hand-resize already end on (x/y/w/h, no spend, tenant-scoped server-side). The
   * measurement moved OUT of the `setNodes` updater to get here — an updater must stay pure and
   * may be run twice, and a server write is the one thing that must happen exactly once.
   */
  const fitMediaNodeToSize = useCallback((id: string, media: CanvasMediaSize) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || (node.type !== "image" && node.type !== "video")) return;
    const currentSize = {
      w: Number(node.style?.width ?? DEFAULT_CANVAS_MEDIA_NODE_SIDE),
      h: Number(node.style?.height ?? DEFAULT_CANVAS_MEDIA_NODE_SIDE),
    };
    const fitted = canvasMediaNodeSize(media, currentSize);
    if (!hasCanvasNodeSizeChanged(currentSize, fitted)) return;
    setNodes((current) => {
      let changed = false;
      const next = current.map((n) => {
        if (n.id !== id) return n;
        changed = true;
        return { ...n, style: { ...n.style, width: fitted.w, height: fitted.h } };
      }) as CanvasFlowNode[];
      if (changed) nodesRef.current = next;
      return changed ? next : current;
    });
    void moveCanvasNode(projectId, id, {
      x: node.position.x,
      y: node.position.y,
      w: fitted.w,
      h: fitted.h,
    }).then(
      (result) => { if ("error" in result) reportSizeSaveFailure(result.error); },
      // The card is already the right shape on screen; what failed is the remembering. Say that,
      // in the words this product already uses when a write does not land.
      () => reportSizeSaveFailure(CANVAS_SAVE_FAILED),
    );
  }, [projectId, reportSizeSaveFailure]);

  const onMediaSizeByNode = useRef<Record<string, (size: CanvasMediaSize) => void>>({});
  const getOnMediaSize = useCallback((id: string): ((size: CanvasMediaSize) => void) => {
    if (!onMediaSizeByNode.current[id]) {
      onMediaSizeByNode.current[id] = (size) => fitMediaNodeToSize(id, size);
    }
    return onMediaSizeByNode.current[id]!;
  }, [fitMediaNodeToSize]);

  // stable delete
  const deleteNode = useCallback((id: string) => {
    // The merchant's own deletion races an in-flight read exactly the same way (#612 r5).
    removedNodeIdsRef.current.add(id);
    setNodes((ns) => ns.filter((n) => n.id !== id));
    void deleteCanvasNode(projectId, id);
  }, [projectId]);

  /**
   * Take a card off THIS board because the server says it is already gone (#612 r4).
   *
   * Deliberately not `deleteNode`: there is nothing to delete — the tombstone exists, written by
   * whoever removed the card (another tab, or Otto). This is the local half only, and it is the
   * only thing that can end a card whose row a board read will never return again.
   */
  const removeCanvasNodeLocally = useCallback((id: string) => {
    removedNodeIdsRef.current.add(id);
    setNodes((ns) => ns.filter((n) => n.id !== id));
  }, []);

  // Remove a whole selection (#547 B6). Same per-card server action as the single ✕ —
  // batching is a UI convenience, not a new deletion path.
  const deleteNodes = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const removing = new Set(ids);
    for (const id of removing) removedNodeIdsRef.current.add(id);
    setNodes((ns) => ns.filter((n) => !removing.has(n.id)));
    for (const id of ids) void deleteCanvasNode(projectId, id);
  }, [projectId]);

  const clearSelection = useCallback(() => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
  }, []);

  /** Open the lineage tree. It is always about the card that is picked, so this only reveals it. */
  const openLineage = useCallback(() => setLineageOpen(true), []);

  /** Following a line in the tree picks that card on the board — the tree stays open on it. */
  const pickLineageCard = useCallback((id: string) => {
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
  }, []);

  /** Save every selected card that has media. Uses the same `<a download>` the Detail panel
   *  already uses, once per card — no new transfer path, nothing leaves the browser. */
  const downloadSelection = useCallback((downloads: Array<{ url: string; fileName: string }>) => {
    if (downloads.length === 0) return;
    for (const item of downloads) {
      const link = document.createElement("a");
      // 走查 P0-2:同源附件地址。`/files/…` 会 302 到 R2,`download` 跨源被忽略 ——
      // 那样按「Download N」不是存下 N 个文件,而是把商家导航去最后一个文件的裸地址。
      link.href = sameOriginDownloadUrl(item.url, item.fileName);
      link.download = item.fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    toast.success(downloads.length === 1 ? "Saving 1 file." : `Saving ${downloads.length} files.`);
  }, []);

  /**
   * Save ONE card — the Download icon the approved canvas pattern puts on a picked artifact
   * (`design-system/patterns/canvas/CanvasReference.tsx`).
   *
   * No new business layer and no new transfer path: it hands the board's existing
   * `downloadSelection` a one-item list, and the file name comes from the same
   * `canvasDownloadFileName` the "N selected" bar uses, so one card saved alone and the same card
   * saved in a batch are named by the same rule. The card's media URL is read at press time from
   * the live board rather than captured when the handler was made — a card resolves its media
   * after it is placed, and a captured URL would be the empty one it had while queueing.
   */
  const onDownloadByNode = useRef<Record<string, () => void>>({});
  const getOnDownload = useCallback((id: string): (() => void) => {
    if (!onDownloadByNode.current[id]) {
      onDownloadByNode.current[id] = () => {
        const node = nodesRef.current.find((n) => n.id === id);
        const url = typeof node?.data?.url === "string" ? node.data.url : "";
        if (!node || !url) return;
        const prompt = typeof node.data?.prompt === "string" ? node.data.prompt : null;
        downloadSelection([{
          url,
          fileName: canvasDownloadFileName({ id, type: node.type, url, prompt }, 0, url),
        }]);
      };
    }
    return onDownloadByNode.current[id]!;
  }, [downloadSelection]);

  /**
   * The card's words go to the server — and the CARD is told what happened (接线盘点 L1 · FRONT-A12).
   *
   * This used to be `void updateTextNode(...)`: the server's answer was dropped on the floor, so a
   * refusal it can and does return — the session expired, the card was removed in another tab —
   * reached nobody. The merchant kept typing into a note that was no longer being stored, and only
   * the next board read told them, by quietly replacing what they wrote.
   *
   * The board owns the wording because the board owns the call: the server's own sentence when
   * there is one, and the shared throw sentence when the request never got an answer. `TextNode`
   * renders what it is handed and writes none of it — one place for these words, not two.
   */
  const onTextChange = useCallback(async (id: string, text: string): Promise<CanvasTextSaveOutcome> => {
    try {
      const result = await updateTextNode(projectId, id, text);
      return "error" in result ? { error: result.error } : { ok: true };
    } catch {
      return { error: CANVAS_SAVE_FAILED };
    }
  }, [projectId]);

  // onResolve: store generationId in nodeDataRef AND in node.data
  const onResolve = useCallback((id: string, url: string | null, status: string, generationId?: string) => {
    if (generationId) {
      nodeDataRef.current[id] = { ...nodeDataRef.current[id], generationId, pos: nodeDataRef.current[id]?.pos ?? { x: 0, y: 0 } };
    }
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== id) return n;
        const updated: CanvasFlowNode = { ...n, data: { ...n.data, url: url ?? undefined, status } };
        if (generationId) updated.data = { ...updated.data, generationId };
        // Wire actions now that generationId is known (if not already set).
        // Videos only need Detail; images also need Make video.
        if (generationId && (n.type === "image" || n.type === "video")) {
          updated.data = {
            ...updated.data,
            ...(!updated.data.onOpenDetail ? { onOpenDetail: getOnOpenDetail(id) } : {}),
            ...(!updated.data.onSendToOtto ? { onSendToOtto: sendSelectionToOtto } : {}),
            ...(!updated.data.onDownload ? { onDownload: getOnDownload(id) } : {}),
            ...(n.type === "image" && !updated.data.onAnimate ? { onAnimate: getOnAnimate(id) } : {}),
            ...(!updated.data.onMediaSize ? { onMediaSize: getOnMediaSize(id) } : {}),
          };
        }
        return updated;
      }),
    );
  }, [getOnAnimate, getOnDownload, getOnMediaSize, getOnOpenDetail, sendSelectionToOtto]);

  /**
   * Put down the card a press has just been accepted for.
   *
   * WHAT IT DELIBERATELY DOES NOT RECORD (#605 r1 judge P1-1): which of the batch this is, how big
   * the batch is, and what it was made from. Those are the paid job's to settle, and at this
   * moment nobody has — the row the server just wrote carries nulls in all three. They used to be
   * written here from the REQUEST, and the tree, the A/B badge, the batch frame and the compare
   * gate read them straight back, so a card that was still queueing already told the merchant it
   * was "A of a batch of 2, made from that one". The card goes down saying the one thing that is
   * true — a job was accepted, this is queued — and the board read brings the rest.
   */
  const onNewNode = useCallback(
    (n: {
      id: string;
      type: "image" | "video";
      pos: { x: number; y: number; w: number; h: number };
      status: string;
      prompt: string;
      genJobId?: string;
    }) => {
      nodeDataRef.current[n.id] = { pos: { x: n.pos.x, y: n.pos.y } };
      setNodes((ns) => [
        ...ns,
        {
          id: n.id,
          type: n.type,
          position: { x: n.pos.x, y: n.pos.y },
          data: {
            status: n.status,
            prompt: n.prompt,
            skin,
            onDelete: () => setPendingDeleteId(n.id),
            onRefresh: requestReload,
            onMediaSize: getOnMediaSize(n.id),
            onSendToOtto: sendSelectionToOtto,
            onDownload: getOnDownload(n.id),
            // onAnimate added after generationId arrives via onResolve
          },
          style: { width: n.pos.w, height: n.pos.h, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
          genJobId: n.genJobId ?? null,
          madeFromNodeId: null,
          batchIndex: null,
          batchSize: null,
        },
      ]);
      scheduleFitView();
    },
    [activeThreadId, getOnMediaSize, sendSelectionToOtto, requestReload, skin, scheduleFitView],
  );

  const onGenError = useCallback((msg: string) => { toast.error(msg); }, []);
  const { generateImage, animate, generateVideoFromText, quoteCosts, imageShapes, videoSpecs } = useCanvasGen(
    projectId,
    onNewNode,
    onResolve,
    activeThreadId,
    onGenError,
    onBalanceRefresh,
    undefined,
    scheduleLineageReload,
    removeCanvasNodeLocally,
  );
  const refreshCostQuote = useCallback(() => {
    void quoteCosts().then(setCostQuote).catch(() => setCostQuote(null));
    // #643 T2：形状菜单和价格一起取。菜单读不到就不渲染选择器（选不了形状仍然能出图，
    // 服务端按默认形状交付）—— 界面绝不用一份自己编的菜单顶上。
    void imageShapes()
      .then((shapes) => {
        setImageShape((current) => current ?? shapes.defaultAspect);
      })
      .catch(() => undefined);
    // #645 T4：视频规格菜单 + 按档价目表，与图片形状同一条路。取不到就不渲染规格选择器
    // （仍然能出片，服务端按默认档交付）—— 界面绝不用一份自己编的菜单或价格顶上。
    void videoSpecs()
      .then((specs) => {
        setVideoSpecMenu(specs);
        setT2vSpec((current) => current ?? specs.t2vDefault);
        setAnimateSpec((current) => current ?? specs.i2vDefault);
      })
      .catch(() => setVideoSpecMenu(null));
  }, [quoteCosts, imageShapes, videoSpecs]);
  // keep animateFnRef current (in an effect — refs must not be written during render)
  useEffect(() => { animateFnRef.current = animate; }, [animate]);

  /**
   * ENGINE-A3(otto-engine.md §7.2⑦)—— 画布上那条**直出**的付费路已退役。
   *
   * 从前这里有一个 `handleGenerate`:右侧工具条的 Generate 按钮掀开一个 composer,按下就
   * 直接 reserve、直接建 job(宪法例外①「余额即闸」,图片不弹确认)。已批准的画布设计只有
   * 一个输入框 —— Otto 那一个(`design-system/patterns/canvas/CanvasReference.tsx:419` 底部
   * 唯一 composer;:421 的工具条只有 select / frame select / hand,没有 Generate),确认长在
   * Otto 当前轮的卡片上(同文件 :257-273)。所以画布上的花钱一律走对话审批卡
   * (`components/otto/OttoApprovalCard.tsx`,闭集由 `packages/otto/src/approval-tools.ts` 机器推导)。
   *
   * **卡上那几条付费路一格没动**:「再来一张」(`runImageEvolve`,先开确认卡再付费)、
   * Animate、视频「照这条再来一次」与 t2v 弹窗 —— 它们各自本来就有确认,不是直出。
   */

  /**
   * "More like this" / the edited prompt on a selected image card (#547 A3 · A4).
   *
   * ONE paid image generation conditioned on THIS card's own image — the same
   * `generateImage` spend path the composer uses, with the source image added, and the same
   * per-action identity rule (same card + same words = a retry of that one action; different
   * words = a new authorized action). Images charge on submit with the price shown on the
   * card (constitutional exception ① "balance is the gate"); video keeps its confirm dialog.
   */
  const evolveActionRef = useRef<{ material: string; actionId: string } | null>(null);
  const evolveBusyRef = useRef(false);
  const runImageEvolve = useCallback(async (
    id: string,
    rawPrompt: string,
    aspect: string | undefined,
  ): Promise<boolean> => {
    const text = rawPrompt.trim();
    if (!text) return false;
    if (!costQuote) {
      toast.error("Wait for the exact image cost before making another one.");
      return false;
    }
    if (evolveBusyRef.current) return false;
    const entry = nodeDataRef.current[id];
    if (!entry?.generationId) {
      toast.error("This image is not ready to build on yet.");
      return false;
    }
    evolveBusyRef.current = true;
    setPendingImageAction({ nodeId: id });
    // #643 T2：「改这张图 / 再来一张」默认交付**和这张一样的形状**（那张卡自己记着的形状；
    // 记录不到的老图就是默认方图，那也正是它们当年真的形状）。商家在卡上换了形状，就带
    // 他换的那一格 —— 换形状是另一个动作，所以它进材料。
    const aspectRatio = aspect ?? null;
    const material = JSON.stringify({
      projectId,
      threadId: activeThreadId ?? null,
      kind: "image",
      sourceNodeId: id,
      sourceGenerationId: entry.generationId,
      prompt: text,
      count: 1,
      aspectRatio,
    });
    if (evolveActionRef.current?.material !== material) {
      evolveActionRef.current = { material, actionId: freshCanvasActionId() };
    }
    const actionId = evolveActionRef.current.actionId;
    try {
      const accepted = await generateImage(
        text,
        // The new take belongs beside the card it was built on.
        spawnRect(1, id),
        [],
        {},
        1,
        {
          actionId,
          sourceGenerationId: entry.generationId,
          sourceNodeId: id,
          ...(aspectRatio ? { aspectRatio } : {}),
        },
      );
      if (
        accepted
        || !loadCanvasActionReceipts(projectId).some((receipt) => receipt.actionId === actionId)
      ) {
        evolveActionRef.current = null;
      }
      return accepted;
    } finally {
      evolveBusyRef.current = false;
      setPendingImageAction(null);
    }
  }, [activeThreadId, costQuote, generateImage, projectId, spawnRect]);

  /** 事件处理里按 id 取同一件事（渲染期不许读 ref —— 那是 React 的规矩，也是本仓库的 lint 闸）。 */
  const nodeImageShape = useCallback((id: string): string | undefined => (
    recordedImageShape(nodesRef.current.find((n) => n.id === id), imageShape)
  ), [imageShape]);

  /**
   * 第一下只**开确认**（QA-CRE-FE9-001 / Founder 2026-09-04 07:05 裁决）。
   *
   * 这里一分钱都动不了：不建 action id、不 reserve、不建 job —— 只把这张卡此刻要送去的材料
   * 记进 `pendingVariant`。真正的付费入口是确认卡上那颗 `Generate · N credits`，它调的仍是
   * 同一个 `runImageEvolve`（同一条 `generateImage` 花钱路、同一份幂等边界），所以钱路语义
   * 一格没变，变的只是**谁按了才算数**。
   */
  const handleVariant = useCallback((id: string, aspect?: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const prompt = typeof node?.data?.prompt === "string" ? node.data.prompt : "";
    if (!prompt.trim()) {
      toast.error("This image has no saved description to build on.");
      return;
    }
    const sourceUrl = typeof node?.data?.url === "string" ? node.data.url : undefined;
    // 形状口径与裁决①后一模一样：卡自己记着的那一格（记录不到就是默认方图）。
    const shape = aspect ?? nodeImageShape(id);
    setPendingVariant({
      nodeId: id,
      prompt,
      ...(shape ? { aspect: shape } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }, [nodeImageShape]);

  /**
   * Add an empty text node (display-only, no spend) — the canvas toolbar's text tool.
   *
   * A REFUSED PRESS IS SAID OUT LOUD (接线盘点 L1 · FRONT-A12). The server can and does refuse this
   * one — an expired session, a project that is not this owner's — and the refusal used to go to
   * `console.warn`, which no merchant has open. They pressed the text tool, no card appeared, and
   * the board's account of itself was a blank patch of canvas; the natural reading is that the
   * tool is broken, and the natural next move is to press it again into the same refusal. The
   * sibling path one screen over — dropping a file, `handleCanvasDrop` — has always answered this
   * with `toast.error`, and this is that same answer on the same board.
   */
  const addTextNode = useCallback(async () => {
    const { x, y } = spawnRect();
    let result: Awaited<ReturnType<typeof createCanvasNode>>;
    try {
      result = await createCanvasNode({ projectId, type: "text", x, y, w: 240, h: 120, text: "", status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
    } catch {
      toast.error(CANVAS_SAVE_FAILED);
      return;
    }
    if ("id" in result) {
      setNodes((ns) => [
        ...ns,
        {
          id: result.id,
          type: "text",
          position: { x, y },
          data: { text: "", status: "done", skin, onChange: (t: string) => onTextChange(result.id, t), onDelete: () => setPendingDeleteId(result.id) },
          style: { width: 240, height: 120, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    } else {
      toast.error(result.error || CANVAS_SAVE_FAILED);
      console.warn("Failed to create text node:", result.error);
    }
  }, [projectId, activeThreadId, onTextChange, skin, scheduleFitView, spawnRect]);

  // Drag-and-drop an image file from anywhere onto the canvas → upload it as an
  // image node. Upload-only (uploadReference creates an UPLOAD Generation); it
  // does NOT call the generation/spend path. The node is animatable afterward
  // (it has a generationId), and a real prompt is sent on Animate (see #5 fix).
  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      toast.error("Drop a PNG, JPG, or WEBP image.");
      return;
    }
    for (const file of files) {
      if (file.size > CANVAS_REF_MAX_BYTES) {
        toast.error("Reference image must be 10 MB or smaller.");
        continue;
      }
      const fd = new FormData();
      fd.append("files", file);
      const res = await uploadReference(projectId, fd);
      if (!res || "error" in res) {
        const msg = res && "error" in res ? res.error : "Upload failed; please try another image.";
        toast.error(msg);
        console.warn("[canvas drop] upload failed:", res);
        continue;
      }
      const { x, y } = spawnRect();
      const created = await createCanvasNode({ projectId, type: "image", x, y, w: 320, h: 320, generationId: res.id, status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
      if (!("id" in created)) {
        toast.error(created.error || "Upload succeeded, but the canvas card did not appear.");
        console.warn("[canvas drop] node create failed:", created);
        continue;
      }
      nodeDataRef.current[created.id] = { generationId: res.id, pos: { x, y } };
      setNodes((ns) => {
        const next: CanvasFlowNode[] = [
          ...ns,
          {
            id: created.id,
            type: "image",
            position: { x, y },
            data: { status: "done", url: res.src, generationId: res.id, skin, onDelete: () => setPendingDeleteId(created.id), onRefresh: requestReload, onAnimate: getOnAnimate(created.id), onOpenDetail: getOnOpenDetail(created.id), onSendToOtto: sendSelectionToOtto, onDownload: getOnDownload(created.id), onMediaSize: getOnMediaSize(created.id) },
            style: { width: 320, height: 320, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
            threadId: activeThreadId ?? null,
          },
        ];
        // Dropping several files at once places them in one pass, so each drop has to see the
        // previous one before it asks for the next free slot.
        nodesRef.current = next;
        return next;
      });
      scheduleFitView();
    }
  }, [projectId, activeThreadId, getOnAnimate, getOnMediaSize, getOnOpenDetail, sendSelectionToOtto, requestReload, skin, scheduleFitView, spawnRect]);

  // Phase 3: text-to-video — the bottom video tool always opens a prompt dialog;
  // image cards own the explicit "Make video" image-to-video path.
  const [t2vOpen, setT2vOpen] = useState(false);
  const [t2vPrompt, setT2vPrompt] = useState("");
  // #785 — the elements @mentioned in the video prompt. Their reference photos really do
  // reach the video engine now, so this dialog gets the same @ input the image composer has:
  // without it, only Otto could put a merchant's product or spokesperson into a clip.
  const [t2vIds, setT2vIds] = useState<string[]>([]);
  const [t2vVariantSel, setT2vVariantSel] = useState<Record<string, string>>({});
  const [t2vKey, setT2vKey] = useState(0); // bump to re-seed MentionInput (cleared, or with a seeded prompt)
  const [t2vSeedDoc, setT2vSeedDoc] = useState<unknown>(undefined);
  const resetT2v = useCallback(() => {
    setT2vOpen(false);
    setT2vPrompt("");
    setT2vIds([]);
    setT2vVariantSel({});
    setT2vSeedDoc(undefined);
    setT2vKey((k) => k + 1);
  }, []);
  const runT2v = useCallback(async (prompt: string): Promise<boolean> => {
    if (videoBusyRef.current) return false;
    if (!costQuote) {
      toast.error("Wait for the exact video cost before confirming.");
      return false;
    }
    videoBusyRef.current = true;
    setVideoSubmitting(true);
    // #645 T4：同 runAnimate —— 规格改价，所以它进材料。
    const spec = videoSpecMenu ? t2vSpec : null;
    const material = JSON.stringify({
      projectId,
      threadId: activeThreadId ?? null,
      kind: "video",
      prompt,
      // #785：@ 到的元素真的进引擎，所以它们是商家授权内容的一部分 —— @ 了产品之后再 @
      // 代言人是**另一个**动作，不是同一个动作的重试。与形状/规格同级进材料。
      entityIds: t2vIds,
      variantSel: Object.fromEntries(
        Object.entries(t2vVariantSel).sort(([left], [right]) => left.localeCompare(right)),
      ),
      spec,
    });
    if (videoActionRef.current?.material !== material) {
      videoActionRef.current = { material, actionId: freshCanvasActionId() };
    }
    const actionId = videoActionRef.current.actionId;
    try {
      const accepted = await generateVideoFromText(
        prompt,
        spawnRect(),
        actionId,
        {},
        {
          ...(spec ? { spec } : {}),
          ...(t2vIds.length ? { entityIds: t2vIds } : {}),
          ...(Object.keys(t2vVariantSel).length ? { variantSel: t2vVariantSel } : {}),
        },
      );
      if (
        accepted
        || !loadCanvasActionReceipts(projectId).some((receipt) => receipt.actionId === actionId)
      ) {
        videoActionRef.current = null;
      }
      return accepted;
    } finally {
      videoBusyRef.current = false;
      setVideoSubmitting(false);
    }
  }, [activeThreadId, costQuote, generateVideoFromText, projectId, spawnRect, t2vIds, t2vSpec, t2vVariantSel, videoSpecMenu]);

  /** "More like this" / an edited prompt on a VIDEO card. Video always keeps its explicit
   *  cost confirm (founder rule), so this seeds the same dialog instead of spending. */
  const handleVideoRemake = useCallback((_id: string, text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setCostQuote(null);
    setT2vPrompt(prompt);
    // #785：这个对话框现在是 @ 输入框，所以「照这条再来一次」必须把原提示词**种进**编辑器，
    // 而不是塞进一个已经不存在的 textarea。种的是纯文本：卡上的提示词是执行层最终收到的
    // 那一句，里面没有 @ 标记可还原 —— 不假装还原，商家看得见就能自己再 @ 一次。
    setT2vIds([]);
    setT2vVariantSel({});
    setT2vSeedDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: prompt }] }] });
    setT2vKey((k) => k + 1);
    setT2vOpen(true);
  }, []);

  // Cost transparency (宪法 3). ENGINE-A3(§7.2⑦)之后画布上再没有直出 composer，所以这里
  // 不再有「composer 开着就取报价」那一格：报价只在**确认要出现的时候**取 —— 一张卡被选中
  // （卡上那两颗有价的按钮）、Animate／t2v 弹窗开着、变体确认卡开着。
  // Same rule for a picked card's own priced buttons ("Create variations", "Animate"): each
  // shows the exact price before submit (#550 ②, #547 A3/A4), so the quote has to be loaded
  // while a card is selected. ensureModels caches after the first call, so re-selecting cards
  // costs no round trips.
  const cardBarVisible = nodes.some(
    (n) => (n.type === "image" || n.type === "video")
      && n.selected === true
      && imageNodeActionable(n.data as { status?: string; url?: string; generationId?: string }),
  );
  // 变体确认卡把这个数渲染成商家正要批准的价（QA-CRE-FE9-001），所以它开着的时候也要有报价；
  // 报不出来那颗 `Generate` 就不给按（与两个视频弹窗同一口径）。
  useEffect(() => {
    if (cardBarVisible || pendingAnimateId !== null || t2vOpen || pendingVariant !== null) refreshCostQuote();
  }, [cardBarVisible, pendingAnimateId, t2vOpen, pendingVariant, refreshCostQuote]);

  // Load (and, under the Grok-bright skin, bridge OTTO's chat results onto) the
  // canvas. The gb path resolves each node's media URL and ensures a node exists
  // for the active thread's results (display-only, no spend). The default path is
  // the original listCanvasNodes (URLs stay client-resolved via generation polls).
  const reload = useCallback(async () => {
    // Which read this is. Two things ask for the board — a job finishing and the 5-second
    // in-flight poller — and neither waits for the other, so answers can arrive out of order.
    // A read that a NEWER read has already overtaken describes the board as it was before that
    // newer read: applying it puts back what the newer answer just corrected (r3 review P2-1).
    const seq = ++reloadSeqRef.current;
    // Every way a read can fail — refused, never arrived, or answered with something that is not
    // a list of cards — is one answer here, and it is handled once below.
    const read = await readCanvasBoard(skin, projectId);
    if (seq !== reloadSeqRef.current) return;
    // WHETHER THE BOARD'S HISTORY IS CURRENTLY KNOWABLE (#605 T6). A failed read leaves every
    // card alone — they are paid work, and this read failing says nothing about them — but it
    // does mean no relationship on screen can be confirmed right now, and the lineage tree has
    // to say so instead of carrying on from the last snapshot.
    //
    // Deferred with queueMicrotask for the same reason OttoConnections defers its load: `reload`
    // is invoked from an effect, and although this line runs after an await, the effect lint
    // does not follow the await across the helper and reads it as a synchronous setState.
    queueMicrotask(() => {
      const available = "rows" in read;
      setLineageUnavailable(!available);
      setBoardStatus(available ? "ready" : "unavailable");
    });
    if (!("rows" in read)) return;
    const mapped = read.rows.map((r) => {
      nodeDataRef.current[r.id] = { generationId: r.generationId ?? undefined, pos: { x: r.x, y: r.y } };
      // 一张已经停下来的卡永远没有媒体可量,所以 `canvasMediaNodeSize` 对它是空转,它会一直
      // 顶着 320×320 的默认正方形站在出好的卡(实测 320×180)旁边(走查 QA-CRE-008「失败卡
      // 过大、盖住工作区」)。收成同一块板上正常卡的外形,规则在 `lib/canvas-node-size.ts`。
      const nodeSize = (r.type === "image" || r.type === "video")
        ? (isTerminalCardStatus(r.status)
            ? canvasTerminalNodeSize({ w: r.w, h: r.h })
            : canvasMediaNodeSize({ width: r.mediaWidth, height: r.mediaHeight }, { w: r.w, h: r.h }))
        : { w: r.w, h: r.h };
      return {
        id: r.id,
        type: r.type,
        position: { x: r.x, y: r.y },
        data: {
          // This card came OUT of a board read, so the server has answered for it. If a later
          // read stops returning it, that is a deletion rather than a read running behind
          // (#612 r4) — reads omit tombstones, so nothing else could ever say so.
          serverKnown: true,
          // The board read already answered this (#602 r2, judge P2). A local
          // `r.url ? "done" : r.status` used to sit here, from when rows persisted
          // "pending" and were never updated — a second derivation that happened to
          // agree, until it did not. `canvasCardFace` is the one derivation and it
          // has already weighed the URL; re-deciding it here is how forks start.
          status: r.status,
          // WHY this card rested (#827). The board read resolved it from the job row, so a card
          // that says "your reference image showed a face" still says it after a reload and on
          // another device — the durable half of the explanation #765 could only say live.
          failureReason: r.failureReason,
          url: r.url ?? undefined,
          generationId: r.generationId ?? undefined,
          prompt: r.prompt,
          text: r.text,
          skin,
          // Traceability the card carries with it: when, with what, at what cost, from what.
          lineage: r.lineage ?? null,
          madeFromNodeId: r.madeFromNodeId ?? null,
          batchIndex: r.batchIndex ?? null,
          batchSize: r.batchSize ?? null,
          onDelete: () => setPendingDeleteId(r.id),
          onRefresh: requestReload,
          onChange: r.type === "text" ? (t: string) => onTextChange(r.id, t) : undefined,
          onAnimate: r.type === "image" ? getOnAnimate(r.id) : undefined,
          onOpenDetail: r.type === "image" || r.type === "video" ? getOnOpenDetail(r.id) : undefined,
          onSendToOtto: r.type === "image" || r.type === "video" ? sendSelectionToOtto : undefined,
          onDownload: r.type === "image" || r.type === "video" ? getOnDownload(r.id) : undefined,
          onMediaSize: r.type === "image" || r.type === "video" ? getOnMediaSize(r.id) : undefined,
        },
        style: { width: nodeSize.w, height: nodeSize.h, boxShadow: `0 0 0 2px ${convoColor(r.threadId ?? null)}` },
        threadId: r.threadId ?? null,
        genJobId: r.genJobId ?? null,
        madeFromNodeId: r.madeFromNodeId ?? null,
        batchIndex: r.batchIndex ?? null,
        batchSize: r.batchSize ?? null,
      } as CanvasFlowNode;
    });
    // Merge, not replace: keep any node that's still generating locally (server may not have
    // its URL yet) so a reload never clobbers an in-flight promptbar gen, and keep whatever the
    // merchant has selected — the board reloads on a timer, and a selection that vanishes
    // mid-action is the board undoing their work (review P2-1).
    setNodes((prev) => mergeReloadedCanvasNodes(prev, mapped, removedNodeIdsRef.current));
  }, [skin, projectId, onTextChange, getOnAnimate, getOnDownload, getOnMediaSize, getOnOpenDetail, sendSelectionToOtto, requestReload]);
  // keep reloadRef current (in an effect — refs must not be written during render);
  // declared before the consumers below, so it runs first within any commit.
  useEffect(() => { reloadRef.current = reload; }, [reload]);

  // A different board has different cards; nothing removed here means anything there.
  useEffect(() => { removedNodeIdsRef.current = new Set(); }, [projectId]);

  // Initial load + project-level reload. Under gb this bridges every chat in the project.
  useEffect(() => { void reload(); }, [reload]);

  const hasInFlightPaidNode = nodes.some((n) => isInFlightPaidGen({
    type: n.type ?? "",
    status: n.data?.status as string | undefined,
    url: n.data?.url as string | null | undefined,
  }));

  /** 这条对话此刻有没有 Otto 那边的付费生成在跑。 */
  const ottoWorkActive = !!(activeThreadId && activity?.has(activeThreadId));

  // A direct canvas generation can finish after the original client poll was
  // interrupted. While a paid image/video card is still unresolved, keep asking
  // the server reload path to reconcile owned GenJobs into visible media.
  //
  // Otto 那条路也吃这条轮询(走查 P0-1):批准的那一瞬间画板会读一次,但那时任务刚建好,
  // 服务端桥有可能还看不到它 —— 只读一次就赌上了那一次的时序,赌输就是商家看着空白画板
  // 等到刷新。占位卡一旦放上去,`hasInFlightPaidNode` 会自己接手;在那之前由这一条兜着。
  useEffect(() => {
    if (!hasInFlightPaidNode && !ottoWorkActive) return;
    const id = window.setInterval(() => {
      void reloadRef.current?.();
    }, 5000);
    return () => window.clearInterval(id);
  }, [hasInFlightPaidNode, ottoWorkActive]);

  // 第一次摆位就在这里 —— ReactFlow 的 `fitView` prop 只在挂载时跑一次,而那时我们的卡还在
  // 路上,所以它从来摆不到真正的内容;它按自己的一份留白摆出来的那一次,只会和这里打架
  // (`fitPadding` 的说明记了它怎么让旅程 17 时红时绿),已经删掉。
  // 每个项目摆一次,用的是量出来的安全区:卡的操作条不再伸到画板外被顶栏盖住,也不会藏在
  // Otto 面板底下变成「看得见点不着」。
  //
  // **这一次不做动画**(`0`,而手动「Fit to screen」仍是 220ms)。开画布的第一眼没有「从哪里
  // 来」可言 —— 动画是从一个商家根本没见过的取景滑过去,而且那 160ms 里板上的卡还在移动:
  // 手已经伸出去的那一下会落空。旅程 17 第①步(在卡外面 24px 起手框选)因此间歇红:量卡的
  // 位置与按下鼠标之间隔着几十毫秒,卡在这几十毫秒里挪了 50 多像素,框就框在旧位置上
  // (2026-09-04 e2e 探针实测:同一次拖动里卡从 x=316 挪到 x=368,框选一张都没圈到)。
  // 手动那一次不同:商家自己按下 Fit to screen,动画正是在告诉他板去了哪里。
  useEffect(() => {
    if (!flowReady || !flowRef.current || nodes.length === 0) return;
    const scope = projectId;
    if (fittedScopeRef.current === scope) return;
    fittedScopeRef.current = scope;
    requestAnimationFrame(() => {
      fitBoard(0);
    });
  }, [flowReady, nodes.length, projectId, fitBoard]);

  // When the active thread's OTTO work starts, reload so the server bridge can
  // place a pending GenJob card on the canvas. When it finishes, reload again
  // so the produced media replaces that pending card.
  const prevActivityRef = useRef<{ threadId: string | null; pending: boolean }>({ threadId: null, pending: false });
  useEffect(() => {
    const pending = ottoWorkActive;
    const prev = prevActivityRef.current;
    const threadChanged = prev.threadId !== activeThreadId;
    if (pending && (!prev.pending || threadChanged)) {
      void reload();
    } else if (!pending && prev.pending && !threadChanged) {
      void reload();
    }
    prevActivityRef.current = { threadId: activeThreadId, pending };
  }, [ottoWorkActive, activeThreadId, reload]);

  // Keep nodeDataRef positions in sync when nodes move (so onAnimate uses fresh coords)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.length === 0) return;
    let next = applyNodeChanges(changes, nodesRef.current) as CanvasFlowNode[];
    const persistMoves: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const deletes: string[] = [];
    // Bridge NodeResizer dimension changes into our style-based sizing so the
    // card visually grows/shrinks on the board (display-only — no regeneration).
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        const { width, height } = c.dimensions;
        next = next.map((n) => (n.id === c.id ? { ...n, style: { ...n.style, width, height } } : n));
      }
    }
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        const n = next.find((x2) => x2.id === c.id);
        // Update position in ref immediately (for onAnimate offset calc)
        const entry = nodeDataRef.current[c.id];
        if (entry) entry.pos = { x: c.position.x, y: c.position.y };

        if (c.dragging === false) {
          // Read position from CHANGE object (not stale nodes closure)
          const { x, y } = c.position;
          if (n) persistMoves.push({ id: n.id, x, y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
        }
      }
      // Persist the new size when a resize gesture ends (display-only; reuses the
      // same moveCanvasNode path as a drag — no spend, just x/y/w/h).
      if (c.type === "dimensions" && c.resizing === false) {
        const n = next.find((x2) => x2.id === c.id);
        if (n) {
          const entry = nodeDataRef.current[n.id];
          if (entry) entry.pos = { x: n.position.x, y: n.position.y };
          persistMoves.push({ id: n.id, x: n.position.x, y: n.position.y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
        }
      }
      if (c.type === "remove") deletes.push(c.id);
    }
    nodesRef.current = next;
    setNodes(next);
    for (const move of persistMoves) void moveCanvasNode(projectId, move.id, { x: move.x, y: move.y, w: move.w, h: move.h });
    for (const id of deletes) void deleteCanvasNode(projectId, id);
  }, [projectId]);

  /**
   * Delete / Backspace takes the picked cards off the board (FRONT-A15).
   *
   * 走查 QA-CRE-002:选中一张卡按 Delete 与 Backspace,屏幕上什么都不发生。React Flow 自己的
   * 删除键是**关着**的(`deleteKeyCode={null}`,下面那个 prop),因为它会不问一声就删,而在飞
   * 的付费卡删掉不退款 —— 所以键盘这条路必须自己接,并且接到**已有的那两个确认框**上,不是
   * 另开一条删除路:单张走 ✕/菜单同一个 `pendingDeleteId`(它带「还在生成、删了不退款」那句
   * 警告),多张走批量确认框。已批准的设计夹具 `CanvasReference.tsx:470` 给的就是这个键。
   *
   * 选中状态只有一份 —— React Flow 记在卡上的 `selected`;这里读的是屏幕上那一份(会话过滤之后
   * 的可见卡),看不见的卡不会被一次按键删掉。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const ids = canvasDeleteKeyIds(
        {
          key: event.key,
          editing: !!target?.closest?.(CANVAS_EDITABLE_SELECTOR),
          dialogOpen: !!document.querySelector(CANVAS_DIALOG_SELECTOR),
        },
        nodesRef.current
          .filter((n) => n.selected === true)
          .map((n) => n.id),
      );
      if (!ids) return;
      // Backspace on a board is not the browser's "go back" — the press is ours now.
      event.preventDefault();
      if (ids.length === 1) setPendingDeleteId(ids[0]!);
      else setPendingBatchDeleteIds(ids);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Is the card awaiting delete a PAID generation still in flight? If so the confirm
  // must warn that removing won't refund and re-running charges again — this is what
  // stops the "delete a stuck-looking paid card → reclick → second charge" vector
  // (deleteKeyCode is null, so the ✕→confirm is the only delete path).
  const pendingDeleteNode = pendingDeleteId ? nodes.find((n) => n.id === pendingDeleteId) : undefined;
  const pendingDeletePaid = !!pendingDeleteNode && isInFlightPaidGen({
    type: pendingDeleteNode.type ?? "",
    status: pendingDeleteNode.data?.status as string | undefined,
    url: pendingDeleteNode.data?.url as string | undefined,
  });
  const showGraph = canvasReady;
  // #645 T4：视频按档计价，所以价格必须跟着商家**这一刻选中的那一档**走。价格永远来自
  // 服务端那张按档价目表（`creditsFor`），界面自己不算 —— 报不出这一档的价就如实说
  // "checking exact cost"，绝不拿默认档的价格顶上（那就是显示一个价、扣另一个价）。
  const specCredits = (spec: VideoSpec | null): number | null =>
    (videoSpecMenu && spec ? videoSpecMenu.creditsFor(spec) : costQuote?.videoCredits ?? null);
  const specCostLabel = (spec: VideoSpec | null): string => {
    const credits = specCredits(spec);
    return typeof credits === "number" ? creditsLabel(credits) : "checking exact cost";
  };
  const t2vCostLabel = specCostLabel(t2vSpec);
  const animateCostLabel = specCostLabel(animateSpec);
  /** 变体确认卡上的那个数 —— 与卡上 tooltip 同一个服务端报价，界面一分钱都不自己算。 */
  const variantCostLabel = typeof costQuote?.imageCredits === "number"
    ? creditsLabel(costQuote.imageCredits)
    : "checking exact cost";
  // #785 判官 r2 P1-a —— 出片框只在 @元素**真的会进引擎**时才提这件事。
  //
  // 承诺与执行必须同源:这个布尔值来自服务端解析的那一份(`getActiveGenModels`),而它读的
  // 判据与选片名额、卡面规格条目是同一个函数。备用适配器那条路上元素照一张都上不了车,
  // 界面于是一个字都不提 —— 替一条做不到的路许诺,商家会照着那句话去 @,然后付钱拿到一支
  // 跟他的产品毫无关系的片子。菜单没取到(null)⇒ 同样闭嘴:没确认的事不许说。
  const t2vElementsRide = videoSpecMenu?.elementReferences === true;
  // A card's own bar makes ONE image built on that card, so it is priced by the single-image
  // quote — one source, no second price for the same action (#550 ②, #547 A4).
  const evolveCostHint = genCostHint(costQuote?.imageCredits);
  // 视频卡的「More like this」是去开 t2v 确认框的,所以这里报的必须是**那个框会用的那一档**
  // 的价 —— 报默认档就会出现「卡上说 11、框里收 27」。价格仍然只有服务端那一个来源。
  const remakeCostHint = genCostHint(specCredits(t2vSpec) ?? costQuote?.videoCredits);
  // ENGINE-A3(§7.2⑦):「Filter to this convo」那颗开关长在已退役的直出 composer 上，随它
  // 一起退役 —— 板上一律显示这个 project 的全部卡片(过滤开关从来只有关着这一个默认态)。
  const nodesOnBoard = nodes;
  // How many cards are picked right now. A card's own toolbar is about THAT card, so it only
  // appears while exactly one is picked: with several picked, neighbouring cards' toolbars
  // landed on top of each other and there was no telling which card a button would act on
  // (#604 r2 P2②). For a multi-card pick the batch bar below is the one place to act.
  const selectedCount = nodesOnBoard.filter((n) => n.selected === true).length;
  // #548: handing cards to Otto is the ONE canvas action that still needs a conversation, and the
  // card says so before it is pressed instead of only afterwards. Resolved once, here, so a card's
  // toolbar and the batch bar cannot end up telling the merchant two different things.
  const sendToOttoTitle = canvasSendToOttoTitle({ chatOpen: !!onReferenceInChat, many: selectedCount > 1 });
  const visibleNodes: CanvasFlowNode[] = nodesOnBoard.map((n) => ({
    ...n,
    // React Flow already puts every card in the tab order and picks it up on Enter, but with
    // no name a card announced itself as an unnamed group — the merchant heard nothing about
    // WHICH card had focus (#604 r2 P3). Says what it is, and what it was asked for.
    ariaLabel: canvasNodeAriaLabel(n),
    data: n.type === "image"
      ? {
          ...n.data,
          selectedCount,
          sendToOttoTitle,
          onVariant: handleVariant,
          imageActionPending: pendingImageAction !== null,
          imageVariantPending: pendingImageAction?.nodeId === n.id,
          evolveCostHint,
          onOpenLineage: openLineage,
          // #643 T2: the shape a new take of THIS card will be delivered in — this card's own
          // recorded shape, so "make another one like this" keeps the shape by default. The menu
          // comes from the server; the card writes down nothing itself.
          imageShape: recordedImageShape(n, imageShape),
        }
      : n.type === "video"
        ? { ...n.data, selectedCount, sendToOttoTitle, onRemake: handleVideoRemake, remakeCostHint, onOpenLineage: openLineage }
        : n.data,
  }));
  // T6: the four recorded columns, read off the board exactly once, for everything that talks
  // about relationships — the same-batch frame, the lines between cards, the tree, the compare
  // gate and the two sides of a comparison. No coordinate and no array order is in here, and
  // neither is anything a card SAYS about itself before a board read has answered for it: a card
  // the browser has only just put down carries nulls, whatever the press it belongs to asked for
  // (#605 r1 judge P1-1 · spec #599 D5/D8).
  const lineageFacts = visibleNodes.map((n) => {
    const d = n.data as {
      prompt?: string | null;
      serverKnown?: unknown;
      genJobId?: string | null;
      batchIndex?: number | null;
      batchSize?: number | null;
      madeFromNodeId?: string | null;
    };
    return {
      id: n.id,
      type: n.type ?? null,
      prompt: d.prompt ?? null,
      ...canvasRecordedFacts({
        serverKnown: d.serverKnown,
        genJobId: n.genJobId ?? d.genJobId ?? null,
        batchIndex: n.batchIndex ?? d.batchIndex ?? null,
        batchSize: n.batchSize ?? d.batchSize ?? null,
        madeFromNodeId: n.madeFromNodeId ?? d.madeFromNodeId ?? null,
      }),
    };
  });
  // B4 twin: the SAME-BATCH frame. One press, one frame, read from what the press recorded —
  // never from how many cards are still on the board, and never from where they sit. Deleting two
  // of a batch of four leaves a frame that still says "Batch of 4", because that is what was
  // bought (#603 T4).
  const batchFrames: CanvasFlowNode[] = canvasBatchGroups(lineageFacts).flatMap((group) => {
    const members = group.memberIds
      .map((id) => visibleNodes.find((n) => n.id === id))
      .filter((n): n is CanvasFlowNode => !!n);
    if (members.length < 2) return [];
    const box = members.map((n) => ({
      x: n.position.x,
      y: n.position.y,
      w: Number(n.style?.width ?? CANVAS_CARD_SIDE),
      h: Number(n.style?.height ?? CANVAS_CARD_SIDE),
    }));
    const minX = Math.min(...box.map((b) => b.x));
    const minY = Math.min(...box.map((b) => b.y));
    const maxX = Math.max(...box.map((b) => b.x + b.w));
    const maxY = Math.max(...box.map((b) => b.y + b.h));
    return [{
      id: `batch-frame:${group.genJobId}`,
      type: "batchFrame",
      position: { x: minX - BATCH_FRAME_PAD, y: minY - BATCH_FRAME_PAD },
      data: { label: canvasBatchFrameLabel(group.batchSize) },
      draggable: false,
      selectable: false,
      focusable: false,
      deletable: false,
      zIndex: -1,
      style: { width: maxX - minX + BATCH_FRAME_PAD * 2, height: maxY - minY + BATCH_FRAME_PAD * 2 },
      threadId: null,
    } as CanvasFlowNode];
  });

  // B4: draw the trail. A video and the image it came from, or an image and the image it was
  // evolved from, are joined by a line instead of sitting next to each other unexplained.
  // ONE recorded fact decides it (#603 T4): the card this one's paid job was made FROM. A batch's
  // cards are never joined — they came out of one press together, and where they SIT is a
  // separate fact that no longer travels in the same field.
  const lineageEdges: Edge[] = buildCanvasLineageEdges(
    lineageFacts.map((card) => ({ id: card.id, madeFromNodeId: card.madeFromNodeId })),
  ).map((edge) => ({
    ...edge,
    selectable: false,
    deletable: false,
    focusable: false,
    style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5, opacity: 0.55 },
  }));

  const selectedCards = visibleNodes.filter((n) => n.selected === true);
  // The tree is about ONE card. With none or several picked it has nothing to be about, which
  // the panel says in words rather than by picking one of them itself.
  const lineageFocusId = selectedCards.length === 1 ? selectedCards[0]!.id : null;
  const lineageTree = lineageFocusId ? buildCanvasLineageTree(lineageFacts, lineageFocusId) : null;
  // May these two be shown side by side, and which of them is A? Both answers come from the
  // recorded facts, so neither the picking order nor the layout can change them (#605 验收②).
  const comparePair = selectedCards.length === 2
    ? canvasComparePair(
      lineageFacts.find((card) => card.id === selectedCards[0]!.id)!,
      lineageFacts.find((card) => card.id === selectedCards[1]!.id)!,
    )
    : null;
  const compareCard = (id: string): CanvasCompareCard | null => {
    const node = visibleNodes.find((n) => n.id === id);
    if (!node) return null;
    return {
      id,
      type: node.type ?? null,
      url: (node.data as { url?: string | null })?.url ?? null,
      prompt: (node.data as { prompt?: string | null })?.prompt ?? null,
    };
  };
  // What is open right now: the pair the merchant asked for, re-checked against the facts on
  // every render. A card removed or changed under an open comparison closes it rather than
  // leaving two pictures on screen under labels that no longer hold.
  const openComparePair = compareIds
    ? (() => {
      const [first, second] = compareIds;
      const left = lineageFacts.find((card) => card.id === first);
      const right = lineageFacts.find((card) => card.id === second);
      if (!left || !right) return null;
      const pair = canvasComparePair(left, right);
      if (!pair) return null;
      const leftCard = compareCard(pair.left.id);
      const rightCard = compareCard(pair.right.id);
      return leftCard && rightCard ? { pair, left: leftCard, right: rightCard } : null;
    })()
    : null;

  // B6: what a multi-card selection can do. React Flow owns the selection itself; this is
  // only what the batch bar needs to offer.
  const selection = canvasBatchSelection(
    visibleNodes
      .filter((n) => n.selected === true)
      .map((n) => ({
        id: n.id,
        type: n.type ?? null,
        url: (n.data as { url?: string | null })?.url ?? null,
        prompt: (n.data as { prompt?: string | null })?.prompt ?? null,
        inFlightPaid: isInFlightPaidGen({
          type: n.type ?? "",
          status: (n.data as { status?: string })?.status,
          url: (n.data as { url?: string | null })?.url,
        }),
      })),
  );
  const batchDeleteCopy = canvasBatchDeleteCopy({
    count: pendingBatchDeleteIds?.length ?? 0,
    inFlightPaidCount: (pendingBatchDeleteIds ?? []).filter((id) => {
      const node = nodes.find((n) => n.id === id);
      return !!node && isInFlightPaidGen({
        type: node.type ?? "",
        status: node.data?.status as string | undefined,
        url: node.data?.url as string | undefined,
      });
    }).length,
  });

  return (
    <TooltipProvider>
      <div
        ref={canvasHostRef}
        className={cn(
          "relative h-full min-h-0 w-full flex-1 overflow-hidden",
          skin === "gb" && (panMode ? "gb" : "gb cv-select-mode"),
        )}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={handleCanvasDrop}
      >
      {/* OTTO working — mirrors the agent's activity onto the canvas (Grok pattern). */}
      {activeThreadId && activity?.has(activeThreadId) && (
        <OttoCanvasStatus label="Working on it…" />
      )}
      {boardStatus === "loading" && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center" role="status" aria-live="polite">
          <Badge variant="outline">
            <Spinner aria-hidden="true" />
            Loading canvas…
          </Badge>
        </div>
      )}
      {boardStatus === "unavailable" && (
        <div className="absolute inset-x-0 top-4 z-10 flex justify-center px-4">
          <Alert role="alert" variant="destructive" density="compact" className="max-w-md">
            <AlertTitle>Couldn&apos;t refresh Canvas</AlertTitle>
            <AlertDescription>
              <span>Nothing on your board was changed. Retry to check for newer work.</span>
              <Button type="button" variant="outline" size="xs" onClick={requestReload}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {/* Drop-to-add-image hint (drag a file from anywhere onto the canvas).
       *  MONEY-A9 §7.3 —— 披露先于扣费。这个落点 `handleCanvasDrop → uploadReference` 落的是
       *  `source:"UPLOAD"` 的 image Asset,扫描器随后建理解行、按上传时刻的快照价扣费,所以它和
       *  OttoChatStream / TemplateModal / AddAssetDialog 是同一类入口,挂同一个组件。
       *  文件还悬在半空、商家还没松手时这一行就在屏幕上 —— 「松手之前可见」就是这条验收本身。
       *  `aria-hidden` 从容器移到了那句装饰性标题上:整块曾经是纯装饰,现在它带着价目,
       *  读屏器不该读不到一笔要扣的钱。 */}
      {dragOver && (
        <div className="cv-dropzone">
          <span aria-hidden>Drop image to add it to the canvas</span>
          <div className="cv-dropzone-cost"><UnderstandingCostHint /></div>
        </div>
      )}
      {showGraph && (
        <div className="absolute inset-0">
          <ReactFlow
            style={{ width: "100%", height: "100%", minHeight: 0 }}
            onInit={(instance) => { flowRef.current = instance; setFlowReady(true); }}
            nodes={[...batchFrames, ...visibleNodes]}
            edges={lineageEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            panOnDrag={panMode}
            selectionOnDrag={!panMode}
            // B6: picking several cards at once. React Flow's default only accepts the
            // platform's command key, so shift-click — the thing every merchant tries first —
            // silently replaced the selection instead of adding to it. Shift also drags a
            // selection box over the board without leaving the hand tool.
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            selectionKeyCode="Shift"
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            // 这里**刻意没有** `fitView` / `fitViewOptions`:第一次摆位由下面那条 effect 用
            // `fitPadding()` 做,和「Fit to screen」同一个来源(见 fitPadding 的说明)。
          >
            <Background />
          </ReactFlow>
        </div>
      )}
      {detailFor && (
        <DetailPanel
          generationId={detailFor}
          projectId={projectId}
          onClose={() => setDetailFor(null)}
          entities={entities}
        />
      )}
      {/* The lineage tree (#605 T6). Opened from a card, about that card, and closed by the
          merchant — never in the way of the board unless it was asked for. */}
      {lineageOpen && (
        <CanvasLineagePanel
          tree={lineageTree}
          unavailable={lineageUnavailable}
          onPick={pickLineageCard}
          onClose={() => setLineageOpen(false)}
        />
      )}
      {/* Two cards side by side. The pair is re-checked against the recorded facts on every
          render, so a comparison can never outlive the facts that justified it. */}
      {openComparePair && (
        <CanvasComparePanel
          pair={openComparePair.pair}
          left={openComparePair.left}
          right={openComparePair.right}
          onClose={() => setCompareIds(null)}
        />
      )}
      {skin === "gb" ? (
        // Every bottom-anchored control lives in ONE column (#604 r2): the multi-card bar,
        // then the tool row. Stacked rows cannot cover each other, which is exactly what the
        // old "two bars, same bottom: 20px" pair did. ENGINE-A3(§7.2⑦):这一列顶上从前还有
        // 一个直出 composer，已随 Generate 按钮一并退役 —— 画布只留 Otto 对话那一个输入。
        <div className="cv-bottom-stack">
          {/* B6: what to do with several cards at once. Appears only when more than one card
              is selected, so the single-card toolbar is untouched. */}
          {selection.count > 1 && (
            // Its own row in the stack. It used to be pinned to the same bottom edge as the
            // tool row with a higher z-index, so as soon as it grew it covered the zoom/fit/
            // hand/select tools and they stopped being clickable (#604 r2 P2①). The row still
            // wraps rather than getting clipped when the pane is narrow (#513).
            <div className="cv-batchbar" role="toolbar" aria-label="Selected cards">
              <span className="whitespace-nowrap text-[0.8125rem]">{selection.count} selected</span>
              {/* Side by side, and only for what the recorded facts allow: the two cards of a
                  press that really made two. Any two cards of a batch of four have no A and no B,
                  and a card beside the card it was made from is a different thing to put on
                  screen — neither is offered here (#605 验收② · r1 P1-2 · #603 T4). */}
              {comparePair && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="Look at these two side by side"
                  onClick={() => setCompareIds([comparePair.left.id, comparePair.right.id])}
                >
                  Compare
                </Button>
              )}
              {/* D6: the whole picked set goes over to Otto together, one reference each, when
                  the merchant asks for it — never as a side effect of clicking a card (#604). */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title={sendToOttoTitle}
                onClick={sendSelectionToOtto}
              >
                Send to Otto
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selection.downloads.length === 0}
                title={selection.downloads.length === 0 ? "None of these are finished yet" : "Save these to your computer"}
                onClick={() => downloadSelection(selection.downloads)}
              >
                Download {selection.downloads.length > 0 ? selection.downloads.length : ""}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="Take these cards off the board"
                onClick={() => setPendingBatchDeleteIds(selection.ids)}
              >
                Remove
              </Button>
              <Button type="button" variant="ghost" size="sm" title="Deselect" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          )}
          {/* What this canvas can MAKE — image, video, text. The row sits in the creation
              band with the prompt it opens and the Otto composer below it, which is where
              the approved pattern keeps making-things (`CanvasReference.tsx` has no separate
              creation row: its composer is the whole entry, and Fikirtive's three direct
              tools have no other home in that design). The board's own controls — zoom and
              the interaction mode — left this row for the two places the pattern DOES give
              them; see `.cv-zoom-cluster` / `.cv-mode-rail` below.
              .cv-toolbar has no fixed width (sized by content), but the canvas pane can
              shrink below its natural row width (#513/#522) — maxWidth + flexWrap wrap it to
              a second row instead of letting the host's overflow:hidden clip it. */}
          <div className="cv-toolbar max-w-full flex-wrap justify-center" role="toolbar" aria-label="Canvas tools">
            {/* ENGINE-A3(§7.2⑦):这一排从前的第一颗是 `Generate image` —— 掀开直出 composer、
                按下就扣钱。它已退役:画布上要出图,跟 Otto 说,确认在对话的审批卡上完成。
                余下两颗都不是直出 —— Video 先开确认框(「No charge until you confirm」),
                Add text 一分钱都不花。 */}
            <TooltipButton
              label="Video"
              tooltip="Make a video from a prompt"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => { setCostQuote(null); setT2vOpen(true); }}
            >
              <Video aria-hidden="true" strokeWidth={1.9} />
            </TooltipButton>
            <TooltipButton label="Add text" type="button" variant="ghost" size="icon-sm" onClick={addTextNode}>
              <Type aria-hidden="true" strokeWidth={1.9} />
            </TooltipButton>
          </div>
        </div>
      ) : null}
      {skin === "gb" ? (
        <>
          {/* The interaction mode, on the right rail the approved pattern puts it on
              (`CanvasReference.tsx`: `right-4 top-1/2 -translate-y-1/2 flex-col`, one button
              per mode). Founder 2026-09-03: 生产界面严格按 UIUX 设计走 — this is that place,
              not one of ours. The pattern's third mode ("Frame select") is not offered here
              because this canvas has no separate frame tool: the Select tool's own box drag
              is that behaviour, and inventing a button for it would be inventing a feature.

              B6: two tools instead of one toggle. As a toggle, both modes shared a button
              whose pressed state read the same after two clicks — the merchant could not
              tell which tool was live, and the box-select mode was effectively unreachable.
              Each tool now shows its own on/off state and needs exactly one click. */}
          <ToggleGroup
            type="single"
            className="cv-toolbar cv-mode-rail rounded-[var(--radius-card)]"
            value={panMode ? "hand" : "select"}
            onValueChange={(value) => value && setPanMode(value === "hand")}
            aria-label="Canvas interaction mode"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="hand" aria-label="Hand tool">
                  <Hand aria-hidden="true" strokeWidth={1.9} />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent side="left">Hand tool — drag the board to move around</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="select" aria-label="Select tool">
                  <MousePointer2 aria-hidden="true" strokeWidth={1.9} />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent side="left">Select tool — drag a box to pick several cards</TooltipContent>
            </Tooltip>
          </ToggleGroup>
          {/* Zoom, in the corner the approved pattern gives it (`CanvasReference.tsx`:
              `bottom-4 right-4`, zoom out / reset / zoom in). Undo and redo sit in that
              cluster in the design and are NOT added here: this canvas has no undo to wire
              them to, and a button that only apologises is worse than no button. */}
          <div className="cv-toolbar cv-zoom-cluster" role="toolbar" aria-label="Canvas zoom">
            <TooltipButton
              label="Zoom out"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void flowRef.current?.zoomOut({ duration: 150 })}
            >
              <ZoomOut aria-hidden="true" strokeWidth={1.9} />
            </TooltipButton>
            <TooltipButton
              label="Fit to screen"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => fitBoard(220)}
            >
              <Maximize2 aria-hidden="true" strokeWidth={1.9} />
            </TooltipButton>
            <TooltipButton
              label="Zoom in"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void flowRef.current?.zoomIn({ duration: 150 })}
            >
              <ZoomIn aria-hidden="true" strokeWidth={1.9} />
            </TooltipButton>
          </div>
        </>
      ) : null}
      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDeletePaid ? "Still generating — remove anyway?" : "Remove from canvas?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeletePaid
                ? "This one is still being made and you've already been charged for it. Removing it won't refund the credits, and it will still finish and land in your Library. If you remove it and generate again, you'll be charged a second time."
                : "This takes the card off your board. Any generated image or video stays saved in your library."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{pendingDeletePaid ? "Keep it" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
              onClick={() => { if (pendingDeleteId) deleteNode(pendingDeleteId); setPendingDeleteId(null); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pendingBatchDeleteIds !== null} onOpenChange={(open) => { if (!open) setPendingBatchDeleteIds(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{batchDeleteCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>{batchDeleteCopy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
              onClick={() => {
                if (pendingBatchDeleteIds) deleteNodes(pendingBatchDeleteIds);
                setPendingBatchDeleteIds(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* QA-CRE-FE9-001 —— 变体的付费确认卡（Founder 2026-09-04 07:05 裁决）。
          承载它的就是 Animate／出片框那一家的 `Dialog`，不另发明第二套确认 UI；内容按设计权威
          `stitch-image-video-parity-spec.md` §5「Paid generation confirmation」：要生成的东西、
          数量、比例、用到的材料、准确 credits，primary CTA `Generate · N credits`。
          这张卡开着的时候一分钱都还没动 —— 第一次点击不建 job、不进账本。 */}
      <Dialog
        open={pendingVariant !== null}
        onOpenChange={(open) => { if (!open && pendingImageAction === null) setPendingVariant(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make another one like this?</DialogTitle>
            <DialogDescription>
              Cost: {variantCostLabel}. No charge until you confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            {pendingVariant?.sourceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 画布媒体一律签名 URL，与卡片同一条路
              <img
                src={pendingVariant.sourceUrl}
                alt=""
                className="size-20 shrink-0 rounded-[var(--radius-sm)] border border-border object-cover"
              />
            ) : null}
            <dl className="min-w-0 flex-1 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Images</dt>
                <dd className="tabular-nums">{CANVAS_IMAGE_DEFAULT_COUNT}</dd>
              </div>
              {pendingVariant?.aspect ? (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Shape</dt>
                  <dd>{pendingVariant.aspect}</dd>
                </div>
              ) : null}
              <div className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-muted-foreground">From</dt>
                <dd className="min-w-0 line-clamp-3 text-muted-foreground">{pendingVariant?.prompt}</dd>
              </div>
            </dl>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendingImageAction !== null}
              onClick={() => setPendingVariant(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!costQuote || pendingImageAction !== null}
              aria-live="polite"
              onClick={async () => {
                const intent = pendingVariant;
                if (!intent) return;
                // 这一按才是付费动作：稳定 action id → reserve → provider job，全在
                // `runImageEvolve` 里，与改动前逐字一样（含 `evolveBusyRef` 那道防双击闸）。
                if (await runImageEvolve(intent.nodeId, intent.prompt, intent.aspect)) {
                  setPendingVariant(null);
                }
              }}
            >
              {!costQuote ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Checking cost…
                </>
              ) : pendingImageAction !== null ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Starting…
                </>
              ) : `Generate · ${creditsLabel(costQuote.imageCredits)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pendingAnimateId !== null} onOpenChange={(open) => { if (!open && !videoSubmitting) { setPendingAnimateId(null); setMotion("gentle"); setCustomMotion(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make a video from this image?</DialogTitle>
            <DialogDescription>
              Pick how it should move, then confirm. Cost: {animateCostLabel}. No charge until you confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2.5">
            {/* #645 T4 — the spec this clip will be made in. Shape defaults to Adaptive here:
                with a source image the engine follows that image instead of being told a ratio.
                CREATE-A3(§8.2 批 II):声音那一格现在自报接线 —— 从这个 picker 的 onChange
                到付费请求体之间 `audio` 一路不掉(`clampVideoSpec` 保留它,`useCanvasGen`
                的 animate 请求体带上它),开关拨了真的算数,不是收了钱的假控件。 */}
            {videoSpecMenu && animateSpec && (
              <VideoSpecPicker
                value={animateSpec}
                menu={videoSpecMenu.menu}
                onChange={setAnimateSpec}
                disabled={videoSubmitting}
                hasSourceImage
                audioToggle
              />
            )}
            <ToggleGroup
              type="single"
              value={motion}
              onValueChange={(value) => value && setMotion(value as typeof motion)}
              variant="outline"
              disabled={videoSubmitting}
              className="grid w-full grid-cols-3"
              aria-label="Camera motion"
            >
              {([["gentle", "Gentle"], ["dynamic", "Dynamic"], ["custom", "Custom"]] as const).map(([key, label]) => (
                <ToggleGroupItem
                  key={key}
                  value={key}
                  className="w-full"
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {motion === "custom" && (
              // #840 车4:迁到 ui/Input。原来的手搓样子与组件默认值同形,只逐条压回它自己的
              // 值:1px 边框(非 1.5px)、border 用 --border(非 --input)、bg-background
              // (非 card)、高度随内距(非 h-11)、14px 字号、无阴影。
              <Input
                type="text"
                aria-label="Custom camera motion"
                value={customMotion}
                onChange={(e) => setCustomMotion(e.target.value)}
                placeholder="e.g. slow zoom in as she turns to camera"
                disabled={videoSubmitting}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={videoSubmitting} onClick={() => setPendingAnimateId(null)}>Cancel</Button>
            <Button
              disabled={!costQuote || videoSubmitting}
              aria-live="polite"
              onClick={async () => {
                const p =
                  motion === "dynamic"
                    ? "Animate this image with dynamic, energetic motion."
                    : motion === "custom"
                      ? customMotion.trim() || "Animate this image with gentle, natural motion."
                      : "Animate this image with gentle, natural motion.";
                if (pendingAnimateId && await runAnimate(pendingAnimateId, p)) {
                  setPendingAnimateId(null);
                  setMotion("gentle");
                  setCustomMotion("");
                }
              }}
            >
              {!costQuote ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Checking cost…
                </>
              ) : videoSubmitting ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Starting video…
                </>
              ) : "Make video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={t2vOpen} onOpenChange={(open) => { if (!open && !videoSubmitting) resetT2v(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make a video from a prompt</DialogTitle>
            <DialogDescription>
              Describe the video you want — no source image needed.
              {t2vElementsRide && " Type @ to bring your products and people into the clip."}
              {" "}Cost: {t2vCostLabel}. No charge until you confirm.
            </DialogDescription>
          </DialogHeader>
          {/* #785 — the same @ input the image composer has. The elements named here are the
              ones whose photos the engine actually receives, so this is the merchant's own way
              to put a product or a spokesperson in a clip, with no conversation required.
              判官 r2 P1-a:那句承诺(以及这里的提示语)只在执行层真的收元素照时出现。
              收不了却照样 @ 了的那一路,由服务端在花钱前拒绝并给一句人话 —— 界面不静默降级。 */}
          <MentionInput
            entities={entities}
            docKey={`canvas-t2v-${t2vKey}`}
            {...(t2vSeedDoc ? { initialDoc: t2vSeedDoc } : {})}
            placeholder={t2vElementsRide
              ? "Describe the video you want… (@ to reference your stuff)"
              : "Describe the video you want…"}
            disabled={videoSubmitting}
            onChange={(t, ids, vsel) => { setT2vPrompt(t); setT2vIds(ids); setT2vVariantSel(vsel); }}
          />
          {/* #645 T4 — the spec this clip will be made in. No source image here, so the shape
              default is the model's own t2v default (16:9), not Adaptive.
              CREATE-A3(§8.2 批 II):声音那一格与上面的 Animate 弹窗同一条接线口径。 */}
          {videoSpecMenu && t2vSpec && (
            <VideoSpecPicker
              value={t2vSpec}
              menu={videoSpecMenu.menu}
              onChange={setT2vSpec}
              disabled={videoSubmitting}
              audioToggle
            />
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={videoSubmitting} onClick={resetT2v}>Cancel</Button>
            <Button
              disabled={!t2vPrompt.trim() || !costQuote || videoSubmitting}
              aria-live="polite"
              onClick={async () => {
                const p = t2vPrompt.trim();
                if (p && await runT2v(p)) resetT2v();
              }}
            >
              {!costQuote ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Checking cost…
                </>
              ) : videoSubmitting ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Starting video…
                </>
              ) : "Make video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
  );
}
