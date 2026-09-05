"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarRange,
  Database,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Target,
} from "lucide-react";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/design-system/primitives/alert";
import { Badge } from "@/design-system/primitives/badge";
import { Button, buttonVariants } from "@/design-system/primitives/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/design-system/primitives/empty";
import { DesktopHomeRequired, useDesktopHome } from "@/design-system/patterns/founder-home/DesktopHomeBoundary";
import {
  HOME_COMPARISONS,
  HOME_GOALS,
  HOME_RANGES,
  type HomeComparison,
  type HomeRange,
} from "@/design-system/patterns/founder-home/model";
import {
  homeAnalysisHref,
  homeHrefFromAnalysis,
  type HomeAnalysisContext,
} from "@/lib/home-analysis-context";
import type { MarketingHealthReadModel } from "@/lib/home-marketing-health";
import { HomeFilterPicker } from "./HomeFilterPicker";
import { ReadyHomeAnalysis } from "./ReadyHomeAnalysis";
import { MARKETING_HOME_COPY } from "./marketing-home-copy";

/**
 * 与 Home 那一侧同形:恢复动作要么是**去别处**(真链接),要么是**再读一次这一页**
 * (真按钮)。没有第三种(裁决九)。
 */
type BlockedContent = {
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
} & ({ href: string; retry?: false } | { retry: true; href?: undefined });

function BlockedAnalysis({
  health,
  context,
  onRetry,
  retrying,
  retryFailed,
}: {
  health: Exclude<MarketingHealthReadModel, { state: "partial" | "ready" }>;
  context: HomeAnalysisContext;
  onRetry: () => void;
  retrying: boolean;
  /** 已经重试过一次、服务器仍然读不出来(Home 那一侧同一条口径)。 */
  retryFailed: boolean;
}) {
  const homeHref = homeHrefFromAnalysis(context);
  const content: BlockedContent = health.state === "not-configured"
    ? {
        icon: <Database />,
        title: health.action === "reconnect" ? MARKETING_HOME_COPY.analysis.reconnectTitle : MARKETING_HOME_COPY.analysis.connectTitle,
        description: MARKETING_HOME_COPY.analysis.setupDescription,
        action: health.action === "reconnect" ? "Reconnect Meta ads" : "Manage connections",
        href: SHELL_ROUTES.connections,
      }
    : health.state === "insufficient"
      ? {
          icon: <Database />,
          title: MARKETING_HOME_COPY.analysis.insufficientTitle,
          description: MARKETING_HOME_COPY.analysis.insufficientDescription,
          action: context.range === "90-days" ? "Manage connections" : "Use last 90 days",
          href: context.range === "90-days"
            ? SHELL_ROUTES.connections
            : homeAnalysisHref(context, { range: "90-days" }),
        }
      : {
          icon: <RefreshCw />,
          title: MARKETING_HOME_COPY.analysis.unavailableTitle,
          description: MARKETING_HOME_COPY.analysis.unavailableDescription,
          action: "Retry analysis",
          /**
           * 与 Home 的 Retry 同一条理由:这以前是一条指回**同一个地址**的链接,重取靠的是
           * Next 对 same-page 导航的特判,不是我们自己的保证(判官 2026-09-05 P2-1)。
           * 现在是一颗按钮,按下去 `router.refresh()`,服务器重跑这一页、真的再读一次 Meta。
           */
          retry: true,
        };

  return (
    <main className="grid min-h-[calc(100dvh-2.75rem)] place-items-center px-8">
      <Empty className="max-w-xl border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">{content.icon}</EmptyMedia>
          <EmptyTitle>{content.title}</EmptyTitle>
          <EmptyDescription>{content.description}</EmptyDescription>
        </EmptyHeader>
        <div className="mt-5 flex items-center justify-center gap-2">
          {content.retry ? (
            <Button type="button" size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? "Retrying…" : content.action}
            </Button>
          ) : (
            <Link href={content.href} className={buttonVariants({ size: "sm" })}>{content.action}</Link>
          )}
          <Link href={homeHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>Back to Home</Link>
        </div>
        {/*
          重试失败的唯一反馈,与 Home 同一句、同一条口径:live region 常驻 DOM,句子后填;
          首屏没有句子(判官 2026-09-05 #1209 P2-3)。
        */}
        {content.retry ? (
          <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
            {retryFailed ? MARKETING_HOME_COPY.retryStillUnavailable : ""}
          </p>
        ) : null}
      </Empty>
    </main>
  );
}

function PartialAnalysis({
  health,
  context,
}: {
  health: Extract<MarketingHealthReadModel, { state: "partial" }>;
  context: HomeAnalysisContext;
}) {
  const title = context.type === "data-health"
    ? MARKETING_HOME_COPY.analysis.partialDataHealthTitle
    : MARKETING_HOME_COPY.analysis.partialPerformanceTitle;
  const primary = health.metrics[0];
  const chartSummary = health.chart?.points.length
    ? `${health.chart.points.length} Meta ads data points are available for this period.`
    : "Meta ads did not return a daily trend for this period.";

  return (
    <>
      <Alert variant="warning" className="mt-5">
        <Database aria-hidden />
        <AlertTitle>{MARKETING_HOME_COPY.analysis.limitedCoverageTitle}</AlertTitle>
        <AlertDescription>
          {/* 「数到哪一天」只在真有那一天时说 —— 拿不到日序列时不往这句话尾巴上贴一句
              「Freshness unavailable」(Home 那一侧同一条口径)。 */}
          {MARKETING_HOME_COPY.analysis.limitedCoverageDescription(
            health.period,
            health.freshness.status === "known" ? health.freshness.label : null,
          )}
        </AlertDescription>
      </Alert>

      <section className="grid grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)] items-center gap-8 border-b border-border py-7" aria-labelledby="analysis-conclusion-heading">
        <h2 id="analysis-conclusion-heading" className="max-w-[620px] text-[27px] font-semibold leading-[1.18] tracking-[-0.035em]">
          {title}
        </h2>
        <div className="border-l border-border pl-8">
          <p className="text-xs text-muted-foreground">{primary?.label ?? "Meta ads activity"}</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">
            {primary?.values[0]?.text ?? "Available"}
          </p>
          {primary?.delta ? <p className="mt-2 text-xs text-muted-foreground">{primary.delta.text} within this selected period</p> : null}
        </div>
      </section>

      <section className="border-b border-border py-7" aria-labelledby="analysis-chart-heading">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="analysis-chart-heading" className="text-sm font-semibold">Meta ads trend</h2>
            <p className="mt-1 text-xs text-muted-foreground">Observable source activity only</p>
          </div>
          <Badge variant="outline">Limited evidence</Badge>
        </div>
        {health.chart ? (
          <svg viewBox="0 0 820 180" className="mt-6 h-[260px] w-full overflow-visible" role="img" aria-labelledby="analysis-chart-title analysis-chart-description">
            <title id="analysis-chart-title">Meta ads trend</title>
            <desc id="analysis-chart-description">{chartSummary}</desc>
            <path d={health.chart.areaPath} fill="var(--info)" fillOpacity="0.08" />
            <path d={health.chart.linePath} fill="none" stroke="var(--info)" strokeWidth="2" />
          </svg>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">No daily trend is available for this period.</p>
        )}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-10 py-7">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">Evidence</h2>
          </div>
          <ol className="mt-4 divide-y divide-border">
            {health.metrics.slice(0, 3).map((metric, index) => (
              <li key={metric.label} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 py-3 first:pt-0">
                <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{index + 1}</span>
                <div>
                  <p className="text-sm font-semibold">{metric.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Reported by {health.source.label}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{metric.values[0]?.text ?? "Available"}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="border-l border-border pl-8">
          <h2 className="text-sm font-semibold">What this means</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {health.insight?.text ?? MARKETING_HOME_COPY.analysis.partialMeaningFallback}
          </p>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {MARKETING_HOME_COPY.analysis.partialMeaningBoundary}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={SHELL_ROUTES.connections} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Manage connections
            </Link>
            <Link href={homeAnalysisHref(context, {}, { openOtto: true })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <MessageCircle aria-hidden /> Ask Otto
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * 顶栏那一行 provenance —— 「这一页的数是谁报的、数到哪一天」。逐字来自读模型:
 * 来源标签由服务器给,时间戳只在 `known` 时才说(`home-marketing-health.ts` 的
 * `freshnessFromSeries` 拿不到日序列就回 `unknown`)。这里不拼任何形容词。
 */
function sourceProvenance(
  health: Extract<MarketingHealthReadModel, { state: "partial" | "ready" }>,
): string {
  const reported = health.state === "ready"
    ? health.sources.map((source) => source.label).join(" · ")
    : health.source.label;
  return health.freshness.status === "known" ? `${reported} · ${health.freshness.label}` : reported;
}

export function HomeAnalysisView({
  context,
  health,
}: {
  context: HomeAnalysisContext;
  health: MarketingHealthReadModel;
}) {
  const router = useRouter();
  const isDesktop = useDesktopHome();
  /** Retry analysis 的重取 —— 与 Home 同一条路子,见 `BlockedAnalysis` 的注释。 */
  const [retrying, startRetry] = useTransition();
  /** 见 `BlockedAnalysis` 的注释:按过一次、这一轮跑完了、屏幕还是同一屏,才说那一句。 */
  const [retryAttempted, setRetryAttempted] = useState(false);
  const retry = () => {
    setRetryAttempted(true);
    startRetry(() => router.refresh());
  };
  /** 读回来了就复位 —— 与 Home 同一条口径、同一个理由、同一种写法(判官 2026-09-05 #1216 P2-2)。 */
  const healthRecovered = health.state === "partial" || health.state === "ready";
  const [lastRecovered, setLastRecovered] = useState(healthRecovered);
  if (healthRecovered !== lastRecovered) {
    setLastRecovered(healthRecovered);
    if (healthRecovered) setRetryAttempted(false);
  }
  const retryFailed = retryAttempted && !retrying;
  const goalLabel = HOME_GOALS.find((item) => item.value === context.goal)?.label ?? "Online sales";

  if (!isDesktop) return <DesktopHomeRequired />;

  if (context.type === "top-performer" && health.state === "partial") {
    return (
      <BlockedAnalysis
        context={context}
        health={{ state: "insufficient", goal: context.goal, source: health.source }}
        onRetry={retry}
        retrying={retrying}
        retryFailed={retryFailed}
      />
    );
  }

  if (health.state !== "partial" && health.state !== "ready") {
    return <BlockedAnalysis health={health} context={context} onRetry={retry} retrying={retrying} retryFailed={retryFailed} />;
  }

  return (
    <main className="mx-auto w-full max-w-[1220px] px-8 py-6">
      <Link href={homeHrefFromAnalysis(context)} className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40">
        <ArrowLeft className="size-4" aria-hidden /> Back to Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">Home analysis</h1>
      <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-border pb-4">
        <span className="inline-flex h-8 items-center gap-2 px-2 text-sm font-medium">
          <Target className="size-4 text-muted-foreground" aria-hidden /> {goalLabel}
        </span>
        <HomeFilterPicker label="Date range" icon={CalendarRange} value={context.range} options={HOME_RANGES} onValueChange={(value) => router.push(homeAnalysisHref(context, { range: value as HomeRange }), { scroll: false })} />
        {/* Comparison 只在 `ready` 版面出现 —— 读得懂它的只有多来源 aggregate 的对比栏
            (`ReadyHomeAnalysis` 的 `dashboard.comparison`)。partial 单源分析里没有任何
            东西消费它:这一页只按 `range` 去读 Meta,换个对比口径页面上一个数字都不变。
            摆着它就是摆一颗点了没反应的控件(裁决九)。URL 那一段照旧解析与保留。 */}
        {health.state === "ready" ? (
          <HomeFilterPicker label="Comparison" icon={ArrowUpRight} value={context.comparison} options={HOME_COMPARISONS} onValueChange={(value) => router.push(homeAnalysisHref(context, { comparison: value as HomeComparison }), { scroll: false })} />
        ) : null}
        {/* 这一栏过去写死一句「Live source data」—— 不管数据从哪来、有多旧都照说。
            「Live」是一句没人验过的新鲜度断言(与 `MarketingHealthFreshness` 刻意不叫
            `current` 是同一条道理,判官 2026-09-05 P2-3)。现在它逐字来自读模型:说得出
            是谁报的,有真时间戳才补一句数到哪一天。 */}
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="size-3.5" aria-hidden /> {sourceProvenance(health)}
        </span>
      </div>
      {health.state === "partial"
        ? <PartialAnalysis health={health} context={context} />
        : <ReadyHomeAnalysis health={health} context={context} />}
    </main>
  );
}
