"use client";
/** Canvas surface (Artlio Studio design) — infinite freeform board. Mock.
 *  (Note: Canvas was deprioritized; kept as a nav slot pending the founder's
 *  call. Built as a faithful placeholder.) */
import { Button } from "@/components/ds";

const TOOLS = ["▱", "✋", "T", "▢", "▣"]; // cursor / hand / text / frame / image

export function Canvas() {
  return (
    <>
      <div className="screen" style={{ position: "relative" }}>
        {/* floating toolbar */}
        <div style={{
          position: "absolute", top: 14, left: 18, display: "flex", gap: 2, padding: 4,
          background: "var(--glass-1)", border: "1px solid var(--line-1)", borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-glass)", zIndex: 5,
        }}>
          {TOOLS.map((t, i) => (
            <button key={i} className="al-iconbtn al-iconbtn-md" aria-label={`tool ${i}`} style={{ fontSize: 13 }}>{t}</button>
          ))}
        </div>
        <div style={{
          position: "absolute", top: 14, right: 18, display: "flex", alignItems: "center", gap: 8, padding: "5px 10px",
          background: "var(--glass-1)", border: "1px solid var(--line-1)", borderRadius: "var(--radius-md)", zIndex: 5,
          font: "var(--text-mono-meta)", color: "var(--fg-2)",
        }}>
          − 100% +
        </div>

        <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span aria-hidden style={{ width: 210, height: 130, borderRadius: "var(--radius-lg)", background: "var(--glass-1)", border: "1px solid var(--line-2)", marginBottom: 20 }} />
            <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Loose ideas live here</h1>
            <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 0" }}>
              Generate, arrange, and compare without limits.
            </p>
          </div>
        </div>
      </div>

      <div className="composer-dock">
        <div className="al-promptbar">
          <div className="al-input-wrap" style={{ border: "none", background: "none", padding: 0 }}>
            <input placeholder="Describe the shot — subject, camera, light…" aria-label="Describe the shot" />
          </div>
          <div className="al-promptbar-row">
            <button className="al-chip al-chip-mono">Aperture 2</button>
            <button className="al-chip al-chip-mono">16:9</button>
            <button className="al-chip al-chip-mono">Text to image ▾</button>
            <span className="al-promptbar-spacer" />
            <Button>Generate</Button>
          </div>
        </div>
      </div>
    </>
  );
}
