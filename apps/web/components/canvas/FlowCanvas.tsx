"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type NodeChange, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode } from "./nodes/TextNode";
import { useCanvasGen } from "./useCanvasGen";
import { listCanvasNodes, moveCanvasNode, deleteCanvasNode, updateTextNode } from "../../lib/canvas-actions";

// Must be stable (defined outside component) per ReactFlow requirements
const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };

export default function FlowCanvas({ projectId }: { projectId: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [prompt, setPrompt] = useState("");
  // track node count to offset new node positions
  const nodeCountRef = useRef(0);

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
        const updated: Node = { ...n, data: { ...n.data, url: url ?? undefined, status } };
        if (generationId) updated.data = { ...updated.data, generationId };
        // wire onAnimate now that generationId is known (if not already set)
        if (generationId && n.type === "image" && !n.data.onAnimate) {
          updated.data = { ...updated.data, onAnimate: getOnAnimate(id) };
        }
        return updated;
      }),
    );
  }, [getOnAnimate]);

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
          style: { width: n.pos.w, height: n.pos.h },
        },
      ]);
    },
    [deleteNode],
  );

  const { generateImage, animate } = useCanvasGen(projectId, onNewNode, onResolve);
  // keep animateFnRef current
  animateFnRef.current = animate;

  useEffect(() => {
    listCanvasNodes(projectId).then((rows) => {
      if ("error" in (rows as object)) return;
      const mapped = (rows as any[]).map((r) => {
        nodeDataRef.current[r.id] = { generationId: r.generationId ?? undefined, pos: { x: r.x, y: r.y } };
        return {
          id: r.id,
          type: r.type,
          position: { x: r.x, y: r.y },
          data: {
            status: r.status,
            // TODO(G2): resolve stored generationId -> media URL on hydrate
            url: undefined,
            prompt: r.prompt,
            text: r.text,
            onDelete: () => deleteNode(r.id),
            onChange: r.type === "text" ? (t: string) => onTextChange(r.id, t) : undefined,
            // onAnimate: only useful once URL resolves; generationId stored in ref for call-time read
            onAnimate: r.type === "image" ? getOnAnimate(r.id) : undefined,
          },
          style: { width: r.w, height: r.h },
        };
      });
      nodeCountRef.current = mapped.length;
      setNodes(mapped);
    });
  }, [projectId, deleteNode, onTextChange, getOnAnimate]);

  // Keep nodeDataRef positions in sync when nodes move (so onAnimate uses fresh coords)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
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
      <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
      <form
        className="al-promptbar"
        style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", width: 560 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) {
            const x = 80 + nodeCountRef.current * 340;
            generateImage(prompt.trim(), { x, y: 80, w: 320, h: 320 });
            setPrompt("");
          }
        }}
      >
        <input className="al-input-wrap" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Type to imagine…" />
        <button className="al-btn al-btn-primary al-btn-sm" type="submit">Generate</button>
      </form>
    </div>
  );
}
