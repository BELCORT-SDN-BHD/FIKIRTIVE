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
import { Captions, ExternalLink, Film, ImageIcon, Music, Scissors, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
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
  const [previewIndex, setPreviewIndex] = useState(0);
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
  const activePreviewIndex = cut.clips[previewIndex] ? previewIndex : 0;
  const previewClip = cut.clips[activePreviewIndex] ?? null;
  const exportInProgress = exportState?.status === "QUEUED" || exportState?.status === "RENDERING";

  return (
    // padding-top 64px (not 20px) — clears the floating "show sidebar" toggle
    // (OttoApp.tsx: `absolute left-3 top-3 size-[34px]`, footprint to 46px) that
    // otherwise sits on top of this pane and ate the "Vi" of "Video editor" (#949 A1).
    <div className="gb flex-1 overflow-auto px-5 pb-5 pt-16 leading-[1.5] lg:px-6 lg:pb-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <h2 className="m-0 text-xl font-semibold tracking-[-0.02em] text-foreground">Video editor</h2>
              <Badge variant="outline">Free editor</Badge>
            </div>
            <p className="m-0 max-w-2xl text-sm text-muted-foreground">
              Arrange clips, add captions, and mix in music. All of this is free — it never uses your credits.
            </p>
          </div>
        </header>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {message && !error && (
          <Alert variant="success" role="status" aria-live="polite">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <Empty className="min-h-80 border border-border bg-card shadow-[var(--shadow-sm)]">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Spinner /></EmptyMedia>
              <EmptyTitle>Opening your video…</EmptyTitle>
              <EmptyDescription>Loading the saved cut and media for this project.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : openFailed ? (
          <Empty className="min-h-80 border border-border bg-card shadow-[var(--shadow-sm)]">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Film /></EmptyMedia>
              <EmptyTitle>We couldn&apos;t open your video</EmptyTitle>
              <EmptyDescription>Nothing has been changed. Try opening the editor again.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="sm" variant="secondary" onClick={retryOpen}>Try again</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card className="gap-0 overflow-hidden p-0">
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div>
                    <CardTitle>Your video</CardTitle>
                    <CardDescription>
                      {unreadable
                        ? "We can't read what's saved here"
                        : cut.clips.length === 0
                          ? "Nothing in it yet"
                          : `${cut.clips.length} clip${cut.clips.length === 1 ? "" : "s"} · ${clock(cut.seconds)}`}
                    </CardDescription>
                  </div>
                  {cut.clips.length > 0 && <Badge variant="outline">Clip preview</Badge>}
                </CardHeader>

                {unreadable && (
                  <Alert variant="warning" className="m-4 w-auto" role="status">
                    <AlertDescription>
                      Something is saved for this video, but we can&apos;t read it — so nothing here can be changed and
                      nothing has been thrown away. Ask us to take a look at it.
                    </AlertDescription>
                  </Alert>
                )}

                {cut.clips.length === 0 ? (
                  <Empty className="min-h-72 rounded-none">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><Scissors /></EmptyMedia>
                      <EmptyTitle>Build your first cut</EmptyTitle>
                      <EmptyDescription>Pick clips from your media library below, then join them in the order they should play.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : previewClip ? (
                  <CardContent className="p-4">
                    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-foreground/[0.04]">
                      <div className="flex aspect-video items-center justify-center bg-[#111214] lg:h-80 lg:aspect-auto">
                        {previewClip.kind === "video" ? (
                          <video
                            key={previewClip.src}
                            src={previewClip.src}
                            controls
                            muted
                            playsInline
                            preload="metadata"
                            className="h-full w-full bg-[#111214] object-contain"
                            aria-label={`Preview ${nameOf(previewClip.src)}`}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element -- edit sources may be local authenticated files.
                          <img
                            src={previewClip.src}
                            alt={`Preview ${nameOf(previewClip.src)}`}
                            className="h-full w-full bg-[#111214] object-contain"
                          />
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>Timeline</span>
                        <span className="font-mono tabular-nums">{clock(cut.seconds)}</span>
                      </div>
                      <ol className="m-0 flex list-none gap-1 overflow-x-auto rounded-[var(--radius-card)] bg-muted p-1.5">
                        {cut.clips.map((clip, index) => {
                          const selected = activePreviewIndex === index;
                          const share = cut.seconds > 0 ? Math.max(14, (clip.seconds / cut.seconds) * 100) : 100 / cut.clips.length;
                          return (
                            <li key={`${clip.src}-${index}`} className="min-w-20" style={{ flexGrow: share, flexBasis: 0 }}>
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  "h-14 w-full min-w-0 flex-col items-stretch justify-between rounded-lg px-2.5 py-2 text-left",
                                  selected ? "border-foreground/40 bg-accent" : "border-border",
                                )}
                                onClick={() => setPreviewIndex(index)}
                                aria-pressed={selected}
                                aria-label={`Preview clip ${index + 1}: ${nameOf(clip.src)}`}
                              >
                                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                                  {clip.kind === "video" ? <Film className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                                  <span className="truncate">{index + 1}. {nameOf(clip.src)}</span>
                                </span>
                                <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">{clock(clip.seconds)}</span>
                              </Button>
                            </li>
                          );
                        })}
                      </ol>
                    </div>

                    <div className="mt-3 flex flex-col gap-1">
                      {cut.clips.map((clip, index) => (
                        <div key={`caption-${clip.src}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/70">
                          <span className="min-w-0 flex-1 truncate text-foreground">{index + 1}. {nameOf(clip.src)}</span>
                          {clip.kind === "video" && (
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              disabled={working || unreadable}
                              onClick={() => void captionClip(clip.src)}
                            >
                              {busy === `caption:${clip.src}` ? <Spinner data-icon="inline-start" /> : <Captions data-icon="inline-start" />}
                              {busy === `caption:${clip.src}` ? "Working out the words…" : "Add captions"}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                ) : null}
              </Card>

              <Card>
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Your clips</CardTitle>
                    <CardDescription>
                      {picked.length > 0 ? `${picked.length} picked, in this order` : "Pick them in the order they should play"}
                    </CardDescription>
                  </div>
                  {picked.length > 0 && <Badge>{picked.length} selected</Badge>}
                </CardHeader>
                <CardContent>
                  {visualMedia.length === 0 ? (
                    <Empty className="min-h-56 border border-dashed border-border">
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><Film /></EmptyMedia>
                        <EmptyTitle>No clips yet</EmptyTitle>
                        <EmptyDescription>Nothing to put together yet — make a clip first, then come back here.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {visualMedia.map((clip) => {
                        const order = picked.indexOf(clip.src);
                        const selected = order >= 0;
                        return (
                          <Button
                            key={clip.src}
                            type="button"
                            variant="outline"
                            className={cn(
                              "group relative h-auto min-w-0 overflow-hidden rounded-[var(--radius-card)] p-0 text-left hover:-translate-y-0.5 hover:bg-card hover:shadow-[var(--shadow-md)]",
                              selected ? "border-foreground/50 ring-1 ring-foreground/20" : "border-border",
                            )}
                            onClick={() => togglePick(clip.src)}
                            aria-pressed={selected}
                            aria-label={`${selected ? "Remove" : "Pick"} ${nameOf(clip.src)}`}
                          >
                            <span className="relative block aspect-video overflow-hidden bg-muted">
                              {clip.kind === "video" ? (
                                <video src={clip.src} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element -- edit sources may be local authenticated files.
                                <img src={clip.src} alt="" className="h-full w-full object-cover" />
                              )}
                              {selected && <Badge className="absolute left-2 top-2 bg-foreground text-background">{order + 1}</Badge>}
                              <Badge variant="outline" className="absolute bottom-2 right-2 border-white/20 bg-black/65 font-mono text-white">
                                {lengthLabel(clip.seconds)}
                              </Badge>
                            </span>
                            <span className="flex min-w-0 items-center gap-2 px-3 py-2.5">
                              {clip.kind === "video" ? <Film className="size-4 shrink-0 text-muted-foreground" /> : <ImageIcon className="size-4 shrink-0 text-muted-foreground" />}
                              <span className="truncate text-sm font-medium text-foreground">{clip.label}</span>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
                <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 pt-4">
                  <Button
                    type="button"
                    size="sm"
                    disabled={working || unreadable || picked.length === 0}
                    onClick={() => void run("join", () => joinClipsIntoCut(projectId, picked), "Those clips are one video now.")}
                  >
                    {busy === "join" ? <Spinner data-icon="inline-start" /> : <Scissors data-icon="inline-start" />}
                    Join into one video
                  </Button>
                  {picked.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" disabled={working} onClick={() => setPicked([])}>Clear picks</Button>
                  )}
                </div>
              </Card>
            </div>

            <aside className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Output</CardTitle>
                  <CardDescription>Your current cut and export status.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Duration</dt><dd className="mt-0.5 font-mono font-medium tabular-nums">{clock(cut.seconds)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Clips</dt><dd className="mt-0.5 font-mono font-medium tabular-nums">{cut.clips.length}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Captions</dt><dd className="mt-0.5 font-medium">{cut.captionCount > 0 ? `${cut.captionCount} on screen` : "None"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Music</dt><dd className="mt-0.5 truncate font-medium">{cut.music ? nameOf(cut.music) : "None"}</dd></div>
                  </dl>

                  {exportState && (
                    <div className="rounded-[var(--radius-card)] border border-border bg-muted/50 p-3" role="status" aria-live="polite">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                        <Badge variant={exportState.status === "DONE" ? "success" : exportState.status === "FAILED" ? "destructive" : "info"}>
                          {exportState.status === "DONE" ? "Ready" : exportState.status.toLowerCase()}
                        </Badge>
                        <span className="font-mono tabular-nums text-muted-foreground">{exportState.progress}%</span>
                      </div>
                      {exportInProgress && <Progress value={exportState.progress} aria-label="Export progress" />}
                    </div>
                  )}

                  <Button type="button" size="sm" disabled={working || unreadable || cut.clips.length === 0} onClick={() => void exportVideo()}>
                    {busy === "export" ? <Spinner data-icon="inline-start" /> : <Film data-icon="inline-start" />}
                    Export video
                  </Button>
                  {exportState?.url && (
                    <Button asChild type="button" size="sm" variant="secondary">
                      <a href={exportState.url} target="_blank" rel="noreferrer">
                        Open your video <ExternalLink data-icon="inline-end" />
                      </a>
                    </Button>
                  )}
                  {cut.captionCount > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={working || unreadable}
                      onClick={() => void run("clear-captions", () => clearCutCaptions(projectId), "Captions are off.")}
                    >
                      <Trash2 data-icon="inline-start" /> Take captions off
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Music</CardTitle>
                  <CardDescription>
                    {cut.music ? `Playing under the video · ${nameOf(cut.music)}` : "No music yet"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                    Music steps back automatically whenever someone is talking.
                  </p>
                  {audioMedia.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {audioMedia.map((track) => {
                        const selected = cut.music === track.src;
                        return (
                          <Button
                            key={track.src}
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn("h-auto min-w-0 justify-start py-2.5", selected && "border-foreground/50 bg-accent")}
                            disabled={working || unreadable || cut.clips.length === 0}
                            onClick={() => void run(`music:${track.src}`, () => setCutMusic(projectId, track.src), "That music is under your video.")}
                            aria-pressed={selected}
                          >
                            {busy === `music:${track.src}` ? <Spinner data-icon="inline-start" /> : <Music data-icon="inline-start" />}
                            <span className="min-w-0 flex-1 truncate text-left">{track.label}</span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">{lengthLabel(track.seconds)}</span>
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="m-0 text-xs text-muted-foreground">Upload a track to add music to this cut.</p>
                  )}
                  <Input ref={fileInput} type="file" accept="audio/*" aria-label="Choose a music file" className="hidden" onChange={(e) => void uploadMusic(e.target.files)} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={working} onClick={() => fileInput.current?.click()}>
                      {busy === "upload" ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
                      Upload music
                    </Button>
                    {cut.music && (
                      <Button type="button" size="sm" variant="ghost" disabled={working || unreadable} onClick={() => void run("clear-music", () => clearCutMusic(projectId), "The music is off.")}>
                        <Trash2 data-icon="inline-start" /> Take music off
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

export default EditDesk;
