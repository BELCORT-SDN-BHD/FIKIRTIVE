"use client";
/**
 * Storyboard surface — WIRED. The project spine: real Shots rendered as cards,
 * each with a prompt + its latest generation + per-shot "Generate" (the gen
 * pipeline, shotId-bound → the shot's render). Planning (add shot, edit
 * prompt) is free; only Generate spends. No auto-cast — the user writes each
 * shot. Engine reused: addShot / setShotPromptText / startGen / getGenJob.
 */
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, MonoLabel, IcPlus, IcRetry, IcSparkle, IcPlay, IcX, IcChevronDown } from "@/components/ds";
import { addShot, setShotPromptText, deleteShot, moveShot, addScene } from "@/lib/studio-actions";
import { coworkDraftStoryboard } from "@/lib/cowork-actions";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { GEN_PRICE_USD_PER_IMAGE, GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_INFO, type GenVideoModel } from "@artlio/core";
import { CAMERA_PRESETS } from "./camera";

/** cost hint shown before a spend (small figures keep 3 decimals so $0.035
 *  isn't rounded up to $0.04). */
const usd = (n: number) => "~$" + (n < 0.1 ? n.toFixed(3) : n.toFixed(2));

export type StudioShot = {
  id: string;
  number: number; // within-scene display index (1..N)
  scene: number;
  prompt: string;
  entityIds: string[];
  imageUrl: string | null;
  videoUrl: string | null;
};

function ShotCard({ projectId, shot, index, total }: { projectId: string; shot: StudioShot; index: number; total: number }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(shot.prompt);
  const [camera, setCamera] = useState(""); // camera-motion preset for Animate
  const [videoModel, setVideoModel] = useState<GenVideoModel>("kling"); // Animate model: Kling (silent) | Veo 3 Fast (sound)
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false); // delete / reorder in flight
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  function remove() {
    if (acting || busy) return;
    setActing(true);
    (async () => {
      const res = await deleteShot(shot.id);
      if (res && "error" in res) { setError(res.error); setActing(false); return; }
      router.refresh(); // card unmounts on success
    })();
  }
  function move(dir: "left" | "right") {
    if (acting || busy) return;
    setActing(true);
    (async () => { await moveShot(shot.id, dir); setActing(false); router.refresh(); })();
  }

  function saveText() {
    if (prompt !== shot.prompt) setShotPromptText(shot.id, prompt, shot.entityIds);
  }

  function run(kind: "image" | "video") {
    const text = prompt.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    (async () => {
      await setShotPromptText(shot.id, text, shot.entityIds);
      const fullPrompt = kind === "video" && camera ? `${text}, ${camera}` : text; // camera motion → prompt
      const res = await startGen({ projectId, shotId: shot.id, prompt: fullPrompt, entityIds: shot.entityIds, count: 1, kind, model: kind === "video" ? videoModel : "seedream" });
      if ("error" in res) { setError(res.error); setBusy(false); return; }
      poll.current = setInterval(async () => {
        const job = await getGenJob(res.id);
        if (!job) return;
        if (job.status === "DONE") { if (poll.current) clearInterval(poll.current); setBusy(false); router.refresh(); }
        else if (job.status === "FAILED") { if (poll.current) clearInterval(poll.current); setBusy(false); setError(job.error || "Generation failed."); }
      }, 2000);
    })();
  }

  return (
    <div className="al-mediacard" style={{ width: 240, flex: "none", cursor: "default" }}>
      <div style={{ position: "relative", aspectRatio: "16 / 10", background: (shot.imageUrl || shot.videoUrl) ? "#000" : "var(--glass-1)" }}>
        <span style={{ position: "absolute", top: 8, left: 8, font: "var(--text-mono-meta)", color: "var(--fg-2)", zIndex: 2 }}>▦ {shot.number}</span>
        {shot.videoUrl ? (
          <video src={shot.videoUrl} muted loop autoPlay playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : shot.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.imageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
        {shot.videoUrl && <span style={{ position: "absolute", top: 8, right: 8, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "rgba(6,8,11,.6)", padding: "1px 6px", borderRadius: 4, zIndex: 2 }}>▶ video</span>}
        {busy && (
          <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(6,8,11,.55)", font: "var(--text-caption)", color: "var(--fg-2)" }}>generating…</span>
        )}
      </div>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button className="al-iconbtn al-iconbtn-sm" aria-label="Move shot earlier" disabled={acting || busy || index === 0} onClick={() => move("left")}>
            <IcChevronDown size={12} style={{ transform: "rotate(90deg)" }} />
          </button>
          <button className="al-iconbtn al-iconbtn-sm" aria-label="Move shot later" disabled={acting || busy || index === total - 1} onClick={() => move("right")}>
            <IcChevronDown size={12} style={{ transform: "rotate(-90deg)" }} />
          </button>
          <span style={{ flex: 1 }} />
          <button className="al-iconbtn al-iconbtn-sm" aria-label="Delete shot" disabled={acting || busy} onClick={remove}>
            <IcX size={12} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" full disabled={busy || acting || prompt.trim().length === 0} onClick={() => run("image")}
            icon={shot.imageUrl || shot.videoUrl ? <IcRetry size={13} /> : <IcSparkle size={13} />}>
            {busy ? "…" : shot.imageUrl || shot.videoUrl ? "Image" : "Generate"}
          </Button>
          {(shot.imageUrl || shot.videoUrl) && (
            <Button size="sm" variant="glass" full disabled={busy || acting} onClick={() => run("video")} icon={<IcPlay size={12} />}>
              Animate
            </Button>
          )}
        </div>
        {(shot.imageUrl || shot.videoUrl) && (
          <select aria-label="Camera motion" value={camera} onChange={(e) => setCamera(e.target.value)} disabled={busy || acting}
            style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 8px", color: camera ? "var(--fg-1)" : "var(--fg-3)", font: "var(--text-caption)", cursor: "pointer", outline: "none" }}>
            {CAMERA_PRESETS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        )}
        {(shot.imageUrl || shot.videoUrl) && (
          <select aria-label="Animate model" value={videoModel} onChange={(e) => setVideoModel(e.target.value as GenVideoModel)} disabled={busy || acting}
            style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 8px", color: "var(--fg-1)", font: "var(--text-caption)", cursor: "pointer", outline: "none" }}>
            {GEN_VIDEO_MODELS.map((m) => <option key={m} value={m}>{GEN_VIDEO_MODEL_INFO[m].label}{GEN_VIDEO_MODEL_INFO[m].sound ? " · sound" : ""}</option>)}
          </select>
        )}
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>
          {shot.imageUrl || shot.videoUrl ? `Image ${usd(GEN_PRICE_USD_PER_IMAGE)} · Animate ${usd(GEN_VIDEO_MODEL_INFO[videoModel].priceUsd)}` : `Generate ${usd(GEN_PRICE_USD_PER_IMAGE)}`}
        </p>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={saveText} disabled={busy}
          rows={2} aria-label={`Shot ${shot.number} prompt`} placeholder="Describe this shot…"
          style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "7px 9px", color: "var(--fg-1)", font: "var(--text-small)", resize: "none", outline: "none" }} />
        {error && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>{error}</p>}
      </div>
    </div>
  );
}

export function Storyboard({ projectId, shots }: { projectId: string; shots: StudioShot[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [coworkErr, setCoworkErr] = useState<string | null>(null);

  function draft() {
    const text = idea.trim();
    if (!text || drafting) return;
    setCoworkErr(null);
    setDrafting(true);
    (async () => {
      const res = await coworkDraftStoryboard({ projectId, idea: text });
      setDrafting(false);
      if ("error" in res) { setCoworkErr(res.error); return; }
      setIdea("");
      router.refresh();
    })();
  }

  function add(scene?: number) {
    setAdding(true);
    (async () => { await addShot(projectId, scene); setAdding(false); router.refresh(); })();
  }
  function addNewScene() {
    setAdding(true);
    (async () => { await addScene(projectId); setAdding(false); router.refresh(); })();
  }

  // shots arrive ordered [scene, number]; group into scenes for display
  const scenes = [...new Set(shots.map((s) => s.scene))].sort((a, b) => a - b);

  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 20px" }}>
          <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Storyboard</h1>
          <span style={{ flex: 1 }} />
          <Button size="sm" icon={<IcPlus />} onClick={() => add()} disabled={adding}>{adding ? "Adding…" : "Add shot"}</Button>
        </div>

        {/* Artlio cowork — describe a film, it drafts the scenes & shots */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "0 0 22px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 8px 8px 12px", background: "var(--glass-1)", border: "1px solid var(--line-1)", borderRadius: "var(--radius-md)" }}>
            <IcSparkle size={16} style={{ color: "var(--fg-2)", flex: "none" }} />
            <input value={idea} onChange={(e) => setIdea(e.target.value)} disabled={drafting}
              onKeyDown={(e) => { if (e.key === "Enter") draft(); }}
              aria-label="Ask cowork"
              placeholder="Ask cowork — describe your film and it'll draft the scenes & shots…"
              style={{ flex: 1, background: "none", border: "none", color: "var(--fg-1)", font: "var(--text-body)", outline: "none", minWidth: 0 }} />
            <Button size="sm" icon={<IcSparkle size={13} />} disabled={drafting || idea.trim().length === 0} onClick={draft}>
              {drafting ? "Drafting…" : "Draft"}
            </Button>
          </div>
          {coworkErr && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>{coworkErr}</p>}
        </div>

        {shots.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", minHeight: "50vh", textAlign: "center" }}>
            <div>
              <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Plan your film, shot by shot</h2>
              <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 18px", maxWidth: 420 }}>
                Add a shot, write what happens (use @ to bring in your elements), then generate. Planning is free — you only spend when you generate.
              </p>
              <Button icon={<IcPlus />} onClick={() => add(1)} disabled={adding}>Add the first shot</Button>
            </div>
          </div>
        ) : (
          <>
            {scenes.map((sc, si) => {
              const group = shots.filter((s) => s.scene === sc);
              return (
                <section key={sc} style={{ marginBottom: 26 }}>
                  <div style={{ marginBottom: 12 }}><MonoLabel>Scene {si + 1}</MonoLabel></div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {group.map((s, i) => <ShotCard key={s.id} projectId={projectId} shot={s} index={i} total={group.length} />)}
                    <button className="drop-zone" style={{ width: 48, alignSelf: "stretch", minHeight: 150 }} aria-label={`Add shot to scene ${si + 1}`} onClick={() => add(sc)} disabled={adding}>
                      <IcPlus size={18} />
                    </button>
                  </div>
                </section>
              );
            })}
            <Button size="sm" variant="glass" icon={<IcPlus />} onClick={addNewScene} disabled={adding}>Add scene</Button>
          </>
        )}
      </div>
    </div>
  );
}
