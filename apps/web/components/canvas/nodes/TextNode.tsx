// apps/web/components/canvas/nodes/TextNode.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { CANVAS_NODE_TOOLBAR_OFFSET } from "@/lib/canvas-fit-padding";
import { Trash2Icon } from "lucide-react";
import { NodeResize } from "./NodeResize";
import { CanvasNodeLabel } from "./CanvasNodeLabel";
import { NodeToolbarIconButton } from "./NodeToolbarIconButton";
import { ButtonGroup } from "@/components/ui/button-group";
import { Textarea } from "@/components/ui/textarea";

export function TextNode({ data, selected }: NodeProps) {
  const d = data as {
    text?: string;
    skin?: string;
    onChange?: (t: string) => void;
    onDelete?: () => void;
  };
  const [val, setVal] = useState(d.text ?? "");
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
    savedRef.current = next;
    onChangeRef.current?.(next);
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
      {/* Card body is draggable; only the textarea + delete button opt out of drag/pan. */}
      <div className="al-panel cv-node-frame cv-node-frame-text">
        {/* Fixed-size canvas note: keep Textarea semantics while letting the node own its geometry. */}
        <Textarea
          className="nodrag nopan field-sizing-fixed h-full min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-[13px] font-medium leading-[1.45] shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
          // #739 — the node's visible "Text" label is not associated with this box, and the
          // placeholder disappears as soon as the merchant types.
          aria-label="Text note"
          onPointerDown={(e) => e.stopPropagation()}
          value={val}
          onChange={(e) => update(e.target.value)}
          onBlur={flush}
          placeholder="Type here…"
        />
      </div>
    </>
  );
}
