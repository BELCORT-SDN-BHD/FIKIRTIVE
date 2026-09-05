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

/**
 * 「数到哪一天」的两种可能。判别名是 `known` / `unknown`,**故意中性**:我们知道的只是
 * Meta 报到哪一天为止,没有任何地方拿这个日期和今天比过。叫它 `current` 会断言一句
 * 「数据是新的」——一个没人验过的说法(判官 2026-09-05 P2-3)。真要分 current/stale,
 * 得先有一条「多旧算旧」的规则,那是另一票。
 */
export type MarketingHealthFreshness =
  | {
      status: "known";
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
      freshness: Extract<MarketingHealthFreshness, { status: "known" }>;
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
      /**
       * 三种「这里还没有可用的连接」,各自要商家做的事不同:
       *   connect          —— 一条 Meta 连接都没有,去连。
       *   reconnect        —— 连接还在,但授权坏了,去重新授权。
       *   connect-ad-account —— 连上了,可这个 Meta 登录名下**一个广告账号都没有**
       *                       (`me/adaccounts` 回空)。只为发帖连了 Instagram／Facebook 的
       *                       商家就是这一种,而 Home 看的是广告表现。这一态过去混在
       *                       `insufficient` 里,把这些商家一路引去「换 90 天」——一个
       *                       他们换到底也救不了的动作(判官 2026-09-05 P1-1)。
       *
       * 三种都归 `not-configured`:规格 §3 给它的定义就是「没有适合当前 goal 的连接;
       * 显示连接入口,不显示样板数字」,而这三种都正是这句话。读模型的状态仍是冻结的
       * 那五个,不多不少。
       */
      action: "connect" | "reconnect" | "connect-ad-account";
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
  return { status: "known", label: `Data through ${MY_DATE_FORMAT.format(asOf)}`, asOf: last.date };
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
 *   未连接      `not-configured` / connect            → Connections 连 Instagram 或 Facebook(同一条 Meta 连接)
 *   需重连      `not-configured` / reconnect          → 同一扇门重新授权(token 解不开或 Meta 退回 OAuth 错误)
 *   没广告账号  `not-configured` / connect-ad-account → 连上了但这个登录名下没有广告账号,去接一个投广告的
 *   读不出来    `unavailable`                         → 原样重试,不改筛选(与「真的没有数据」分开说)
 *   连上但没数  `insufficient`                        → 换 90 天(这一态**已经**排除了「压根没有广告账号」)
 *   partial     `partial`                             → 真数据 + 数到哪天 + 「只包含 Meta 广告」一句
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
      // 顺序是有话说的:先问「有没有广告账号」,再问「有没有投放」。反过来问,没有广告账号的
      // 商家会拿到「换 90 天」——一个换到底也变不出数据的建议(判官 2026-09-05 P1-1)。
      if (!analytics.hasAdAccounts) {
        return { state: "not-configured", goal, action: "connect-ad-account" };
      }
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
