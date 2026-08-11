"use client";
/**
 * The merchant's own edit desk (#780).
 *
 * The joining / captions / music engine has been running since the editor contract shipped;
 * what it lost with #606 was a door. This is that door — and it is deliberately a set of
 * buttons over lib/edit-desk-actions.ts, the SAME functions Otto's assistance path calls.
 * Nothing about a cut is decided in this file: it picks clips, names them to the server, and
 * renders back whatever the server says the video now is.
 *
 * Everything here is $0 — joining, captions and music only rewrite the saved video, and both
 * the export and the transcription run on our own machines. No credit is reserved anywhere in
 * this component, and there is no price to show.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Captions, Film, ImageIcon, LoaderCircle, Music, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getEditDesk,
  joinClipsIntoCut,
  setCutMusic,
  clearCutMusic,
  addCaptionsToClip,
  clearCutCaptions,
  exportSavedCut,
} from "@/lib/edit-desk-actions";
import { startCaption, getCaptionJob, getRenderJobs } from "@/lib/actions";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import type { CutSummary, DeskMedia } from "@/lib/edit-desk";

const POLL_MS = 2000;

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function EditDesk({ projectId }: { projectId: string }) {
  const [media, setMedia] = useState<DeskMedia[]>([]);
  const [cut, setCut] = useState<CutSummary>({ clips: [], seconds: 0, captionCount: 0, music: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [exportState, setExportState] = useState<{ status: string; progress: number; url: string | null } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    const res = await getEditDesk(projectId);
    if (!alive.current) return;
    if ("error" in res) {
      setError(res.error);
    } else {
      setMedia(res.media);
      setCut(res.cut);
    }
    setLoading(false);
  }, [projectId]);

  // Deferred with queueMicrotask for the same reason OttoConnections' load() is: setting
  // state synchronously in an effect body trips react-hooks/set-state-in-effect.
  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  /** Every write lands the same way: clear the last words, run it, show what the server said. */
  const run = useCallback(
    async (key: string, work: () => Promise<{ ok: true; cut: CutSummary } | { error: string }>, done: string) => {
      setBusy(key);
      setError(null);
      setMessage(null);
      try {
        const res = await work();
        if (!alive.current) return;
        if ("error" in res) setError(res.error);
        else {
          setCut(res.cut);
          setMessage(done);
        }
      } catch {
        if (alive.current) setError("That didn't go through — try again.");
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [],
  );

  const togglePick = (src: string) =>
    setPicked((current) => (current.includes(src) ? current.filter((s) => s !== src) : [...current, src]));

  /** Captions are two steps: work out the words, then put them on screen. The merchant
   *  presses once — the wait is ours to manage, not theirs to understand. */
  async function captionClip(src: string) {
    setBusy(`caption:${src}`);
    setError(null);
    setMessage(null);
    try {
      const started = await startCaption(projectId, src);
      if ("error" in started) {
        if (alive.current) setError(started.error);
        return;
      }
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const job = await getCaptionJob(started.id);
        if (!job) {
          setError("Those captions stopped before they finished — try again.");
          return;
        }
        if (job.status === "FAILED") {
          setError(job.error ?? "Those captions didn't come through — try again.");
          return;
        }
        if (job.status === "DONE") break;
      }
      const applied = await addCaptionsToClip(projectId, src);
      if (!alive.current) return;
      if ("error" in applied) setError(applied.error);
      else {
        setCut(applied.cut);
        setMessage("Captions are on that clip.");
      }
    } catch {
      if (alive.current) setError("Those captions didn't come through — try again.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function exportVideo() {
    setBusy("export");
    setError(null);
    setMessage(null);
    setExportState(null);
    try {
      // The desk never holds timeline JSON — the server renders the cut it has been saving all
      // along, which is why Export can't disagree with what the merchant just did.
      const started = await exportSavedCut(projectId);
      if ("error" in started) {
        if (alive.current) setError(started.error);
        return;
      }
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const jobs = await getRenderJobs(projectId);
        const job = jobs.find((j) => j.id === started.id);
        if (!job) return;
        setExportState({ status: job.status, progress: job.progress, url: job.url });
        if (job.status === "DONE" || job.status === "FAILED") {
          if (job.status === "FAILED") setError(job.error ?? "That export didn't come through — try again.");
          return;
        }
      }
    } catch {
      if (alive.current) setError("That export didn't come through — try again.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function uploadMusic(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy("upload");
    setError(null);
    setMessage(null);
    try {
      const outcome = await uploadFilesDirect([file], () => {});
      const failure = outcome.failures[0];
      if (failure) {
        if (alive.current) setError(`${failure.filename}: ${failure.reason}`);
        return;
      }
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if (!alive.current) return;
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessage("That music is in your media — pick it below to lay it under the video.");
      await refresh();
    } catch {
      if (alive.current) setError("That upload didn't go through — try again.");
    } finally {
      if (alive.current) setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const visualMedia = media.filter((m) => m.kind !== "audio");
  const audioMedia = media.filter((m) => m.kind === "audio");
  const working = busy !== null;
  /** The cut stores only what the renderer needs, so a clip's NAME is looked up beside it. */
  const nameOf = (clipSrc: string) => media.find((m) => m.src === clipSrc)?.label ?? "Clip";

  return (
    <div className="gb leading-[1.5]" style={{ flex: 1, overflow: "auto", padding: "20px" }}>
      <div className="mb-4">
        <h2 className="m-0 text-[1.125rem] text-foreground">Video editor</h2>
        <p className="mt-1 mb-0 text-[0.875rem] text-muted-foreground">
          Put your clips together into one video, add captions, and lay music under it. All of this is free —
          it never uses your credits.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-[12px] border border-border bg-error-soft px-3 py-2 text-[0.8125rem] text-[var(--error-soft-foreground)]">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="mb-3 rounded-[12px] border border-border bg-card px-3 py-2 text-[0.8125rem] text-muted-foreground">
          {message}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[0.875rem] text-muted-foreground">
          <LoaderCircle size={15} className="animate-spin" /> Opening your video…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ---- the video as it stands ---- */}
          <section className="rounded-[14px] border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[0.9375rem] text-foreground">Your video</h3>
              <span className="text-[0.8125rem] text-muted-foreground">
                {cut.clips.length === 0
                  ? "Nothing in it yet"
                  : `${cut.clips.length} clip${cut.clips.length === 1 ? "" : "s"} · ${clock(cut.seconds)}`}
              </span>
            </div>

            {cut.clips.length > 0 && (
              <ol className="mt-3 mb-0 flex list-none flex-col gap-1.5 p-0">
                {cut.clips.map((clip, index) => (
                  <li
                    key={`${clip.src}-${index}`}
                    className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border px-2.5 py-1.5 text-[0.8125rem]"
                  >
                    <span className="text-muted-foreground/70">
                      {clip.kind === "video" ? <Film size={14} /> : <ImageIcon size={14} />}
                    </span>
                    <span className="text-foreground">
                      {index + 1}. {nameOf(clip.src)}
                    </span>
                    <span className="text-muted-foreground">{clock(clip.seconds)}</span>
                    {clip.kind === "video" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-7 px-2 text-[0.75rem]"
                        disabled={working}
                        onClick={() => void captionClip(clip.src)}
                      >
                        {busy === `caption:${clip.src}` ? <LoaderCircle size={13} className="animate-spin" /> : <Captions size={13} />}
                        {busy === `caption:${clip.src}` ? "Working out the words…" : "Add captions"}
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span>{cut.captionCount > 0 ? `${cut.captionCount} captions on screen` : "No captions yet"}</span>
              {cut.captionCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[0.75rem]"
                  disabled={working}
                  onClick={() => void run("clear-captions", () => clearCutCaptions(projectId), "Captions are off.")}
                >
                  <Trash2 size={13} /> Take captions off
                </Button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="brand" size="sm" disabled={working || cut.clips.length === 0} onClick={() => void exportVideo()}>
                {busy === "export" ? <LoaderCircle size={14} className="animate-spin" /> : null}
                Export video
              </Button>
              {exportState && (
                <span className="text-[0.8125rem] text-muted-foreground">
                  {exportState.status === "DONE" ? "Ready" : `${exportState.status.toLowerCase()} · ${exportState.progress}%`}
                </span>
              )}
              {exportState?.url && (
                <Button asChild type="button" size="sm" variant="secondary">
                  <a href={exportState.url} target="_blank" rel="noreferrer">Open your video</a>
                </Button>
              )}
            </div>
          </section>

          {/* ---- pick clips and join them ---- */}
          <section className="rounded-[14px] border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[0.9375rem] text-foreground">Your clips</h3>
              <span className="text-[0.8125rem] text-muted-foreground">
                {picked.length > 0 ? `${picked.length} picked, in this order` : "Pick them in the order they should play"}
              </span>
            </div>
            {visualMedia.length === 0 ? (
              <p className="mt-2 mb-0 text-[0.8125rem] text-muted-foreground">
                Nothing to put together yet — make a clip first, then come back here.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {visualMedia.map((clip) => {
                  const order = picked.indexOf(clip.src);
                  return (
                    <Button
                      key={clip.src}
                      type="button"
                      size="sm"
                      variant={order >= 0 ? "soft" : "secondary"}
                      onClick={() => togglePick(clip.src)}
                      aria-pressed={order >= 0}
                    >
                      {clip.kind === "video" ? <Film size={14} /> : <ImageIcon size={14} />}
                      <span className="max-w-[16ch] truncate">
                        {order >= 0 ? `${order + 1}. ` : ""}
                        {clip.label}
                      </span>
                      <span className="text-muted-foreground">{clock(clip.seconds)}</span>
                    </Button>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={working || picked.length === 0}
                onClick={() =>
                  void run("join", () => joinClipsIntoCut(projectId, picked), "Those clips are one video now.")
                }
              >
                {busy === "join" ? <LoaderCircle size={14} className="animate-spin" /> : null}
                Join into one video
              </Button>
              {picked.length > 0 && (
                <Button type="button" size="sm" variant="ghost" disabled={working} onClick={() => setPicked([])}>
                  Clear picks
                </Button>
              )}
            </div>
          </section>

          {/* ---- music under the whole thing ---- */}
          <section className="rounded-[14px] border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[0.9375rem] text-foreground">Music</h3>
              <span className="text-[0.8125rem] text-muted-foreground">
                {cut.music ? `Playing under the video · ${nameOf(cut.music)}` : "No music yet"}
              </span>
            </div>
            <p className="mt-2 mb-0 text-[0.8125rem] text-muted-foreground">
              Music sits under the whole video and steps back on its own whenever someone is talking.
            </p>
            {audioMedia.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {audioMedia.map((track) => (
                  <Button
                    key={track.src}
                    type="button"
                    size="sm"
                    variant={cut.music === track.src ? "soft" : "secondary"}
                    disabled={working || cut.clips.length === 0}
                    onClick={() => void run(`music:${track.src}`, () => setCutMusic(projectId, track.src), "That music is under your video.")}
                  >
                    {busy === `music:${track.src}` ? <LoaderCircle size={13} className="animate-spin" /> : <Music size={13} />}
                    {track.label} · {clock(track.seconds)}
                  </Button>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                ref={fileInput}
                type="file"
                accept="audio/*"
                aria-label="Choose a music file"
                className="hidden"
                onChange={(e) => void uploadMusic(e.target.files)}
              />
              <Button type="button" size="sm" variant="secondary" disabled={working} onClick={() => fileInput.current?.click()}>
                {busy === "upload" ? <LoaderCircle size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload music
              </Button>
              {cut.music && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={working}
                  onClick={() => void run("clear-music", () => clearCutMusic(projectId), "The music is off.")}
                >
                  <Trash2 size={13} /> Take music off
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default EditDesk;
