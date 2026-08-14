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
import { Button } from "@/components/ui/button";

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
            {/* #840 车4:`al-btn al-btn-sm`(无配色修饰)= 透明底、透明边、继承文字色的小键
                → ghost 变体同一套;高度/内距/字号显式压回 al-btn-sm 的原值(圆角天生同值:
                --radius-sm 与 Button 的 rounded-[10px] 都是 10px)。ghost 的 hover 底色是
                新增的反馈,原来没有 —— 与第一车对同类键的处置同口径,算打磨。 */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="nodrag nopan h-auto px-[13px] py-1.5 text-[12.5px]"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); copyPrompt(); }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
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
