// apps/web/components/canvas/nodes/ImageNode.tsx
import { useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { NodeResize } from "./NodeResize";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";

/** Does this image card offer its per-node actions (Detail, Make video, Evolve)? A card
 *  is actionable once it has resolved media AND a generation to act on. Exported so
 *  FlowCanvas can load the exact video price while an Evolve bar is on screen from one
 *  definition — a price hint that can appear without the bar (or vice versa) is exactly
 *  the drift #550 is about. */
export function imageNodeActionable(d: { status?: string; url?: string; generationId?: string }): boolean {
  const terminal = d.status === "failed" || d.status === "timeout" || d.status === "missing";
  return !!d.url && !terminal && !!d.generationId;
}

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
    /** Pre-formatted price for the Evolve bar, supplied by FlowCanvas from the server
     *  quote (never a literal here — pricing lives in configuration/packages/core). */
    evolveCostHint?: string;
  };
  const [evolvePrompt, setEvolvePrompt] = useState("");
  const terminal = d.status === "failed" || d.status === "timeout" || d.status === "missing";
  const actionable = imageNodeActionable(d);
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
          <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 300 }}>
            <form
              className="al-promptbar"
              style={{ width: "100%", display: "flex", flexDirection: "row", gap: 6, alignItems: "center", padding: "6px 10px" }}
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
                placeholder="Describe the video to make from this image…"
                aria-label="Describe the video to make from this image"
                className="nodrag nopan"
                onPointerDown={(e) => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", font: "inherit" }}
              />
              <button
                type="submit"
                aria-label="Make a video from this image"
                className="al-btn al-btn-primary al-btn-sm nodrag nopan"
                disabled={!evolvePrompt.trim()}
              >
                →
              </button>
            </form>
            {/* This bar starts a paid image-to-video generation, so its price is visible
                before the merchant can trigger it — it was the only paid entry point in the
                product with no price at all, and its old wording ("Evolve this image" over a
                video-priced action) left a merchant unable to tell an image charge from a
                video one (#550 ②). */}
            {d.evolveCostHint && (
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  textAlign: "center",
                  color: "var(--muted-foreground)",
                }}
              >
                {d.evolveCostHint} · No charge until you confirm.
              </span>
            )}
          </div>
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
