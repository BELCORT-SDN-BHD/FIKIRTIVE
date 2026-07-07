"use client";

/**
 * 北极星原型 — 分析区 + 广告区共用小件(zone kit)
 *
 * Panel           §D5 图表/数据面板底座(radius 18 · title 14/600 · basis 12)
 * ProvenancePill  §D1③ 数据出处印章("via Meta · read-only")
 * NsSkeleton      §FB7 骨架(shimmer 1.4s;.gb reduced-motion clamp 冻结循环)
 * LandIn          §8b 卡片落地(200ms spring;先占位后落地由调用方保证)
 * SweepBox        §8a coral 一次性 sweep(≤600ms;reduced motion → 静态描边 600ms)
 * DemoStateBar    原型专用:页内三态切换器(PROGRAM.md §3.1 设计审六条)
 * useReducedMotion / fmtCount / fmtMoney
 *
 * 铁律:纯展示、零后台 import、零新造色值(全部走 .gb token)。
 */

import * as React from "react";
import { cn } from "@/lib/utils";

/* ── zone keyframes(注入一次) ── */
const KEYFRAMES_ID = "ns-analytics-ads-keyframes";
const KEYFRAMES = `
@keyframes ns-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes ns-land { 0% { opacity: 0; transform: translateY(8px) scale(0.98); } 100% { opacity: 1; transform: none; } }
@keyframes ns-sweep {
  0% {
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent);
    background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent);
  }
  100% { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
`;

export function useZoneKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = KEYFRAMES_ID;
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/* ── number formatting(§D2 口径;prototype 本地实现,不 import lib) ── */

export function fmtCount(n: number): string {
  if (n >= 10000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}K`;
  }
  if (n >= 1000) return n.toLocaleString("en-MY");
  return String(n);
}

/** 金额:2 位小数,币种前缀来自数据(§D2 不写死货币符号)。 */
export function fmtMoney(prefix: string, n: number): string {
  return `${prefix} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ── Panel — §D5 面板底座 ── */

export function Panel({
  title,
  basis,
  stamp,
  actions,
  children,
  className,
}: {
  title?: string;
  /** 副标题 = 数据口径("Last 28 days · daily reach") */
  basis?: string;
  /** 出处印章文案("via Meta · read-only") */
  stamp?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-border bg-card p-4", className)}>
      {(title || stamp || actions) && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {basis && <p className="text-xs text-muted-foreground">{basis}</p>}
          </div>
          {stamp && <ProvenancePill text={stamp} />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ProvenancePill({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-background px-2.5 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground",
        className,
      )}
    >
      {text}
    </span>
  );
}

/* ── NsSkeleton — §FB7(shimmer 上限每屏 3 块,其余 static) ── */

export function NsSkeleton({
  className,
  shimmer = true,
}: {
  className?: string;
  /** false = 静态 --muted 占位(超出每屏 3 块 shimmer 上限时用) */
  shimmer?: boolean;
}) {
  useZoneKeyframes();
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-[10px]",
        shimmer
          ? "animate-[ns-shimmer_1.4s_ease-in-out_infinite] [background:linear-gradient(90deg,var(--border)_25%,var(--card)_50%,var(--border)_75%)] [background-size:200%_100%]"
          : "bg-muted",
        className,
      )}
    />
  );
}

/* ── LandIn — §8b 卡片落地(reduced motion 由 .gb clamp 压为即时) ── */

export function LandIn({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  useZoneKeyframes();
  return (
    <div
      className={className}
      style={{ animation: `ns-land 200ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delayMs}ms backwards` }}
    >
      {children}
    </div>
  );
}

/* ── SweepBox — §8a coral sweep(fireKey 变更即触发一次) ── */

export function SweepBox({
  fireKey = 0,
  children,
  className,
}: {
  /** 每次自增触发一次 sweep;0 = 不触发 */
  fireKey?: number;
  children: React.ReactNode;
  className?: string;
}) {
  useZoneKeyframes();
  const reduced = useReducedMotion();
  const [on, setOn] = React.useState(false);

  React.useEffect(() => {
    if (fireKey === 0) return;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), 650);
    return () => window.clearTimeout(t);
  }, [fireKey]);

  return (
    <div
      className={className}
      style={
        on
          ? reduced
            ? { boxShadow: "0 0 0 2px var(--brand)" }
            : { animation: "ns-sweep 600ms ease-out 1" }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/* ── DemoStateBar — 原型页内三态切换器(不是产品 UI) ── */

export type NsDemoState = "ready" | "loading" | "empty" | "error" | "disconnected";

const DEMO_LABELS: Record<NsDemoState, string> = {
  ready: "正常",
  loading: "加载",
  empty: "空态",
  error: "错误",
  disconnected: "未连接",
};

export function DemoStateBar({
  value,
  onChange,
  states = ["ready", "loading", "empty", "error"],
  className,
}: {
  value: NsDemoState;
  onChange: (s: NsDemoState) => void;
  states?: NsDemoState[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[10] flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <span className="px-2 font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-muted-foreground/70">
        演示
      </span>
      {states.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            "h-6 rounded-full px-2.5 font-mono text-[10px] leading-none font-medium tracking-[0.06em] transition-colors duration-[120ms]",
            value === s
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {DEMO_LABELS[s]}
        </button>
      ))}
    </div>
  );
}
