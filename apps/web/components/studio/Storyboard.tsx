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
import { Button, MonoLabel, IcPlus, IcRetry, IcSparkle, IcPlay } from "@/components/ds";
import { addShot, setShotPromptText } from "@/lib/studio-actions";
import { startGen, getGenJob } from "@/lib/gen-actions";

export type StudioShot = {
  id: string;
  number: number;
  prompt: string;
  entityIds: string[];
  imageUrl: string | null;
  videoUrl: string | null;
};

function ShotCard({ projectId, shot }: { projectId: string; shot: StudioShot }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(shot.prompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

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
      const res = await startGen({ projectId, shotId: shot.id, prompt: text, entityIds: shot.entityIds, count: 1, kind, model: kind === "video" ? "kling" : "seedream" });
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
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" full disabled={busy || prompt.trim().length === 0} onClick={() => run("image")}
            icon={shot.imageUrl || shot.videoUrl ? <IcRetry size={13} /> : <IcSparkle size={13} />}>
            {busy ? "…" : shot.imageUrl || shot.videoUrl ? "Image" : "Generate"}
          </Button>
          {(shot.imageUrl || shot.videoUrl) && (
            <Button size="sm" variant="glass" full disabled={busy} onClick={() => run("video")} icon={<IcPlay size={12} />}>
              Animate
            </Button>
          )}
        </div>
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

  function add() {
    setAdding(true);
    (async () => { await addShot(projectId); setAdding(false); router.refresh(); })();
  }

  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 20px" }}>
          <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Storyboard</h1>
          <span style={{ flex: 1 }} />
          <Button size="sm" icon={<IcPlus />} onClick={add} disabled={adding}>{adding ? "Adding…" : "Add shot"}</Button>
        </div>

        {shots.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", minHeight: "50vh", textAlign: "center" }}>
            <div>
              <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Plan your film, shot by shot</h2>
              <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 18px", maxWidth: 420 }}>
                Add a shot, write what happens (use @ to bring in your elements), then generate. Planning is free — you only spend when you generate.
              </p>
              <Button icon={<IcPlus />} onClick={add} disabled={adding}>Add the first shot</Button>
            </div>
          </div>
        ) : (
          <section>
            <div style={{ marginBottom: 12 }}><MonoLabel>Scene 1</MonoLabel></div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {shots.map((s) => <ShotCard key={s.id} projectId={projectId} shot={s} />)}
              <button className="drop-zone" style={{ width: 48, alignSelf: "stretch", minHeight: 150 }} aria-label="Add shot" onClick={add}>
                <IcPlus size={18} />
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
