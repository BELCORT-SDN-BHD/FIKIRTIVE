// apps/web/components/canvas/nodes/TextNode.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { NodeResize } from "./NodeResize";

export function TextNode({ data, selected }: NodeProps) {
  const d = data as { text?: string; skin?: string; onChange?: (t: string) => void; onDelete?: () => void };
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
        offset={22}
        style={{ pointerEvents: "all", zIndex: 50 }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Delete text node"
          className="al-btn al-btn-glass al-btn-sm nodrag nopan"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); d.onDelete?.(); }}
        >
          ✕
        </button>
      </NodeToolbar>
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 7V5h16v2" /><path d="M9 19h6" /><path d="M12 5v14" /></svg>
        Text
      </span>
    {/* Card body is draggable; only the textarea + delete button opt out of drag/pan. */}
    <div className="al-panel" style={{ width: "100%", height: "100%", padding: "11px 12px", borderRadius: 14 }}>
      <textarea
        className="nodrag nopan"
        onPointerDown={(e) => e.stopPropagation()}
        value={val}
        onChange={(e) => update(e.target.value)}
        onBlur={flush}
        placeholder="Type here…"
        style={{ width: "100%", height: "100%", border: "none", background: "transparent", resize: "none", outline: "none", fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}
      />
    </div>
    </>
  );
}
