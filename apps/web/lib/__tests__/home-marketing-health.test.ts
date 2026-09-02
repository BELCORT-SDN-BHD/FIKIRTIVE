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
    expect(marketingHealthFromAnalytics({ ...readyAnalytics, empty: true }, "online-sales", "30-days")).toMatchObject({
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
        status: "unknown",
        label: "Freshness unavailable",
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
