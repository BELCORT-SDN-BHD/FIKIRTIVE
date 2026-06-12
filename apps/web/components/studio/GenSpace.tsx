"use client";
/**
 * Gen space surface (Artlio Studio + LTX gen-workspace). The generation
 * workbench: a rich composer (reference slots + mode + model + per-model
 * duration/More settings + live price) and a results stack.
 *
 * Each video model exposes exactly the controls its fal endpoint accepts
 * (GEN_VIDEO_MODEL_OPTIONS): a seconds dropdown plus a "More" panel of
 * resolution / aspect / audio / clip-count, whichever apply. Price is dynamic
 * (videoPriceUsd) and shown before spend; failures never charge.
 */
import { useState, useEffect, useRef } from "react";
import { Button, IcPlus, IcImage, IcChevronDown, IcRetry, IcX } from "@/components/ds";
import {
  GEN_PRICE_USD_PER_IMAGE, MAX_GEN_COUNT, GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_INFO,
  GEN_VIDEO_MODEL_OPTIONS, videoDefaults, videoPriceUsd, type GenVideoModel,
} from "@artlio/core";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { uploadReference } from "@/lib/actions";
import { MentionInput } from "@/components/MentionInput";
import { Lightbox } from "@/components/Lightbox";
import type { EntityDTO } from "@/lib/types";
import { CAMERA_PRESETS } from "./camera";

const Caret = () => <IcChevronDown size={13} style={{ marginLeft: 2, color: "var(--fg-3)" }} />;
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u);
const POLL_CAP = 120; // ~4 min at 2s — a stuck job can't pin the composer forever

/** Failure copy that never lies about money: a post-charge failure says so. */
function failMsg(job: { error: string; spent?: boolean }): string {
  if (job.spent) return `Charged, but saving the result failed${job.error ? `: ${job.error}` : ""} — reload to check; it'll be reconciled.`;
  return job.error || "Generation failed (you were not charged).";
}

// dark, opaque controls so the OS-rendered <option> list is never white-on-white
const selectStyle: React.CSSProperties = {
  background: "#11151b", border: "1px solid var(--line-2)", borderRadius: 999,
  color: "var(--fg-1)", font: "var(--text-mono-meta)", padding: "5px 9px", cursor: "pointer", outline: "none",
};
const optStyle: React.CSSProperties = { background: "#11151b", color: "var(--fg-1)" };

/** CSS aspect-ratio for a result tile from the chosen fal aspect (default 16:9). */
function aspectCss(ar: string): string {
  return ar === "9:16" ? "9 / 16" : ar === "1:1" ? "1 / 1" : ar === "4:3" ? "4 / 3" : ar === "3:4" ? "3 / 4" : ar === "21:9" ? "21 / 9" : "16 / 9";
}

type GenReq = Parameters<typeof startGen>[0];
type Result = {
  id: number;
  displayPrompt: string;
  label: string;
  status: "pending" | "done" | "failed";
  urls: string[];
  message?: string;   // failure reason
  req: GenReq;         // stored so Retry can replay the exact request
  aspect: string;      // tile aspect-ratio (css)
  retryable: boolean;  // false when a poll timed out — the job may still be running/charged, so re-running would double-spend
};

/** A labelled segmented control for the "More" settings panel. */
function SettingRow({ label, options, value, onChange }: {
  label: string; options: (string | number)[]; value: string | number; onChange: (v: string | number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ font: "var(--text-caption)", color: "var(--fg-3)", width: 70, flex: "none" }}>{label}</span>
      <div className="al-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={String(o)} className={`al-seg-item${value === o ? " al-seg-item-active" : ""}`} onClick={() => onChange(o)}>{String(o)}</button>
        ))}
      </div>
    </div>
  );
}

export function GenSpace({ projectId, entities }: { projectId: string; entities: EntityDTO[] }) {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const [promptIds, setPromptIds] = useState<string[]>([]); // @mentioned entity ids
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
  const [error, setError] = useState<string | null>(null); // reference-upload errors (gen failures show per-tile)
  const [refImg, setRefImg] = useState<{ id: string; src: string } | null>(null);
  const [tailImg, setTailImg] = useState<{ id: string; src: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; kind: "image" | "video" } | null>(null); // click-to-enlarge
  const fileInput = useRef<HTMLInputElement | null>(null);
  const tailInput = useRef<HTMLInputElement | null>(null);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const morePanel = useRef<HTMLDivElement | null>(null);
  const pollers = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const active = useRef(0);  // in-flight jobs — busy clears when it hits 0
  const seq = useRef(0);     // stable result ids
  useEffect(() => () => { pollers.current.forEach((t) => clearInterval(t)); }, []);

  // dismiss the More popover on outside click / Escape (mirrors PopMenu/Dialog)
  useEffect(() => {
    if (!showMore) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (morePanel.current?.contains(t) || moreBtn.current?.contains(t)) return;
      setShowMore(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowMore(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [showMore]);

  const price = isVideo
    ? videoPriceUsd(videoModel, { seconds: vopts.seconds, resolution: vopts.resolution, audio: vopts.audio, count })
    : count * GEN_PRICE_USD_PER_IMAGE;

  function pickModel(m: GenVideoModel) {
    setVideoModel(m);
    setVopts(videoDefaults(m));
    if (!GEN_VIDEO_MODEL_INFO[m].tail) setTailImg(null);
    setCount((c) => Math.min(c, GEN_VIDEO_MODEL_OPTIONS[m].maxCount));
  }

  function uploadInto(setter: (v: { id: string; src: string }) => void, switchMode: boolean) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || uploading) return;
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

  // launch one job (its own tile) + poll it; failures land on the tile, not a shared banner
  function launch(displayPrompt: string, label: string, req: GenReq, aspect: string) {
    const id = (seq.current += 1);
    const placeholder: Result = { id, displayPrompt, label, status: "pending", urls: [], req, aspect, retryable: true };
    active.current += 1;
    setResults((r) => [placeholder, ...r]);
    const mark = (patch: Partial<Result>) => setResults((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    (async () => {
      const res = await startGen(req);
      if ("error" in res) { mark({ status: "failed", message: res.error }); finishOne(); return; }
      let n = 0;
      const t = setInterval(async () => {
        n += 1;
        const job = await getGenJob(res.id);
        // poll-cap cases stay non-retryable: the job may still be running/charged, so re-running could double-spend
        if (!job) { if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Status unknown — reload to check (don't re-run, you may have been charged).", retryable: false }); finishOne(); } return; }
        if (job.status === "DONE") { clearInterval(t); pollers.current.delete(t); mark({ status: "done", urls: job.urls }); finishOne(); }
        else if (job.status === "FAILED") { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: failMsg(job) }); finishOne(); }
        else if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Still running — reload to check (don't re-run, you may have been charged).", retryable: false }); finishOne(); }
      }, 2000);
      pollers.current.add(t);
    })();
  }

  function generate() {
    const text = prompt.trim();
    if (!text || busy) return;
    setError(null);
    setShowMore(false);
    setBusy(true);
    if (isVideo) {
      // fal video has no num_videos — a batch of N is N independent one-clip jobs
      // (each keeps the worker's exactly-once spend). Only send a control the model has.
      const n = Math.max(1, Math.min(count, opts.maxCount));
      const fullPrompt = camera ? `${text}, ${camera}` : text;
      const sendTail = !!(refImg && tailImg && info.tail);
      const aspect = aspectCss(opts.aspectRatios.length ? vopts.aspectRatio : "16:9");
      for (let i = 0; i < n; i++) {
        launch(text, info.label, {
          projectId, prompt: fullPrompt, entityIds: promptIds, count: 1, kind: "video", model: videoModel,
          sourceGenerationId: refImg ? refImg.id : undefined,
          tailGenerationId: sendTail ? tailImg!.id : undefined,
          durationSeconds: vopts.seconds,
          resolution: opts.resolutions.length ? vopts.resolution : undefined,
          aspectRatio: opts.aspectRatios.length ? vopts.aspectRatio : undefined,
          audio: opts.audioToggle ? vopts.audio : undefined,
        }, aspect);
      }
    } else {
      launch(text, "Seedream", { projectId, prompt: text, entityIds: promptIds, count, kind: "image", model: "seedream" }, "16 / 9");
    }
  }

  function retry(r: Result) {
    setResults((rs) => rs.filter((x) => x.id !== r.id));
    setBusy(true);
    launch(r.displayPrompt, r.label, r.req, r.aspect);
  }
  const remove = (r: Result) => setResults((rs) => rs.filter((x) => x.id !== r.id));

  return (
    <>
      <div className="screen" style={{ display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 28px 40px" }}>
          <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "10px 0 18px" }}>Gen space</h1>

          {error && <p role="alert" style={{ font: "var(--text-small)", color: "var(--danger)", margin: "0 0 14px" }}>{error}</p>}

          {results.length === 0 && !busy && (
            <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: "8px 0" }}>
              Describe a shot below and hit Generate — results land here.
            </p>
          )}

          {results.map((r) => (
            <div key={r.id} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
                <span style={{ color: "var(--fg-2)" }}>{r.displayPrompt}</span>
                <span>· {r.label}{r.status === "failed" ? " · failed" : r.status === "pending" ? " · generating…" : ""}</span>
                <span style={{ flex: 1 }} />
                {r.status !== "pending" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {r.retryable && <button className="al-iconbtn al-iconbtn-sm" aria-label="Regenerate" title="Regenerate" onClick={() => retry(r)}><IcRetry size={13} /></button>}
                    <button className="al-iconbtn al-iconbtn-sm" aria-label="Remove result" title="Remove" onClick={() => remove(r)}><IcX size={13} /></button>
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {r.status === "pending" ? (
                  <div style={{ width: 280, aspectRatio: r.aspect, borderRadius: "var(--radius-md)", background: "var(--glass-1)", border: "1px solid var(--line-2)", display: "grid", placeItems: "center", font: "var(--text-caption)", color: "var(--fg-3)" }}>generating…</div>
                ) : r.status === "failed" ? (
                  <div style={{ width: 280, aspectRatio: r.aspect, borderRadius: "var(--radius-md)", background: "rgba(255,90,90,.06)", border: "1px solid var(--danger)", display: "grid", placeItems: "center", padding: 12, textAlign: "center", font: "var(--text-caption)", color: "var(--danger)" }}>{r.message}</div>
                ) : (
                  r.urls.map((u) => isVideoUrl(u) ? (
                    <video key={u} src={u} muted loop autoPlay playsInline title="Click to enlarge" onClick={() => setZoom({ src: u, kind: "video" })} style={{ width: 280, aspectRatio: r.aspect, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--line-2)", background: "#000", cursor: "zoom-in" }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="" title="Click to enlarge" onClick={() => setZoom({ src: u, kind: "image" })} style={{ width: 280, aspectRatio: r.aspect, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--line-2)", background: "#000", cursor: "zoom-in" }} />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="composer-dock">
        <div className="al-promptbar" style={{ position: "relative", maxWidth: 880, width: "100%", margin: "0 auto" }}>
          {/* per-model "More" settings — each control appears only if the model has it */}
          {isVideo && showMore && (
            <div ref={morePanel} style={{ position: "absolute", bottom: "100%", right: 12, marginBottom: 8, background: "#11151b", border: "1px solid var(--line-2)", borderRadius: "var(--radius-md)", padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 250, boxShadow: "0 8px 24px rgba(0,0,0,.45)", zIndex: 20 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>More settings</span>
                <span style={{ flex: 1 }} />
                <button className="al-iconbtn al-iconbtn-sm" onClick={() => setShowMore(false)} aria-label="Close settings"><IcX size={12} /></button>
              </div>
              {opts.resolutions.length > 0 && (
                <SettingRow label="Resolution" options={opts.resolutions} value={vopts.resolution} onChange={(v) => setVopts((o) => ({ ...o, resolution: String(v) }))} />
              )}
              {opts.aspectRatios.length > 0 && !refImg && (
                <SettingRow label="Aspect" options={opts.aspectRatios} value={vopts.aspectRatio} onChange={(v) => setVopts((o) => ({ ...o, aspectRatio: String(v) }))} />
              )}
              {opts.audioToggle && (
                <SettingRow label="Audio" options={["On", "Off"]} value={vopts.audio ? "On" : "Off"} onChange={(v) => setVopts((o) => ({ ...o, audio: v === "On" }))} />
              )}
              <SettingRow label="Clips" options={Array.from({ length: opts.maxCount }, (_, i) => i + 1)} value={count} onChange={(v) => setCount(Number(v))} />
            </div>
          )}

          {/* reference slots */}
          <div className="al-promptbar-row">
            {refImg ? (
              <span style={{ position: "relative", flex: "none" }} title="Start frame">
                <span style={{ display: "block", width: 30, height: 30, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line-2)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={refImg.src} alt="start frame" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </span>
                <button onClick={() => { setRefImg(null); setTailImg(null); }} aria-label="Remove reference" disabled={busy}
                  style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, display: "grid", placeItems: "center", borderRadius: "50%", background: "#11151b", border: "1px solid var(--line-2)", color: "var(--fg-1)", cursor: "pointer", padding: 0 }}>
                  <IcX size={9} />
                </button>
              </span>
            ) : (
              <button className="al-iconbtn al-iconbtn-md" aria-label="Add image reference for image-to-video"
                onClick={() => !uploading && fileInput.current?.click()} disabled={uploading || busy}>
                <IcImage size={16} />
              </button>
            )}
            {refImg && info.tail && (tailImg ? (
              <span style={{ position: "relative", flex: "none" }} title="Last frame (end)">
                <span style={{ display: "block", width: 30, height: 30, borderRadius: 6, overflow: "hidden", border: "1px solid rgba(120,160,255,.6)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tailImg.src} alt="last frame" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </span>
                <button onClick={() => setTailImg(null)} aria-label="Remove last frame" disabled={busy}
                  style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, display: "grid", placeItems: "center", borderRadius: "50%", background: "#11151b", border: "1px solid var(--line-2)", color: "var(--fg-1)", cursor: "pointer", padding: 0 }}>
                  <IcX size={9} />
                </button>
              </span>
            ) : (
              <button className="al-iconbtn al-iconbtn-md" aria-label="Add last frame" title="Add an end frame (optional)"
                onClick={() => !uploading && tailInput.current?.click()} disabled={uploading || busy}>
                <IcPlus size={16} />
              </button>
            ))}
            {uploading && <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>uploading…</span>}
            {refImg && !uploading && <span style={{ font: "var(--text-caption)", color: "var(--fg-2)" }}>{tailImg && info.tail ? "→ image-to-video · start → end frame" : "→ image-to-video"}</span>}
            <span className="al-promptbar-spacer" />
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>{isVideo ? `~$${price.toFixed(2)}` : `$${price.toFixed(2)}`}</span>
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onRefFile} />
          <input ref={tailInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onTailFile} />
          <div className="al-input-wrap" style={{ border: "none", background: "none", padding: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MentionInput entities={entities} placeholder="Describe the shot — use @ to add elements (⌘↵ to generate)"
                onChange={(t, i) => { setPrompt(t); setPromptIds(i); }} onSubmit={generate} />
            </div>
          </div>
          <div className="al-promptbar-row">
            <div className="al-seg" role="tablist">
              <button role="tab" aria-selected={!isVideo} className={`al-seg-item${!isVideo ? " al-seg-item-active" : ""}`} disabled={busy} onClick={() => { setKind("image"); setCount(1); setCamera(""); setShowMore(false); }}>Photo</button>
              <button role="tab" aria-selected={isVideo} className={`al-seg-item${isVideo ? " al-seg-item-active" : ""}`} disabled={busy} onClick={() => setKind("video")}>Video</button>
            </div>
            {isVideo ? (
              <>
                <select aria-label="Video model" value={videoModel} disabled={busy} onChange={(e) => pickModel(e.target.value as GenVideoModel)} style={selectStyle}>
                  {GEN_VIDEO_MODELS.map((m) => <option key={m} value={m} style={optStyle}>{GEN_VIDEO_MODEL_INFO[m].label}{GEN_VIDEO_MODEL_INFO[m].sound ? " · sound" : ""}</option>)}
                </select>
                <select aria-label="Duration" value={vopts.seconds} disabled={busy} onChange={(e) => setVopts((o) => ({ ...o, seconds: Number(e.target.value) }))} style={selectStyle}>
                  {opts.durations.map((s) => <option key={s} value={s} style={optStyle}>{s} Sec</option>)}
                </select>
                <select aria-label="Camera motion" value={camera} disabled={busy} onChange={(e) => setCamera(e.target.value)} style={{ ...selectStyle, color: camera ? "var(--fg-1)" : "var(--fg-2)" }}>
                  {CAMERA_PRESETS.map(([val, label]) => <option key={val} value={val} style={optStyle}>{label}</option>)}
                </select>
                <button ref={moreBtn} className="al-chip al-chip-mono" aria-expanded={showMore} disabled={busy} onClick={() => setShowMore((s) => !s)}>More<Caret /></button>
              </>
            ) : (
              <>
                <span className="al-chip al-chip-mono">Seedream</span>
                <select aria-label="Images" value={count} disabled={busy} onChange={(e) => setCount(Number(e.target.value))} style={selectStyle}>
                  {Array.from({ length: MAX_GEN_COUNT }, (_, i) => i + 1).map((n) => <option key={n} value={n} style={optStyle}>{n} {n === 1 ? "image" : "images"}</option>)}
                </select>
              </>
            )}
            <span className="al-promptbar-spacer" />
            <Button onClick={generate} disabled={busy || prompt.trim().length === 0}>
              {busy ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </div>
      {zoom && <Lightbox src={zoom.src} kind={zoom.kind} onClose={() => setZoom(null)} />}
    </>
  );
}
