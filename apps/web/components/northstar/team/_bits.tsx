"use client";

/**
 * 北极星原型 · 团队协作区共用小件
 *
 * design-rules v3 依据:§8b card landing / §FB7 骨架 shimmer / §FB1 行内错误 /
 * §D4 行状态 / PROGRAM §3.1 三态切换器。所有 JS 动效自 gate 在 prefers-reduced-motion。
 * 头像用首字母 chip(零外链);seatType / role 用文字标签(不发明品牌图标)。
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { SeatType } from "./_data";

/* ── keyframes(注入一次;.gb reduced clamp 会压平/冻结) ── */
const KEYFRAMES_ID = "ns-team-keyframes";
const KEYFRAMES = `
@keyframes ns-team-land { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes ns-team-sweep {
  from { box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
@keyframes ns-team-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

export function useTeamKeyframes() {
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

/* ── Landed:落卡(§8b + 可选 sweep) ── */
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
  useTeamKeyframes();
  const reduced = useReducedMotion();
  const animation = reduced
    ? undefined
    : [
        `ns-team-land 200ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delayMs}ms both`,
        sweep ? `ns-team-sweep 600ms ease-out ${delayMs + 200}ms both` : null,
      ]
        .filter(Boolean)
        .join(", ");
  return (
    <div className={className} style={{ ...style, animation }}>
      {children}
    </div>
  );
}

/* ── 骨架(§FB7) ── */
export function SkeletonBlock({ className, shimmer = true }: { className?: string; shimmer?: boolean }) {
  useTeamKeyframes();
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
              animation: "ns-team-shimmer 1.4s ease-in-out infinite",
            }
          : undefined
      }
    />
  );
}

/* ── 行内错误(§FB1) ── */
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

/* ── 首字母头像(零外链;size 走 Otto ladder 邻近值) ── */
export function InitialsAvatar({
  initials,
  size = 32,
  className,
}: {
  initials: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </span>
  );
}

/* ── 席位徽(CREATOR = 主动作档,soft ink;APPROVER = 审批档,outline) ── */
export function SeatBadge({ seatType }: { seatType: SeatType }) {
  return seatType === "CREATOR" ? (
    <Badge>Creator</Badge>
  ) : (
    <Badge variant="outline">Approver</Badge>
  );
}

/* ── DemoStates:三态切换器(非产品 UI) ── */
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
