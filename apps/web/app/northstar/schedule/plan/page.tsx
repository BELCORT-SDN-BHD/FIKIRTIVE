/* @nsPage district="排期区" page="plan" status="draft"
   sources="区划图·排期区(#123);对标地图(Buffer 3 视图范本)" approvedAt="" pr="" */
"use client";

/**
 * Plan 视图 — 排期主视图(Plan + 队列混合)。
 * 清单元素:周区块 · DRAFT/SCHEDULED 状态 · 审批确认动作(approveScheduledPost)
 * · campaign 归组角标。Otto 在场:§O3 schedule = proposal/notice 卡 22-26px;
 * live reflection = 叙述条(§8c)+ 卡片着陆(§8b)+ 容器 sweep(§8a,>3 条扫容器一次)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import {
  EmptyState,
  MockNote,
  OttoNarrationBar,
  PageHeader,
} from "@/components/northstar/_shared";
import { NS_CAMPAIGN, NS_NARRATION_STEPS } from "@/components/northstar/_mock";
import {
  ApproveDialog,
  DemoStateBar,
  ErrorPanel,
  NS_TIMEZONE,
  NS_TODAY,
  PostRow,
  PostRowsSkeleton,
  Skeleton,
  ViewSwitch,
  addDaysIso,
  campaignPosts,
  fmtDate,
  fmtDateLong,
  livePosts,
  toScheduled,
  useSweep,
  type DemoState,
  type SPost,
} from "@/components/northstar/schedule/kit";
import { recentEvents, schedulePost, useStore } from "@/components/northstar/immersive/_store";

/** 本周从周一起算:2026-07-07(二)所在周 = 7-06 至 7-12 */
const WEEK_START = "2026-07-06";

function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

export default function Page() {
  useStore();
  const [demo, setDemo] = React.useState<DemoState>("data");
  const posts = livePosts();
  const campaign = campaignPosts();
  // composer 刚排的新帖 → 高亮 landing(读最近一条 post_scheduled 事件的帖子 id)
  const landingId = React.useMemo(
    () => recentEvents(20).find((e) => e.type === "post_scheduled")?.payload.id as string | undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posts.length],
  );

  // Otto 模拟:进页 1.4s 后开始草拟 campaign 帖(叙述条),走完后 5 张提案卡着陆
  const [ottoPhase, setOttoPhase] = React.useState<"idle" | "working" | "done">("idle");
  const [landedCount, setLandedCount] = React.useState(0);
  const startedRef = React.useRef(false);
  const groupSweep = useSweep();

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const t = window.setTimeout(() => setOttoPhase("working"), 1400);
    return () => window.clearTimeout(t);
  }, []);

  const onNarrationSettle = React.useCallback(() => {
    setOttoPhase("done");
    // 着陆 5 张提案卡:>3 条 → 逐张 120ms 错峰着陆,容器只 sweep 一次(§8a)
    campaign.proposed.forEach((_, i) => {
      window.setTimeout(() => setLandedCount(i + 1), i * 120);
    });
    window.setTimeout(() => groupSweep.fire(), campaign.proposed.length * 120);
  }, [campaign.proposed, groupSweep]);

  const [approving, setApproving] = React.useState<SPost | null>(null);
  // 审批 = 入库(draft → scheduled)经共享 store,queue/calendar/home 同步反映
  const approve = (id: string) => {
    const post = posts.find((p) => p.id === id);
    if (post) schedulePost(toScheduled(post));
  };

  const thisWeek = weekDays(WEEK_START);
  const nextWeek = weekDays(addDaysIso(WEEK_START, 7));
  const landedProposed = campaign.proposed.slice(0, landedCount);
  const groupRows = [...campaign.scheduled, ...landedProposed];
  const proposedTotal = campaign.proposed.reduce((sum, p) => sum + (p.estCredits ?? 0), 0);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Schedule"
        subtitle="Plan the week, approve drafts, keep every channel fed."
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

      {/* 叙述条槽位:固定高度先占位,出现不推挤正文(§8b) */}
      <div className="mt-4 flex h-10 items-center justify-center">
        {demo === "data" && ottoPhase === "working" && (
          <OttoNarrationBar
            steps={NS_NARRATION_STEPS}
            stepMs={1300}
            onSettle={onNarrationSettle}
            className="w-full max-w-[420px]"
          />
        )}
      </div>

      {demo === "loading" && (
        <div className="mt-2 flex flex-col gap-8">
          <section>
            <Skeleton className="mb-3 h-4 w-40" />
            <PostRowsSkeleton rows={3} />
          </section>
          <section>
            <Skeleton className="mb-3 h-4 w-32" />
            <PostRowsSkeleton rows={2} />
          </section>
        </div>
      )}

      {demo === "empty" && (
        <EmptyState
          icon={CalendarPlus}
          title="No posts yet"
          body="Add one or ask Otto to plan your week."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/northstar/schedule/composer">New post</Link>
            </Button>
          }
          className="mt-6"
        />
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load your schedule." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "data" && (
        <div className="mt-2 flex flex-col gap-8">
          {/* Otto 提案通知卡(statement,一屏最多 1 个;§O4) */}
          {ottoPhase === "done" && (
            <div className="flex items-center gap-3 rounded-[18px] border border-border bg-brand-soft/60 p-4">
              <OttoAvatar size={26} mood="waiting" />
              <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
                I drafted {campaign.proposed.length} posts for {NS_CAMPAIGN.name}. Generating them will
                use about {proposedTotal} credits. Review them below or in the campaign calendar.
              </p>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/northstar/campaign/calendar">
                  Review
                  <ArrowRight strokeWidth={2} />
                </Link>
              </Button>
            </div>
          )}

          {/* 周区块:本周 */}
          <WeekBlock
            label={`This week · ${fmtDate(thisWeek[0])} to ${fmtDate(thisWeek[6])}`}
            days={thisWeek}
            posts={posts}
            onApprove={setApproving}
            landingId={landingId}
          />

          {/* 周区块:下周(真空态,§V4) */}
          <WeekBlock
            label={`Next week · ${fmtDate(nextWeek[0])} to ${fmtDate(nextWeek[6])}`}
            days={nextWeek}
            posts={posts}
            onApprove={setApproving}
            emptyText="Nothing scheduled next week. Add a post or ask Otto to plan it."
            landingId={landingId}
          />

          {/* campaign 归组区块 */}
          <section id="campaign-group">
            <h2 className="text-sm font-semibold text-foreground">Campaigns</h2>
            <div className="mt-3 rounded-[18px] border border-border bg-card" style={groupSweep.style}>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <span className="text-sm font-semibold text-foreground">{NS_CAMPAIGN.name}</span>
                <span className="text-xs text-muted-foreground">
                  24 to 31 Aug · {groupRows.length} posts · budget {NS_CAMPAIGN.budgetCredits} credits
                </span>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/northstar/campaign/calendar">Open campaign calendar</Link>
                </Button>
              </div>
              <div className="px-4 pb-1">
                {groupRows.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    No campaign posts yet.
                  </p>
                ) : (
                  groupRows.map((p, i) => (
                    <PostRow
                      key={p.id}
                      post={p}
                      landing={i >= campaign.scheduled.length}
                      shareHref={`/northstar/schedule/share-preview?post=${p.id}`}
                    />
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      <ApproveDialog post={approving} onClose={() => setApproving(null)} onApproved={approve} />
      <DemoStateBar value={demo} onChange={(v) => setDemo(v as DemoState)} />
      <MockNote path="/northstar/schedule/plan" />
    </div>
  );
}

function WeekBlock({
  label,
  days,
  posts,
  onApprove,
  emptyText,
  landingId,
}: {
  label: string;
  days: string[];
  posts: SPost[];
  onApprove: (post: SPost) => void;
  emptyText?: string;
  landingId?: string;
}) {
  const byDay = days
    .map((d) => ({
      date: d,
      posts: posts.filter((p) => p.date === d).sort((a, b) => a.time.localeCompare(b.time)),
    }))
    .filter((g) => g.posts.length > 0);

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      {byDay.length === 0 ? (
        <p className="mt-3 rounded-[14px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          {emptyText ?? "Nothing scheduled."}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {byDay.map((g) => (
            <div key={g.date} className="rounded-[18px] border border-border bg-card px-4 pb-1">
              <div className="flex items-center gap-2 border-b border-border py-2.5">
                <span className="text-[13px] font-semibold text-foreground">{fmtDateLong(g.date)}</span>
                {g.date === NS_TODAY && (
                  <span className="font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase">
                    today
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {g.posts.length} {g.posts.length === 1 ? "post" : "posts"}
                </span>
              </div>
              {g.posts.map((p) => (
                <PostRow
                  key={p.id}
                  post={p}
                  onApprove={onApprove}
                  landing={p.id === landingId}
                  shareHref={`/northstar/schedule/share-preview?post=${p.id}`}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
