"use client";
/**
 * Gen space surface (Artlio Studio design) — the LTX-style generation canvas.
 * Mock-first: presets + a docked prompt bar (model / aspect / resolution /
 * batch chips + Photo·Video seg + Generate). Engine wires in a later slice.
 */
import { useState } from "react";
import { Button } from "@/components/ds";

const PRESETS = [
  { title: "Figure on a salt flat at dawn", tint: "linear-gradient(135deg,#2a2336,#3a2f55)" },
  { title: "Macro perfume still life", tint: "linear-gradient(135deg,#2f1f22,#52323a)" },
  { title: "Night market in rain", tint: "linear-gradient(135deg,#1d2730,#2f4150)" },
];

export function GenSpace() {
  const [mode, setMode] = useState<"photo" | "video">("photo");

  return (
    <>
      <div className="screen">
        <div className="screen-pad" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
          <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", padding: "40px 0" }}>
            <div>
              <h1 style={{ font: "var(--text-display)", letterSpacing: "var(--tracking-display)", color: "var(--fg-1)", margin: 0 }}>
                Start with some image storming
              </h1>
              <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "8px 0 32px" }}>
                Try one of the presets, or describe a shot below.
              </p>
              <div className="scene-grid" style={{ maxWidth: 760, margin: "0 auto" }}>
                {PRESETS.map((p) => (
                  <button key={p.title} className="al-mediacard" style={{ textAlign: "left" }}>
                    <span style={{ display: "block", aspectRatio: "16 / 10", background: p.tint }} />
                    <span style={{ padding: "10px 12px 12px", display: "block" }}>
                      <span style={{ display: "block", font: "var(--text-body)", color: "var(--fg-1)" }}>{p.title}</span>
                      <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>PRESET</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
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
            <button className="al-chip al-chip-mono">1K</button>
            <button className="al-chip al-chip-mono">3×</button>
            <div className="al-seg" role="tablist">
              <button role="tab" aria-selected={mode === "photo"}
                className={`al-seg-item${mode === "photo" ? " al-seg-item-active" : ""}`} onClick={() => setMode("photo")}>
                Photo
              </button>
              <button role="tab" aria-selected={mode === "video"}
                className={`al-seg-item${mode === "video" ? " al-seg-item-active" : ""}`} onClick={() => setMode("video")}>
                Video
              </button>
            </div>
            <span className="al-promptbar-spacer" />
            <Button>Generate</Button>
          </div>
        </div>
      </div>
    </>
  );
}
