"use client";

/**
 * 北极星原型 — Campaign 区共用小件
 *
 * design-rules v3 依据:
 * §8a coral sweep(≤600ms 一次性)/ §8b card landing(200ms spring,先留位再落)
 * §FB7 骨架 shimmer(1.4s 循环,reduced motion 冻结)/ §D4 行状态
 * PROGRAM.md §3.1:三态齐全可用页内切换器演示 → DemoStates(原型专用角标,非产品 UI)
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { NsCampaignEntry } from "../_mock";
import { FORMAT_META, PLATFORM_META, type CampaignStatus } from "./_data";

/* ── 注入一次的 keyframes(.gb reduced-motion clamp 会压平/冻结) ── */
const KEYFRAMES_ID = "ns-campaign-keyframes";
const KEYFRAMES = `
@keyframes ns-camp-land { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes ns-camp-sweep {
  from { box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
@keyframes ns-camp-gen { 0% { left: -40%; } 100% { left: 100%; } }
@keyframes ns-camp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

export function useCampaignKeyframes() {
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
  useCampaignKeyframes();
  const reduced = useReducedMotion();
  const animation = reduced
    ? undefined
    : [
        `ns-camp-land 200ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delayMs}ms both`,
        sweep ? `ns-camp-sweep 600ms ease-out ${delayMs + 200}ms both` : null,
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
  useCampaignKeyframes();
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
              animation: "ns-camp-shimmer 1.4s ease-in-out infinite",
            }
          : undefined
      }
    />
  );
}

/* ── 不定长 coral gen bar(§FB8:后台不定长工作属于 Otto) ── */
export function GenBar({ className }: { className?: string }) {
  useCampaignKeyframes();
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <span
      aria-hidden
      className={cn("relative block h-[5px] w-16 overflow-hidden rounded-full border border-border bg-background", className)}
    >
      <span
        className="absolute top-0 h-full w-[40%] rounded-full bg-brand"
        style={{ animation: "ns-camp-gen 1.3s ease-in-out infinite" }}
      />
    </span>
  );
}

/* ── 平台 / 形式 / 状态口径 ── */
export function PlatformPill({ platform, full = false }: { platform: NsCampaignEntry["platform"]; full?: boolean }) {
  const meta = PLATFORM_META[platform];
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-card px-1.5 font-mono text-[10px] leading-none font-medium tracking-[0.06em] text-muted-foreground uppercase">
      {full ? meta.label : meta.short}
    </span>
  );
}

export function FormatLabel({ format }: { format: NsCampaignEntry["format"] }) {
  return <span className="text-xs text-muted-foreground">{FORMAT_META[format].label}</span>;
}

export function EntryStatusBadge({ status }: { status: NsCampaignEntry["status"] }) {
  if (status === "approved") return <Badge variant="success">Approved</Badge>;
  if (status === "scheduled") return <Badge variant="info">Scheduled</Badge>;
  if (status === "published") return <Badge variant="outline">Published</Badge>;
  return <Badge>Proposed</Badge>;
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  if (status === "ACTIVE") return <Badge variant="info">Active</Badge>;
  if (status === "DONE") return <Badge variant="success">Done</Badge>;
  if (status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge>Draft</Badge>;
}

/* ── credits 文案(V5:spend 面只显示 credits) ── */
export function fmtCredits(n: number): string {
  return `${n.toLocaleString("en-MY")} credits`;
}

/* ── 日期短显示(确定性,不用 Date 本地化) ── */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/* ── DemoStates:原型三态切换器(PROGRAM §3.1;非产品 UI,与 MockNote 同级角标) ── */
export type DemoState = "default" | "loading" | "empty" | "error";

export function DemoStates({
  value,
  onChange,
  states = ["default", "loading", "empty", "error"],
  className,
}: {
  value: DemoState;
  onChange: (s: DemoState) => void;
  states?: DemoState[];
  className?: string;
}) {
  const labels: Record<DemoState, string> = {
    default: "正常",
    loading: "加载",
    empty: "空态",
    error: "错误",
  };
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

/* ── 行内错误态(§D4:面板 chrome 留着,13px error + ghost Retry) ── */
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
