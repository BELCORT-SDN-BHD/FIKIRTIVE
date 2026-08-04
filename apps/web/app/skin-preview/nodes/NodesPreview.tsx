"use client";
import { ReactFlow, Background, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode } from "@/components/canvas/nodes/ImageNode";
import { VideoNode } from "@/components/canvas/nodes/VideoNode";
import { TextNode } from "@/components/canvas/nodes/TextNode";

const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };
const noop = () => {};

// The SIX card faces the state algebra allows, on the real ImageNode/VideoNode (#602 T3 ·
// spec #599 D4): queued, generating, done, failed, cancelled, unknown. `pending` used to appear
// here, and it is not a face at all — it is the word the DATABASE stores; the board splits it into
// queued or generating from the job's own status. A harness showing a word no board can produce is
// how a preview stops being evidence. Laid out with top room so the floating type pills
// (top:-26px) aren't clipped.
const nodes: Node[] = [
  {
    id: "img-queued",
    type: "image",
    position: { x: 60, y: 80 },
    data: { status: "queued", prompt: "sunglasses", skin: "gb", onAnimate: noop, onDelete: noop },
    style: { width: 240, height: 180 },
  },
  {
    id: "img-generating",
    type: "image",
    position: { x: 360, y: 80 },
    data: { status: "generating", prompt: "sunglasses", skin: "gb", onAnimate: noop, onDelete: noop },
    style: { width: 240, height: 180 },
  },
  {
    id: "img-done",
    type: "image",
    position: { x: 660, y: 80 },
    data: { status: "done", url: "https://picsum.photos/seed/cvi1/360/240", prompt: "sunglasses", skin: "gb", onAnimate: noop, onDelete: noop, onOpenDetail: noop },
    style: { width: 300, height: 210 },
  },
  {
    id: "img-failed",
    type: "image",
    position: { x: 60, y: 360 },
    data: { status: "failed", prompt: "sunglasses", skin: "gb", onDelete: noop, onRefresh: noop },
    style: { width: 240, height: 180 },
  },
  {
    id: "img-cancelled",
    type: "image",
    position: { x: 360, y: 360 },
    // onRefresh is supplied on purpose: a cancelled card must still offer nothing to press.
    data: { status: "cancelled", prompt: "sunglasses", skin: "gb", onDelete: noop, onRefresh: noop },
    style: { width: 240, height: 180 },
  },
  {
    id: "img-unknown",
    type: "image",
    position: { x: 660, y: 360 },
    data: { status: "unknown", prompt: "sunglasses", skin: "gb", onDelete: noop, onRefresh: noop },
    style: { width: 240, height: 180 },
  },
  {
    id: "vid-done",
    type: "video",
    position: { x: 60, y: 620 },
    data: { status: "done", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", skin: "gb", onDelete: noop },
    style: { width: 300, height: 200 },
  },
  {
    id: "vid-generating",
    type: "video",
    position: { x: 420, y: 620 },
    data: { status: "generating", skin: "gb", onDelete: noop },
    style: { width: 240, height: 160 },
  },
  {
    id: "vid-cancelled",
    type: "video",
    position: { x: 720, y: 620 },
    data: { status: "cancelled", skin: "gb", onDelete: noop, onRefresh: noop },
    style: { width: 240, height: 160 },
  },
  {
    id: "txt",
    type: "text",
    position: { x: 1020, y: 620 },
    data: { text: "Cozy autumn vibes, warm light", skin: "gb", onChange: noop, onDelete: noop },
    style: { width: 220, height: 120 },
    selected: true,
  },
];

export function NodesPreview() {
  return (
    <div className="fk gb-skin gb" style={{ height: "100dvh", width: "100%", background: "var(--bg-page)" }}>
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
