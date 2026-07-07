"use client";

/**
 * 北极星原型 · 资产区 — 区内共用原语(design-rules v3)
 *
 * SweepIn        §8a/§8b 卡片降落 + coral sweep(一次性 ≤600ms;reduced motion = 静态描边 600ms)
 * GenBar         §FB8 不定长 coral 进度(.cv-gen-bar 配方;reduced motion 隐藏,文字承载进度)
 * Skeleton       §FB7 骨架(shimmer 1.4s;一屏最多 3 块在闪,其余静态 --muted)
 * SkeletonGrid   网格页三态之「加载」:同形骨架卡
 * ErrorPanel     §FB2/§D4 行内错误:soft 对 + ghost Retry,页头/工具条不消失
 * ZoneTabs       §N4 tabs 参考实现(--muted 井 + 活动卡片;←/→ roving focus)
 * SegChips       §N4 segmented(视图/筛选切换,2-5 项)
 * SearchField    §F8 带前置图标的搜索框(pl-40 / icon 16)
 * DemoStateBar   原型专用「三态演示」切换器(PROGRAM.md §3.1 设计审六条:空/载/错都要画)
 * OttoMark       ≤16px coral 标记(§O4 marks;成组算一个,配文字孪生)
 *
 * 铁律:纯展示零后台;coral 只属于 Otto;动效全部 gate 在 prefers-reduced-motion。
 */

import * as React from "react";
import { CircleAlert, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OttoAvatar } from "@/components/otto/OttoAvatar";

/* ── keyframes(注入一次;reduced-motion 覆盖随注) ───────────────────── */
const KEYFRAMES_ID = "ns-assets-keyframes";
const KEYFRAMES = `
@keyframes ns-a-arrive {
  0% { opacity: 0; transform: translateY(8px) scale(0.98); box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); }
  25% { opacity: 1; transform: translateY(0) scale(1); box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); }
  100% { opacity: 1; transform: none; box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
@keyframes ns-a-land {
  0% { opacity: 0; transform: translateY(8px) scale(0.98); }
  100% { opacity: 1; transform: none; }
}
@keyframes ns-a-slide { 0% { left: -40%; } 100% { left: 100%; } }
@keyframes ns-a-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.ns-a-skeleton {
  background: linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%);
  background-size: 200% 100%;
  animation: ns-a-shimmer 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ns-a-genbar { display: none; }
}
`;

function useZoneKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = KEYFRAMES_ID;
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/* ── SweepIn — §8a/§8b ──────────────────────────────────────────────────── */
export interface SweepInProps extends React.ComponentProps<"div"> {
  /** false = 仅降落动画,不带 coral sweep(人类动作的产物,如上传) */
  sweep?: boolean;
}

/** 挂载时降落 + (可选)coral sweep。要在原地重放 = 换 key 重挂载。 */
export function SweepIn({ sweep = true, className, style, children, ...props }: SweepInProps) {
  useZoneKeyframes();
  const reduced = useReducedMotion();
  const [held, setHeld] = React.useState(true);
  React.useEffect(() => {
    if (!reduced || !sweep) return;
    const t = window.setTimeout(() => setHeld(false), 600);
    return () => window.clearTimeout(t);
  }, [reduced, sweep]);

  const motionStyle: React.CSSProperties = reduced
    ? sweep && held
      ? { boxShadow: "0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)" }
      : {}
    : {
        animation: sweep
          ? "ns-a-arrive 800ms cubic-bezier(0.22, 1, 0.36, 1) both"
          : "ns-a-land 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
      };

  return (
    <div className={className} style={{ ...motionStyle, ...style }} {...props}>
      {children}
    </div>
  );
}

/* ── GenBar — §FB8 不定长 coral 条(Otto 的后台工作) ────────────────────── */
export function GenBar({ className }: { className?: string }) {
  useZoneKeyframes();
  return (
    <span
      aria-hidden
      className={cn(
        "ns-a-genbar relative block h-[5px] w-16 overflow-hidden rounded-full border border-border bg-background",
        className,
      )}
    >
      <span
        className="absolute top-0 h-full w-[40%] rounded-full bg-brand"
        style={{ animation: "ns-a-slide 1.3s ease-in-out infinite" }}
      />
    </span>
  );
}

/* ── Skeleton — §FB7 ────────────────────────────────────────────────────── */
export function Skeleton({
  shimmer = false,
  className,
}: {
  /** 一屏最多 3 块 shimmer,其余静态 */
  shimmer?: boolean;
  className?: string;
}) {
  useZoneKeyframes();
  return (
    <div
      aria-hidden
      className={cn("rounded-[10px]", shimmer ? "ns-a-skeleton" : "bg-muted", className)}
    />
  );
}

/** 网格加载态:同形骨架卡(前 3 张 shimmer) */
export function SkeletonGrid({
  count = 8,
  aspect = "aspect-square",
  minPx = 220,
}: {
  count?: number;
  aspect?: string;
  minPx?: number;
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minPx}px, 1fr))` }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton shimmer={i < 3} className={cn("w-full", aspect)} />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/* ── ErrorPanel — §FB2(fill + text,一个 ghost Retry;chrome 不消失) ──── */
export function ErrorPanel({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-[14px] bg-error-soft px-4 py-3",
        className,
      )}
    >
      <CircleAlert className="size-4 shrink-0 text-error-soft-foreground" strokeWidth={2} />
      <p className="min-w-0 flex-1 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
        {message}
      </p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ── ZoneTabs — §N4 tabs(Brand memory 参考型;←/→ roving focus) ────────── */
export interface ZoneTab {
  key: string;
  label: string;
  count?: number;
  /** 6px coral dot(Otto 刚更新;≤4s 自清,由调用方控制) */
  ottoDot?: boolean;
}

export function ZoneTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: ZoneTab[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.key === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[14px] bg-muted p-1",
        className,
      )}
    >
      {tabs.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] leading-[18px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "bg-card font-semibold text-foreground shadow-[var(--shadow-sm)]"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="text-[11px] leading-[14px] text-muted-foreground tabular-nums">
                {t.count}
              </span>
            )}
            {t.ottoDot && (
              <span aria-hidden className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-brand" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── SegChips — §N4 segmented(筛选/视图切换) ──────────────────────────── */
export function SegChips({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = options.findIndex((o) => o.key === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % options.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5",
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.key)}
            className={cn(
              "h-[30px] shrink-0 rounded-[8px] px-3 text-[12px] leading-none font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── SearchField — §F8 ─────────────────────────────────────────────────── */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full max-w-[360px]", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={2}
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-10"
      />
    </div>
  );
}

/* ── DemoStateBar — 原型三态演示切换器(非产品 UI,华语原型 chrome) ────── */
export type DemoState = "normal" | "loading" | "empty" | "error";

const DEMO_STATES: { key: DemoState; label: string }[] = [
  { key: "normal", label: "正常" },
  { key: "loading", label: "加载" },
  { key: "empty", label: "空" },
  { key: "error", label: "错误" },
];

export function DemoStateBar({
  state,
  onChange,
}: {
  state: DemoState;
  onChange: (s: DemoState) => void;
}) {
  return (
    <div className="fixed bottom-4 left-1/2 z-[10] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-3 shadow-[var(--shadow-sm)]">
      <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground">
        三态演示
      </span>
      <div className="flex items-center gap-0.5">
        {DEMO_STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(s.key)}
            aria-pressed={state === s.key}
            className={cn(
              "h-6 rounded-full px-2 text-[11px] leading-none font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              state === s.key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── OttoMark — ≤16px coral 标记 + 文字孪生(§O4 marks / §A6) ──────────── */
export function OttoMark({ label = "Otto", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground",
        className,
      )}
    >
      <OttoAvatar size={16} mood="idle" className="shrink-0" />
      {label}
    </span>
  );
}
