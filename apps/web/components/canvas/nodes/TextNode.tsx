// apps/web/components/canvas/nodes/TextNode.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { NodeResize } from "./NodeResize";
import { getCanvasNodeWriteLock } from "@/lib/canvas-node-lock";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NODE_TOOL_BUTTON_CLASS } from "./node-tool-button";

export function TextNode({ data, selected }: NodeProps) {
  const d = data as {
    text?: string;
    skin?: string;
    onChange?: (t: string) => void;
    onDelete?: () => void;
    directToolsLocked?: boolean;
    directToolsLockedReason?: string;
  };
  const writeLock = getCanvasNodeWriteLock(d);
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
    if (writeLock.locked) return;
    setVal(next);
    latestRef.current = next;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flush();
    }, 350);
  }, [flush, writeLock.locked]);

  return (
    <>
      <NodeResize gb={d.skin === "gb"} selected={selected} locked={writeLock.locked} />
      <NodeToolbar
        className="cv-node-toolbar nodrag nopan"
        isVisible={selected}
        position={Position.Top}
        align="start"
        offset={22}
        style={{ pointerEvents: "all", zIndex: 50 }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Delete text node"
          className={NODE_TOOL_BUTTON_CLASS}
          disabled={writeLock.locked}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!writeLock.locked) d.onDelete?.(); }}
          title={writeLock.locked ? writeLock.reason : "Delete text node"}
        >
          ✕
        </Button>
      </NodeToolbar>
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 7V5h16v2" /><path d="M9 19h6" /><path d="M12 5v14" /></svg>
        Text
      </span>
    {/* Card body is draggable; only the textarea + delete button opt out of drag/pan. */}
    <div className="al-panel" style={{ width: "100%", height: "100%", padding: "11px 12px", borderRadius: 14 }}>
      {/* #840 车4:迁到 ui/Textarea。四条覆盖都是为了不动原样子 —— `field-sizing-fixed`
          压回组件默认的 `field-sizing-content`(否则这个 height:100% 的定高框会随内容
          自己长高,顶开卡片,同 #920 对四处 composer 的处置)、`min-h-0` 压回 `min-h-16`、
          `p-0` 压回 `px-3 py-2`(preflight 已把原生 textarea 的内距清零,原来就是 0)、
          `shadow-none` 压回 `shadow-xs`。其余(边框/背景/字号/行高/resize/outline)都在
          下面那份 inline style 里,inline 天然赢过任何表里的规则,一字未动。 */}
      <Textarea
        className="nodrag nopan field-sizing-fixed min-h-0 p-0 shadow-none"
        // #739 — the node's visible "Text" label is not associated with this box, and the
        // placeholder disappears as soon as the merchant types.
        aria-label="Text note"
        onPointerDown={(e) => e.stopPropagation()}
        value={val}
        onChange={(e) => update(e.target.value)}
        onBlur={flush}
        readOnly={writeLock.locked}
        aria-readonly={writeLock.locked}
        title={writeLock.locked ? writeLock.reason : undefined}
        placeholder="Type here…"
        style={{ width: "100%", height: "100%", border: "none", background: "transparent", resize: "none", outline: "none", fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}
      />
    </div>
    </>
  );
}
