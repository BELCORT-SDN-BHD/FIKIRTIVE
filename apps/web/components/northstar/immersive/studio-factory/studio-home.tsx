"use client";

/**
 * 沉浸式 · Studio 创作首页(front door)—— GalleryFrame 套壳原生重建(ENDGAME §五 一区)。
 *
 * 三模式 composer(image/video/agent)提交 → 跳 canvas 裂变(零花费,只跳转);
 * Featured 模板横排 + Discover 瀑布流(真图,video 悬停预览)+ What's new 首登弹窗。
 * 每个可点元素都接一个真实去处(canvas / storyboard / factory / assets),读面不留死胡同。
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Bot, Image as ImageIcon, Link2, Play, Sparkles, Video, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nsImage } from "@/components/northstar/_mock";
import { SectionLabel } from "@/components/northstar/create/_create-ui";
import { IMMERSIVE_BASE } from "../_kit";
import { OttoAssist } from "../otto-assist";
import { balance as getBalance, useStore } from "../_store";
import {
  STUDIO_DISCOVER,
  STUDIO_LOCAL_MOMENTS,
  STUDIO_SEA_TRENDS,
  STUDIO_TEMPLATES,
  STUDIO_WORKFLOWS,
  type StudioWorkflow,
} from "./data";

type Mode = "image" | "video" | "agent";

const MODE_META: Record<Mode, { icon: React.ElementType; label: string; placeholder: string; chips: string[] }> = {
  image: { icon: ImageIcon, label: "Image", placeholder: "Describe the image you want to make…", chips: ["1:1", "4:5", "9:16", "A/B pair"] },
  video: { icon: Video, label: "Video", placeholder: "Describe the video you want to make…", chips: ["6s", "10s", "480p", "720p"] },
  agent: { icon: Bot, label: "Agent", placeholder: "Tell Otto the outcome you want. He plans and asks before spending.", chips: ["Clarifies first", "Asks before spending"] },
};

/** 一排 12 张 stock 占位图(真图),供 #25「先用素材顶上」挑一张开画布。 */
const STOCK_PICKS = Array.from({ length: 12 }, (_, i) => nsImage(i % 2 === 0 ? "bakery" : "storefront", i + 2));

export function StudioHome() {
  useStore(); // 订阅共享余额(与画布/工厂同一数字)
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("image");
  const [prompt, setPrompt] = React.useState("");
  const [chip, setChip] = React.useState("1:1");
  const [whatsNew, setWhatsNew] = React.useState(false);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [urlOpen, setUrlOpen] = React.useState(false);
  const [stockOpen, setStockOpen] = React.useState(false);
  const [workflow, setWorkflow] = React.useState<StudioWorkflow | null>(null);

  // #2(懵):真·首跑不弹「上次访问以来的更新」—— 首访只记 seen,更新记录留给回访用户。
  React.useEffect(() => {
    const KEY = "ns-studio-home-seen";
    let seen = false;
    try {
      seen = window.localStorage.getItem(KEY) === "1";
    } catch {
      seen = false;
    }
    if (!seen) {
      try {
        window.localStorage.setItem(KEY, "1");
      } catch {
        /* private mode — just skip the dialog */
      }
      return;
    }
    const t = window.setTimeout(() => setWhatsNew(true), 500);
    return () => window.clearTimeout(t);
  }, []);

  const meta = MODE_META[mode];
  const goCanvas = (q?: string, extra?: string) => {
    const qs = new URLSearchParams();
    if (q) qs.set("prompt", q);
    if (extra) qs.set("from", extra);
    const s = qs.toString();
    router.push(`${IMMERSIVE_BASE}/create/canvas${s ? `?${s}` : ""}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    goCanvas(prompt.trim() || undefined);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      {/* 前门:居中 560 列 + 一个 composer */}
      <section className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-6 pt-10 pb-4 text-center">
        <div>
          <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.021em] text-foreground">
            What are we making today?
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Start from a blank prompt, a template, or something you saw below.
          </p>
        </div>

        <form onSubmit={submit} className="w-full">
          <div className="rounded-[18px] border border-border bg-card p-3 shadow-[var(--shadow-sm)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
            <div className="flex items-center justify-between gap-2">
              <div className="flex rounded-[10px] border border-border bg-card p-0.5">
                {(Object.keys(MODE_META) as Mode[]).map((m) => {
                  const Icon = MODE_META[m].icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMode(m);
                        setChip(MODE_META[m].chips[0]);
                      }}
                      aria-pressed={mode === m}
                      className={cn(
                        "flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-[120ms]",
                        mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={2} />
                      {MODE_META[m].label}
                    </button>
                  );
                })}
              </div>
              <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
                {getBalance().toLocaleString()} credits
              </span>
            </div>

            <div className="mt-2 flex items-end gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={meta.placeholder}
                className="h-11 min-w-0 flex-1 bg-transparent px-1 text-[15px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Button type="submit" size="icon" className="size-9 rounded-[10px]" aria-label="Start creating">
                <ArrowUp className="size-4" strokeWidth={2.2} />
              </Button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {meta.chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChip(c)}
                  aria-pressed={chip === c}
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-xs font-semibold transition-colors duration-[120ms]",
                    chip === c ? "border-transparent bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
              {mode === "video" && (
                <span className="ml-1 text-xs text-muted-foreground">Video generation asks before it spends credits.</span>
              )}
            </div>
          </div>
        </form>

        {/* 两个开箱入口 */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* [wave-b] 网站/IG 主页一键建品牌档案(Adobe Add from URL) */}
          <Button variant="secondary" size="sm" onClick={() => setUrlOpen(true)}>
            <Link2 className="size-3.5" strokeWidth={2} />
            Build brand from a link
          </Button>
          {/* [wave-b] 免费/低门槛素材库(invideo):先用素材图顶上再逐步换 */}
          <Button variant="secondary" size="sm" onClick={() => setStockOpen(true)}>
            <ImageIcon className="size-3.5" strokeWidth={2} />
            Start from a stock photo
          </Button>
          {/* §O7「Otto 帮我」:空框不逼人从零写 —— Apply 把起手 prompt 填进 composer */}
          <OttoAssist
            zone="Studio"
            entityLabel="a new creation"
            formState={{ mode, prompt }}
            intents={[
              {
                id: "home-idea",
                label: "Give me a post idea",
                prompt: "What should I post this week?",
                reply: "A quick winner: a close-up of your bestseller with a one-line hook. Apply drops a starting prompt into the box — tweak it and hit go.",
                apply: { summary: "Fill a starter prompt", patch: { kind: "prompt", text: "A warm close-up of my bestseller pastry, fresh from the morning batch, with space for a one-line hook" } },
              },
              {
                id: "home-stuck",
                label: "I don't know where to start",
                prompt: "I'm not sure what to make.",
                reply: "Pick one product and one moment. \"My kaya croissant at 7am\" is enough — Otto turns a plain line like that into a full image or short. You don't need to write like a copywriter.",
              },
            ]}
            onApply={(a) => {
              const patch = a.patch as { kind?: string; text?: string };
              if (patch.kind === "prompt" && patch.text) setPrompt(patch.text);
            }}
          />
        </div>
      </section>

      {/* Featured 模板横排 */}
      <section className="mt-8">
        <div className="flex items-center gap-3">
          <SectionLabel>Featured templates</SectionLabel>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => router.push(`${IMMERSIVE_BASE}/assets/templates`)}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            All templates
          </button>
        </div>
        <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
          {STUDIO_TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="group w-56 shrink-0 overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-xs)] transition-shadow duration-[150ms] hover:shadow-[var(--shadow-md)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.thumb} alt={t.name} className="aspect-[4/3] w-full object-cover" />
              <div className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.uses}</p>
                </div>
                <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => goCanvas(undefined, t.id)}>
                  Use
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* [wave-b] 完整流程模板(Grok Workflow templates):一键从 brief 跑到成片 */}
      <section className="mt-10">
        <SectionLabel>One-tap workflows</SectionLabel>
        <p className="mt-1 text-xs text-muted-foreground">Pick an outcome — Otto runs the whole pipeline, asking before it spends.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDIO_WORKFLOWS.map((wf) => (
            <button
              key={wf.id}
              type="button"
              onClick={() => setWorkflow(wf)}
              className="group overflow-hidden rounded-[18px] border border-border bg-card text-left shadow-[var(--shadow-xs)] transition-shadow duration-[150ms] hover:shadow-[var(--shadow-md)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={wf.thumb} alt={wf.name} className="aspect-[16/9] w-full object-cover" />
              <div className="p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Wand2 className="size-3.5 text-muted-foreground" strokeWidth={2} />
                  {wf.name}
                </p>
                <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{wf.outcome}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* [wave-b] 本地场景启动模板(Canva 薄层)+ [wave-b] SEA 本地热梗模板(Higgsfield) */}
      <section className="mt-10 grid gap-8 lg:grid-cols-2">
        <div>
          <SectionLabel>Local moments</SectionLabel>
          <div className="mt-3 flex flex-col gap-2">
            {STUDIO_LOCAL_MOMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => goCanvas(`Start from the “${s.name}” moment`, s.id)}
                className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-2 pr-3 text-left transition-colors duration-[120ms] hover:bg-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.thumb} alt="" aria-hidden className="size-12 shrink-0 rounded-[10px] object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">{s.moment}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel>Trending in Malaysia</SectionLabel>
          <div className="mt-3 flex flex-col gap-2">
            {STUDIO_SEA_TRENDS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => goCanvas(`Ride the “${s.name}” trend`, s.id)}
                className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-2 pr-3 text-left transition-colors duration-[120ms] hover:bg-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.thumb} alt="" aria-hidden className="size-12 shrink-0 rounded-[10px] object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">{s.moment}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Discover 瀑布流(真图;悬停 video 预览) */}
      <section className="mt-10">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>Discover</SectionLabel>
          <span className="text-xs text-muted-foreground">Hover a video to preview it</span>
        </div>
        <div className="mt-3 columns-2 gap-4 md:columns-3 lg:columns-4 [&>*]:mb-4">
          {STUDIO_DISCOVER.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => goCanvas(`Make “${d.title}” your own`, d.id)}
              onMouseEnter={() => d.kind === "video" && setPlaying(d.id)}
              onMouseLeave={() => setPlaying((p) => (p === d.id ? null : p))}
              className="group relative block w-full break-inside-avoid overflow-hidden rounded-[18px] border border-border bg-card text-left shadow-[var(--shadow-xs)] outline-none transition-shadow duration-[150ms] hover:shadow-[var(--shadow-md)] focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.thumb} alt={d.title} className={cn("w-full object-cover", d.tall ? "aspect-[9/14]" : "aspect-square")} />
              {d.kind === "video" && (
                <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-primary/80 text-primary-foreground">
                  <Play className="size-3.5" strokeWidth={2} />
                </span>
              )}
              {playing === d.id && (
                <span className="absolute right-2 bottom-11 left-2">
                  <span className="block h-1 overflow-hidden rounded-full bg-primary-foreground/40">
                    <span className="block h-full w-1/3 rounded-full bg-card" />
                  </span>
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-[rgba(10,10,12,0.65)] to-transparent p-3 pt-8">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-primary-foreground">{d.title}</span>
                  <span className="block text-[11px] text-primary-foreground/75">{playing === d.id ? "Playing preview…" : d.by}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* What's new 首登弹窗 */}
      <Dialog open={whatsNew} onOpenChange={setWhatsNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What&apos;s new this week</DialogTitle>
            <DialogDescription>Three things since your last visit.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-3">
            {[
              { title: "Video trim on the canvas", body: "Drag the handles on any clip to change its length in place." },
              { title: "Merdeka template pack", body: "Five festive layouts tuned for pre-order pushes." },
              { title: "Stitch two clips", body: "Select exactly two videos to join them into one." },
            ].map((n) => (
              <li key={n.title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
                  <Sparkles className="size-4 text-muted-foreground" strokeWidth={2} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{n.title}</p>
                  <p className="text-[13px] leading-[18px] text-muted-foreground">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setWhatsNew(false)}>Cancel</Button>
            <Button size="sm" onClick={() => setWhatsNew(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* [wave-b] URL 建品牌档案弹窗 */}
      <BrandFromUrlDialog open={urlOpen} onOpenChange={setUrlOpen} onDone={() => router.push(`${IMMERSIVE_BASE}/assets/brand-kit`)} />

      {/* [wave-b] Stock 挑图弹窗 */}
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Start from a stock photo</DialogTitle>
            <DialogDescription>Pick a placeholder to open on the canvas, then swap in your own shot later. Free.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2">
            {STOCK_PICKS.map((src, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setStockOpen(false);
                  goCanvas("Start from this stock photo", `stock-${i}`);
                }}
                className="overflow-hidden rounded-[10px] border border-border outline-none transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Stock photo ${i + 1}`} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* [wave-b] Workflow 展开确认 */}
      <Dialog open={workflow !== null} onOpenChange={(v) => !v && setWorkflow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{workflow?.name}</DialogTitle>
            <DialogDescription>{workflow?.outcome}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-2">
            {workflow?.steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm text-foreground">
                <span className="flex size-6 items-center justify-center rounded-full bg-secondary font-mono text-[11px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setWorkflow(null)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                const wf = workflow;
                setWorkflow(null);
                goCanvas(`Run the “${wf?.name}” workflow`, wf?.id);
              }}
            >
              Run workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── [wave-b] URL → 品牌档案草稿(Adobe Add from URL);轻原型:贴链接 → 假抽取 → 确认 ── */
function BrandFromUrlDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  // [B0-82 lint 适配 · 照 #255 先例] 弹窗本地态(url/phase)下沉 BrandFromUrlBody:Radix
  // 关即卸载、开即新挂,useState 初值即「每次打开清空重来」,替代原 open-effect 同步重置
  // (set-state-in-effect 正解;关闭动画期实例仍在、画面不变,重开 = 新实例 = 空表单)。
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <BrandFromUrlBody onOpenChange={onOpenChange} onDone={onDone} />
      </DialogContent>
    </Dialog>
  );
}

function BrandFromUrlBody({ onOpenChange, onDone }: { onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [url, setUrl] = React.useState("");
  const [phase, setPhase] = React.useState<"input" | "reading" | "preview">("input");
  const read = () => {
    setPhase("reading");
    window.setTimeout(() => setPhase("preview"), 1400);
  };
  return (
    <>
        <DialogHeader>
          <DialogTitle>Build a brand profile from a link</DialogTitle>
          <DialogDescription>Paste your website or IG page — Otto drafts your colours, voice and look. Free.</DialogDescription>
        </DialogHeader>
        {phase !== "preview" ? (
          <div className="flex items-center gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="instagram.com/rotibulan.bakery"
              className="h-11 min-w-0 flex-1 rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
            <Button onClick={read} disabled={phase === "reading" || url.trim().length === 0} className="h-11">
              {phase === "reading" ? "Reading…" : "Read"}
            </Button>
          </div>
        ) : (
          <div className="rounded-[14px] border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">Draft brand profile</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-foreground">
              <li>Colours: pandan green, gula-melaka brown, cream</li>
              <li>Voice: warm, neighbourly, a little playful</li>
              <li>Look: soft daylight, marble & kraft textures</li>
            </ul>
          </div>
        )}
        {phase === "preview" && (
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Not now</Button>
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onDone();
              }}
            >
              Save to brand kit
            </Button>
          </DialogFooter>
        )}
    </>
  );
}
