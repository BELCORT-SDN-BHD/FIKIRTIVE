"use client";
import { ReactFlow, Background, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BatchFrameNode } from "@/components/canvas/FlowCanvas";
import { ImageNode } from "@/components/canvas/nodes/ImageNode";
import { VideoNode } from "@/components/canvas/nodes/VideoNode";
import { TextNode } from "@/components/canvas/nodes/TextNode";
import { canvasBatchFrameLabel, canvasBatchGroups } from "@/lib/canvas-batch-identity";
import { buildCanvasLineageEdges } from "@/lib/canvas-lineage";

const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode, batchFrame: BatchFrameNode };
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

/**
 * BATCH IDENTITY, drawn from the persisted facts (#603 T4 · spec #599 D5).
 *
 * Two relationships the board must never confuse, side by side in one screenshot:
 *   - a press of FOUR — one dashed frame around the four siblings, no lines between them;
 *   - a real derivation — a video made from an image, joined by a line.
 * Both the frame and the line come from the SAME functions the live board calls, so this harness
 * is evidence rather than a drawing: nothing here decides anything for itself.
 *
 * The batch cards deliberately sit out of generation order (position 3 is above position 0), which
 * is exactly the arrangement that used to relabel a batch. The frame still says "Batch of 4".
 */
const BATCH_CARD = { w: 220, h: 165 };
const BATCH_SEATS = [
  { x: 60, y: 1180 }, { x: 320, y: 1180 }, { x: 320, y: 980 }, { x: 60, y: 980 },
];
const batchCards = BATCH_SEATS.map((seat, batchIndex) => ({
  id: `batch-${batchIndex}`,
  type: "image" as const,
  genJobId: "job-batch",
  batchIndex,
  batchSize: BATCH_SEATS.length,
  madeFromNodeId: null,
  seat,
}));

const derivationCards = [
  { id: "made-from-source", type: "image" as const, genJobId: "job-src", batchIndex: 0, batchSize: 1, madeFromNodeId: null, seat: { x: 700, y: 980 } },
  { id: "made-from-result", type: "video" as const, genJobId: "job-vid", batchIndex: 0, batchSize: 1, madeFromNodeId: "made-from-source", seat: { x: 700, y: 1200 } },
];

const identityCards = [...batchCards, ...derivationCards];

const identityNodes: Node[] = identityCards.map((card) => ({
  id: card.id,
  type: card.type,
  position: card.seat,
  data: {
    status: "done",
    url: card.type === "video"
      ? "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
      : `https://picsum.photos/seed/${card.id}/360/240`,
    prompt: card.type === "video" ? "make it move" : "a cup of kopi on marble",
    skin: "gb",
    onDelete: noop,
  },
  style: { width: BATCH_CARD.w, height: BATCH_CARD.h },
}));

/** The frame, positioned by the same rule the live board uses: the members' bounding box + 14px. */
const BATCH_FRAME_PAD = 14;
const frameNodes: Node[] = canvasBatchGroups(identityCards).flatMap((group) => {
  const members = group.memberIds
    .map((id) => identityCards.find((card) => card.id === id)!)
    .map((card) => card.seat);
  if (members.length < 2) return [];
  const minX = Math.min(...members.map((seat) => seat.x));
  const minY = Math.min(...members.map((seat) => seat.y));
  const maxX = Math.max(...members.map((seat) => seat.x + BATCH_CARD.w));
  const maxY = Math.max(...members.map((seat) => seat.y + BATCH_CARD.h));
  return [{
    id: `batch-frame:${group.genJobId}`,
    type: "batchFrame",
    position: { x: minX - BATCH_FRAME_PAD, y: minY - BATCH_FRAME_PAD },
    data: { label: canvasBatchFrameLabel(group.batchSize) },
    draggable: false,
    selectable: false,
    zIndex: -1,
    style: { width: maxX - minX + BATCH_FRAME_PAD * 2, height: maxY - minY + BATCH_FRAME_PAD * 2 },
  }];
});

const identityEdges: Edge[] = buildCanvasLineageEdges(identityCards).map((edge) => ({
  ...edge,
  selectable: false,
  style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5, opacity: 0.55 },
}));

export function NodesPreview() {
  return (
    <div className="fk gb-skin gb" style={{ height: "100dvh", width: "100%", background: "var(--bg-page)" }}>
      <ReactFlow
        nodes={[...frameNodes, ...nodes, ...identityNodes]}
        edges={identityEdges}
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
