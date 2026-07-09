"use client";

/**
 * 素材编辑面 — GOAL C3/C4/D4/D5/E2/E3;区划图·创作区(抽帧)
 * 图:Crop / 修图;视频:Trim(双把手逐帧)/ Extract Frame(Extracting 中间态)/
 * 特效 / 内嵌播放器。E3:Trim 重渲染 = 新花费点 → 过花费确认。
 */

import * as React from "react";
import Link from "next/link";
import {
  Check,
  FolderOpen,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Video,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSearchParams } from "next/navigation";
import { canvasObjectById, ottoWorking as setOttoWorking, spendCredits } from "../immersive/_store";
import { MockNote, OttoNarrationBar, PageHeader } from "../_shared";
import { cvImage, CV_ALL_SEED_OBJECTS, NS_ASSETS, type CvObject } from "./_fixtures";
import {
  SectionLabel,
  SpendConfirmDialog,
  SWEEP_STYLE,
  useCreateKeyframes,
} from "./_create-ui";

const TRIM_COST = 12;
const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
const EFFECTS = ["Slow zoom in", "Film grain", "Warm grade"] as const;

type Tab = "image" | "video";
type Lifecycle = "ready" | "queued" | "generating" | "noise" | "extracting";

export function MediaEditorPage() {
  useCreateKeyframes();
  // 深链 ?asset=<id> → 载入那个画布对象;缺省回到示意资产(GOAL §4)
  // [cx-canvas-runtime] 断层 3/5 ①:解析顺序 = store 运行时注册表 → 画布种子。运行时对象(画布刚
  // 生成/复制的)只活在 store 注册表 —— 从注册表复原成 CvObject,让 Crop / Trim 打开的是同一张,
  // 而不是回落到示意资产。查无则回落种子对象(Library / My stuff 深链)。
  // [cx-canvas-runtime] ?asset= 走 useSearchParams(reactive):client-nav 过来才拿得到深链 id
  // (window.location 快照在 App Router 客户端跳转时读的是上一页,id 丢失)。
  const assetId = useSearchParams().get("asset");
  const asset = React.useMemo<CvObject | null>(() => {
    const runtime = canvasObjectById(assetId);
    if (runtime) {
      return {
        id: runtime.id,
        ref: runtime.ref ?? runtime.title,
        kind: runtime.kind,
        title: runtime.title,
        prompt: runtime.prompt,
        src: runtime.kind === "video" ? runtime.posterUrl : runtime.imageUrl,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        status: "ready",
        parentId: runtime.lineage,
        duration: runtime.duration,
        credits: runtime.credits ?? 0,
      };
    }
    return CV_ALL_SEED_OBJECTS.find((o) => o.id === assetId) ?? null;
  }, [assetId]);
  const [tab, setTab] = React.useState<Tab>(asset?.kind ?? "video");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Media editor"
        subtitle={
          asset
            ? `Editing ${asset.ref} · ${asset.title}. Edits stay on the object, versions stay in its history.`
            : "Fix and cut a generated object in place. Edits stay on the object, versions stay in its history."
        }
        actions={
          <div className="flex items-center gap-2">
            {asset && (
              <Badge variant="outline" className="hidden font-mono text-muted-foreground sm:inline-flex">
                {asset.ref}
              </Badge>
            )}
            <div className="flex rounded-[10px] border border-border bg-card p-0.5">
              {(["image", "video"] as Tab[]).map((t) => {
                const Icon = t === "image" ? ImageIcon : Video;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold capitalize transition-colors duration-[120ms]",
                      tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" strokeWidth={2} />
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        }
      />

      {/* [wave-c] STALL #9:asset 为空时不再静默回落到一段没选过的种子视频(会误以为按下就扣钱)。
         改出诚实空态 —— 明说没有打开的素材,给两条真出路(去画布 / 去素材库),断掉死胡同。 */}
      {asset ? (
        <div className="mt-6">{tab === "image" ? <ImageEditor asset={asset} /> : <VideoEditor asset={asset} />}</div>
      ) : (
        <div className="mt-6 flex flex-col items-center justify-center rounded-[18px] border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FolderOpen className="size-6" strokeWidth={1.75} />
          </span>
          <h2 className="mt-4 text-[18px] leading-[24px] font-semibold tracking-[-0.012em] text-foreground">
            Nothing open to edit yet
          </h2>
          <p className="mt-1.5 max-w-[380px] text-[13px] leading-[18px] text-muted-foreground">
            Pick an image or clip to crop, trim, or extract a frame from. Open one from your canvas, or from your library.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button asChild size="sm" className="ns-pressable">
              <Link href="/northstar/create/canvas">
                <Sparkles className="size-4" strokeWidth={2} />
                Go to canvas
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="ns-pressable">
              <Link href="/northstar/assets/library">
                <FolderOpen className="size-4" strokeWidth={2} />
                Open library
              </Link>
            </Button>
          </div>
        </div>
      )}

      <MockNote path="/northstar/create/media-editor" />
    </div>
  );
}

/* ── 图编辑:Crop + 修图(D4) ─────────────────────────────────────────── */
function ImageEditor({ asset }: { asset: CvObject | null }) {
  const imgSrc = asset?.kind === "image" ? asset.src : NS_ASSETS[0].thumb;
  const imgAlt = asset?.kind === "image" ? asset.title : NS_ASSETS[0].title;
  const [aspect, setAspect] = React.useState<(typeof ASPECTS)[number]>("1:1");
  const [brightness, setBrightness] = React.useState(0);
  const [contrast, setContrast] = React.useState(0);
  const [applied, setApplied] = React.useState(false);
  const [lifecycle, setLifecycle] = React.useState<Lifecycle>("ready");
  const [pct, setPct] = React.useState(0);
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // C4:对象生命周期中间态(占位 → Generating% → 噪点 → 成像)
  const regenerate = () => {
    setLifecycle("queued");
    setPct(0);
    timers.current.push(
      window.setTimeout(() => {
        setLifecycle("generating");
        // 进度与阶段切换分离:setPct updater 保持纯,过 84% 的收口(clearInterval / 阶段切换 /
        // 排 ready)在 interval 回调体里做一次 —— 否则塞进 updater 会被 StrictMode 双调,导致
        // 「成像完成」阶段与 ready 定时器触发两次(media-editor 生成气泡渲染两次)。
        let p = 0;
        const iv = window.setInterval(() => {
          if (p >= 84) {
            window.clearInterval(iv);
            setLifecycle("noise");
            timers.current.push(window.setTimeout(() => setLifecycle("ready"), 1200));
            return;
          }
          p += 7;
          setPct(p);
        }, 240);
        timers.current.push(iv);
      }, 800),
    );
  };

  const cropBox =
    aspect === "1:1" ? "inset-[10%]" : aspect === "4:5" ? "inset-y-[6%] inset-x-[14%]" : aspect === "9:16" ? "inset-y-[2%] inset-x-[26%]" : "inset-y-[18%] inset-x-[4%]";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* 画面 */}
      <div className="relative overflow-hidden rounded-[18px] border border-border bg-card">
        {lifecycle === "ready" || lifecycle === "noise" ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt={imgAlt}
              className={cn("aspect-square w-full object-cover", lifecycle === "noise" && "opacity-60 blur-[2px]")}
              style={{ filter: `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})` }}
            />
            {/* crop 遮罩 */}
            <div aria-hidden className="absolute inset-0">
              <div className={cn("absolute rounded-[4px] border-2 border-card shadow-[0_0_0_9999px_rgba(10,10,12,0.4)]", cropBox)}>
                {["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map((p) => (
                  <span key={p} className={cn("absolute size-2.5 rounded-full border border-border bg-card", p)} />
                ))}
              </div>
            </div>
            {lifecycle === "noise" && (
              <span className="absolute inset-x-4 bottom-4 rounded-[10px] bg-primary/75 px-3 py-1.5 text-center font-mono text-[11px] text-primary-foreground">
                Resolving detail…
              </span>
            )}
          </>
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-muted">
            <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
              {lifecycle === "queued" ? "Queued" : `Generating ${pct}%`}
            </span>
            <span className="relative h-[5px] w-32 overflow-hidden rounded-full border border-border bg-background">
              <span className="absolute top-0 left-0 h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-[11px] text-muted-foreground">Billed only when it finishes</span>
          </div>
        )}
      </div>

      {/* 工具 */}
      <div className="flex flex-col gap-5">
        <div className="rounded-[18px] border border-border bg-card p-4">
          <SectionLabel>Crop</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={aspect === a}
                onClick={() => setAspect(a)}
                className={cn(
                  "h-8 rounded-full border px-3 text-xs font-semibold",
                  aspect === a ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[18px] border border-border bg-card p-4">
          <SectionLabel>Adjust</SectionLabel>
          {(
            [
              ["Brightness", brightness, setBrightness],
              ["Contrast", contrast, setContrast],
            ] as const
          ).map(([label, val, set]) => (
            <div key={label} className="mt-3">
              <div className="flex items-baseline justify-between">
                <label htmlFor={`sl-${label}`} className="text-[13px] font-semibold text-foreground">
                  {label}
                </label>
                <span className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">
                  {val > 0 ? `+${val}` : val}
                </span>
              </div>
              <input
                id={`sl-${label}`}
                type="range"
                min={-50}
                max={50}
                value={val}
                onChange={(e) => set(Number(e.target.value))}
                className="mt-1.5 w-full accent-[var(--primary)]"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            className="flex-1"
            disabled={lifecycle !== "ready"}
            onClick={() => {
              setApplied(true);
              window.setTimeout(() => setApplied(false), 2000);
            }}
          >
            {applied ? (
              <>
                <Check className="size-4" strokeWidth={2.2} />
                Saved as v2
              </>
            ) : (
              "Apply edits"
            )}
          </Button>
          <Button
            variant="secondary"
            disabled={lifecycle !== "ready"}
            onClick={() => {
              setBrightness(0);
              setContrast(0);
              setAspect("1:1");
            }}
          >
            <RotateCcw className="size-4" strokeWidth={2} />
            Reset
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Crop and adjust are free. They save as a new version, the original stays in history.
        </p>

        <div className="rounded-[18px] border border-border bg-card p-4">
          <SectionLabel>Object lifecycle demo</SectionLabel>
          <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
            Every object shows its in-between states: queued, generating, resolving, done.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" disabled={lifecycle !== "ready"} onClick={regenerate}>
            {lifecycle === "ready" ? "Play the lifecycle" : "Running…"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── 视频编辑:Trim / Extract frame / 特效(D5/E2/E3) ────────────────── */
function VideoEditor({ asset }: { asset: CvObject | null }) {
  const posterSrc = asset?.kind === "video" ? asset.src : cvImage("video", 4);
  const posterAlt = asset?.kind === "video" ? asset.title : "Croissant fold reel";
  const totalFrames = 36; // 6s × 6fps 帧轨示意
  const [inFrame, setInFrame] = React.useState(4);
  const [outFrame, setOutFrame] = React.useState(30);
  const [playing, setPlaying] = React.useState(false);
  const [effects, setEffects] = React.useState<string[]>([]);
  const [extracting, setExtracting] = React.useState(false);
  const [extracted, setExtracted] = React.useState<string[]>([]);
  const [sweep, setSweep] = React.useState(false);
  const [trimAsk, setTrimAsk] = React.useState(false);
  const [trimming, setTrimming] = React.useState(false);
  const [trimmed, setTrimmed] = React.useState(false);
  const dragging = React.useRef<"in" | "out" | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const secs = ((outFrame - inFrame) / 6).toFixed(1);

  const onStripPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !stripRef.current) return;
    const rect = stripRef.current.getBoundingClientRect();
    const frame = Math.round(((e.clientX - rect.left) / rect.width) * totalFrames);
    if (dragging.current === "in") setInFrame(Math.max(0, Math.min(frame, outFrame - 3)));
    else setOutFrame(Math.min(totalFrames, Math.max(frame, inFrame + 3)));
  };

  const extractFrame = () => {
    setExtracting(true);
    setOttoWorking(true, "Extracting frame…"); // 免费但 Otto 在干活 → dock 反映
    timers.current.push(
      window.setTimeout(() => {
        setExtracting(false);
        setOttoWorking(false);
        setExtracted((prev) => [...prev, `ex-${prev.length + 1}`]);
        setSweep(true);
        timers.current.push(window.setTimeout(() => setSweep(false), 650));
      }, 3600),
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        {/* 内嵌播放器(C3)— 主画面随 Trim 实时同步 */}
        <div className="relative overflow-hidden rounded-[18px] border border-border bg-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={posterSrc}
            alt={posterAlt}
            className="aspect-video w-full object-cover"
          />
          <span className="absolute top-3 left-3 rounded-full bg-primary/75 px-2 py-0.5 font-mono text-[10px] leading-4 font-medium text-primary-foreground tabular-nums">
            {trimmed ? `trimmed · ${secs}s` : `${secs}s selected`}
          </span>
          <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-[14px] bg-primary/75 px-4 py-2.5">
            <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} className="text-primary-foreground">
              {playing ? <Pause className="size-5" strokeWidth={2} /> : <Play className="size-5" strokeWidth={2} />}
            </button>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-primary-foreground/30">
              <span
                className="absolute top-0 h-full rounded-full bg-primary-foreground/50"
                style={{ left: `${(inFrame / totalFrames) * 100}%`, width: `${((outFrame - inFrame) / totalFrames) * 100}%` }}
              />
              <span className={cn("block h-full w-1/5 rounded-full bg-primary-foreground transition-all", playing && "w-2/5")} />
            </span>
            <span className="font-mono text-[11px] leading-[14px] text-primary-foreground tabular-nums">{secs}s</span>
            <Volume2 className="size-4 text-primary-foreground" strokeWidth={2} />
            <span className="rounded-sm border border-primary-foreground/50 px-1 font-mono text-[10px] leading-4 text-primary-foreground">HD</span>
          </div>
        </div>

        {/* Trim 帧轨(E3:双把手逐帧) */}
        <div className="rounded-[18px] border border-border bg-card p-4">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Trim</SectionLabel>
            <span className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">
              in {(inFrame / 6).toFixed(1)}s · out {(outFrame / 6).toFixed(1)}s · keeps {secs}s
            </span>
          </div>
          <div
            ref={stripRef}
            className="relative mt-3 flex h-14 touch-none overflow-hidden rounded-[10px] border border-border select-none"
            onPointerMove={onStripPointerMove}
            onPointerUp={() => (dragging.current = null)}
            onPointerLeave={() => (dragging.current = null)}
          >
            {Array.from({ length: 12 }, (_, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={cvImage("video", i)} alt="" aria-hidden className="h-full w-[8.333%] object-cover" />
            ))}
            {/* 遮罩 + 双把手 */}
            <span aria-hidden className="absolute inset-y-0 left-0 bg-background/70" style={{ width: `${(inFrame / totalFrames) * 100}%` }} />
            <span aria-hidden className="absolute inset-y-0 right-0 bg-background/70" style={{ width: `${((totalFrames - outFrame) / totalFrames) * 100}%` }} />
            <button
              type="button"
              aria-label={`Trim start, ${(inFrame / 6).toFixed(1)} seconds`}
              onPointerDown={(e) => {
                dragging.current = "in";
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
              }}
              className="absolute inset-y-0 w-2.5 cursor-ew-resize rounded-sm bg-foreground"
              style={{ left: `calc(${(inFrame / totalFrames) * 100}% - 5px)` }}
            />
            <button
              type="button"
              aria-label={`Trim end, ${(outFrame / 6).toFixed(1)} seconds`}
              onPointerDown={(e) => {
                dragging.current = "out";
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
              }}
              className="absolute inset-y-0 w-2.5 cursor-ew-resize rounded-sm bg-foreground"
              style={{ left: `calc(${(outFrame / totalFrames) * 100}% - 5px)` }}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" disabled={trimming} onClick={() => setTrimAsk(true)}>
              {trimming ? "Trimming…" : `Apply trim · ${TRIM_COST} credits`}
            </Button>
            <p className="text-[11px] leading-4 text-muted-foreground">
              A trim re-renders the clip, so it costs credits. Nothing is charged until you confirm.
            </p>
          </div>
        </div>

        {/* Extracting 中间态(E2/C4) */}
        {extracting && (
          <OttoNarrationBar steps={["Extracting frame…", "Saving it as a new image…"]} stepMs={1700} className="w-fit" />
        )}
        {extracted.length > 0 && (
          <div className="rounded-[18px] border border-border bg-card p-4" style={sweep ? SWEEP_STYLE : undefined}>
            <SectionLabel>Extracted frames</SectionLabel>
            <div className="mt-2 flex gap-2">
              {extracted.map((id, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={id}
                  src={cvImage("image", i + 1)}
                  alt={`Extracted frame ${i + 1}`}
                  className="h-16 rounded-[10px] border border-border object-cover"
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Each extracted frame is a new image object on the canvas.</p>
          </div>
        )}
      </div>

      {/* 右列工具 */}
      <div className="flex flex-col gap-5">
        <div className="rounded-[18px] border border-border bg-card p-4">
          <SectionLabel>Extract frame</SectionLabel>
          <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
            Pull the current frame out as a new image. Free, and it lands next to the clip.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" disabled={extracting} onClick={extractFrame}>
            <ImageIcon className="size-3.5" strokeWidth={2} />
            {extracting ? "Extracting…" : "Extract frame"}
          </Button>
        </div>

        <div className="rounded-[18px] border border-border bg-card p-4">
          <SectionLabel>Effects</SectionLabel>
          <div className="mt-2 flex flex-col gap-1.5">
            {EFFECTS.map((fx) => {
              const on = effects.includes(fx);
              return (
                <button
                  key={fx}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setEffects((prev) => (on ? prev.filter((f) => f !== fx) : [...prev, fx]))}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-[10px] border px-3 text-left text-[13px] font-medium transition-colors duration-[120ms]",
                    on ? "border-foreground bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Sparkles className="size-4" strokeWidth={2} />
                  <span className="flex-1">{fx}</span>
                  {on && <Check className="size-4" strokeWidth={2.2} />}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Effects preview free. They render into the clip on the next paid step.</p>
        </div>

        {trimmed && (
          <Badge variant="success" className="w-fit">
            Trimmed to {secs}s · saved as v2
          </Badge>
        )}
      </div>

      {/* E3 花费确认 */}
      <SpendConfirmDialog
        open={trimAsk}
        onOpenChange={setTrimAsk}
        title="Apply this trim?"
        ask="Trimming re-renders the clip. This will spend real credits."
        impacts={[
          `Cost: ${TRIM_COST} credits. No charge until you confirm.`,
          `The clip becomes ${secs}s long, saved as a new version.`,
          "The original stays in version history.",
        ]}
        confirmLabel={`Confirm trim · ${TRIM_COST} credits`}
        onConfirm={() => {
          setTrimAsk(false);
          setTrimming(true);
          setOttoWorking(true, "Trimming the clip…"); // dock 徽点脉冲
          timers.current.push(
            window.setTimeout(() => {
              // 重渲染完成即入账(共享 store;余额即时刷新)
              spendCredits(TRIM_COST, `Trim · ${secs}s`, "Video");
              setTrimming(false);
              setTrimmed(true);
              setOttoWorking(false);
            }, 2800),
          );
        }}
      />
    </div>
  );
}
