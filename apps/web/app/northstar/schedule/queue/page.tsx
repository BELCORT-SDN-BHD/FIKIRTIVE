/* @nsPage district="排期区" page="queue" status="draft"
   sources="区划图·排期区" approvedAt="" pr="" */
"use client";

/**
 * 队列视图 — 按时间顺序的发布队列。
 * 清单元素:队列列表(按日分组,时间升序)· 时区显示 · 防双发状态(PublishAttempt:
 * published 行展示 attempt 流水 + publish lock;失败首发 + 重试成功的样例 = post-06)。
 * 状态三态齐全(§D4 per-table states);草稿行可就地审批(与 Plan 同一动作)。
 */

import * as React from "react";
import Link from "next/link";
import { Globe, ListOrdered, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import {
  ApproveDialog,
  DemoStateBar,
  ErrorPanel,
  NS_TIMEZONE,
  PostRow,
  PostRowsSkeleton,
  Skeleton,
  ViewSwitch,
  basePosts,
  campaignPosts,
  fmtDateLong,
  type DemoState,
  type SPost,
} from "@/components/northstar/schedule/kit";

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

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("data");
  const [posts, setPosts] = React.useState<SPost[]>(() => [...basePosts(), ...campaignPosts().scheduled]);
  const [approving, setApproving] = React.useState<SPost | null>(null);

  const approve = (id: string) =>
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, status: "scheduled" } : p)));

  const upcoming = groupByDate(posts.filter((p) => p.status === "scheduled" || p.status === "draft"));
  const published = groupByDate(posts.filter((p) => p.status === "published" || p.status === "failed")).reverse();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Queue"
        subtitle="Everything waiting to publish, in the order it goes out."
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

      {/* 时区行:队列的每个时间都按此时区(清单「时区显示」) */}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Globe className="size-3.5" strokeWidth={2} />
        All times shown in Asia/Kuala_Lumpur (UTC+8). Each post publishes once, held by a publish lock.
      </div>

      {demo === "loading" && (
        <div className="mt-6 flex flex-col gap-8">
          <section>
            <Skeleton className="mb-3 h-4 w-32" />
            <PostRowsSkeleton rows={3} />
          </section>
          <section>
            <Skeleton className="mb-3 h-4 w-24" />
            <PostRowsSkeleton rows={2} />
          </section>
        </div>
      )}

      {demo === "empty" && (
        <EmptyState
          icon={ListOrdered}
          title="Queue is empty"
          body="Schedule a post from the composer and it will line up here."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/northstar/schedule/composer">New post</Link>
            </Button>
          }
          className="mt-6"
        />
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load your queue." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "data" && (
        <div className="mt-6 flex flex-col gap-8">
          <section>
            <h2 className="text-sm font-semibold text-foreground">Upcoming</h2>
            <div className="mt-3 flex flex-col gap-4">
              {upcoming.map((g) => (
                <div key={g.date} className="rounded-[18px] border border-border bg-card px-4 pb-1">
                  <div className="flex items-center gap-2 border-b border-border py-2.5">
                    <span className="text-[13px] font-semibold text-foreground">{fmtDateLong(g.date)}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {g.posts.length} {g.posts.length === 1 ? "post" : "posts"}
                    </span>
                  </div>
                  {g.posts.map((p) => (
                    <PostRow key={p.id} post={p} onApprove={setApproving} />
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-foreground">Published</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Attempt history per post. A held publish lock means a retry can never double-send.
            </p>
            <div className="mt-3 flex flex-col gap-4">
              {published.map((g) => (
                <div key={g.date} className="rounded-[18px] border border-border bg-card px-4 pb-1">
                  <div className="flex items-center gap-2 border-b border-border py-2.5">
                    <span className="text-[13px] font-semibold text-foreground">{fmtDateLong(g.date)}</span>
                  </div>
                  {g.posts.map((p) => (
                    <PostRow key={p.id} post={p} showAttempts />
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <ApproveDialog post={approving} onClose={() => setApproving(null)} onApproved={approve} />
      <DemoStateBar value={demo} onChange={(v) => setDemo(v as DemoState)} />
      <MockNote path="/northstar/schedule/queue" />
    </div>
  );
}
