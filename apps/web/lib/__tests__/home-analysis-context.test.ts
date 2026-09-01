import { describe, expect, it } from "vitest";

import { homeHrefFromAnalysis, parseHomeAnalysisContext } from "@/lib/home-analysis-context";

describe("production Home analysis context", () => {
  it("accepts typed identifiers and never treats client copy or values as truth", () => {
    const context = parseHomeAnalysisContext({
      type: "performance-change",
      subject: "meta-ads-overview",
      goal: "brand-awareness",
      range: "7-days",
      comparison: "none",
      originRange: "30-days",
      originComparison: "previous-period",
      returnFocus: "home-main",
      title: "Revenue exploded",
      value: "RM 999,999",
      conclusion: "A made-up causal claim",
    });

    expect(context).toEqual({
      type: "performance-change",
      subject: "meta-ads-overview",
      goal: "brand-awareness",
      range: "7-days",
      comparison: "none",
      originRange: "30-days",
      originComparison: "previous-period",
      returnFocus: "home-main",
    });
    expect(context).not.toHaveProperty("title");
    expect(context).not.toHaveProperty("value");
    expect(context).not.toHaveProperty("conclusion");
  });

  it("falls back to a safe known subject and canonical Home filters", () => {
    expect(parseHomeAnalysisContext({
      type: "arbitrary-report",
      subject: "someone-elses-campaign",
      goal: "made-up",
      range: ["90-days"],
    })).toEqual({
      type: "data-health",
      subject: "meta-ads-overview",
      goal: "online-sales",
      range: "30-days",
      comparison: "previous-period",
      originRange: "30-days",
      originComparison: "previous-period",
      returnFocus: "home-main",
    });
  });

  it("returns to Home using the original filters", () => {
    const context = parseHomeAnalysisContext({
      goal: "online-sales",
      range: "7-days",
      comparison: "none",
      originRange: "90-days",
      originComparison: "previous-period",
      returnFocus: "marketing-health-heading",
    });

    expect(homeHrefFromAnalysis(context)).toBe(
      "/?goal=online-sales&range=90-days&comparison=previous-period#marketing-health-heading",
    );
  });
});
