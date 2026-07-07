"use client";

/**
 * 北极星原型 · CRM 区共用件(仅 CRM 四页使用)
 *
 * design-rules v3 依据:
 * §D4 表行(hairline list rows,form A)· §D2 数字格式 · §FB7 骨架(shimmer 1.4s,≤3 块)
 * §V4 空态两型 · §FB1 打断阶梯 · §O3/§O4 CRM 区默认 dock-only,coral 只在 Otto 落新联系人时
 * §7 勿扰(判决 7-9)硬约束展示 · §V5 credits 不出现(CRM 不是花钱面,金额是订单值)
 *
 * 纯展示零后台;示例数据全部来自 ./mock-crm(不发明清单外内容)。
 */

import * as React from "react";
import { BellOff, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CRM_CHANNELS,
  type ConsentState,
  type CrmChannel,
} from "@/components/northstar/crm/mock-crm";

/* ── 原型固定「今天」(与 _mock 锚点一致,确定性渲染) ─────────────────── */
export const CRM_TODAY = "2026-07-07";

/* ── 名字首字母头像(brand 图片不入原型,统一确定性 initials) ───────────── */
export function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function ContactAvatar({
  name,
  size = 40,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {contactInitials(name)}
    </span>
  );
}

/* ── 渠道徽标(§D4 max one soft pill per row;WA/IG/FB micro-mono 短码) ──── */
export function ChannelTag({
  channel,
  className,
}: {
  channel: CrmChannel | "email";
  className?: string;
}) {
  const short = channel === "email" ? "@" : CRM_CHANNELS[channel].short;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-7 items-center justify-center rounded-[8px] bg-secondary px-1 font-mono text-[10px] leading-none font-medium tracking-[0.06em] text-secondary-foreground",
        className,
      )}
    >
      {short}
    </span>
  );
}

export function ChannelRow({
  channels,
  className,
}: {
  channels: CrmChannel[];
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {channels.map((c) => (
        <ChannelTag key={c} channel={c} />
      ))}
    </span>
  );
}

/* ── consent 徽章(colour = state,§2;granted/pending/declined) ─────────── */
export function ConsentBadge({ state }: { state: ConsentState }) {
  switch (state) {
    case "granted":
      return <Badge variant="success">Opted in</Badge>;
    case "pending":
      return <Badge variant="warning">Awaiting opt-in</Badge>;
    case "declined":
      return <Badge variant="destructive">Opted out</Badge>;
  }
}

/* ── 勿扰标记(判决 7-9:硬约束,自动化 / broadcast 跳过) ───────────────── */
export function DndTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full bg-error-soft px-2 text-[11px] leading-none font-medium text-error-soft-foreground",
        className,
      )}
    >
      <BellOff className="size-3" strokeWidth={2} />
      Do not disturb
    </span>
  );
}

/* ── 金额(订单值,RM 前缀是 mock 场景币种;§D2 千分位) ────────────────── */
export function fmtMyr(n: number): string {
  return `RM ${n.toLocaleString("en-MY")}`;
}

/* ── 日期(确定性手写,不用 locale API;"2026-07-06" → "6 Jul") ────────── */
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function fmtDate(date: string): string {
  const d = utc(date);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 相对天数,只给列表 last seen 用:"today" / "2 days ago" / 长于 30 天回落到日期 */
export function relDays(date: string): string {
  const diff = Math.round((utc(CRM_TODAY).getTime() - utc(date).getTime()) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff <= 30) return `${diff} days ago`;
  return fmtDate(date);
}

/* ── 原型三态开关(PROGRAM §3.1;页内切换,与排期区口径一致) ──────────── */
export type CrmDemoState = "data" | "loading" | "empty" | "error";

export function DemoStateBar({
  value,
  onChange,
  className,
}: {
  value: CrmDemoState;
  onChange: (v: CrmDemoState) => void;
  className?: string;
}) {
  const opts: { key: CrmDemoState; label: string }[] = [
    { key: "data", label: "Data" },
    { key: "loading", label: "Loading" },
    { key: "empty", label: "Empty" },
    { key: "error", label: "Error" },
  ];
  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[10] flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <span className="font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase">
        原型三态
      </span>
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "h-6 rounded-full px-2.5 text-[11px] font-semibold",
            value === o.key
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── 骨架(§FB7:shimmer 1.4s,形状贴真内容,≤3 块 shimmer) ────────────── */
const CRM_KEYFRAMES_ID = "ns-crm-keyframes";
const CRM_KEYFRAMES = `
@keyframes ns-crm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes ns-crm-sweep {
  from {
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent);
    background-color: color-mix(in oklab, var(--brand-soft) 55%, transparent);
  }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
`;

function useCrmKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(CRM_KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = CRM_KEYFRAMES_ID;
    el.textContent = CRM_KEYFRAMES;
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

export function Skeleton({ shimmer = false, className }: { shimmer?: boolean; className?: string }) {
  useCrmKeyframes();
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn("rounded-[10px] bg-muted", className)}
      style={
        shimmer
          ? {
              backgroundImage:
                "linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%)",
              backgroundSize: "200% 100%",
              animation: reduced ? undefined : "ns-crm-shimmer 1.4s ease-in-out infinite",
            }
          : undefined
      }
    />
  );
}

/** 联系人行骨架:留在最终高度(头像 + 两行 + 右侧金额) */
export function ContactRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
          <Skeleton className="size-10 rounded-full" shimmer={i === 0} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" shimmer={i === 1} />
            <Skeleton className="h-3 w-1/4" shimmer={i === 2} />
          </div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ── 错误面板(§D4:行内 13px + ghost Retry,页头与外壳不消失) ─────────── */
export function ErrorPanel({
  text,
  onRetry,
  className,
}: {
  text: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16 text-center", className)}>
      <CircleAlert className="size-5 text-error-soft-foreground" strokeWidth={2} />
      <p className="text-[13px] leading-[18px] font-medium text-error-soft-foreground" role="alert">
        {text}
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/* ── coral sweep(§8a / §O4 live-activity:一次性 ≤600ms;Otto 落新联系人 / 编译成群时) ── */
export function useSweep(): { style: React.CSSProperties | undefined; fire: () => void } {
  useCrmKeyframes();
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState(false);

  const fire = React.useCallback(() => {
    setActive(true);
    window.setTimeout(() => setActive(false), 650);
  }, []);

  const style: React.CSSProperties | undefined = active
    ? reduced
      ? { boxShadow: "0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)" }
      : { animation: "ns-crm-sweep 600ms ease-out 1" }
    : undefined;

  return { style, fire };
}
