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
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [prompt, promptIds, variantSel, generateImage]);

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
        <button
          className="al-btn al-btn-sm"
          type="button"
          onClick={async () => {
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
                  data: {
                    text: "",
                    status: "done",
                    onChange: (t: string) => onTextChange(result.id, t),
                    onDelete: () => deleteNode(result.id),
                  },
                  style: { width: 240, height: 120, boxShadow: `0 0 0 2px ${convoColor(activeThreadId ?? null)}` },
                  threadId: activeThreadId ?? null,
                },
              ]);
            } else {
              console.warn("Failed to create text node:", result.error);
            }
          }}
        >
          + Text
        </button>
      </form>
    </div>
  );
}
