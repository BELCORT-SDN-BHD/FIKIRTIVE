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
import { Button, MonoLabel, IcPlus, IcImage, IcRetry, IcSparkle, IcPlay, IcX, IcChevronDown } from "@/components/ds";
import { addShot, deleteShot, moveShot, addScene, setShotFrame, setShotTransition } from "@/lib/studio-actions";
import { saveShotPrompt, uploadReference, addSegmentToCut } from "@/lib/actions";
import { enhancePrompt } from "@/lib/cowork-actions";
import { coworkDraftStoryboard } from "@/lib/cowork-actions";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { GEN_PRICE_USD_PER_IMAGE, GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_INFO, GEN_VIDEO_MODEL_OPTIONS, videoDefaults, videoPriceUsd, type GenVideoModel } from "@artlio/core";
import type { EntityDTO } from "@/lib/types";
import { MentionInput, buildMentionDoc, resolveDoc } from "@/components/MentionInput";
import { setDnd, getDnd, hasDnd } from "@/lib/dnd";
import { Lightbox } from "@/components/Lightbox";

const usd = (n: number) => "~$" + n.toFixed(2);
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const POLL_CAP = 120; // ~4 min at 2s — a stuck job must not pin the card or invite a re-spend

/** Failure copy that never lies about money: a post-charge failure says so. */
function failMsg(job: { error: string; spent?: boolean }): string {
  if (job.spent) return `Charged, but saving the result failed${job.error ? `: ${job.error}` : ""} — reload to check; it'll be reconciled.`;
  return job.error || "Generation failed (you were not charged).";
}

export type Frame = { id: string; src: string };
export type StudioShot = {
  id: string;
  number: number; // within-scene display index (1..N)
  scene: number;
  prompt: string;
  entityIds: string[];
  promptDoc?: unknown; // Tiptap JSON — seeds the @mention editor
  imageUrl: string | null;
  videoUrl: string | null;
  hasStill: boolean;        // has a png/jpg/jpeg/webp still the worker can animate (legacy fallback)
  firstFrame: Frame | null; // i2v start keyframe (explicit segment model)
  lastFrame: Frame | null;  // optional i2v end keyframe (tail interpolation)
  transition: "in" | "out" | "both" | null; // segment fade → flows into the editor cut
};

function ShotCard({ projectId, shot, index, total, entities }: { projectId: string; shot: StudioShot; index: number; total: number; entities: EntityDTO[] }) {
  const router = useRouter();
  const [text, setText] = useState(shot.prompt);
  const [ids, setIds] = useState<string[]>(shot.entityIds);
  const [doc, setDoc] = useState<unknown>(shot.promptDoc);
  // entityId → @mentioned variant. Seeded from the PERSISTED doc (the mention nodes
  // carry variantId attrs) so a reloaded shot still conditions on its bound variant —
  // not just after the user re-edits. byId isn't needed for variant extraction.
  const [variantSel, setVariantSel] = useState<Record<string, string>>(() => resolveDoc((shot.promptDoc ?? EMPTY_DOC) as Parameters<typeof resolveDoc>[0], new Map()).variantSel);
  const [dirty, setDirty] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const enhancingRef = useRef(false); // synchronous guard: `enhancing` state can't catch a same-frame double-click → would spend Enhance twice
  const [enhanceDoc, setEnhanceDoc] = useState<unknown>(null); // ✨ Enhance re-seed (separate from server-sync)
  const [enhanceNonce, setEnhanceNonce] = useState(0);
  const [videoModel, setVideoModel] = useState<GenVideoModel>("kling");
  const [seconds, setSeconds] = useState(() => videoDefaults("kling").seconds);
  const [audioOn, setAudioOn] = useState(() => videoDefaults("kling").audio); // per-segment audio (sound models: off is cheaper)
  const vd = videoDefaults(videoModel);
  const opts = GEN_VIDEO_MODEL_OPTIONS[videoModel];
  const info = GEN_VIDEO_MODEL_INFO[videoModel];
  const animatePrice = videoPriceUsd(videoModel, { seconds, resolution: vd.resolution, audio: audioOn, count: 1 });
  const [busy, setBusy] = useState(false);                                  // Animate (video) in flight
  const [slotBusy, setSlotBusy] = useState<"first" | "last" | null>(null);   // a keyframe op in flight
  const [dropSlot, setDropSlot] = useState<"first" | "last" | null>(null);   // a candidate being dragged over a slot
  const [acting, setActing] = useState(false);                              // move/delete in flight
  const [error, setError] = useState<string | null>(null);
  const [addingToCut, setAddingToCut] = useState(false); // "Add to editor" in flight
  const [zoom, setZoom] = useState<{ src: string; kind: "image" | "video" } | null>(null); // click-to-enlarge
  const firstInput = useRef<HTMLInputElement | null>(null);
  const lastInput = useRef<HTMLInputElement | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const slotPolls = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); slotPolls.current.forEach((t) => clearInterval(t)); }, []);

  // a segment animates from its start frame; a legacy shot with no explicit frame
  // falls back (worker-side) to its latest png/jpg/jpeg/webp still (hasStill), so
  // Animate is enabled only when a real i2v source actually exists (never a video-only
  // or gif/avif shot, which would pass validation then fail before spend).
  const canAnimate = !!shot.firstFrame || shot.hasStill;
  const tailReady = !!(shot.lastFrame && info.tail); // end-frame interpolation will actually be sent
  const previewVideo = shot.videoUrl;
  const previewImage = shot.firstFrame?.src ?? shot.imageUrl ?? null; // explicit start frame wins the preview
  const empty = text.trim().length === 0;
  // recreate (re-seed) the editor only when the SERVER prompt changes — a stale
  // editor must never silently overwrite a newer server value (and re-spend on it)
  const docKey = shot.id + "|" + JSON.stringify(shot.promptDoc ?? null);
  const [seeded, setSeeded] = useState(docKey);
  // adopt a newer server prompt only when there are no unsaved local edits — so a
  // background refresh can't silently overwrite (and re-spend on) the wrong text
  useEffect(() => {
    if (dirty || docKey === seeded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded server-prompt sync; the guard above prevents overwriting/re-spending on unsaved edits
    setSeeded(docKey);
    setText(shot.prompt); setIds(shot.entityIds); setDoc(shot.promptDoc); setEnhanceDoc(null);
    setVariantSel(resolveDoc((shot.promptDoc ?? EMPTY_DOC) as Parameters<typeof resolveDoc>[0], new Map()).variantSel);
  }, [docKey, dirty, seeded, shot.prompt, shot.entityIds, shot.promptDoc]);

  function pickModel(m: GenVideoModel) { setVideoModel(m); setSeconds(videoDefaults(m).seconds); setAudioOn(videoDefaults(m).audio); }

  async function persist(): Promise<boolean> {
    if (!dirty) return true;
    const res = await saveShotPrompt(shot.id, JSON.stringify(doc ?? EMPTY_DOC), text.trim(), ids);
    if (res && "error" in res) { setError(res.error ?? "Couldn't save the prompt."); return false; }
    setDirty(false);
    return true;
  }

  // ✨ Enhance — rewrite this shot's rough prompt into a vivid one (mock $0 dev,
  // fal LLM prod), then re-seed the card editor re-chipping @-named entities.
  async function enhance() {
    const t = text.trim();
    if (!t || enhancing || busy || acting || slotBusy || enhancingRef.current) return; // enhancingRef catches a same-frame double-click
    enhancingRef.current = true;
    setError(null);
    setEnhancing(true);
    // the shot prompt drives the keyframe image (seedream) — tune the rewrite to
    // that mode (t2i, or i2i when entity refs condition it); server derives mode
    try {
      let res: Awaited<ReturnType<typeof enhancePrompt>> | null = null;
      try {
        res = await enhancePrompt({ projectId, text: t, model: "seedream", kind: "image", conditioned: ids.length > 0 });
      } catch { res = null; }
      if (!res) { setError("Couldn't enhance — please try again."); return; }
      if ("error" in res) { setError(res.error); return; }
      const built = buildMentionDoc(res.text, entities.filter((e) => ids.includes(e.id)).map((e) => ({ ...e, variantId: variantSel[e.id] })));
      setText(res.text); setDoc(built);
      setEnhanceDoc(built); setEnhanceNonce((n) => n + 1);
      // persist now — the Enhance click already blurred the editor (before this content
      // existed), so the onBlur save would miss it and a refresh would lose the rewrite (Codex round 2)
      const saved = await saveShotPrompt(shot.id, JSON.stringify(built), res.text.trim(), ids);
      if (saved && "error" in saved) { setError(saved.error ?? "Couldn't save the enhanced prompt."); setDirty(true); return; }
      setDirty(false);
    } finally {
      // reset across the FULL handler (incl. the saveShotPrompt persist) on every path
      enhancingRef.current = false;
      setEnhancing(false);
    }
  }

  function remove() {
    if (acting || busy || slotBusy) return;
    setActing(true);
    (async () => {
      const res = await deleteShot(shot.id);
      if (res && "error" in res) { setError(res.error); setActing(false); return; }
      router.refresh();
    })();
  }
  function move(dir: "left" | "right") {
    if (acting || busy || slotBusy) return;
    setActing(true);
    (async () => {
      const res = await moveShot(shot.id, dir);
      setActing(false);
      if (res && "error" in res) { setError(res.error); return; }
      router.refresh();
    })();
  }

  // Generate a keyframe from the prompt — a candidate image (no shotId, so it never
  // becomes the shot's render), then record it in the slot. Failures never charge.
  function genFrame(slot: "first" | "last") {
    if (empty || busy || slotBusy) return;
    setError(null); setSlotBusy(slot);
    (async () => {
      if (!(await persist())) { setSlotBusy(null); return; }
      const res = await startGen({ projectId, prompt: text.trim(), entityIds: ids, count: 1, kind: "image", model: "seedream", idempotencyKey: `frame:${shot.id}:${slot}`, ...(Object.keys(variantSel).length ? { variantSel } : {}) });
      if ("error" in res) { setError(res.error); setSlotBusy(null); return; }
      let n = 0;
      const t = setInterval(async () => {
        n += 1;
        const job = await getGenJob(res.id);
        // a poll-cap timeout stays a "don't re-run" message — the job may still be
        // running/charged, so re-generating could double-spend
        if (!job) { if (n > POLL_CAP) { clearInterval(t); slotPolls.current.delete(t); setSlotBusy(null); setError("Status unknown — reload to check (don't re-run, you may have been charged)."); } return; }
        if (job.status === "DONE") {
          clearInterval(t); slotPolls.current.delete(t);
          const genId = job.generationIds[0];
          if (!genId) { setSlotBusy(null); setError("Generation produced no image."); return; }
          const r = await setShotFrame(shot.id, slot, genId);
          setSlotBusy(null);
          if (r && "error" in r) { setError(r.error); return; }
          router.refresh();
        } else if (job.status === "FAILED") {
          clearInterval(t); slotPolls.current.delete(t);
          setSlotBusy(null); setError(failMsg(job));
        } else if (n > POLL_CAP) {
          clearInterval(t); slotPolls.current.delete(t);
          setSlotBusy(null); setError("Still generating — reload to check (don't re-run, you may have been charged).");
        }
      }, 2000);
      slotPolls.current.add(t);
    })();
  }
  function uploadFrame(slot: "first" | "last", file: File) {
    if (busy || slotBusy) return;
    setError(null); setSlotBusy(slot);
    (async () => {
      const fd = new FormData(); fd.append("files", file);
      const up = await uploadReference(projectId, fd);
      if ("error" in up) { setError(up.error); setSlotBusy(null); return; }
      const r = await setShotFrame(shot.id, slot, up.id);
      setSlotBusy(null);
      if (r && "error" in r) { setError(r.error); return; }
      router.refresh();
    })();
  }
  function clearFrame(slot: "first" | "last") {
    if (busy || slotBusy) return;
    setSlotBusy(slot);
    (async () => {
      const r = await setShotFrame(shot.id, slot, null);
      setSlotBusy(null);
      if (r && "error" in r) { setError(r.error); return; }
      router.refresh();
    })();
  }

  function animate() {
    if (!canAnimate || empty || busy || slotBusy) return;
    setError(null);
    setBusy(true);
    (async () => {
      if (!(await persist())) { setBusy(false); return; }
      const t = text.trim();
      const fullPrompt = t;
      const res = await startGen({
        projectId, shotId: shot.id, prompt: fullPrompt, entityIds: ids, count: 1, kind: "video", model: videoModel,
        sourceGenerationId: shot.firstFrame?.id ?? undefined,
        tailGenerationId: tailReady ? shot.lastFrame!.id : undefined,
        durationSeconds: seconds,
        resolution: opts.resolutions.length ? vd.resolution : undefined,
        audio: opts.audioToggle ? audioOn : undefined,
        idempotencyKey: `animate:${shot.id}`,
        ...(Object.keys(variantSel).length ? { variantSel } : {}),
      });
      if ("error" in res) { setError(res.error); setBusy(false); return; }
      let n = 0;
      poll.current = setInterval(async () => {
        n += 1;
        const job = await getGenJob(res.id);
        if (!job) { if (n > POLL_CAP) { if (poll.current) clearInterval(poll.current); setBusy(false); setError("Status unknown — reload to check (don't re-run, you may have been charged)."); } return; }
        if (job.status === "DONE") { if (poll.current) clearInterval(poll.current); setBusy(false); router.refresh(); }
        else if (job.status === "FAILED") { if (poll.current) clearInterval(poll.current); setBusy(false); setError(failMsg(job)); }
        else if (n > POLL_CAP) { if (poll.current) clearInterval(poll.current); setBusy(false); setError("Still animating — reload to check (don't re-run, you may have been charged)."); }
      }, 2000);
    })();
  }

  // segment fade — persisted on the shot; flows into the editor cut via buildBoardEdit
  function changeTransition(v: string) {
    const next = v === "in" || v === "out" || v === "both" ? v : null;
    setError(null);
    (async () => {
      const r = await setShotTransition(shot.id, next);
      if (r && "error" in r) { setError(r.error); return; }
      router.refresh();
    })();
  }

  // extract the finished segment's video into the editor cut, then jump to it
  function addToEditor() {
    if (addingToCut || busy || !!slotBusy) return;
    setError(null); setAddingToCut(true);
    (async () => {
      try {
        const res = await addSegmentToCut(shot.id);
        if ("error" in res) { setError(res.error); return; }
        // the page re-runs with view=editor and Studio's effect switches the surface
        router.push(`/studio?p=${projectId}&view=editor`);
      } finally {
        setAddingToCut(false); // always clear so the button never sticks on "Adding…"
      }
    })();
  }

  // one keyframe slot — a square thumbnail (gen-from-prompt / upload / clear).
  // Last frame is optional and accented; defining it as a plain JSX-returning
  // function (not a component) keeps the <img> from remounting on every render.
  const renderSlot = (slot: "first" | "last") => {
    const frame = slot === "first" ? shot.firstFrame : shot.lastFrame;
    const inputRef = slot === "first" ? firstInput : lastInput;
    const accent = slot === "last";
    const isBusy = slotBusy === slot;
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div data-dnd={`slot-${slot}`}
          onDragOver={(e) => { if (hasDnd(e.dataTransfer, "candidate-frame") && !busy && !slotBusy) { e.preventDefault(); setDropSlot(slot); } }}
          onDragLeave={() => setDropSlot(null)}
          onDrop={(e) => {
            e.preventDefault(); setDropSlot(null);
            const payload = getDnd(e.dataTransfer);
            if (payload?.kind !== "candidate-frame" || busy || slotBusy) return;
            setError(null); setSlotBusy(slot);
            (async () => {
              try {
                const r = await setShotFrame(shot.id, slot, payload.generationId);
                if (r && "error" in r) setError(r.error); else router.refresh();
              } catch { setError("Couldn't attach that frame — try again."); }
              finally { setSlotBusy(null); }
            })();
          }}
          style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: "var(--radius-sm)", overflow: "hidden", border: `1px solid ${dropSlot === slot ? "rgba(120,160,255,.9)" : accent ? "rgba(120,160,255,.45)" : "var(--line-2)"}`, background: "var(--glass-1)", display: "grid", placeItems: "center" }}>
          {frame ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={frame.src} alt={`${slot} frame`} title="Click to enlarge" onClick={() => setZoom({ src: frame.src, kind: "image" })} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} />
              <button onClick={() => clearFrame(slot)} aria-label={`Clear ${slot} frame`} disabled={busy || !!slotBusy} style={{ position: "absolute", top: 3, right: 3, width: 16, height: 16, display: "grid", placeItems: "center", borderRadius: "50%", background: "rgba(6,8,11,.7)", border: "1px solid var(--line-2)", color: "var(--fg-1)", cursor: "pointer", padding: 0, zIndex: 2 }}><IcX size={9} /></button>
            </>
          ) : isBusy ? (
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>…</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center" }}>
              <button className="al-iconbtn al-iconbtn-sm" aria-label={`Generate ${slot} frame from prompt`} title={empty ? "Write a prompt first" : "Generate from prompt"} disabled={empty || busy || !!slotBusy} onClick={() => genFrame(slot)}><IcSparkle size={13} /></button>
              <button className="al-iconbtn al-iconbtn-sm" aria-label={`Upload ${slot} frame`} title="Upload an image" disabled={busy || !!slotBusy} onClick={() => inputRef.current?.click()}><IcImage size={13} /></button>
            </div>
          )}
        </div>
        <p style={{ font: "var(--text-caption)", color: accent ? "rgba(150,180,255,.85)" : "var(--fg-3)", margin: "3px 0 0", textAlign: "center" }}>{slot === "first" ? "Start" : "End · optional"}</p>
      </div>
    );
  };

  return (
    <div className="al-mediacard" style={{ width: 240, flex: "none", cursor: "default" }}>
      <div style={{ position: "relative", aspectRatio: "16 / 10", background: (previewVideo || previewImage) ? "#000" : "var(--glass-1)" }}>
        <span style={{ position: "absolute", top: 8, left: 8, font: "var(--text-mono-meta)", color: "var(--fg-2)", zIndex: 2 }}>▦ {shot.number}</span>
        {previewVideo ? (
          <video src={previewVideo} muted loop autoPlay playsInline title="Click to enlarge" onClick={() => setZoom({ src: previewVideo, kind: "video" })} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} />
        ) : previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewImage} alt="" title="Click to enlarge" onClick={() => setZoom({ src: previewImage, kind: "image" })} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} />
        ) : (
          <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 12, textAlign: "center", font: "var(--text-caption)", color: "var(--fg-3)" }}>Set a start frame below</span>
        )}
        {previewVideo && <span style={{ position: "absolute", top: 8, right: 8, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "rgba(6,8,11,.6)", padding: "1px 6px", borderRadius: 4, zIndex: 2 }}>▶ video</span>}
        {busy && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(6,8,11,.55)", font: "var(--text-caption)", color: "var(--fg-2)" }}>animating…</span>}
      </div>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button className="al-iconbtn al-iconbtn-sm" aria-label="Move shot earlier" disabled={acting || busy || !!slotBusy || index === 0} onClick={() => move("left")}>
            <IcChevronDown size={12} style={{ transform: "rotate(90deg)" }} />
          </button>
          <button className="al-iconbtn al-iconbtn-sm" aria-label="Move shot later" disabled={acting || busy || !!slotBusy || index === total - 1} onClick={() => move("right")}>
            <IcChevronDown size={12} style={{ transform: "rotate(-90deg)" }} />
          </button>
          <span style={{ flex: 1 }} />
          <button className="al-iconbtn al-iconbtn-sm" aria-label="Delete shot" disabled={acting || busy || !!slotBusy} onClick={remove}><IcX size={12} /></button>
        </div>

        {/* keyframes — the segment's start frame → optional end frame (image-to-video) */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {renderSlot("first")}
          <IcPlay size={11} style={{ color: "var(--fg-3)", flex: "none", marginTop: -12 }} />
          {renderSlot("last")}
        </div>
        {shot.lastFrame && !info.tail && (
          <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>End frame is ignored by {info.label} — pick a model that supports one.</p>
        )}

        <Button size="sm" full disabled={busy || acting || !!slotBusy || !canAnimate || empty} onClick={animate} icon={previewVideo ? <IcRetry size={13} /> : <IcPlay size={12} />}>
          {busy ? "Animating…" : previewVideo ? "Re-animate" : "Animate"}
        </Button>
        {previewVideo && (
          <Button size="sm" variant="glass" full disabled={addingToCut || busy || !!slotBusy} onClick={addToEditor}>
            {addingToCut ? "Adding…" : "→ Add to editor"}
          </Button>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <select aria-label="Animate model" value={videoModel} onChange={(e) => pickModel(e.target.value as GenVideoModel)} disabled={busy || acting || !!slotBusy}
            style={{ flex: 1, minWidth: 0, background: "#11151b", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 8px", color: "var(--fg-1)", font: "var(--text-caption)", cursor: "pointer", outline: "none" }}>
            {GEN_VIDEO_MODELS.map((m) => <option key={m} value={m} style={{ background: "#11151b" }}>{GEN_VIDEO_MODEL_INFO[m].label}{GEN_VIDEO_MODEL_INFO[m].sound ? " · sound" : ""}</option>)}
          </select>
          <span className="al-seg" role="radiogroup" aria-label="Duration in seconds" style={{ display: "inline-flex", flex: "none" }}>
            {opts.durations.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={seconds === s} disabled={busy || acting || !!slotBusy}
                className={`al-seg-item${seconds === s ? " al-seg-item-active" : ""}`}
                onClick={() => setSeconds(s)}>{s}s</button>
            ))}
          </span>
        </div>
        <select aria-label="Segment transition" value={shot.transition ?? ""} onChange={(e) => changeTransition(e.target.value)} disabled={busy || acting || !!slotBusy}
          style={{ width: "100%", background: "#11151b", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 8px", color: shot.transition ? "var(--fg-1)" : "var(--fg-3)", font: "var(--text-caption)", cursor: "pointer", outline: "none" }}>
          <option value="" style={{ background: "#11151b" }}>No transition</option>
          <option value="in" style={{ background: "#11151b" }}>Fade in</option>
          <option value="out" style={{ background: "#11151b" }}>Fade out</option>
          <option value="both" style={{ background: "#11151b" }}>Fade in + out</option>
        </select>
        {opts.audioToggle && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)", color: "var(--fg-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={audioOn} onChange={(e) => setAudioOn(e.target.checked)} disabled={busy || acting || !!slotBusy} /> Generate with audio
          </label>
        )}
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>
          Animate {usd(animatePrice)} · {seconds}s{audioOn ? ", audio" : ""}{tailReady ? ", end frame" : ""} · each frame {usd(GEN_PRICE_USD_PER_IMAGE)}
        </p>
        <div style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "6px 9px" }}>
          <MentionInput entities={entities} initialDoc={enhanceDoc ?? shot.promptDoc} docKey={`${seeded}|e${enhanceNonce}`} disabled={enhancing}
            placeholder="Describe this shot — use @ to add elements"
            onChange={(t, i, vs, d) => { setText(t); setIds(i); setVariantSel(vs); setDoc(d); setDirty(true); }}
            onBlur={() => { if (dirty) void persist(); }} />
        </div>
        <button className="al-chip al-chip-mono" onClick={enhance} disabled={enhancing || busy || acting || !!slotBusy || empty} title="Rewrite the prompt into a vivid, detailed one" aria-label="Enhance prompt" style={{ alignSelf: "flex-start" }}><IcSparkle size={12} />{enhancing ? " Enhancing…" : " Enhance"}</button>
        {error && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>{error}</p>}
      </div>
      <input ref={firstInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadFrame("first", f); }} />
      <input ref={lastInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadFrame("last", f); }} />
      {zoom && <Lightbox src={zoom.src} kind={zoom.kind} onClose={() => setZoom(null)} />}
    </div>
  );
}

export function Storyboard({ projectId, shots, entities, candidates }: { projectId: string; shots: StudioShot[]; entities: EntityDTO[]; candidates: { id: string; src: string }[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const draftingRef = useRef(false); // synchronous guard: `drafting` state can't catch a same-frame double-click → would draft (and spend) twice
  const [coworkErr, setCoworkErr] = useState<string | null>(null);
  const [coworkOk, setCoworkOk] = useState<string | null>(null);

  function draft() {
    const text = idea.trim();
    if (!text || drafting || draftingRef.current) return; // draftingRef catches a same-frame double-click
    draftingRef.current = true;
    setCoworkErr(null); setCoworkOk(null);
    setDrafting(true);
    (async () => {
      try {
        const res = await coworkDraftStoryboard({ projectId, idea: text });
        if ("error" in res) { setCoworkErr(res.error); return; }
        setIdea("");
        setCoworkOk(`Drafted ${res.scenes} scene${res.scenes === 1 ? "" : "s"} · ${res.shots} shot${res.shots === 1 ? "" : "s"}.`);
        router.refresh();
      } finally {
        draftingRef.current = false; // reset on EVERY path incl. throw (was: stranded the button on a rejection)
        setDrafting(false);
      }
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
              onKeyDown={(e) => { if (e.key === "Enter") draft(); }} aria-label="Ask Otto"
              placeholder="Ask Otto — describe your film and it'll draft the scenes & shots…"
              style={{ flex: 1, background: "none", border: "none", color: "var(--fg-1)", font: "var(--text-body)", outline: "none", minWidth: 0 }} />
            <Button size="sm" icon={<IcSparkle size={13} />} disabled={drafting || idea.trim().length === 0} onClick={draft}>{drafting ? "Drafting…" : "Draft"}</Button>
          </div>
          {coworkErr && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>{coworkErr}</p>}
          {coworkOk && <p style={{ font: "var(--text-caption)", color: "var(--fg-2)", margin: 0 }}>{coworkOk}</p>}
        </div>

        {candidates.length > 0 && (
          <div data-dnd="candidate-strip" style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", gap: 6, overflowX: "auto", padding: "8px 0", marginBottom: 14, background: "var(--glass-1)", borderBottom: "1px solid var(--line-2)" }}>
            {candidates.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={c.id} src={c.src} alt="" draggable data-dnd="candidate"
                onDragStart={(e) => setDnd(e.dataTransfer, { kind: "candidate-frame", generationId: c.id })}
                title="Drag onto a shot's Start or End frame"
                style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 4, flex: "none", cursor: "grab", border: "1px solid var(--line-2)" }} />
            ))}
          </div>
        )}

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
