// apps/web/components/canvas/nodes/VideoNode.tsx
import { useRef, useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import {
  CopyPlusIcon,
  DownloadIcon,
  GitBranchIcon,
  InfoIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { CanvasNodeFooter } from "./CanvasNodeFooter";
import { CanvasNodeLabel } from "./CanvasNodeLabel";
import { CanvasNodeMoreMenu } from "./CanvasNodeMoreMenu";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NodeRemakeComposer } from "./NodeRemakeComposer";
import { NodeToolbarIconButton } from "./NodeToolbarIconButton";
import { isInFlightCardFace, isTerminalCardStatus, type TerminalCardStatus } from "@/lib/canvas-card-status";
import { isGenFailureReason } from "@fikirtive/core/gen-failure";
import { NodeResize } from "./NodeResize";
import { NodeLineagePanel } from "./NodeLineagePanel";
import { canvasNodeHasSource, type CanvasNodeLineage } from "@/lib/canvas-lineage";
import { canvasBatchLetter, canvasRecordedFacts } from "@/lib/canvas-batch-identity";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

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
    /** Save this one card's media to the merchant's computer. Supplied by FlowCanvas, which owns
     *  the `<a download>` and the file name — the same path the "N selected" bar already uses. */
    onDownload?: () => void;
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
    /** Pre-formatted video price from the server quote — never a literal here. */
    remakeCostHint?: string;
  };
  const gb = d.skin === "gb";
  // Only a card a board read has answered for wears a letter. What a press ASKED for is not
  // what it settled, so a card that is still queueing says nothing about its batch (#605 r1 P1-1).
  const letter = canvasBatchLetter(canvasRecordedFacts(d));
  const terminal = isTerminalCardStatus(d.status);
  // WHY this card rested, narrowed back into the algebra (#827) — same rule as the image card:
  // React Flow's `data` is untyped, so an unrecognised word rests on `unexplained` rather than
  // becoming an invented reason. This is the surface the refusal #765 recognises actually lands
  // on: it is a VIDEO submit that gets refused for a reference image showing a real person.
  const failureReason = isGenFailureReason(d.failureReason) ? d.failureReason : "unexplained";
  const viewable = !!d.url && !terminal;
  const actionable = viewable && !!d.generationId;
  const canSendToOtto = actionable && !!d.onSendToOtto;
  const originalPrompt = (d.prompt ?? "").trim();
  const canRemake = actionable && !!d.onRemake;
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
      <NodeResize gb={gb} selected={selected} />
      <NodeToolbar
        className="cv-node-toolbar nodrag nopan"
        isVisible={soloSelected}
        position={Position.Top}
        align="start"
        offset={22}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* FIVE CONTROLS, IN THE APPROVED PATTERN'S OWN ORDER (Founder 2026-09-03: 生产界面严格按
            UIUX 设计走) — the image card's note explains the convergence. A video card has no
            Animate: it is already the animation. */}
        <ButtonGroup aria-label="Video actions" className="cv-node-action-group">
        {/* D6: the one and only way a card reaches Otto. Clicking the video used to do it
            silently; now the merchant asks for it, and the whole picked set goes at once (#604).
            This is the pattern's "Edit with Otto": the card becomes the conversation's context. */}
        {canSendToOtto && (
          <NodeToolbarIconButton
            type="button"
            label="Edit with Otto"
            visibleLabel="Edit with Otto"
            tooltip={d.sendToOttoTitle ?? "Hand this to Otto as a reference"}
            title={d.sendToOttoTitle ?? "Hand this to Otto as a reference"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onSendToOtto?.(); }}
          >
            <WandSparklesIcon aria-hidden />
          </NodeToolbarIconButton>
        )}
        {canRemake && !!originalPrompt && (
          <NodeToolbarIconButton
            type="button"
            label="Create variations"
            visibleLabel="Create variations"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onRemake?.(id, originalPrompt); }}
            tooltip={`Make another one from the same description${d.remakeCostHint ? ` \u00b7 ${d.remakeCostHint}` : ""} \u00b7 you confirm before anything is charged`}
            title={`Make another one from the same description${d.remakeCostHint ? ` \u00b7 ${d.remakeCostHint}` : ""} \u00b7 you confirm before anything is charged`}
          >
            <CopyPlusIcon aria-hidden />
          </NodeToolbarIconButton>
        )}
        {/* Download — the same `<a download>` the board's own "N selected" bar and the Detail
            panel already use, aimed at this one card. No new business layer. */}
        {actionable && d.onDownload && (
          <NodeToolbarIconButton
            type="button"
            label="Download"
            visibleLabel="Download"
            tooltip="Save this to your computer"
            title="Save this to your computer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onDownload?.(); }}
          >
            <DownloadIcon aria-hidden />
          </NodeToolbarIconButton>
        )}
        <CanvasNodeMoreMenu label="More actions">
          {actionable && (
            <DropdownMenuItem onSelect={() => setInfoOpen((open) => !open)}>
              <InfoIcon aria-hidden />
              {infoOpen ? "Hide how this was made" : "Show how this video was made"}
            </DropdownMenuItem>
          )}
          {/* T6: the card's whole story — what made it, what it made, who came out of the same
              press. Offered on a card that failed too: where it came from is exactly what a
              merchant wants to know about a card that did not work (#605). */}
          {d.onOpenLineage && (
            <DropdownMenuItem onSelect={() => d.onOpenLineage?.()}>
              <GitBranchIcon aria-hidden />
              Show what this card came from
            </DropdownMenuItem>
          )}
          {actionable && d.onOpenDetail && (
            <DropdownMenuItem onSelect={() => d.onOpenDetail?.()}>
              <SlidersHorizontalIcon aria-hidden />
              Open video details
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => d.onDelete?.()}>
            <Trash2Icon aria-hidden />
            Remove from canvas
          </DropdownMenuItem>
        </CanvasNodeMoreMenu>
        </ButtonGroup>
      </NodeToolbar>
      {infoOpen && (
        <NodeToolbar
          className="cv-node-info-toolbar nodrag nopan"
          isVisible={soloSelected}
          position={Position.Right}
          align="start"
          offset={12}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <NodeLineagePanel
            lineage={d.lineage}
            prompt={d.prompt}
            hasSource={canvasNodeHasSource(d)}
            onClose={() => setInfoOpen(false)}
          />
        </NodeToolbar>
      )}
      {canRemake && (
        <NodeToolbar
          className="cv-node-remake-toolbar nodrag nopan"
          isVisible={soloSelected}
          position={Position.Bottom}
          align="center"
          offset={12}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <NodeRemakeComposer
            value={remakePrompt}
            onChange={setRemakePrompt}
            onSubmit={() => d.onRemake?.(id, remakePrompt.trim())}
            placeholder="Change the wording for a new video…"
            inputLabel="Edit this video's prompt and make a new video"
            submitLabel="Make a new video from this edited prompt"
            costHint={d.remakeCostHint}
            costLabel="New video"
            confirmation="No charge until you confirm."
          />
        </NodeToolbar>
      )}
      <CanvasNodeLabel kind="video" letter={letter} />
    {/* The video is a video, not a button: clicking it picks the card up (and the play control
        still just plays it). Everything the card can DO lives on its toolbar above (#604 · D6). */}
    <div
      className="al-panel cv-node-frame cv-node-frame-media"
    >
      {/* The pattern's card is a media well with a named strip under it, so the well is its own
          box rather than the whole card (`CanvasReference.tsx`: `h-[calc(100%-42px)]`). */}
      <div className="cv-node-body">
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
            className="cv-node-media"
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
              <PlayIcon aria-hidden fill="currentColor" />
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
          className="cv-node-media"
        />
      )}
      </div>
      <CanvasNodeFooter name={originalPrompt} />
      {/* Left end receives the line from the image this video was made from (#547 B4). */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
    </>
  );
}
