"use client";
/**
 * Gen space surface (Artlio Studio + LTX gen-workspace). The generation
 * workbench: a rich composer (reference slots + mode + model + per-model
 * duration/More settings + live price) and a results stack.
 *
 * Each video model exposes exactly the controls its fal endpoint accepts
 * (GEN_VIDEO_MODEL_OPTIONS): a seconds dropdown plus a "More" panel of
 * resolution / aspect / fps / audio / clip-count, whichever apply. Price is
 * dynamic (videoPriceUsd) and shown before spend; failures never charge.
 */
import { useState, useEffect, useRef } from "react";
import { Button, MonoLabel, IcPlus, IcImage, IcChevronDown, IcRetry, IcX } from "@/components/ds";
import {
  GEN_PRICE_USD_PER_IMAGE, GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_INFO, GEN_VIDEO_MODEL_OPTIONS,
  videoDefaults, videoPriceUsd, type GenVideoModel,
} from "@artlio/core";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { uploadReference } from "@/lib/actions";
import { CAMERA_PRESETS } from "./camera";

const Caret = () => <IcChevronDown size={13} style={{ marginLeft: 2, color: "var(--fg-3)" }} />;
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u);

const SESSIONS = [
  { title: "This session", ago: "now", tint: "linear-gradient(135deg,#3a2f2a,#5a4438)", active: true },
];

type Result = { prompt: string; meta: string; urls: string[]; pending?: boolean };

/** A labelled segmented control for the "More" settings panel. */
function SettingRow({ label, options, value, onChange, fmt }: {
  label: string; options: (string | number)[]; value: string | number;
  onChange: (v: string | number) => void; fmt?: (o: string | number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ font: "var(--text-caption)", color: "var(--fg-3)", width: 70, flex: "none" }}>{label}</span>
      <div className="al-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={String(o)} className={`al-seg-item${value === o ? " al-seg-item-active" : ""}`} onClick={() => onChange(o)}>
            {fmt ? fmt(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GenSpace({ projectId }: { projectId: string | null }) {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("a cinematic portrait, soft window light");
  const [count, setCount] = useState(1);              // batch (video) / num images
  const [camera, setCamera] = useState("");           // camera-motion preset (video)
  const [videoModel, setVideoModel] = useState<GenVideoModel>("kling");
  const [vopts, setVopts] = useState(() => videoDefaults("kling")); // seconds/res/aspect/fps/audio
  const [showMore, setShowMore] = useState(false);
  const isVideo = kind === "video";
  const opts = GEN_VIDEO_MODEL_OPTIONS[videoModel];
  const info = GEN_VIDEO_MODEL_INFO[videoModel];
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refImg, setRefImg] = useState<{ id: string; src: string } | null>(null); // i2v start frame
  const [tailImg, setTailImg] = useState<{ id: string; src: string } | null>(null); // optional last frame
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const tailInput = useRef<HTMLInputElement | null>(null);
  const pollers = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const active = useRef(0); // in-flight jobs this batch — busy clears when it hits 0
  useEffect(() => () => { pollers.current.forEach((t) => clearInterval(t)); }, []);

  const price = isVideo
    ? videoPriceUsd(videoModel, { seconds: vopts.seconds, resolution: vopts.resolution, audio: vopts.audio, count })
    : count * GEN_PRICE_USD_PER_IMAGE;

  function pickModel(m: GenVideoModel) {
    setVideoModel(m);
    setVopts(videoDefaults(m));                                  // reset controls to the new model's defaults
    if (!GEN_VIDEO_MODEL_INFO[m].tail) setTailImg(null);          // model with no end frame
    setCount((c) => Math.min(c, GEN_VIDEO_MODEL_OPTIONS[m].maxCount));
  }

  function uploadInto(setter: (v: { id: string; src: string }) => void, switchMode: boolean) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !projectId || uploading) return;
      setError(null);
      setUploading(true);
      (async () => {
        const fd = new FormData();
        fd.append("files", file);
        const res = await uploadReference(projectId, fd);
        setUploading(false);
        if ("error" in res) { setError(res.error); return; }
        setter(res);
        if (switchMode) setKind("video"); // a reference image animates → image-to-video
      })();
    };
  }
  const onRefFile = uploadInto(setRefImg, true);
  const onTailFile = uploadInto(setTailImg, false);

  function finishOne() {
    active.current -= 1;
    if (active.current <= 0) { active.current = 0; setBusy(false); }
  }

  // start one job + poll it to completion, updating its own placeholder
  function runOne(req: Parameters<typeof startGen>[0], placeholder: Result, doneMeta: (n: number) => string) {
    (async () => {
      const res = await startGen(req);
      if ("error" in res) {
        setError(res.error);
        setResults((r) => r.filter((x) => x !== placeholder));
        finishOne();
        return;
      }
      const t = setInterval(async () => {
        const job = await getGenJob(res.id);
        if (!job) return;
        if (job.status === "DONE") {
          clearInterval(t); pollers.current.delete(t);
          setResults((r) => r.map((x) => x === placeholder ? { prompt: placeholder.prompt, meta: doneMeta(job.urls.length), urls: job.urls } : x));
          finishOne();
        } else if (job.status === "FAILED") {
          clearInterval(t); pollers.current.delete(t);
          setError(job.error || "Generation failed.");
          setResults((r) => r.filter((x) => x !== placeholder));
          finishOne();
        }
      }, 2000);
      pollers.current.add(t);
    })();
  }

  function generate() {
    const text = prompt.trim();
    if (!text || !projectId || busy) return;
    const fullPrompt = isVideo && camera ? `${text}, ${camera}` : text; // camera motion → prompt
    setError(null);
    setShowMore(false);
    setBusy(true);
    if (isVideo) {
      // fal video has no num_videos — a batch of N is N independent one-clip jobs
      // (each keeps the worker's exactly-once spend). Only send a control the model has.
      const n = Math.max(1, Math.min(count, opts.maxCount));
      active.current = n;
      const sendTail = !!(refImg && tailImg && info.tail);
      for (let i = 0; i < n; i++) {
        const placeholder: Result = { prompt: text, meta: `${info.label} · generating…`, urls: [], pending: true };
        setResults((r) => [placeholder, ...r]);
        runOne({
          projectId, prompt: fullPrompt, entityIds: [], count: 1, kind: "video", model: videoModel,
          sourceGenerationId: refImg ? refImg.id : undefined,
          tailGenerationId: sendTail ? tailImg!.id : undefined,
          durationSeconds: vopts.seconds,
          resolution: opts.resolutions.length ? vopts.resolution : undefined,
          aspectRatio: opts.aspectRatios.length ? vopts.aspectRatio : undefined,
          fps: opts.fps.length ? vopts.fps : undefined,
          audio: opts.audioToggle ? vopts.audio : undefined,
        }, placeholder, () => `${info.label} · video`);
      }
    } else {
      active.current = 1;
      const placeholder: Result = { prompt: text, meta: "Seedream · generating…", urls: [], pending: true };
      setResults((r) => [placeholder, ...r]);
      runOne({ projectId, prompt: fullPrompt, entityIds: [], count, kind: "image", model: "seedream" }, placeholder, (nn) => `Seedream · ${nn} image`);
    }
  }

  return (
    <>
      <div className="screen" style={{ display: "flex", minHeight: 0 }}>
        {/* session workspace */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 28px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <Button variant="glass" size="sm" icon={null}>Shot navigator<Caret /></Button>
          </div>
          <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "10px 0 18px" }}>Gen space</h1>

          {error && <p role="alert" style={{ font: "var(--text-small)", color: "var(--danger)", margin: "0 0 14px" }}>{error}</p>}

          {results.length === 0 && !busy && (
            <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: "8px 0" }}>
              Describe a shot below and hit Generate — results land here.
            </p>
          )}

          {results.map((r, i) => (
            <div key={i} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
                <span style={{ color: "var(--fg-2)" }}>{r.prompt}</span>
                <span>· {r.meta}</span>
                <span style={{ flex: 1 }} />
                {!r.pending && <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><IcRetry size={13} /><IcX size={13} /></span>}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {r.pending ? (
                  <div style={{ width: 280, aspectRatio: "16 / 10", borderRadius: "var(--radius-md)", background: "var(--glass-1)", border: "1px solid var(--line-2)", display: "grid", placeItems: "center", font: "var(--text-caption)", color: "var(--fg-3)" }}>
                    generating…
                  </div>
                ) : (
                  r.urls.map((u) => isVideoUrl(u) ? (
                    <video key={u} src={u} muted loop autoPlay playsInline style={{ width: 280, aspectRatio: "16 / 10", objectFit: "cover", borderRadius: "var(--radius-md)", border: "1px solid var(--line-2)", background: "#000" }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="" style={{ width: 280, aspectRatio: "16 / 10", objectFit: "cover", borderRadius: "var(--radius-md)", border: "1px solid var(--line-2)" }} />
                  ))
                )}
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
            <button key={s.title} className="al-mediacard" style={{
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
        <div className="al-promptbar" style={{ position: "relative" }}>
          {/* per-model "More" settings — each control appears only if the model has it */}
          {isVideo && showMore && (
            <div style={{ position: "absolute", bottom: "100%", right: 12, marginBottom: 8, background: "#11151b", border: "1px solid var(--line-2)", borderRadius: "var(--radius-md)", padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 250, boxShadow: "0 8px 24px rgba(0,0,0,.45)", zIndex: 20 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <MonoLabel>More settings</MonoLabel>
                <span style={{ flex: 1 }} />
                <button className="al-iconbtn al-iconbtn-sm" onClick={() => setShowMore(false)} aria-label="Close settings"><IcX size={12} /></button>
              </div>
              {opts.resolutions.length > 0 && (
                <SettingRow label="Resolution" options={opts.resolutions} value={vopts.resolution} onChange={(v) => setVopts((o) => ({ ...o, resolution: String(v) }))} />
              )}
              {opts.aspectRatios.length > 0 && (
                <SettingRow label="Aspect" options={opts.aspectRatios} value={vopts.aspectRatio} onChange={(v) => setVopts((o) => ({ ...o, aspectRatio: String(v) }))} />
              )}
              {opts.fps.length > 0 && (
                <SettingRow label="FPS" options={opts.fps} value={vopts.fps} onChange={(v) => setVopts((o) => ({ ...o, fps: Number(v) }))} />
              )}
              {opts.audioToggle && (
                <SettingRow label="Audio" options={["On", "Off"]} value={vopts.audio ? "On" : "Off"} onChange={(v) => setVopts((o) => ({ ...o, audio: v === "On" }))} />
              )}
              <SettingRow label="Clips" options={Array.from({ length: opts.maxCount }, (_, i) => i + 1)} value={count} onChange={(v) => setCount(Number(v))} />
            </div>
          )}

          {/* reference slots */}
          <div className="al-promptbar-row">
            {/* start frame */}
            {refImg ? (
              <span style={{ position: "relative", flex: "none" }} title="Start frame">
                <span style={{ display: "block", width: 30, height: 30, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line-2)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={refImg.src} alt="start frame" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </span>
                <button onClick={() => { setRefImg(null); setTailImg(null); }} aria-label="Remove reference"
                  style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, display: "grid", placeItems: "center", borderRadius: "50%", background: "#11151b", border: "1px solid var(--line-2)", color: "var(--fg-1)", cursor: "pointer", padding: 0 }}>
                  <IcX size={9} />
                </button>
              </span>
            ) : (
              <button className="al-iconbtn al-iconbtn-md" aria-label="Add image reference for image-to-video"
                onClick={() => !uploading && fileInput.current?.click()} disabled={uploading || !projectId}>
                <IcImage size={16} />
              </button>
            )}
            {/* optional last frame — only with a start, and only for models that support an end frame */}
            {refImg && info.tail && (tailImg ? (
              <span style={{ position: "relative", flex: "none" }} title="Last frame (end)">
                <span style={{ display: "block", width: 30, height: 30, borderRadius: 6, overflow: "hidden", border: "1px solid rgba(120,160,255,.6)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tailImg.src} alt="last frame" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </span>
                <button onClick={() => setTailImg(null)} aria-label="Remove last frame"
                  style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, display: "grid", placeItems: "center", borderRadius: "50%", background: "#11151b", border: "1px solid var(--line-2)", color: "var(--fg-1)", cursor: "pointer", padding: 0 }}>
                  <IcX size={9} />
                </button>
              </span>
            ) : (
              <button className="al-iconbtn al-iconbtn-md" aria-label="Add last frame" title="Add an end frame (optional)"
                onClick={() => !uploading && tailInput.current?.click()} disabled={uploading || !projectId}>
                <IcPlus size={16} />
              </button>
            ))}
            {uploading && <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>uploading…</span>}
            {refImg && !uploading && <span style={{ font: "var(--text-caption)", color: "var(--fg-2)" }}>{tailImg && info.tail ? "→ image-to-video · start → end frame" : "→ image-to-video"}</span>}
            <span className="al-promptbar-spacer" />
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>~${price.toFixed(2)}</span>
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onRefFile} />
          <input ref={tailInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onTailFile} />
          <div className="al-input-wrap" style={{ border: "none", background: "none", padding: 0 }}>
            <input placeholder="Describe the shot — subject, camera, light…" aria-label="Describe the shot"
              value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") generate(); }} />
          </div>
          <div className="al-promptbar-row">
            <div className="al-seg" role="tablist">
              <button role="tab" aria-selected={!isVideo} className={`al-seg-item${!isVideo ? " al-seg-item-active" : ""}`} onClick={() => { setKind("image"); setCount(1); setShowMore(false); }}>Photo</button>
              <button role="tab" aria-selected={isVideo} className={`al-seg-item${isVideo ? " al-seg-item-active" : ""}`} onClick={() => setKind("video")}>Video</button>
            </div>
            {isVideo ? (
              <>
                <select aria-label="Video model" value={videoModel} onChange={(e) => pickModel(e.target.value as GenVideoModel)}
                  style={{ background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: 999, color: "var(--fg-1)", font: "var(--text-mono-meta)", padding: "5px 9px", cursor: "pointer", outline: "none" }}>
                  {GEN_VIDEO_MODELS.map((m) => <option key={m} value={m}>{GEN_VIDEO_MODEL_INFO[m].label}{GEN_VIDEO_MODEL_INFO[m].sound ? " · sound" : ""}</option>)}
                </select>
                <select aria-label="Duration" value={vopts.seconds} onChange={(e) => setVopts((o) => ({ ...o, seconds: Number(e.target.value) }))}
                  style={{ background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: 999, color: "var(--fg-1)", font: "var(--text-mono-meta)", padding: "5px 9px", cursor: "pointer", outline: "none" }}>
                  {opts.durations.map((s) => <option key={s} value={s}>{s} Sec</option>)}
                </select>
                <select aria-label="Camera motion" value={camera} onChange={(e) => setCamera(e.target.value)}
                  style={{ background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: 999, color: camera ? "var(--fg-1)" : "var(--fg-2)", font: "var(--text-mono-meta)", padding: "5px 9px", cursor: "pointer", outline: "none" }}>
                  {CAMERA_PRESETS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                </select>
                <button className="al-chip al-chip-mono" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>More<Caret /></button>
              </>
            ) : (
              <button className="al-chip al-chip-mono">Seedream<Caret /></button>
            )}
            <span className="al-promptbar-spacer" />
            <Button onClick={generate} disabled={busy || !projectId || prompt.trim().length === 0}>
              {busy ? "Generating…" : "Generate"}
            </Button>
          </div>
          {!projectId && <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Create a project first (in the old Workbench) to generate here.</p>}
        </div>
      </div>
    </>
  );
}
