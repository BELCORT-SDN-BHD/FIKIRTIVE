// apps/web/components/canvas/nodes/VideoNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function VideoNode({ data }: NodeProps) {
  const d = data as { status: string; url?: string; onDelete?: () => void };
  return (
    <div className="al-panel" style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 12 }}>
      {d.status === "pending" || !d.url ? (
        <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>Rendering…</div>
      ) : (
        <video src={d.url} controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <div className="nodrag" style={{ position: "absolute", top: 6, right: 6 }}>
        <button className="al-btn al-btn-glass al-btn-sm" onClick={d.onDelete}>✕</button>
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
