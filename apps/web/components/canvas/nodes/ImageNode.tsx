// apps/web/components/canvas/nodes/ImageNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { NodeResize } from "./NodeResize";

export function ImageNode({ data, selected }: NodeProps) {
  const d = data as {
    status: string;
    url?: string;
    prompt?: string;
    skin?: string;
    onAnimate?: () => void;
    onDelete?: () => void;
    onOpenDetail?: () => void;
    onRefresh?: () => void;
  };
  const terminal = d.status === "failed" || d.status === "timeout" || d.status === "missing";
  const ready = !!d.url && !terminal;
  return (
    <>
      <NodeResize gb={d.skin === "gb"} selected={selected} />
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
        Image
      </span>
    <div className="al-panel" style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 14 }}>
      {terminal ? (
        <FailedBody status={d.status as "failed" | "timeout" | "missing"} onRefresh={d.onRefresh} />
      ) : d.status === "pending" || !d.url ? (
        <GeneratingBody gb={d.skin === "gb"} kind="image" onRefresh={d.onRefresh} />
      ) : (
        <img src={d.url} alt={d.prompt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <div
        className="nodrag nopan cv-node-actions"
        style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {ready && d.onOpenDetail && (
          <button
            type="button"
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onOpenDetail?.(); }}
          >
            Detail
          </button>
        )}
        {ready && d.onAnimate && (
          <button
            type="button"
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onAnimate?.(); }}
            title="Make a video from this image"
          >
            Make video
          </button>
        )}
        <button
          type="button"
          className="al-btn al-btn-glass al-btn-sm nodrag nopan"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); d.onDelete?.(); }}
        >
          ✕
        </button>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
    </>
  );
}
