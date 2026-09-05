import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HomeAnalysisView } from "@/components/home/HomeAnalysisView";
import { buildHomeDashboardFixture } from "@/design-system/patterns/founder-home/fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("production Home analysis", () => {
  it("explains partial Meta evidence without turning it into a causal or cross-channel claim", () => {
    const markup = renderToStaticMarkup(createElement(HomeAnalysisView, {
      context: {
        type: "performance-change",
        subject: "meta-ads-overview",
        goal: "online-sales",
        range: "30-days",
        comparison: "previous-period",
        originRange: "7-days",
        originComparison: "none",
        returnFocus: "marketing-health-heading",
      },
      health: {
        state: "partial",
        goal: "online-sales",
        period: "30-days",
        freshness: { status: "unknown", label: "Freshness unavailable" },
        evidenceStrength: "limited",
        source: { id: "meta-ads", label: "Meta ads" },
        metrics: [{
          label: "Reach",
          values: [{ text: "12,480", currency: null, accountName: null }],
          delta: { dir: "up", text: "▲ 8.2%" },
        }],
        chart: {
          linePath: "M0 20 L20 10",
          areaPath: "M0 20 L20 10 L20 40 L0 40 Z",
          points: [
            { x: 0, y: 20, date: "2026-08-01", value: 480, peak: false },
            { x: 20, y: 10, date: "2026-08-02", value: 620, peak: true },
          ],
        },
        insight: { text: "Your best day was Aug 2.", prefill: "Explain Aug 2." },
      },
    } as never));

    expect(markup).toContain("Meta ads changed during this period");
    expect(markup).toContain("Limited evidence");
    expect(markup).toContain("12,480");
    expect(markup).toContain("Back to Home");
    expect(markup).toContain("range=7-days");
    expect(markup).toContain("comparison=none");
    expect(markup).not.toContain("helped revenue grow");
    expect(markup).not.toContain("Strong evidence");
    expect(markup).not.toContain("RM 24.80");
  });

  it("renders the frozen explanation hierarchy for a complete aggregate snapshot", () => {
    const markup = renderToStaticMarkup(createElement(HomeAnalysisView, {
      context: {
        type: "performance-change",
        subject: "marketing-health-overview",
        goal: "online-sales",
        range: "30-days",
        comparison: "previous-period",
        originRange: "30-days",
        originComparison: "previous-period",
        returnFocus: "marketing-health-heading",
      },
      health: {
        state: "ready",
        goal: "online-sales",
        period: "30-days",
        freshness: { status: "known", label: "Updated 12 min ago", asOf: "2026-08-31T15:00:00Z" },
        evidenceStrength: "complete",
        sources: [
          { id: "meta-ads", label: "Meta ads" },
        ],
        snapshot: buildHomeDashboardFixture("online-sales", "30-days", "previous-period"),
      },
    } as never));

    const hierarchy = [
      "Marketing is growing efficiently",
      "RM 18,420",
      "Evidence",
      "What this means",
      "Recommended next action",
    ];
    let previous = -1;
    for (const label of hierarchy) {
      const index = markup.indexOf(label);
      expect(index, label).toBeGreaterThan(previous);
      previous = index;
    }
    expect(markup).toContain("Ask Otto");
    expect(markup).not.toContain("Limited source coverage");
  });
});
