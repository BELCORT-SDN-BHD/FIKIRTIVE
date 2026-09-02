import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  HOME_ANALYSIS_STATES,
  HOME_ANALYSIS_TYPES,
  buildHomeAnalysisFixture,
} from "@/design-system/patterns/founder-home/home-analysis";
import {
  founderHomeReviewHref,
  homeAnalysisReviewHref,
} from "@/design-system/patterns/founder-home/review-links";

const WEB_ROOT = path.resolve(__dirname, "../..");
const PATTERN_ROOT = path.join(WEB_ROOT, "design-system/patterns/founder-home");
const REFERENCE = fs.readFileSync(path.join(PATTERN_ROOT, "HomeAnalysisReference.tsx"), "utf8");
const FIXTURES = fs.readFileSync(path.join(PATTERN_ROOT, "home-analysis.ts"), "utf8");
const ROUTE = fs.readFileSync(path.join(WEB_ROOT, "app/product-patterns/founder-home/analysis/page.tsx"), "utf8");
const SPEC = fs.readFileSync(path.join(PATTERN_ROOT, "home-analysis-spec.md"), "utf8");

describe("Home analysis detail pattern", () => {
  it("keeps the approved contract and selected visual target beside the implementation", () => {
    expect(SPEC).toContain("Founder approved and frozen — 2026-08-31");
    expect(SPEC).toContain("Founder 选择视觉方向 3");
    expect(fs.existsSync(path.join(PATTERN_ROOT, "home-analysis-selected-direction.png"))).toBe(true);
  });

  it("covers all three beta analysis types and five required surface states", () => {
    expect(HOME_ANALYSIS_TYPES).toEqual(["performance-change", "top-performer", "data-health"]);
    expect(HOME_ANALYSIS_STATES).toEqual(["ready", "partial", "insufficient", "error", "loading"]);
    for (const type of HOME_ANALYSIS_TYPES) {
      const fixture = buildHomeAnalysisFixture({
        type,
        range: "30-days",
        comparison: "previous-period",
      });
      expect(fixture.title).not.toBe("");
      expect(fixture.trend.length).toBeGreaterThan(2);
      expect(fixture.evidence).toHaveLength(3);
    }
  });

  it("uses the shared shell, desktop boundary, canonical primitives and Otto panel", () => {
    expect(REFERENCE).toContain("<ProductPatternShellFrame");
    expect(REFERENCE).toContain("<OttoPanelFlowReference");
    expect(REFERENCE).toContain('from "./DesktopHomeBoundary"');
    expect(REFERENCE).toContain('from "@/design-system/primitives/button"');
    expect(REFERENCE).toContain('from "@/design-system/primitives/chart"');
    expect(REFERENCE).not.toContain('from "@/components/ui/');
  });

  it("preserves the entering Home state while detail filters remain independently URL-backed", () => {
    const detailHref = homeAnalysisReviewHref({
      type: "performance-change",
      goal: "online-sales",
      range: "30-days",
      comparison: "previous-period",
      layout: ["marketing-health", "what-changed"],
    });
    expect(detailHref).toContain("originRange=30-days");
    expect(detailHref).toContain("originComparison=previous-period");
    expect(REFERENCE).toContain("props.originRange");
    expect(REFERENCE).toContain("props.originComparison");
    expect(ROUTE).toContain('read("originRange")');

    expect(founderHomeReviewHref({
      goal: "online-sales",
      range: "30-days",
      comparison: "previous-period",
      layout: ["marketing-health", "what-changed"],
      focus: "what-changed",
    })).toContain("#what-changed");
  });

  it("keeps the beta action and trust boundaries explicit", () => {
    expect(FIXTURES).toContain("Create a variation");
    expect(REFERENCE).toContain("Ask Otto");
    expect(REFERENCE).toContain("Manage connections");
    expect(REFERENCE).toContain("View breakdown");
    expect(REFERENCE).toContain("Not enough evidence yet");
    expect(REFERENCE).not.toMatch(/SHELL_ROUTES\.(campaign|schedule|analytics)/);
    expect(REFERENCE).not.toMatch(/PDF|CSV|Saved reports|Public share/);
  });
});
