// apps/web/components/canvas/nodes/TextNode.tsx
import { useState } from "react";
import { type NodeProps } from "@xyflow/react";

export function TextNode({ data }: NodeProps) {
  const d = data as { text?: string; onChange?: (t: string) => void; onDelete?: () => void };
  const [val, setVal] = useState(d.text ?? "");
  return (
    <div className="al-panel nodrag" style={{ width: "100%", height: "100%", padding: 8, borderRadius: 12 }}>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => d.onChange?.(val)}
        placeholder="Type here…"
        style={{ width: "100%", height: "100%", border: "none", background: "transparent", resize: "none", outline: "none" }}
      />
      <button className="al-btn al-btn-glass al-btn-sm" style={{ position: "absolute", top: 6, right: 6 }} onClick={d.onDelete}>✕</button>
    </div>
  );
}
