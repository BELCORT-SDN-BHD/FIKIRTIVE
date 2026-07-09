"use client";

/**
 * 分镜工作台 — storyboard 四步出片(区划图·中央区 #111/#114;storyboard specs F1-F4)
 * 步骤 1-3 免费($0),第 4 步渲染付费(make-all 闸)。逐镜编辑、渲染进度、连贯模式。
 */

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clapperboard,
  Pencil,
} from "lucide-react";
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
import { MockNote, OttoNarrationBar, PageHeader, EmptyState } from "../_shared";
import { NS_PRODUCTS } from "../_mock";
import { ottoWorking as setOttoWorking, spendCredits } from "../immersive/_store";
import { NS_SCENES, type NsScene } from "./_fixtures";
import {
  DemoStateBar,
  ErrorPanel,
  SectionLabel,
  Skeleton,
  SpendConfirmDialog,
  SWEEP_STYLE,
  useCreateKeyframes,
  type DemoState,
} from "./_create-ui";

const STEPS = [
  { n: 1, name: "Brief", cost: "$0" },
  { n: 2, name: "Scenes", cost: "$0" },
  { n: 3, name: "Voice & timing", cost: "$0" },
  { n: 4, name: "Render", cost: "paid" },
] as const;

type RenderState = "idle" | "rendering" | "done";

export function StoryboardPage() {
  useCreateKeyframes();
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(2);
  const [scenes, setScenes] = React.useState<NsScene[]>(NS_SCENES);
  const [editing, setEditing] = React.useState<NsScene | null>(null);
  const [coherence, setCoherence] = React.useState(true);
  const [makeAllAsk, setMakeAllAsk] = React.useState(false);
  const [renderState, setRenderState] = React.useState<RenderState>("idle");
  const [renderPct, setRenderPct] = React.useState<Record<string, number>>({});
  const [sweepId, setSweepId] = React.useState<string | null>(null);
  const [demo, setDemo] = React.useState<DemoState>("live");
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const totalCredits = scenes.reduce((s, sc) => s + sc.credits, 0);
  const totalSeconds = scenes.reduce((s, sc) => s + sc.duration, 0);

  const startRender = (credits: number) => {
    // 第 4 步是唯一付费点:确认即入账 + Otto 进工作态(共享 store)
    spendCredits(credits, `Storyboard · ${scenes.length} scenes`, "Video");
    setOttoWorking(true, "Rendering scenes…");
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
                  setOttoWorking(false); // 全部渲染完 → Otto idle
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

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Storyboard"
        subtitle="Plan the whole video free. Pay once, at the render step."
        meta={[`${scenes.length} scenes`, `${totalSeconds}s total`]}
        actions={<DemoStateBar state={demo} onChange={setDemo} />}
      />

      {/* 四步导航:1-3 免费,4 付费 */}
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
                step === s.n
                  ? "border-transparent bg-secondary text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
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
              <span
                className={cn(
                  "font-mono text-[10px] leading-none tracking-[0.06em]",
                  s.cost === "paid" ? "text-brand-soft-foreground" : "text-muted-foreground",
                )}
              >
                {s.cost}
              </span>
            </button>
          </React.Fragment>
        ))}
      </div>

      {demo === "loading" && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} shimmer={i < 3} className="h-56 w-full rounded-[18px]" />
          ))}
        </div>
      )}
      {demo === "empty" && (
        <EmptyState
          icon={Clapperboard}
          title="No storyboard yet"
          body="Describe your video in the brief step, or ask Otto to draft the scenes."
          className="mt-10"
          action={<Button size="sm" onClick={() => setDemo("live")}>Start a brief</Button>}
        />
      )}
      {demo === "error" && (
        <ErrorPanel className="mt-6" what="Couldn't load this storyboard." money="You weren't charged." onRetry={() => setDemo("live")} />
      )}

      {demo === "live" && (
        <>
          {/* Step 1 — Brief */}
          {step === 1 && (
            <div className="mt-6 max-w-[560px]">
              <div className="flex flex-col gap-5 rounded-[18px] border border-border bg-card p-6">
                <div>
                  <label htmlFor="sb-product" className="text-[13px] leading-[18px] font-semibold text-foreground">
                    Product
                  </label>
                  <select
                    id="sb-product"
                    defaultValue={NS_PRODUCTS[5].id}
                    className="mt-2 h-11 w-full rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    {NS_PRODUCTS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sb-goal" className="text-[13px] leading-[18px] font-semibold text-foreground">
                    What should this video do?
                  </label>
                  <textarea
                    id="sb-goal"
                    rows={3}
                    defaultValue="Drive pre-orders for the Merdeka gift box before Friday."
                    className="mt-2 w-full resize-none rounded-[14px] border border-input bg-card px-3.5 py-3 text-base leading-6 text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">One goal per video works best.</p>
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => setStep(2)}>Draft scenes · $0</Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Scenes(分镜卡 + 逐镜编辑) */}
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
                      <div className="mt-3 flex items-center gap-1">
                        <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setEditing(sc)}>
                          <Pencil className="size-3" strokeWidth={2} />
                          Edit
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

          {/* Step 3 — Voice & timing + 连贯模式 */}
          {step === 3 && (
            <div className="mt-6 max-w-[760px]">
              <div className="flex items-center justify-between rounded-[18px] border border-border bg-card p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Coherence mode</p>
                  <p className="text-[13px] leading-[18px] text-muted-foreground">
                    Keeps characters, kitchen and lighting consistent across all scenes.
                  </p>
                </div>
                <Switch checked={coherence} onCheckedChange={setCoherence} aria-label="Coherence mode" />
              </div>
              <div className="mt-4 overflow-hidden rounded-[18px] border border-border bg-card">
                {scenes.map((sc, i) => (
                  <div key={sc.id} className={cn("flex items-center gap-4 px-4 py-3", i > 0 && "border-t border-border")}>
                    <span className="w-14 shrink-0 font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">
                      {i + 1} · {sc.duration}s
                    </span>
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

          {/* Step 4 — Render(make-all 闸 + 渲染进度) */}
          {step === 4 && (
            <div className="mt-6 max-w-[760px]">
              {renderState === "rendering" && (
                <OttoNarrationBar
                  steps={scenes.map((_, i) => `Rendering scene ${i + 1} of ${scenes.length}…`)}
                  stepMs={1400}
                  counter
                  className="mb-4 w-fit"
                />
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
                        <p className="truncate text-sm font-semibold text-foreground">
                          Scene {i + 1} · {sc.title}
                        </p>
                        <p className="text-xs text-muted-foreground">{sc.duration}s</p>
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
                      {renderState !== "idle" && pct >= 100 && (
                        <Badge variant="success">Rendered</Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center gap-3">
                {renderState === "idle" && (
                  <>
                    <Button variant="brand" onClick={() => setMakeAllAsk(true)}>
                      Make all {scenes.length} scenes · {totalCredits} credits
                    </Button>
                    <p className="text-[13px] text-muted-foreground">
                      Steps 1 to 3 were free. This is the only paid step.
                    </p>
                  </>
                )}
                {renderState === "done" && (
                  <>
                    <Badge variant="success">All scenes rendered</Badge>
                    <p className="text-[13px] text-muted-foreground">
                      You approved this. It used {totalCredits} credits.
                    </p>
                    <div className="flex-1" />
                    <Button variant="secondary" size="sm">Open in canvas</Button>
                  </>
                )}
              </div>

              <SectionLabel className="mt-8">Coherence</SectionLabel>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                {coherence
                  ? "Coherence mode is on: one look carried across all scenes."
                  : "Coherence mode is off: each scene renders independently."}
              </p>
            </div>
          )}
        </>
      )}

      {/* 逐镜编辑 dialog */}
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
                <label htmlFor="sc-shot" className="text-[13px] leading-[18px] font-semibold text-foreground">
                  Shot description
                </label>
                <textarea
                  id="sc-shot"
                  rows={3}
                  defaultValue={editing.shot}
                  className="mt-2 w-full resize-none rounded-[14px] border border-input bg-card px-3.5 py-3 text-base leading-6 text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                />
              </div>
              <div>
                <label htmlFor="sc-dur" className="text-[13px] leading-[18px] font-semibold text-foreground">
                  Duration
                </label>
                <select
                  id="sc-dur"
                  defaultValue={String(editing.duration)}
                  className="mt-2 h-11 w-full rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  {[2, 3, 4, 5, 6].map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </select>
              </div>
              <DialogFooter className="flex-row justify-end gap-3">
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Save scene
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* make-all 闸(判决:批量总价一次确认) */}
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

      <MockNote path="/northstar/create/storyboard" />
    </div>
  );
}
