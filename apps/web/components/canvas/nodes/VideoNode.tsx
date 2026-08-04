// apps/web/components/canvas/nodes/VideoNode.tsx
import { useRef, useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody, isTerminalCardStatus, type TerminalCardStatus } from "./GeneratingBody";
import { NodeResize } from "./NodeResize";
import { NodeLineagePanel } from "./NodeLineagePanel";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";
import { canvasNodeHasSource, type CanvasNodeLineage } from "@/lib/canvas-lineage";

export function VideoNode({ data, id, selected }: NodeProps) {
  const d = data as {
    status: string;
    url?: string;
    prompt?: string;
    generationId?: string;
    skin?: string;
    lineage?: CanvasNodeLineage | null;
    sourceNodeId?: string | null;
    onDelete?: () => void;
    onOpenDetail?: () => void;
    /** Hands the whole picked set to Otto as references — an explicit press, never a click on
     *  the video itself (#604 · spec #599 D6). */
    onSendToOtto?: () => void;
    /** How many cards are picked on the board right now (#604 r2 P2②). Supplied by FlowCanvas. */
    selectedCount?: number;
    onRefresh?: () => void;
    onMediaSize?: (size: { width: number; height: number }) => void;
    /** Opens the video confirm dialog seeded with this prompt — the paid video path keeps
     *  its explicit "no charge until you confirm" step (founder: video always confirms). */
    onRemake?: (id: string, prompt: string) => void;
    directToolsLocked?: boolean;
    directToolsLockedReason?: string;
    /** Pre-formatted video price from the server quote — never a literal here. */
    remakeCostHint?: string;
  };
  const gb = d.skin === "gb";
  const writeLock = getCanvasNodeWriteLock(d);
  const terminal = isTerminalCardStatus(d.status);
  const viewable = !!d.url && !terminal;
  const actionable = viewable && !!d.generationId;
  const canSendToOtto = actionable && !!d.onSendToOtto && !d.directToolsLocked;
  const originalPrompt = (d.prompt ?? "").trim();
  const canRemake = actionable && !!d.onRemake && !d.directToolsLocked && !writeLock.locked;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // Same in-place editing the image cards got (#547 A4): the card's own prompt is the
  // starting text, not an empty box the merchant has to retype.
  const [remakePrompt, setRemakePrompt] = useState(originalPrompt);
  const [promptSeed, setPromptSeed] = useState(originalPrompt);
  // Same rule as the image card: a card's own bar is on screen only while that card is the
  // only one picked, so neighbouring cards' bars can never land on top of each other and the
  // merchant is never left guessing which card a button acts on (#604 r2 P2②).
  const soloSelected = selected && (d.selectedCount ?? 1) === 1;
  const [wasSolo, setWasSolo] = useState(soloSelected);
  if (promptSeed !== originalPrompt) {
    setPromptSeed(originalPrompt);
    setRemakePrompt(originalPrompt);
  }
  // The info panel belongs to the single picked card; anything else closes it. Render-phase
  // "adjust state when a prop changes" (React docs pattern) — not setState-in-effect.
  if (wasSolo !== soloSelected) {
    setWasSolo(soloSelected);
    if (!soloSelected) setInfoOpen(false);
  }
  const reportMediaSize = (el: HTMLVideoElement) => {
    d.onMediaSize?.({ width: el.videoWidth, height: el.videoHeight });
  };
  return (
    <>
      <NodeResize gb={gb} selected={selected} locked={writeLock.locked} />
      <NodeToolbar
        className="cv-node-toolbar nodrag nopan"
        isVisible={soloSelected}
        position={Position.Top}
        align="start"
        offset={22}
        style={{ display: "flex", gap: 6, pointerEvents: "all", zIndex: 50 }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {actionable && (
          <button
            type="button"
            aria-label="Show how this video was made"
            aria-pressed={infoOpen}
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            title="When it was made, the settings, and what it cost"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setInfoOpen((open) => !open); }}
          >
            Info
          </button>
        )}
        {/* D6: the one and only way a card reaches Otto. Clicking the video used to do it
            silently; now the merchant asks for it, and the whole picked set goes at once (#604). */}
        {canSendToOtto && (
          <button
            type="button"
            aria-label="Send the picked cards to Otto"
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            title="Hand this to Otto as a reference"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onSendToOtto?.(); }}
          >
            Send to Otto
          </button>
        )}
        {canRemake && !!originalPrompt && (
          <button
            type="button"
            aria-label="Make another version of this video"
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onRemake?.(id, originalPrompt); }}
            title={`Make another one from the same description${d.remakeCostHint ? ` · ${d.remakeCostHint}` : ""} · you confirm before anything is charged`}
          >
            More like this
          </button>
        )}
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
      {infoOpen && (
        <NodeToolbar
          className="nodrag nopan"
          isVisible={soloSelected}
          position={Position.Right}
          align="start"
          offset={12}
          style={{ pointerEvents: "all", zIndex: 51 }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <NodeLineagePanel lineage={d.lineage} prompt={d.prompt} hasSource={canvasNodeHasSource(d)} />
        </NodeToolbar>
      )}
      {canRemake && (
        <NodeToolbar
          className="nodrag nopan"
          isVisible={soloSelected}
          position={Position.Bottom}
          align="center"
          offset={12}
          style={{ pointerEvents: "all", zIndex: 50 }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 320 }}>
            <form
              className="al-promptbar"
              style={{ width: "100%", display: "flex", flexDirection: "row", gap: 6, alignItems: "center", padding: "6px 10px" }}
              onSubmit={(e) => {
                e.preventDefault();
                const text = remakePrompt.trim();
                if (!text) return;
                d.onRemake?.(id, text);
              }}
            >
              <input
                value={remakePrompt}
                onChange={(e) => setRemakePrompt(e.target.value)}
                placeholder="Change the wording, then send to make a new video…"
                aria-label="Edit this video's prompt and make a new video"
                className="nodrag nopan"
                onPointerDown={(e) => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", font: "inherit" }}
              />
              <button
                type="submit"
                aria-label="Make a new video from this edited prompt"
                className="al-btn al-btn-primary al-btn-sm nodrag nopan"
                disabled={!remakePrompt.trim()}
              >
                →
              </button>
            </form>
            {d.remakeCostHint && (
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  textAlign: "center",
                  color: "var(--muted-foreground)",
                }}
              >
                New video · {d.remakeCostHint} · No charge until you confirm.
              </span>
            )}
          </div>
        </NodeToolbar>
      )}
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8z" /></svg>
        Video
      </span>
    {/* The video is a video, not a button: clicking it picks the card up (and the play control
        still just plays it). Everything the card can DO lives on its toolbar above (#604 · D6). */}
    <div
      className="al-panel"
      style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 14 }}
    >
      {terminal ? (
        <FailedBody status={d.status as TerminalCardStatus} onRefresh={d.onRefresh} />
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
      {/* Left end receives the line from the image this video was made from (#547 B4). */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
    </>
  );
}
