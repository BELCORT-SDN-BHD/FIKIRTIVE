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
import { useState, useEffect, useRef } from "react";
import { Button, MonoLabel, IcPlus, IcImage, IcFilm, IcChevronDown, IcRetry, IcX } from "@/components/ds";
import { GEN_PRICE_USD_PER_IMAGE, GEN_PRICE_USD_PER_VIDEO } from "@artlio/core";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { uploadReference } from "@/lib/actions";

const Caret = () => <IcChevronDown size={13} style={{ marginLeft: 2, color: "var(--fg-3)" }} />;
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u);

const SESSIONS = [
  { title: "This session", ago: "now", tint: "linear-gradient(135deg,#3a2f2a,#5a4438)", active: true },
];

type Result = { prompt: string; meta: string; urls: string[]; pending?: boolean };

export function GenSpace({ projectId }: { projectId: string | null }) {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("a cinematic portrait, soft window light");
  const [count] = useState(1);
  const isVideo = kind === "video";
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refImg, setRefImg] = useState<{ id: string; src: string } | null>(null); // i2v source
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  function onRefFile(e: React.ChangeEvent<HTMLInputElement>) {
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
      setRefImg(res);
      setKind("video"); // a reference image animates → image-to-video
    })();
  }

  function generate() {
    const text = prompt.trim();
    if (!text || !projectId || busy) return;
    setError(null);
    setBusy(true);
    const placeholder: Result = { prompt: text, meta: `${isVideo ? "Kling" : "Seedream"} · generating…`, urls: [], pending: true };
    setResults((r) => [placeholder, ...r]);
    (async () => {
      const res = await startGen({ projectId, prompt: text, entityIds: [], count: isVideo ? 1 : count, kind, model: isVideo ? "kling" : "seedream", sourceGenerationId: isVideo && refImg ? refImg.id : undefined });
      if ("error" in res) { setError(res.error); setBusy(false); setResults((r) => r.filter((x) => x !== placeholder)); return; }
      pollTimer.current = setInterval(async () => {
        const job = await getGenJob(res.id);
        if (!job) return;
        if (job.status === "DONE") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setBusy(false);
          setResults((r) => r.map((x) => x === placeholder ? { prompt: text, meta: isVideo ? "Kling · video" : `Seedream · ${job.urls.length} image`, urls: job.urls } : x));
        } else if (job.status === "FAILED") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setBusy(false);
          setError(job.error || "Generation failed.");
          setResults((r) => r.filter((x) => x !== placeholder));
        }
      }, 2000);
    })();
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
            {refImg ? (
              <span style={{ position: "relative", width: 30, height: 30, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line-2)", flex: "none" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={refImg.src} alt="reference" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button onClick={() => setRefImg(null)} aria-label="Remove reference"
                  style={{ position: "absolute", top: 0, right: 0, width: 14, height: 14, display: "grid", placeItems: "center", background: "rgba(6,8,11,.7)", border: "none", color: "var(--fg-1)", cursor: "pointer", padding: 0 }}>
                  <IcX size={9} />
                </button>
              </span>
            ) : (
              <button className="al-iconbtn al-iconbtn-md" aria-label="Add image reference for image-to-video"
                onClick={() => !uploading && fileInput.current?.click()} disabled={uploading || !projectId}>
                <IcImage size={16} />
              </button>
            )}
            <button className="al-iconbtn al-iconbtn-md" aria-label="Add video reference"><IcFilm size={16} /></button>
            <button className="al-iconbtn al-iconbtn-md" aria-label="Add control reference"><IcPlus size={16} /></button>
            {uploading && <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>uploading…</span>}
            {refImg && !uploading && <span style={{ font: "var(--text-caption)", color: "var(--fg-2)" }}>→ image-to-video</span>}
            <span className="al-promptbar-spacer" />
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>~${(isVideo ? GEN_PRICE_USD_PER_VIDEO : count * GEN_PRICE_USD_PER_IMAGE).toFixed(2)}</span>
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onRefFile} />
          <div className="al-input-wrap" style={{ border: "none", background: "none", padding: 0 }}>
            <input placeholder="Describe the shot — subject, camera, light…" aria-label="Describe the shot"
              value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") generate(); }} />
          </div>
          <div className="al-promptbar-row">
            <div className="al-seg" role="tablist">
              <button role="tab" aria-selected={!isVideo} className={`al-seg-item${!isVideo ? " al-seg-item-active" : ""}`} onClick={() => setKind("image")}>Photo</button>
              <button role="tab" aria-selected={isVideo} className={`al-seg-item${isVideo ? " al-seg-item-active" : ""}`} onClick={() => setKind("video")}>Video</button>
            </div>
            <button className="al-chip al-chip-mono">{isVideo ? "Kling" : "Seedream"}<Caret /></button>
            <button className="al-chip al-chip-mono">1024px</button>
            <button className="al-chip al-chip-mono">16:9</button>
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
