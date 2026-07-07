"use client";

/**
 * 北极星原型 · 自动化区共用小件
 *
 * design-rules v3 依据:
 * §8b card landing(200ms spring,先留位再落)/ §FB7 骨架 shimmer(1.4s,reduced 冻结)
 * §D4 行状态 / §FB1 行内错误 / PROGRAM §3.1 三态可切换 → DemoStates(原型专用角标)
 * §A5 一切 JS 动效自 gate 在 prefers-reduced-motion
 */

import * as React from "react";
import { cn } from "@/lib/utils";

/* ── 注入一次的 keyframes(.gb reduced-motion clamp 会压平/冻结) ── */
const KEYFRAMES_ID = "ns-automation-keyframes";
const KEYFRAMES = `
@keyframes ns-auto-land { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes ns-auto-sweep {
  from { box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
@keyframes ns-auto-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

export function useAutomationKeyframes() {
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

/* ── Landed:Otto 落卡(§8b landing + 可选 §8a sweep,一次性) ── */
export function Landed({
  children,
  sweep = false,
  delayMs = 0,
  className,
  style,
}: {
  children: React.ReactNode;
  sweep?: boolean;
  delayMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  useAutomationKeyframes();
  const reduced = useReducedMotion();
  const animation = reduced
    ? undefined
    : [
        `ns-auto-land 200ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delayMs}ms both`,
        sweep ? `ns-auto-sweep 600ms ease-out ${delayMs + 200}ms both` : null,
      ]
        .filter(Boolean)
        .join(", ");
  return (
    <div className={className} style={{ ...style, animation }}>
      {children}
    </div>
  );
}

/* ── 骨架(§FB7:形状同真内容,shimmer 1.4s) ── */
export function SkeletonBlock({ className, shimmer = true }: { className?: string; shimmer?: boolean }) {
  useAutomationKeyframes();
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn("rounded-[10px] bg-muted", className)}
      style={
        shimmer && !reduced
          ? {
              backgroundImage: "linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%)",
              backgroundSize: "200% 100%",
              animation: "ns-auto-shimmer 1.4s ease-in-out infinite",
            }
          : undefined
      }
    />
  );
}

/* ── 行内错误态(§FB1/§D4:面板 chrome 留着,13px error + ghost Retry) ── */
export function InlineError({ text, onRetry, className }: { text: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}>
      <p className="text-[13px] leading-[18px] font-medium text-error-soft-foreground" role="alert">
        {text}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center rounded-[10px] px-3.5 text-[13px] font-semibold text-foreground hover:bg-accent"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* ── credits 文案(§V5:spend 面只显示 credits) ── */
export function fmtCredits(n: number): string {
  return `${n.toLocaleString("en-MY")} credits`;
}

/* ── DemoStates:原型三态切换器(PROGRAM §3.1;非产品 UI,与 MockNote 同级角标) ── */
export type DemoState = "default" | "loading" | "empty" | "error";

export function DemoStates({
  value,
  onChange,
  className,
}: {
  value: DemoState;
  onChange: (s: DemoState) => void;
  className?: string;
}) {
  const states: DemoState[] = ["default", "loading", "empty", "error"];
  const labels: Record<DemoState, string> = { default: "正常", loading: "加载", empty: "空态", error: "错误" };
  return (
    <div
      className={cn(
        "fixed bottom-12 left-4 z-[10] inline-flex items-center gap-1 rounded-full border border-border bg-card p-0.5 shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      <span className="pl-2 font-mono text-[10px] leading-none font-medium tracking-[0.06em] text-muted-foreground/70">
        演示
      </span>
      {states.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            "h-6 rounded-full px-2 font-mono text-[10px] leading-none font-medium tracking-[0.06em]",
            value === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {labels[s]}
        </button>
      ))}
    </div>
  );
}
