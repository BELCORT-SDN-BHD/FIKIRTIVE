import {
  HOME_COMPARISONS,
  HOME_GOALS,
  HOME_RANGES,
  type HomeComparison,
  type HomeDashboardSnapshot,
  type HomeGoal,
  type HomeRange,
} from "@/design-system/patterns/founder-home/model";
import type { AnalyticsData } from "@/lib/analytics-actions";
import type { ChartPoint, Kpi, RangeKey } from "@/lib/analytics-view";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

export type MarketingHealthSource = {
  id: "meta-ads";
  label: "Meta ads";
};

export type MarketingHealthFreshness =
  | {
      status: "current";
      label: string;
      asOf: string;
    }
  | {
      status: "unknown";
      label: "Freshness unavailable";
    };

type MarketingHealthBase = {
  goal: HomeGoal;
};

export type MarketingHealthReadModel =
  | (MarketingHealthBase & {
      state: "ready";
      sources: MarketingHealthSource[];
      snapshot: HomeDashboardSnapshot;
      period: HomeRange;
      freshness: Extract<MarketingHealthFreshness, { status: "current" }>;
      evidenceStrength: "complete";
    })
  | (MarketingHealthBase & {
      state: "partial";
      source: MarketingHealthSource;
      period: HomeRange;
      freshness: MarketingHealthFreshness;
      evidenceStrength: "limited";
      metrics: Kpi[];
      chart: {
        linePath: string;
        areaPath: string;
        points: ChartPoint[];
      } | null;
      insight: {
        text: string;
        prefill: string;
      } | null;
    })
  | (MarketingHealthBase & {
      state: "not-configured";
      action: "connect" | "reconnect";
    })
  | (MarketingHealthBase & {
      state: "insufficient";
      source: MarketingHealthSource;
    })
  | (MarketingHealthBase & {
      state: "unavailable";
      retryable: true;
    });

const META_ADS_SOURCE: MarketingHealthSource = {
  id: "meta-ads",
  label: "Meta ads",
};

const UNKNOWN_FRESHNESS: MarketingHealthFreshness = {
  status: "unknown",
  label: "Freshness unavailable",
};

export type HomeSearchState = {
  goal: HomeGoal;
  range: HomeRange;
  comparison: HomeComparison;
};

export function homeHref(filters: HomeSearchState): string {
  const query = new URLSearchParams({
    goal: filters.goal,
    range: filters.range,
    comparison: filters.comparison,
  });
  return `${SHELL_ROUTES.home}?${query.toString()}`;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseHomeSearchState(search: RawSearchParams): HomeSearchState {
  const goal = firstString(search.goal);
  const range = firstString(search.range);
  const comparison = firstString(search.comparison);

  return {
    goal: HOME_GOALS.some((option) => option.value === goal)
      ? (goal as HomeGoal)
      : "online-sales",
    range: HOME_RANGES.some((option) => option.value === range)
      ? (range as HomeRange)
      : "30-days",
    comparison: HOME_COMPARISONS.some((option) => option.value === comparison)
      ? (comparison as HomeComparison)
      : "previous-period",
  };
}

export function analyticsRangeForHomeRange(range: HomeRange): RangeKey {
  switch (range) {
    case "7-days":
      return "7d";
    case "30-days":
      return "30d";
    case "90-days":
      return "90d";
  }
}

export function marketingHealthFromAnalytics(
  analytics: AnalyticsData,
  goal: HomeGoal,
  period: HomeRange,
): MarketingHealthReadModel {
  switch (analytics.state) {
    case "notConnected":
      return { state: "not-configured", goal, action: "connect" };
    case "needsReconnect":
      return { state: "not-configured", goal, action: "reconnect" };
    case "transientError":
      return { state: "unavailable", goal, retryable: true };
    case "ready":
      if (analytics.empty) {
        return { state: "insufficient", goal, source: META_ADS_SOURCE };
      }

      return {
        state: "partial",
        goal,
        source: META_ADS_SOURCE,
        period,
        freshness: UNKNOWN_FRESHNESS,
        evidenceStrength: "limited",
        metrics: analytics.kpis,
        chart: analytics.chart,
        insight: analytics.insight,
      };
  }
}
