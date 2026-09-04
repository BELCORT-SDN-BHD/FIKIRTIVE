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
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
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

/**
 * Home 这一刻的营销健康 —— 五态,一态一句话,全部由服务器说了算。
 *
 * `ready` 是**保留的契约,今天不可达**(Founder 2026-09-04 裁决「Meta 单源版面」):它要的是
 * 多来源 aggregate —— 各渠道的数在同一把尺上合成一个结论。今天只连得上 Meta 一家,合成出来的
 * 「全貌」不过是把 Meta 的数换个说法再说一遍。所以 {@link marketingHealthFromAnalytics} 永远
 * 不返回它(围栏见 `__tests__/home-marketing-health.test.ts` 的 FRONT-A3 一条),而类型留着:
 * 第二个来源接上的那天,点亮的是这一支,不必回来重画整个读模型。
 */
export type MarketingHealthReadModel =
  | (MarketingHealthBase & {
      /** 保留契约,今天产不出来 —— 需要多来源 aggregate,见本类型开头。 */
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

/**
 * 「数到哪一天」—— partial 版面那行 provenance 的唯一产地。
 *
 * 读的是 Meta 自己回的日序列最后一天(`ChartPoint.date` ← `DailyMetric.date` ← Graph 的
 * `date_start`,`meta-insights.ts` 已按日期升序排好),**不是**我们发起这次读的时刻。在广告
 * 数据上这两件事不是一回事:Meta 的 insights 会回填、会延迟,「刚刚读过」证明不了「数到今天」。
 * 商家要靠这一行判断这张图能不能拿来做决定,所以它必须说数据本身到哪天为止。
 *
 * 拿不到日序列(账号有汇总、这段期间没有逐日行),或者那个日期解不出来,就退回
 * `Freshness unavailable` —— 说「不知道」比编一个日期诚实。
 */
function freshnessFromSeries(
  chart: { points: ChartPoint[] } | null,
): MarketingHealthFreshness {
  const last = chart?.points[chart.points.length - 1];
  if (!last) return UNKNOWN_FRESHNESS;
  const asOf = new Date(`${last.date}T00:00:00Z`);
  if (Number.isNaN(asOf.getTime())) return UNKNOWN_FRESHNESS;
  return { status: "current", label: `Data through ${MY_DATE_FORMAT.format(asOf)}`, asOf: last.date };
}

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

/**
 * Meta 的一次读 → Home 的五态之一。整个产品对「这一刻商家的营销健康是什么状态」只有这一个答案。
 *
 * 五态与它们各自的真实动作(界面在 `components/home/MarketingHomeView.tsx`):
 *   未连接      `not-configured` / connect   → Connections 连 Instagram 或 Facebook(同一条 Meta 连接)
 *   需重连      `not-configured` / reconnect → 同一扇门重新授权(token 解不开或 Meta 退回 OAuth 错误)
 *   读不出来    `unavailable`                → 原样重试,不改筛选(与「真的没有数据」分开说)
 *   连上但没数  `insufficient`               → 换 90 天,或去 Connections 看是不是投放本身没跑
 *   partial     `partial`                    → 真数据 + 数到哪天 + 「只包含 Meta 广告」一句
 *
 * 没有第六态,也不会有 `ready`(见 {@link MarketingHealthReadModel} 开头)。
 */
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
        freshness: freshnessFromSeries(analytics.chart),
        evidenceStrength: "limited",
        metrics: analytics.kpis,
        chart: analytics.chart,
        insight: analytics.insight,
      };
  }
}
