// apps/web/components/canvas/nodes/ImageNode.tsx
import { useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { NodeResize } from "./NodeResize";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";

export function ImageNode({ data, id, selected }: NodeProps) {
  const d = data as {
    status: string;
    url?: string;
    prompt?: string;
    generationId?: string;
    skin?: string;
    onAnimate?: () => void;
    onEvolve?: (id: string, prompt: string) => void;
    onDelete?: () => void;
    onOpenDetail?: () => void;
    onReferenceInChat?: () => void;
    onRefresh?: () => void;
    onMediaSize?: (size: { width: number; height: number }) => void;
    directToolsLocked?: boolean;
    directToolsLockedReason?: string;
  };
  const [evolvePrompt, setEvolvePrompt] = useState("");
  const terminal = d.status === "failed" || d.status === "timeout" || d.status === "missing";
  const viewable = !!d.url && !terminal;
  const actionable = viewable && !!d.generationId;
  const canEvolve = actionable && !!d.onEvolve && !d.directToolsLocked;
  const referenceable = actionable && !!d.onReferenceInChat && !d.directToolsLocked;
  const writeLock = getCanvasNodeWriteLock(d);
  return (
    <>
      <NodeResize gb={d.skin === "gb"} selected={selected} locked={writeLock.locked} />
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
        {actionable && d.onAnimate && (
          <button
            type="button"
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            disabled={writeLock.locked}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onAnimate?.(); }}
            title={writeLock.locked ? writeLock.reason : "Make a video from this image"}
          >
            Make video
          </button>
        )}
        <button
          type="button"
          aria-label="Delete image node"
          className="al-btn al-btn-glass al-btn-sm nodrag nopan"
          disabled={writeLock.locked}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onDelete?.(); }}
          title={writeLock.locked ? writeLock.reason : "Delete image node"}
        >
          ✕
        </button>
      </NodeToolbar>
      {canEvolve && (
        <NodeToolbar
          className="nodrag nopan"
          isVisible={selected}
          position={Position.Bottom}
          align="center"
          offset={12}
          style={{ pointerEvents: "all", zIndex: 50 }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <form
            className="al-promptbar"
            style={{ width: 300, display: "flex", flexDirection: "row", gap: 6, alignItems: "center", padding: "6px 10px" }}
            onSubmit={(e) => {
              e.preventDefault();
              const text = evolvePrompt.trim();
              if (!text) return;
              d.onEvolve?.(id, text);
              setEvolvePrompt("");
            }}
          >
            <input
              value={evolvePrompt}
              onChange={(e) => setEvolvePrompt(e.target.value)}
              placeholder="Type to imagine — make a video from this…"
              aria-label="Evolve this image"
              className="nodrag nopan"
              onPointerDown={(e) => e.stopPropagation()}
              style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", font: "inherit" }}
            />
            <button
              type="submit"
              aria-label="Generate from this image"
              className="al-btn al-btn-primary al-btn-sm nodrag nopan"
              disabled={!evolvePrompt.trim()}
            >
              →
            </button>
          </form>
        </NodeToolbar>
      )}
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
        Image
      </span>
    <div
      className="al-panel"
      role={referenceable ? "button" : undefined}
      tabIndex={referenceable ? 0 : undefined}
      aria-label={referenceable ? "Use image as Otto reference" : undefined}
      title={referenceable ? "Use as Otto reference" : undefined}
      onClick={referenceable ? () => d.onReferenceInChat?.() : undefined}
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
        <GeneratingBody gb={d.skin === "gb"} kind="image" onRefresh={d.onRefresh} />
      ) : (
        <img
          src={d.url}
          alt={d.prompt ?? ""}
          onLoad={(e) => d.onMediaSize?.({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "var(--muted)" }}
        />
      )}
      <Handle type="source" position={Position.Right} />
    </div>
    </>
  );
}
