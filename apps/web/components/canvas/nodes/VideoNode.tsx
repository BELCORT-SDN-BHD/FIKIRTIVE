// apps/web/components/canvas/nodes/VideoNode.tsx
import { useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { NodeResize } from "./NodeResize";

export function VideoNode({ data, selected }: NodeProps) {
  const d = data as { status: string; url?: string; skin?: string; onDelete?: () => void };
  const gb = d.skin === "gb";
  const terminal = d.status === "failed" || d.status === "timeout" || d.status === "missing";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <NodeResize gb={gb} selected={selected} />
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8z" /></svg>
        Video
      </span>
    <div className="al-panel" style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 14 }}>
      {terminal ? (
        <FailedBody status={d.status as "failed" | "timeout" | "missing"} />
      ) : d.status === "pending" || !d.url ? (
        <GeneratingBody gb={gb} kind="video" />
      ) : gb ? (
        // gb: clean poster (first frame) + centered play button, like the mockup —
        // no raw browser chrome until the owner presses play. Display-only.
        <div className="cv-video-wrap">
          <video
            ref={videoRef}
            src={d.url}
            preload="metadata"
            controls={playing}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {!playing && (
            <button
              className="cv-play nodrag nopan"
              type="button"
              aria-label="Play"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { void videoRef.current?.play(); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </button>
          )}
        </div>
      ) : (
        <video src={d.url} controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <div
        className="nodrag nopan cv-node-actions"
        style={{ position: "absolute", top: 6, right: 6 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="al-btn al-btn-glass al-btn-sm" onClick={d.onDelete}>✕</button>
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
    </>
  );
}
