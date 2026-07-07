"use client";

/**
 * 北极星原型 — 跨区共用原语(design-rules v3 §8 live reflection + §D3 + §N6 + §V4)
 *
 * OttoNarrationBar  §8c 叙述条:一屏一条,20px avatar + 一行现在进行时 + coral 进度
 * OttoDock          §8d/§O6 常驻 dock:48px 收起圆点 ⇄ 320px 展开面板(动作历史 deep-link)
 * PageHeader        §N6 页头解剖:一个 h1 + meta pills + 右侧动作
 * StatCard          §D3 数据卡:label 12/500 · value 26/700 tabular-nums · delta 语义色
 * EmptyState        §V4 空态:事实 + 指名下一步
 * MockNote          原型角标:把页面链回 PAGE-INVENTORY 板块行(总目录锚点)
 * NsStub            57 页占位:标题 + 施工中空态(zone builder 整页替换)
 *
 * 铁律:纯展示、零后台 import;coral 只属于 Otto;动效 gate 在 prefers-reduced-motion。
 */

import * as React from "react";
import Link from "next/link";
import { Construction, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { OttoAvatar, type OttoMood } from "@/components/otto/OttoAvatar";
import { nsPage, nsZone } from "./_registry";
import { NS_OTTO_ACTIONS, type NsOttoAction } from "./_mock";

/* ── shared keyframes(注入一次;.gb reduced-motion clamp 会冻结循环) ── */
const NS_KEYFRAMES_ID = "ns-shared-keyframes";
const NS_KEYFRAMES = `
@keyframes ns-gen-slide { 0% { left: -40%; } 100% { left: 100%; } }
@keyframes ns-badge-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--brand) 45%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in oklab, var(--brand) 0%, transparent); } }
`;

function useNsKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(NS_KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = NS_KEYFRAMES_ID;
    el.textContent = NS_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * OttoNarrationBar — §8c
 * steps 轮播(默认 1800ms/步),文本原地换行不堆叠;走完 → mood=success,
 * ≤400ms 后回调 onSettle。reduced motion:进度 bar 隐藏,文字固定 "Working…"。
 * ──────────────────────────────────────────────────────────────────────── */
export interface OttoNarrationBarProps {
  steps: readonly string[];
  /** 每步毫秒数 */
  stepMs?: number;
  /** 走完后是否从头循环(默认 false:停在 success) */
  loop?: boolean;
  /** 数步进度("2/5")代替不定长 bar */
  counter?: boolean;
  onSettle?: () => void;
  className?: string;
}

export function OttoNarrationBar({
  steps,
  stepMs = 1800,
  loop = false,
  counter = false,
  onSettle,
  className,
}: OttoNarrationBarProps) {
  useNsKeyframes();
  const reduced = useReducedMotion();
  const [i, setI] = React.useState(0);
  const [settled, setSettled] = React.useState(false);
  const iRef = React.useRef(0);
  const onSettleRef = React.useRef(onSettle);

  React.useEffect(() => {
    onSettleRef.current = onSettle;
  }, [onSettle]);

  // steps 变更 = 换 key 重挂载(约定);effect 内不做同步 setState。
  React.useEffect(() => {
    if (steps.length === 0 || settled) return;
    const timer = window.setInterval(() => {
      if (iRef.current + 1 < steps.length) {
        iRef.current += 1;
        setI(iRef.current);
      } else if (loop) {
        iRef.current = 0;
        setI(0);
      } else {
        window.clearInterval(timer);
        setSettled(true);
        window.setTimeout(() => onSettleRef.current?.(), 400);
      }
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [steps, stepMs, loop, settled]);

  const mood: OttoMood = settled ? "success" : "thinking";
  const idx = Math.min(i, Math.max(0, steps.length - 1));
  const text = settled ? "Done" : reduced ? "Working…" : steps[idx] ?? "Working…";

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <OttoAvatar size={20} mood={mood} />
      <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-muted-foreground">
        {text}
      </span>
      {!settled && counter && (
        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
          {idx + 1}/{steps.length}
        </span>
      )}
      {!settled && !counter && !reduced && (
        <span
          aria-hidden
          className="relative h-[5px] w-16 overflow-hidden rounded-full border border-border bg-background"
        >
          <span
            className="absolute top-0 h-full w-[40%] rounded-full bg-brand"
            style={{ animation: "ns-gen-slide 1.3s ease-in-out infinite" }}
          />
        </span>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * OttoDock — §8d / §O6(scaffold 版:布局与状态齐全,动作历史吃 mock)
 * ──────────────────────────────────────────────────────────────────────── */
export interface OttoDockProps {
  /** Otto 是否正在后台工作(coral 徽点脉冲 + narration 文案) */
  working?: boolean;
  narration?: string;
  actions?: NsOttoAction[];
  className?: string;
}

export function OttoDock({
  working = false,
  narration,
  actions = NS_OTTO_ACTIONS,
  className,
}: OttoDockProps) {
  useNsKeyframes();
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const mood: OttoMood = working ? "thinking" : "idle";
  const line = working ? narration ?? "Working…" : "Otto";
  const name = working ? `Otto — working: ${narration ?? "working"}` : "Otto — idle";

  return (
    <div ref={panelRef} className={cn("fixed right-4 bottom-4 z-[70]", className)}>
      {open && (
        <div
          role="dialog"
          aria-label="Otto activity"
          className="absolute right-0 bottom-14 flex max-h-[480px] w-80 origin-bottom-right flex-col overflow-hidden rounded-3xl border border-border bg-popover shadow-[var(--shadow-xl)]"
          style={reduced ? undefined : { animation: "none" }}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <OttoAvatar size={24} mood={mood} />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-foreground">
              {line}
            </span>
            {working && !reduced && (
              <span
                aria-hidden
                className="relative h-[5px] w-16 overflow-hidden rounded-full border border-border bg-background"
              >
                <span
                  className="absolute top-0 h-full w-[40%] rounded-full bg-brand"
                  style={{ animation: "ns-gen-slide 1.3s ease-in-out infinite" }}
                />
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {actions.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">All caught up.</p>
            ) : (
              actions.slice(0, 20).map((a) => (
                <Link
                  key={a.id}
                  href={a.href ?? "#"}
                  className="flex items-baseline gap-2 rounded-[10px] px-3 py-2.5 hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-foreground">
                    {a.text}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{a.at}</span>
                </Link>
              ))
            )}
          </div>
          <Link
            href="/northstar/global/otto-chat"
            className="flex h-11 shrink-0 items-center justify-center border-t border-border text-sm font-semibold text-foreground hover:bg-accent"
          >
            Open Otto
          </Link>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-label={name}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-12 items-center justify-center rounded-full border border-border bg-card shadow-[var(--shadow-md)] transition-colors duration-[120ms] hover:bg-accent active:scale-[0.96]"
      >
        <OttoAvatar size={26} mood={mood} />
        {working && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-2 ring-background"
            style={reduced ? undefined : { animation: "ns-badge-pulse 2s ease-in-out infinite" }}
          />
        )}
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * PageHeader — §N6
 * ──────────────────────────────────────────────────────────────────────── */
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  meta?: string[];
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {meta?.map((m) => (
        <span
          key={m}
          className="inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground"
        >
          {m}
        </span>
      ))}
      <div className="flex-1" />
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * StatCard — §D3
 * ──────────────────────────────────────────────────────────────────────── */
export interface StatCardProps {
  label: string;
  value: string;
  delta?: { dir: "up" | "down" | "flat"; text: string };
  className?: string;
}

export function StatCard({ label, value, delta, className }: StatCardProps) {
  return (
    <div className={cn("rounded-[14px] border border-border bg-card p-4", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1 text-xs font-semibold",
            delta.dir === "up" && "text-success-soft-foreground",
            delta.dir === "down" && "text-error-soft-foreground",
            delta.dir === "flat" && "text-muted-foreground",
          )}
        >
          {delta.text}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * EmptyState — §V4
 * ──────────────────────────────────────────────────────────────────────── */
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center", className)}>
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-[14px] bg-secondary">
          <Icon className="size-5 text-muted-foreground" strokeWidth={2} />
        </span>
      )}
      <p className="text-lg font-semibold text-foreground">{title}</p>
      {body && <p className="max-w-[420px] text-sm text-muted-foreground">{body}</p>}
      {action}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * MockNote — 原型角标:链回总目录该板块锚点(= PAGE-INVENTORY 行的活映射)
 * ──────────────────────────────────────────────────────────────────────── */
export function MockNote({ path, className }: { path: string; className?: string }) {
  const p = nsPage(path);
  const z = nsZone(p.zoneSlug);
  return (
    <Link
      href={`/northstar#zone-${z.slug}`}
      className={cn(
        "fixed bottom-4 left-4 z-[10] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground shadow-[var(--shadow-xs)] hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      北极星 · {z.ordinal} {z.name} · {p.page} · {p.priority} · {p.status}
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * NsStub — 57 页占位(zone builder 整页替换,并同步 @nsPage 注释 + registry)
 * ──────────────────────────────────────────────────────────────────────── */
export function NsStub({ path }: { path: string }) {
  const p = nsPage(path);
  const z = nsZone(p.zoneSlug);
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader title={p.title} subtitle={p.purpose} meta={[p.priority, p.current]} />
      <EmptyState
        icon={Construction}
        title="施工中"
        body={`此页尚未施工。按 PAGE-INVENTORY「${z.ordinal} ${z.name}」行与来源(${p.sources})施工后替换本 stub。`}
        className="mt-6"
      />
      <MockNote path={path} />
    </div>
  );
}
