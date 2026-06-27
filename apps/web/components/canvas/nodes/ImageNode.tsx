// apps/web/components/canvas/nodes/ImageNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function ImageNode({ data }: NodeProps) {
  const d = data as {
    status: string;
    url?: string;
    prompt?: string;
    onAnimate?: () => void;
    onDelete?: () => void;
    onOpenDetail?: () => void;
  };
  return (
    <div className="al-panel" style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 12 }}>
      {d.status === "pending" || !d.url ? (
        <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>Generating…</div>
      ) : (
        <img src={d.url} alt={d.prompt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <div className="nodrag" style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}>
        {d.onOpenDetail && (
          <button className="al-btn al-btn-glass al-btn-sm" onClick={d.onOpenDetail}>Detail</button>
        )}
        <button className="al-btn al-btn-glass al-btn-sm" onClick={d.onAnimate}>Animate</button>
        <button className="al-btn al-btn-glass al-btn-sm" onClick={d.onDelete}>✕</button>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
