"use client";

/**
 * 排期区 · Queue（§L2 List 880）— 原生重建。
 * 按时间顺序的发布队列;防双发可见（PublishAttempt + publish lock,首发失败重试成功样例
 * post-06)· 失败帖自愈(reconnect)· 草稿就地审批。
 * Wave B:队列槽位配置(#1)· All-channels 总览 + 频道过滤 + move up/down 重排(#2)·
 * 提醒式发布(#5)· 逐帖轻量表现小结(#14)。
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Bell, Globe, ListOrdered, Plus, RotateCw, Settings2, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/northstar/_shared";
import {
  recentEvents,
  schedulePost,
  setPostTime,
  markRemindered,
  postingSlots,
  addPostingSlot,
  removePostingSlot,
  postMetaFor,
  useStore,
} from "../_store";
import {
  ApproveDialog,
  BASE,
  DOW_MON,
  NS_TIMEZONE,
  PLATFORMS,
  PostRow,
  PlatformTag,
  ViewSwitch,
  fmtDateLong,
  fmtTime,
  livePosts,
  campaignPosts,
  toScheduled,
  type NsPlatform,
  type SPost,
} from "./kit";
import type { SPlatform } from "./data";

const ALL: NsPlatform[] = ["instagram", "facebook", "tiktok", "x"];
const SLOT_TIMES = ["07:00", "08:00", "09:00", "10:00", "12:30", "17:00", "18:00", "19:00", "21:00"];

function groupByDate(posts: SPost[]): { date: string; posts: SPost[] }[] {
  const map = new Map<string, SPost[]>();
  for (const p of posts) {
    const list = map.get(p.date) ?? [];
    list.push(p);
    map.set(p.date, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, posts: list.sort((a, b) => a.time.localeCompare(b.time)) }));
}

export function ScheduleQueue() {
  useStore();
  const all = [...livePosts(), ...campaignPosts().scheduled];
  const [approving, setApproving] = React.useState<SPost | null>(null);
  const [slotsOpen, setSlotsOpen] = React.useState(false);
  // [wave-b] All-channels 总览 + 多选频道过滤
  const [channels, setChannels] = React.useState<Set<NsPlatform>>(new Set(ALL));
  const posts = all.filter((p) => channels.has(p.platform));

  const landingId = React.useMemo(
    () => recentEvents(20).find((e) => e.type === "post_scheduled")?.payload.id as string | undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all.length],
  );

  const approve = (id: string) => {
    const post = all.find((p) => p.id === id);
    if (post) schedulePost(toScheduled(post));
  };

  const toggleChannel = (p: NsPlatform) =>
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next.size === 0 ? new Set(ALL) : next;
    });

  const drafts = groupByDate(posts.filter((p) => p.status === "draft"));
  const upcoming = groupByDate(posts.filter((p) => p.status === "scheduled"));
  const published = groupByDate(posts.filter((p) => p.status === "published" || p.status === "failed")).reverse();
  const shareHref = (id: string) => `${BASE}/schedule/share-preview?post=${id}`;

  // move up/down:与同一天相邻帖交换时间(真 setPostTime,双写 store)
  const reorder = (dayPosts: SPost[], idx: number, dir: -1 | 1) => {
    const other = idx + dir;
    if (other < 0 || other >= dayPosts.length) return;
    const a = dayPosts[idx];
    const b = dayPosts[other];
    setPostTime(a.id, b.time);
    setPostTime(b.id, a.time);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Queue"
        subtitle="Everything waiting to publish, in the order it goes out."
        meta={[NS_TIMEZONE]}
        actions={
          <>
            <ViewSwitch />
            <Button variant="secondary" size="sm" onClick={() => setSlotsOpen(true)}>
              <Settings2 strokeWidth={2} />
              <span className="hidden sm:inline">Slots</span>
            </Button>
            <Button size="sm" asChild>
              <Link href={`${BASE}/schedule/composer`}>
                <Plus strokeWidth={2} />
                New post
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Globe className="size-3.5" strokeWidth={2} />
        All times in Asia/Kuala_Lumpur (UTC+8). Each post publishes once, held by a publish lock.
      </div>

      {/* [wave-b] All-channels 总览 + 频道过滤 chips */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Channels</span>
        {ALL.map((p) => {
          const on = channels.has(p);
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => toggleChannel(p)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                on ? "border-foreground bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              <PlatformTag platform={p} className="h-4 w-6 text-[9px]" />
              {PLATFORMS[p].label}
            </button>
          );
        })}
      </div>

      {posts.length === 0 && (
        <EmptyState
          icon={ListOrdered}
          title="Queue is empty"
          body="Schedule a post from the composer and it will line up here."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={`${BASE}/schedule/composer`}>New post</Link>
            </Button>
          }
          className="mt-6"
        />
      )}

      <div className="mt-6 flex flex-col gap-8">
        {drafts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground">Drafts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Saved but not scheduled yet. Approve to line one up, or share it for a quick review first.
            </p>
            <div className="mt-3 flex flex-col gap-4">
              {drafts.map((g) => (
                <DayCard key={g.date} date={g.date} label={`${g.posts.length} ${g.posts.length === 1 ? "draft" : "drafts"}`} dashed>
                  {g.posts.map((p) => {
                    const reminder = postMetaFor(p.id).reminder;
                    return (
                      <PostRow
                        key={p.id}
                        post={p}
                        onApprove={reminder ? undefined : setApproving}
                        onReminder={reminder ? (rp) => { markRemindered(rp.id); toast("Marked as posted"); } : undefined}
                        landing={p.id === landingId}
                        shareHref={shareHref(p.id)}
                        trailing={reminder ? <ReminderTag /> : undefined}
                      />
                    );
                  })}
                </DayCard>
              ))}
            </div>
          </section>
        )}

        {upcoming.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground">Upcoming</h2>
            <div className="mt-3 flex flex-col gap-4">
              {upcoming.map((g) => (
                <DayCard key={g.date} date={g.date} label={`${g.posts.length} ${g.posts.length === 1 ? "post" : "posts"}`}>
                  {g.posts.map((p, i) => {
                    const reminder = postMetaFor(p.id).reminder;
                    return (
                      <PostRow
                        key={p.id}
                        post={p}
                        landing={p.id === landingId}
                        shareHref={shareHref(p.id)}
                        onReminder={reminder ? (rp) => { markRemindered(rp.id); toast("Marked as posted"); } : undefined}
                        trailing={
                          <span className="flex items-center">
                            {reminder && <ReminderTag />}
                            <Button variant="ghost" size="sm" className="size-8 px-0" aria-label="Move earlier" disabled={i === 0} onClick={() => reorder(g.posts, i, -1)}>
                              <ArrowUp strokeWidth={2} />
                            </Button>
                            <Button variant="ghost" size="sm" className="size-8 px-0" aria-label="Move later" disabled={i === g.posts.length - 1} onClick={() => reorder(g.posts, i, 1)}>
                              <ArrowDown strokeWidth={2} />
                            </Button>
                          </span>
                        }
                      />
                    );
                  })}
                </DayCard>
              ))}
            </div>
          </section>
        )}

        {published.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground">Published</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Attempt history per post. A held publish lock means a retry can never double-send.
            </p>
            <div className="mt-3 flex flex-col gap-4">
              {published.map((g) => (
                <DayCard key={g.date} date={g.date}>
                  {g.posts.map((p) =>
                    p.status === "failed" ? (
                      <PostRow
                        key={p.id}
                        post={p}
                        showPerf={false}
                        trailing={
                          <Button variant="secondary" size="sm" asChild>
                            <Link href={`${BASE}/account/connections`}>
                              <RotateCw strokeWidth={2} />
                              Reconnect &amp; retry
                            </Link>
                          </Button>
                        }
                      />
                    ) : (
                      <PostRow key={p.id} post={p} showAttempts showPerf />
                    ),
                  )}
                </DayCard>
              ))}
            </div>
          </section>
        )}
      </div>

      <ApproveDialog post={approving} onClose={() => setApproving(null)} onApproved={approve} />
      <SlotsDialog open={slotsOpen} onClose={() => setSlotsOpen(false)} />
    </div>
  );
}

function DayCard({
  date,
  label,
  dashed,
  children,
}: {
  date: string;
  label?: string;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-[18px] border bg-card px-4 pb-1", dashed ? "border-dashed border-border" : "border-border")}>
      <div className="flex items-center gap-2 border-b border-border py-2.5">
        <span className="text-[13px] font-semibold text-foreground">{fmtDateLong(date)}</span>
        {label && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{label}</span>}
      </div>
      {children}
    </div>
  );
}

function ReminderTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Bell className="size-3" strokeWidth={2} />
      Reminder
    </span>
  );
}

/* ── [wave-b] 队列槽位配置:每渠道每周固定发帖时段 ─────────────────────────── */
function SlotsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useStore();
  const slots = postingSlots();
  const [day, setDay] = React.useState("0");
  const [time, setTime] = React.useState("09:00");
  const [channel, setChannel] = React.useState<SPlatform>("instagram");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Posting slots</DialogTitle>
          <DialogDescription>
            Set your weekly rhythm once. New posts drop into the next open slot — no picking a time every time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 rounded-[14px] border border-border">
          {slots.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No slots yet. Add your first below.</p>
          ) : (
            slots.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border-t border-border px-3 py-2 text-[13px] first:border-t-0">
                <PlatformTag platform={s.channel} className="h-4 w-6 text-[9px]" />
                <span className="font-medium text-foreground">{DOW_MON[s.day]}</span>
                <span className="tabular-nums text-muted-foreground">{fmtTime(s.time)}</span>
                <Button variant="ghost" size="sm" className="ml-auto size-8 px-0" aria-label="Remove slot" onClick={() => removePostingSlot(s.id)}>
                  <Trash2 strokeWidth={2} />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={day} onValueChange={setDay}>
            <SelectTrigger className="h-10 w-28 rounded-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOW_MON.map((d, i) => (
                <SelectItem key={d} value={String(i)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={time} onValueChange={setTime}>
            <SelectTrigger className="h-10 w-28 rounded-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SLOT_TIMES.map((t) => (
                <SelectItem key={t} value={t}>{fmtTime(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={(v) => setChannel(v as SPlatform)}>
            <SelectTrigger className="h-10 w-32 rounded-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALL.map((p) => (
                <SelectItem key={p} value={p}>{PLATFORMS[p].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => addPostingSlot(Number(day), time, channel)}>
            <Plus strokeWidth={2} />
            Add slot
          </Button>
        </div>
        <DialogFooter className="flex-row justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
