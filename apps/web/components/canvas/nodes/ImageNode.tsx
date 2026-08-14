// apps/web/components/canvas/nodes/ImageNode.tsx
import { useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { GeneratingBody, FailedBody } from "./GeneratingBody";
import { isInFlightCardFace, isTerminalCardStatus, type TerminalCardStatus } from "@/lib/canvas-card-status";
import { isGenFailureReason } from "@fikirtive/core/gen-failure";
import { NodeResize } from "./NodeResize";
import { NodeLineagePanel } from "./NodeLineagePanel";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";
import { canvasNodeHasSource, type CanvasNodeLineage } from "@/lib/canvas-lineage";
import { canvasBatchLetter, canvasRecordedFacts } from "@/lib/canvas-batch-identity";
import { ImageShapePicker } from "@/components/gen/ImageShapePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NODE_TOOL_BUTTON_CLASS } from "./node-tool-button";

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
    /** #643 T2：一张新图默认交付的形状 = 这张卡自己记着的形状（「改这张图」不改形状）。 */
    imageShape?: string;
    /** 服务端解析的形状菜单。缺席 ⇒ 不渲染选择器（仍按默认形状出图）。 */
    imageShapeOptions?: readonly string[];
    onDelete?: () => void;
    onOpenDetail?: () => void;
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
          <Button
            type="button"
            aria-label="Show how this image was made"
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
            press. Unlike Info it is offered on a card that FAILED too: what a merchant most
            wants to know about a card that did not work is where it came from (#605). */}
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
        {/* D6: the one and only way a card reaches Otto. Clicking the picture used to do it
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
        {/* A3: one click makes another take of THIS image from its own prompt — the old path
            was Detail → Regenerate (two clicks and a panel). Paid, and priced right here. */}
        {canVariant && (
          <Button
            type="button"
            aria-label="Make another version of this image"
            variant="secondary"
            size="sm"
            className={NODE_TOOL_BUTTON_CLASS}
            disabled={writeLock.locked}
            onPointerDown={(e) => e.stopPropagation()}
            // #643 T2：形状用这张卡上正显示的那一格 —— 同一张卡上的两个按钮不许交付两种形状。
            onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onVariant?.(id, evolveShape); }}
            title={writeLock.locked ? writeLock.reason : `Make another one like this${evolveShape ? ` · ${evolveShape}` : ""}${d.evolveCostHint ? ` · ${d.evolveCostHint}` : ""}`}
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
        {actionable && d.onAnimate && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={NODE_TOOL_BUTTON_CLASS}
            disabled={writeLock.locked}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onAnimate?.(); }}
            title={writeLock.locked ? writeLock.reason : "Make a video from this image"}
          >
            Make video
          </Button>
        )}
        <Button
          type="button"
          aria-label="Delete image node"
          variant="secondary"
          size="sm"
          className={NODE_TOOL_BUTTON_CLASS}
          disabled={writeLock.locked}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onDelete?.(); }}
          title={writeLock.locked ? writeLock.reason : "Delete image node"}
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
                d.onEvolve?.(id, text, evolveShape);
              }}
            >
              {/* #840 车4:迁到 ui/Input。覆盖的四项都是组件默认值与这条紧凑 bar 的冲突 ——
                  `h-auto` 压回 `h-11`(44px 会把 6px 内距的 bar 撑成两倍高)、`w-auto` 压回
                  `w-full`(它是 flex:1 的项,width:100% 会挤爆整行)、`p-0` 压回 `px-3.5 py-2`
                  (preflight 已把原生 input 内距清零,原来就是 0)、`shadow-none` 压回
                  `shadow-xs`。边框/背景/字体在下面那份 inline style 里,inline 赢过表里规则,
                  一字未动;新落到屏幕上的只有 focus-visible 的焦点环与 placeholder 配色。 */}
              <Input
                value={evolvePrompt}
                onChange={(e) => setEvolvePrompt(e.target.value)}
                placeholder="Change the wording, then send to make a new take…"
                aria-label="Edit this image's prompt and make a new image"
                className="nodrag nopan h-auto w-auto rounded-none p-0 shadow-none"
                onPointerDown={(e) => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", font: "inherit" }}
              />
              {/* #643 T2: same shape as this card unless the merchant picks another one. What is
                  on screen here is exactly what the next paid image will be made in. */}
              {d.imageShapeOptions && evolveShape && (
                <div className="nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
                  <ImageShapePicker
                    compact
                    value={evolveShape}
                    options={d.imageShapeOptions}
                    onChange={setEvolveShape}
                    title="The shape the new image will be made in — same cost in every shape"
                  />
                </div>
              )}
              <Button
                type="submit"
                aria-label="Make a new image from this edited prompt"
                variant="default"
                size="sm"
                className="nodrag nopan h-auto px-[13px] py-1.5 text-[12.5px] shadow-none"
                disabled={!evolvePrompt.trim()}
              >
                →
              </Button>
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
        {/* The A/B letter, read off the recorded batch position and nothing else — dragging B
            above A does not swap them, because a coordinate never said which one this is
            (#603 T4 · #605 T6). Only a press that really made two has an A and a B. */}
        {letter && <span className="cv-nodeletter">{letter}</span>}
      </span>
    {/* The picture is a picture, not a button: clicking it picks the card up and nothing else
        (#604 · spec #599 D6). Everything the card can DO lives on its toolbar above. */}
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
