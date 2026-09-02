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
import { UPLOAD_EXTS, mimeOf } from "@fikirtive/core/upload";
import type { CutSummary, DeskMedia } from "@/lib/edit-desk";

const POLL_MS = 2000;

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** How long a piece of media is, or the truth when nobody has read its length yet. A number we
 *  made up would be the one thing on this screen the merchant cannot check. */
function lengthLabel(seconds: number | null): string {
  return seconds === null ? "Length still unknown" : clock(seconds);
}

/**
 * 商家挑的文件看起来是不是音频。
 *
 * **扩展名是硬条件,MIME 只是副条件** —— 顺序反过来就有一条真实的绕过路径:
 * 一个内容真是 PNG、名字 `poster.png`、而浏览器报 `File.type="audio/mpeg"` 的文件,
 * 只看 MIME 就会被放行;服务端 `finalizeCandidateUploads` 对**图片扩展名**才读字节
 * (`lib/upload-actions.ts` 里 `isStaticImageExt` 那个分支),于是它被 media-sniff 判成
 * `image/png` 落盘 → worker 的 `understandingKindForMime` 对 `image/*` 建收费理解行 →
 * 而这个入口按 §7.3 是**豁免披露**的。一笔没被告知的钱就是这么进来的。
 *
 * 反过来只要扩展名落在音频白名单里就安全:服务端对**非图片扩展名不读字节**,直接采用
 * 扩展名→MIME 映射(`packages/core/src/upload.ts` 的 `mimeOf`),六个音频扩展名全部映射到
 * `audio/*`,而 `understandingKindForMime` 对 `audio/*` 返回 null —— 不建理解行、不计费。
 *
 * 白名单**不手抄,直接算**:拿 core 的 `UPLOAD_EXTS`(服务端唯一允许上传的扩展名)逐个跑
 * `mimeOf`,留下映射到 `audio/*` 的那些。这条式子写的就是我们真正要的那个性质 ——
 * 「服务端会把它落成 audio/*,因此不计费」—— 而不是一份需要有人记得同步的名单。
 * 于是两个曾经手抄进来的扩展名自动消失,而且消失得对:
 *   · `.webm` 是 **video** 扩展名(`mimeOf("webm") === "video/webm"`),放行它等于放一条
 *     video-qa 计费路径进来;
 *   · `.oga` 根本不在 `UPLOAD_EXTS` 里,服务端会直接拒,写在这里只是句空话。
 * 用 `mimeOf` 而不是 `EXT_BY_TYPE.audio`,是因为前者才是服务端真正用来定 MIME 的那个函数:
 * 万一有人往 `EXT_BY_TYPE.audio` 加了个 `mimeOf` 不认识的扩展名(会落 octet-stream),
 * 这里会正确地把它排除在外。
 *
 * 这是**入口守卫,不是安全边界**:字节层面的判定仍在服务端。它要拦的是「把弹窗筛选改成
 * 所有文件、顺手点了一张图」这种误选 —— 那一下今天会变成一笔没被披露的理解扣费。
 */
const AUDIO_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set(
  UPLOAD_EXTS.filter((ext) => mimeOf(ext).startsWith("audio/")),
);

/** 浏览器对这些扩展名的已知误报:容器格式共用,MIME 猜错不代表文件不是音频。
 *  m4a/aac 本来就装在 MP4 容器里,某些平台因此报 `video/mp4`。 */
const AUDIO_MIME_QUIRKS: Record<string, ReadonlySet<string>> = {
  m4a: new Set(["video/mp4"]),
  aac: new Set(["video/mp4"]),
};

function looksLikeAudio(file: File): boolean {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  // 硬条件:扩展名决定服务端落哪个 MIME,也就决定这个文件会不会被理解计费。
  if (!AUDIO_UPLOAD_EXTENSIONS.has(ext)) return false;
  const type = file.type.trim().toLowerCase();
  if (type.startsWith("audio/")) return true;
  // 浏览器没意见(空字符串,或笼统的 octet-stream)时,认扩展名。
  if (type === "" || type === "application/octet-stream") return true;
  return AUDIO_MIME_QUIRKS[ext]?.has(type) ?? false;
}

export function EditDesk({ projectId }: { projectId: string }) {
  const [media, setMedia] = useState<DeskMedia[]>([]);
  const [cut, setCut] = useState<CutSummary>({ clips: [], seconds: 0, captionCount: 0, music: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [exportState, setExportState] = useState<{ status: string; progress: number; url: string | null } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /** Open (or re-open) the desk. Every ending is accounted for: the server's own refusal, a
   *  rejected call (database down, network gone), and success. Without the catch/finally a
   *  rejected first load left the spinner up for ever — "Opening your video…" is a promise, and
   *  a page that can never keep it has to say so and offer the way out instead. */
  const refresh = useCallback(async () => {
    try {
      const res = await getEditDesk(projectId);
      if (!alive.current) return;
      if ("error" in res) {
        setError(res.error);
        setOpenFailed(true);
      } else {
        setMedia(res.media);
        setCut(res.cut);
        setUnreadable(res.unreadable);
        setOpenFailed(false);
      }
    } catch {
      if (alive.current) {
        setError("We couldn't open your video just now — try again.");
        setOpenFailed(true);
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [projectId]);

  /** Follow one export to its end, wherever it was started from. */
  const watchRender = useCallback(async (jobId: string) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!alive.current) return;
      const jobs = await getRenderJobs(projectId);
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;
      setExportState({ status: job.status, progress: job.progress, url: job.url });
      if (job.status === "DONE" || job.status === "FAILED") {
        if (job.status === "FAILED") setError(job.error ?? "That export didn't come through — try again.");
        return;
      }
    }
  }, [projectId]);

  /** An export outlives this page: the merchant can close the desk while ffmpeg is still
   *  running, and Otto can start one they never watched. So the desk adopts this project's
   *  newest export on open — otherwise re-opening showed a blank slate while a render was
   *  running, and a finished video had nowhere to be opened from. */
  const adoptRender = useCallback(async () => {
    try {
      const jobs = await getRenderJobs(projectId);
      if (!alive.current) return;
      const job = jobs[0]; // newest first
      if (!job) return;
      setExportState({ status: job.status, progress: job.progress, url: job.url });
      if (job.status === "QUEUED" || job.status === "RENDERING") await watchRender(job.id);
    } catch {
      // Deliberately quiet: the desk itself is open and usable, and the export strip has
      // nothing to say rather than something wrong. refresh() owns the visible failure.
    }
  }, [projectId, watchRender]);

  // Deferred with queueMicrotask for the same reason OttoConnections' load() is: setting
  // state synchronously in an effect body trips react-hooks/set-state-in-effect.
  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
      void adoptRender();
    });
  }, [refresh, adoptRender]);

  /** The way out of a failed open: try the whole thing again, spinner and all. */
  const retryOpen = useCallback(() => {
    setLoading(true);
    setError(null);
    setOpenFailed(false);
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
      await watchRender(started.id);
    } catch {
      if (alive.current) setError("That export didn't come through — try again.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function uploadMusic(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    // MONEY-A9 §7.3 —— 这个入口按规格「现仅收 audio」被单列豁免、不挂价目小字。
    // 在此之前那句话只靠文件选择器上的 accept="audio/*" 撑着,而 accept 是选择框的过滤**建议**,
    // 不是校验:商家在系统弹窗里把筛选改成「所有文件」就能选一张图,它会以 UPLOAD image 素材
    // 落盘、被自动理解计费 —— 一笔他在任何屏幕上都没见过价目的钱。豁免的前提得自己成立。
    if (!looksLikeAudio(file)) {
      setError("Only audio files can be added here.");
      setMessage(null);
      // 让同一个文件还能被重新选中(否则 onChange 不会再触发)
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
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
    // padding-top 64px (not 20px) — clears the floating "show sidebar" toggle
    // (OttoApp.tsx: `absolute left-3 top-3 size-[34px]`, footprint to 46px) that
    // otherwise sits on top of this pane and ate the "Vi" of "Video editor" (#949 A1).
    <div className="gb leading-[1.5]" style={{ flex: 1, overflow: "auto", padding: "64px 20px 20px" }}>
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
      ) : openFailed ? (
        <div className="flex flex-wrap items-center gap-2 text-[0.875rem] text-muted-foreground">
          <span>We couldn&apos;t open your video. Nothing has been changed.</span>
          <Button type="button" size="sm" variant="secondary" onClick={retryOpen}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ---- the video as it stands ---- */}
          <section className="rounded-[14px] border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[0.9375rem] text-foreground">Your video</h3>
              <span className="text-[0.8125rem] text-muted-foreground">
                {unreadable
                  ? "We can't read what's saved here"
                  : cut.clips.length === 0
                    ? "Nothing in it yet"
                    : `${cut.clips.length} clip${cut.clips.length === 1 ? "" : "s"} · ${clock(cut.seconds)}`}
              </span>
            </div>

            {/* A cut we can't read is NOT an empty one. Saying "Nothing in it yet" over saved work
                is the lie this line exists to prevent — and every button that would write is off,
                because the safe thing to do with work we can't read is leave it alone. */}
            {unreadable && (
              <p className="mt-2 mb-0 text-[0.8125rem] text-muted-foreground">
                Something is saved for this video, but we can&apos;t read it — so nothing here can be
                changed and nothing has been thrown away. Ask us to take a look at it.
              </p>
            )}

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
                        disabled={working || unreadable}
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
                  disabled={working || unreadable}
                  onClick={() => void run("clear-captions", () => clearCutCaptions(projectId), "Captions are off.")}
                >
                  <Trash2 size={13} /> Take captions off
                </Button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="brand" size="sm" disabled={working || unreadable || cut.clips.length === 0} onClick={() => void exportVideo()}>
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
                      <span className="text-muted-foreground">{lengthLabel(clip.seconds)}</span>
                    </Button>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={working || unreadable || picked.length === 0}
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
                    disabled={working || unreadable || cut.clips.length === 0}
                    onClick={() => void run(`music:${track.src}`, () => setCutMusic(projectId, track.src), "That music is under your video.")}
                  >
                    {busy === `music:${track.src}` ? <LoaderCircle size={13} className="animate-spin" /> : <Music size={13} />}
                    {track.label} · {lengthLabel(track.seconds)}
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
                  disabled={working || unreadable}
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
