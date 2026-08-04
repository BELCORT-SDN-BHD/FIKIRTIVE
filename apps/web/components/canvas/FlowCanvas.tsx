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
import DetailPanel from "@/components/asset/DetailPanel";
import { MentionInput } from "@/components/MentionInput";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { canvasBatchDeleteCopy, canvasBatchSelection, mergeReloadedCanvasNodes } from "@/lib/canvas-selection";
import { DEFAULT_CANVAS_NODE_LOCK_REASON } from "@/lib/canvas-node-lock";
import { canvasComposerReferenceForNode, type OttoComposerReference } from "@/lib/canvas-chat-reference";
import {
  canvasMediaNodeSize,
  DEFAULT_CANVAS_MEDIA_NODE_SIDE,
  hasCanvasNodeSizeChanged,
  type CanvasMediaDimensions,
} from "@/lib/canvas-node-size";

type CanvasFlowNode = Node & { threadId: string | null; sourceNodeId?: string | null };
const CANVAS_CARD_SIDE = 320;
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
  directToolsLocked?: boolean;
  directToolsLockedReason?: string;
  /**
   * Whether the gb composer starts open. Otto's canvas keeps the Grok pattern — revealed by the
   * image tool, default false. The north-star canvas page shows the prompt box as part of the
   * page itself, so it opens with the board (#600 · spec #599 D2). Display state only: the
   * merchant can still close it, and nothing about the paid path changes either way.
   */
  defaultComposerOpen?: boolean;
};

// Must be stable (defined outside component) per ReactFlow requirements
const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };
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
  directToolsLocked = false,
  directToolsLockedReason = DEFAULT_CANVAS_NODE_LOCK_REASON,
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
  // Making a video costs credits — clicking "Make video" opens a confirm first.
  // Holds the source image node id awaiting confirm; null = no dialog.
  const [pendingAnimateId, setPendingAnimateId] = useState<string | null>(null);
  // Motion choice for the "Make a video?" dialog (Phase 1a). Custom falls back to
  // the gentle default so the paid prompt is never empty.
  const [motion, setMotion] = useState<"gentle" | "dynamic" | "custom">("gentle");
  const [customMotion, setCustomMotion] = useState("");
  // Dragging an image file over the canvas (drop = upload it as an image node).
  const [dragOver, setDragOver] = useState(false);
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
  const withNodeActionLock = useCallback((data: Record<string, unknown>) => ({
    ...data,
    directToolsLocked,
    directToolsLockedReason,
  }), [directToolsLocked, directToolsLockedReason]);

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
    if (!composerOpen || directToolsLocked) return;
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
  }, [composerOpen, directToolsLocked, composerKey]);

  // Keep a ref to animate() so per-node closures don't go stale
  const animateFnRef = useRef<ReturnType<typeof useCanvasGen>["animate"] | null>(null);

  // Build a stable per-node onAnimate that reads generationId at call time
  const onAnimateByNode = useRef<Record<string, () => void>>({});
  const directToolsLockedRef = useRef(directToolsLocked);
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
        if (directToolsLockedRef.current) return;
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
    if (directToolsLockedRef.current) return false;
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
    const material = JSON.stringify({
      projectId,
      threadId: activeThreadId ?? null,
      kind: "animate",
      sourceNodeId: id,
      sourceGenerationId: entry.generationId,
      prompt: motionPrompt,
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
  }, [activeThreadId, costQuote, projectId, spawnRect]);

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
    if (directToolsLockedRef.current) return;
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
    // in a plain note rather than an error (#604).
    if (!referenceHandlerRef.current) {
      toast.message("Start a conversation with Otto first, then send these over.");
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
    if (directToolsLockedRef.current) return;
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
    if (directToolsLockedRef.current || ids.length === 0) return;
    const removing = new Set(ids);
    for (const id of removing) removedNodeIdsRef.current.add(id);
    setNodes((ns) => ns.filter((n) => !removing.has(n.id)));
    for (const id of ids) void deleteCanvasNode(projectId, id);
  }, [projectId]);

  const clearSelection = useCallback(() => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
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

  const onNewNode = useCallback(
    (n: { id: string; type: "image" | "video"; pos: { x: number; y: number; w: number; h: number }; status: string; prompt: string; sourceNodeId?: string }) => {
      nodeDataRef.current[n.id] = { pos: { x: n.pos.x, y: n.pos.y } };
      setNodes((ns) => [
        ...ns,
        {
          id: n.id,
          type: n.type,
          position: { x: n.pos.x, y: n.pos.y },
          data: {
            ...withNodeActionLock({
              status: n.status,
              prompt: n.prompt,
              skin,
              // The card it came from, so the lineage line can be drawn straight away
              // instead of only after the next board reload (#547 B4).
              sourceNodeId: n.sourceNodeId ?? null,
              onDelete: () => setPendingDeleteId(n.id),
              onRefresh: requestReload,
              onMediaSize: getOnMediaSize(n.id),
              onSendToOtto: sendSelectionToOtto,
              // onAnimate added after generationId arrives via onResolve
            }),
          },
          style: { width: n.pos.w, height: n.pos.h, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
          sourceNodeId: n.sourceNodeId ?? null,
        },
      ]);
      scheduleFitView();
    },
    [activeThreadId, getOnMediaSize, sendSelectionToOtto, requestReload, skin, scheduleFitView, withNodeActionLock],
  );

  const onGenError = useCallback((msg: string) => { toast.error(msg); }, []);
  const { generateImage, animate, generateVideoFromText, quoteCosts } = useCanvasGen(
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
  }, [quoteCosts]);
  // keep animateFnRef current (in an effect — refs must not be written during render)
  useEffect(() => { animateFnRef.current = animate; }, [animate]);

  // Shared submit handler — used by form onSubmit and MentionInput onSubmit
  const handleGenerate = useCallback(async () => {
    if (directToolsLocked) return;
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
        { actionId: imageActionRef.current.actionId },
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
  }, [activeThreadId, closeComposer, costQuote, directToolsLocked, generateImage, imageCount, projectId, prompt, promptIds, spawnRect, variantSel]);

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
  const runImageEvolve = useCallback(async (id: string, rawPrompt: string): Promise<boolean> => {
    if (directToolsLockedRef.current) return false;
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
    const material = JSON.stringify({
      projectId,
      threadId: activeThreadId ?? null,
      kind: "image",
      sourceNodeId: id,
      sourceGenerationId: entry.generationId,
      prompt: text,
      count: 1,
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
        { actionId, sourceGenerationId: entry.generationId, sourceNodeId: id },
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

  const handleEvolve = useCallback((id: string, text: string) => {
    void runImageEvolve(id, text);
  }, [runImageEvolve]);

  const handleVariant = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const prompt = typeof node?.data?.prompt === "string" ? node.data.prompt : "";
    if (!prompt.trim()) {
      toast.error("This image has no saved description to build on.");
      return;
    }
    void runImageEvolve(id, prompt);
  }, [runImageEvolve]);

  // Add an empty text node (display-only, no spend) — the canvas toolbar's text tool.
  const addTextNode = useCallback(async () => {
    if (directToolsLocked) return;
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
          data: withNodeActionLock({ text: "", status: "done", skin, onChange: (t: string) => onTextChange(result.id, t), onDelete: () => setPendingDeleteId(result.id) }),
          style: { width: 240, height: 120, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    } else {
      console.warn("Failed to create text node:", result.error);
    }
  }, [projectId, activeThreadId, onTextChange, skin, directToolsLocked, scheduleFitView, closeComposer, spawnRect, withNodeActionLock]);

  // Drag-and-drop an image file from anywhere onto the canvas → upload it as an
  // image node. Upload-only (uploadReference creates an UPLOAD Generation); it
  // does NOT call the generation/spend path. The node is animatable afterward
  // (it has a generationId), and a real prompt is sent on Animate (see #5 fix).
  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (directToolsLockedRef.current) return;
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
            data: withNodeActionLock({ status: "done", url: res.src, generationId: res.id, skin, onDelete: () => setPendingDeleteId(created.id), onRefresh: requestReload, onAnimate: getOnAnimate(created.id), onOpenDetail: getOnOpenDetail(created.id), onSendToOtto: sendSelectionToOtto, onMediaSize: getOnMediaSize(created.id) }),
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
  }, [projectId, activeThreadId, getOnAnimate, getOnMediaSize, getOnOpenDetail, sendSelectionToOtto, requestReload, skin, scheduleFitView, spawnRect, withNodeActionLock]);

  // Phase 3: text-to-video — the bottom video tool always opens a prompt dialog;
  // image cards own the explicit "Make video" image-to-video path.
  const [t2vOpen, setT2vOpen] = useState(false);
  const [t2vPrompt, setT2vPrompt] = useState("");
  const runT2v = useCallback(async (prompt: string): Promise<boolean> => {
    if (directToolsLocked || videoBusyRef.current) return false;
    if (!costQuote) {
      toast.error("Wait for the exact video cost before confirming.");
      return false;
    }
    videoBusyRef.current = true;
    setVideoSubmitting(true);
    const material = JSON.stringify({
      projectId,
      threadId: activeThreadId ?? null,
      kind: "video",
      prompt,
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
  }, [activeThreadId, costQuote, directToolsLocked, generateVideoFromText, projectId, spawnRect]);

  /** "More like this" / an edited prompt on a VIDEO card. Video always keeps its explicit
   *  cost confirm (founder rule), so this seeds the same dialog instead of spending. */
  const handleVideoRemake = useCallback((_id: string, text: string) => {
    if (directToolsLockedRef.current) return;
    const prompt = text.trim();
    if (!prompt) return;
    closeComposer(false);
    setCostQuote(null);
    setT2vPrompt(prompt);
    setT2vOpen(true);
  }, [closeComposer]);

  useEffect(() => {
    directToolsLockedRef.current = directToolsLocked;
  }, [directToolsLocked]);
  // When the lock engages, close the composer and every open spend dialog. Render-phase
  // "adjust state when a prop changes" (React docs pattern) — not setState-in-effect.
  const [prevToolsLocked, setPrevToolsLocked] = useState(directToolsLocked);
  if (prevToolsLocked !== directToolsLocked) {
    setPrevToolsLocked(directToolsLocked);
    if (directToolsLocked) {
      closeComposer(true);
      setPendingDeleteId(null);
      setPendingBatchDeleteIds(null);
      setPendingAnimateId(null);
      setT2vOpen(false);
      setT2vPrompt("");
    }
  }

  // Cost transparency (宪法 3): images generate with no confirm dialog, so the quote
  // must be loaded while the composer is visible — its cost label sits next to the
  // Generate button. Video/t2v quotes still load when their confirm dialogs open.
  const composerVisible = skin === "gb" ? composerOpen : !directToolsLocked;
  // Same rule for a selected card's attached bar and its "More like this" button: both show
  // the exact price before submit (#550 ②, #547 A3/A4), so the quote has to be loaded while
  // a card is selected. ensureModels caches after the first call, so re-selecting cards
  // costs no round trips.
  const cardBarVisible = !directToolsLocked && nodes.some(
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
    const rows = skin === "gb"
      ? await syncOttoCanvasNodes(projectId)
      : await listCanvasNodes(projectId);
    if (seq !== reloadSeqRef.current) return;
    if ("error" in (rows as object)) return;
    const mapped = (rows as Array<CanvasNodeDTO & { url?: string | null }>).map((r) => {
      nodeDataRef.current[r.id] = { generationId: r.generationId ?? undefined, pos: { x: r.x, y: r.y } };
      const nodeSize = (r.type === "image" || r.type === "video")
        ? canvasMediaNodeSize({ width: r.mediaWidth, height: r.mediaHeight }, { w: r.w, h: r.h })
        : { w: r.w, h: r.h };
      return {
        id: r.id,
        type: r.type,
        position: { x: r.x, y: r.y },
        data: withNodeActionLock({
          // This card came OUT of a board read, so the server has answered for it. If a later
          // read stops returning it, that is a deletion rather than a read running behind
          // (#612 r4) — reads omit tombstones, so nothing else could ever say so.
          serverKnown: true,
          // A node with a resolved media URL is finished — show the image. Canvas
          // nodes persist status "pending" and aren't updated to "done" in the DB,
          // so without this a completed generation re-renders as "generating
          // forever" on reload (founder bug: image loads forever).
          status: r.url ? "done" : r.status,
          url: r.url ?? undefined,
          generationId: r.generationId ?? undefined,
          prompt: r.prompt,
          text: r.text,
          skin,
          // Traceability the card carries with it: when, with what, at what cost, from what.
          lineage: r.lineage ?? null,
          sourceNodeId: r.sourceNodeId ?? null,
          onDelete: () => setPendingDeleteId(r.id),
          onRefresh: requestReload,
          onChange: r.type === "text" ? (t: string) => onTextChange(r.id, t) : undefined,
          onAnimate: r.type === "image" ? getOnAnimate(r.id) : undefined,
          onOpenDetail: r.type === "image" || r.type === "video" ? getOnOpenDetail(r.id) : undefined,
          onSendToOtto: r.type === "image" || r.type === "video" ? sendSelectionToOtto : undefined,
          onMediaSize: r.type === "image" || r.type === "video" ? getOnMediaSize(r.id) : undefined,
        }),
        style: { width: nodeSize.w, height: nodeSize.h, boxShadow: `0 0 0 2px ${convoColor(r.threadId ?? null)}` },
        threadId: r.threadId ?? null,
        sourceNodeId: r.sourceNodeId ?? null,
      } as CanvasFlowNode;
    });
    // Merge, not replace: keep any node that's still generating locally (server may not have
    // its URL yet) so a reload never clobbers an in-flight promptbar gen, and keep whatever the
    // merchant has selected — the board reloads on a timer, and a selection that vanishes
    // mid-action is the board undoing their work (review P2-1).
    setNodes((prev) => mergeReloadedCanvasNodes(prev, mapped, removedNodeIdsRef.current));
  }, [skin, projectId, onTextChange, getOnAnimate, getOnMediaSize, getOnOpenDetail, sendSelectionToOtto, requestReload, withNodeActionLock]);
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
    const canPersistWrites = !directToolsLockedRef.current;
    const effectiveChanges = canPersistWrites
      ? changes
      : changes.filter((c) => c.type !== "position" && c.type !== "dimensions" && c.type !== "remove");
    if (effectiveChanges.length === 0) return;
    let next = applyNodeChanges(effectiveChanges, nodesRef.current) as CanvasFlowNode[];
    const persistMoves: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const deletes: string[] = [];
    // Bridge NodeResizer dimension changes into our style-based sizing so the
    // card visually grows/shrinks on the board (display-only — no regeneration).
    for (const c of effectiveChanges) {
      if (c.type === "dimensions" && c.dimensions) {
        const { width, height } = c.dimensions;
        next = next.map((n) => (n.id === c.id ? { ...n, style: { ...n.style, width, height } } : n));
      }
    }
    for (const c of effectiveChanges) {
      if (c.type === "position" && c.position) {
        const n = next.find((x2) => x2.id === c.id);
        // Update position in ref immediately (for onAnimate offset calc)
        const entry = nodeDataRef.current[c.id];
        if (entry) entry.pos = { x: c.position.x, y: c.position.y };

        if (canPersistWrites && c.dragging === false) {
          // Read position from CHANGE object (not stale nodes closure)
          const { x, y } = c.position;
          if (n) persistMoves.push({ id: n.id, x, y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
        }
      }
      // Persist the new size when a resize gesture ends (display-only; reuses the
      // same moveCanvasNode path as a drag — no spend, just x/y/w/h).
      if (canPersistWrites && c.type === "dimensions" && c.resizing === false) {
        const n = next.find((x2) => x2.id === c.id);
        if (n) {
          const entry = nodeDataRef.current[n.id];
          if (entry) entry.pos = { x: n.position.x, y: n.position.y };
          persistMoves.push({ id: n.id, x: n.position.x, y: n.position.y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
        }
      }
      if (canPersistWrites && c.type === "remove") deletes.push(c.id);
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
  const showGraph = canvasReady && (!directToolsLocked || nodes.length > 0 || dragOver);
  const videoCostLabel = costQuote ? creditsLabel(costQuote.videoCredits) : "checking exact cost";
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
  const remakeCostHint = genCostHint(costQuote?.videoCredits);
  const directToolTitle = directToolsLocked ? directToolsLockedReason : undefined;
  const nodesOnBoard = filterNodesByConvo(nodes, activeThreadId, filterToConvo);
  // How many cards are picked right now. A card's own toolbar is about THAT card, so it only
  // appears while exactly one is picked: with several picked, neighbouring cards' toolbars
  // landed on top of each other and there was no telling which card a button would act on
  // (#604 r2 P2②). For a multi-card pick the batch bar below is the one place to act.
  const selectedCount = nodesOnBoard.filter((n) => n.selected === true).length;
  const visibleNodes: CanvasFlowNode[] = nodesOnBoard.map((n) => ({
    ...n,
    // React Flow already puts every card in the tab order and picks it up on Enter, but with
    // no name a card announced itself as an unnamed group — the merchant heard nothing about
    // WHICH card had focus (#604 r2 P3). Says what it is, and what it was asked for.
    ariaLabel: canvasNodeAriaLabel(n),
    data: n.type === "image"
      ? { ...withNodeActionLock(n.data), selectedCount, onEvolve: handleEvolve, onVariant: handleVariant, evolveCostHint }
      : n.type === "video"
        ? { ...withNodeActionLock(n.data), selectedCount, onRemake: handleVideoRemake, remakeCostHint }
        : withNodeActionLock(n.data),
  }));
  // B4: draw the trail. A video and the image it came from, or an image and the image it was
  // evolved from, are joined by a line instead of sitting next to each other unexplained.
  // A batch's cards are NOT joined: they share a layout anchor, not a parent (review P2-2).
  // `lineage` is passed through EXACTLY as it is: a card the board read carries an explicit null
  // when the server had no record (say nothing), while a card this browser just placed has no
  // lineage field at all (this session's own action vouches for it). Flattening the two — which
  // `?? null` did — is the difference between drawing nothing and drawing a whole false batch.
  const lineageEdges: Edge[] = buildCanvasLineageEdges(
    visibleNodes.map((n) => ({
      id: n.id,
      sourceNodeId: (n.sourceNodeId ?? (n.data as { sourceNodeId?: string | null })?.sourceNodeId) ?? null,
      lineage: (n.data as { lineage?: CanvasNodeLineage | null })?.lineage,
    })),
  ).map((edge) => ({
    ...edge,
    selectable: false,
    deletable: false,
    focusable: false,
    style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5, opacity: 0.55 },
  }));

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
        if (directToolsLocked) {
          e.dataTransfer.dropEffect = "none";
          setDragOver(false);
          return;
        }
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
      {/* Drop-to-add-image hint (drag a file from anywhere onto the canvas). */}
      {dragOver && (
        <div className="cv-dropzone" aria-hidden>
          <span>Drop image to add it to the canvas</span>
        </div>
      )}
      {showGraph && (
        <div style={{ position: "absolute", inset: 0 }}>
          <ReactFlow
            style={{ width: "100%", height: "100%", minHeight: 0 }}
            onInit={(instance) => { flowRef.current = instance; setFlowReady(true); }}
            nodes={visibleNodes}
            edges={lineageEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            nodesDraggable={!directToolsLocked}
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
          readOnlyReason={directToolsLocked ? directToolsLockedReason : undefined}
        />
      )}
      {skin === "gb" ? (
        // Every bottom-anchored control lives in ONE column (#604 r2): composer, then the
        // multi-card bar, then the tool row. Stacked rows cannot cover each other, which
        // is exactly what the old "two bars, same bottom: 20px" pair did.
        <div className="cv-bottom-stack">
          {/* Composer — hidden until Generate is clicked (Grok pattern). Reuses the
              existing handleGenerate spend path unchanged; sits on top of the stack. */}
          {composerOpen && !directToolsLocked && (
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
              {/* A2: how many images this one Generate makes. The price beside it follows the
                  choice, so the merchant sees the real total before pressing anything. */}
              <div
                role="group"
                aria-label="How many images to make"
                style={{ display: "flex", gap: 2, alignItems: "center" }}
              >
                {Array.from({ length: CANVAS_IMAGE_MAX_VARIANT_COUNT }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={imageCount === n ? "al-btn al-btn-sm al-btn-primary" : "al-btn al-btn-sm"}
                    aria-pressed={imageCount === n}
                    aria-label={n === 1 ? "Make 1 image" : `Make ${n} images`}
                    title={n === 1 ? "Make 1 image" : `Make ${n} images in one go`}
                    style={{ minWidth: 30, paddingInline: 8 }}
                    onClick={() => setImageCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-[0.75rem] text-muted-foreground" style={{ whiteSpace: "nowrap" }} title="Charged when you press Generate">{composerCostHint}</span>
              <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={!costQuote || submitting || !prompt.trim()}>Generate</button>
              <button
                className="al-btn al-btn-sm"
                type="button"
                title="Close prompt"
                aria-label="Close image prompt"
                onClick={() => closeComposer(true)}
              >
                <X size={15} strokeWidth={2.2} aria-hidden />
              </button>
            </form>
          )}
          {/* B6: what to do with several cards at once. Appears only when more than one card
              is selected, so the single-card toolbar is untouched. */}
          {selection.count > 1 && !directToolsLocked && (
            // Its own row in the stack. It used to be pinned to the same bottom edge as the
            // tool row with a higher z-index, so as soon as it grew it covered the zoom/fit/
            // hand/select tools and they stopped being clickable (#604 r2 P2①). The row still
            // wraps rather than getting clipped when the pane is narrow (#513).
            <div className="cv-batchbar" role="toolbar" aria-label="Selected cards">
              <span className="text-[0.8125rem]" style={{ whiteSpace: "nowrap" }}>{selection.count} selected</span>
              {/* D6: the whole picked set goes over to Otto together, one reference each, when
                  the merchant asks for it — never as a side effect of clicking a card (#604). */}
              <button
                type="button"
                className="al-btn al-btn-sm"
                title="Hand these to Otto as references"
                onClick={sendSelectionToOtto}
              >
                Send to Otto
              </button>
              <button
                type="button"
                className="al-btn al-btn-sm"
                disabled={selection.downloads.length === 0}
                title={selection.downloads.length === 0 ? "None of these are finished yet" : "Save these to your computer"}
                onClick={() => downloadSelection(selection.downloads)}
              >
                Download {selection.downloads.length > 0 ? selection.downloads.length : ""}
              </button>
              <button
                type="button"
                className="al-btn al-btn-sm"
                title="Take these cards off the board"
                onClick={() => setPendingBatchDeleteIds(selection.ids)}
              >
                Remove
              </button>
              <button type="button" className="al-btn al-btn-sm" title="Deselect" onClick={clearSelection}>
                Clear
              </button>
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
            <button
              type="button"
              className="cv-tb"
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => void flowRef.current?.zoomOut({ duration: 150 })}
            >
              <ZoomOut size={18} strokeWidth={1.9} aria-hidden />
            </button>
            <button
              type="button"
              className="cv-tb"
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => void flowRef.current?.zoomIn({ duration: 150 })}
            >
              <ZoomIn size={18} strokeWidth={1.9} aria-hidden />
            </button>
            <button
              type="button"
              className="cv-tb"
              title="Fit to screen"
              aria-label="Fit to screen"
              onClick={() => void flowRef.current?.fitView({ padding: 0.22, duration: 220 })}
            >
              <Maximize2 size={18} strokeWidth={1.9} aria-hidden />
            </button>
            <span className="cv-tb-div" />
            {/* B6: two tools instead of one toggle. As a toggle, both modes shared a button
                whose pressed state read the same after two clicks — the merchant could not
                tell which tool was live, and the box-select mode was effectively unreachable.
                Each tool now shows its own on/off state and needs exactly one click. */}
            <button
              type="button"
              className={panMode ? "cv-tb cv-tb-active" : "cv-tb"}
              title="Hand tool — drag the board to move around"
              aria-label="Hand tool"
              aria-pressed={panMode}
              onClick={() => setPanMode(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0" /><path d="M14 10V4a2 2 0 0 0-4 0v2" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>
            </button>
            <button
              type="button"
              className={panMode ? "cv-tb" : "cv-tb cv-tb-active"}
              title="Select tool — drag a box to pick several cards"
              aria-label="Select tool"
              aria-pressed={!panMode}
              onClick={() => setPanMode(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="m3 3 7.5 18 2.5-7.5L20.5 11 3 3z" /></svg>
            </button>
            <span className="cv-tb-div" />
            <button
              type="button"
              className="cv-tb"
              title={directToolTitle ?? "Generate an image — describe what you want"}
              aria-label="Generate image"
              aria-expanded={composerOpen && !directToolsLocked}
              disabled={directToolsLocked}
              onClick={() => setComposerOpen((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
            </button>
            <button
              type="button"
              className="cv-tb"
              title={directToolTitle ?? "Make a video from a prompt"}
              aria-label="Video"
              disabled={directToolsLocked}
              onClick={() => { closeComposer(false); setCostQuote(null); setT2vOpen(true); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8z" /></svg>
            </button>
            <button type="button" className="cv-tb" title={directToolTitle ?? "Add text"} aria-label="Add text" disabled={directToolsLocked} onClick={addTextNode}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
            </button>
          </div>
        </div>
      ) : directToolsLocked ? (
        <div
          className="al-promptbar"
          style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", width: 420, justifyContent: "center" }}
        >
          <span className="text-[0.875rem] font-medium text-muted-foreground">{directToolsLockedReason}</span>
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
          <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={!costQuote || submitting || !prompt.trim()}>Generate</button>
          {activeThreadId && (
            <button
              type="button"
              className="al-btn al-btn-sm"
              aria-pressed={filterToConvo}
              onClick={() => setFilterToConvo((v) => !v)}
            >
              {filterToConvo ? "Showing this convo" : "Filter to this convo"}
            </button>
          )}
          <button className="al-btn al-btn-sm" type="button" onClick={addTextNode}>+ Text</button>
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
              disabled={directToolsLocked}
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
              disabled={directToolsLocked}
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
              Pick how it should move, then confirm. Cost: {videoCostLabel}. No charge until you confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2.5">
            <div className="flex gap-2">
              {([["gentle", "Gentle"], ["dynamic", "Dynamic"], ["custom", "Custom"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMotion(key)}
                  aria-pressed={motion === key}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${motion === key ? "border-foreground bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {motion === "custom" && (
              <input
                type="text"
                value={customMotion}
                onChange={(e) => setCustomMotion(e.target.value)}
                placeholder="e.g. slow zoom in as she turns to camera"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
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
      <Dialog open={t2vOpen} onOpenChange={(open) => { if (!open && !videoSubmitting) { setT2vOpen(false); setT2vPrompt(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make a video from a prompt</DialogTitle>
            <DialogDescription>
              Describe the video you want — no source image needed. Cost: {videoCostLabel}. No charge until you confirm.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={t2vPrompt}
            onChange={(e) => setT2vPrompt(e.target.value)}
            placeholder="e.g. a coffee cup steaming on a wooden table, slow push-in"
            rows={3}
            className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          <DialogFooter>
            <Button variant="ghost" disabled={videoSubmitting} onClick={() => { setT2vOpen(false); setT2vPrompt(""); }}>Cancel</Button>
            <Button
              disabled={!t2vPrompt.trim() || !costQuote || videoSubmitting}
              onClick={async () => {
                const p = t2vPrompt.trim();
                if (p && await runT2v(p)) {
                  setT2vOpen(false);
                  setT2vPrompt("");
                }
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
