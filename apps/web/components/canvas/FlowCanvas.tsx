"use client";
import { useCallback, useEffect, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type NodeChange, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode } from "./nodes/TextNode";
import { useCanvasGen } from "./useCanvasGen";
import { listCanvasNodes, moveCanvasNode, deleteCanvasNode } from "../../lib/canvas-actions";

const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };

export default function FlowCanvas({ projectId }: { projectId: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    listCanvasNodes(projectId).then((rows) => {
      if ("error" in (rows as object)) return;
      setNodes((rows as any[]).map((r) => ({
        id: r.id, type: r.type, position: { x: r.x, y: r.y },
        data: {
          status: r.status,
          // TODO(G2): resolve stored generationId -> media URL on hydrate
          url: undefined,
          prompt: r.prompt,
          text: r.text,
        },
        style: { width: r.w, height: r.h },
      })));
    });
  }, [projectId]);

  const onResolve = useCallback((id: string, url: string | null, status: string) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, url: url ?? undefined, status } } : n)));
  }, []);

  const onNewNode = useCallback((n: { id: string; type: "image" | "video"; pos: any; status: string; prompt: string }) => {
    setNodes((ns) => [...ns, { id: n.id, type: n.type, position: { x: n.pos.x, y: n.pos.y }, data: { status: n.status, prompt: n.prompt }, style: { width: n.pos.w, height: n.pos.h } }]);
  }, []);

  const { generateImage, animate } = useCanvasGen(projectId, onNewNode, onResolve);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) {
      if (c.type === "position" && c.dragging === false) {
        const n = nodes.find((x) => x.id === c.id);
        if (n) void moveCanvasNode(n.id, { x: n.position.x, y: n.position.y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
      }
      if (c.type === "remove") void deleteCanvasNode(c.id);
    }
  }, [nodes]);

  return (
    <div style={{ flex: 1, position: "relative" }}>
      <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
      <form
        className="al-promptbar"
        style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", width: 560 }}
        onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) { generateImage(prompt.trim(), { x: 80, y: 80, w: 320, h: 320 }); setPrompt(""); } }}
      >
        <input className="al-input-wrap" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Type to imagine…" />
        <button className="al-btn al-btn-primary al-btn-sm" type="submit">Generate</button>
      </form>
    </div>
  );
}
