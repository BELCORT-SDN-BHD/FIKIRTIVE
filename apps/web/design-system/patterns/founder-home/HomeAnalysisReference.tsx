"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Database,
  ImagePlus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { OttoPanelFlowReference, useOttoPanelReference } from "@/components/otto/panel/OttoPanelFlowReference";
import { ProductPatternShellFrame } from "@/design-system/patterns/application-shell/ProductPatternShellFrame";
import { REVIEW_ACCOUNT } from "@/design-system/patterns/application-shell/review-account";
import { createWorkspaceReviewHref } from "@/design-system/patterns/canvas/review-links";
import { settingsSectionReviewHref } from "@/design-system/patterns/settings/review-links";
import { Alert, AlertDescription, AlertTitle } from "@/design-system/primitives/alert";
import { Badge } from "@/design-system/primitives/badge";
import { Button, buttonVariants } from "@/design-system/primitives/button";
import { ButtonGroup } from "@/design-system/primitives/button-group";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/design-system/primitives/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/design-system/primitives/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/design-system/primitives/select";
import { Skeleton } from "@/design-system/primitives/skeleton";
import { cn } from "@/lib/utils";

import { DesktopHomeRequired, useDesktopHome } from "./DesktopHomeBoundary";
import {
  buildHomeAnalysisFixture,
  type HomeAnalysisState,
  type HomeAnalysisType,
} from "./home-analysis";
import {
  HOME_COMPARISONS,
  HOME_RANGES,
  type HomeComparison,
  type HomeGoal,
  type HomeRange,
} from "./model";
import { founderHomeReviewHref, homeAnalysisReviewHref } from "./review-links";

export type HomeAnalysisRouteProps = {
  type: HomeAnalysisType;
  state: HomeAnalysisState;
  goal: HomeGoal;
  range: HomeRange;
  comparison: HomeComparison;
  layout?: readonly string[];
  subject?: string;
  detail?: string;
  source?: string;
  metricLabel?: string;
  value?: string;
  change?: string;
  changeDirection?: "up" | "down";
  originRange: HomeRange;
  originComparison: HomeComparison;
};

function FilterPicker({
  label,
  icon: Icon,
  value,
  options,
  onValueChange,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger size="sm" aria-label={label} className="border-transparent bg-transparent px-2 shadow-none hover:bg-accent">
        <Icon className="size-4" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function AnalysisLoading() {
  return (
    <main className="mx-auto w-full max-w-[1220px] px-8 py-7" aria-busy="true" aria-label="Loading analysis">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-6 h-10 w-[520px]" />
      <Skeleton className="mt-5 h-8 w-[580px]" />
      <Skeleton className="mt-8 h-20 w-full" />
      <Skeleton className="mt-7 h-[330px] w-full" />
      <div className="mt-7 grid grid-cols-3 gap-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </main>
  );
}

function AnalysisBlockedState({
  state,
  homeHref,
  retryHref,
  extendHref,
}: {
  state: "insufficient" | "error";
  homeHref: string;
  retryHref: string;
  extendHref: string;
}) {
  const insufficient = state === "insufficient";
  return (
    <main className="grid min-h-[calc(100dvh-2.75rem)] place-items-center px-8">
      <Empty className="max-w-xl border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">{insufficient ? <Database /> : <RefreshCw />}</EmptyMedia>
          <EmptyTitle>{insufficient ? "Not enough evidence yet" : "We couldn't refresh this analysis"}</EmptyTitle>
          <EmptyDescription>
            {insufficient
              ? "This period does not include enough complete source data for a reliable explanation. Extend the date range or review your connections."
              : "Your last complete analysis is safe. Retry now, or return Home without changing its filters."}
          </EmptyDescription>
        </EmptyHeader>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link href={insufficient ? extendHref : retryHref} className={buttonVariants({ size: "sm" })}>
            {insufficient ? "Use last 90 days" : "Retry analysis"}
          </Link>
          <Link href={settingsSectionReviewHref("connections", "shopify")} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Manage connections
          </Link>
          <Link href={homeHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>Back to Home</Link>
        </div>
      </Empty>
    </main>
  );
}

function AnalysisCanvas(props: HomeAnalysisRouteProps) {
  const router = useRouter();
  const otto = useOttoPanelReference();
  const isDesktop = useDesktopHome();
  const [granularity, setGranularity] = React.useState<"day" | "week">("day");
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [breakdownDimension, setBreakdownDimension] = React.useState("primary");
  const fixture = buildHomeAnalysisFixture(props);
  const homeHref = founderHomeReviewHref({
    goal: props.goal,
    range: props.originRange,
    comparison: props.originComparison,
    layout: props.layout,
    focus: props.type === "data-health" ? "source-completeness" : "what-changed",
  });

  function analysisHref(patch: Partial<HomeAnalysisRouteProps>) {
    return homeAnalysisReviewHref({ ...props, ...patch });
  }

  function replaceAnalysis(patch: Partial<HomeAnalysisRouteProps>) {
    router.replace(analysisHref(patch), { scroll: false });
  }

  if (!isDesktop) return <DesktopHomeRequired />;
  if (props.state === "loading") return <AnalysisLoading />;
  if (props.state === "insufficient" || props.state === "error") {
    return (
      <AnalysisBlockedState
        state={props.state}
        homeHref={homeHref}
        retryHref={analysisHref({ state: "ready" })}
        extendHref={analysisHref({ state: "ready", range: "90-days" })}
      />
    );
  }

  const chartData = granularity === "day"
    ? fixture.trend
    : fixture.trend.filter((_, index) => index === 0 || index === fixture.trend.length - 1 || index % 2 === 0);
  const markerIndexes = [
    Math.min(1, chartData.length - 1),
    Math.max(1, Math.ceil((chartData.length - 1) / 2)),
    Math.max(2, chartData.length - 2),
  ];
  const createContext = [
    `Analysis snapshot: ${fixture.title}`,
    `${HOME_RANGES.find((item) => item.value === props.range)?.label} · ${fixture.evidenceStrength}`,
    "Updated 31 Aug 2026, 9:33 AM",
  ].join(" · ");
  const askPrompt = `Explain this analysis and help me decide what to do next: ${fixture.title}. ${fixture.conclusion} Evidence: ${fixture.evidenceStrength}. Period: ${HOME_RANGES.find((item) => item.value === props.range)?.label}. Snapshot: 31 Aug 2026, 9:33 AM.`;

  return (
    <main className="mx-auto w-full max-w-[1220px] px-6 py-6">
      <Link href={homeHref} className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40">
        <ArrowLeft className="size-4" aria-hidden /> Back to Home
      </Link>

      <div className="mt-4 flex items-start justify-between gap-8">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">{fixture.title}</h1>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-border pb-4">
        <span className="inline-flex h-8 items-center gap-2 px-2 text-sm font-medium">
          <Target className="size-4 text-muted-foreground" aria-hidden />
          {props.goal === "online-sales" ? "Online sales" : props.goal === "leads-bookings" ? "Leads / bookings" : "Brand awareness"}
        </span>
        <FilterPicker
          label="Date range"
          icon={CalendarRange}
          value={props.range}
          options={HOME_RANGES}
          onValueChange={(value) => replaceAnalysis({ range: value as HomeRange })}
        />
        <FilterPicker
          label="Comparison"
          icon={ArrowUpRight}
          value={props.comparison}
          options={HOME_COMPARISONS}
          onValueChange={(value) => replaceAnalysis({ comparison: value as HomeComparison })}
        />
        <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Database className="size-3.5" aria-hidden /> Updated 12 min ago · 3 sources
        </span>
      </div>

      {props.state === "partial" ? (
        <Alert variant="warning" className="mt-5">
          <Database aria-hidden />
          <AlertTitle>One source is still catching up</AlertTitle>
          <AlertDescription>
            The conclusion uses the latest complete data. Meta ads last synced 4 hours ago. <Link className="font-medium underline" href={settingsSectionReviewHref("connections", "meta-ads")}>Review connection</Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)] items-center gap-8 border-b border-border py-7" aria-labelledby="analysis-conclusion-heading">
        <h2 id="analysis-conclusion-heading" className="max-w-[620px] text-[27px] font-semibold leading-[1.18] tracking-[-0.035em]">{fixture.conclusion}</h2>
        <div className="border-l border-border pl-8">
          <p className="text-xs text-muted-foreground">{fixture.metricLabel}</p>
          <p className="mt-1 text-3xl font-semibold tracking-[-0.035em] tabular-nums">{fixture.metricValue}</p>
          {fixture.metricChange ? (
          <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-success">
              {fixture.metricChange.direction === "down" ? <ArrowDownRight className="size-4" aria-hidden /> : <ArrowUpRight className="size-4" aria-hidden />}
              {fixture.metricChange.value} {props.comparison === "previous-year" ? "vs previous year" : "vs previous period"}
            </p>
          ) : <p className="mt-1 text-xs text-muted-foreground">{fixture.metricDescription}</p>}
        </div>
      </section>

      <section className="border-b border-border py-6" aria-labelledby="analysis-chart-heading">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="analysis-chart-heading" className="text-sm font-semibold">{fixture.chartTitle}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{fixture.chartUnit}</p>
          </div>
          <ButtonGroup aria-label="Chart granularity">
            <Button type="button" size="sm" variant={granularity === "day" ? "secondary" : "ghost"} aria-pressed={granularity === "day"} onClick={() => setGranularity("day")}>Day</Button>
            <Button type="button" size="sm" variant={granularity === "week" ? "secondary" : "ghost"} aria-pressed={granularity === "week"} onClick={() => setGranularity("week")}>Week</Button>
          </ButtonGroup>
        </div>
        <ChartContainer
          config={{ value: { label: fixture.metricLabel, color: "var(--info)" } }}
          className="mt-4 h-[286px] w-full aspect-auto"
          initialDimension={{ width: 1120, height: 286 }}
        >
          <AreaChart data={chartData} margin={{ top: 28, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={48} />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={(value: number) => fixture.type === "data-health" ? `${value}%` : fixture.type === "top-performer" ? `RM ${value}` : `RM ${value}`}
            />
            <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent indicator="line" />} />
            <Area type="monotone" dataKey="value" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.08} strokeWidth={2} activeDot={{ r: 4 }} />
            {markerIndexes.map((index, markerIndex) => {
              const point = chartData[index];
              return point ? (
                <ReferenceDot
                  key={`${point.label}-${markerIndex}`}
                  x={point.label}
                  y={point.value}
                  r={10}
                  fill="var(--info)"
                  stroke="var(--background)"
                  strokeWidth={2}
                  label={{ value: markerIndex + 1, position: "center", fill: "white", fontSize: 10, fontWeight: 700 }}
                />
              ) : null;
            })}
          </AreaChart>
        </ChartContainer>
      </section>

      <section className="py-5" aria-labelledby="what-this-means-heading">
        <div className="flex items-start justify-between gap-6">
          <div className="max-w-3xl">
            <h2 id="what-this-means-heading" className="text-sm font-semibold">What this means</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{fixture.meaning}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-success" aria-hidden /> {fixture.evidenceStrength}
          </span>
        </div>

        <ol className="mt-5 grid grid-cols-3 divide-x divide-border border-b border-border pb-6">
          {fixture.evidence.map((item, index) => (
            <li key={item.title} className={cn("min-w-0 pr-6", index > 0 && "px-6", index === 2 && "pr-0")}>
              <div className="flex items-start gap-3">
                <Badge className="mt-0.5 size-6 shrink-0 justify-center rounded-full px-0" variant="info">{index + 1}</Badge>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{item.source}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,1fr)] items-center gap-2 border-b border-border py-4">
          <div className="mr-auto">
            <p className="text-sm font-semibold">Next step</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Build on what is working without losing the evidence behind it.</p>
          </div>
          {fixture.primaryAction === "create" ? (
            <Link href={createWorkspaceReviewHref(createContext)} className={buttonVariants({ size: "sm" })}>
              <ImagePlus aria-hidden /> {fixture.primaryActionLabel}
            </Link>
          ) : (
            <Link href={settingsSectionReviewHref("connections", "shopify")} className={buttonVariants({ size: "sm" })}>
              <SlidersHorizontal aria-hidden /> {fixture.primaryActionLabel}
            </Link>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => otto?.askOtto(askPrompt)}>
            Ask Otto
          </Button>
          <Button type="button" variant="ghost" size="sm" className="justify-self-end" aria-expanded={breakdownOpen} aria-controls="analysis-breakdown" onClick={() => setBreakdownOpen((open) => !open)}>
            View breakdown <ChevronDown className={cn("transition-transform duration-150", breakdownOpen && "rotate-180")} aria-hidden />
          </Button>
        </div>

        {breakdownOpen ? (
          <div id="analysis-breakdown" className="py-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">{fixture.breakdownLabel}</h2>
                <p className="mt-1 text-xs text-muted-foreground">Supporting evidence for this analysis snapshot.</p>
              </div>
              <Select value={breakdownDimension} onValueChange={setBreakdownDimension}>
                <SelectTrigger size="sm" aria-label="Breakdown dimension"><SelectValue /></SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="primary">{fixture.type === "data-health" ? "Connections" : "Primary sources"}</SelectItem>
                  <SelectItem value="secondary">{fixture.type === "top-performer" ? "Channels" : fixture.type === "data-health" ? "Sync health" : "Creative"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4 divide-y divide-border border-y border-border">
              {(breakdownDimension === "primary" ? fixture.breakdownRows : [...fixture.breakdownRows].reverse()).map((row) => (
                <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_140px_100px_16px] items-center gap-4 py-3 text-sm">
                  <span className="font-medium">{row.label}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{row.value}</span>
                  <span className="text-right tabular-nums text-success">{row.change}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function HomeAnalysisReference(props: HomeAnalysisRouteProps) {
  const fixture = buildHomeAnalysisFixture(props);
  return (
    <div className="gb min-h-dvh bg-background text-foreground">
      <OttoPanelFlowReference founderName={REVIEW_ACCOUNT.displayName} recommendedPrompt={`Explain this analysis: ${fixture.title}`}>
        <ProductPatternShellFrame pathname={SHELL_ROUTES.home} topBarLabel="Home / Analysis">
          <AnalysisCanvas {...props} />
        </ProductPatternShellFrame>
      </OttoPanelFlowReference>
    </div>
  );
}
