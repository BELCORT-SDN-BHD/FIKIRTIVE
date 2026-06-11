"use client";
/** Storyboard surface (Artlio Studio design) — script/logline → shot plan.
 *  Mock. Artlio's safe-core build (beats → shot placeholders, no auto-cast,
 *  planning is free) wires later. */
import { Button, Chip, MonoLabel } from "@/components/ds";

export function Storyboard() {
  return (
    <div className="screen">
      <div className="screen-pad" style={{ maxWidth: 920 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26, margin: "14px 0 28px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <MonoLabel>Aspect ratio</MonoLabel>
            <Chip>▭ 16:9 ▾</Chip>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <MonoLabel>Model</MonoLabel>
            <Chip>Aperture 2 ▾</Chip>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <MonoLabel>Style</MonoLabel>
            <Chip>No style ▾</Chip>
          </label>
        </div>

        <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "0 0 14px", textAlign: "center" }}>
          Start with your story
        </h1>
        <textarea
          placeholder="Paste a script, a logline, or a few beats — anything that sparks the film…"
          rows={6}
          aria-label="Story input"
          style={{
            width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)",
            borderRadius: "var(--radius-md)", padding: "14px 16px", color: "var(--fg-1)",
            font: "var(--text-body)", resize: "vertical", outline: "none",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, font: "var(--text-small)", color: "var(--fg-3)" }}>
            <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: "var(--glass-1)", border: "1px solid var(--line-2)" }} />
            Drag a script file here, or <span style={{ color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>upload a file</span>
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="glass">Blank storyboard</Button>
          <Button>Build storyboard</Button>
        </div>
      </div>
    </div>
  );
}
