// apps/web/components/canvas/nodes/VideoNode.tsx
import { useRef, useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { isInFlightCardFace, isTerminalCardStatus, type TerminalCardStatus } from "@/lib/canvas-card-status";
import { isGenFailureReason } from "@fikirtive/core/gen-failure";
import { NodeResize } from "./NodeResize";
import { NodeLineagePanel } from "./NodeLineagePanel";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";
import { canvasNodeHasSource, type CanvasNodeLineage } from "@/lib/canvas-lineage";
import { canvasBatchLetter, canvasRecordedFacts } from "@/lib/canvas-batch-identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NODE_TOOL_BUTTON_CLASS } from "./node-tool-button";

export function VideoNode({ data, id, selected }: NodeProps) {
  const d = data as {
    status: string;
    /** WHY this card rested, as the board read resolved it from the job row (#827). A string
     *  here because React Flow's data bag is untyped either way; it is narrowed back into the
     *  closed `GenFailureReason` set below, and an unrecognised word rests on `unexplained`. */
    failureReason?: string;
    url?: string;
    prompt?: string;
    generationId?: string;
    skin?: string;
    lineage?: CanvasNodeLineage | null;
    /** The card this one's paid job was made FROM — the one fact "Made from" reads (#603 T4). */
    madeFromNodeId?: string | null;
    /** Batch identity as the server settled it — what the A/B badge reads (#603 T4). */
    batchIndex?: number | null;
    batchSize?: number | null;
    /** A board read has returned this card. Until it has, the three columns above are only what
     *  the press asked for, and this card may not speak them (#605 r1 P1-1). */
    serverKnown?: unknown;
    /** Opens the lineage tree for the picked card (#605 T6). Supplied by FlowCanvas. */
    onOpenLineage?: () => void;
    onDelete?: () => void;
    onOpenDetail?: () => void;
    /** Hands the whole picked set to Otto as references — an explicit press, never a click on
     *  the video itself (#604 · spec #599 D6). */
    onSendToOtto?: () => void;
    /** What that press will do RIGHT NOW, resolved by FlowCanvas from the one place that knows
     *  whether a conversation is open (#548). Handing cards over is the single canvas action that
     *  still needs one, and the card says so before it is pressed — never only afterwards. */
    sendToOttoTitle?: string;
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
  // Only a card a board read has answered for wears a letter. What a press ASKED for is not
  // what it settled, so a card that is still queueing says nothing about its batch (#605 r1 P1-1).
  const letter = canvasBatchLetter(canvasRecordedFacts(d));
  const writeLock = getCanvasNodeWriteLock(d);
  const terminal = isTerminalCardStatus(d.status);
  // WHY this card rested, narrowed back into the algebra (#827) — same rule as the image card:
  // React Flow's `data` is untyped, so an unrecognised word rests on `unexplained` rather than
  // becoming an invented reason. This is the surface the refusal #765 recognises actually lands
  // on: it is a VIDEO submit that gets refused for a reference image showing a real person.
  const failureReason = isGenFailureReason(d.failureReason) ? d.failureReason : "unexplained";
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
          <Button
            type="button"
            aria-label="Show how this video was made"
            aria-pressed={infoOpen}
            variant="secondary"
            size="sm"
            className={NODE_TOOL_BUTTON_CLASS}
            title="When it was made, the settings, and what it cost"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setInfoOpen((open) => !open); }}
          >
            Info
          </Button>
        )}
        {/* T6: the card's whole story — what made it, what it made, who came out of the same
            press. Offered on a card that failed too: where it came from is exactly what a
            merchant wants to know about a card that did not work (#605). */}
        {d.onOpenLineage && (
          <Button
            type="button"
            aria-label="Show what this card came from"
            variant="secondary"
            size="sm"
            className={NODE_TOOL_BUTTON_CLASS}
            title="What made this card, and what it made"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onOpenLineage?.(); }}
          >
            Lineage
          </Button>
        )}
        {/* D6: the one and only way a card reaches Otto. Clicking the video used to do it
            silently; now the merchant asks for it, and the whole picked set goes at once (#604). */}
        {canSendToOtto && (
          <Button
            type="button"
            aria-label="Send the picked cards to Otto"
            variant="secondary"
            size="sm"
            className={NODE_TOOL_BUTTON_CLASS}
            title={d.sendToOttoTitle ?? "Hand this to Otto as a reference"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onSendToOtto?.(); }}
          >
            Send to Otto
          </Button>
        )}
        {canRemake && !!originalPrompt && (
          <Button
            type="button"
            aria-label="Make another version of this video"
            variant="secondary"
            size="sm"
            className={NODE_TOOL_BUTTON_CLASS}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onRemake?.(id, originalPrompt); }}
            title={`Make another one from the same description${d.remakeCostHint ? ` · ${d.remakeCostHint}` : ""} · you confirm before anything is charged`}
          >
            More like this
          </Button>
        )}
        {actionable && d.onOpenDetail && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={NODE_TOOL_BUTTON_CLASS}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onOpenDetail?.(); }}
          >
            Detail
          </Button>
        )}
        <Button
          type="button"
          aria-label="Delete video node"
          variant="secondary"
          size="sm"
          className={NODE_TOOL_BUTTON_CLASS}
          disabled={writeLock.locked}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onDelete?.(); }}
          title={writeLock.locked ? writeLock.reason : "Delete video node"}
        >
          ✕
        </Button>
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
              {/* #840 车4:迁到 ui/Input,四条覆盖与图片卡那条 bar 同因同解(见 ImageNode)。 */}
              <Input
                value={remakePrompt}
                onChange={(e) => setRemakePrompt(e.target.value)}
                placeholder="Change the wording, then send to make a new video…"
                aria-label="Edit this video's prompt and make a new video"
                className="nodrag nopan h-auto w-auto rounded-none p-0 shadow-none"
                onPointerDown={(e) => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", font: "inherit" }}
              />
              <Button
                type="submit"
                aria-label="Make a new video from this edited prompt"
                variant="default"
                size="sm"
                className="nodrag nopan h-auto px-[13px] py-1.5 text-[12.5px] shadow-none"
                disabled={!remakePrompt.trim()}
              >
                →
              </Button>
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
        {/* The recorded A/B letter — position in the press, never position on the board
            (#603 T4 · #605 T6). */}
        {letter && <span className="cv-nodeletter">{letter}</span>}
      </span>
    {/* The video is a video, not a button: clicking it picks the card up (and the play control
        still just plays it). Everything the card can DO lives on its toolbar above (#604 · D6). */}
    <div
      className="al-panel"
      style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 14 }}
    >
      {/* NO MEDIA IS NOT "BEING MADE" (#602 r2, judge P1-3). The old fallback here was
          `in-flight || !url → spinner`, so any card that reached this renderer without a picture
          — a done row whose media no longer resolves, a face this component did not know — span
          for ever (F21). Only the two in-flight faces spin now; everything else without media says
          which resting state it is in, and `missing` is the board's own word for "the work exists,
          this card cannot show it". */}
      {terminal ? (
        <FailedBody status={d.status as TerminalCardStatus} reason={failureReason} onRefresh={d.onRefresh} />
      ) : isInFlightCardFace(d.status) ? (
        <GeneratingBody gb={gb} kind="video" queued={d.status === "queued"} onRefresh={d.onRefresh} />
      ) : !d.url ? (
        // Not this card's own ending — a face this renderer could not draw media for. It has no
        // refusal to explain, so it says the `missing` words and nothing more (#827).
        <FailedBody status="missing" reason="unexplained" onRefresh={d.onRefresh} />
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
            <Button
              // #840 车4:迁到 ui/Button,`cv-play` 留在原地 —— 它是 `.gb .react-flow__node
              // .cv-play`(三个类的选择器)画的一枚绝对居中的圆钮,专有度高过 Button 自带的
              // 任何一条工具类,几何与配色照旧全由它说了算。压不住的是它**没有声明**的那两项:
              // `p-0`(30×30 的定宽圆钮自己不写内距,Button 的 `px-5` 左右各 20px 会把 content
              // box 压到 0,里面那枚 shrink-0 的三角就会溢出偏心)、`[&_svg]:size-[13px]`
              // (Button 强制子级 svg 为 1.1em,命中的是子元素;13px 正是这枚三角原本的尺寸)。
              className="cv-play nodrag nopan p-0 [&_svg]:size-[13px]"
              variant="ghost"
              type="button"
              aria-label="Play"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); void videoRef.current?.play(); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </Button>
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
