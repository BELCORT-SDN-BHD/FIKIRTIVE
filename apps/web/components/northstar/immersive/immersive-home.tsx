"use client";

/**
 * 北极星 · 沉浸式首页(the real front door)
 *
 * 进城第一屏:招呼店主 → 一眼看到今天该做什么 → 每张卡都通向一个真实流程。
 * 「问 Otto」把预填 prompt 送进常驻 dock(openOtto),不自动花钱。
 * 复用:PageHeader/StatCard(_shared)、OttoAvatar、mock 数据;全部真 <Link> 交叉跳转。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Compass, Frame, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  NS_ANALYTICS,
  NS_ASSETS,
  NS_BRAND,
  NS_CAMPAIGN,
  NS_SCHEDULED_POSTS,
} from "@/components/northstar/_mock";
import { useImmersive } from "./_context";

const BASE = "/northstar-immersive";

/** 从 ISO 排期时间取一个店主看得懂的短标签(确定性,不用 Date.now)。 */
function whenLabel(iso: string): string {
  const [date, time] = iso.split("T");
  const hhmm = time?.slice(0, 5) ?? "";
  return `${date.slice(5)} · ${hhmm}`;
}

const QUICK_STARTS = [
  { label: "Open canvas", desc: "Make a post from scratch", icon: Frame, href: `${BASE}/create/canvas` },
  { label: "Storyboard a reel", desc: "Four steps, one paid render", icon: Sparkles, href: `${BASE}/create/storyboard` },
  { label: "Plan a campaign", desc: "Otto drafts the whole calendar", icon: CalendarDays, href: `${BASE}/campaign/proposal-card` },
  { label: "Find inspiration", desc: "Templates and trending ideas", icon: Compass, href: `${BASE}/assets/discover` },
] as const;

export function ImmersiveHome() {
  const immersive = useImmersive();
  const recent = NS_ASSETS.filter((a) => a.status === "ready").slice(0, 4);
  const nextPosts = NS_SCHEDULED_POSTS.slice(0, 3);
  const reach28 = NS_ANALYTICS.reach.reduce((s, p) => s + p.value, 0);

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pt-6 pb-24">
      <PageHeader
        title={`Morning, ${NS_BRAND.owner.split(" ")[0]}`}
        subtitle={`${NS_BRAND.name} · ${NS_BRAND.city}`}
        actions={
          <Button asChild size="sm">
            <Link href={`${BASE}/create/home`}>
              New
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

      {/* KPI 三卡 → 分析区 */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href={`${BASE}/analytics/overview`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="Reach · 28 days" value={reach28.toLocaleString("en-MY")} delta={{ dir: "up", text: "▲ 9% vs prev." }} />
        </Link>
        <Link href={`${BASE}/schedule/plan`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="Scheduled posts" value={String(NS_SCHEDULED_POSTS.length)} delta={{ dir: "flat", text: "Next up in 2h" }} />
        </Link>
        <Link href={`${BASE}/account/credits`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard label="Credit balance" value={NS_BRAND.creditBalance.toLocaleString("en-MY")} delta={{ dir: "flat", text: "MYR wallet" }} />
        </Link>
      </div>

      {/* Quick starts */}
      <h2 className="mt-8 text-sm font-semibold text-foreground">Start something</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_STARTS.map((q) => {
          const Icon = q.icon;
          return (
            <Link
              key={q.label}
              href={q.href}
              className="group flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4 transition-colors duration-[120ms] hover:bg-accent"
            >
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-secondary">
                <Icon className="size-[18px] text-foreground" strokeWidth={2} />
              </span>
              <span className="mt-1 text-sm font-semibold text-foreground">{q.label}</span>
              <span className="text-xs text-muted-foreground">{q.desc}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Recent work → asset viewer */}
        <section className="lg:col-span-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">Recent work</h2>
            <Link href={`${BASE}/assets/library`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
              Open library
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {recent.map((a) => (
              <Link
                key={a.id}
                href={`${BASE}/create/asset-viewer?asset=${a.id}`}
                className="group overflow-hidden rounded-[14px] border border-border bg-card transition-colors duration-[120ms] hover:bg-accent"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element -- mock data URI(北极星约定) */}
                  <img src={a.thumb} alt={a.title} className="size-full object-cover" />
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
        </section>

        {/* Up next → schedule + campaign */}
        <section className="lg:col-span-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">Up next</h2>
            <Link href={`${BASE}/schedule/queue`} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
              Open queue
            </Link>
          </div>
          <div className="mt-3 overflow-hidden rounded-[14px] border border-border bg-card">
            {nextPosts.map((p, i) => (
              <Link
                key={p.id}
                href={`${BASE}/schedule/composer?post=${p.id}`}
                className={`flex items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-accent ${i > 0 ? "border-t border-border" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{p.caption}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{whenLabel(p.scheduledAt)}</p>
                </div>
                <TrendingUp className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              </Link>
            ))}
          </div>

          {/* Active campaign → proposal card */}
          <Link
            href={`${BASE}/campaign/proposal-card`}
            className="mt-3 flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 transition-colors duration-[120ms] hover:bg-accent"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
              <Sparkles className="size-[18px] text-foreground" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">{NS_CAMPAIGN.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{NS_CAMPAIGN.goal}</p>
            </div>
            <Badge variant="warning">Awaiting approval</Badge>
          </Link>
        </section>
      </div>
    </div>
  );
}
