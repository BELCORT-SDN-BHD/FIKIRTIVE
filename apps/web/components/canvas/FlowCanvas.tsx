"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node, type NodeChange, applyNodeChanges, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode } from "./nodes/TextNode";
import { useCanvasGen, isInFlightPaidGen } from "./useCanvasGen";
import { toast } from "sonner";
import { listCanvasNodes, moveCanvasNode, deleteCanvasNode, updateTextNode, createCanvasNode, type CanvasNodeDTO } from "../../lib/canvas-actions";
import { uploadReference } from "../../lib/actions";
import { syncOttoCanvasNodes } from "../../lib/otto-canvas-bridge";
import { OttoCanvasStatus } from "../otto/OttoTrace";
import DetailPanel from "@/components/asset/DetailPanel";
import { MentionInput } from "@/components/MentionInput";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { EntityDTO } from "@/lib/types";
import { filterNodesByConvo, convoColor } from "@/lib/convo-canvas";
import { creditsLabel } from "@/lib/credit-format";
import type { CanvasGenCostQuote } from "@/lib/canvas-gen-costs";
import { DEFAULT_CANVAS_NODE_LOCK_REASON } from "@/lib/canvas-node-lock";
import { canvasComposerReferenceForNode, type OttoComposerReference } from "@/lib/canvas-chat-reference";
import {
  canvasMediaNodeSize,
  DEFAULT_CANVAS_MEDIA_NODE_SIDE,
  hasCanvasNodeSizeChanged,
  type CanvasMediaDimensions,
} from "@/lib/canvas-node-size";

type CanvasFlowNode = Node & { threadId: string | null };
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
  const [composerOpen, setComposerOpen] = useState(false);
  // Canvas tool: pan (grab hand, drag pans the board) vs select (arrow cursor,
  // drag box-selects). The toolbar's cursor button toggles this. Display-only.
  const [panMode, setPanMode] = useState(true);
  // Deleting a canvas card asks for confirmation first (they were too easy to
  // remove by accident). Holds the node id awaiting confirm; null = no dialog.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Making a video costs credits — clicking "Make video" opens a confirm first.
  // Holds the source image node id awaiting confirm; null = no dialog.
  const [pendingAnimateId, setPendingAnimateId] = useState<string | null>(null);
  // Motion choice for the "Make a video?" dialog (Phase 1a). Custom falls back to
  // the gentle default so the paid prompt is never empty.
  const [motion, setMotion] = useState<"gentle" | "dynamic" | "custom">("gentle");
  const [customMotion, setCustomMotion] = useState("");
  // Dragging an image file over the canvas (drop = upload it as an image node).
  const [dragOver, setDragOver] = useState(false);
  // track node count to offset new node positions
  const nodeCountRef = useRef(0);
  // bumped on successful generation submit to remount MentionInput cleared
  const [composerKey, setComposerKey] = useState(0);
  // double-submit guard
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [costQuote, setCostQuote] = useState<CanvasGenCostQuote | null>(null);

  // Per-node data refs so stable onAnimate closures can read current generationId + position
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  const nodeDataRef = useRef<Record<string, { generationId?: string; pos: { x: number; y: number } }>>({});
  const referenceHandlerRef = useRef<typeof onReferenceInChat>(onReferenceInChat);
  const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | null>(null);
  const reloadRef = useRef<(() => Promise<void>) | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const fittedScopeRef = useRef<string | null>(null);
  const fitTimerRef = useRef<number | null>(null);
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
  // idempotencyKey is per-click (vid-<Date.now()>), so two fast clicks would mint
  // two keys → two charges; the confirm dialog closing isn't a guaranteed guard.
  // True only during the ~1-2s startGen setup (poll isn't awaited), so it blocks a
  // same-tick double-fire without serializing separate generations.
  const videoBusyRef = useRef(false);
  const runAnimate = useCallback(async (id: string, motionPrompt: string): Promise<boolean> => {
    if (directToolsLockedRef.current) return false;
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
    const { x, y } = entry.pos;
    // genRequest requires a non-empty prompt (.trim().min(1)); the dialog guarantees a
    // non-empty motion prompt (custom falls back to the gentle default), so the paid
    // i2v never no-ops on an empty prompt.
    try {
      return await animateFnRef.current(entry.generationId, id, motionPrompt, { x: x + 340, y, w: 320, h: 320 });
    } finally {
      videoBusyRef.current = false;
      setVideoSubmitting(false);
    }
  }, []);

  // Attached "Type to imagine" bar on a selected image card. Image→image editing
  // (conditioning a new image on THIS generation) isn't in the spend path yet, so the
  // typed prompt seeds the existing image→video (i2v) confirm — a real, source-bound
  // evolution that keeps the video cost gate and lineage (sourceNodeId, set by animate()).
  // One stable handler (the node passes its own id) — no per-id ref, so it's safe to read
  // during render in the visibleNodes map.
  const handleEvolve = useCallback((id: string, prompt: string) => {
    if (directToolsLockedRef.current) return;
    const text = prompt.trim();
    if (!text) return;
    setCostQuote(null);
    setCustomMotion(text);
    setMotion("custom");
    setPendingAnimateId(id);
  }, []);

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

  const onReferenceInChatByNode = useRef<Record<string, () => void>>({});
  const getOnReferenceInChat = useCallback((id: string): (() => void) => {
    if (!onReferenceInChatByNode.current[id]) {
      onReferenceInChatByNode.current[id] = () => {
        if (directToolsLockedRef.current || !referenceHandlerRef.current) {
          toast.error("Open an Otto chat first.");
          return;
        }
        const refForNode = (node: CanvasFlowNode | undefined) => {
          const data = node?.data as { generationId?: unknown; url?: unknown } | undefined;
          return canvasComposerReferenceForNode({
            type: typeof node?.type === "string" ? node.type : null,
            generationId: typeof data?.generationId === "string" ? data.generationId : node?.id ? nodeDataRef.current[node.id]?.generationId ?? null : null,
            src: typeof data?.url === "string" ? data.url : null,
          });
        };
        const node = nodesRef.current.find((n) => n.id === id);
        const ref = refForNode(node);
        if (!ref) {
          toast.error("This asset is not ready for Otto yet.");
          return;
        }
        const selectedRefs = nodesRef.current
          .filter((n) => n.selected && (n.type === "image" || n.type === "video"))
          .map((n) => refForNode(n))
          .filter((item): item is Omit<OttoComposerReference, "requestId"> => !!item);
        const refs = selectedRefs.length > 1 && selectedRefs.some((item) => item.generationId === ref.generationId)
          ? selectedRefs
          : [ref];
        referenceHandlerRef.current(refs);
        toast.success(refs.length === 1 ? `${ref.label} added to Otto chat.` : `${refs.length} references added to Otto chat.`);
      };
    }
    return onReferenceInChatByNode.current[id]!;
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
    setNodes((ns) => ns.filter((n) => n.id !== id));
    void deleteCanvasNode(id);
  }, []);

  // stable text-change
  const onTextChange = useCallback((id: string, text: string) => {
    void updateTextNode(id, text);
  }, []);

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
            ...(!updated.data.onReferenceInChat ? { onReferenceInChat: getOnReferenceInChat(id) } : {}),
            ...(n.type === "image" && !updated.data.onAnimate ? { onAnimate: getOnAnimate(id) } : {}),
            ...(!updated.data.onMediaSize ? { onMediaSize: getOnMediaSize(id) } : {}),
          };
        }
        return updated;
      }),
    );
  }, [getOnAnimate, getOnMediaSize, getOnOpenDetail, getOnReferenceInChat]);

  const onNewNode = useCallback(
    (n: { id: string; type: "image" | "video"; pos: { x: number; y: number; w: number; h: number }; status: string; prompt: string }) => {
      nodeCountRef.current += 1;
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
              onDelete: () => setPendingDeleteId(n.id),
              onRefresh: requestReload,
              onMediaSize: getOnMediaSize(n.id),
              onReferenceInChat: getOnReferenceInChat(n.id),
              // onAnimate added after generationId arrives via onResolve
            }),
          },
          style: { width: n.pos.w, height: n.pos.h, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    },
    [activeThreadId, getOnMediaSize, getOnReferenceInChat, requestReload, skin, scheduleFitView, withNodeActionLock],
  );

  const onGenError = useCallback((msg: string) => { toast.error(msg); }, []);
  const { generateImage, animate, generateVideoFromText, quoteCosts } = useCanvasGen(projectId, onNewNode, onResolve, activeThreadId, onGenError, onBalanceRefresh);
  const refreshCostQuote = useCallback(() => {
    void quoteCosts().then(setCostQuote).catch(() => setCostQuote(null));
  }, [quoteCosts]);
  // keep animateFnRef current (in an effect — refs must not be written during render)
  useEffect(() => { animateFnRef.current = animate; }, [animate]);

  // Shared submit handler — used by form onSubmit and MentionInput onSubmit
  const handleGenerate = useCallback(async () => {
    if (directToolsLocked) return;
    if (!prompt.trim()) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const x = 80 + nodeCountRef.current * 340;
      await generateImage(prompt.trim(), { x, y: 80, w: 320, h: 320 }, promptIds, variantSel);
      closeComposer(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [prompt, promptIds, variantSel, generateImage, directToolsLocked, closeComposer]);

  // Add an empty text node (display-only, no spend) — the canvas toolbar's text tool.
  const addTextNode = useCallback(async () => {
    if (directToolsLocked) return;
    closeComposer(false);
    const x = 80 + nodeCountRef.current * 340;
    const result = await createCanvasNode({ projectId, type: "text", x, y: 80, w: 240, h: 120, text: "", status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
    if ("id" in result) {
      nodeCountRef.current += 1;
      setNodes((ns) => [
        ...ns,
        {
          id: result.id,
          type: "text",
          position: { x, y: 80 },
          data: withNodeActionLock({ text: "", status: "done", skin, onChange: (t: string) => onTextChange(result.id, t), onDelete: () => setPendingDeleteId(result.id) }),
          style: { width: 240, height: 120, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    } else {
      console.warn("Failed to create text node:", result.error);
    }
  }, [projectId, activeThreadId, onTextChange, skin, directToolsLocked, scheduleFitView, closeComposer, withNodeActionLock]);

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
      const x = 80 + nodeCountRef.current * 340;
      const created = await createCanvasNode({ projectId, type: "image", x, y: 80, w: 320, h: 320, generationId: res.id, status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
      if (!("id" in created)) {
        toast.error(created.error || "Upload succeeded, but the canvas card did not appear.");
        console.warn("[canvas drop] node create failed:", created);
        continue;
      }
      nodeDataRef.current[created.id] = { generationId: res.id, pos: { x, y: 80 } };
      nodeCountRef.current += 1;
      setNodes((ns) => [
        ...ns,
        {
          id: created.id,
          type: "image",
          position: { x, y: 80 },
          data: withNodeActionLock({ status: "done", url: res.src, generationId: res.id, skin, onDelete: () => setPendingDeleteId(created.id), onRefresh: requestReload, onAnimate: getOnAnimate(created.id), onOpenDetail: getOnOpenDetail(created.id), onReferenceInChat: getOnReferenceInChat(created.id), onMediaSize: getOnMediaSize(created.id) }),
          style: { width: 320, height: 320, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    }
  }, [projectId, activeThreadId, getOnAnimate, getOnMediaSize, getOnOpenDetail, getOnReferenceInChat, requestReload, skin, scheduleFitView, withNodeActionLock]);

  // Phase 3: text-to-video — the bottom video tool always opens a prompt dialog;
  // image cards own the explicit "Make video" image-to-video path.
  const [t2vOpen, setT2vOpen] = useState(false);
  const [t2vPrompt, setT2vPrompt] = useState("");
  const runT2v = useCallback(async (prompt: string): Promise<boolean> => {
    if (directToolsLocked || videoBusyRef.current) return false;
    videoBusyRef.current = true;
    setVideoSubmitting(true);
    const x = 80 + nodeCountRef.current * 340;
    try {
      return await generateVideoFromText(prompt, { x, y: 80, w: 320, h: 320 });
    } finally {
      videoBusyRef.current = false;
      setVideoSubmitting(false);
    }
  }, [generateVideoFromText, directToolsLocked]);

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
      setPendingAnimateId(null);
      setT2vOpen(false);
      setT2vPrompt("");
    }
  }

  // Cost transparency (宪法 3): images generate with no confirm dialog, so the quote
  // must be loaded while the composer is visible — its cost label sits next to the
  // Generate button. Video/t2v quotes still load when their confirm dialogs open.
  const composerVisible = skin === "gb" ? composerOpen : !directToolsLocked;
  useEffect(() => {
    if (composerVisible || pendingAnimateId !== null || t2vOpen) refreshCostQuote();
  }, [composerVisible, pendingAnimateId, t2vOpen, refreshCostQuote]);

  // Load (and, under the Grok-bright skin, bridge OTTO's chat results onto) the
  // canvas. The gb path resolves each node's media URL and ensures a node exists
  // for the active thread's results (display-only, no spend). The default path is
  // the original listCanvasNodes (URLs stay client-resolved via generation polls).
  const reload = useCallback(async () => {
    const rows = skin === "gb"
      ? await syncOttoCanvasNodes(projectId)
      : await listCanvasNodes(projectId);
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
          onDelete: () => setPendingDeleteId(r.id),
          onRefresh: requestReload,
          onChange: r.type === "text" ? (t: string) => onTextChange(r.id, t) : undefined,
          onAnimate: r.type === "image" ? getOnAnimate(r.id) : undefined,
          onOpenDetail: r.type === "image" || r.type === "video" ? getOnOpenDetail(r.id) : undefined,
          onReferenceInChat: r.type === "image" || r.type === "video" ? getOnReferenceInChat(r.id) : undefined,
          onMediaSize: r.type === "image" || r.type === "video" ? getOnMediaSize(r.id) : undefined,
        }),
        style: { width: nodeSize.w, height: nodeSize.h, boxShadow: `0 0 0 2px ${convoColor(r.threadId ?? null)}` },
        threadId: r.threadId ?? null,
      } as CanvasFlowNode;
    });
    // Merge, not replace: keep any node that's still generating locally (server may
    // not have its URL yet) so a reload never clobbers an in-flight promptbar gen.
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const merged = mapped.map((m) => {
        const old = prevById.get(m.id);
        return old && old.data.status === "pending" && m.data.status === "pending" && !m.data.url ? old : m;
      });
      const mergedIds = new Set(merged.map((n) => n.id));
      const extras = prev.filter((n) => !mergedIds.has(n.id));
      const all = [...merged, ...extras];
      nodeCountRef.current = all.length;
      return all;
    });
  }, [skin, projectId, onTextChange, getOnAnimate, getOnMediaSize, getOnOpenDetail, getOnReferenceInChat, requestReload, withNodeActionLock]);
  // keep reloadRef current (in an effect — refs must not be written during render);
  // declared before the consumers below, so it runs first within any commit.
  useEffect(() => { reloadRef.current = reload; }, [reload]);

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
    for (const move of persistMoves) void moveCanvasNode(move.id, { x: move.x, y: move.y, w: move.w, h: move.h });
    for (const id of deletes) void deleteCanvasNode(id);
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
  const showGraph = canvasReady && (!directToolsLocked || nodes.length > 0 || dragOver);
  const videoCostLabel = costQuote ? creditsLabel(costQuote.videoCredits) : "checking exact cost";
  // Image generation has no confirm dialog (founder 2026-07-06, constitutional exception ①
  // "balance is the gate"), so the cost must be visible AT the input before submit (宪法 3).
  const imageCostHint = costQuote ? `Cost: ${creditsLabel(costQuote.imageCredits)}` : "Checking cost…";
  const directToolTitle = directToolsLocked ? directToolsLockedReason : undefined;
  const visibleNodes: CanvasFlowNode[] = filterNodesByConvo(nodes, activeThreadId, filterToConvo).map((n) => ({
    ...n,
    data: n.type === "image"
      ? { ...withNodeActionLock(n.data), onEvolve: handleEvolve }
      : withNodeActionLock(n.data),
  }));

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
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            nodesDraggable={!directToolsLocked}
            panOnDrag={panMode}
            selectionOnDrag={!panMode}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            fitView
            fitViewOptions={{ padding: 0.22 }}
          >
            <Background />
            <Controls />
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
        <>
          {/* Composer — hidden until Generate is clicked (Grok pattern). Reuses the
              existing handleGenerate spend path unchanged; positioned above the bar. */}
          {composerOpen && !directToolsLocked && (
            <form
              ref={composerFormRef}
              className="al-promptbar cv-composer-pop"
              style={{ position: "absolute", bottom: 76, left: "50%", transform: "translateX(-50%)", width: 520 }}
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
              <span className="text-[0.75rem] text-muted-foreground" style={{ whiteSpace: "nowrap" }} title="Charged when you press Generate">{imageCostHint}</span>
              <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={submitting || !prompt.trim()}>Generate</button>
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
          {/* Slim bottom toolbar — matches the approved canvas-home mockup. */}
          <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools">
            <button
              type="button"
              className={panMode ? "cv-tb" : "cv-tb cv-tb-active"}
              title={panMode ? "Hand tool — drag to pan. Click to switch to select." : "Select tool — drag to box-select. Click to switch to hand."}
              aria-label={panMode ? "Hand tool active" : "Select tool active"}
              aria-pressed={!panMode}
              onClick={() => setPanMode((v) => !v)}
            >
              {panMode ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0" /><path d="M14 10V4a2 2 0 0 0-4 0v2" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="m3 3 7.5 18 2.5-7.5L20.5 11 3 3z" /></svg>
              )}
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
        </>
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
          <span className="text-[0.75rem] text-muted-foreground" style={{ whiteSpace: "nowrap" }} title="Charged when you press Generate">{imageCostHint}</span>
          <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={submitting || !prompt.trim()}>Generate</button>
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
