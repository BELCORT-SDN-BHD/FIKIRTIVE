"use client";

/**
 * 北极星原型 · 全局横切区 — dock 陈列件(§8d / §O6 buildable spec 的展示版)
 *
 * 与 _shared.OttoDock(全城真 dock,fixed 定位)不同,这组件把 dock 画进
 * 展示框(absolute 定位),专供「Otto dock 全态」页逐态陈列 + 演练场用。
 * 规格照抄 §O6:收起 48 圆点(--card + 1px border + shadow-md,26px avatar,
 * 8px coral 徽点)/ 展开 320×≤480(radius 24,--popover + shadow-xl,
 * header 56 = narration 解剖,行中性零 coral,footer 44 Open Otto)。
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { OttoAvatar, type OttoMood } from "@/components/otto/OttoAvatar";
import { DockBadge, GenBar, useLanding, useReducedMotion } from "./_fx";
import { type NsOttoAction } from "./_data";

export type DockBadgeState = "none" | "pulse" | "steady";

/* ── 收起圆点 ─────────────────────────────────────────────────────────── */
export function DockButton({
  mood,
  badge,
  narration,
  expanded,
  onClick,
  className,
}: {
  mood: OttoMood;
  badge: DockBadgeState;
  narration?: string;
  expanded?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const name = narration ? `Otto — working: ${narration}` : "Otto — idle";
  return (
    <button
      type="button"
      aria-expanded={expanded ?? false}
      aria-label={name}
      onClick={onClick}
      className={cn(
        "relative flex size-12 items-center justify-center rounded-full border border-border bg-card shadow-[var(--shadow-md)] transition-colors duration-[120ms] hover:bg-accent active:scale-[0.96]",
        className,
      )}
    >
      <OttoAvatar size={26} mood={mood} />
      {badge !== "none" && <DockBadge pulsing={badge === "pulse"} />}
    </button>
  );
}

/* ── 展开面板(展示框内 absolute) ────────────────────────────────────── */
export function DockPanel({
  working,
  narration,
  counter,
  actions,
  landNewest,
  className,
}: {
  working?: boolean;
  narration?: string;
  counter?: string;
  actions: NsOttoAction[];
  /** 最新一行带 §8b 落地动画(演练场:动作刚完成) */
  landNewest?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const landing = useLanding();
  const mood: OttoMood = working ? "thinking" : "idle";
  return (
    <div
      role="dialog"
      aria-label="Otto activity"
      className={cn(
        "flex max-h-[480px] w-80 origin-bottom-right flex-col overflow-hidden rounded-3xl border border-border bg-popover shadow-[var(--shadow-xl)]",
        className,
      )}
      style={reduced ? undefined : landing}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4" role="status">
        <OttoAvatar size={24} mood={mood} />
        <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-foreground">
          {working ? narration ?? "Working…" : "Otto"}
        </span>
        {working && (counter ? (
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
            {counter}
          </span>
        ) : (
          <GenBar />
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {actions.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">All caught up.</p>
        ) : (
          actions.slice(0, 20).map((a, i) => (
            <button
              key={a.id}
              type="button"
              style={i === 0 && landNewest ? landing : undefined}
              className="flex w-full items-baseline gap-2 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-[120ms] hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-foreground">{a.text}</span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">{a.at}</span>
            </button>
          ))
        )}
      </div>
      <div className="flex h-11 shrink-0 items-center justify-center border-t border-border">
        <span className="text-sm font-semibold text-foreground">Open Otto</span>
      </div>
    </div>
  );
}

/* ── 演练场用:框内可互动 dock(收起 ⇄ 展开) ───────────────────────── */
export function DemoDock({
  working,
  narration,
  counter,
  actions,
  unseen,
  onSeen,
  liftForCta,
  landNewest,
}: {
  working: boolean;
  narration?: string;
  counter?: string;
  actions: NsOttoAction[];
  /** 有完成未看的工作(徽点静止亮) */
  unseen?: boolean;
  onSeen?: () => void;
  /** 页面右下有主 CTA:dock 让位上移(§8d 永不盖主 CTA) */
  liftForCta?: boolean;
  landNewest?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const areaRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const badge: DockBadgeState = working ? "pulse" : unseen ? "steady" : "none";
  const mood: OttoMood = working ? "thinking" : "idle";

  return (
    <div
      ref={areaRef}
      className={cn(
        "absolute right-4 flex flex-col items-end gap-2 transition-[bottom] duration-200",
        liftForCta ? "bottom-[72px]" : "bottom-4",
      )}
    >
      {open && (
        <DockPanel working={working} narration={narration} counter={counter} actions={actions} landNewest={landNewest} />
      )}
      <DockButton
        mood={mood}
        badge={open ? (working ? "pulse" : "none") : badge}
        narration={working ? narration : undefined}
        expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) onSeen?.();
        }}
      />
    </div>
  );
}

/* ── 移动端:收起在底栏上方(12px inset),展开 = 全宽 bottom sheet ────── */
export function MobileDockDemo({ actions }: { actions: NsOttoAction[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative mx-auto h-[560px] w-full max-w-[320px] overflow-hidden bg-background">
      {/* 52px topbar */}
      <div className="flex h-[52px] items-center gap-3 border-b border-border bg-card px-4">
        <div aria-hidden className="size-4 rounded bg-muted" />
        <span className="text-sm font-semibold text-foreground">Schedule</span>
      </div>
      {/* 版面示意 */}
      <div aria-hidden className="space-y-3 p-4">
        <div className="h-20 rounded-[14px] border border-border bg-card" />
        <div className="h-20 rounded-[14px] border border-border bg-card" />
        <div className="h-20 rounded-[14px] border border-border bg-card" />
        <div className="h-20 rounded-[14px] border border-border bg-card" />
      </div>
      {/* 底栏 */}
      <div className="absolute inset-x-0 bottom-0 flex h-14 items-center justify-around border-t border-border bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} aria-hidden className="size-5 rounded bg-muted" />
        ))}
      </div>
      {/* 收起圆点:底栏上方 12px inset */}
      {!open && (
        <DockButton mood="idle" badge="none" onClick={() => setOpen(true)} className="absolute right-3 bottom-[68px]" />
      )}
      {/* bottom sheet */}
      {open && (
        <>
          <button
            type="button"
            aria-label="Close Otto activity"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(0,0,0,0.35)]"
          />
          <div
            role="dialog"
            aria-label="Otto activity"
            className="absolute inset-x-0 bottom-0 flex max-h-[60%] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-popover shadow-[var(--shadow-xl)]"
          >
            <div className="flex justify-center pt-2 pb-1">
              <span aria-hidden className="h-1 w-9 rounded-full bg-border" />
            </div>
            <div className="flex h-12 shrink-0 items-center gap-2 px-4">
              <OttoAvatar size={24} mood="idle" />
              <span className="text-[13px] leading-[18px] font-medium text-foreground">Otto</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-2">
              {actions.slice(0, 4).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="flex w-full items-baseline gap-2 rounded-[10px] px-3 py-3 text-left hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-foreground">{a.text}</span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{a.at}</span>
                </button>
              ))}
            </div>
            <div className="flex h-11 shrink-0 items-center justify-center border-t border-border">
              <span className="text-sm font-semibold text-foreground">Open Otto</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
