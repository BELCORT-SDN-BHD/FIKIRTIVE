import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  HOME_COMPONENTS,
  HOME_COMPARISONS,
  HOME_GOALS,
  HOME_RANGES,
  HOME_TEMPLATES,
  ONLINE_SALES_HOME,
  createHomeLayouts,
  recommendedHome,
} from "@/design-system/patterns/founder-home/model";
import { buildHomeDashboardFixture } from "@/design-system/patterns/founder-home/fixtures";

const WEB_ROOT = path.resolve(__dirname, "../..");
const PATTERN_ROOT = path.join(WEB_ROOT, "design-system/patterns/founder-home");
const REFERENCE = fs.readFileSync(path.join(PATTERN_ROOT, "FounderHomeReference.tsx"), "utf8");
const FIXTURES = fs.readFileSync(path.join(PATTERN_ROOT, "fixtures.ts"), "utf8");
const ROUTE = fs.readFileSync(path.join(WEB_ROOT, "app/product-patterns/founder-home/page.tsx"), "utf8");
const REFERENCES = fs.readFileSync(path.join(PATTERN_ROOT, "references.md"), "utf8");

describe("Founder Home product pattern", () => {
  it("keeps one unique component registry and derives the Online sales template from it", () => {
    const registryIds = HOME_COMPONENTS.map((item) => item.id);

    expect(new Set(registryIds).size).toBe(registryIds.length);
    expect(new Set(ONLINE_SALES_HOME).size).toBe(ONLINE_SALES_HOME.length);
    expect(ONLINE_SALES_HOME.every((id) => registryIds.includes(id))).toBe(true);
  });

  it("owns a distinct recommended component composition for every business goal", () => {
    const templates = Object.values(HOME_TEMPLATES);

    expect(templates).toHaveLength(3);
    expect(new Set(templates.map((template) => template.join("|"))).size).toBe(3);
    expect(recommendedHome("online-sales")).toEqual(ONLINE_SALES_HOME);
    expect(templates.every((template) => template.every((id) => HOME_COMPONENTS.some((item) => item.id === id)))).toBe(true);
  });

  it("creates independent saved layouts for each business goal", () => {
    const layouts = createHomeLayouts();
    layouts["leads-bookings"].pop();

    expect(layouts["online-sales"]).toEqual(recommendedHome("online-sales"));
    expect(layouts["brand-awareness"]).toEqual(recommendedHome("brand-awareness"));
    expect(layouts["leads-bookings"]).not.toEqual(recommendedHome("leads-bookings"));
  });

  it("derives range and comparison changes without duplicating dashboard templates", () => {
    const sevenDays = buildHomeDashboardFixture("leads-bookings", "7-days", "previous-period");
    const ninetyDays = buildHomeDashboardFixture("leads-bookings", "90-days", "previous-year");
    const withoutComparison = buildHomeDashboardFixture("leads-bookings", "90-days", "none");

    expect(sevenDays.primary.label).toBe("Qualified leads");
    expect(sevenDays.primary.value).not.toBe(ninetyDays.primary.value);
    expect(sevenDays.trend.map((point) => point.label)).not.toEqual(ninetyDays.trend.map((point) => point.label));
    expect(sevenDays.comparison?.label).toBe("vs previous period");
    expect(ninetyDays.comparison?.label).toBe("vs previous year");
    expect(withoutComparison.comparison).toBeNull();
    expect(withoutComparison.primary.change).toBeNull();
    expect(withoutComparison.efficiency.every((item) => item.change === null)).toBe(true);
  });

  it("builds every supported goal, range, and comparison combination honestly", () => {
    for (const goal of HOME_GOALS) {
      for (const range of HOME_RANGES) {
        for (const comparison of HOME_COMPARISONS) {
          const dashboard = buildHomeDashboardFixture(goal.value, range.value, comparison.value);

          expect(dashboard.goal).toBe(goal.value);
          expect(dashboard.primary.value).not.toBe("");
          expect(dashboard.trend.length).toBeGreaterThan(1);
          expect(dashboard.findings).toHaveLength(3);
          expect(dashboard.campaignPerformers.length).toBeGreaterThan(2);
          expect(dashboard.channels).toHaveLength(5);
          if (comparison.value === "none") {
            expect(dashboard.comparison).toBeNull();
            expect(dashboard.campaignPerformers.every((item) => item.change === null)).toBe(true);
          } else {
            expect(dashboard.comparison?.label).toBe(`vs ${comparison.label.toLowerCase().replace("previous ", "previous ")}`);
          }
        }
      }
    }
  });

  it("composes the formal Application shell and Otto panel instead of copying either one", () => {
    expect(REFERENCE).toContain('from "@/design-system/patterns/application-shell/ProductPatternShellFrame"');
    expect(REFERENCE).toContain('from "@/components/otto/panel/OttoPanelFlowReference"');
    expect(REFERENCE).toContain("<ProductPatternShellFrame");
    expect(REFERENCE).toContain("<OttoPanelFlowReference");
    expect(FIXTURES).toContain("Should I increase the Sales Aug 2026 campaign budget?");
    expect(REFERENCE).not.toContain("OttoHomeFixture");
  });

  it("uses the registry for customization and keeps persistence out of the review prototype", () => {
    expect(REFERENCE).toContain("HOME_COMPONENTS");
    expect(REFERENCE).toContain("recommendedHome");
    expect(REFERENCE).toContain("Customize home");
    expect(REFERENCE).toContain("Reset");
    expect(REFERENCE).toContain("Cancel");
    expect(REFERENCE).toContain("Home saved");
    expect(REFERENCE).toContain("buildHomeDashboardFixture(goal, range, comparison)");
    expect(REFERENCE).toContain("dashboard={dashboard}");
    expect(REFERENCE).toContain("disabled={customizing}");
    expect(REFERENCE).not.toMatch(/fetch\(|localStorage|server action/i);
  });

  it("makes the desktop-only boundary deliberate", () => {
    const boundary = fs.readFileSync(path.join(PATTERN_ROOT, "DesktopHomeBoundary.tsx"), "utf8");
    expect(REFERENCE).toContain('from "./DesktopHomeBoundary"');
    expect(boundary).toContain("Home works best on desktop");
    expect(boundary).toContain('window.matchMedia("(min-width: 1180px)")');
    expect(boundary).toContain("React.useState(true)");
    expect(REFERENCE).toContain("if (!isDesktop) return <DesktopHomeRequired />");
  });

  it("hands creation off to the first-class Create workspace without turning Home into it", () => {
    expect(REFERENCE).toContain("createWorkspaceReviewHref")
    expect(REFERENCE).toContain("CREATE_WORKSPACE_REVIEW_HREF")
    expect(REFERENCE).toContain("Continue creating")
    expect(REFERENCE).toContain("Create something new")
    expect(REFERENCE).toContain("Create this")
    expect(REFERENCE).toContain("CANVAS_REVIEW_HREF")
    expect(REFERENCE).not.toContain("CreationComposer")
    expect(REFERENCE).not.toContain("initialCreationOpen")
    expect(REFERENCE).not.toContain("Conversation history")
    expect(REFERENCE).not.toContain("CreationLab")
  });

  it("keeps Home review state in the URL and sends supported insight entries to one analysis surface", () => {
    expect(ROUTE).toContain("parseLayout");
    expect(ROUTE).toContain("HOME_GOALS");
    expect(REFERENCE).toContain("founderHomeReviewHref");
    expect(REFERENCE).toContain("homeAnalysisReviewHref");
    expect(REFERENCE).toContain('type: "performance-change"');
    expect(REFERENCE).toContain('type: "top-performer"');
    expect(REFERENCE).toContain('type: "data-health"');
    expect(REFERENCE).not.toContain("SHELL_ROUTES.campaign");
    expect(REFERENCE).not.toContain("SHELL_ROUTES.analytics");
  });

  it("keeps the review route thin and the visual/reference truth beside the pattern", () => {
    expect(ROUTE).toContain('from "@/design-system/patterns/founder-home/FounderHomeReference"');
    expect(fs.existsSync(path.join(PATTERN_ROOT, "selected-direction.png"))).toBe(true);
    expect(REFERENCES).toContain("mobbin.com/flows/99695c33-c6c9-4a93-98a8-e1b1b0d69bf4");
    expect(REFERENCES).toContain("mobbin.com/flows/78d62466-4a70-4725-8ae7-98258663e14f");
  });
});
