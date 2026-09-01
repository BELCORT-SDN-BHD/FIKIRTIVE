"use client";

import Link from "next/link";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Database, MessageCircle, ShieldCheck } from "lucide-react";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { buttonVariants } from "@/design-system/primitives/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/design-system/primitives/chart";
import { homeAnalysisHref, type HomeAnalysisContext } from "@/lib/home-analysis-context";
import type { MarketingHealthReadModel } from "@/lib/home-marketing-health";
import { HomeMetricChange } from "./HomeMetricChange";

type ReadyHealth = Extract<MarketingHealthReadModel, { state: "ready" }>;

export function ReadyHomeAnalysis({
  health,
  context,
}: {
  health: ReadyHealth;
  context: HomeAnalysisContext;
}) {
  const dashboard = health.snapshot;
  const performer = dashboard.campaignPerformers[0];
  const conclusion = context.type === "data-health"
    ? `${health.sources.length} marketing sources are reporting`
    : context.type === "top-performer" && performer
      ? `${performer.label} is the strongest performer`
      : dashboard.headline;
  const primary = context.type === "data-health"
    ? { label: "Sources reporting", value: String(health.sources.length), change: null }
    : context.type === "top-performer" && performer
      ? { label: dashboard.performerMetric, value: performer.value, change: performer.change }
      : dashboard.primary;
  const axisFormatter = (value: number) => dashboard.primary.axis === "currency"
    ? `RM ${value}`
    : new Intl.NumberFormat("en", {
        notation: value >= 10_000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(value);

  return (
    <>
      <section className="grid grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)] items-center gap-8 border-b border-border py-7" aria-labelledby="analysis-conclusion-heading">
        <h2 id="analysis-conclusion-heading" className="max-w-[620px] text-[27px] font-semibold leading-[1.18] tracking-[-0.035em]">{conclusion}</h2>
        <div className="border-l border-border pl-8">
          <p className="text-xs text-muted-foreground">{primary.label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{primary.value}</p>
          <div className="mt-2"><HomeMetricChange change={primary.change} /></div>
        </div>
      </section>

      <section className="border-b border-border py-7" aria-labelledby="analysis-chart-heading">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="analysis-chart-heading" className="text-sm font-semibold">{dashboard.primary.label} trend</h2><p className="mt-1 text-xs text-muted-foreground">{dashboard.periodLabel} · {dashboard.comparison?.label ?? "No comparison"}</p></div>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Database className="size-3.5" aria-hidden />{health.freshness.label}</span>
        </div>
        <ChartContainer
          config={{ value: { label: dashboard.primary.label, color: "var(--info)" } }}
          className="mt-6 h-[260px] w-full aspect-auto"
          initialDimension={{ width: 1120, height: 260 }}
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
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-10 border-b border-border py-7">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden /><h2 className="text-sm font-semibold">Evidence</h2></div>
          <ol className="mt-4 divide-y divide-border">
            {dashboard.findings.slice(0, 3).map((finding, index) => (
              <li key={finding.title} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 py-3 first:pt-0">
                <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{index + 1}</span>
                <span><span className="block text-sm font-semibold">{finding.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{finding.detail}</span></span>
                <span className="text-sm font-semibold tabular-nums">{finding.analysisMetric.value}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="border-l border-border pl-8">
          <h2 className="text-sm font-semibold">What this means</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{dashboard.summary}</p>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Evidence comes from {health.sources.map((source) => source.label).join(", ")}.</p>
        </div>
      </section>

      <section className="flex items-center gap-5 py-7" aria-labelledby="analysis-action-heading">
        <div className="min-w-0 flex-1"><h2 id="analysis-action-heading" className="text-sm font-semibold">Recommended next action</h2><p className="mt-1 text-sm text-muted-foreground">{dashboard.recommendation.title}. {dashboard.recommendation.detail}</p></div>
        <Link href={homeAnalysisHref(context, {}, { openOtto: true })} className={buttonVariants({ size: "sm" })}><MessageCircle aria-hidden /> Ask Otto</Link>
        <Link href={SHELL_ROUTES.create} className={buttonVariants({ variant: "secondary", size: "sm" })}>Create with Otto</Link>
      </section>
    </>
  );
}
