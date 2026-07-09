"use client";

/**
 * 排期区(Z5)· 沉浸式原生共享件（GalleryFrame 套壳的原生重建）。
 *
 * design-rules v3:§N4 segmented（Plan/Calendar/Queue 三视图）· §D4 hairline 行 ·
 * §FB7 骨架 · §8a coral sweep · §2 colour=state · §V5 credits 文案。
 * 图片纪律:媒体只从 NS_IMAGES 取（帖子 media 已是真图;campaign 条目补 nsImage）。
 * 跨区链接一律走沉浸式路由（IMMERSIVE_BASE），永不跳出外壳。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Check,
  CircleAlert,
  Megaphone,
  Share2,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  NS_CAMPAIGN_ENTRIES,
  nsImage,
  type NsScheduledPost,
  type NsCampaignEntry,
} from "@/components/northstar/_mock";
import { IMMERSIVE_BASE, useReducedMotion } from "../_kit";
import { campaignEntries, scheduledPosts, postMetaFor, isRemindered, seedScheduleExtras } from "../_store";
import { campaignName, campaignHref, postMetrics, fmtReach, scheduleExtrasSeed, type SPlatform } from "./data";

// Wave B 原型对象惰性 seed(幂等;首次 client 端导入排期区任意页时注入,brand 事实留 data.ts）。
seedScheduleExtras(scheduleExtrasSeed);

export const BASE = IMMERSIVE_BASE;
export const NS_TODAY = "2026-07-07";
export const NS_TIMEZONE = "Asia/Kuala_Lumpur · UTC+8";

/* ── 平台口径（brand 图标不入 Lucide,统一 micro-mono 短码） ─────────────────── */
export type NsPlatform = SPlatform;
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

/* ── 帖子视图模型（派生自 store,零新内容） ─────────────────────────────────── */
export type SStatus = "draft" | "scheduled" | "published" | "failed" | "proposed";
export interface SAttempt {
  n: number;
  at: string;
  result: "delivered" | "failed";
}
export interface SPost {
  id: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:mm
  platform: NsPlatform;
  caption: string;
  media: string;
  status: SStatus;
  campaignId?: string;
  campaignName?: string;
  firstComment?: string;
  altText?: string;
  failReason?: string;
  estCredits?: number;
  attempts?: SAttempt[];
}

export function toSPost(p: NsScheduledPost): SPost {
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
    campaignName: campaignName(p.campaignId),
    firstComment: p.firstComment,
    altText: p.altText,
    failReason: p.failReason,
    attempts,
  };
}

/** 全部排期帖（共享 store → 视图模型）。组件须先 useStore() 才随排期变化重渲染。 */
export function livePosts(): SPost[] {
  return scheduledPosts().map(toSPost);
}

export function toScheduled(p: SPost): NsScheduledPost {
  return {
    id: p.id,
    scheduledAt: `${p.date}T${p.time}:00+08:00`,
    platform: p.platform,
    caption: p.caption,
    media: p.media,
    status: "scheduled",
    campaignId: p.campaignId,
    firstComment: p.firstComment,
    altText: p.altText,
  };
}

const ENTRY_TIME: Record<NsCampaignEntry["format"], string> = { video: "19:00", image: "10:00", carousel: "12:00" };
const ENTRY_IMG: Record<NsCampaignEntry["format"], number> = { video: 2, image: 0, carousel: 1 };

/** Campaign 日历条目（共享 store）→ 帖子（媒体取 NS_IMAGES.campaign 真图,非 placeholder）。 */
export function campaignPosts(): { scheduled: SPost[]; proposed: SPost[] } {
  const all = campaignEntries().map((e): SPost => ({
    id: e.id,
    date: e.date,
    time: ENTRY_TIME[e.format] ?? "10:00",
    platform: e.platform,
    caption: e.hook,
    media: nsImage("campaign", ENTRY_IMG[e.format] ?? 0),
    status: e.status === "proposed" ? "proposed" : "scheduled",
    campaignId: "camp-merdeka-01",
    campaignName: campaignName("camp-merdeka-01"),
    estCredits: e.estCredits,
  }));
  return {
    scheduled: all.filter((p) => p.status !== "proposed"),
    proposed: all.filter((p) => p.status === "proposed"),
  };
}
export { NS_CAMPAIGN_ENTRIES };

/* ── 日期与时间（确定性手写,不用 locale API） ───────────────────────────────── */
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const DOW_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
export function dow(date: string): number {
  return utc(date).getUTCDay();
}
/** 周一起算 0..6 */
export function dowMon(date: string): number {
  return (utc(date).getUTCDay() + 6) % 7;
}
export function addDaysIso(date: string, n: number): string {
  return new Date(utc(date).getTime() + n * 86400000).toISOString().slice(0, 10);
}
export function fmtDate(date: string): string {
  const d = utc(date);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}
export function fmtDateLong(date: string): string {
  const d = utc(date);
  return `${DAY_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]}`;
}
export function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/* ── 状态徽章（colour = state,§2） ─────────────────────────────────────────── */
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

/* ── 三视图切换（§N4 segmented;沉浸式路由） ────────────────────────────────── */
const VIEWS = [
  { href: `${BASE}/schedule/plan`, label: "Plan" },
  { href: `${BASE}/schedule/calendar`, label: "Calendar" },
  { href: `${BASE}/schedule/queue`, label: "Queue" },
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
              "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold transition-colors duration-[120ms]",
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

/* ── 骨架 / 错误面板（§FB7 / §D4） ─────────────────────────────────────────── */
const SHIMMER_KF_ID = "ns-immersive-shimmer";
const SHIMMER_KF = `@keyframes ns-immersive-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`;
function useShimmerKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(SHIMMER_KF_ID)) return;
    const el = document.createElement("style");
    el.id = SHIMMER_KF_ID;
    el.textContent = SHIMMER_KF;
    document.head.appendChild(el);
  }, []);
}
export function Skeleton({ shimmer = false, className }: { shimmer?: boolean; className?: string }) {
  useShimmerKeyframes();
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn("rounded-[10px] bg-muted", className)}
      style={
        shimmer
          ? {
              backgroundImage: "linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%)",
              backgroundSize: "200% 100%",
              animation: reduced ? undefined : "ns-immersive-shimmer 1.4s ease-in-out infinite",
            }
          : undefined
      }
    />
  );
}
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

/* ── campaign 归组角标（点进 campaign 容器,D1 深链回容器） ─────────────────── */
export function CampaignPill({
  id,
  name,
  className,
  asLink = true,
}: {
  id?: string;
  name: string;
  className?: string;
  asLink?: boolean;
}) {
  const cls = cn(
    "inline-flex h-5 min-w-0 items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] leading-none font-medium text-muted-foreground",
    asLink && id && "transition-colors hover:bg-accent hover:text-foreground",
    className,
  );
  const body = (
    <>
      <Megaphone className="size-3 shrink-0" strokeWidth={2} />
      <span className="truncate">{name}</span>
    </>
  );
  if (asLink && id) {
    return (
      <Link href={campaignHref(id, BASE)} className={cls} title={`Open ${name} campaign`} onClick={(e) => e.stopPropagation()}>
        {body}
      </Link>
    );
  }
  return <span className={cls}>{body}</span>;
}

/* ── 逐帖轻量表现小结（[wave-b] published 卡叠加 reach/互动小字） ─────────────── */
export function PostPerf({ id }: { id: string }) {
  const m = postMetrics(id);
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
      <BarChart3 className="size-3" strokeWidth={2} />
      {fmtReach(m.reach)} reach · {m.engagementPct}% eng
    </span>
  );
}

/* ── 帖子行（§D4 form A） ──────────────────────────────────────────────────── */
export function PostRow({
  post,
  onApprove,
  showAttempts = false,
  showPerf = false,
  landing = false,
  shareHref,
  onReminder,
  trailing,
}: {
  post: SPost;
  onApprove?: (post: SPost) => void;
  showAttempts?: boolean;
  showPerf?: boolean;
  landing?: boolean;
  shareHref?: string;
  /** reminder 发布模式:到点提示 + 「标记已手动发布」 */
  onReminder?: (post: SPost) => void;
  trailing?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const meta = PLATFORMS[post.platform];
  const remindered = isRemindered(post.id);
  return (
    <div
      className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
      style={landing && !reduced ? { animation: "fade-rise 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both" } : undefined}
    >
      <span className="w-14 shrink-0 font-mono text-xs leading-4 font-medium text-muted-foreground tabular-nums">
        {fmtTime(post.time)}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={post.media} alt={post.altText ?? ""} className="size-14 shrink-0 rounded-[10px] border border-border object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{post.caption}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <PlatformTag platform={post.platform} />
          <span className="truncate text-xs text-muted-foreground">
            {meta.label} · {meta.handle}
          </span>
          {post.campaignName && <CampaignPill id={post.campaignId} name={post.campaignName} />}
          {showPerf && post.status === "published" && <PostPerf id={post.id} />}
        </div>
        {post.status === "failed" && post.failReason && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] leading-[14px] font-medium text-error-soft-foreground">
            <CircleAlert className="size-3 shrink-0" strokeWidth={2} />
            {post.failReason}
          </div>
        )}
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
      {trailing}
      {shareHref && (
        <Button variant="ghost" size="sm" asChild aria-label="Share preview">
          <Link href={shareHref} title="Share a read-only preview for outside review">
            <Share2 strokeWidth={2} />
            <span className="hidden sm:inline">Share preview</span>
          </Link>
        </Button>
      )}
      {onReminder && !remindered && (
        <Button variant="secondary" size="sm" onClick={() => onReminder(post)}>
          Mark as posted
        </Button>
      )}
      {onReminder && remindered && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success-soft-foreground">
          <Check className="size-3.5" strokeWidth={2} />
          Posted
        </span>
      )}
      {post.status === "draft" && onApprove && (
        <Button variant="secondary" size="sm" onClick={() => onApprove(post)}>
          <Check strokeWidth={2} />
          Approve
        </Button>
      )}
    </div>
  );
}

/* ── 审批确认（approve draft → scheduled） ─────────────────────────────────── */
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
            <img src={post.media} alt={post.altText ?? ""} className="size-12 shrink-0 rounded-[10px] border border-border object-cover" />
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

/** post meta（tags/utm/alt/reminder）读取 helper（组件用） */
export { postMetaFor };
