// apps/web/components/canvas/nodes/ImageNode.tsx
import { useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import {
  CopyPlusIcon,
  DownloadIcon,
  FilmIcon,
  GitBranchIcon,
  InfoIcon,
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
import { ImageShapePicker } from "@/components/gen/ImageShapePicker";
import { ButtonGroup } from "@/components/ui/button-group";
import { InputGroupAddon } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

/** Does this card offer its per-card actions (the pattern's five: Edit with Otto, Create
 *  variations, Animate, Download, and the ⋯ menu — plus the attached prompt bar)? A card is
 *  actionable once it has resolved media AND a generation
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
    onAnimate?: () => void;
    onEvolve?: (id: string, prompt: string, aspect?: string) => void;
    onVariant?: (id: string, aspect?: string) => void;
    /** One direct image action is being accepted. All image spend controls pause; the control
     *  that started it also shows activity so the merchant knows which request is moving. */
    imageActionPending?: boolean;
    imageVariantPending?: boolean;
    imageEvolvePending?: boolean;
    /** #643 T2：一张新图默认交付的形状 = 这张卡自己记着的形状（「改这张图」不改形状）。 */
    imageShape?: string;
    /** 服务端解析的形状菜单。缺席 ⇒ 不渲染选择器（仍按默认形状出图）。 */
    imageShapeOptions?: readonly string[];
    onDelete?: () => void;
    onOpenDetail?: () => void;
    /** Save this one card's media to the merchant's computer. Supplied by FlowCanvas, which owns
     *  the `<a download>` and the file name — the same path the "N selected" bar already uses. */
    onDownload?: () => void;
    /** Hands the whole picked set to Otto as references — an explicit press, never a click on
     *  the picture itself (#604 · spec #599 D6). */
    onSendToOtto?: () => void;
    /** What that press will do RIGHT NOW, resolved by FlowCanvas from the one place that knows
     *  whether a conversation is open (#548). Handing cards over is the single canvas action that
     *  still needs one, and the card says so before it is pressed — never only afterwards. */
    sendToOttoTitle?: string;
    /** How many cards are picked on the board right now (#604 r2 P2②). Supplied by FlowCanvas. */
    selectedCount?: number;
    onRefresh?: () => void;
    onMediaSize?: (size: { width: number; height: number }) => void;
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
  // #643 T2：这条 bar 会交付的形状。种子是这张卡自己的形状 —— 商家什么都不动就等于
  // 「和这张一样」，动了就按他动的那一格来。卡的形状变了（板子重读）就重新播种。
  const [evolveShape, setEvolveShape] = useState(d.imageShape);
  const [shapeSeed, setShapeSeed] = useState(d.imageShape);
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
  if (shapeSeed !== d.imageShape) {
    setShapeSeed(d.imageShape);
    setEvolveShape(d.imageShape);
  }
  // The info panel belongs to the single picked card; anything else closes it. Render-phase
  // "adjust state when a prop changes" (React docs pattern) — not setState-in-effect.
  if (wasSolo !== soloSelected) {
    setWasSolo(soloSelected);
    if (!soloSelected) setInfoOpen(false);
  }
  const terminal = isTerminalCardStatus(d.status);
  // WHY this card rested, narrowed back into the algebra (#827). React Flow's `data` is an
  // untyped bag, so the board read's word is re-checked here exactly as `status` is above:
  // anything this build does not recognise reads as `unexplained`, which is what a card with
  // no recorded reason has always said. Never a crash, never an invented reason.
  const failureReason = isGenFailureReason(d.failureReason) ? d.failureReason : "unexplained";
  const actionable = imageNodeActionable(d);
  // Only a card a board read has answered for wears a letter. What a press ASKED for is not
  // what it settled, so a card that is still queueing says nothing about its batch (#605 r1 P1-1).
  const letter = canvasBatchLetter(canvasRecordedFacts(d));
  const canEvolve = actionable && !!d.onEvolve;
  const canVariant = actionable && !!d.onVariant && !!originalPrompt;
  const canSendToOtto = actionable && !!d.onSendToOtto;
  return (
    <>
      <NodeResize gb={d.skin === "gb"} selected={selected} />
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
            UIUX 设计走). `design-system/patterns/canvas/CanvasReference.tsx` gives a picked card
            Edit with Otto · Create variations · Animate · Download · ⋯ — five icons, one language.
            The trunk had grown eight, mixing icon buttons with text buttons ("More like this",
            "Make video"), which is a row nobody designed. Nothing is lost: Info, Lineage and
            Detail moved into the ⋯ menu the pattern already puts there. */}
        <ButtonGroup aria-label="Image actions" className="cv-node-action-group">
        {/* D6: the one and only way a card reaches Otto. Clicking the picture used to do it
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
        {/* A3: one click makes another take of THIS image from its own prompt — the old path
            was Detail → Regenerate (two clicks and a panel). Paid, and priced in the title. */}
        {canVariant && (
          <NodeToolbarIconButton
            type="button"
            label="Create variations"
            visibleLabel="Create variations"
            disabled={d.imageActionPending}
            onPointerDown={(e) => e.stopPropagation()}
            // #643 T2：形状用这张卡上正显示的那一格 —— 同一张卡上的两个按钮不许交付两种形状。
            onClick={(e) => { e.stopPropagation(); d.onVariant?.(id, evolveShape); }}
            tooltip={`Make another one like this${evolveShape ? ` · ${evolveShape}` : ""}${d.evolveCostHint ? ` · ${d.evolveCostHint}` : ""}`}
            title={`Make another one like this${evolveShape ? ` · ${evolveShape}` : ""}${d.evolveCostHint ? ` · ${d.evolveCostHint}` : ""}`}
          >
            {d.imageVariantPending ? <Spinner aria-hidden="true" /> : <CopyPlusIcon aria-hidden />}
          </NodeToolbarIconButton>
        )}
        {actionable && d.onAnimate && (
          <NodeToolbarIconButton
            type="button"
            label="Animate"
            visibleLabel="Animate"
            tooltip="Make a video from this image"
            title="Make a video from this image"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onAnimate?.(); }}
          >
            <FilmIcon aria-hidden />
          </NodeToolbarIconButton>
        )}
        {/* Download — the same `<a download>` the board's own "N selected" bar and the Detail
            panel already use, aimed at this one card. No new business layer: FlowCanvas owns the
            anchor and the file name (`canvasDownloadFileName`). */}
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
              {infoOpen ? "Hide how this was made" : "Show how this image was made"}
            </DropdownMenuItem>
          )}
          {/* T6: the card's whole story — what made it, what it made, who came out of the same
              press. Unlike Info it is offered on a card that FAILED too: what a merchant most
              wants to know about a card that did not work is where it came from (#605). */}
          {d.onOpenLineage && (
            <DropdownMenuItem onSelect={() => d.onOpenLineage?.()}>
              <GitBranchIcon aria-hidden />
              Show what this card came from
            </DropdownMenuItem>
          )}
          {actionable && d.onOpenDetail && (
            <DropdownMenuItem onSelect={() => d.onOpenDetail?.()}>
              <SlidersHorizontalIcon aria-hidden />
              Open image details
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
      {canEvolve && (
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
            value={evolvePrompt}
            onChange={setEvolvePrompt}
            onSubmit={() => d.onEvolve?.(id, evolvePrompt.trim(), evolveShape)}
            placeholder="Change the wording for a new take…"
            inputLabel="Edit this image's prompt and make a new image"
            submitLabel="Make a new image from this edited prompt"
            costHint={d.evolveCostHint}
            costLabel="New image from this one"
            disabled={d.imageActionPending}
            pending={d.imageEvolvePending}
            pendingLabel="Starting a new image"
            controls={d.imageShapeOptions && evolveShape ? (
              <InputGroupAddon align="inline-end">
                <div className="nodrag nopan">
                  <ImageShapePicker
                    compact
                    value={evolveShape}
                    options={d.imageShapeOptions}
                    onChange={setEvolveShape}
                    disabled={d.imageActionPending}
                    title="The shape the new image will be made in — same cost in every shape"
                  />
                </div>
              </InputGroupAddon>
            ) : null}
          />
        </NodeToolbar>
      )}
      <CanvasNodeLabel kind="image" letter={letter} />
    {/* The picture is a picture, not a button: clicking it picks the card up and nothing else
        (#604 · spec #599 D6). Everything the card can DO lives on its toolbar above. */}
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
        <GeneratingBody gb={d.skin === "gb"} kind="image" queued={d.status === "queued"} onRefresh={d.onRefresh} />
      ) : !d.url ? (
        // Not this card's own ending — a face this renderer could not draw media for. It has no
        // refusal to explain, so it says the `missing` words and nothing more (#827).
        <FailedBody status="missing" reason="unexplained" onRefresh={d.onRefresh} />
      ) : (
        <img
          src={d.url}
          alt={d.prompt ?? ""}
          onLoad={(e) => d.onMediaSize?.({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          className="cv-node-media"
        />
      )}
      </div>
      <CanvasNodeFooter name={originalPrompt} />
      {/* Lineage endpoints: an image can now be BOTH the parent of a video/new image and the
          child of the image it was evolved from, so it needs both ends of the line (#547 B4). */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
    </>
  );
}
