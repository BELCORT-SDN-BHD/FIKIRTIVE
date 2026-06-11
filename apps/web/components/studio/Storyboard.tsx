"use client";
/**
 * Storyboard surface (Artlio Studio design) — the project SPINE, modeled on
 * LTX: Scenes → Shots, each shot = prompt (@mentions) + keyframe + actions.
 *
 * Artlio's safe-core (storyboard research): the PLANNING layer is FREE — beats
 * → shot placeholders, explicit/validated @binding, NO auto-cast. Only the
 * per-shot generate actions ("Create image / Generate video") spend credits.
 * Mock-first; engine + the script→beats parse wire later.
 */
import { useState } from "react";
import { Button, Chip, MonoLabel, IcPlus, IcRetry, IcPlay, IcSparkle, IcChevronDown, IcFilm } from "@/components/ds";

const Caret = () => <IcChevronDown size={13} style={{ marginLeft: 2, color: "var(--fg-3)" }} />;

type Shot = { n: number; prompt: React.ReactNode; hasImage?: boolean; tint?: string };
type Scene = { title: string; shots: Shot[] };

// @mention chip (mock — colored like an entity reference)
const At = ({ name, hue }: { name: string; hue: string }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 6,
    background: `color-mix(in srgb, ${hue} 22%, transparent)`, color: hue, font: "inherit",
  }}>@{name}</span>
);

const MOCK: Scene[] = [
  {
    title: "Scene 1 · The café",
    shots: [
      { n: 1, prompt: <><At name="Maria" hue="var(--hue-character)" /> sips coffee by the window</>, hasImage: true, tint: "linear-gradient(135deg,#3a2f2a,#5a4438)" },
      { n: 2, prompt: <>she sets the cup down, looks up</>, hasImage: true, tint: "linear-gradient(135deg,#2f2a3a,#473a5a)" },
      { n: 3, prompt: <>close on <At name="Maria" hue="var(--hue-character)" />, a slow smile</> },
    ],
  },
  {
    title: "Scene 2 · The street",
    shots: [
      { n: 1, prompt: <><At name="Maria" hue="var(--hue-character)" /> walks through the sunlit meadow</> },
    ],
  },
];

function ShotCard({ shot }: { shot: Shot }) {
  return (
    <div className="al-mediacard" style={{ width: 232, flex: "none", cursor: "default" }}>
      <div style={{ position: "relative", aspectRatio: "16 / 10", background: shot.tint ?? "var(--glass-1)" }}>
        <span style={{ position: "absolute", top: 8, left: 8, display: "inline-flex", alignItems: "center", gap: 5, font: "var(--text-mono-meta)", color: "var(--fg-2)" }}>
          <IcFilm size={12} />{shot.n}
        </span>
        <button style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
          className="al-chip al-chip-mono" aria-label="Retry"><IcRetry size={13} />Retry</button>
        {shot.hasImage && (
          <span aria-hidden style={{ position: "absolute", bottom: 7, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--fg-1)" }} />
            <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--fg-3)" }} />
          </span>
        )}
      </div>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {shot.hasImage ? (
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="sm" full icon={<IcSparkle size={13} />}>Edit</Button>
            <Button size="sm" variant="glass" full icon={<IcPlay size={12} />}>Video</Button>
          </div>
        ) : (
          <Button size="sm" variant="glass" full icon={<IcSparkle size={13} />}>Create in Gen space</Button>
        )}
        <p style={{ font: "var(--text-small)", color: "var(--fg-2)", margin: 0, lineHeight: 1.4 }}>{shot.prompt}</p>
      </div>
    </div>
  );
}

function SceneBlock({ scene }: { scene: Scene }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <MonoLabel>{scene.title}</MonoLabel>
        <span style={{ flex: 1 }} />
        <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>delete · play · send to editor</span>
      </div>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
        {scene.shots.map((s) => <ShotCard key={s.n} shot={s} />)}
        <button className="drop-zone" style={{ width: 48, flex: "none", alignSelf: "stretch", minHeight: 150 }} aria-label="Add shot">
          <IcPlus size={18} />
        </button>
      </div>
    </section>
  );
}

export function Storyboard() {
  const [built, setBuilt] = useState(false);

  if (!built) {
    return (
      <div className="screen">
        <div className="screen-pad" style={{ maxWidth: 920 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26, margin: "14px 0 28px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <MonoLabel>Aspect ratio</MonoLabel><Chip>16:9<Caret /></Chip>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <MonoLabel>Model</MonoLabel><Chip>Aperture 2<Caret /></Chip>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <MonoLabel>Style</MonoLabel><Chip>No style<Caret /></Chip>
            </label>
          </div>
          <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "0 0 14px", textAlign: "center" }}>Start with your story</h1>
          <textarea placeholder="Paste a script, a logline, or a few beats — anything that sparks the film…" rows={6} aria-label="Story input"
            style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-md)", padding: "14px 16px", color: "var(--fg-1)", font: "var(--text-body)", resize: "vertical", outline: "none" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10, font: "var(--text-small)", color: "var(--fg-3)" }}>
              <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: "var(--glass-1)", border: "1px solid var(--line-2)" }} />
              Drag a script file here, or <span style={{ color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>upload a file</span>
            </span>
            <span style={{ flex: 1 }} />
            <Button variant="glass" onClick={() => setBuilt(true)}>Blank storyboard</Button>
            <Button onClick={() => setBuilt(true)}>Build storyboard</Button>
          </div>
          <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: "16px 0 0", textAlign: "center" }}>
            Planning is free — shots and @mentions cost nothing. You only spend when you generate an image or video.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 20px" }}>
          <Chip>16:9<Caret /></Chip>
          <Chip>Aperture 2<Caret /></Chip>
          <span style={{ flex: 1 }} />
          <Button variant="glass" size="sm" onClick={() => setBuilt(false)}>← Story</Button>
          <Button size="sm" icon={<IcPlus />}>Add scene</Button>
        </div>
        {MOCK.map((s) => <SceneBlock key={s.title} scene={s} />)}
      </div>
    </div>
  );
}
