"use client";

/**
 * 北极星原型 · 排期区共用件(仅 schedule 区页面使用)
 *
 * design-rules v3 依据:
 * §N4 segmented(Plan/Calendar/Queue 三视图切换 = 该节点名范例)
 * §D4 表行(hairline list rows,form A)· §FB7 骨架(shimmer 1.4s,≤3 块)
 * §8a coral sweep(一次性,≤600ms;reduced motion = 静态描边)
 * §V3/V4 错误与空态文案 · §V5 credits 文案
 *
 * 纯展示零后台;示例数据全部派生自 ../_mock(不发明内容)。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, CircleAlert, Megaphone, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInsideImmersive } from "../immersive/_context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  NS_CAMPAIGN,
  NS_CAMPAIGN_ENTRIES,
  NS_SCHEDULED_POSTS,
  nsPlaceholder,
} from "@/components/northstar/_mock";

/* ── 原型固定「今天」(与 _mock 锚点一致,保证确定性渲染) ──────────────── */
export const NS_TODAY = "2026-07-07";
export const NS_TIMEZONE = "Asia/Kuala_Lumpur · UTC+8";

/* ── 平台口径(brand 图标不入 Lucide,统一用 micro-mono 短码,零假图标) ── */
export type NsPlatform = "instagram" | "facebook" | "tiktok" | "x";

export const PLATFORMS: Record<NsPlatform, { short: string; label: string; handle: string }> = {
  instagram: { short: "IG", label: "Instagram", handle: "@rotibulan.bakery" },
  facebook: { short: "FB", label: "Facebook", handle: "Roti Bulan Bakery" },
  tiktok: { short: "TT", label: "TikTok", handle: "@rotibulan" },
  x: { short: "X", label: "X", handle: "@rotibulanKL" },
};

export function PlatformTag({ platform, className }: { platform: NsPlatform; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-7 shrink-0 items-center justify-center rounded-[8px] bg-secondary font-mono text-[10px] leading-none font-medium tracking-[0.06em] text-secondary-foreground",
        className,
      )}
    >
      {PLATFORMS[platform].short}
    </span>
  );
}

/* ── 帖子视图模型(派生自 _mock,零新内容) ────────────────────────────── */
export type SStatus = "draft" | "scheduled" | "published" | "failed" | "proposed";

export interface SAttempt {
  n: number;
  at: string;
  result: "delivered" | "failed";
}

export interface SPost {
  id: string;
  /** yyyy-mm-dd(Asia/Kuala_Lumpur) */
  date: string;
  /** HH:mm */
  time: string;
  platform: NsPlatform;
  caption: string;
  media: string;
  status: SStatus;
  campaignId?: string;
  campaignName?: string;
  firstComment?: string;
  estCredits?: number;
  attempts?: SAttempt[];
}

const ENTRY_TIME: Record<string, string> = { video: "19:00", image: "10:00", carousel: "12:00" };

/** 6 条排期帖(_mock NS_SCHEDULED_POSTS)→ 视图模型;published 带 PublishAttempt 记录 */
export function basePosts(): SPost[] {
  return NS_SCHEDULED_POSTS.map((p) => {
    const attempts: SAttempt[] | undefined =
      p.status === "published"
        ? p.id === "post-06"
          ? [
              { n: 1, at: "18:00:09", result: "failed" },
              { n: 2, at: "18:02:31", result: "delivered" },
            ]
          : [{ n: 1, at: "09:00:04", result: "delivered" }]
        : undefined;
    return {
      id: p.id,
      date: p.scheduledAt.slice(0, 10),
      time: p.scheduledAt.slice(11, 16),
      platform: p.platform,
      caption: p.caption,
      media: p.media,
      status: p.status,
      campaignId: p.campaignId,
      firstComment: p.firstComment,
      attempts,
    };
  });
}

/** Campaign 日历条目 → 帖子(approved = 已排期,proposed = 待审) */
export function campaignPosts(): { scheduled: SPost[]; proposed: SPost[] } {
  const all = NS_CAMPAIGN_ENTRIES.map((e): SPost => {
    const portrait = e.format === "video";
    return {
      id: e.id,
      date: e.date,
      time: ENTRY_TIME[e.format] ?? "10:00",
      platform: e.platform,
      caption: e.hook,
      media: nsPlaceholder(e.format, portrait ? 360 : 640, portrait ? 640 : 640, portrait ? "video" : "crust"),
      status: e.status === "proposed" ? "proposed" : "scheduled",
      campaignId: NS_CAMPAIGN.id,
      campaignName: NS_CAMPAIGN.name,
      estCredits: e.estCredits,
    };
  });
  return {
    scheduled: all.filter((p) => p.status !== "proposed"),
    proposed: all.filter((p) => p.status === "proposed"),
  };
}

/* ── 日期与时间(确定性手写格式化,不用 locale API) ──────────────────── */
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function dow(date: string): number {
  return utc(date).getUTCDay();
}

export function addDaysIso(date: string, n: number): string {
  return new Date(utc(date).getTime() + n * 86400000).toISOString().slice(0, 10);
}

/** "2026-07-08" → "Wed 8 Jul" */
export function fmtDate(date: string): string {
  const d = utc(date);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** "2026-07-08" → "Wednesday 8 July" */
export function fmtDateLong(date: string): string {
  const d = utc(date);
  return `${DAY_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]}`;
}

/** "09:00" → "9:00 am" */
export function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/* ── 状态徽章(colour = state,§2) ───────────────────────────────────── */
export function StatusBadge({ status }: { status: SStatus }) {
  switch (status) {
    case "draft":
      return <Badge variant="outline">Draft</Badge>;
    case "scheduled":
      return <Badge variant="info">Scheduled</Badge>;
    case "published":
      return <Badge variant="success">Published</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "proposed":
      return <Badge variant="warning">Needs approval</Badge>;
  }
}

/* ── 三视图切换(§N4 segmented;原型三页各占一路由,视觉保持 segmented) ── */
const VIEWS = [
  { href: "/northstar/schedule/plan", label: "Plan" },
  { href: "/northstar/schedule/calendar", label: "Calendar" },
  { href: "/northstar/schedule/queue", label: "Queue" },
];

export function ViewSwitch({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5", className)}>
      {VIEWS.map((v) => {
        const active = pathname === v.href;
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold",
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}

/* ── 原型三态演示开关(PROGRAM §3.1:空态/加载态/错误态齐全,页内切换) ── */
export type DemoState = "data" | "loading" | "empty" | "error";

export function DemoStateBar({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: { key: string; label: string }[];
  className?: string;
}) {
  // 沉浸式产品外壳内不出现原型三态演示 chrome。
  if (useInsideImmersive()) return null;
  const opts = options ?? [
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
            value === o.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── 骨架(§FB7:shimmer 1.4s,形状贴真内容,≤3 块 shimmer,其余静态) ── */
const KIT_KEYFRAMES_ID = "ns-schedule-keyframes";
const KIT_KEYFRAMES = `
@keyframes ns-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes ns-sweep {
  from {
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent);
    background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent);
  }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
`;

function useKitKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(KIT_KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = KIT_KEYFRAMES_ID;
    el.textContent = KIT_KEYFRAMES;
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
  useKitKeyframes();
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
              animation: reduced ? undefined : "ns-shimmer 1.4s ease-in-out infinite",
            }
          : undefined
      }
    />
  );
}

/** 帖子行骨架:留在最终高度(56px 缩略图行) */
export function PostRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
          <Skeleton className="h-4 w-14" shimmer={i === 0} />
          <Skeleton className="size-14 rounded-[10px]" shimmer={i === 1} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/5" shimmer={i === 2} />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ── 错误面板(§D4:行内 13px + ghost Retry,页头与骨架外壳不消失) ────── */
export function ErrorPanel({ text, onRetry, className }: { text: string; onRetry: () => void; className?: string }) {
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

/* ── coral sweep(§8a:一次性 ≤600ms;reduced motion = 静态描边 600ms) ── */
export function useSweep(): { style: React.CSSProperties | undefined; fire: () => void } {
  useKitKeyframes();
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState(false);

  const fire = React.useCallback(() => {
    setActive(true);
    window.setTimeout(() => setActive(false), 650);
  }, []);

  const style: React.CSSProperties | undefined = active
    ? reduced
      ? { boxShadow: "0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)" }
      : { animation: "ns-sweep 600ms ease-out 1" }
    : undefined;

  return { style, fire };
}

/* ── campaign 归组角标 ──────────────────────────────────────────────────── */
export function CampaignPill({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-0 items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] leading-none font-medium text-muted-foreground",
        className,
      )}
    >
      <Megaphone className="size-3 shrink-0" strokeWidth={2} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/* ── 帖子行(§D4 form A:hairline 行,56×56 缩略图,主格 14/600 truncate) ── */
export function PostRow({
  post,
  onApprove,
  showAttempts = false,
  landing = false,
}: {
  post: SPost;
  onApprove?: (post: SPost) => void;
  showAttempts?: boolean;
  landing?: boolean;
}) {
  const reduced = useReducedMotion();
  const meta = PLATFORMS[post.platform];
  return (
    <div
      className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
      style={landing && !reduced ? { animation: "fade-rise 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both" } : undefined}
    >
      <span className="w-14 shrink-0 font-mono text-xs leading-4 font-medium text-muted-foreground tabular-nums">
        {fmtTime(post.time)}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={post.media}
        alt=""
        className="size-14 shrink-0 rounded-[10px] border border-border object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{post.caption}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <PlatformTag platform={post.platform} />
          <span className="truncate text-xs text-muted-foreground">
            {meta.label} · {meta.handle}
          </span>
          {post.campaignName && <CampaignPill name={post.campaignName} />}
        </div>
        {showAttempts && post.attempts && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {post.attempts.map((a) => (
              <span
                key={a.n}
                className={cn(
                  "font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] tabular-nums",
                  a.result === "failed" ? "text-error-soft-foreground" : "text-muted-foreground",
                )}
              >
                attempt {a.n} · {a.at} · {a.result}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground">
              <ShieldCheck className="size-3" strokeWidth={2} />
              publish lock held · duplicate sends blocked
            </span>
          </div>
        )}
      </div>
      {typeof post.estCredits === "number" && (
        <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
          ~{post.estCredits} credits
        </span>
      )}
      <StatusBadge status={post.status} />
      {post.status === "draft" && onApprove && (
        <Button variant="secondary" size="sm" onClick={() => onApprove(post)}>
          <Check strokeWidth={2} />
          Approve
        </Button>
      )}
    </div>
  );
}

/* ── 审批确认(approveScheduledPost 的人工面;§FB5 dialog S) ───────────── */
export function ApproveDialog({
  post,
  onClose,
  onApproved,
}: {
  post: SPost | null;
  onClose: () => void;
  onApproved: (id: string) => void;
}) {
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!post) setPending(false);
  }, [post]);

  const confirm = () => {
    if (!post) return;
    setPending(true);
    window.setTimeout(() => {
      onApproved(post.id);
      onClose();
    }, 600);
  };

  return (
    <Dialog open={post !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve and schedule?</DialogTitle>
          <DialogDescription>
            {post && (
              <>
                {PLATFORMS[post.platform].label} · {fmtDateLong(post.date)} · {fmtTime(post.time)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {post && (
          <div className="flex items-center gap-3 rounded-[14px] bg-secondary/70 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.media} alt="" className="size-12 shrink-0 rounded-[10px] border border-border object-cover" />
            <p className="line-clamp-2 min-w-0 text-[13px] leading-[18px] text-foreground">{post.caption}</p>
          </div>
        )}
        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={pending} onClick={confirm}>
            {pending ? "Approving…" : "Approve post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
