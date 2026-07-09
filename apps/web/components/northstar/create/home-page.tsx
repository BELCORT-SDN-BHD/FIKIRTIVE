"use client";

/**
 * 创作首页(front door)— GOAL A0
 * Featured 模板横排 + Discover 瀑布流(悬停自动播放)+ What's new 首登弹窗 + 三模式输入框入口。
 * 前门原型:composer 提交 = 跳 canvas(页内静态跳转,不发请求)。
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
  Image as ImageIcon,
  Play,
  Sparkles,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MockNote } from "../_shared";
import { useImmersiveRouter } from "../immersive/_kit";
import { balance as getBalance, useStore } from "../immersive/_store";
import { NS_DISCOVER, NS_TEMPLATES } from "./_fixtures";
import {
  DemoStateBar,
  ErrorPanel,
  SectionLabel,
  Skeleton,
  useCreateKeyframes,
  type DemoState,
} from "./_create-ui";

type Mode = "image" | "video" | "agent";

const MODE_META: Record<Mode, { icon: React.ElementType; label: string; placeholder: string; chips: string[] }> = {
  image: {
    icon: ImageIcon,
    label: "Image",
    placeholder: "Describe the image you want to make…",
    chips: ["1:1", "4:5", "9:16", "A/B pair"],
  },
  video: {
    icon: Video,
    label: "Video",
    placeholder: "Describe the video you want to make…",
    chips: ["6s", "10s", "480p", "720p"],
  },
  agent: {
    icon: Bot,
    label: "Agent",
    placeholder: "Tell Otto the outcome you want. He plans and asks before spending.",
    chips: ["Clarifies first", "Asks before spending"],
  },
};

export function CreateHomePage() {
  useCreateKeyframes();
  useStore(); // 订阅共享余额(与画布/工厂同一数字,不再读静态 mock)
  // 壳内 push 改写到 /northstar-immersive/*(不弹出常驻壳);壳外原样跳画廊。
  const { push } = useImmersiveRouter();
  const [mode, setMode] = React.useState<Mode>("image");
  const [prompt, setPrompt] = React.useState("");
  const [chip, setChip] = React.useState<string>("1:1");
  const [whatsNew, setWhatsNew] = React.useState(false);
  const [demo, setDemo] = React.useState<DemoState>("live");
  const [playing, setPlaying] = React.useState<string | null>(null);

  // What's new 首登弹窗(首访一次;原型用本地状态模拟首登)
  React.useEffect(() => {
    const t = window.setTimeout(() => setWhatsNew(true), 500);
    return () => window.clearTimeout(t);
  }, []);

  const meta = MODE_META[mode];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // composer 提交把 prompt 带进画布(canvas 挂载时预填首句)—— 断头路全通
    const q = prompt.trim();
    push(q ? `/northstar/create/canvas?prompt=${encodeURIComponent(q)}` : "/northstar/create/canvas");
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      {/* 前门:居中 560 列,display 字阶 + 一个 composer */}
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
            {/* 三模式切换(A1):segmented,参数芯片随模式重排 */}
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
                        mode === m
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground",
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

            {/* 参数栏随模式重排 */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {meta.chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChip(c)}
                  aria-pressed={chip === c}
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-xs font-semibold transition-colors duration-[120ms]",
                    chip === c
                      ? "border-transparent bg-secondary text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
              {mode === "video" && (
                <span className="ml-1 text-xs text-muted-foreground">
                  Video generation asks before it spends credits.
                </span>
              )}
            </div>
          </div>
        </form>
      </section>

      {/* Featured 模板横排 */}
      <section className="mt-8">
        <div className="flex items-center gap-3">
          <SectionLabel>Featured templates</SectionLabel>
          <div className="flex-1" />
          <Link
            href="/northstar/assets/templates"
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            All templates
          </Link>
        </div>
        <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
          {NS_TEMPLATES.map((t) => (
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
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => push(`/northstar/create/canvas?from=${t.id}`)}
                >
                  Use
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Discover 瀑布流(悬停自动播放) */}
      <section className="mt-10">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>Discover</SectionLabel>
          <span className="text-xs text-muted-foreground">Hover a video to preview it</span>
          <div className="flex-1" />
          <DemoStateBar state={demo} onChange={setDemo} />
        </div>

        {demo === "loading" && (
          <div className="mt-3 columns-2 gap-4 md:columns-3 lg:columns-4 [&>*]:mb-4">
            {[220, 320, 260, 300, 220, 340, 260, 220].map((h, i) => (
              <Skeleton
                key={i}
                shimmer={i < 3}
                className="w-full break-inside-avoid rounded-[18px]"
                style={{ height: h }}
              />
            ))}
          </div>
        )}

        {demo === "empty" && (
          <p className="mt-6 text-[13px] text-muted-foreground">
            Nothing to discover yet. New picks land here every week.
          </p>
        )}

        {demo === "error" && (
          <ErrorPanel className="mt-4" what="Couldn't load Discover." onRetry={() => setDemo("live")} />
        )}

        {demo === "live" && (
          <div className="mt-3 columns-2 gap-4 md:columns-3 lg:columns-4 [&>*]:mb-4">
            {NS_DISCOVER.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => push(`/northstar/create/canvas?from=${d.id}`)}
                onMouseEnter={() => d.kind === "video" && setPlaying(d.id)}
                onMouseLeave={() => setPlaying((p) => (p === d.id ? null : p))}
                className="group relative block w-full break-inside-avoid overflow-hidden rounded-[18px] border border-border bg-card text-left shadow-[var(--shadow-xs)] transition-shadow duration-[150ms] hover:shadow-[var(--shadow-md)] focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={d.thumb}
                  alt={d.title}
                  className={cn("w-full object-cover", d.tall ? "aspect-[9/14]" : "aspect-square")}
                />
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
                    <span className="block truncate text-[13px] font-semibold text-primary-foreground">
                      {d.title}
                    </span>
                    <span className="block text-[11px] text-primary-foreground/75">
                      {playing === d.id ? "Playing preview…" : d.by}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
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
            <Button variant="secondary" size="sm" onClick={() => setWhatsNew(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setWhatsNew(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-6 flex justify-center">
        <Badge variant="outline" className="text-muted-foreground">
          Featured and Discover are examples, not live content
        </Badge>
      </div>

      <MockNote path="/northstar/create/home" />
    </div>
  );
}
