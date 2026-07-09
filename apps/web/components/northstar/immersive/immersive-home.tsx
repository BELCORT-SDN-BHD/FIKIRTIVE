"use client";

/**
 * 北极星 · 沉浸式首页(the real front door)—— ENDGAME D1/D2 重排
 *
 * 进城第一屏,只围绕老板脑里的三样东西:「我在办的事」(Campaign)、「我随手做的东西」
 * (Studio)、「我的员工」(Otto)。composition(总令 Z1):
 *   招呼条(唯一 coral statement)→ KPI 三卡 → 「进行中的事」campaign 卡列(D1 唯一「事」容器)
 *   → Studio recents 真图网格(D1 自由创作台)→ Up next。
 * 每张卡都是通向真实流程的 `<Link>`,读面永不是死胡同;「问 Otto」把预填送进常驻 dock(不花钱)。
 * 一切状态经 _store / _mock,零本地副本。图片只从 NS_IMAGES(经 NS_ASSETS / NS_CAMPAIGNS.hero)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, PartyPopper, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  NS_ANALYTICS,
  NS_ASSETS,
  NS_BRAND,
  NS_CAMPAIGN,
  NS_CAMPAIGNS,
  type NsCampaignStatus,
  type NsCampaignSummary,
} from "@/components/northstar/_mock";
import { useImmersive } from "./_context";
import {
  balance,
  hasMilestone,
  markMilestone,
  pendingApprovals,
  recentEvents,
  upNext,
  useStore,
} from "./_store";

const BASE = "/northstar-immersive";

/** 从 ISO 排期时间取一个店主看得懂的短标签(确定性,不用 Date.now)。 */
function whenLabel(iso: string): string {
  const [date, time] = iso.split("T");
  const hhmm = time?.slice(0, 5) ?? "";
  return `${date.slice(5)} · ${hhmm}`;
}

/** campaign 状态 → badge(D1「事」容器三态,coral 严守只属 Otto,这里全走中性/语义色)。 */
const STATUS_BADGE: Record<NsCampaignStatus, { label: string; variant: "success" | "warning" | "outline" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  DRAFT: { label: "Draft", variant: "warning" },
  DONE: { label: "Done", variant: "outline" },
};

/** D1 排序:进行中的先看到 → 待起的 → 已完结的。 */
const STATUS_ORDER: Record<NsCampaignStatus, number> = { ACTIVE: 0, DRAFT: 1, DONE: 2 };

/** 「进行中的事」一张 campaign 卡:hero 真图 + 状态 + 目标进度;整卡 → Campaign 容器。 */
function CampaignCard({ c }: { c: NsCampaignSummary }) {
  const badge = STATUS_BADGE[c.status];
  const pct = Math.min(100, Math.round((c.goalProgress.current / c.goalProgress.target) * 100));
  return (
    <Link
      href={`${BASE}/campaign/detail?id=${c.id}`}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-border bg-card transition-colors duration-[120ms] hover:bg-accent"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img>(北极星约定) */}
        <img src={c.hero} alt={c.name} className="size-full object-cover" />
        <span className="absolute top-2 left-2">
          <Badge variant={badge.variant} className="bg-card/90 backdrop-blur">
            {badge.label}
          </Badge>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-sm font-semibold text-foreground">{c.name}</p>
        <p className="line-clamp-2 text-xs leading-[1.45] text-muted-foreground">{c.goal}</p>
        <div className="mt-auto pt-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-muted-foreground">{c.goalProgress.label}</span>
            <span className="font-mono text-[11px] text-foreground tabular-nums">
              {c.goalProgress.current}/{c.goalProgress.target}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${c.status === "DONE" ? "bg-success-soft-foreground/70" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ImmersiveHome() {
  const immersive = useImmersive();
  useStore(); // 订阅共享 store:排期 / 审批 / 事件变化即时反映到本屏

  // GM 里程碑(GM-05):店主本会话第一次批准 campaign 帖 → 一次性庆祝 toast(克制,跨页只放一次)。
  const campaignLaunched = recentEvents(50).some((e) => e.type === "campaign_entry_approved");
  React.useEffect(() => {
    if (campaignLaunched && !hasMilestone("first-campaign")) {
      markMilestone("first-campaign");
      toast("Your first campaign is live", {
        icon: <PartyPopper className="size-4 text-brand" strokeWidth={2} />,
        description: "Otto will keep the posts moving. You can watch it in the campaign calendar.",
      });
    }
  }, [campaignLaunched]);

  // 「进行中的事」= D1 唯一「事」容器,三状态,进行中优先。
  const campaigns = React.useMemo(
    () => [...NS_CAMPAIGNS].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [],
  );
  const activeCount = campaigns.filter((c) => c.status !== "DONE").length;

  // Studio recents(D1 自由创作台):不挂 campaign 的随手创作,最新在前,真图网格。
  const studioRecents = React.useMemo(
    () =>
      NS_ASSETS.filter((a) => a.status === "ready" && !a.campaignId)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8),
    [],
  );

  // Up next 读 store 的排期(scheduled + draft),不再直接读 _mock 静态数组。
  const queued = upNext();
  const nextPosts = queued.slice(0, 4);
  const approvals = pendingApprovals();
  // Reach 卡与分析区同源(NS_ANALYTICS.kpis[0]),避免同屏「招呼条 18% vs 卡片 9%」一店两数。
  const reachKpi = NS_ANALYTICS.kpis[0];

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pt-6 pb-24">
      <PageHeader
        title={`Morning, ${NS_BRAND.owner.split(" ")[0]}`}
        subtitle={`${NS_BRAND.name} · ${NS_BRAND.city}`}
        actions={
          <Button asChild size="sm">
            <Link href={`${BASE}/create/canvas`}>
              Create
              <ArrowRight />
            </Link>
          </Button>
        }
      />

      {/* Otto 招呼条:本屏唯一 coral statement;按钮把预填送进 dock */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-brand-soft bg-brand-soft/50 px-4 py-3.5">
        <OttoAvatar size={32} mood="helpful" />
        <span className="min-w-0 flex-1 basis-64 text-sm leading-[1.45] text-brand-soft-foreground">
          {NS_ANALYTICS.insight} Want me to turn that into this week&apos;s posts?
        </span>
        <Button
          variant="brand"
          size="sm"
          onClick={() => immersive?.openOtto("Turn last week's best post into this week's plan")}
        >
          <Sparkles />
          Ask Otto
        </Button>
      </div>

      {/* KPI 三卡 → 分析 / 排期 / 额度 */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href={`${BASE}/analytics/overview`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="Reach · 28 days" value={reachKpi.value} delta={reachKpi.delta} />
        </Link>
        <Link href={`${BASE}/schedule/plan`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="Scheduled posts" value={String(queued.length)} delta={{ dir: "flat", text: "Next up in 2h" }} />
        </Link>
        <Link href={`${BASE}/account/credits`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="Credit balance" value={balance().toLocaleString("en-MY")} delta={{ dir: "flat", text: "MYR wallet" }} />
        </Link>
      </div>

      {/* ── 进行中的事(D1:Campaign = 唯一「事」容器;为它发生的一切自动长在它身上) ── */}
      <div className="mt-8 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">In progress</h2>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {activeCount} running
        </span>
        <Link href={`${BASE}/campaign/list`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          All campaigns
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((c) => (
          <CampaignCard key={c.id} c={c} />
        ))}
      </div>

      {/* ── Studio recents(D1:自由创作台;随手做的东西,零整理压力) ── */}
      <div className="mt-8 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">Studio recents</h2>
        <Link href={`${BASE}/create/canvas`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          Open studio
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {studioRecents.map((a) => (
          <Link
            key={a.id}
            href={`${BASE}/create/asset-viewer?asset=${a.id}`}
            className="group overflow-hidden rounded-[14px] border border-border bg-card transition-colors duration-[120ms] hover:bg-accent"
          >
            <div className="relative aspect-square w-full overflow-hidden bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img>(北极星约定) */}
              <img src={a.thumb} alt={a.title} className="size-full object-cover" />
              {a.kind === "video" && (
                <span className="absolute right-1.5 bottom-1.5 flex size-5 items-center justify-center rounded-full bg-card/85">
                  <Play className="size-3 text-foreground" strokeWidth={2} fill="currentColor" />
                </span>
              )}
              {a.byOtto && (
                <span className="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-card/90">
                  <OttoAvatar size={14} mood="idle" />
                </span>
              )}
            </div>
            <div className="p-2.5">
              <p className="truncate text-xs font-medium text-foreground">{a.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground capitalize">{a.kind}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Up next(排期即将发出的;每行 → composer 深链) ── */}
      <div className="mt-8 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">Up next</h2>
        {approvals.length > 0 ? (
          <Badge variant="warning">{approvals.length} awaiting approval</Badge>
        ) : (
          <Badge variant="success">{NS_CAMPAIGN.name} · all approved</Badge>
        )}
        <Link href={`${BASE}/schedule/queue`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          Open queue
        </Link>
      </div>
      <div className="mt-3 overflow-hidden rounded-[14px] border border-border bg-card">
        {nextPosts.length === 0 ? (
          <Link
            href={`${BASE}/schedule/composer`}
            className="flex items-center gap-3 px-4 py-4 text-[13px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent"
          >
            Nothing queued yet — schedule your first post
            <ArrowRight className="ml-auto size-4 shrink-0" strokeWidth={2} />
          </Link>
        ) : (
          nextPosts.map((p, i) => (
            <Link
              key={p.id}
              href={`${BASE}/schedule/composer?post=${p.id}`}
              className={`flex items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-accent ${i > 0 ? "border-t border-border" : ""}`}
            >
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{whenLabel(p.scheduledAt)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{p.caption}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground capitalize">{p.platform}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
