import { describe, expect, it } from "vitest";

import {
  analyticsRangeForHomeRange,
  homeHref,
  marketingHealthFromAnalytics,
  parseHomeSearchState,
} from "@/lib/home-marketing-health";
import type { AnalyticsData } from "@/lib/analytics-actions";

const readyAnalytics = {
  state: "ready",
  range: "30d",
  kpis: [
    {
      label: "Reach",
      values: [{ text: "12,480", currency: null, accountName: null }],
      delta: { dir: "up", text: "▲ 8.2%" },
    },
    {
      label: "Engagement",
      values: [{ text: "1,940", currency: null, accountName: null }],
      delta: { dir: "up", text: "▲ 4.1%" },
    },
  ],
  chart: {
    linePath: "M0 20 L20 10",
    areaPath: "M0 20 L20 10 L20 40 L0 40 Z",
    points: [
      { x: 0, y: 20, date: "2026-08-01", value: 480, peak: false },
      { x: 20, y: 10, date: "2026-08-02", value: 620, peak: true },
    ],
  },
  insight: { text: "Reach increased during this period.", prefill: "Explain the reach increase." },
  empty: false,
  hasAdAccounts: true,
} satisfies AnalyticsData;

describe("production Home marketing-health read model", () => {
  it("accepts only canonical Home filters and falls back safely", () => {
    expect(parseHomeSearchState({
      goal: "brand-awareness",
      range: "7-days",
      comparison: "none",
    })).toEqual({
      goal: "brand-awareness",
      range: "7-days",
      comparison: "none",
    });

    expect(parseHomeSearchState({
      goal: "made-up-goal",
      range: ["90-days", "7-days"],
      comparison: undefined,
    })).toEqual({
      goal: "online-sales",
      range: "30-days",
      comparison: "previous-period",
    });
  });

  it("maps Home ranges to the existing Meta range authority", () => {
    expect(analyticsRangeForHomeRange("7-days")).toBe("7d");
    expect(analyticsRangeForHomeRange("30-days")).toBe("30d");
    expect(analyticsRangeForHomeRange("90-days")).toBe("90d");
  });

  it("builds every Home filter link through one canonical route helper", () => {
    expect(homeHref({
      goal: "brand-awareness",
      range: "90-days",
      comparison: "none",
    })).toBe("/?goal=brand-awareness&range=90-days&comparison=none");
  });

  it("keeps a missing connection separate from unavailable and insufficient data", () => {
    expect(marketingHealthFromAnalytics({ state: "notConnected" }, "online-sales", "30-days")).toMatchObject({
      state: "not-configured",
      action: "connect",
    });
    expect(marketingHealthFromAnalytics({ state: "needsReconnect" }, "online-sales", "30-days")).toMatchObject({
      state: "not-configured",
      action: "reconnect",
    });
    expect(marketingHealthFromAnalytics({ state: "transientError" }, "online-sales", "30-days")).toMatchObject({
      state: "unavailable",
    });
    expect(
      marketingHealthFromAnalytics(
        { ...readyAnalytics, empty: true, hasAdAccounts: true },
        "online-sales",
        "30-days",
      ),
    ).toMatchObject({
      state: "insufficient",
    });
  });

  it("treats Meta-only metrics as partial evidence instead of fabricating full marketing health", () => {
    const result = marketingHealthFromAnalytics(readyAnalytics, "online-sales", "30-days");

    expect(result).toMatchObject({
      state: "partial",
      period: "30-days",
      evidenceStrength: "limited",
      freshness: {
        status: "current",
        label: "Data through 2 Aug 2026",
        asOf: "2026-08-02",
      },
      source: {
        id: "meta-ads",
        label: "Meta ads",
      },
      metrics: readyAnalytics.kpis,
      chart: readyAnalytics.chart,
    });
    expect(result).not.toHaveProperty("revenue");
    expect(result).not.toHaveProperty("roas");
    expect(result).not.toHaveProperty("topPerformers");
    expect(result).not.toHaveProperty("channelContribution");
  });
});

/**
 * FRONT-A3 —— Home 的连接五态(Founder 2026-09-04 裁决「Meta 单源版面」)。
 *
 * 这一组钉的是「每一态说的都是真话」:四种「没有图看」不许混成一句,partial 那行 provenance
 * 说的必须是 Meta 的数到哪一天,而多来源才产得出来的 `ready` 今天一次也不许冒出来。
 * 商家在浏览器里看到的那一半(每态的按钮通向哪)在 `marketing-home-view.test.tsx` 的
 * FRONT-A3 一组;两租户各看各的在 `home-layout-persistence.test.ts` 的 FRONT-A3 一组。
 */
describe("FRONT-A3:Home 连接五态,每一态都由服务器说了算", () => {
  it("FRONT-A3:没连过、需重连、读不出来、连上但没数 —— 四种「没有图看」各是一态", () => {
    expect(marketingHealthFromAnalytics({ state: "notConnected" }, "online-sales", "30-days")).toEqual({
      state: "not-configured",
      goal: "online-sales",
      action: "connect",
    });
    // token 解不开或 Meta 退回 OAuth 错误(meta-insights.ts / meta-errors.ts)= 连接还在,
    // 只是不能用了。说成「没连过」会让商家从头再连一次,而他要做的是重新授权。
    expect(marketingHealthFromAnalytics({ state: "needsReconnect" }, "online-sales", "30-days")).toEqual({
      state: "not-configured",
      goal: "online-sales",
      action: "reconnect",
    });
    expect(marketingHealthFromAnalytics({ state: "transientError" }, "online-sales", "30-days")).toEqual({
      state: "unavailable",
      goal: "online-sales",
      retryable: true,
    });
    expect(
      marketingHealthFromAnalytics(
        { ...readyAnalytics, empty: true, hasAdAccounts: true },
        "online-sales",
        "30-days",
      ),
    ).toEqual({
      state: "insufficient",
      goal: "online-sales",
      source: { id: "meta-ads", label: "Meta ads" },
    });
  });

  it("FRONT-A3:Meta 连上了但名下没有广告账号 —— 说的是「接一个投广告的账号」,不是「换 90 天」", () => {
    // 只为发帖连了 Instagram／Facebook 的商家:`me/adaccounts` 回空,所以 series 空、
    // 账号汇总也空 —— 旧口径下它和「有账号但没投放」长得一模一样,于是被一路引去换期间,
    // 而换到 90 天照样什么都没有(判官 2026-09-05 P1-1)。
    const noAdAccounts = marketingHealthFromAnalytics(
      { ...readyAnalytics, kpis: [], chart: null, insight: null, empty: true, hasAdAccounts: false },
      "online-sales",
      "30-days",
    );
    expect(noAdAccounts).toEqual({
      state: "not-configured",
      goal: "online-sales",
      action: "connect-ad-account",
    });
    // 而且它不是 insufficient —— 两者的下一步不一样,不能合成一句。
    expect(noAdAccounts.state).not.toBe("insufficient");
  });

  it("FRONT-A3:有广告账号、只是这段期间没投放 —— 才轮到「换个更宽的期间」", () => {
    expect(
      marketingHealthFromAnalytics(
        { ...readyAnalytics, empty: true, hasAdAccounts: true },
        "online-sales",
        "30-days",
      ),
    ).toEqual({
      state: "insufficient",
      goal: "online-sales",
      source: { id: "meta-ads", label: "Meta ads" },
    });
  });

  it("FRONT-A3:partial 的 freshness 是 Meta 数到哪一天,由服务器从日序列算出来", () => {
    const result = marketingHealthFromAnalytics(readyAnalytics, "online-sales", "30-days");
    if (result.state !== "partial") throw new Error(`expected partial, got ${result.state}`);
    // 日序列的最后一天(2026-08-02),不是「我们刚刚读过」。
    expect(result.freshness).toEqual({
      status: "current",
      label: "Data through 2 Aug 2026",
      asOf: "2026-08-02",
    });
  });

  it("FRONT-A3:没有日序列、或日期解不出来,就说「不知道」,不编一个日期", () => {
    const noSeries = marketingHealthFromAnalytics(
      { ...readyAnalytics, chart: null },
      "online-sales",
      "30-days",
    );
    if (noSeries.state !== "partial") throw new Error("expected partial");
    expect(noSeries.freshness).toEqual({ status: "unknown", label: "Freshness unavailable" });

    const badDate = marketingHealthFromAnalytics(
      {
        ...readyAnalytics,
        chart: {
          ...readyAnalytics.chart,
          points: [{ x: 0, y: 20, date: "not-a-date", value: 480, peak: false }],
        },
      },
      "online-sales",
      "30-days",
    );
    if (badDate.state !== "partial") throw new Error("expected partial");
    expect(badDate.freshness).toEqual({ status: "unknown", label: "Freshness unavailable" });
  });

  it("FRONT-A3:ready 是保留的契约,今天任何一种读都产不出它", () => {
    // 穷举 `AnalyticsData` 的每一种形状 —— Meta 单源之下没有任何一条路通向 ready,
    // 它要的是多来源 aggregate。这条红了,说明有人在只连一家的时候声称看到了全貌。
    const everyRead: AnalyticsData[] = [
      { state: "notConnected" },
      { state: "needsReconnect" },
      { state: "transientError" },
      { ...readyAnalytics, empty: true, hasAdAccounts: true },
      { ...readyAnalytics, empty: true, hasAdAccounts: false },
      readyAnalytics,
      { ...readyAnalytics, chart: null, insight: null },
      { ...readyAnalytics, kpis: [] },
    ];
    for (const read of everyRead) {
      expect(marketingHealthFromAnalytics(read, "online-sales", "30-days").state).not.toBe("ready");
    }
  });

  it("FRONT-A3:partial 只交出 Meta 手上有的东西,一个跨渠道结论都不给", () => {
    const result = marketingHealthFromAnalytics(readyAnalytics, "brand-awareness", "7-days");
    if (result.state !== "partial") throw new Error("expected partial");
    expect(result.source).toEqual({ id: "meta-ads", label: "Meta ads" });
    expect(result.evidenceStrength).toBe("limited");
    expect(result.period).toBe("7-days");
    expect(result.goal).toBe("brand-awareness");
    for (const invented of ["revenue", "roas", "topPerformers", "channelContribution", "sources", "snapshot"]) {
      expect(result).not.toHaveProperty(invented);
    }
  });
});
