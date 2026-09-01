"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  ArrowUpRight,
  CalendarRange,
  ChevronRight,
  Database,
  PanelsTopLeft,
  RefreshCw,
  Target,
} from "lucide-react";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { canvasHref } from "@/components/canvas/canvas-href";
import { Badge } from "@/design-system/primitives/badge";
import { buttonVariants } from "@/design-system/primitives/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/design-system/primitives/empty";
import { cn } from "@/lib/utils";
import { homeHref, type MarketingHealthReadModel } from "@/lib/home-marketing-health";
import { homeAnalysisHref } from "@/lib/home-analysis-context";
import { DesktopHomeRequired, useDesktopHome } from "@/design-system/patterns/founder-home/DesktopHomeBoundary";
import {
  HOME_COMPARISONS,
  HOME_GOALS,
  HOME_RANGES,
  type HomeComparison,
  type HomeGoal,
  type HomeRange,
} from "@/design-system/patterns/founder-home/model";
import type { HomeSearchState } from "@/lib/home-marketing-health";
import { HomeFilterPicker } from "./HomeFilterPicker";
import { MARKETING_HOME_COPY } from "./marketing-home-copy";
import { ReadyMarketingHealth } from "./ReadyMarketingHealth";

export type HomeRecentCanvas = {
  id: string;
  name: string;
  updatedLabel: string;
};

export type HomeRecentCanvasRead =
  | { ok: true; value: HomeRecentCanvas[] }
  | { ok: false };

function ContinueCreating({ recents }: { recents: HomeRecentCanvasRead }) {
  return (
    <section aria-labelledby="continue-creating-heading" className="border-b border-border py-3">
      <div className="flex min-h-11 items-center gap-3">
        <div className="mr-1 min-w-0">
          <h2 id="continue-creating-heading" className="text-xs font-semibold">
            {MARKETING_HOME_COPY.recentsTitle}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {MARKETING_HOME_COPY.recentsDescription}
          </p>
        </div>
        {!recents.ok ? (
          <p role="status" className="text-xs text-muted-foreground">
            {MARKETING_HOME_COPY.recentsUnreadable}
          </p>
        ) : (
          recents.value.slice(0, 2).map((canvas) => (
            <Link
              key={canvas.id}
              href={canvasHref(canvas.id)}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "max-w-48")}
              title={`${canvas.name} · ${canvas.updatedLabel}`}
            >
              <PanelsTopLeft aria-hidden />
              <span className="truncate">{canvas.name}</span>
            </Link>
          ))
        )}
        <Link
          href={SHELL_ROUTES.create}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto shrink-0")}
        >
          Create something new <ChevronRight aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function RecoveryState({ health, filters }: { health: MarketingHealthReadModel; filters: HomeSearchState }) {
  if (health.state === "partial" || health.state === "ready") return null;

  const content = health.state === "not-configured"
    ? health.action === "reconnect"
      ? {
          title: MARKETING_HOME_COPY.reconnectTitle,
          description: MARKETING_HOME_COPY.reconnectDescription,
          action: "Reconnect Meta ads",
          href: SHELL_ROUTES.connections,
          icon: <Database />,
        }
      : {
          title: MARKETING_HOME_COPY.notConfiguredTitle,
          description: MARKETING_HOME_COPY.notConfiguredDescription,
          action: "Manage connections",
          href: SHELL_ROUTES.connections,
          icon: <Database />,
        }
    : health.state === "insufficient"
      ? {
          title: MARKETING_HOME_COPY.insufficientTitle,
          description: MARKETING_HOME_COPY.insufficientDescription,
          action: filters.range === "90-days" ? "Manage connections" : "Use last 90 days",
          href: filters.range === "90-days"
            ? SHELL_ROUTES.connections
            : homeHref({ ...filters, range: "90-days" }),
          icon: <Database />,
        }
      : {
          title: MARKETING_HOME_COPY.unavailableTitle,
          description: MARKETING_HOME_COPY.unavailableDescription,
          action: "Retry",
          href: homeHref(filters),
          icon: <RefreshCw />,
        };

  return (
    <Empty className="min-h-[420px] border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{content.icon}</EmptyMedia>
        <EmptyTitle>{content.title}</EmptyTitle>
        <EmptyDescription>{content.description}</EmptyDescription>
      </EmptyHeader>
      <Link href={content.href} className={buttonVariants({ size: "sm" })}>
        {content.action}
      </Link>
    </Empty>
  );
}

function PartialMarketingHealth({
  health,
  filters,
}: {
  health: Extract<MarketingHealthReadModel, { state: "partial" }>;
  filters: HomeSearchState;
}) {
  const chartSummary = health.chart?.points.length
    ? `${health.source.label} reported ${health.chart.points.length} daily data points in this period.`
    : `${health.source.label} reported metrics without a daily trend for this period.`;

  return (
    <div>
      <section aria-labelledby="marketing-health-heading" className="border-b border-border pb-6 pt-5">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="marketing-health-heading" tabIndex={-1} className="text-lg font-semibold tracking-[-0.02em] outline-none">
                <Link
                  href={homeAnalysisHref({
                    type: "performance-change",
                    subject: "meta-ads-overview",
                    ...filters,
                    originRange: filters.range,
                    originComparison: filters.comparison,
                    returnFocus: "marketing-health-heading",
                  })}
                  className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  {MARKETING_HOME_COPY.partialTitle}
                </Link>
              </h2>
              <Badge variant="outline">{MARKETING_HOME_COPY.partialLabel}</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {health.insight?.text ?? MARKETING_HOME_COPY.partialDescription}
            </p>
          </div>
          <Link
            href={SHELL_ROUTES.connections}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Database className="size-3.5" aria-hidden /> {health.source.label} · {health.freshness.label}
          </Link>
        </div>

        <div className="mt-7 grid grid-cols-[220px_minmax(0,1fr)] items-end gap-8">
          <div className="grid gap-5">
            {health.metrics.map((metric) => (
              <div key={metric.label}>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <div className="mt-1.5 space-y-1">
                  {metric.values.map((value, index) => (
                    <p key={`${metric.label}-${index}`} className="text-xl font-semibold tabular-nums">
                      {value.text}
                      {value.accountName ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{value.accountName}</span>
                      ) : null}
                    </p>
                  ))}
                </div>
                {metric.delta ? <p className="mt-1 text-xs text-muted-foreground">{metric.delta.text} within this period</p> : null}
              </div>
            ))}
          </div>
          {health.chart ? (
            <div className="min-w-0">
              <svg
                viewBox="0 0 820 180"
                className="h-[180px] w-full overflow-visible"
                role="img"
                aria-labelledby="meta-trend-title meta-trend-description"
              >
                <title id="meta-trend-title">Meta ads performance trend</title>
                <desc id="meta-trend-description">{chartSummary}</desc>
                <path d={health.chart.areaPath} fill="var(--info)" fillOpacity="0.08" />
                <path d={health.chart.linePath} fill="none" stroke="var(--info)" strokeWidth="2" />
              </svg>
            </div>
          ) : (
            <p className="pb-8 text-sm text-muted-foreground">No daily trend is available for this period.</p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 py-5" aria-labelledby="complete-home-heading">
        <div>
          <h2 id="complete-home-heading" className="text-sm font-semibold">Complete your marketing health view</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{MARKETING_HOME_COPY.partialDescription}</p>
        </div>
        <Link href={SHELL_ROUTES.connections} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Manage connections
        </Link>
      </section>
    </div>
  );
}

export function MarketingHomeView({
  filters,
  health,
  recents,
}: {
  filters: HomeSearchState;
  health: MarketingHealthReadModel;
  recents: HomeRecentCanvasRead;
}) {
  const router = useRouter();
  const isDesktop = useDesktopHome();

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }, []);

  function replaceFilter(patch: Partial<HomeSearchState>) {
    router.push(homeHref({ ...filters, ...patch }), { scroll: false });
  }

  if (!isDesktop) return <DesktopHomeRequired />;

  return (
    <main id="home-main" tabIndex={-1} className="mx-auto w-full max-w-[1220px] px-8 py-6 outline-none">
      <h1 className="text-3xl font-semibold tracking-[-0.035em]">Home</h1>
      <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-border pb-4">
        <HomeFilterPicker label="Business goal" icon={Target} value={filters.goal} options={HOME_GOALS} onValueChange={(value) => replaceFilter({ goal: value as HomeGoal })} />
        <HomeFilterPicker label="Date range" icon={CalendarRange} value={filters.range} options={HOME_RANGES} onValueChange={(value) => replaceFilter({ range: value as HomeRange })} />
        <HomeFilterPicker label="Comparison" icon={ArrowUpRight} value={filters.comparison} options={HOME_COMPARISONS} onValueChange={(value) => replaceFilter({ comparison: value as HomeComparison })} />
      </div>

      <ContinueCreating recents={recents} />
      <RecoveryState health={health} filters={filters} />
      {health.state === "partial" ? <PartialMarketingHealth health={health} filters={filters} /> : null}
      {health.state === "ready" ? <ReadyMarketingHealth health={health} filters={filters} /> : null}
    </main>
  );
}
