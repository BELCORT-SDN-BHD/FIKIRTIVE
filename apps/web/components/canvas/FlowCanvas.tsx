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
import type { EntityDTO } from "@/lib/types";
import { filterNodesByConvo, convoColor } from "@/lib/convo-canvas";
import { creditsLabel } from "@/lib/credit-format";
import type { CanvasGenCostQuote } from "@/lib/canvas-gen-costs";

type CanvasFlowNode = Node & { threadId: string | null };
type FlowCanvasProps = {
  projectId: string;
  entities?: EntityDTO[];
  activeThreadId?: string | null;
  activity?: Set<string>;
  skin?: "gb";
  onBalanceRefresh?: () => void | Promise<void>;
  onActivityRefresh?: () => void | Promise<void>;
  directToolsLocked?: boolean;
  directToolsLockedReason?: string;
};

// Must be stable (defined outside component) per ReactFlow requirements
const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };

export default function FlowCanvas({
  projectId,
  entities = [],
  activeThreadId = null,
  activity,
  skin,
  onBalanceRefresh,
  onActivityRefresh,
  directToolsLocked = false,
  directToolsLockedReason = "Start with Otto first.",
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
  // Phase 2: generating makes 4 variants (4× credits), so submit opens a cost
  // confirm first — the owner clicks Generate to authorize the spend.
  const [confirmGen, setConfirmGen] = useState(false);
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
  const [costQuote, setCostQuote] = useState<CanvasGenCostQuote | null>(null);

  // Per-node data refs so stable onAnimate closures can read current generationId + position
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  const nodeDataRef = useRef<Record<string, { generationId?: string; pos: { x: number; y: number } }>>({});
  const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | null>(null);
  const reloadRef = useRef<(() => Promise<void>) | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const fittedScopeRef = useRef<string | null>(null);
  const fitTimerRef = useRef<number | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const requestReload = useCallback(() => {
    void (async () => {
      await reloadRef.current?.();
      await onActivityRefresh?.();
    })();
  }, [onActivityRefresh]);

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
  const runAnimate = useCallback((id: string, motionPrompt: string) => {
    if (directToolsLockedRef.current) return;
    const entry = nodeDataRef.current[id];
    if (videoBusyRef.current) {
      return;
    }
    if (!entry?.generationId || !animateFnRef.current) {
      toast.error("This image is not ready for video yet.");
      return;
    }
    videoBusyRef.current = true;
    const { x, y } = entry.pos;
    // genRequest requires a non-empty prompt (.trim().min(1)); the dialog guarantees a
    // non-empty motion prompt (custom falls back to the gentle default), so the paid
    // i2v never no-ops on an empty prompt.
    void animateFnRef.current(entry.generationId, id, motionPrompt, { x: x + 340, y, w: 320, h: 320 }).finally(() => { videoBusyRef.current = false; });
  }, []);

  // Build a stable per-node onOpenDetail that reads generationId at call time
  const onOpenDetailByNode = useRef<Record<string, () => void>>({});
  const getOnOpenDetail = useCallback((id: string): (() => void) => {
    if (!onOpenDetailByNode.current[id]) {
      onOpenDetailByNode.current[id] = () => {
        const entry = nodeDataRef.current[id];
        if (!entry?.generationId) return; // guard: generationId not yet resolved
        setDetailFor(entry.generationId);
      };
    }
    return onOpenDetailByNode.current[id]!;
  }, []);

  // stable delete
  const deleteNode = useCallback((id: string) => {
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
        // wire onAnimate + onOpenDetail now that generationId is known (if not already set)
        if (generationId && n.type === "image" && !n.data.onAnimate) {
          updated.data = { ...updated.data, onAnimate: getOnAnimate(id), onOpenDetail: getOnOpenDetail(id) };
        }
        return updated;
      }),
    );
  }, [getOnAnimate, getOnOpenDetail]);

  const onNewNode = useCallback(
    (n: { id: string; type: "image" | "video"; pos: any; status: string; prompt: string }) => {
      nodeCountRef.current += 1;
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
            // onAnimate added after generationId arrives via onResolve
          },
          style: { width: n.pos.w, height: n.pos.h, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    },
    [activeThreadId, requestReload, skin, scheduleFitView],
  );

  const onGenError = useCallback((msg: string) => { toast.error(msg); }, []);
  const { generateImage, animate, generateVideoFromText, quoteCosts } = useCanvasGen(projectId, onNewNode, onResolve, activeThreadId, onGenError, onBalanceRefresh);
  const refreshCostQuote = useCallback(() => {
    void quoteCosts().then(setCostQuote).catch(() => setCostQuote(null));
  }, [quoteCosts]);
  // keep animateFnRef current
  animateFnRef.current = animate;

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
      setPrompt("");
      setPromptIds([]);
      setVariantSel({});
      setComposerKey((k) => k + 1);
      setComposerOpen(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [prompt, promptIds, variantSel, generateImage, directToolsLocked]);

  // Add an empty text node (display-only, no spend) — the canvas toolbar's text tool.
  const addTextNode = useCallback(async () => {
    if (directToolsLocked) return;
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
          data: { text: "", status: "done", skin, onChange: (t: string) => onTextChange(result.id, t), onDelete: () => setPendingDeleteId(result.id) },
          style: { width: 240, height: 120, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    } else {
      console.warn("Failed to create text node:", result.error);
    }
  }, [projectId, activeThreadId, onTextChange, skin, directToolsLocked, scheduleFitView]);

  // Drag-and-drop an image file from anywhere onto the canvas → upload it as an
  // image node. Upload-only (uploadReference creates an UPLOAD Generation); it
  // does NOT call the generation/spend path. The node is animatable afterward
  // (it has a generationId), and a real prompt is sent on Animate (see #5 fix).
  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (directToolsLockedRef.current) return;
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    for (const file of files) {
      const fd = new FormData();
      fd.append("files", file);
      const res = await uploadReference(projectId, fd);
      if (!res || "error" in res) { console.warn("[canvas drop] upload failed:", res); continue; }
      const x = 80 + nodeCountRef.current * 340;
      const created = await createCanvasNode({ projectId, type: "image", x, y: 80, w: 320, h: 320, generationId: res.id, status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
      if (!("id" in created)) { console.warn("[canvas drop] node create failed:", created); continue; }
      nodeDataRef.current[created.id] = { generationId: res.id, pos: { x, y: 80 } };
      nodeCountRef.current += 1;
      setNodes((ns) => [
        ...ns,
        {
          id: created.id,
          type: "image",
          position: { x, y: 80 },
          data: { status: "done", url: res.src, skin, onDelete: () => setPendingDeleteId(created.id), onRefresh: requestReload, onAnimate: getOnAnimate(created.id), onOpenDetail: getOnOpenDetail(created.id) },
          style: { width: 320, height: 320, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
      scheduleFitView();
    }
  }, [projectId, activeThreadId, getOnAnimate, getOnOpenDetail, requestReload, skin, scheduleFitView]);

  // Phase 3: text-to-video — the bottom video tool always opens a prompt dialog;
  // image cards own the explicit "Make video" image-to-video path.
  const [t2vOpen, setT2vOpen] = useState(false);
  const [t2vPrompt, setT2vPrompt] = useState("");
  const runT2v = useCallback((prompt: string) => {
    if (directToolsLocked || videoBusyRef.current) return;
    videoBusyRef.current = true;
    const x = 80 + nodeCountRef.current * 340;
    void generateVideoFromText(prompt, { x, y: 80, w: 320, h: 320 }).finally(() => { videoBusyRef.current = false; });
  }, [generateVideoFromText, directToolsLocked]);

  useEffect(() => {
    directToolsLockedRef.current = directToolsLocked;
    if (directToolsLocked) {
      setComposerOpen(false);
      setConfirmGen(false);
      setPendingAnimateId(null);
      setT2vOpen(false);
      setT2vPrompt("");
    }
  }, [directToolsLocked]);

  useEffect(() => {
    if (confirmGen || pendingAnimateId !== null || t2vOpen) refreshCostQuote();
  }, [confirmGen, pendingAnimateId, t2vOpen, refreshCostQuote]);

  // Load (and, under the Grok-bright skin, bridge OTTO's chat results onto) the
  // canvas. The gb path resolves each node's media URL and ensures a node exists
  // for the active thread's results (display-only, no spend). The default path is
  // the original listCanvasNodes (URLs stay client-resolved via generation polls).
  const reload = useCallback(async () => {
    const rows = skin === "gb"
      ? await syncOttoCanvasNodes(projectId, activeThreadId ?? undefined)
      : await listCanvasNodes(projectId);
    if ("error" in (rows as object)) return;
    const mapped = (rows as Array<CanvasNodeDTO & { url?: string | null }>).map((r) => {
      nodeDataRef.current[r.id] = { generationId: r.generationId ?? undefined, pos: { x: r.x, y: r.y } };
      return {
        id: r.id,
        type: r.type,
        position: { x: r.x, y: r.y },
        data: {
          // A node with a resolved media URL is finished — show the image. Canvas
          // nodes persist status "pending" and aren't updated to "done" in the DB,
          // so without this a completed generation re-renders as "generating
          // forever" on reload (founder bug: image loads forever).
          status: r.url ? "done" : r.status,
          url: r.url ?? undefined,
          prompt: r.prompt,
          text: r.text,
          skin,
          onDelete: () => setPendingDeleteId(r.id),
          onRefresh: requestReload,
          onChange: r.type === "text" ? (t: string) => onTextChange(r.id, t) : undefined,
          onAnimate: r.type === "image" ? getOnAnimate(r.id) : undefined,
          onOpenDetail: r.type === "image" ? getOnOpenDetail(r.id) : undefined,
        },
        style: { width: r.w, height: r.h, boxShadow: `0 0 0 2px ${convoColor(r.threadId ?? null)}` },
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
  }, [skin, projectId, activeThreadId, onTextChange, getOnAnimate, getOnOpenDetail, requestReload]);
  reloadRef.current = reload;

  // Initial load + reload when the active thread changes (re-bridges that thread).
  useEffect(() => { void reload(); }, [reload]);

  // ReactFlow's `fitView` prop only runs on mount, before our async canvas nodes arrive.
  // Fit once per project/thread after nodes load so left-edge node action buttons do not
  // sit underneath the Otto panel and become visible-but-unclickable.
  useEffect(() => {
    if (!flowReady || !flowRef.current || nodes.length === 0) return;
    const scope = `${projectId}:${activeThreadId ?? "all"}`;
    if (fittedScopeRef.current === scope) return;
    fittedScopeRef.current = scope;
    requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.22, duration: 160 });
    });
  }, [flowReady, nodes.length, projectId, activeThreadId]);

  // When the active thread's OTTO work finishes (pending → done), reload so its
  // freshly-produced results appear on the canvas.
  const prevPendingRef = useRef(false);
  useEffect(() => {
    const pending = !!(activeThreadId && activity?.has(activeThreadId));
    if (prevPendingRef.current && !pending) void reload();
    prevPendingRef.current = pending;
  }, [activity, activeThreadId, reload]);

  // Keep nodeDataRef positions in sync when nodes move (so onAnimate uses fresh coords)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
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
  const imageCostLabel = costQuote ? creditsLabel(costQuote.imageCredits) : "checking exact cost";
  const videoCostLabel = costQuote ? creditsLabel(costQuote.videoCredits) : "checking exact cost";
  const directToolTitle = directToolsLocked ? directToolsLockedReason : undefined;

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
            nodes={filterNodesByConvo(nodes, activeThreadId, filterToConvo)}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
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
        />
      )}
      {skin === "gb" ? (
        <>
          {/* Composer — hidden until Generate is clicked (Grok pattern). Reuses the
              existing handleGenerate spend path unchanged; positioned above the bar. */}
          {composerOpen && !directToolsLocked && (
            <form
              className="al-promptbar cv-composer-pop"
              style={{ position: "absolute", bottom: 76, left: "50%", transform: "translateX(-50%)", width: 520 }}
              onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) { setCostQuote(null); setConfirmGen(true); } }}
            >
              <div className="al-input-wrap" style={{ flex: 1, minWidth: 0, border: "none", background: "none", padding: 0 }}>
                <MentionInput
                  entities={entities}
                  docKey={`canvas-${composerKey}`}
                  placeholder="Describe an image… (@ to reference your stuff)"
                  onChange={(t, ids, vsel) => { setPrompt(t); setPromptIds(ids); setVariantSel(vsel); }}
                  onSubmit={() => { if (prompt.trim()) { setCostQuote(null); setConfirmGen(true); } }}
                />
              </div>
              <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={submitting || !prompt.trim()}>Generate</button>
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
              onClick={() => { setCostQuote(null); setT2vOpen(true); }}
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
              onClick={() => { if (pendingDeleteId) deleteNode(pendingDeleteId); setPendingDeleteId(null); }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pendingAnimateId !== null} onOpenChange={(open) => { if (!open) { setPendingAnimateId(null); setMotion("gentle"); setCustomMotion(""); } }}>
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
            <Button variant="ghost" onClick={() => setPendingAnimateId(null)}>Cancel</Button>
            <Button
              disabled={!costQuote}
              onClick={() => {
                const p =
                  motion === "dynamic"
                    ? "Animate this image with dynamic, energetic motion."
                    : motion === "custom"
                      ? customMotion.trim() || "Animate this image with gentle, natural motion."
                      : "Animate this image with gentle, natural motion.";
                if (pendingAnimateId) runAnimate(pendingAnimateId, p);
                setPendingAnimateId(null);
              }}
            >
              {costQuote ? "Make video" : "Checking cost..."}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmGen} onOpenChange={(open) => { if (!open) setConfirmGen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate 4 variations?</DialogTitle>
            <DialogDescription>
              Otto makes 4 images so you can pick the best one. Cost: {imageCostLabel}. No charge until you confirm.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmGen(false)}>Cancel</Button>
            <Button disabled={!costQuote} onClick={() => { setConfirmGen(false); void handleGenerate(); }}>
              {costQuote ? "Generate" : "Checking cost..."}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={t2vOpen} onOpenChange={(open) => { if (!open) { setT2vOpen(false); setT2vPrompt(""); } }}>
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
            <Button variant="ghost" onClick={() => { setT2vOpen(false); setT2vPrompt(""); }}>Cancel</Button>
            <Button
              disabled={!t2vPrompt.trim() || !costQuote}
              onClick={() => { const p = t2vPrompt.trim(); setT2vOpen(false); setT2vPrompt(""); if (p) runT2v(p); }}
            >
              {costQuote ? "Make video" : "Checking cost..."}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
