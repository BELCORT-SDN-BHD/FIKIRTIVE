"use client";

import { useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { CheckCircle2, ChevronRight, Database, Sparkles } from "lucide-react";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { OttoAvatarChip } from "@/components/otto/OttoAvatar";
import { buttonVariants } from "@/design-system/primitives/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/design-system/primitives/chart";
import { Progress } from "@/design-system/primitives/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/design-system/primitives/select";
import type { HomeDashboardPerformer } from "@/design-system/patterns/founder-home/model";
import { homeAnalysisHref } from "@/lib/home-analysis-context";
import type { HomeSearchState, MarketingHealthReadModel } from "@/lib/home-marketing-health";
import { cn } from "@/lib/utils";
import { HomeMetricChange } from "./HomeMetricChange";

type ReadyHealth = Extract<MarketingHealthReadModel, { state: "ready" }>;

function analysisHref(filters: HomeSearchState, type: "performance-change" | "top-performer" | "data-health") {
  return homeAnalysisHref({
    type,
    subject: "marketing-health-overview",
    ...filters,
    originRange: filters.range,
    originComparison: filters.comparison,
    returnFocus: "marketing-health-heading",
  });
}

function Sparkline({ performer }: { performer: HomeDashboardPerformer }) {
  const data = performer.data.map((value, index) => ({ index, value }));
  return (
    <ChartContainer
      config={{ value: { label: performer.label, color: "var(--foreground)" } }}
      className="h-8 w-24 aspect-auto"
      initialDimension={{ width: 96, height: 32 }}
      role="img"
      aria-label={`${performer.label} trend`}
    >
      <LineChart data={data} accessibilityLayer margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
        <Line dataKey="value" stroke="var(--color-value)" strokeWidth={1.5} type="monotone" dot={false} />
      </LineChart>
    </ChartContainer>
  );
}

export function ReadyMarketingHealth({
  health,
  filters,
}: {
  health: ReadyHealth;
  filters: HomeSearchState;
}) {
  const [performerType, setPerformerType] = useState<"campaigns" | "creatives">("campaigns");
  const dashboard = health.snapshot;
  const performers = performerType === "campaigns"
    ? dashboard.campaignPerformers
    : dashboard.creativePerformers;
  const axisFormatter = (value: number) => dashboard.primary.axis === "currency"
    ? `RM ${value}`
    : new Intl.NumberFormat("en", {
        notation: value >= 10_000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(value);

  return (
    <div>
      <section aria-labelledby="marketing-health-heading" className="border-b border-border pb-6 pt-5">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 id="marketing-health-heading" tabIndex={-1} className="text-lg font-semibold tracking-[-0.02em] outline-none">
              <Link href={analysisHref(filters, "performance-change")} className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40">
                {dashboard.headline}
              </Link>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{dashboard.summary}</p>
          </div>
          <Link href={SHELL_ROUTES.connections} className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40">
            <Database className="size-3.5" aria-hidden /> {health.freshness.label} · {health.sources.length} sources
          </Link>
        </div>
        <div className="mt-5 grid min-w-0 grid-cols-[180px_minmax(0,1fr)] items-end gap-8">
          <div className="pb-5">
            <p className="text-xs text-muted-foreground">{dashboard.primary.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{dashboard.primary.value}</p>
            <div className="mt-2 flex items-center gap-2">
              <HomeMetricChange change={dashboard.primary.change} />
              <span className="text-xs text-muted-foreground">{dashboard.comparison?.periodLabel ?? dashboard.periodLabel}</span>
            </div>
          </div>
          <ChartContainer
            config={{ value: { label: dashboard.primary.label, color: "var(--info)" } }}
            className="h-[164px] w-full aspect-auto"
            initialDimension={{ width: 860, height: 164 }}
            role="img"
            aria-label={`${dashboard.primary.label} trend for ${dashboard.periodLabel}`}
          >
            <AreaChart data={dashboard.trend} accessibilityLayer margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={52} />
              <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={axisFormatter} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              <Area type="monotone" dataKey="value" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.08} strokeWidth={2} activeDot={{ r: 4 }} />
            </AreaChart>
          </ChartContainer>
        </div>
      </section>

      <section aria-label="Efficiency and source completeness" className="grid grid-cols-3 border-b border-border py-4">
        {dashboard.efficiency.map((metric, index) => (
          <div key={metric.label} className={index === 0 ? "pr-8" : "border-l border-border px-8"}>
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{metric.value}</p>
            <div className="mt-1 flex items-center gap-1.5"><HomeMetricChange change={metric.change} /><span className="text-xs text-muted-foreground">{dashboard.comparison?.label}</span></div>
          </div>
        ))}
        <Link href={analysisHref(filters, "data-health")} className="group flex items-center border-l border-border pl-8 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <span className="flex size-8 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground"><CheckCircle2 className="size-4" aria-hidden /></span>
          <span className="ml-3">
            <span className="block text-xs text-muted-foreground">Source completeness</span>
            <span className="mt-1 block text-sm font-semibold">All good</span>
            <span className="block text-xs text-muted-foreground">{health.sources.length} sources reporting</span>
          </span>
          <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
        </Link>
      </section>

      <div className="grid grid-cols-2 gap-x-10">
        <section aria-labelledby="what-changed-heading" className="min-w-0 border-b border-border py-5">
          <h2 id="what-changed-heading" className="text-sm font-semibold">What changed</h2>
          <p className="mt-1 text-xs text-muted-foreground">{dashboard.comparison ? `Key drivers ${dashboard.comparison.periodLabel}` : `Key drivers for ${dashboard.periodLabel.toLowerCase()}`}</p>
          <ol className="mt-4 space-y-4">
            {dashboard.findings.slice(0, 3).map((finding, index) => (
              <li key={finding.title} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{index + 1}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{finding.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{finding.detail}</p>
                  <Link href={analysisHref(filters, "performance-change")} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-info outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40">
                    {finding.action}<ChevronRight className="size-3" aria-hidden />
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="top-performers-heading" className="min-w-0 border-b border-border py-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 id="top-performers-heading" className="text-sm font-semibold">Top performers</h2><p className="mt-1 text-xs text-muted-foreground">{dashboard.performerMetric}</p></div>
            <Select value={performerType} onValueChange={(value) => setPerformerType(value as "campaigns" | "creatives")}>
              <SelectTrigger size="sm" aria-label="Top performer type"><SelectValue /></SelectTrigger>
              <SelectContent align="end"><SelectItem value="campaigns">Campaigns</SelectItem><SelectItem value="creatives">Creatives</SelectItem></SelectContent>
            </Select>
          </div>
          {performers.length ? (
            <div className="mt-3 divide-y divide-border">
              {performers.slice(0, 4).map((performer) => (
                <Link key={performer.label} href={analysisHref(filters, "top-performer")} className="grid grid-cols-[minmax(0,1fr)_90px_58px_96px] items-center gap-3 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold">{performer.label}</span><span className="block truncate text-xs text-muted-foreground">{performer.source}</span></span>
                  <span className="text-right text-sm font-semibold tabular-nums">{performer.value}</span>
                  <HomeMetricChange change={performer.change} />
                  <Sparkline performer={performer} />
                </Link>
              ))}
            </div>
          ) : <p className="mt-6 text-xs text-muted-foreground">No {performerType} are available for this period.</p>}
        </section>

        <section aria-labelledby="recommended-action-heading" className="min-w-0 py-5">
          <h2 id="recommended-action-heading" className="text-sm font-semibold">Recommended next action</h2>
          <p className="mt-1 text-xs text-muted-foreground">Otto can help you take the next best step.</p>
          <div className="mt-4 flex items-center rounded-[var(--radius-card)] border border-border p-3">
            <OttoAvatarChip size={32} className="size-11" />
            <span className="ml-3 min-w-0 flex-1"><span className="block text-sm font-semibold">{dashboard.recommendation.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{dashboard.recommendation.detail}</span></span>
            <Link href={homeAnalysisHref({ type: "performance-change", subject: "marketing-health-overview", ...filters, originRange: filters.range, originComparison: filters.comparison, returnFocus: "marketing-health-heading" }, {}, { openOtto: true })} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-3 shrink-0")}>
              <Sparkles aria-hidden /> Ask Otto
            </Link>
          </div>
        </section>

        <section aria-labelledby="channel-contribution-heading" className="min-w-0 border-l border-border py-5 pl-10">
          <h2 id="channel-contribution-heading" className="text-sm font-semibold">Channel contribution</h2>
          <p className="mt-1 text-xs text-muted-foreground">{dashboard.channelMetric}</p>
          <div className="mt-3 space-y-2.5">
            {dashboard.channels.map((channel) => (
              <Link key={channel.label} href={analysisHref(filters, "top-performer")} className="grid grid-cols-[110px_minmax(80px,1fr)_34px_82px_16px] items-center gap-3 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                <span className="truncate">{channel.label}</span><Progress value={channel.share} className="h-1.5 bg-secondary" /><span className="text-right tabular-nums">{channel.share}%</span><span className="text-right tabular-nums text-muted-foreground">{channel.value}</span><ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
