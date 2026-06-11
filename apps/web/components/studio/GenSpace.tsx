"use client";
/**
 * Gen space surface (Artlio Studio + LTX gen-workspace). The generation
 * workbench: per-SESSION (a subject/shot), stacked iterations, a rich composer
 * (reference slots + mode + model/target + duration + resolution + aspect),
 * and a session list. Empty state = presets ("image storming").
 *
 * Artlio bindings: the model chip IS the Target (fal models + Artlio cowork);
 * cost shows before generate; failures never charge (pricing research).
 * Mock-first; engine wires later.
 */
import { useState } from "react";
import { Button, MonoLabel, IcPlus, IcImage, IcFilm } from "@/components/ds";

const SESSIONS = [
  { title: "Woman Drinking Coffee", ago: "2 minutes ago", tint: "linear-gradient(135deg,#3a2f2a,#5a4438)", active: true },
  { title: "Woman On Street", ago: "1 minute ago", tint: "linear-gradient(135deg,#2a2f3a,#3a4a5a)" },
];

const RESULTS = [
  { prompt: "Maria sips from the coffee", meta: "Seedream · Audio · 1080p · 25 fps", ago: "2m", dur: "00:08", tint: "linear-gradient(135deg,#3a2f2a,#6a5040)" },
  { prompt: "Maria sips from the coffee and cries", meta: "Kling video · Retake", ago: "1m", dur: "00:08", tint: "linear-gradient(135deg,#332a2e,#5a3a44)" },
];

export function GenSpace() {
  const [mode, setMode] = useState<"video" | "v2v">("video");

  return (
    <>
      <div className="screen" style={{ display: "flex", minHeight: 0 }}>
        {/* session workspace */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 28px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <Button variant="glass" size="sm">Shot navigator ▾</Button>
          </div>
          <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "10px 0 18px" }}>Woman Drinking Coffee</h1>

          {RESULTS.map((r, i) => (
            <div key={i} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
                <span style={{ color: "var(--fg-2)" }}>{r.prompt}</span>
                <span>· {r.meta}</span>
                <span style={{ flex: 1 }} />
                <span>{r.ago}</span>
                <span>↻ ✕</span>
              </div>
              <div style={{ position: "relative", width: 280, aspectRatio: "16 / 10", borderRadius: "var(--radius-md)", background: r.tint, border: "1px solid var(--line-2)" }}>
                <span style={{ position: "absolute", bottom: 7, left: 8, font: "var(--text-mono-meta)", color: "var(--fg-1)" }}>{r.dur}</span>
              </div>
            </div>
          ))}
        </div>

        {/* session list */}
        <aside style={{ width: 280, flex: "none", borderLeft: "1px solid var(--line-2)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <MonoLabel>Sessions</MonoLabel>
            <span style={{ flex: 1 }} />
            <button className="al-iconbtn al-iconbtn-md" aria-label="New session"><IcPlus size={16} /></button>
          </div>
          {SESSIONS.map((s) => (
            <button key={s.title} className={`al-mediacard${s.active ? "" : ""}`} style={{
              display: "flex", flexDirection: "row", alignItems: "center", gap: 10, padding: 8, cursor: "pointer",
              border: `1px solid ${s.active ? "rgba(255,255,255,.24)" : "var(--line-2)"}`,
            }}>
              <span aria-hidden style={{ width: 44, height: 32, borderRadius: 6, background: s.tint, flex: "none" }} />
              <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left", minWidth: 0 }}>
                <span style={{ font: "var(--text-small)", color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
                <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>{s.ago}</span>
              </span>
            </button>
          ))}
        </aside>
      </div>

      <div className="composer-dock">
        <div className="al-promptbar">
          {/* reference slots */}
          <div className="al-promptbar-row">
            <button className="al-iconbtn al-iconbtn-md" aria-label="Add image reference"><IcImage size={16} /></button>
            <button className="al-iconbtn al-iconbtn-md" aria-label="Add video reference"><IcFilm size={16} /></button>
            <button className="al-iconbtn al-iconbtn-md" aria-label="Add control reference"><IcPlus size={16} /></button>
            <span className="al-promptbar-spacer" />
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>~12 CR</span>
          </div>
          <div className="al-input-wrap" style={{ border: "none", background: "none", padding: 0 }}>
            <input placeholder="Describe the shot — subject, camera, light…" aria-label="Describe the shot" defaultValue="Maria sips from the coffee" />
          </div>
          <div className="al-promptbar-row">
            <div className="al-seg" role="tablist">
              <button role="tab" aria-selected={mode === "video"} className={`al-seg-item${mode === "video" ? " al-seg-item-active" : ""}`} onClick={() => setMode("video")}>Video</button>
              <button role="tab" aria-selected={mode === "v2v"} className={`al-seg-item${mode === "v2v" ? " al-seg-item-active" : ""}`} onClick={() => setMode("v2v")}>Video to Video</button>
            </div>
            <button className="al-chip al-chip-mono">Kling video ▾</button>
            <button className="al-chip al-chip-mono">8 Sec</button>
            <button className="al-chip al-chip-mono">1080p</button>
            <button className="al-chip al-chip-mono">16:9</button>
            <button className="al-chip al-chip-mono">More ▾</button>
            <span className="al-promptbar-spacer" />
            <Button>Generate</Button>
          </div>
        </div>
      </div>
    </>
  );
}
