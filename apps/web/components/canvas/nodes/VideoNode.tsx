// apps/web/components/canvas/nodes/VideoNode.tsx
import { useRef, useState, type MouseEvent } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { NodeResize } from "./NodeResize";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";
import { shouldIgnoreCanvasVideoReferenceClick } from "@/lib/canvas-chat-reference";

export function VideoNode({ data, selected }: NodeProps) {
  const d = data as {
    status: string;
    url?: string;
    generationId?: string;
    skin?: string;
    onDelete?: () => void;
    onOpenDetail?: () => void;
    onReferenceInChat?: () => void;
    onRefresh?: () => void;
    onMediaSize?: (size: { width: number; height: number }) => void;
    directToolsLocked?: boolean;
    directToolsLockedReason?: string;
  };
  const gb = d.skin === "gb";
  const writeLock = getCanvasNodeWriteLock(d);
  const terminal = d.status === "failed" || d.status === "timeout" || d.status === "missing";
  const viewable = !!d.url && !terminal;
  const actionable = viewable && !!d.generationId;
  const referenceable = actionable && !!d.onReferenceInChat && !d.directToolsLocked;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const reportMediaSize = (el: HTMLVideoElement) => {
    d.onMediaSize?.({ width: el.videoWidth, height: el.videoHeight });
  };
  const handleReferenceClick = (e: MouseEvent<HTMLDivElement>) => {
    if (
      shouldIgnoreCanvasVideoReferenceClick({
        targetTagName: e.target instanceof HTMLElement ? e.target.tagName : null,
        controlsVisible: !gb || playing,
      })
    ) {
      return;
    }
    d.onReferenceInChat?.();
  };
  return (
    <>
      <NodeResize gb={gb} selected={selected} locked={writeLock.locked} />
      <NodeToolbar
        className="cv-node-toolbar nodrag nopan"
        isVisible={selected}
        position={Position.Top}
        align="start"
        offset={22}
        style={{ display: "flex", gap: 6, pointerEvents: "all", zIndex: 50 }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {actionable && d.onOpenDetail && (
          <button
            type="button"
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onOpenDetail?.(); }}
          >
            Detail
          </button>
        )}
        <button
          type="button"
          aria-label="Delete video node"
          className="al-btn al-btn-glass al-btn-sm nodrag nopan"
          disabled={writeLock.locked}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onDelete?.(); }}
          title={writeLock.locked ? writeLock.reason : "Delete video node"}
        >
          ✕
        </button>
      </NodeToolbar>
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8z" /></svg>
        Video
      </span>
    <div
      className="al-panel"
      role={referenceable ? "button" : undefined}
      tabIndex={referenceable ? 0 : undefined}
      aria-label={referenceable ? "Use video as Otto reference" : undefined}
      title={referenceable ? "Use as Otto reference" : undefined}
      onClick={referenceable ? handleReferenceClick : undefined}
      onKeyDown={referenceable ? (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        d.onReferenceInChat?.();
      } : undefined}
      style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 14, cursor: referenceable ? "pointer" : undefined }}
    >
      {terminal ? (
        <FailedBody status={d.status as "failed" | "timeout" | "missing"} onRefresh={d.onRefresh} />
      ) : d.status === "pending" || !d.url ? (
        <GeneratingBody gb={gb} kind="video" onRefresh={d.onRefresh} />
      ) : gb ? (
        // gb: clean poster (first frame) + centered play button, like the mockup —
        // no raw browser chrome until the owner presses play. Display-only.
        <div className="cv-video-wrap">
          <video
            ref={videoRef}
            src={d.url}
            preload="metadata"
            playsInline
            controls={playing}
            onLoadedMetadata={(e) => reportMediaSize(e.currentTarget)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" }}
          />
          {!playing && (
            <button
              className="cv-play nodrag nopan"
              type="button"
              aria-label="Play"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); void videoRef.current?.play(); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </button>
          )}
        </div>
      ) : (
        <video
          src={d.url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => reportMediaSize(e.currentTarget)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" }}
        />
      )}
      <Handle type="target" position={Position.Left} />
    </div>
    </>
  );
}
