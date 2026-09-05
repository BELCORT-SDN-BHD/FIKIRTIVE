// apps/web/components/canvas/nodes/TextNode.tsx
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { CANVAS_NODE_TOOLBAR_OFFSET } from "@/lib/canvas-fit-padding";
import { Trash2Icon } from "lucide-react";
import { NodeResize } from "./NodeResize";
import { CanvasNodeLabel } from "./CanvasNodeLabel";
import { NodeToolbarIconButton } from "./NodeToolbarIconButton";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Textarea } from "@/components/ui/textarea";

/**
 * What the board did with the words this card just handed it (接线盘点 L1 · FRONT-A12).
 *
 * The card does not author this — the board's `onTextChange` owns the server call, catches the
 * throw, and hands back either "it landed" or the server's own sentence. Keeping the shape here,
 * beside the only component that reads it, is what lets the card show a refusal it did not write:
 * no second copy of the wording, and no way for the card to invent one.
 */
export type CanvasTextSaveOutcome = { ok: true } | { error: string };

export function TextNode({ data, selected }: NodeProps) {
  const d = data as {
    text?: string;
    skin?: string;
    onChange?: (t: string) => void | Promise<CanvasTextSaveOutcome | void>;
    onDelete?: () => void;
  };
  const [val, setVal] = useState(d.text ?? "");
  /**
   * THE SAVE THAT DID NOT HAPPEN, said on the card itself.
   *
   * `onChange` has always been fire-and-forget: `void updateTextNode(...)` on the board's side, a
   * bare call here. So a merchant whose session had expired, or whose card had been removed in
   * another tab, typed a note, watched it sit on screen exactly as if it were stored, and lost it
   * at the next board read. Nothing on the screen was ever false — nothing on the screen said
   * anything at all, which for a save is the same claim made by omission.
   *
   * Two things follow from a refusal and both matter: the merchant is TOLD, and the words they
   * typed STAY. `val` is untouched here — the failure is reported beside the box, never by
   * reverting it — and `savedRef` is wound back to what the server last accepted, so the next
   * flush (the Try again button, another keystroke, blur, or unmount) sends the text again
   * instead of deciding it is already stored. Pressing retry IS the whole fix for this failure,
   * which is the one case the standing copy rule lets a control say so.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** One id per card — two text cards can both be failing, and each box names its own message. */
  const errorId = useId();
  const latestRef = useRef(val);
  const savedRef = useRef(d.text ?? "");
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(d.onChange);

  useEffect(() => {
    onChangeRef.current = d.onChange;
  }, [d.onChange]);

  const flush = useCallback(() => {
    const next = latestRef.current;
    if (next === savedRef.current) return;
    const lastAccepted = savedRef.current;
    savedRef.current = next;
    const outcome = onChangeRef.current?.(next);
    void Promise.resolve(outcome).then((settled) => {
      if (settled && typeof settled === "object" && "error" in settled) {
        // Put the mark back where the SERVER left it, not where this attempt hoped it would be.
        // Without this, the next flush compares the typed text against text that was never stored,
        // returns early, and the retry is a no-op that looks like a save.
        savedRef.current = lastAccepted;
        setSaveError(settled.error);
        return;
      }
      setSaveError(null);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      flush();
    };
  }, [flush]);

  useEffect(() => {
    const incoming = d.text ?? "";
    if (incoming === savedRef.current) return;
    if (latestRef.current === savedRef.current) {
      setVal(incoming);
      latestRef.current = incoming;
    }
    savedRef.current = incoming;
  }, [d.text]);

  const update = useCallback((next: string) => {
    setVal(next);
    latestRef.current = next;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flush();
    }, 350);
  }, [flush]);

  return (
    <>
      <NodeResize gb={d.skin === "gb"} selected={selected} />
      <NodeToolbar
        className="cv-node-toolbar nodrag nopan"
        isVisible={selected}
        position={Position.Top}
        align="start"
        offset={CANVAS_NODE_TOOLBAR_OFFSET}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ButtonGroup aria-label="Text actions" className="cv-node-action-group">
          <NodeToolbarIconButton
            type="button"
            label="Delete text node"
            visibleLabel="Delete"
            variant="destructive-secondary"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); d.onDelete?.(); }}
          >
            <Trash2Icon aria-hidden />
          </NodeToolbarIconButton>
        </ButtonGroup>
      </NodeToolbar>
      <CanvasNodeLabel kind="text" />
      {/* Card body is draggable; only the textarea + delete button opt out of drag/pan.
       *  A column, so the failure line below has somewhere to be: `.cv-node-frame` is a fixed
       *  100%-height box with `overflow: hidden`, and a sibling under a `h-full` textarea would be
       *  clipped away unread. The box still fills the card when nothing has failed — `flex-1` in a
       *  column of one is the same height `h-full` was. */}
      <div className="al-panel cv-node-frame cv-node-frame-text flex flex-col">
        {/* Fixed-size canvas note: keep Textarea semantics while letting the node own its geometry. */}
        <Textarea
          className="nodrag nopan field-sizing-fixed min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-[13px] font-medium leading-[1.45] shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
          // #739 — the node's visible "Text" label is not associated with this box, and the
          // placeholder disappears as soon as the merchant types.
          aria-label="Text note"
          onPointerDown={(e) => e.stopPropagation()}
          value={val}
          onChange={(e) => update(e.target.value)}
          onBlur={flush}
          placeholder="Type here…"
          aria-invalid={saveError ? true : undefined}
          aria-describedby={saveError ? errorId : undefined}
        />
        {saveError && (
          // Inside the card, under the words it is about. A toast at the corner of a board full of
          // cards cannot say WHICH note failed, and this failure is about one note. `nodrag nopan`
          // so pressing the button does not drag the card out from under the press.
          <div
            id={errorId}
            role="alert"
            className="nodrag nopan mt-1.5 flex shrink-0 items-center justify-between gap-2 text-[11px] leading-tight text-destructive"
          >
            <span className="min-w-0 flex-1 truncate" title={saveError}>{saveError}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="nodrag nopan"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); flush(); }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
