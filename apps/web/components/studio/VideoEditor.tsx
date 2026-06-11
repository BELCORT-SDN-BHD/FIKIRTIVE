"use client";
/**
 * Video editor surface (Artlio Studio + LTX timeline). My-assets panel
 * (generated clips) + the connective tissue "Import Storyboard" (pulls the
 * storyboard's shots onto the timeline) + the timeline itself.
 *
 * Artlio boundary (ratified): 1 visual track + ≤2 audio, fades only — the
 * design's blend modes / extra transitions are gated at build time. The real
 * editor (Shotstack + ffmpeg render) wires in behind this shell. Mock-first.
 */
import { useState } from "react";
import { Button, MonoLabel, IcImage, IcFilm, IcChevronDown, IcExport, IcPlay } from "@/components/ds";

const RAIL = [
  { key: "media", label: "Media", Icon: IcImage },
  { key: "audio", label: "Audio", Icon: IcFilm },
  { key: "transitions", label: "Transitions", Icon: IcFilm },
] as const;

const ASSETS = [
  "linear-gradient(135deg,#3a2f2a,#5a4438)",
  "linear-gradient(135deg,#2f2a3a,#473a5a)",
];

export function VideoEditor() {
  const [tab, setTab] = useState<"media" | "audio" | "transitions">("media");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* left rail */}
        <div style={{ width: 46, borderRight: "1px solid var(--line-2)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 0" }}>
          {RAIL.map(({ key, label, Icon }) => (
            <button key={key} className={`al-iconbtn al-iconbtn-md${tab === key ? " active" : ""}`} aria-label={label} onClick={() => setTab(key)}>
              <Icon size={16} />
            </button>
          ))}
        </div>

        {/* assets panel */}
        <div style={{ width: 250, borderRight: "1px solid var(--line-2)", padding: 16, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <MonoLabel>My assets</MonoLabel>
            <span style={{ flex: 1 }} />
            <span style={{ display: "inline-flex", alignItems: "center", font: "var(--text-caption)", color: "var(--fg-3)" }}>All projects<IcChevronDown size={12} style={{ marginLeft: 2 }} /></span>
          </div>
          {tab === "transitions" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {["None", "Fade"].map((t, i) => (
                <button key={t} style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center", background: "none", border: "none", color: "var(--fg-2)", cursor: "pointer" }}>
                  <span aria-hidden style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: "var(--radius-md)", background: i === 1 ? "var(--glass-2)" : "var(--glass-1)", border: "1px solid var(--line-2)" }} />
                  <span style={{ font: "var(--text-caption)" }}>{t}</span>
                </button>
              ))}
              <span style={{ gridColumn: "1 / -1", font: "var(--text-caption)", color: "var(--fg-3)" }}>Fades only — the ratified boundary.</span>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {ASSETS.map((tint, i) => (
                  <span key={i} aria-hidden style={{ aspectRatio: "16 / 10", borderRadius: "var(--radius-md)", background: tint, border: "1px solid var(--line-2)" }} />
                ))}
              </div>
              <span style={{ flex: 1 }} />
              <Button variant="glass" full icon={<IcExport size={14} />}>Upload</Button>
            </>
          )}
        </div>

        {/* canvas / empty — the connective tissue */}
        <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span aria-hidden style={{ width: 220, height: 80, borderRadius: "var(--radius-lg)", background: "var(--glass-1)", border: "1px solid var(--line-2)", marginBottom: 22 }} />
            <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Let’s start editing</h1>
            <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 18px", maxWidth: 360 }}>
              Import shots from your Storyboard, or insert assets from the left.
            </p>
            <Button>Import Storyboard</Button>
          </div>
        </div>
      </div>

      {/* timeline */}
      <div style={{ borderTop: "1px solid var(--line-2)", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10, minHeight: 120 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
          <button className="al-iconbtn al-iconbtn-md" aria-label="Play"><IcPlay size={13} /></button>
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
