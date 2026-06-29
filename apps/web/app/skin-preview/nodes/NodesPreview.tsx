"use client";
import { ReactFlow, Background, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../otto/otto-theme.css";
import { ImageNode } from "@/components/canvas/nodes/ImageNode";
import { VideoNode } from "@/components/canvas/nodes/VideoNode";
import { TextNode } from "@/components/canvas/nodes/TextNode";

const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };
const noop = () => {};

// Mock nodes covering every type + the generating/rendering states, spread out
// with top room so the floating type pills (top:-26px) aren't clipped.
const nodes: Node[] = [
  {
    id: "img-done",
    type: "image",
    position: { x: 60, y: 80 },
    data: { status: "done", url: "https://picsum.photos/seed/cvi1/360/240", prompt: "sunglasses", skin: "gb", onAnimate: noop, onDelete: noop, onOpenDetail: noop },
    style: { width: 300, height: 210 },
  },
  {
    id: "img-gen",
    type: "image",
    position: { x: 420, y: 80 },
    data: { status: "pending", skin: "gb", onAnimate: noop, onDelete: noop },
    style: { width: 220, height: 160 },
  },
  {
    id: "vid-done",
    type: "video",
    position: { x: 60, y: 360 },
    data: { status: "done", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", skin: "gb", onDelete: noop },
    style: { width: 300, height: 200 },
  },
  {
    id: "vid-gen",
    type: "video",
    position: { x: 420, y: 360 },
    data: { status: "pending", skin: "gb", onDelete: noop },
    style: { width: 240, height: 160 },
  },
  {
    id: "txt",
    type: "text",
    position: { x: 740, y: 360 },
    data: { text: "Cozy autumn vibes, warm light", skin: "gb", onChange: noop, onDelete: noop },
    style: { width: 220, height: 120 },
    selected: true,
  },
];

export function NodesPreview() {
  return (
    <div className="fk gb-skin" style={{ height: "100dvh", width: "100%", background: "var(--bg-page)" }}>
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.25 }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
