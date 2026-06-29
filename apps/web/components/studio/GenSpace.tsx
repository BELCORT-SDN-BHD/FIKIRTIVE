"use client";
/**
 * Gen space surface (Fikirtive Studio + LTX gen-workspace). The generation
 * workbench: a rich composer (reference slots + mode + model + per-model
 * duration/More settings + live price) and a results stack.
 *
 * Each video model exposes exactly the controls its fal endpoint accepts
 * (GEN_VIDEO_MODEL_OPTIONS): a seconds dropdown plus a "More" panel of
 * resolution / aspect / audio / clip-count, whichever apply. Price is dynamic
 * (videoPriceUsd) and shown before spend; failures never charge.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { Button, IcPlus, IcImage, IcChevronDown, IcRetry, IcX, IcSparkle } from "@/components/ds";
import {
  GEN_PRICE_USD_PER_IMAGE, MAX_GEN_COUNT, GEN_VIDEO_MODEL_INFO,
  GEN_VIDEO_MODEL_OPTIONS, videoDefaults, videoPriceUsd, type GenVideoModel,
  activeVideoModel, modelFamily, deriveMode, lintPrompt, castFindings, type ModelDirectiveRules,
  VIDEO_CREDITS_BY_RESOLUTION,
  isFlatPricedVideoModel,
  newId,
} from "@fikirtive/core";
import { startGen, getGenJob, getRecentGenResults } from "@/lib/gen-actions";
import { uploadReference } from "@/lib/actions";
import { enhancePrompt } from "@/lib/cowork-actions";
import { MentionInput, buildMentionDoc } from "@/components/MentionInput";
import { Lightbox } from "@/components/Lightbox";
import type { EntityDTO } from "@/lib/types";

const Caret = () => <IcChevronDown size={13} style={{ marginLeft: 2, color: "var(--fg-3)" }} />;
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u);
const POLL_CAP = 120; // ~4 min at 2s — a stuck job can't pin the composer forever

/** Failure copy that never lies about money: a post-charge failure says so. */
function failMsg(job: { error: string; spent?: boolean }): string {
  if (job.spent) return `Charged, but saving the result failed${job.error ? `: ${job.error}` : ""} — reload to check; it'll be reconciled.`;
  return job.error || "Generation failed (you were not charged).";
}

// Composer draft is component-local state, so leaving Gen space UNMOUNTS GenSpace
// and the in-progress prompt is lost. Persist it in sessionStorage keyed by project
// so an unmount/remount within the SAME project restores it; the key isolates one
// project's draft from another's (the project-switch reset clears the live state).
type Draft = { prompt: string; promptIds: string[]; promptVariantSel: Record<string, string>; seedDoc: unknown };
const draftKey = (projectId: string) => `genspace-draft:${projectId}`;
function readDraft(projectId: string): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(draftKey(projectId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch { return null; }
}
function writeDraft(projectId: string, d: Draft) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(draftKey(projectId), JSON.stringify(d)); } catch { /* quota/private mode — drop */ }
}
function clearDraft(projectId: string) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(draftKey(projectId)); } catch { /* ignore */ }
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
function SettingRow({ label, options, value, onChange, labelFn }: {
  label: string; options: (string | number)[]; value: string | number; onChange: (v: string | number) => void;
  /** Optional: maps a raw option value to the button display label. Value binding is always the raw value. */
  labelFn?: (v: string | number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ font: "var(--text-caption)", color: "var(--fg-3)", width: 70, flex: "none" }}>{label}</span>
      <div className="al-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={String(o)} className={`al-seg-item${value === o ? " al-seg-item-active" : ""}`} onClick={() => onChange(o)}>{labelFn ? labelFn(o) : String(o)}</button>
        ))}
      </div>
    </div>
  );
}

export function GenSpace({ projectId, entities, rulesMap, onGoToElements }: { projectId: string; entities: EntityDTO[]; rulesMap: Record<string, Record<string, ModelDirectiveRules>>; onGoToElements: () => void }) {
  const [kind, setKind] = useState<"image" | "video">("image");
  // lazy-restore the composer draft (prompt + @mentions + editor doc) persisted for
  // THIS project, so an unmount/remount (navigating away & back) doesn't lose it
  const [restored] = useState(() => readDraft(projectId));
  const [prompt, setPrompt] = useState(restored?.prompt ?? "");
  const [promptIds, setPromptIds] = useState<string[]>(restored?.promptIds ?? []); // @mentioned entity ids
  const [promptVariantSel, setPromptVariantSel] = useState<Record<string, string>>(restored?.promptVariantSel ?? {}); // entityId → @mentioned variant
  const [composerKey, setComposerKey] = useState(0);        // bump to re-seed the editor after ✨ Enhance
  const [seedDoc, setSeedDoc] = useState<unknown>(restored?.seedDoc); // restored doc re-seeds MentionInput on mount
  const [enhancing, setEnhancing] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);   // promptCoach pill collapsed by default
  const [showBlock, setShowBlock] = useState(false);   // Guardian assist-bar (shown on a blocked Generate attempt)
  const [count, setCount] = useState(1);              // batch (video) / num images
  // Founder rule: ONE spendable video model. The picker below offers only this; any other
  // model would be cleanly rejected by startGen's assertSpendableModel gate (a no-spend
  // dead-end), so the default state starts here too — matching what the gate will accept.
  const lockedVideoModel = activeVideoModel() as GenVideoModel;
  const [videoModel, setVideoModel] = useState<GenVideoModel>(lockedVideoModel);
  const [vopts, setVopts] = useState(() => videoDefaults(lockedVideoModel)); // seconds/res/aspect/fps/audio
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
  const busyRef = useRef(false); // synchronous mirror of `busy`: a same-frame double-click can't be caught by the `busy` STATE (React hasn't re-rendered yet), so it would launch twice and double-spend. The ref flips synchronously, so the 2nd click sees it.
  const enhancingRef = useRef(false); // same synchronous guard for Enhance (also spends fal) — `enhancing` state has the identical double-click race
  const seq = useRef(0);     // stable result ids

  // poll an EXISTING job (a generation that was still running when we navigated back)
  // and mark its tile — like launch()'s poller but background (no busy/active touch).
  function resumePoll(jobId: string, resultId: number) {
    let n = 0;
    const mark = (patch: Partial<Result>) => setResults((rs) => rs.map((x) => (x.id === resultId ? { ...x, ...patch } : x)));
    const t = setInterval(async () => {
      n += 1;
      try {
        const job = await getGenJob(jobId);
        if (!job) { if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Status unknown — reload to check." }); } return; }
        if (job.status === "DONE") { clearInterval(t); pollers.current.delete(t); mark({ status: "done", urls: job.urls }); }
        else if (job.status === "FAILED") { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: failMsg(job) }); }
        else if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Still running — reload to check." }); }
      } catch { if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Status unknown — reload to check." }); } }
    }, 2000);
    pollers.current.add(t);
  }

  // rehydrate the result panel from the DB on mount/project-switch — the list is
  // client-state, so leaving Gen space (or a reload) drops finished gens from view.
  // GenSpace isn't keyed by project, so on a ?p= switch we must RESET first (else the
  // old project's tiles + pollers bleed into the new one). Historical results aren't
  // replayable (we don't reconstruct the exact request), so retry is off; an in-flight
  // job (came back while still running) resumes polling.
  //
  // Reset the live STATE during render (React's "adjust state when a prop changes"
  // pattern) instead of synchronously inside the effect — a synchronous setState in an
  // effect body triggers cascading renders (react-hooks/set-state-in-effect). Doing it
  // here also guarantees stale tiles vanish even when the new project has zero recent
  // results, since the async hydrate below early-returns and never calls setResults.
  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    setBusy(false);
    setResults([]);
    // GenSpace isn't remounted on a ?p= switch, so the lazy draft-restore above won't
    // re-run. Swap the in-memory draft to the NEW project's persisted one (or clear it),
    // and re-seed the editor (composerKey/seedDoc) so the old project's text can't bleed in.
    const next = readDraft(projectId);
    setPrompt(next?.prompt ?? "");
    setPromptIds(next?.promptIds ?? []);
    setPromptVariantSel(next?.promptVariantSel ?? {});
    setSeedDoc(next?.seedDoc);
    setComposerKey((k) => k + 1);
  }
  useEffect(() => {
    let alive = true;
    const ps = pollers.current; // ref Set is stable, but copy it for the cleanup (react-hooks/exhaustive-deps)
    ps.forEach((t) => clearInterval(t)); ps.clear();
    active.current = 0; busyRef.current = false; seq.current = 0;
    getRecentGenResults(projectId).then((rows) => {
      if (!alive || !rows.length || seq.current > 0) return; // user already generated in this project → keep their live results
      const hydrated: Result[] = rows.map((row, i) => ({
        id: -(i + 1), // negative ids never collide with new gens (seq starts at 0, counts up)
        displayPrompt: row.prompt,
        label: row.kind === "video" ? (GEN_VIDEO_MODEL_INFO[row.model as GenVideoModel]?.label ?? row.model) : "Seedream",
        status: row.status === "DONE" ? "done" : row.status === "FAILED" ? "failed" : "pending",
        urls: row.urls,
        message: row.status === "FAILED" ? (row.error || "Generation failed") : undefined,
        req: { projectId, prompt: row.prompt, entityIds: [], count: 1, kind: row.kind, model: row.model } as GenReq,
        aspect: "16 / 9",
        retryable: false,
      }));
      setResults(hydrated);
      rows.forEach((row, i) => { if (row.status === "QUEUED" || row.status === "GENERATING") resumePoll(row.jobId, -(i + 1)); });
    }).catch(() => {});
    return () => { alive = false; ps.forEach((t) => clearInterval(t)); ps.clear(); };
  }, [projectId]);

  // persist the composer draft for this project on every change, so an unmount/remount
  // (or reload) restores it; an empty draft removes the key rather than storing blanks.
  useEffect(() => {
    if (!prompt && promptIds.length === 0 && seedDoc === undefined) clearDraft(projectId);
    else writeDraft(projectId, { prompt, promptIds, promptVariantSel, seedDoc });
  }, [projectId, prompt, promptIds, promptVariantSel, seedDoc]);

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

  // promptCoach ($0, offline): hints tuned to the (family, mode) being generated
  // for — read from the founder-curated rules threaded at page load
  const coachHints = useMemo(() => {
    const family = modelFamily(isVideo ? videoModel : "seedream");
    const mode = deriveMode({ kind, conditioned: promptIds.length > 0, hasSourceImage: !!refImg, hasTailImage: !!tailImg });
    const rules = family ? rulesMap[family]?.[mode] : undefined;
    const characterCount = entities.filter((e) => promptIds.includes(e.id) && e.type === "CHARACTER").length;
    return lintPrompt({ text: prompt, mode, rules, characterCount });
  }, [isVideo, videoModel, kind, promptIds, refImg, tailImg, prompt, entities, rulesMap]);

  // consistencyGuardian (client mirror): the same pure castFindings the server
  // runs, computed from the entities already threaded — instant pre-warn, no
  // round-trip. The server checkCast in startGen stays the money backstop.
  const blockers = useMemo(() => {
    const family = modelFamily(isVideo ? videoModel : "seedream");
    const mode = deriveMode({ kind, conditioned: promptIds.length > 0, hasSourceImage: !!refImg, hasTailImage: !!tailImg });
    const castRule = family ? rulesMap[family]?.[mode]?.castSeverity : undefined;
    const mentioned = entities.filter((e) => promptIds.includes(e.id)).map((e) => ({ id: e.id, name: e.name, type: e.type, liveRefCount: e.refs.length }));
    return castFindings({ requestedEntityIds: promptIds, entities: mentioned, castRule });
  }, [isVideo, videoModel, kind, promptIds, refImg, tailImg, entities, rulesMap]);

  function pickModel(m: GenVideoModel) {
    setVideoModel(m);
    setVopts(videoDefaults(m));
    if (!GEN_VIDEO_MODEL_INFO[m].tail) setTailImg(null);
    setCount((c) => Math.min(c, GEN_VIDEO_MODEL_OPTIONS[m].maxCount));
  }

  // ✨ Enhance — rewrite the composer's rough prompt into a vivid one (mock $0 in
  // dev, fal LLM in prod), then re-seed the editor, re-chipping any @-named
  // entities so the wedge survives. promptIds is preserved for generation.
  async function enhance() {
    const text = prompt.trim();
    if (!text || enhancing || busy || enhancingRef.current) return; // enhancingRef catches a same-frame double-click that `enhancing` (state) can't
    enhancingRef.current = true;
    setError(null);
    setEnhancing(true);
    // send the gen-shape so the server can tune the rewrite to (family, mode);
    // the server derives the mode (R3) — we pass shape, not a mode string
    let res: Awaited<ReturnType<typeof enhancePrompt>> | null = null;
    try {
      res = await enhancePrompt({
        projectId, text,
        model: isVideo ? videoModel : "seedream",
        kind,
        conditioned: promptIds.length > 0,
        hasSource: !!refImg,
        hasTail: !!tailImg,
      });
    } catch { res = null; }
    enhancingRef.current = false;
    setEnhancing(false);
    if (!res) { setError("Couldn't enhance — please try again."); return; }
    if ("error" in res) { setError(res.error); return; }
    // carry each mention's variant binding into the rebuilt doc so Enhance keeps it
    const mentioned = entities.filter((e) => promptIds.includes(e.id)).map((e) => ({ ...e, variantId: promptVariantSel[e.id] }));
    setPrompt(res.text);
    setSeedDoc(buildMentionDoc(res.text, mentioned));
    setComposerKey((k) => k + 1);
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
    if (active.current <= 0) { active.current = 0; busyRef.current = false; setBusy(false); }
  }

  // launch one job (its own tile) + poll it; failures land on the tile, not a shared banner
  function launch(displayPrompt: string, label: string, req: GenReq, aspect: string) {
    const id = (seq.current += 1);
    const placeholder: Result = { id, displayPrompt, label, status: "pending", urls: [], req, aspect, retryable: true };
    active.current += 1;
    setResults((r) => [placeholder, ...r]);
    const mark = (patch: Partial<Result>) => setResults((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    (async () => {
      let res: Awaited<ReturnType<typeof startGen>>;
      try {
        res = await startGen(req);
      } catch (e) {
        // startGen REJECTED (not a returned {error}, e.g. network/DB) — must never
        // strand the composer with busy stuck true (#4)
        mark({ status: "failed", message: e instanceof Error ? e.message.slice(0, 200) : "Couldn't start — try again." });
        finishOne();
        return;
      }
      if ("error" in res) { mark({ status: "failed", message: res.error }); finishOne(); return; }
      const jobId = res.id;
      let n = 0;
      const t = setInterval(async () => {
        n += 1;
        // poll-cap cases stay non-retryable: the job may still be running/charged, so re-running could double-spend
        try {
          const job = await getGenJob(jobId);
          if (!job) { if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Status unknown — reload to check (don't re-run, you may have been charged).", retryable: false }); finishOne(); } return; }
          if (job.status === "DONE") { clearInterval(t); pollers.current.delete(t); mark({ status: "done", urls: job.urls }); finishOne(); }
          else if (job.status === "FAILED") { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: failMsg(job) }); finishOne(); }
          else if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Still running — reload to check (don't re-run, you may have been charged).", retryable: false }); finishOne(); }
        } catch {
          // transient poll error (getGenJob threw) — keep polling; the cap ends it
          if (n > POLL_CAP) { clearInterval(t); pollers.current.delete(t); mark({ status: "failed", message: "Status unknown — reload to check (don't re-run, you may have been charged).", retryable: false }); finishOne(); }
        }
      }, 2000);
      pollers.current.add(t);
    })();
  }

  function generate() {
    const text = prompt.trim();
    if (!text || busy || busyRef.current) return; // busyRef catches a same-frame double-click that `busy` (state) can't
    // Guardian: a blocked attempt reveals the amber assist-bar and spends $0
    // (the server backstop would block too). Generate stays live so the button
    // is never a dead grey — we intercept on click and show the fix.
    if (blockers.length > 0) { setShowBlock(true); setError(null); return; }
    busyRef.current = true; // set AFTER the block check so a blocked attempt doesn't strand it
    setShowBlock(false);
    setError(null);
    setShowMore(false);
    setBusy(true);
    // only send variantSel when a chip actually bound a variant — keeps old/bare
    // requests shaped exactly as before (worker reads undefined → base-ref conditioning)
    const vsel = Object.keys(promptVariantSel).length ? promptVariantSel : undefined;
    // money-safety: a stable per-click key so a network retry / double-SUBMIT of the SAME
    // startGen request dedupes server-side (active-key index) instead of paying twice.
    // busyRef already stops a same-frame double-CLICK; this covers the re-submit it can't.
    const idem = newId();
    if (isVideo) {
      // fal video has no num_videos — a batch of N is N independent one-clip jobs
      // (each keeps the worker's exactly-once spend). Only send a control the model has.
      const n = Math.max(1, Math.min(count, opts.maxCount));
      const fullPrompt = text;
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
          variantSel: vsel,
          idempotencyKey: `${idem}:${i}`, // each clip in the batch is its own independent job
        }, aspect);
      }
    } else {
      launch(text, "Seedream", { projectId, prompt: text, entityIds: promptIds, count, kind: "image", model: "seedream", variantSel: vsel, idempotencyKey: idem }, "16 / 9");
    }
  }

  function retry(r: Result) {
    if (busyRef.current) return; // same double-fire guard as generate() — retry also spends
    busyRef.current = true;
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
                <SettingRow label="Resolution" options={opts.resolutions} value={vopts.resolution} onChange={(v) => setVopts((o) => ({ ...o, resolution: String(v) }))}
                  labelFn={(r) => {
                    if (isFlatPricedVideoModel(videoModel)) {
                      const cr = VIDEO_CREDITS_BY_RESOLUTION[String(r)];
                      return cr != null ? `${String(r)} · ${cr} cr` : String(r);
                    }
                    return String(r); // fal models: cost shown via the ~$ duration estimate below
                  }} />
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
              <MentionInput entities={entities} docKey={String(composerKey)} initialDoc={seedDoc} disabled={enhancing}
                placeholder="Describe the shot — use @ to add elements (⌘↵ to generate)"
                onChange={(t, i, vs) => { setPrompt(t); setPromptIds(i); setPromptVariantSel(vs); }} onSubmit={generate} />
            </div>
          </div>
          {coachHints.length > 0 && (
            <div style={{ padding: "4px 2px 0" }}>
              <button type="button" onClick={() => setCoachOpen((o) => !o)} aria-expanded={coachOpen}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "var(--text-caption)", color: "var(--fg-2)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, flex: "none", background: coachHints.some((h) => h.tone === "warn") ? "var(--warning)" : "var(--fg-3)" }} />
                {coachHints.length} {coachHints.length === 1 ? "tip" : "tips"} for {isVideo ? info.label : "Seedream"}
                <span aria-hidden style={{ transform: coachOpen ? "rotate(180deg)" : "none", display: "inline-flex" }}><IcChevronDown size={12} /></span>
              </button>
              {coachOpen && (
                <div style={{ display: "grid", gap: 5, padding: "6px 0 2px" }}>
                  {coachHints.map((h) => (
                    <div key={h.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, font: "var(--text-caption)", color: h.tone === "warn" ? "var(--warning)" : "var(--fg-2)" }}>
                      <span aria-hidden style={{ marginTop: 5, width: 6, height: 6, borderRadius: 99, flex: "none", background: h.tone === "warn" ? "var(--warning)" : "var(--fg-3)" }} />
                      <span>{h.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {showBlock && blockers.length > 0 && (
            <div role="alert" style={{ margin: "8px 0 0", padding: "10px 12px", borderRadius: 10, background: "rgba(255,210,126,.08)", border: "1px solid rgba(255,210,126,.25)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span aria-hidden style={{ color: "var(--warning)", marginTop: 1, flex: "none", display: "inline-flex" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M10.363 3.591 2.257 17.125a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.871L13.637 3.591a1.914 1.914 0 0 0-3.274 0z" /><path d="M12 16h.01" /></svg>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {blockers.length > 1 && <div style={{ font: "var(--text-caption)", color: "var(--warning)", fontWeight: 500, marginBottom: 6 }}>{blockers.length} things to fix before generating</div>}
                  <div style={{ display: "grid", gap: 4 }}>
                    {blockers.map((b, i) => <div key={i} style={{ font: "var(--text-small)", color: "var(--warning)", lineHeight: 1.5 }}>{b.message}</div>)}
                  </div>
                  {blockers.some((b) => b.kind === "character-no-refs") && (
                    <button type="button" className="al-chip al-chip-mono" onClick={onGoToElements} style={{ marginTop: 8 }}><IcPlus size={12} /> Add a reference in Elements</button>
                  )}
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => setShowBlock(false)} style={{ flex: "none", background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", padding: 2, display: "inline-flex" }}><IcX size={13} /></button>
              </div>
            </div>
          )}
          <div className="al-promptbar-row">
            <div className="al-seg" role="tablist">
              <button role="tab" aria-selected={!isVideo} className={`al-seg-item${!isVideo ? " al-seg-item-active" : ""}`} disabled={busy} onClick={() => { setKind("image"); setCount(1); setShowMore(false); }}>Photo</button>
              <button role="tab" aria-selected={isVideo} className={`al-seg-item${isVideo ? " al-seg-item-active" : ""}`} disabled={busy} onClick={() => setKind("video")}>Video</button>
            </div>
            {isVideo ? (
              <>
                <select aria-label="Video model" value={videoModel} disabled={busy} onChange={(e) => pickModel(e.target.value as GenVideoModel)} style={selectStyle}>
                  {[lockedVideoModel].map((m) => <option key={m} value={m} style={optStyle}>{GEN_VIDEO_MODEL_INFO[m].label}{GEN_VIDEO_MODEL_INFO[m].sound ? " · sound" : ""}</option>)}
                </select>
                <span className="al-seg" role="radiogroup" aria-label="Duration" style={{ display: "inline-flex" }}>
                  {opts.durations.map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={vopts.seconds === s} disabled={busy}
                      className={`al-seg-item${vopts.seconds === s ? " al-seg-item-active" : ""}`}
                      onClick={() => setVopts((o) => ({ ...o, seconds: s }))}>{s}s</button>
                  ))}
                </span>
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
            <button className="al-chip al-chip-mono" onClick={enhance} disabled={enhancing || busy || prompt.trim().length === 0} title="Rewrite the prompt into a vivid, detailed one" aria-label="Enhance prompt"><IcSparkle size={13} />{enhancing ? " Enhancing…" : " Enhance"}</button>
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
