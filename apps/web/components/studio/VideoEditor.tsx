"use client";
/** Video editor surface (Artlio Studio design) — timeline + transitions.
 *  Mock visual; the real editor (Shotstack + ffmpeg render) wires later.
 *  Note: shipped boundary is fades only — the extra transitions here are the
 *  design's aspiration, gated at build time. */
import { Button, MonoLabel } from "@/components/ds";

const RAIL = ["▤", "♪", "⇄"]; // media / audio / transitions
const TRANSITIONS = ["None", "Fade", "Slide", "Wipe", "Flip", "Clock wipe", "Iris"];

export function VideoEditor() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* left rail */}
        <div style={{ width: 46, borderRight: "1px solid var(--line-2)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 0" }}>
          {RAIL.map((t, i) => (
            <button key={i} className={`al-iconbtn al-iconbtn-md${i === 2 ? " active" : ""}`} aria-label={`rail ${i}`} style={{ fontSize: 14 }}>{t}</button>
          ))}
        </div>

        {/* transitions panel */}
        <div style={{ width: 250, borderRight: "1px solid var(--line-2)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <MonoLabel>Transitions</MonoLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {TRANSITIONS.map((t, i) => (
              <button key={t} style={{
                display: "flex", flexDirection: "column", gap: 5, alignItems: "center", cursor: "pointer",
                background: "none", border: "none", color: "var(--fg-2)",
              }}>
                <span aria-hidden style={{
                  width: "100%", aspectRatio: "1 / 1", borderRadius: "var(--radius-md)",
                  background: i === 1 ? "var(--glass-2)" : "var(--glass-1)",
                  border: `1px solid ${i === 1 ? "rgba(255,255,255,.28)" : "var(--line-2)"}`,
                }} />
                <span style={{ font: "var(--text-caption)" }}>{t}</span>
              </button>
            ))}
          </div>
          <button style={{ font: "var(--text-caption)", color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer", textAlign: "center", marginTop: 4 }}>
            Clear all transitions
          </button>
        </div>

        {/* canvas / empty */}
        <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span aria-hidden style={{ width: 200, height: 120, borderRadius: "var(--radius-lg)", background: "var(--glass-1)", border: "1px solid var(--line-2)", marginBottom: 18 }} />
            <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Cut your first sequence</h1>
            <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 18px" }}>
              Add a clip, or insert media from the left.
            </p>
            <Button>Add clip</Button>
          </div>
        </div>
      </div>

      {/* timeline */}
      <div style={{ borderTop: "1px solid var(--line-2)", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10, minHeight: 130 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
          <button className="al-iconbtn al-iconbtn-md" aria-label="Play">▶</button>
          <span>00 : 00 : 00 / 00 : 00 : 00</span>
          <span style={{ flex: 1 }} />
          <Button variant="glass" size="sm">Add clip</Button>
        </div>
        <div style={{ flex: 1, display: "grid", placeItems: "center", border: "1px dashed var(--line-2)", borderRadius: "var(--radius-md)", font: "var(--text-caption)", color: "var(--fg-3)" }}>
          The timeline is empty.
        </div>
      </div>
    </div>
  );
}
