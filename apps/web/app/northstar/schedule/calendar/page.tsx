/* @nsPage district="排期区" page="calendar" status="draft"
   sources="区划图·排期区;Buffer 范本" approvedAt="" pr="" */
"use client";

/**
 * 日历视图 — 按月 / 周看全部排期。
 * 清单元素:日历网格 · 拖动改期(HTML5 drag & drop,本地状态)· 状态色(soft 语义对,
 * colour = state,§2)。月 ⇄ 周 = segmented(同一内容换看法,§N4);月导航 Jul ⇄ Aug 2026。
 * 点开任一条 = 只读详情 dialog(§FB5 S 号)。
 */

import * as React from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import {
  CampaignPill,
  DemoStateBar,
  ErrorPanel,
  MONTH_LONG,
  NS_TIMEZONE,
  NS_TODAY,
  PLATFORMS,
  PlatformTag,
  Skeleton,
  StatusBadge,
  ViewSwitch,
  addDaysIso,
  campaignPosts,
  dow,
  fmtDateLong,
  fmtTime,
  livePosts,
  type DemoState,
  type SPost,
  type SStatus,
} from "@/components/northstar/schedule/kit";
import { movePostDate, recentEvents, useStore } from "@/components/northstar/immersive/_store";

/** 原型只开放 2026 年 7-8 月(mock 数据所在区间) */
const MONTHS: { year: number; month: number }[] = [
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
];

const STATUS_CHIP: Record<SStatus, string> = {
  draft: "bg-secondary text-secondary-foreground",
  scheduled: "bg-info-soft text-info-soft-foreground",
  published: "bg-success-soft text-success-soft-foreground",
  failed: "bg-error-soft text-error-soft-foreground",
  proposed: "bg-warning-soft text-warning-soft-foreground",
};

function monthCells(year: number, month: number): { date: string; inMonth: boolean }[] {
  const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  // 周一开头
  const lead = (dow(first) + 6) % 7;
  const start = addDaysIso(first, -lead);
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDaysIso(start, i);
    cells.push({ date, inMonth: date.slice(5, 7) === String(month + 1).padStart(2, "0") });
  }
  // 末行整行都不在本月时裁掉
  return cells.slice(35).some((c) => c.inMonth) ? cells : cells.slice(0, 35);
}

export default function Page() {
  useStore();
  const [demo, setDemo] = React.useState<DemoState>("data");
  const [mode, setMode] = React.useState<"month" | "week">("month");
  const [monthIdx, setMonthIdx] = React.useState(0);
  const [detail, setDetail] = React.useState<SPost | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);

  const camp = campaignPosts();
  // 拖动改期直接写回共享 store(movePostDate),故日期永远从 store 派生 —— 跨页/换视图持久。
  const posts = [...livePosts(), ...camp.scheduled, ...camp.proposed];
  const landingId = recentEvents(20).find((e) => e.type === "post_scheduled")?.payload.id as string | undefined;

  const { year, month } = MONTHS[monthIdx];
  const cells = React.useMemo(() => monthCells(year, month), [year, month]);
  const weekStart = "2026-07-06";
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));

  const byDate = React.useMemo(() => {
    const map = new Map<string, SPost[]>();
    for (const p of posts) {
      const list = map.get(p.date) ?? [];
      list.push(p);
      map.set(p.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.map((p) => `${p.id}@${p.date}`).join(",")]);

  const movePost = (id: string, date: string) => {
    movePostDate(id, date);
  };

  const dropHandlers = (date: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(date);
    },
    onDragLeave: () => setDropTarget((cur) => (cur === date ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const id = e.dataTransfer.getData("text/plain");
      if (id) movePost(id, date);
    },
  });

  const chip = (p: SPost) => (
    <button
      key={p.id}
      type="button"
      draggable={p.status !== "published"}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
      onClick={() => setDetail(p)}
      title={`${PLATFORMS[p.platform].label} · ${fmtTime(p.time)} · ${p.caption}`}
      style={
        p.id === landingId
          ? { animation: "fade-rise 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both" }
          : undefined
      }
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-[8px] px-1.5 py-0.5 text-left text-[11px] leading-4 font-medium",
        STATUS_CHIP[p.status],
        p.status !== "published" && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="shrink-0 font-mono text-[10px] tracking-[0.04em] uppercase">
        {PLATFORMS[p.platform].short}
      </span>
      <span className="shrink-0 tabular-nums">{p.time}</span>
      <span className="truncate">{p.caption}</span>
    </button>
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Calendar"
        subtitle="Every scheduled post by month or week. Drag a post to move it."
        meta={[NS_TIMEZONE]}
        actions={
          <>
            <ViewSwitch />
            <Button size="sm" asChild>
              <Link href="/northstar/schedule/composer">
                <Plus strokeWidth={2} />
                New post
              </Link>
            </Button>
          </>
        }
      />

      {/* 工具行:月导航 + 月/周 segmented */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {mode === "month" ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous month"
              disabled={monthIdx === 0}
              onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft strokeWidth={2} />
            </Button>
            <span className="w-36 text-center text-sm font-semibold text-foreground">
              {MONTH_LONG[month]} {year}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next month"
              disabled={monthIdx === MONTHS.length - 1}
              onClick={() => setMonthIdx((i) => Math.min(MONTHS.length - 1, i + 1))}
            >
              <ChevronRight strokeWidth={2} />
            </Button>
          </div>
        ) : (
          <span className="px-2 text-sm font-semibold text-foreground">
            Week of 6 to 12 July 2026
          </span>
        )}
        <div className="flex-1" />
        <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "h-[30px] rounded-[8px] px-3 text-xs font-semibold",
                mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {m === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>
      </div>

      {demo === "loading" && (
        <div className="mt-4 overflow-hidden rounded-[18px] border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-card">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="px-2 py-2 text-center font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "min-h-24 border-t border-r border-border p-1.5",
                  i < 7 && "border-t-0",
                  (i + 1) % 7 === 0 && "border-r-0",
                )}
              >
                {i === 9 || i === 16 || i === 23 ? <Skeleton className="h-5 w-full" shimmer={i === 9} /> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {demo === "empty" && (
        <EmptyState
          icon={CalendarDays}
          title="Nothing scheduled this month"
          body="Add a post or ask Otto to plan your week."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/northstar/schedule/composer">New post</Link>
            </Button>
          }
          className="mt-6"
        />
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load your calendar." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "data" && mode === "month" && (
        <div className="mt-4 overflow-hidden rounded-[18px] border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-card">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="px-2 py-2 text-center font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const dayPosts = byDate.get(cell.date) ?? [];
              const dayNum = Number(cell.date.slice(8, 10));
              return (
                <div
                  key={cell.date}
                  {...dropHandlers(cell.date)}
                  className={cn(
                    "flex min-h-24 flex-col gap-1 border-t border-r border-border p-1.5",
                    i < 7 && "border-t-0",
                    (i + 1) % 7 === 0 && "border-r-0",
                    !cell.inMonth && "bg-muted/40",
                    dropTarget === cell.date && "bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                      cell.date === NS_TODAY
                        ? "bg-primary font-semibold text-primary-foreground"
                        : cell.inMonth
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50",
                    )}
                  >
                    {dayNum}
                  </span>
                  {dayPosts.slice(0, 3).map(chip)}
                  {dayPosts.length > 3 && (
                    <span className="px-1.5 text-[11px] leading-4 text-muted-foreground">
                      +{dayPosts.length - 3} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {demo === "data" && mode === "week" && (
        <div className="mt-4 overflow-x-auto">
          <div className="grid min-w-[840px] grid-cols-7 overflow-hidden rounded-[18px] border border-border">
            {weekDates.map((date, i) => {
              const dayPosts = byDate.get(date) ?? [];
              return (
                <div
                  key={date}
                  {...dropHandlers(date)}
                  className={cn(
                    "flex min-h-80 flex-col gap-1.5 border-r border-border p-2 last:border-r-0",
                    dropTarget === date && "bg-accent",
                  )}
                >
                  <div className="flex items-center gap-1.5 pb-1">
                    <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}
                    </span>
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                        date === NS_TODAY ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </span>
                  </div>
                  {dayPosts.length === 0 ? (
                    <p className="pt-6 text-center text-[11px] leading-4 text-muted-foreground/70">No posts</p>
                  ) : (
                    dayPosts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        draggable={p.status !== "published"}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                        onClick={() => setDetail(p)}
                        className={cn(
                          "flex w-full flex-col gap-1.5 rounded-[10px] border border-border bg-card p-2 text-left hover:bg-accent",
                          p.status !== "published" && "cursor-grab active:cursor-grabbing",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.media} alt="" className="h-16 w-full rounded-[8px] border border-border object-cover" />
                        <span className="line-clamp-2 text-[11px] leading-4 font-medium text-foreground">{p.caption}</span>
                        <span className="flex items-center gap-1">
                          <PlatformTag platform={p.platform} className="h-4 w-6 text-[9px]" />
                          <span className="text-[11px] leading-4 text-muted-foreground tabular-nums">{fmtTime(p.time)}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 只读详情(§FB5 S 号;点开任一条) */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl leading-[26px] font-semibold tracking-[-0.017em]">
                  {PLATFORMS[detail.platform].label} post
                </DialogTitle>
                <DialogDescription>
                  {fmtDateLong(detail.date)} · {fmtTime(detail.time)} · {PLATFORMS[detail.platform].handle}
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.media} alt="" className="max-h-56 w-full rounded-[14px] border border-border object-cover" />
              <p className="text-[15px] leading-[22px] text-foreground">{detail.caption}</p>
              <div className="flex items-center gap-2">
                <StatusBadge status={detail.status} />
                {detail.campaignName && <CampaignPill name={detail.campaignName} />}
              </div>
              <DialogFooter className="flex-row justify-end gap-3">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/northstar/schedule/composer">Open in composer</Link>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DemoStateBar value={demo} onChange={(v) => setDemo(v as DemoState)} />
      <MockNote path="/northstar/schedule/calendar" />
    </div>
  );
}
