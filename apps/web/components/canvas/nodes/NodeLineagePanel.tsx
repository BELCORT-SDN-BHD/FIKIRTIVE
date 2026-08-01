// apps/web/components/canvas/nodes/NodeLineagePanel.tsx
//
// "Where did this card come from?" — the panel behind a card's Info button.
//
// A canvas card used to keep only its prompt, so a merchant could not tell when it was made,
// with what settings, what it cost, or which card it came from (#547 B4 · founder rule
// 每个东西都要有迹可循). Display only: it renders the lineage the server already read and
// never asks for anything. It never names the generation engine.
import { useState } from "react";
import { canvasLineageRows, type CanvasNodeLineage } from "@/lib/canvas-lineage";

export function NodeLineagePanel({
  lineage,
  prompt,
  hasSource = false,
}: {
  lineage: CanvasNodeLineage | null | undefined;
  prompt?: string | null;
  hasSource?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const rows = lineage ? canvasLineageRows(lineage, { hasSource }) : [];
  const text = (prompt ?? "").trim();

  const copyPrompt = () => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  };

  return (
    <div
      className="nodrag nopan"
      style={{
        width: 280,
        maxWidth: "80vw",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--card)",
        color: "var(--foreground)",
        boxShadow: "0 8px 24px rgba(20, 20, 24, 0.14)",
        textAlign: "left",
      }}
    >
      {text && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)" }}>Prompt</span>
            <button
              type="button"
              className="al-btn al-btn-sm nodrag nopan"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); copyPrompt(); }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.45, margin: 0, maxHeight: 96, overflowY: "auto" }}>{text}</p>
        </div>
      )}
      {rows.length > 0 ? (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", margin: 0, fontSize: 12 }}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: "contents" }}>
              <dt style={{ color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{row.label}</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          No generation record for this card.
        </span>
      )}
    </div>
  );
}
