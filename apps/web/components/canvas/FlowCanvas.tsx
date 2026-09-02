"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReactFlow, Background, type Edge, type Node, type NodeChange, applyNodeChanges, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode, imageNodeActionable } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode } from "./nodes/TextNode";
import {
  useCanvasGen,
  isInFlightPaidGen,
  freshCanvasActionId,
  loadCanvasActionReceipts,
} from "./useCanvasGen";
import { toast } from "sonner";
import { listCanvasNodes, moveCanvasNode, deleteCanvasNode, updateTextNode, createCanvasNode, type CanvasNodeDTO } from "../../lib/canvas-actions";
import { uploadReference } from "../../lib/actions";
import { syncOttoCanvasNodes } from "../../lib/otto-canvas-bridge";
import { OttoCanvasStatus } from "../otto/OttoTrace";
import { UnderstandingCostHint } from "@/components/otto/UnderstandingCostHint";
import DetailPanel from "@/components/asset/DetailPanel";
import { MentionInput } from "@/components/MentionInput";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { EntityDTO } from "@/lib/types";
import { filterNodesByConvo, convoColor } from "@/lib/convo-canvas";
import { creditsLabel } from "@/lib/credit-format";
import {
  CANVAS_IMAGE_DEFAULT_COUNT,
  CANVAS_IMAGE_MAX_VARIANT_COUNT,
  canvasGenCostQuote,
  clampImageVariantCount,
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
import { ImageShapePicker } from "@/components/gen/ImageShapePicker";
import { VideoSpecPicker } from "@/components/gen/VideoSpecPicker";
import type { CanvasImageShapes, CanvasVideoSpecs } from "@/components/canvas/useCanvasGen";
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
import { canvasBatchDeleteCopy, canvasBatchSelection, mergeReloadedCanvasNodes } from "@/lib/canvas-selection";
import {
  CANVAS_OTTO_CHAT_REQUIRED,
  canvasComposerReferenceForNode,
  canvasSendToOttoTitle,
  type OttoComposerReference,
} from "@/lib/canvas-chat-reference";
import {
  canvasMediaNodeSize,
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
/**
 * #840 车4 —— 板底那条工具条上一枚键的类。
 *
 * `cv-tb` 留在原地:`.gb .cv-tb` 是两个类的选择器,专有度高过 Button 自带的任何一条工具类,
 * 所以 36×36、9px 圆角、透明底、hover 变 muted、以及 `.gb .cv-tb-active` 的选中底色都照旧
 * 由它说了算,一处没动。Button 只补进原语该有的东西(焦点环、disabled 语义、按下反馈)。
 * 三条显式压回 —— 每一条都是 `.gb .cv-tb` **没有声明**、因而压不住的那一项:
 *  · `p-0` —— 这一枚是 36×36 的定宽方钮,自己不写内距(preflight 已把原生按钮的内距清零)。
 *    Button 的 `size` 默认带 `px-5`,左右各 20px 加起来超过 36px 的整宽,content box 被压到
 *    0,里面那枚 shrink-0 的图标就会溢出、偏出中心。同理下面 `.cv-play` 那一枚 30×30 的圆钮。
 *  · `[&_svg]:size-[18px]` —— Button 强制子级 svg 为 1.1em(命中的是子元素,不是这枚键
 *    自己,所以 `.gb .cv-tb` 压不住它),而这一排图标原本就是 18px。
 *  · `disabled:opacity-100` —— `.gb .cv-tb:disabled` 只改文字色不改透明度,Button 默认的
 *    `disabled:opacity-40` 会让停用态比原来更淡。
 */
const CV_TOOLBAR_BUTTON_CLASS = "cv-tb p-0 [&_svg]:size-[18px] disabled:opacity-100";

const CANVAS_CARD_SIDE = 320;
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
  /**
   * Whether the gb composer starts open. Otto's canvas keeps the Grok pattern — revealed by the
   * image tool, default false. The north-star canvas page shows the prompt box as part of the
   * page itself, so it opens with the board (#600 · spec #599 D2). Display state only: the
   * merchant can still close it, and nothing about the paid path changes either way.
   */
  defaultComposerOpen?: boolean;
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
  defaultComposerOpen = false,
}: FlowCanvasProps) {
  const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
  const [prompt, setPrompt] = useState("");
  const [promptIds, setPromptIds] = useState<string[]>([]); // @mentioned entity ids
  const [variantSel, setVariantSel] = useState<Record<string, string>>({}); // entityId → variant from @mention chip
  // holds the generationId whose detail panel is open (null = closed)
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [filterToConvo, setFilterToConvo] = useState(false);
  // gb toolbar: the prompt composer is hidden behind the Generate button (Grok
  // pattern) instead of sitting persistently on the canvas. Display state only.
  // The north-star canvas page opts into starting it open (`defaultComposerOpen`).
  const [composerOpen, setComposerOpen] = useState(defaultComposerOpen);
  // Canvas tool: pan (grab hand, drag pans the board) vs select (arrow cursor,
  // drag box-selects). The toolbar's cursor button toggles this. Display-only.
  const [panMode, setPanMode] = useState(true);
  // Deleting a canvas card asks for confirmation first (they were too easy to
  // remove by accident). Holds the node id awaiting confirm; null = no dialog.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Same confirm, for a whole multi-card selection (#547 B6). Holds the ids awaiting
  // confirm; null = no dialog.
  const [pendingBatchDeleteIds, setPendingBatchDeleteIds] = useState<string[] | null>(null);
  // How many images one Generate makes. Founder default is still 1; the merchant can ask
  // for up to the cap and the price shown next to Generate follows the choice (#547 A2).
  const [imageCount, setImageCount] = useState<number>(CANVAS_IMAGE_DEFAULT_COUNT);
  // #777:这几张要不要当**一组连贯的图**来做(同一个模特的几个角度、同一件产品的几个
  // 尺寸)。默认关 —— 多张图今日的含义是「几个不同的选择」,默认打开会把那个含义悄悄
  // 换掉。开关只在 >1 张时出现,而且**不改价**(仍按张收),所以它旁边不需要第二个价钱。
  const [imageCoherentSet, setImageCoherentSet] = useState(false);
  // #643 T2：这次出图的形状。菜单与默认值都来自服务端（`imageShapes`）—— 界面一格都不写死，
  // 所以商家看见的每一格都是引擎真给得了的，且选中的那一格就是会交付的那一格。
  const [imageShapeMenu, setImageShapeMenu] = useState<CanvasImageShapes | null>(null);
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
  // bumped on successful generation submit to remount MentionInput cleared
  const [composerKey, setComposerKey] = useState(0);
  // double-submit guard
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [costQuote, setCostQuote] = useState<CanvasGenCostQuote | null>(null);
  const imageActionRef = useRef<{ material: string; actionId: string } | null>(null);
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
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const fittedScopeRef = useRef<string | null>(null);
  const fitTimerRef = useRef<number | null>(null);
  const lineageReloadTimerRef = useRef<number | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const closeComposer = useCallback((clearPrompt = false) => {
    setComposerOpen(false);
    if (!clearPrompt) return;
    setPrompt("");
    setPromptIds([]);
    setVariantSel({});
    setComposerKey((k) => k + 1);
  }, []);
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

  useEffect(() => {
    if (!composerOpen) return;
    let retryTimer: number | null = null;
    const focusEditor = () => {
      const editor = composerFormRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      editor?.focus();
      return !!editor;
    };
    const frame = window.requestAnimationFrame(() => {
      if (!focusEditor()) retryTimer = window.setTimeout(focusEditor, 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [composerOpen, composerKey]);

  // Keep a ref to animate() so per-node closures don't go stale
  const animateFnRef = useRef<ReturnType<typeof useCanvasGen>["animate"] | null>(null);

  // Build a stable per-node onAnimate that reads generationId at call time
  const onAnimateByNode = useRef<Record<string, () => void>>({});
  const scheduleFitView = useCallback(() => {
    if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    fitTimerRef.current = window.setTimeout(() => {
      fitTimerRef.current = null;
      void flowRef.current?.fitView({ padding: 0.22, duration: 160 });
    }, 80);
  }, []);

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

  const fitMediaNodeToSize = useCallback((id: string, media: CanvasMediaSize) => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((n) => {
        if (n.id !== id || (n.type !== "image" && n.type !== "video")) return n;
        const currentSize = {
          w: Number(n.style?.width ?? DEFAULT_CANVAS_MEDIA_NODE_SIDE),
          h: Number(n.style?.height ?? DEFAULT_CANVAS_MEDIA_NODE_SIDE),
        };
        const fitted = canvasMediaNodeSize(media, currentSize);
        if (!hasCanvasNodeSizeChanged(currentSize, fitted)) return n;
        changed = true;
        return { ...n, style: { ...n.style, width: fitted.w, height: fitted.h } };
      }) as CanvasFlowNode[];
      if (changed) nodesRef.current = next;
      return changed ? next : current;
    });
  }, []);

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
      link.href = item.url;
      link.download = item.fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    toast.success(downloads.length === 1 ? "Saving 1 file." : `Saving ${downloads.length} files.`);
  }, []);

  // stable text-change
  const onTextChange = useCallback((id: string, text: string) => {
    void updateTextNode(projectId, id, text);
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
            ...(n.type === "image" && !updated.data.onAnimate ? { onAnimate: getOnAnimate(id) } : {}),
            ...(!updated.data.onMediaSize ? { onMediaSize: getOnMediaSize(id) } : {}),
          };
        }
        return updated;
      }),
    );
  }, [getOnAnimate, getOnMediaSize, getOnOpenDetail, sendSelectionToOtto]);

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
        setImageShapeMenu(shapes);
        setImageShape((current) => current ?? shapes.defaultAspect);
      })
      .catch(() => setImageShapeMenu(null));
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

  // Shared submit handler — used by form onSubmit and MentionInput onSubmit
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (!costQuote) {
      toast.error("Wait for the exact image cost before generating.");
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // The number of images is part of what the merchant authorized (it multiplies the
      // charge), so it is part of the action's material — asking for 4 after asking for 1 is
      // a different action, not a retry of the same one.
      const count = clampImageVariantCount(imageCount);
      // #643 T2：形状和张数一样，是商家授权内容的一部分 —— 要竖版之后再要方图是**另一个**
      // 动作，不是同一个动作的重试。所以它进材料。
      const aspectRatio = imageShapeMenu ? imageShape : null;
      // #777:「一组连贯的图」不改价,但它改的是**交付物** —— 要一组之后再要一堆散图
      // 是另一个动作,不是同一个动作的重试。所以它和张数、形状一样进材料。
      const coherentSet = count > 1 && imageCoherentSet;
      const material = JSON.stringify({
        projectId,
        threadId: activeThreadId ?? null,
        kind: "image",
        prompt: prompt.trim(),
        entityIds: promptIds,
        variantSel: Object.fromEntries(
          Object.entries(variantSel).sort(([left], [right]) => left.localeCompare(right)),
        ),
        count,
        aspectRatio,
        coherentSet,
      });
      if (imageActionRef.current?.material !== material) {
        imageActionRef.current = { material, actionId: freshCanvasActionId() };
      }
      const accepted = await generateImage(
        prompt.trim(),
        spawnRect(count),
        promptIds,
        variantSel,
        count,
        {
          actionId: imageActionRef.current.actionId,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(coherentSet ? { coherentSet: true } : {}),
        },
      );
      if (accepted) {
        imageActionRef.current = null;
        closeComposer(true);
      } else if (!loadCanvasActionReceipts(projectId).some((receipt) => receipt.actionId === imageActionRef.current?.actionId)) {
        // A deterministic rejection (including a dispatch failure that was refunded) clears
        // the receipt. The next explicit retry is therefore a new authorized action. Unknown
        // outcomes retain the receipt and this same UI action ID.
        imageActionRef.current = null;
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [activeThreadId, closeComposer, costQuote, generateImage, imageCoherentSet, imageCount, imageShape, imageShapeMenu, projectId, prompt, promptIds, spawnRect, variantSel]);

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
  const runImageEvolve = useCallback(async (id: string, rawPrompt: string, aspect?: string): Promise<boolean> => {
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
    }
  }, [activeThreadId, costQuote, generateImage, projectId, spawnRect]);

  const handleEvolve = useCallback((id: string, text: string, aspect?: string) => {
    void runImageEvolve(id, text, aspect);
  }, [runImageEvolve]);

  /** 事件处理里按 id 取同一件事（渲染期不许读 ref —— 那是 React 的规矩，也是本仓库的 lint 闸）。 */
  const nodeImageShape = useCallback((id: string): string | undefined => (
    recordedImageShape(nodesRef.current.find((n) => n.id === id), imageShape)
  ), [imageShape]);

  const handleVariant = useCallback((id: string, aspect?: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const prompt = typeof node?.data?.prompt === "string" ? node.data.prompt : "";
    if (!prompt.trim()) {
      toast.error("This image has no saved description to build on.");
      return;
    }
    void runImageEvolve(id, prompt, aspect ?? nodeImageShape(id));
  }, [runImageEvolve, nodeImageShape]);

  // Add an empty text node (display-only, no spend) — the canvas toolbar's text tool.
  const addTextNode = useCallback(async () => {
    closeComposer(false);
    const { x, y } = spawnRect();
    const result = await createCanvasNode({ projectId, type: "text", x, y, w: 240, h: 120, text: "", status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
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
      console.warn("Failed to create text node:", result.error);
    }
  }, [projectId, activeThreadId, onTextChange, skin, scheduleFitView, closeComposer, spawnRect]);

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
            data: { status: "done", url: res.src, generationId: res.id, skin, onDelete: () => setPendingDeleteId(created.id), onRefresh: requestReload, onAnimate: getOnAnimate(created.id), onOpenDetail: getOnOpenDetail(created.id), onSendToOtto: sendSelectionToOtto, onMediaSize: getOnMediaSize(created.id) },
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
    closeComposer(false);
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
  }, [closeComposer]);

  // Cost transparency (宪法 3): images generate with no confirm dialog, so the quote
  // must be loaded while the composer is visible — its cost label sits next to the
  // Generate button. Video/t2v quotes still load when their confirm dialogs open.
  const composerVisible = skin === "gb" ? composerOpen : true;
  // Same rule for a selected card's attached bar and its "More like this" button: both show
  // the exact price before submit (#550 ②, #547 A3/A4), so the quote has to be loaded while
  // a card is selected. ensureModels caches after the first call, so re-selecting cards
  // costs no round trips.
  const cardBarVisible = nodes.some(
    (n) => (n.type === "image" || n.type === "video")
      && n.selected === true
      && imageNodeActionable(n.data as { status?: string; url?: string; generationId?: string }),
  );
  useEffect(() => {
    if (composerVisible || cardBarVisible || pendingAnimateId !== null || t2vOpen) refreshCostQuote();
  }, [composerVisible, cardBarVisible, pendingAnimateId, t2vOpen, refreshCostQuote]);

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
    queueMicrotask(() => setLineageUnavailable(!("rows" in read)));
    if (!("rows" in read)) return;
    const mapped = read.rows.map((r) => {
      nodeDataRef.current[r.id] = { generationId: r.generationId ?? undefined, pos: { x: r.x, y: r.y } };
      const nodeSize = (r.type === "image" || r.type === "video")
        ? canvasMediaNodeSize({ width: r.mediaWidth, height: r.mediaHeight }, { w: r.w, h: r.h })
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
  }, [skin, projectId, onTextChange, getOnAnimate, getOnMediaSize, getOnOpenDetail, sendSelectionToOtto, requestReload]);
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

  // A direct canvas generation can finish after the original client poll was
  // interrupted. While a paid image/video card is still unresolved, keep asking
  // the server reload path to reconcile owned GenJobs into visible media.
  useEffect(() => {
    if (!hasInFlightPaidNode) return;
    const id = window.setInterval(() => {
      void reloadRef.current?.();
    }, 5000);
    return () => window.clearInterval(id);
  }, [hasInFlightPaidNode]);

  // ReactFlow's `fitView` prop only runs on mount, before our async canvas nodes arrive.
  // Fit once per project after nodes load so left-edge node action buttons do not
  // sit underneath the Otto panel and become visible-but-unclickable.
  useEffect(() => {
    if (!flowReady || !flowRef.current || nodes.length === 0) return;
    const scope = projectId;
    if (fittedScopeRef.current === scope) return;
    fittedScopeRef.current = scope;
    requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.22, duration: 160 });
    });
  }, [flowReady, nodes.length, projectId]);

  // When the active thread's OTTO work starts, reload so the server bridge can
  // place a pending GenJob card on the canvas. When it finishes, reload again
  // so the produced media replaces that pending card.
  const prevActivityRef = useRef<{ threadId: string | null; pending: boolean }>({ threadId: null, pending: false });
  useEffect(() => {
    const pending = !!(activeThreadId && activity?.has(activeThreadId));
    const prev = prevActivityRef.current;
    const threadChanged = prev.threadId !== activeThreadId;
    if (pending && (!prev.pending || threadChanged)) {
      void reload();
    } else if (!pending && prev.pending && !threadChanged) {
      void reload();
    }
    prevActivityRef.current = { threadId: activeThreadId, pending };
  }, [activity, activeThreadId, reload]);

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
  // #785 判官 r2 P1-a —— 出片框只在 @元素**真的会进引擎**时才提这件事。
  //
  // 承诺与执行必须同源:这个布尔值来自服务端解析的那一份(`getActiveGenModels`),而它读的
  // 判据与选片名额、卡面规格条目是同一个函数。备用适配器那条路上元素照一张都上不了车,
  // 界面于是一个字都不提 —— 替一条做不到的路许诺,商家会照着那句话去 @,然后付钱拿到一支
  // 跟他的产品毫无关系的片子。菜单没取到(null)⇒ 同样闭嘴:没确认的事不许说。
  const t2vElementsRide = videoSpecMenu?.elementReferences === true;
  // Image generation has no confirm dialog (founder 2026-07-06, constitutional exception ①
  // "balance is the gate"), so the cost must be visible AT the input before submit (宪法 3).
  // The composer's price follows the chosen number of images, from the same clamp the paid
  // call applies — the label and the charge can never disagree (#547 A2).
  const composerCostHint = genCostHint(
    costQuote ? canvasGenCostQuote(costQuote, imageCount).imageCredits : undefined,
  );
  // A card's own bar makes ONE image built on that card, so it is priced by the single-image
  // quote — one source, no second price for the same action (#550 ②, #547 A4).
  const evolveCostHint = genCostHint(costQuote?.imageCredits);
  // 视频卡的「More like this」是去开 t2v 确认框的,所以这里报的必须是**那个框会用的那一档**
  // 的价 —— 报默认档就会出现「卡上说 11、框里收 27」。价格仍然只有服务端那一个来源。
  const remakeCostHint = genCostHint(specCredits(t2vSpec) ?? costQuote?.videoCredits);
  const nodesOnBoard = filterNodesByConvo(nodes, activeThreadId, filterToConvo);
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
          onEvolve: handleEvolve,
          onVariant: handleVariant,
          evolveCostHint,
          onOpenLineage: openLineage,
          // #643 T2: the shape a new take of THIS card will be delivered in — this card's own
          // recorded shape, so "make another one like this" keeps the shape by default. The menu
          // comes from the server; the card writes down nothing itself.
          imageShape: recordedImageShape(n, imageShape),
          imageShapeOptions: imageShapeMenu?.options,
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
    <div
      ref={canvasHostRef}
      style={{ flex: 1, width: "100%", height: "100%", minHeight: 0, position: "relative", overflow: "hidden" }}
      className={skin === "gb" ? (panMode ? "gb" : "gb cv-select-mode") : undefined}
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
        <OttoCanvasStatus label="working on it…" />
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
        <div style={{ position: "absolute", inset: 0 }}>
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
            fitView
            fitViewOptions={{ padding: 0.22 }}
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
        // Every bottom-anchored control lives in ONE column (#604 r2): composer, then the
        // multi-card bar, then the tool row. Stacked rows cannot cover each other, which
        // is exactly what the old "two bars, same bottom: 20px" pair did.
        <div className="cv-bottom-stack">
          {/* Composer — hidden until Generate is clicked (Grok pattern). Reuses the
              existing handleGenerate spend path unchanged; sits on top of the stack. */}
          {composerOpen && (
            <form
              ref={composerFormRef}
              className="al-promptbar cv-composer-pop"
              // Fixed 520px used to get clipped by the host's overflow:hidden whenever
              // the canvas pane shrank below that (narrow chat pane + nav rail at
              // 1024–1279px, #513). maxWidth caps it to the stack's own width, which is
              // already inset from the host, so the fee note and close button are never
              // cut off.
              style={{ width: 520, maxWidth: "100%" }}
              onSubmit={(e) => { e.preventDefault(); void handleGenerate(); }}
            >
              <div className="al-input-wrap" style={{ flex: 1, minWidth: 0, border: "none", background: "none", padding: 0 }}>
                <MentionInput
                  entities={entities}
                  docKey={`canvas-${composerKey}`}
                  placeholder="Describe an image… (@ to reference your stuff)"
                  onChange={(t, ids, vsel) => { setPrompt(t); setPromptIds(ids); setVariantSel(vsel); }}
                  onSubmit={() => void handleGenerate()}
                />
              </div>
              {/* One row for "what this Generate will make": how many, and what shape. Both are
                  answers to the same question, so they sit together rather than as two stray
                  full-width rows in the composer's column (#643 T2). */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {/* A2: how many images this one Generate makes. The price beside it follows the
                    choice, so the merchant sees the real total before pressing anything. */}
                <div
                  role="group"
                  aria-label="How many images to make"
                  style={{ display: "flex", gap: 2, alignItems: "center" }}
                >
                  {Array.from({ length: CANVAS_IMAGE_MAX_VARIANT_COUNT }, (_, i) => i + 1).map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant={imageCount === n ? "default" : "ghost"}
                      size="sm"
                      className="h-auto px-[13px] py-1.5 text-[12.5px] shadow-none"
                      aria-pressed={imageCount === n}
                      aria-label={n === 1 ? "Make 1 image" : `Make ${n} images`}
                      title={n === 1 ? "Make 1 image" : `Make ${n} images in one go`}
                      style={{ minWidth: 30, paddingInline: 8 }}
                      onClick={() => setImageCount(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
                {/* #643 T2: the shape this Generate will deliver. The menu is whatever the server
                    says the engine can make — nothing is written down here — and the selected one
                    is exactly what the request carries. Costs the same in every shape. */}
                {imageShapeMenu && imageShape && (
                  <ImageShapePicker
                    compact
                    value={imageShape}
                    options={imageShapeMenu.options}
                    onChange={setImageShape}
                    title="The shape these images will be made in — same cost in every shape"
                  />
                )}
                {/* #777: one coherent set vs several independent options. Only meaningful for
                    more than one image, so it only exists then. It costs the same either way —
                    the label says so, because a toggle beside a price that doesn't move it is
                    a question the merchant would otherwise have to guess the answer to. */}
                {imageCount > 1 && (
                  <div
                    className="flex items-center gap-2"
                    title="Make these as one set — the same subject, wardrobe and style across every image. Same cost either way."
                  >
                    <Checkbox
                      id="canvas-coherent-set"
                      checked={imageCoherentSet}
                      onCheckedChange={(checked) => setImageCoherentSet(checked === true)}
                    />
                    <Label htmlFor="canvas-coherent-set" className="text-[0.75rem] font-normal text-muted-foreground">
                      Keep as one set
                    </Label>
                  </div>
                )}
              </div>
              <span className="text-[0.75rem] text-muted-foreground" style={{ whiteSpace: "nowrap" }} title="Charged when you press Generate">{composerCostHint}</span>
              <Button variant="default" size="sm" className="h-auto px-[13px] py-1.5 text-[12.5px] shadow-none" type="submit" disabled={!costQuote || submitting || !prompt.trim()}>Generate</Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-[13px] py-1.5 text-[12.5px] [&_svg]:size-[15px]"
                type="button"
                title="Close prompt"
                aria-label="Close image prompt"
                onClick={() => closeComposer(true)}
              >
                <X size={15} strokeWidth={2.2} aria-hidden />
              </Button>
            </form>
          )}
          {/* B6: what to do with several cards at once. Appears only when more than one card
              is selected, so the single-card toolbar is untouched. */}
          {selection.count > 1 && (
            // Its own row in the stack. It used to be pinned to the same bottom edge as the
            // tool row with a higher z-index, so as soon as it grew it covered the zoom/fit/
            // hand/select tools and they stopped being clickable (#604 r2 P2①). The row still
            // wraps rather than getting clipped when the pane is narrow (#513).
            <div className="cv-batchbar" role="toolbar" aria-label="Selected cards">
              <span className="text-[0.8125rem]" style={{ whiteSpace: "nowrap" }}>{selection.count} selected</span>
              {/* Side by side, and only for what the recorded facts allow: the two cards of a
                  press that really made two. Any two cards of a batch of four have no A and no B,
                  and a card beside the card it was made from is a different thing to put on
                  screen — neither is offered here (#605 验收② · r1 P1-2 · #603 T4). */}
              {comparePair && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-[13px] py-1.5 text-[12.5px]"
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
                className="h-auto px-[13px] py-1.5 text-[12.5px]"
                title={sendToOttoTitle}
                onClick={sendSelectionToOtto}
              >
                Send to Otto
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-[13px] py-1.5 text-[12.5px]"
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
                className="h-auto px-[13px] py-1.5 text-[12.5px]"
                title="Take these cards off the board"
                onClick={() => setPendingBatchDeleteIds(selection.ids)}
              >
                Remove
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-auto px-[13px] py-1.5 text-[12.5px]" title="Deselect" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          )}
          {/* Slim bottom toolbar — the single operation center for the canvas: zoom,
              fit, hand/select, image, video, text. No separate React Flow default
              controls panel and no canvas-lock button.
              .cv-toolbar has no fixed width (sized by content), but the canvas pane
              can shrink below its natural row width (narrow chat pane + nav rail at
              1024–1279px, #513/#522) — without a cap it just grows past the host and
              gets clipped by the host's overflow:hidden. maxWidth + flexWrap here wrap
              it to a second row instead of clipping it; the cap is the stack's width,
              which is already inset from the host. */}
          <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools" style={{ flexWrap: "wrap", justifyContent: "center", maxWidth: "100%" }}>
            <Button
              type="button"
              variant="ghost"
              className={CV_TOOLBAR_BUTTON_CLASS}
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => void flowRef.current?.zoomOut({ duration: 150 })}
            >
              <ZoomOut size={18} strokeWidth={1.9} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={CV_TOOLBAR_BUTTON_CLASS}
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => void flowRef.current?.zoomIn({ duration: 150 })}
            >
              <ZoomIn size={18} strokeWidth={1.9} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={CV_TOOLBAR_BUTTON_CLASS}
              title="Fit to screen"
              aria-label="Fit to screen"
              onClick={() => void flowRef.current?.fitView({ padding: 0.22, duration: 220 })}
            >
              <Maximize2 size={18} strokeWidth={1.9} aria-hidden />
            </Button>
            <span className="cv-tb-div" />
            {/* B6: two tools instead of one toggle. As a toggle, both modes shared a button
                whose pressed state read the same after two clicks — the merchant could not
                tell which tool was live, and the box-select mode was effectively unreachable.
                Each tool now shows its own on/off state and needs exactly one click. */}
            <Button
              type="button"
              variant="ghost"
              className={cn(CV_TOOLBAR_BUTTON_CLASS, panMode && "cv-tb-active")}
              title="Hand tool — drag the board to move around"
              aria-label="Hand tool"
              aria-pressed={panMode}
              onClick={() => setPanMode(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0" /><path d="M14 10V4a2 2 0 0 0-4 0v2" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn(CV_TOOLBAR_BUTTON_CLASS, !panMode && "cv-tb-active")}
              title="Select tool — drag a box to pick several cards"
              aria-label="Select tool"
              aria-pressed={!panMode}
              onClick={() => setPanMode(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="m3 3 7.5 18 2.5-7.5L20.5 11 3 3z" /></svg>
            </Button>
            <span className="cv-tb-div" />
            <Button
              type="button"
              variant="ghost"
              className={CV_TOOLBAR_BUTTON_CLASS}
              title="Generate an image — describe what you want"
              aria-label="Generate image"
              aria-expanded={composerOpen}
              onClick={() => setComposerOpen((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={CV_TOOLBAR_BUTTON_CLASS}
              title="Make a video from a prompt"
              aria-label="Video"
              onClick={() => { closeComposer(false); setCostQuote(null); setT2vOpen(true); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8z" /></svg>
            </Button>
            <Button type="button" variant="ghost" className={CV_TOOLBAR_BUTTON_CLASS} title="Add text" aria-label="Add text" onClick={addTextNode}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="al-promptbar"
          style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", width: 560 }}
          onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}
        >
          <div className="al-input-wrap" style={{ flex: 1, minWidth: 0, border: "none", background: "none", padding: 0 }}>
            <MentionInput
              entities={entities}
              docKey={`canvas-${composerKey}`}
              placeholder="Type to imagine… (@ to reference elements)"
              onChange={(t, ids, vsel) => { setPrompt(t); setPromptIds(ids); setVariantSel(vsel); }}
              onSubmit={handleGenerate}
            />
          </div>
          <span className="text-[0.75rem] text-muted-foreground" style={{ whiteSpace: "nowrap" }} title="Charged when you press Generate">{composerCostHint}</span>
          <Button variant="default" size="sm" className="h-auto px-[13px] py-1.5 text-[12.5px] shadow-none" type="submit" disabled={!costQuote || submitting || !prompt.trim()}>Generate</Button>
          {activeThreadId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-[13px] py-1.5 text-[12.5px]"
              aria-pressed={filterToConvo}
              onClick={() => setFilterToConvo((v) => !v)}
            >
              {filterToConvo ? "Showing this convo" : "Filter to this convo"}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-auto px-[13px] py-1.5 text-[12.5px]" type="button" onClick={addTextNode}>+ Text</Button>
        </form>
      )}
      <Dialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingDeletePaid ? "Still generating — remove anyway?" : "Remove from canvas?"}</DialogTitle>
            <DialogDescription>
              {pendingDeletePaid
                ? "This one is still being made and you've already been charged for it. Removing it won't refund the credits, and it will still finish and land in your Library. If you remove it and generate again, you'll be charged a second time."
                : "This takes the card off your board. Any generated image or video stays saved in your library."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDeleteId(null)}>{pendingDeletePaid ? "Keep it" : "Cancel"}</Button>
            <Button
              variant="destructive"
              onClick={() => { if (pendingDeleteId) deleteNode(pendingDeleteId); setPendingDeleteId(null); }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pendingBatchDeleteIds !== null} onOpenChange={(open) => { if (!open) setPendingBatchDeleteIds(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{batchDeleteCopy.title}</DialogTitle>
            <DialogDescription>{batchDeleteCopy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingBatchDeleteIds(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingBatchDeleteIds) deleteNodes(pendingBatchDeleteIds);
                setPendingBatchDeleteIds(null);
              }}
            >
              Remove
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
                with a source image the engine follows that image instead of being told a ratio. */}
            {videoSpecMenu && animateSpec && (
              <VideoSpecPicker
                value={animateSpec}
                menu={videoSpecMenu.menu}
                onChange={setAnimateSpec}
                disabled={videoSubmitting}
                hasSourceImage
              />
            )}
            <div className="flex gap-2">
              {([["gentle", "Gentle"], ["dynamic", "Dynamic"], ["custom", "Custom"]] as const).map(([key, label]) => (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  onClick={() => setMotion(key)}
                  aria-pressed={motion === key}
                  // #840 车4:两态配色原来就是显式写的,原样保留;只把 Button 自带的
                  // h-11 / px-5 / font-semibold 压回这一排选项键的原值(内距 px-3 py-2、
                  // 高度随内容、常规字重)。
                  className={`h-auto flex-1 rounded-lg border px-3 py-2 text-sm font-normal transition-colors ${motion === key ? "border-foreground bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}
                >
                  {label}
                </Button>
              ))}
            </div>
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
                className="h-auto rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-none focus-visible:ring-ring/40"
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={videoSubmitting} onClick={() => setPendingAnimateId(null)}>Cancel</Button>
            <Button
              disabled={!costQuote || videoSubmitting}
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
              {costQuote ? videoSubmitting ? "Starting..." : "Make video" : "Checking cost..."}
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
              default is the model's own t2v default (16:9), not Adaptive. */}
          {videoSpecMenu && t2vSpec && (
            <VideoSpecPicker
              value={t2vSpec}
              menu={videoSpecMenu.menu}
              onChange={setT2vSpec}
              disabled={videoSubmitting}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={videoSubmitting} onClick={resetT2v}>Cancel</Button>
            <Button
              disabled={!t2vPrompt.trim() || !costQuote || videoSubmitting}
              onClick={async () => {
                const p = t2vPrompt.trim();
                if (p && await runT2v(p)) resetT2v();
              }}
            >
              {costQuote ? videoSubmitting ? "Starting..." : "Make video" : "Checking cost..."}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
