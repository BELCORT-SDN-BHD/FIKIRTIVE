"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type NodeChange, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode } from "./nodes/TextNode";
import { useCanvasGen } from "./useCanvasGen";
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

type CanvasFlowNode = Node & { threadId: string | null };

// Must be stable (defined outside component) per ReactFlow requirements
const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };

export default function FlowCanvas({ projectId, entities = [], activeThreadId = null, activity, skin }: { projectId: string; entities?: EntityDTO[]; activeThreadId?: string | null; activity?: Set<string>; skin?: "gb" }) {
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

  // Per-node data refs so stable onAnimate closures can read current generationId + position
  const nodeDataRef = useRef<Record<string, { generationId?: string; pos: { x: number; y: number } }>>({});

  // Keep a ref to animate() so per-node closures don't go stale
  const animateFnRef = useRef<ReturnType<typeof useCanvasGen>["animate"] | null>(null);

  // Build a stable per-node onAnimate that reads generationId at call time
  const onAnimateByNode = useRef<Record<string, () => void>>({});
  const getOnAnimate = useCallback((id: string): (() => void) => {
    if (!onAnimateByNode.current[id]) {
      // "Make video" is a paid image→video generation, so clicking it only OPENS
      // a confirm; the actual spend happens in runAnimate() after the owner says OK.
      onAnimateByNode.current[id] = () => setPendingAnimateId(id);
    }
    return onAnimateByNode.current[id]!;
  }, []);

  // The actual paid image→video generation — invoked only after the owner confirms
  // in the "Make a video?" dialog. Spend path is unchanged: same generationId, same
  // default motion prompt, same animate() call as before — just gated behind the OK.
  const runAnimate = useCallback((id: string, motionPrompt: string) => {
    const entry = nodeDataRef.current[id];
    if (!entry?.generationId || !animateFnRef.current) return; // guard: not yet resolved
    const { x, y } = entry.pos;
    // genRequest requires a non-empty prompt (.trim().min(1)); the dialog guarantees a
    // non-empty motion prompt (custom falls back to the gentle default), so the paid
    // i2v never no-ops on an empty prompt.
    void animateFnRef.current(entry.generationId, id, motionPrompt, { x: x + 340, y, w: 320, h: 320 });
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
            // onAnimate added after generationId arrives via onResolve
          },
          style: { width: n.pos.w, height: n.pos.h, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
    },
    [deleteNode],
  );

  const { generateImage, animate, cancelledRef } = useCanvasGen(projectId, onNewNode, onResolve, activeThreadId);
  // keep animateFnRef current
  animateFnRef.current = animate;

  // Shared submit handler — used by form onSubmit and MentionInput onSubmit
  const handleGenerate = useCallback(async () => {
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
  }, [prompt, promptIds, variantSel, generateImage]);

  // Add an empty text node (display-only, no spend) — the canvas toolbar's text tool.
  const addTextNode = useCallback(async () => {
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
    } else {
      console.warn("Failed to create text node:", result.error);
    }
  }, [projectId, activeThreadId, onTextChange, skin]);

  // Drag-and-drop an image file from anywhere onto the canvas → upload it as an
  // image node. Upload-only (uploadReference creates an UPLOAD Generation); it
  // does NOT call the generation/spend path. The node is animatable afterward
  // (it has a generationId), and a real prompt is sent on Animate (see #5 fix).
  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
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
          data: { status: "done", url: res.src, skin, onDelete: () => setPendingDeleteId(created.id), onAnimate: getOnAnimate(created.id), onOpenDetail: getOnOpenDetail(created.id) },
          style: { width: 320, height: 320, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
    }
  }, [projectId, activeThreadId, getOnAnimate, getOnOpenDetail, skin]);

  // Animate the selected image node into a video — reuses the existing animate
  // path (no new spend logic). The video tool mirrors Grok's "select an image
  // node to animate"; it is disabled until an animatable image is selected.
  const selectedImageId = nodes.find((n) => n.selected && n.type === "image" && nodeDataRef.current[n.id]?.generationId)?.id ?? null;
  const animateSelected = useCallback(() => {
    if (selectedImageId) setPendingAnimateId(selectedImageId);
  }, [selectedImageId]);

  // Stop polls on unmount
  useEffect(() => () => { cancelledRef.current = true; }, [cancelledRef]);

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
        return old && old.data.status === "pending" && !m.data.url ? old : m;
      });
      const mergedIds = new Set(merged.map((n) => n.id));
      const extras = prev.filter((n) => !mergedIds.has(n.id));
      const all = [...merged, ...extras];
      nodeCountRef.current = all.length;
      return all;
    });
  }, [skin, projectId, activeThreadId, onTextChange, getOnAnimate, getOnOpenDetail]);

  // Initial load + reload when the active thread changes (re-bridges that thread).
  useEffect(() => { void reload(); }, [reload]);

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
    setNodes((ns) => {
      let next = applyNodeChanges(changes, ns) as CanvasFlowNode[];
      // Bridge NodeResizer dimension changes into our style-based sizing so the
      // card visually grows/shrinks on the board (display-only — no regeneration).
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) {
          const { width, height } = c.dimensions;
          next = next.map((n) => (n.id === c.id ? { ...n, style: { ...n.style, width, height } } : n));
        }
      }
      return next;
    });
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        // Update position in ref immediately (for onAnimate offset calc)
        const entry = nodeDataRef.current[c.id];
        if (entry) entry.pos = { x: c.position.x, y: c.position.y };

        if (c.dragging === false) {
          // Read position from CHANGE object (not stale nodes closure)
          const { x, y } = c.position;
          setNodes((ns) => {
            const n = ns.find((x2) => x2.id === c.id);
            if (n) void moveCanvasNode(n.id, { x, y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
            return ns; // side-effect only, no state update
          });
        }
      }
      // Persist the new size when a resize gesture ends (display-only; reuses the
      // same moveCanvasNode path as a drag — no spend, just x/y/w/h).
      if (c.type === "dimensions" && c.resizing === false) {
        setNodes((ns) => {
          const n = ns.find((x2) => x2.id === c.id);
          if (n) {
            const entry = nodeDataRef.current[n.id];
            if (entry) entry.pos = { x: n.position.x, y: n.position.y };
            void moveCanvasNode(n.id, { x: n.position.x, y: n.position.y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
          }
          return ns; // side-effect only
        });
      }
      if (c.type === "remove") void deleteCanvasNode(c.id);
    }
  }, []);

  return (
    <div
      style={{ flex: 1, position: "relative" }}
      className={skin === "gb" ? (panMode ? "gb" : "gb cv-select-mode") : undefined}
      onDragOver={(e) => { if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); } }}
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
      <ReactFlow
        nodes={filterNodesByConvo(nodes, activeThreadId, filterToConvo)}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        panOnDrag={panMode}
        selectionOnDrag={!panMode}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
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
          {composerOpen && (
            <form
              className="al-promptbar cv-composer-pop"
              style={{ position: "absolute", bottom: 76, left: "50%", transform: "translateX(-50%)", width: 520 }}
              onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) setConfirmGen(true); }}
            >
              <div className="al-input-wrap" style={{ flex: 1, minWidth: 0, border: "none", background: "none", padding: 0 }}>
                <MentionInput
                  entities={entities}
                  docKey={`canvas-${composerKey}`}
                  placeholder="Describe an image… (@ to reference your stuff)"
                  onChange={(t, ids, vsel) => { setPrompt(t); setPromptIds(ids); setVariantSel(vsel); }}
                  onSubmit={() => { if (prompt.trim()) setConfirmGen(true); }}
                />
              </div>
              <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={submitting}>Generate</button>
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
            <button type="button" className="cv-tb" title="Generate an image — describe what you want" aria-label="Generate image" aria-expanded={composerOpen} onClick={() => setComposerOpen((v) => !v)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
            </button>
            <button type="button" className="cv-tb" title={selectedImageId ? "Animate selected image" : "Select an image, then Video to animate it"} aria-label="Video" disabled={!selectedImageId} onClick={animateSelected}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8z" /></svg>
            </button>
            <button type="button" className="cv-tb" title="Add text" aria-label="Add text" onClick={addTextNode}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
            </button>
          </div>
        </>
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
          <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={submitting}>Generate</button>
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
            <DialogTitle>Remove from canvas?</DialogTitle>
            <DialogDescription>
              This takes the card off your board. Any generated image or video stays saved in your library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
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
              Pick how it should move, then confirm. This uses credits.
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
              Make video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmGen} onOpenChange={(open) => { if (!open) setConfirmGen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate 4 variations?</DialogTitle>
            <DialogDescription>
              Otto makes 4 images so you can pick the best one — this uses credits for 4 images. Keep the one you like and delete the rest.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmGen(false)}>Cancel</Button>
            <Button onClick={() => { setConfirmGen(false); void handleGenerate(); }}>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
