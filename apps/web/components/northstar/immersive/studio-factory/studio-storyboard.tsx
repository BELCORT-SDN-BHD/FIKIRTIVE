"use client";

/**
 * 沉浸式 · 分镜工作台 —— 原生重建(ENDGAME §五 一区)。
 * 四步出片:步骤 1-3 免费($0),第 4 步 make-all 渲染付费(spend 闸)。
 * Wave B:剧本导入拆场景 / 结构化镜头预设 / 逐镜 Retake / 动态分镜预览 / 参考视频 /
 * 音频驱动 / 硬字幕 / 多语言配音 —— 每条一行 [wave-b] 注释。
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Clapperboard, FileText, Film, Music, Pencil, Video, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { NS_PRODUCTS } from "@/components/northstar/_mock";
import { SectionLabel, SpendConfirmDialog, SWEEP_STYLE, useCreateKeyframes } from "@/components/northstar/create/_create-ui";
import { IMMERSIVE_BASE } from "../_kit";
import { ottoWorking as setOttoWorking, spendCredits, studioLogGen, useStore } from "../_store";
import { STUDIO_CAMERA_PRESETS, STUDIO_DUB_LANGS, STUDIO_SCENES, type StudioScene } from "./data";

const STEPS = [
  { n: 1, name: "Brief", cost: "$0" },
  { n: 2, name: "Scenes", cost: "$0" },
  { n: 3, name: "Voice & timing", cost: "$0" },
  { n: 4, name: "Render", cost: "paid" },
] as const;

type RenderState = "idle" | "rendering" | "done";

export function StudioStoryboard() {
  useCreateKeyframes();
  useStore();
  const router = useRouter();
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(2);
  const [scenes, setScenes] = React.useState<StudioScene[]>(STUDIO_SCENES);
  const [editing, setEditing] = React.useState<StudioScene | null>(null);
  const [retakeScene, setRetakeScene] = React.useState<StudioScene | null>(null);
  const [coherence, setCoherence] = React.useState(true);
  const [makeAllAsk, setMakeAllAsk] = React.useState(false);
  const [renderState, setRenderState] = React.useState<RenderState>("idle");
  const [renderPct, setRenderPct] = React.useState<Record<string, number>>({});
  const [sweepId, setSweepId] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  // [wave-b] 动态分镜预览:先出低成本粗看
  const [animatic, setAnimatic] = React.useState<"none" | "playing" | "ready">("none");
  const [refVideo, setRefVideo] = React.useState(false); // [wave-b] 视频级参考生成
  const [audioDriven, setAudioDriven] = React.useState(false); // [wave-b] 音频驱动生成
  const [burnCaptions, setBurnCaptions] = React.useState(true); // [wave-b] 视频硬字幕烧录
  const [dubLang, setDubLang] = React.useState(STUDIO_DUB_LANGS[0]); // [wave-b] 多语言口播配音
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const totalCredits = scenes.reduce((s, sc) => s + sc.credits, 0);
  const totalSeconds = scenes.reduce((s, sc) => s + sc.duration, 0);

  const startRender = (credits: number) => {
    spendCredits(credits, `Storyboard · ${scenes.length} scenes`, "Video");
    setOttoWorking(true, "Rendering scenes…");
    studioLogGen(`Rendering your ${scenes.length}-scene video (${totalSeconds}s). I'll ping you when it's cut.`, "Storyboard");
    setRenderState("rendering");
    setStep(4);
    scenes.forEach((sc, i) => {
      const t = window.setTimeout(() => {
        const iv = window.setInterval(() => {
          setRenderPct((prev) => {
            const cur = prev[sc.id] ?? 0;
            if (cur >= 100) {
              window.clearInterval(iv);
              return prev;
            }
            const next = { ...prev, [sc.id]: Math.min(100, cur + 9) };
            if (next[sc.id] === 100) {
              setSweepId(sc.id);
              window.setTimeout(() => setSweepId((s) => (s === sc.id ? null : s)), 650);
              if (i === scenes.length - 1) {
                window.setTimeout(() => {
                  setRenderState("done");
                  setOttoWorking(false);
                }, 500);
              }
            }
            return next;
          });
        }, 200);
        timers.current.push(iv);
      }, i * 1400);
      timers.current.push(t);
    });
  };

  const runAnimatic = () => {
    setAnimatic("playing");
    const t = window.setTimeout(() => setAnimatic("ready"), 2200);
    timers.current.push(t);
  };

  const moveScene = (id: string, dir: -1 | 1) => {
    setScenes((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, k) => ({ ...s, order: k + 1 }));
    });
  };

  const setCamera = (id: string, camera: string) => {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, camera } : s)));
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Storyboard"
        subtitle="Plan the whole video free. Pay once, at the render step."
        meta={[`${scenes.length} scenes`, `${totalSeconds}s total`]}
      />

      {/* 四步导航 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.n}>
            {i > 0 && <span aria-hidden className="h-px w-6 bg-border" />}
            <button
              type="button"
              onClick={() => setStep(s.n)}
              aria-current={step === s.n ? "step" : undefined}
              className={cn(
                "flex h-9 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors duration-[120ms]",
                step === s.n ? "border-transparent bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full font-mono text-[11px] leading-none",
                  step > s.n ? "bg-success-soft text-success-soft-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {step > s.n ? <Check className="size-3" strokeWidth={2.5} /> : s.n}
              </span>
              {s.name}
              <span className={cn("font-mono text-[10px] leading-none tracking-[0.06em]", s.cost === "paid" ? "text-brand-soft-foreground" : "text-muted-foreground")}>
                {s.cost}
              </span>
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Step 1 — Brief */}
      {step === 1 && (
        <div className="mt-6 max-w-[560px]">
          <div className="flex flex-col gap-5 rounded-[18px] border border-border bg-card p-6">
            <div>
              <label htmlFor="sb-product" className="text-[13px] leading-[18px] font-semibold text-foreground">Product</label>
              <select
                id="sb-product"
                defaultValue={NS_PRODUCTS[5].id}
                className="mt-2 h-11 w-full rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                {NS_PRODUCTS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sb-goal" className="text-[13px] leading-[18px] font-semibold text-foreground">What should this video do?</label>
              <textarea
                id="sb-goal"
                rows={3}
                defaultValue="Drive pre-orders for the Merdeka gift box before Friday."
                className="mt-2 w-full resize-none rounded-[14px] border border-input bg-card px-3.5 py-3 text-base leading-6 text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
              <p className="mt-2 text-xs text-muted-foreground">One goal per video works best.</p>
            </div>
            {/* [wave-b] 剧本/文案文件导入 + 场景→镜头两层结构(LTX) */}
            {/* [wave-b] 视频级参考生成(Grok reference-video conditioning) */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                <FileText className="size-3.5" strokeWidth={2} />
                Import a script
              </Button>
              <button
                type="button"
                onClick={() => setRefVideo((v) => !v)}
                aria-pressed={refVideo}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-[10px] border px-3.5 text-[13px] font-semibold transition-colors duration-[120ms]",
                  refVideo ? "border-foreground bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <Film className="size-3.5" strokeWidth={2} />
                {refVideo ? "Reference video attached" : "Match a reference video"}
              </button>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>Draft scenes · $0</Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — Scenes */}
      {step === 2 && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((sc, i) => (
              <div key={sc.id} className="group overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-xs)]">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sc.thumb} alt={sc.title} className="aspect-video w-full object-cover" />
                  <span className="absolute top-2 left-2 rounded-full bg-primary/75 px-2 py-0.5 font-mono text-[10px] leading-4 font-medium text-primary-foreground tabular-nums">
                    Scene {i + 1} · {sc.duration}s
                  </span>
                </div>
                <div className="p-4">
                  <p className="text-sm font-semibold text-foreground">{sc.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">{sc.shot}</p>
                  {/* [wave-b] 结构化镜头控制:机位/景别/运镜下拉预设(库扩到几十个) */}
                  <select
                    value={sc.camera}
                    onChange={(e) => setCamera(sc.id, e.target.value)}
                    aria-label={`Camera for scene ${i + 1}`}
                    className="mt-3 h-9 w-full rounded-[10px] border border-input bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    {STUDIO_CAMERA_PRESETS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <div className="mt-3 flex items-center gap-1">
                    <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setEditing(sc)}>
                      <Pencil className="size-3" strokeWidth={2} />
                      Edit
                    </Button>
                    {/* [wave-b] 局部/对话式改片(LTX Retake + invideo Magic Box) */}
                    <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => setRetakeScene(sc)}>
                      <Wand2 className="size-3" strokeWidth={2} />
                      Retake
                    </Button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      aria-label="Move scene earlier"
                      onClick={() => moveScene(sc.id, -1)}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      disabled={i === 0}
                    >
                      <ArrowUp className="size-3.5" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      aria-label="Move scene later"
                      onClick={() => moveScene(sc.id, 1)}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      disabled={i === scenes.length - 1}
                    >
                      <ArrowDown className="size-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setStep(3)}>Voice & timing · $0</Button>
          </div>
        </>
      )}

      {/* Step 3 — Voice & timing */}
      {step === 3 && (
        <div className="mt-6 max-w-[760px]">
          <div className="flex items-center justify-between rounded-[18px] border border-border bg-card p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Coherence mode</p>
              <p className="text-[13px] leading-[18px] text-muted-foreground">Keeps characters, kitchen and lighting consistent across all scenes.</p>
            </div>
            <Switch checked={coherence} onCheckedChange={setCoherence} aria-label="Coherence mode" />
          </div>

          {/* [wave-b] 多语言口播配音(LTX AI Dubbing)· [wave-b] 音频驱动生成 · [wave-b] 硬字幕烧录 */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[14px] border border-border bg-card p-4">
              <label htmlFor="sb-dub" className="text-[13px] font-semibold text-foreground">Voiceover language</label>
              <select
                id="sb-dub"
                value={dubLang}
                onChange={(e) => setDubLang(e.target.value)}
                className="mt-2 h-9 w-full rounded-[10px] border border-input bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                {STUDIO_DUB_LANGS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex items-start justify-between rounded-[14px] border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                  <Music className="size-3.5 text-muted-foreground" strokeWidth={2} />
                  Audio-driven
                </p>
                <p className="mt-0.5 text-xs leading-4 text-muted-foreground">Cut to an uploaded track</p>
              </div>
              <Switch checked={audioDriven} onCheckedChange={setAudioDriven} aria-label="Audio-driven timing" />
            </div>
            <div className="flex items-start justify-between rounded-[14px] border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">Burn in captions</p>
                <p className="mt-0.5 text-xs leading-4 text-muted-foreground">Subtitles baked into the frame</p>
              </div>
              <Switch checked={burnCaptions} onCheckedChange={setBurnCaptions} aria-label="Burn in captions" />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-[18px] border border-border bg-card">
            {scenes.map((sc, i) => (
              <div key={sc.id} className={cn("flex items-center gap-4 px-4 py-3", i > 0 && "border-t border-border")}>
                <span className="w-14 shrink-0 font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">{i + 1} · {sc.duration}s</span>
                <input
                  defaultValue={sc.voiceover}
                  aria-label={`Voiceover for scene ${i + 1}`}
                  className="h-9 min-w-0 flex-1 rounded-[10px] border border-transparent bg-transparent px-2 text-sm text-foreground outline-none hover:border-input focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setStep(4)}>Review render · $0</Button>
          </div>
        </div>
      )}

      {/* Step 4 — Render */}
      {step === 4 && (
        <div className="mt-6 max-w-[760px]">
          {/* [wave-b] 动态分镜预览(LTX animatics):便宜粗看确认节奏,再烧贵的视频 */}
          {renderState === "idle" && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Preview the cut first — free</p>
                <p className="text-[13px] text-muted-foreground">A rough animatic of the pacing before you spend on the real render.</p>
              </div>
              {animatic === "none" && <Button variant="secondary" size="sm" onClick={runAnimatic}>Preview animatic · $0</Button>}
              {animatic === "playing" && <OttoNarrationBar steps={["Sequencing scenes…", "Timing the beats…"]} stepMs={1000} className="w-fit" />}
              {animatic === "ready" && <Badge variant="success">Animatic ready · pacing looks good</Badge>}
            </div>
          )}

          {renderState === "rendering" && (
            <OttoNarrationBar steps={scenes.map((_, i) => `Rendering scene ${i + 1} of ${scenes.length}…`)} stepMs={1400} counter className="mb-4 w-fit" />
          )}
          <div className="overflow-hidden rounded-[18px] border border-border bg-card">
            {scenes.map((sc, i) => {
              const pct = renderPct[sc.id] ?? 0;
              return (
                <div
                  key={sc.id}
                  className={cn("flex items-center gap-4 px-4 py-3", i > 0 && "border-t border-border")}
                  style={sweepId === sc.id ? SWEEP_STYLE : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sc.thumb} alt="" aria-hidden className="h-10 w-[71px] shrink-0 rounded-[10px] border border-border object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">Scene {i + 1} · {sc.title}</p>
                    <p className="text-xs text-muted-foreground">{sc.duration}s · {sc.camera}</p>
                  </div>
                  {renderState === "idle" && (
                    <span className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">{sc.credits} credits</span>
                  )}
                  {renderState !== "idle" && pct < 100 && (
                    <span className="flex items-center gap-2">
                      <span className="relative h-[5px] w-20 overflow-hidden rounded-full border border-border bg-background">
                        <span className="absolute top-0 left-0 h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-9 text-right font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">{pct}%</span>
                    </span>
                  )}
                  {renderState !== "idle" && pct >= 100 && <Badge variant="success">Rendered</Badge>}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {renderState === "idle" && (
              <>
                <Button variant="brand" onClick={() => setMakeAllAsk(true)}>
                  Make all {scenes.length} scenes · {totalCredits} credits
                </Button>
                <p className="text-[13px] text-muted-foreground">Steps 1 to 3 were free. This is the only paid step.</p>
              </>
            )}
            {renderState === "done" && (
              <>
                <Badge variant="success">All scenes rendered</Badge>
                <p className="text-[13px] text-muted-foreground">You approved this. It used {totalCredits} credits.</p>
                <div className="flex-1" />
                <Button variant="secondary" size="sm" onClick={() => router.push(`${IMMERSIVE_BASE}/schedule/composer`)}>
                  Schedule this
                </Button>
                <Button variant="secondary" size="sm" onClick={() => router.push(`${IMMERSIVE_BASE}/assets/library`)}>
                  Open in Library
                </Button>
              </>
            )}
          </div>

          <SectionLabel className="mt-8">Settings carried into render</SectionLabel>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
            {coherence ? "Coherence on" : "Coherence off"} · Voiceover in {dubLang}
            {burnCaptions ? " · captions burned in" : ""}{audioDriven ? " · cut to your track" : ""}.
          </p>
        </div>
      )}

      {scenes.length === 0 && (
        <EmptyState icon={Clapperboard} title="No storyboard yet" body="Describe your video in the brief step, or ask Otto to draft the scenes." className="mt-10" />
      )}

      {/* 逐镜编辑 */}
      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Edit scene {editing ? scenes.findIndex((s) => s.id === editing.id) + 1 : ""}</DialogTitle>
            <DialogDescription>Scene edits are free until you render.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(null);
              }}
            >
              <div>
                <label htmlFor="sc-shot" className="text-[13px] leading-[18px] font-semibold text-foreground">Shot description</label>
                <textarea
                  id="sc-shot"
                  rows={3}
                  defaultValue={editing.shot}
                  className="mt-2 w-full resize-none rounded-[14px] border border-input bg-card px-3.5 py-3 text-base leading-6 text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                />
              </div>
              <DialogFooter className="flex-row justify-end gap-3">
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" size="sm">Save scene</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* [wave-b] 局部/对话式改片:圈一段说要改哪里,只重跑那一小段 */}
      <RetakeDialog scene={retakeScene} onOpenChange={(v) => !v && setRetakeScene(null)} />

      {/* [wave-b] 剧本导入:贴文案 → Otto 拆场景 → 确认 */}
      <ImportScriptDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSplit={() => {
          setImportOpen(false);
          setScenes(STUDIO_SCENES);
          setStep(2);
        }}
      />

      {/* make-all 闸 */}
      <SpendConfirmDialog
        open={makeAllAsk}
        onOpenChange={setMakeAllAsk}
        title={`Render all ${scenes.length} scenes?`}
        ask="This will spend real credits."
        impacts={[
          `Cost: ${totalCredits} credits (${scenes.length} scenes × 16). No charge until you confirm.`,
          `Renders a ${totalSeconds}s video, scene by scene, progress shown per scene.`,
          "Scenes that fail are not charged.",
        ]}
        confirmLabel={`Confirm render · ${totalCredits} credits`}
        onConfirm={() => {
          setMakeAllAsk(false);
          startRender(totalCredits);
        }}
        baseCredits={totalCredits}
        onConfirmTier={(_tier, credits) => {
          setMakeAllAsk(false);
          startRender(credits);
        }}
      />
    </div>
  );
}

/* ── [wave-b] 局部/对话式改片弹窗(LTX Retake + invideo Magic Box) ── */
function RetakeDialog({ scene, onOpenChange }: { scene: StudioScene | null; onOpenChange: (v: boolean) => void }) {
  const [instruction, setInstruction] = React.useState("");
  const [phase, setPhase] = React.useState<"input" | "working" | "done">("input");
  React.useEffect(() => {
    if (scene) {
      setInstruction("");
      setPhase("input");
    }
  }, [scene]);
  const run = () => {
    setPhase("working");
    window.setTimeout(() => setPhase("done"), 1600);
  };
  return (
    <Dialog open={scene !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Retake a few seconds</DialogTitle>
          <DialogDescription>Say what to change in this scene. Otto re-runs only this bit and keeps the rest.</DialogDescription>
        </DialogHeader>
        {phase !== "done" ? (
          <div className="flex flex-col gap-3">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Make the opening shorter / swap to a café scene…"
              className="h-11 rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
            <div className="flex justify-end">
              <Button onClick={run} disabled={phase === "working" || instruction.trim().length === 0}>
                {phase === "working" ? "Retaking…" : "Retake this bit · $0 preview"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Badge variant="success" className="w-fit">Preview updated</Badge>
            <p className="text-[13px] text-muted-foreground">The scene keeps its place in the sequence. Credits only apply when you render the final video.</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onOpenChange(false)}>Keep it</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── [wave-b] 剧本/文案导入 + 场景→镜头两层拆解(LTX) ── */
function ImportScriptDialog({ open, onOpenChange, onSplit }: { open: boolean; onOpenChange: (v: boolean) => void; onSplit: () => void }) {
  const [text, setText] = React.useState("");
  const [phase, setPhase] = React.useState<"input" | "working" | "done">("input");
  React.useEffect(() => {
    if (open) {
      setText("");
      setPhase("input");
    }
  }, [open]);
  const split = () => {
    setPhase("working");
    window.setTimeout(() => setPhase("done"), 1600);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import a script</DialogTitle>
          <DialogDescription>Paste copy you already wrote — Otto splits it into scenes and shots for you to confirm.</DialogDescription>
        </DialogHeader>
        {phase === "done" ? (
          <div className="rounded-[14px] border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">Split into 6 scenes</p>
            <p className="mt-2 text-[13px] text-foreground">Otto turned your script into a scene-by-shot storyboard. Review and edit any scene — nothing renders until you say so.</p>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Paste your promo copy or script here…"
            className="w-full resize-none rounded-[14px] border border-input bg-card px-3.5 py-3 text-base leading-6 text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
        )}
        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          {phase === "done" ? (
            <Button size="sm" onClick={onSplit}>Use these scenes</Button>
          ) : (
            <Button size="sm" onClick={split} disabled={phase === "working" || text.trim().length === 0}>
              {phase === "working" ? "Splitting…" : "Split into scenes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
