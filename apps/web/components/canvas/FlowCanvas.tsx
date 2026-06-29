"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type NodeChange, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode } from "./nodes/TextNode";
import { useCanvasGen } from "./useCanvasGen";
import { listCanvasNodes, moveCanvasNode, deleteCanvasNode, updateTextNode, createCanvasNode, type CanvasNodeDTO } from "../../lib/canvas-actions";
import { syncOttoCanvasNodes } from "../../lib/otto-canvas-bridge";
import { OttoCanvasStatus } from "../otto/OttoTrace";
import DetailPanel from "@/components/asset/DetailPanel";
import { MentionInput } from "@/components/MentionInput";
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
      onAnimateByNode.current[id] = () => {
        const entry = nodeDataRef.current[id];
        if (!entry?.generationId || !animateFnRef.current) return; // guard: not yet resolved
        const { x, y } = entry.pos;
        void animateFnRef.current(entry.generationId, id, "", { x: x + 340, y, w: 320, h: 320 });
      };
    }
    return onAnimateByNode.current[id]!;
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
            onDelete: () => deleteNode(n.id),
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
          data: { text: "", status: "done", onChange: (t: string) => onTextChange(result.id, t), onDelete: () => deleteNode(result.id) },
          style: { width: 240, height: 120, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
          threadId: activeThreadId ?? null,
        },
      ]);
    } else {
      console.warn("Failed to create text node:", result.error);
    }
  }, [projectId, activeThreadId, onTextChange, deleteNode]);

  // Animate the selected image node into a video — reuses the existing animate
  // path (no new spend logic). The video tool mirrors Grok's "select an image
  // node to animate"; it is disabled until an animatable image is selected.
  const selectedImageId = nodes.find((n) => n.selected && n.type === "image" && nodeDataRef.current[n.id]?.generationId)?.id ?? null;
  const animateSelected = useCallback(() => {
    if (selectedImageId) getOnAnimate(selectedImageId)();
  }, [selectedImageId, getOnAnimate]);

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
          status: r.status,
          url: r.url ?? undefined,
          prompt: r.prompt,
          text: r.text,
          onDelete: () => deleteNode(r.id),
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
  }, [skin, projectId, activeThreadId, deleteNode, onTextChange, getOnAnimate, getOnOpenDetail]);

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
    setNodes((ns) => applyNodeChanges(changes, ns) as CanvasFlowNode[]);
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
      if (c.type === "remove") void deleteCanvasNode(c.id);
    }
  }, []);

  return (
    <div style={{ flex: 1, position: "relative" }}>
      {/* OTTO working — mirrors the agent's activity onto the canvas (Grok pattern). */}
      {activeThreadId && activity?.has(activeThreadId) && (
        <OttoCanvasStatus label="working on it…" />
      )}
      <ReactFlow nodes={filterNodesByConvo(nodes, activeThreadId, filterToConvo)} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
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
              onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}
            >
              <div className="al-input-wrap" style={{ flex: 1, minWidth: 0, border: "none", background: "none", padding: 0 }}>
                <MentionInput
                  entities={entities}
                  docKey={`canvas-${composerKey}`}
                  placeholder="Describe an image… (@ to reference your stuff)"
                  onChange={(t, ids, vsel) => { setPrompt(t); setPromptIds(ids); setVariantSel(vsel); }}
                  onSubmit={handleGenerate}
                />
              </div>
              <button className="al-btn al-btn-primary al-btn-sm" type="submit" disabled={submitting}>Generate</button>
            </form>
          )}
          {/* Slim bottom toolbar — matches the approved canvas-home mockup. */}
          <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools">
            <button type="button" className="cv-tb" title="Select" aria-label="Select">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="m3 3 7.5 18 2.5-7.5L20.5 11 3 3z" /></svg>
            </button>
            <span className="cv-tb-div" />
            <button type="button" className="cv-tb cv-tb-gen" aria-expanded={composerOpen} onClick={() => setComposerOpen((v) => !v)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10z" /></svg>
              <span>Generate</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <span className="cv-tb-div" />
            <button type="button" className="cv-tb" title="Image" aria-label="Image" onClick={() => setComposerOpen(true)}>
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
    </div>
  );
}
