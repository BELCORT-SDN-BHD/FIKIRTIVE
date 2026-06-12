"use client";
/**
 * Storyboard surface — WIRED. The project spine: real Shots rendered as cards,
 * each with an @mention prompt (the wedge) + its latest generation + per-shot
 * Generate/Animate. Planning (add shot, edit prompt) is free; only Generate
 * spends. Prompts use the shared MentionInput so @ brings in real elements
 * (entityIds flow through to the generation).
 */
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, MonoLabel, IcPlus, IcRetry, IcSparkle, IcPlay, IcX, IcChevronDown } from "@/components/ds";
import { addShot, deleteShot, moveShot, addScene } from "@/lib/studio-actions";
import { saveShotPrompt } from "@/lib/actions";
import { coworkDraftStoryboard } from "@/lib/cowork-actions";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { GEN_PRICE_USD_PER_IMAGE, GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_INFO, videoDefaults, videoPriceUsd, type GenVideoModel } from "@artlio/core";
import type { EntityDTO } from "@/lib/types";
import { MentionInput } from "@/components/MentionInput";
import { CAMERA_PRESETS } from "./camera";

const usd = (n: number) => "~$" + n.toFixed(2);
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export type StudioShot = {
  id: string;
  number: number; // within-scene display index (1..N)
  scene: number;
  prompt: string;
  entityIds: string[];
  promptDoc?: unknown; // Tiptap JSON — seeds the @mention editor
  imageUrl: string | null;
  videoUrl: string | null;
};

function ShotCard({ projectId, shot, index, total, entities }: { projectId: string; shot: StudioShot; index: number; total: number; entities: EntityDTO[] }) {
  const router = useRouter();
  const [text, setText] = useState(shot.prompt);
  const [ids, setIds] = useState<string[]>(shot.entityIds);
  const [doc, setDoc] = useState<unknown>(shot.promptDoc);
  const [dirty, setDirty] = useState(false);
  const [camera, setCamera] = useState("");
  const [videoModel, setVideoModel] = useState<GenVideoModel>("kling");
  const vd = videoDefaults(videoModel);
  const animatePrice = videoPriceUsd(videoModel, { seconds: vd.seconds, resolution: vd.resolution, audio: vd.audio, count: 1 });
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const hasRender = !!(shot.imageUrl || shot.videoUrl);
  const empty = text.trim().length === 0;
  // recreate (re-seed) the editor only when the SERVER prompt changes — a stale
  // editor must never silently overwrite a newer server value (and re-spend on it)
  const docKey = shot.id + "|" + JSON.stringify(shot.promptDoc ?? null);
  const [seeded, setSeeded] = useState(docKey);
  // adopt a newer server prompt only when there are no unsaved local edits — so a
  // background refresh can't silently overwrite (and re-spend on) the wrong text
  useEffect(() => {
    if (dirty || docKey === seeded) return;
    setSeeded(docKey);
    setText(shot.prompt); setIds(shot.entityIds); setDoc(shot.promptDoc);
  }, [docKey, dirty, seeded, shot.prompt, shot.entityIds, shot.promptDoc]);

  async function persist(): Promise<boolean> {
    if (!dirty) return true;
    const res = await saveShotPrompt(shot.id, JSON.stringify(doc ?? EMPTY_DOC), text.trim(), ids);
    if (res && "error" in res) { setError(res.error ?? "Couldn't save the prompt."); return false; }
    setDirty(false);
    return true;
  }

  function remove() {
    if (acting || busy) return;
    setActing(true);
    (async () => {
      const res = await deleteShot(shot.id);
      if (res && "error" in res) { setError(res.error); setActing(false); return; }
      router.refresh();
    })();
  }
  function move(dir: "left" | "right") {
    if (acting || busy) return;
    setActing(true);
    (async () => {
      const res = await moveShot(shot.id, dir);
      setActing(false);
      if (res && "error" in res) { setError(res.error); return; }
      router.refresh();
    })();
  }

  function run(kind: "image" | "video") {
    if (empty || busy) return;
    setError(null);
    setBusy(true);
    (async () => {
      if (!(await persist())) { setBusy(false); return; }
      const t = text.trim();
      const fullPrompt = kind === "video" && camera ? `${t}, ${camera}` : t;
      const res = await startGen({ projectId, shotId: shot.id, prompt: fullPrompt, entityIds: ids, count: 1, kind, model: kind === "video" ? videoModel : "seedream" });
      if ("error" in res) { setError(res.error); setBusy(false); return; }
      poll.current = setInterval(async () => {
        const job = await getGenJob(res.id);
        if (!job) return;
        if (job.status === "DONE") { if (poll.current) clearInterval(poll.current); setBusy(false); router.refresh(); }
        else if (job.status === "FAILED") { if (poll.current) clearInterval(poll.current); setBusy(false); setError(job.error || "Generation failed (you were not charged)."); }
      }, 2000);
    })();
  }

  return (
    <div className="al-mediacard" style={{ width: 240, flex: "none", cursor: "default" }}>
      <div style={{ position: "relative", aspectRatio: "16 / 10", background: hasRender ? "#000" : "var(--glass-1)" }}>
        <span style={{ position: "absolute", top: 8, left: 8, font: "var(--text-mono-meta)", color: "var(--fg-2)", zIndex: 2 }}>▦ {shot.number}</span>
        {shot.videoUrl ? (
          <video src={shot.videoUrl} muted loop autoPlay playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : shot.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.imageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
        {shot.videoUrl && <span style={{ position: "absolute", top: 8, right: 8, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "rgba(6,8,11,.6)", padding: "1px 6px", borderRadius: 4, zIndex: 2 }}>▶ video</span>}
        {busy && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(6,8,11,.55)", font: "var(--text-caption)", color: "var(--fg-2)" }}>generating…</span>}
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
          <button className="al-iconbtn al-iconbtn-sm" aria-label="Delete shot" disabled={acting || busy} onClick={remove}><IcX size={12} /></button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" full disabled={busy || acting || empty} onClick={() => run("image")} icon={hasRender ? <IcRetry size={13} /> : <IcSparkle size={13} />}>
            {busy ? "…" : hasRender ? "Image" : "Generate"}
          </Button>
          {hasRender && (
            <Button size="sm" variant="glass" full disabled={busy || acting || empty} onClick={() => run("video")} icon={<IcPlay size={12} />}>Animate</Button>
          )}
        </div>
        {hasRender && (
          <select aria-label="Camera motion" value={camera} onChange={(e) => setCamera(e.target.value)} disabled={busy || acting}
            style={{ width: "100%", background: "#11151b", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 8px", color: camera ? "var(--fg-1)" : "var(--fg-3)", font: "var(--text-caption)", cursor: "pointer", outline: "none" }}>
            {CAMERA_PRESETS.map(([val, label]) => <option key={val} value={val} style={{ background: "#11151b" }}>{label}</option>)}
          </select>
        )}
        {hasRender && (
          <select aria-label="Animate model" value={videoModel} onChange={(e) => setVideoModel(e.target.value as GenVideoModel)} disabled={busy || acting}
            style={{ width: "100%", background: "#11151b", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 8px", color: "var(--fg-1)", font: "var(--text-caption)", cursor: "pointer", outline: "none" }}>
            {GEN_VIDEO_MODELS.map((m) => <option key={m} value={m} style={{ background: "#11151b" }}>{GEN_VIDEO_MODEL_INFO[m].label}{GEN_VIDEO_MODEL_INFO[m].sound ? " · sound" : ""}</option>)}
          </select>
        )}
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>
          {hasRender ? `Image ${usd(GEN_PRICE_USD_PER_IMAGE)} · Animate ${usd(animatePrice)} (${vd.seconds}s${vd.audio ? ", audio" : ""})` : `Generate ${usd(GEN_PRICE_USD_PER_IMAGE)}`}
        </p>
        <div style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "6px 9px" }}>
          <MentionInput entities={entities} initialDoc={shot.promptDoc} docKey={seeded}
            placeholder="Describe this shot — use @ for elements"
            onChange={(t, i, d) => { setText(t); setIds(i); setDoc(d); setDirty(true); }}
            onBlur={() => { if (dirty) void persist(); }} />
        </div>
        {error && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>{error}</p>}
      </div>
    </div>
  );
}

export function Storyboard({ projectId, shots, entities }: { projectId: string; shots: StudioShot[]; entities: EntityDTO[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [coworkErr, setCoworkErr] = useState<string | null>(null);
  const [coworkOk, setCoworkOk] = useState<string | null>(null);

  function draft() {
    const text = idea.trim();
    if (!text || drafting) return;
    setCoworkErr(null); setCoworkOk(null);
    setDrafting(true);
    (async () => {
      const res = await coworkDraftStoryboard({ projectId, idea: text });
      setDrafting(false);
      if ("error" in res) { setCoworkErr(res.error); return; }
      setIdea("");
      setCoworkOk(`Drafted ${res.scenes} scene${res.scenes === 1 ? "" : "s"} · ${res.shots} shot${res.shots === 1 ? "" : "s"}.`);
      router.refresh();
    })();
  }

  function add(scene?: number) {
    setAdding(true); setActionErr(null);
    (async () => {
      const res = await addShot(projectId, scene);
      setAdding(false);
      if (res && "error" in res) { setActionErr(res.error); return; }
      router.refresh();
    })();
  }
  function addNewScene() {
    setAdding(true); setActionErr(null);
    (async () => {
      const res = await addScene(projectId);
      setAdding(false);
      if (res && "error" in res) { setActionErr(res.error); return; }
      router.refresh();
    })();
  }

  const scenes = [...new Set(shots.map((s) => s.scene))].sort((a, b) => a - b);

  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 20px" }}>
          <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Storyboard</h1>
          <span style={{ flex: 1 }} />
          <Button size="sm" icon={<IcPlus />} onClick={() => add()} disabled={adding}>{adding ? "Adding…" : "Add shot"}</Button>
        </div>
        {actionErr && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "-12px 0 14px" }}>{actionErr}</p>}

        {/* Artlio cowork — describe a film, it drafts the scenes & shots */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "0 0 22px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 8px 8px 12px", background: "var(--glass-1)", border: "1px solid var(--line-1)", borderRadius: "var(--radius-md)" }}>
            <IcSparkle size={16} style={{ color: "var(--fg-2)", flex: "none" }} />
            <input value={idea} onChange={(e) => setIdea(e.target.value)} disabled={drafting}
              onKeyDown={(e) => { if (e.key === "Enter") draft(); }} aria-label="Ask cowork"
              placeholder="Ask cowork — describe your film and it'll draft the scenes & shots…"
              style={{ flex: 1, background: "none", border: "none", color: "var(--fg-1)", font: "var(--text-body)", outline: "none", minWidth: 0 }} />
            <Button size="sm" icon={<IcSparkle size={13} />} disabled={drafting || idea.trim().length === 0} onClick={draft}>{drafting ? "Drafting…" : "Draft"}</Button>
          </div>
          {coworkErr && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>{coworkErr}</p>}
          {coworkOk && <p style={{ font: "var(--text-caption)", color: "var(--fg-2)", margin: 0 }}>{coworkOk}</p>}
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
                    {group.map((s, i) => <ShotCard key={s.id} projectId={projectId} shot={s} index={i} total={group.length} entities={entities} />)}
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
