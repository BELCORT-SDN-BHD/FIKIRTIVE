// apps/web/components/canvas/nodes/TextNode.tsx
import { useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { NodeResize } from "./NodeResize";

export function TextNode({ data, selected }: NodeProps) {
  const d = data as { text?: string; skin?: string; onChange?: (t: string) => void; onDelete?: () => void };
  const [val, setVal] = useState(d.text ?? "");
  return (
    <>
      <NodeResize gb={d.skin === "gb"} selected={selected} />
      <span className="cv-nodelabel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 7V5h16v2" /><path d="M9 19h6" /><path d="M12 5v14" /></svg>
        Text
      </span>
    {/* Card body is draggable; only the textarea + delete button opt out of drag
        (nodrag) so typing/selecting text and clicking ✕ don't move the node. */}
    <div className="al-panel" style={{ width: "100%", height: "100%", padding: "11px 12px", borderRadius: 14 }}>
      <textarea
        className="nodrag"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => d.onChange?.(val)}
        placeholder="Type here…"
        style={{ width: "100%", height: "100%", border: "none", background: "transparent", resize: "none", outline: "none", fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}
      />
      <button className="al-btn al-btn-glass al-btn-sm nodrag cv-node-actions" style={{ position: "absolute", top: 6, right: 6 }} onClick={d.onDelete}>✕</button>
    </div>
    </>
  );
}
