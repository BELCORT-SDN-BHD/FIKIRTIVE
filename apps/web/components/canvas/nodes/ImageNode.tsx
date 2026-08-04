// apps/web/components/canvas/nodes/ImageNode.tsx
import { useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody, isTerminalCardStatus, type TerminalCardStatus } from "./GeneratingBody";
import { NodeResize } from "./NodeResize";
import { NodeLineagePanel } from "./NodeLineagePanel";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";
import { canvasNodeHasSource, type CanvasNodeLineage } from "@/lib/canvas-lineage";

/** Does this card offer its per-card actions (Info, More like this, Detail, Make video, and
 *  the attached prompt bar)? A card is actionable once it has resolved media AND a generation
 *  to act on. Exported so FlowCanvas can load the exact price while any of those are on screen
 *  from one definition — a price hint that can appear without its bar (or vice versa) is
 *  exactly the drift #550 is about. Used for video cards too: the fields it reads
 *  (status/url/generationId) mean the same thing on both. */
export function imageNodeActionable(d: { status?: string; url?: string; generationId?: string }): boolean {
  const terminal = isTerminalCardStatus(d.status);
  return !!d.url && !terminal && !!d.generationId;
}

export function ImageNode({ data, id, selected }: NodeProps) {
  const d = data as {
    status: string;
    url?: string;
    prompt?: string;
    generationId?: string;
    skin?: string;
    lineage?: CanvasNodeLineage | null;
    sourceNodeId?: string | null;
    onAnimate?: () => void;
    onEvolve?: (id: string, prompt: string) => void;
    onVariant?: (id: string) => void;
    onDelete?: () => void;
    onOpenDetail?: () => void;
    /** Hands the whole picked set to Otto as references — an explicit press, never a click on
     *  the picture itself (#604 · spec #599 D6). */
    onSendToOtto?: () => void;
    /** How many cards are picked on the board right now (#604 r2 P2②). Supplied by FlowCanvas. */
    selectedCount?: number;
    onRefresh?: () => void;
    onMediaSize?: (size: { width: number; height: number }) => void;
    directToolsLocked?: boolean;
    directToolsLockedReason?: string;
    /** Pre-formatted price for the Evolve bar, supplied by FlowCanvas from the server
     *  quote (never a literal here — pricing lives in configuration/packages/core). */
    evolveCostHint?: string;
  };
  const originalPrompt = (d.prompt ?? "").trim();
  // A2/A4: selecting a card used to float an EMPTY box, so "change one word and run it again"
  // meant retyping the whole prompt from memory. The card's own prompt is the starting text;
  // the merchant edits it in place. Re-seeded whenever the card's stored prompt changes.
  const [evolvePrompt, setEvolvePrompt] = useState(originalPrompt);
  const [promptSeed, setPromptSeed] = useState(originalPrompt);
  const [infoOpen, setInfoOpen] = useState(false);
  // This card's own bar belongs to THIS card, so it is only on screen while this card is the
  // only one picked. With two neighbouring cards picked, the two bars used to overlap and the
  // merchant could not tell which card a button belonged to (#604 r2 P2②) — with several
  // picked, the board's "N selected" bar is the one place to act on them.
  const soloSelected = selected && (d.selectedCount ?? 1) === 1;
  const [wasSolo, setWasSolo] = useState(soloSelected);
  if (promptSeed !== originalPrompt) {
    setPromptSeed(originalPrompt);
    setEvolvePrompt(originalPrompt);
  }
  // The info panel belongs to the single picked card; anything else closes it. Render-phase
  // "adjust state when a prop changes" (React docs pattern) — not setState-in-effect.
  if (wasSolo !== soloSelected) {
    setWasSolo(soloSelected);
    if (!soloSelected) setInfoOpen(false);
  }
  const terminal = isTerminalCardStatus(d.status);
  const actionable = imageNodeActionable(d);
  const canEvolve = actionable && !!d.onEvolve && !d.directToolsLocked;
  const canVariant = actionable && !!d.onVariant && !d.directToolsLocked && !!originalPrompt;
  const canSendToOtto = actionable && !!d.onSendToOtto && !d.directToolsLocked;
  const writeLock = getCanvasNodeWriteLock(d);
  return (
    <>
      <NodeResize gb={d.skin === "gb"} selected={selected} locked={writeLock.locked} />
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
            aria-label="Show how this image was made"
            aria-pressed={infoOpen}
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            title="When it was made, the settings, and what it cost"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setInfoOpen((open) => !open); }}
          >
            Info
          </button>
        )}
        {/* D6: the one and only way a card reaches Otto. Clicking the picture used to do it
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
        {/* A3: one click makes another take of THIS image from its own prompt — the old path
            was Detail → Regenerate (two clicks and a panel). Paid, and priced right here. */}
        {canVariant && (
          <button
            type="button"
            aria-label="Make another version of this image"
            className="al-btn al-btn-glass al-btn-sm nodrag nopan"
            disabled={writeLock.locked}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onVariant?.(id); }}
            title={writeLock.locked ? writeLock.reason : `Make another one like this${d.evolveCostHint ? ` · ${d.evolveCostHint}` : ""}`}
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
      {canEvolve && (
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
                const text = evolvePrompt.trim();
                if (!text) return;
                d.onEvolve?.(id, text);
              }}
            >
              <input
                value={evolvePrompt}
                onChange={(e) => setEvolvePrompt(e.target.value)}
                placeholder="Change the wording, then send to make a new take…"
                aria-label="Edit this image's prompt and make a new image"
                className="nodrag nopan"
                onPointerDown={(e) => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", font: "inherit" }}
              />
              <button
                type="submit"
                aria-label="Make a new image from this edited prompt"
                className="al-btn al-btn-primary al-btn-sm nodrag nopan"
                disabled={!evolvePrompt.trim()}
              >
                →
              </button>
            </form>
            {/* This bar starts a paid image generation built on THIS image, so its price is
                visible before the merchant can trigger it. Before #550 ② it was the only paid
                entry point in the product with no price at all; before #547 A4 its title and
                placeholder also disagreed about whether it made an image or a video. */}
            {d.evolveCostHint && (
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  textAlign: "center",
                  color: "var(--muted-foreground)",
                }}
              >
                New image from this one · {d.evolveCostHint}
              </span>
            )}
          </div>
        </NodeToolbar>
      )}
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
        Image
      </span>
    {/* The picture is a picture, not a button: clicking it picks the card up and nothing else
        (#604 · spec #599 D6). Everything the card can DO lives on its toolbar above. */}
    <div
      className="al-panel"
      style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 14 }}
    >
      {terminal ? (
        <FailedBody status={d.status as TerminalCardStatus} onRefresh={d.onRefresh} />
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
      {/* Lineage endpoints: an image can now be BOTH the parent of a video/new image and the
          child of the image it was evolved from, so it needs both ends of the line (#547 B4). */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
    </>
  );
}
