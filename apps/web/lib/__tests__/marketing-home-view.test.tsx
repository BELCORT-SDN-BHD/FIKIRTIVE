import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MarketingHomeView } from "@/components/home/MarketingHomeView";
import { buildHomeDashboardFixture } from "@/design-system/patterns/founder-home/fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("production Marketing Home", () => {
  const filters = {
    goal: "online-sales" as const,
    range: "30-days" as const,
    comparison: "previous-period" as const,
  };
  const recents = { ok: true as const, value: [] };
  // 版面由服务端算好传进来(lib/home-layout.ts)。今天唯一有真实生产者的一块。
  const components = ["marketing-health"] as const;

  function renderHealth(health: unknown) {
    return renderToStaticMarkup(createElement(MarketingHomeView, {
      filters,
      recents,
      health,
      components,
      offeredComponents: components,
      recommendedComponents: components,
      canManageHome: true,
    } as never));
  }

  it("shows Meta as partial evidence without presenting fixture-only business outcomes", () => {
    const markup = renderToStaticMarkup(createElement(MarketingHomeView, {
      filters: {
        goal: "online-sales",
        range: "30-days",
        comparison: "previous-period",
      },
      recents: {
        ok: true,
        value: [{ id: "canvas-1", name: "Merdeka launch", updatedLabel: "31 Aug 2026" }],
      },
      health: {
        state: "partial",
        goal: "online-sales",
        period: "30-days",
        freshness: { status: "unknown", label: "Freshness unavailable" },
        evidenceStrength: "limited",
        source: { id: "meta-ads", label: "Meta ads" },
        metrics: [
          {
            label: "Reach",
            values: [{ text: "12,480", currency: null, accountName: null }],
            delta: { dir: "up", text: "▲ 8.2%" },
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
      },
      components,
      offeredComponents: components,
      recommendedComponents: components,
      canManageHome: true,
    } as never));

    expect(markup).toContain("Meta ads is reporting");
    expect(markup).toContain("Partial view");
    expect(markup).toContain("Merdeka launch");
    expect(markup).not.toContain("RM 18,420");
    expect(markup).not.toContain("ROAS");
    expect(markup).not.toContain("Top performers");
    expect(markup).not.toContain("Channel contribution");
  });

  it("offers a real setup action when marketing data is not configured", () => {
    const markup = renderHealth({ state: "not-configured", goal: "online-sales", action: "connect" });
    expect(markup).toContain("Connect marketing data to see your health");
    expect(markup).toContain("Manage connections");
    expect(markup).not.toMatch(/>0</);
  });

  it("keeps reconnect separate from first-time setup", () => {
    const markup = renderHealth({ state: "not-configured", goal: "online-sales", action: "reconnect" });
    expect(markup).toContain("Reconnect Meta ads to refresh Home");
    expect(markup).toContain("Reconnect Meta ads");
  });

  it("offers a wider real period when connected data is insufficient", () => {
    const markup = renderHealth({
      state: "insufficient",
      goal: "online-sales",
      source: { id: "meta-ads", label: "Meta ads" },
    });
    expect(markup).toContain("Not enough evidence yet");
    expect(markup).toContain("Use last 90 days");
    expect(markup).toContain("range=90-days");
  });

  it("offers an in-place retry when the source is unavailable", () => {
    const markup = renderHealth({ state: "unavailable", goal: "online-sales", retryable: true });
    expect(markup).toContain("Marketing data is temporarily unavailable");
    expect(markup).toContain("Retry");
    expect(markup).toContain("goal=online-sales");
  });

  it("keeps the future aggregate ready state distinct", () => {
    const markup = renderHealth({
      state: "ready",
      goal: "online-sales",
      period: "30-days",
      freshness: { status: "current", label: "Updated 12 min ago", asOf: "2026-08-31T15:00:00Z" },
      evidenceStrength: "complete",
      sources: [{ id: "meta-ads", label: "Meta ads" }],
      snapshot: buildHomeDashboardFixture("online-sales", "30-days", "previous-period"),
    });
    expect(markup).toContain("Marketing is growing efficiently");
    expect(markup).toContain("RM 18,420");
    expect(markup).toContain("ROAS");
    expect(markup).toContain("What changed");
    expect(markup).toContain("Top performers");
    expect(markup).toContain("Recommended next action");
    expect(markup).toContain("Channel contribution");
    expect(markup).not.toContain("Partial view");
  });
});

/**
 * Customize home 的入口与版面驱动(验收 FRONT-A4)。
 *
 * 这一层钉的是「客户端只渲染」那半句:页面上有哪几块由服务端传进来的 `components` 决定,
 * 视图自己不再判断;入口出不出现由能力决定,不由角色名决定。
 */
describe("FRONT-A4:Customize home 入口与版面驱动", () => {
  const filters = {
    goal: "online-sales" as const,
    range: "30-days" as const,
    comparison: "previous-period" as const,
  };
  const recents = { ok: true as const, value: [] };
  const partialHealth = {
    state: "partial",
    goal: "online-sales",
    period: "30-days",
    freshness: { status: "unknown", label: "Freshness unavailable" },
    evidenceStrength: "limited",
    source: { id: "meta-ads", label: "Meta ads" },
    metrics: [],
    chart: null,
    insight: null,
  };

  function render(props: Record<string, unknown>) {
    return renderToStaticMarkup(createElement(MarketingHomeView, {
      filters,
      recents,
      health: partialHealth,
      components: ["marketing-health"],
      offeredComponents: ["marketing-health"],
      recommendedComponents: ["marketing-health"],
      canManageHome: true,
      ...props,
    } as never));
  }

  it("FRONT-A4:有 Manage home 能力时入口出现", () => {
    expect(render({})).toContain("Customize home");
  });

  it("FRONT-A4:没有 Manage home 能力的成员看不到入口", () => {
    expect(render({ canManageHome: false })).not.toContain("Customize home");
  });

  it("FRONT-A4:服务端说这一块不在版面里,页面上就没有它", () => {
    const markup = render({ components: [] });
    expect(markup).not.toContain("Meta ads is reporting");
    // 空版面画的是设计里那句邀请,不是一片什么都没有的白。
    expect(markup).toContain("Choose what belongs on Home");
  });

  it("FRONT-A4:每一块都带上自己的 id,版面顺序在 DOM 里看得见", () => {
    expect(render({})).toContain('data-home-component="marketing-health"');
  });
});
