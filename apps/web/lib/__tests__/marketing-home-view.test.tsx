import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CustomizeHomePanel } from "@/components/home/CustomizeHomePanel";
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

/**
 * FRONT-A3 —— Meta 单源版面在浏览器里的那一半(Founder 2026-09-04 裁决)。
 *
 * 上面 `home-marketing-health.test.ts` 钉的是读模型算出什么;这一组钉的是商家看见什么、
 * 按下去去哪。五态各有一个**真动作**:连 Meta / 重新授权 / 原样重试 / 换 90 天 / 去管连接。
 * 没有一态摆的是点了没反应的按钮,也没有一态用 `0` 或 `—` 冒充结果。
 */
describe("FRONT-A3:Meta 单源版面的五态与它们各自的真动作", () => {
  const filters = {
    goal: "online-sales" as const,
    range: "30-days" as const,
    comparison: "previous-period" as const,
  };
  const recents = { ok: true as const, value: [] };

  function render(health: unknown, props: Record<string, unknown> = {}) {
    return renderToStaticMarkup(createElement(MarketingHomeView, {
      filters,
      recents,
      health,
      components: ["marketing-health"],
      offeredComponents: ["marketing-health"],
      recommendedComponents: ["marketing-health"],
      canManageHome: true,
      ...props,
    } as never));
  }

  const partial = {
    state: "partial",
    goal: "online-sales",
    period: "30-days",
    freshness: { status: "current", label: "Data through 2 Aug 2026", asOf: "2026-08-02" },
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
  };

  it("FRONT-A3:未连接 —— 说得出该连哪一行,按钮通向 Connections", () => {
    const markup = render({ state: "not-configured", goal: "online-sales", action: "connect" });
    expect(markup).toContain("Connect marketing data to see your health");
    // Codex 全 beta 审计 P1-011:旧文案没点名该连哪一行,商家在 Connections 页看到的是
    // Instagram / Facebook 两个社交渠道。它们走的就是 Home 读的那条 Meta 连接。
    expect(markup).toContain("Connect Instagram or Facebook in Connections");
    expect(markup).toContain('href="/settings/connections"');
    expect(markup).not.toMatch(/>0</);
  });

  it("FRONT-A3:token 过期／解不开 —— 说的是重新授权,不是「从头连一次」", () => {
    const markup = render({ state: "not-configured", goal: "online-sales", action: "reconnect" });
    expect(markup).toContain("Reconnect Meta ads to refresh Home");
    expect(markup).toContain('href="/settings/connections"');
    expect(markup).not.toContain("Connect marketing data to see your health");
  });

  it("FRONT-A3:读不出来 —— 与「真的没有数据」分开说,重试不动筛选", () => {
    const markup = render({ state: "unavailable", goal: "online-sales", retryable: true });
    expect(markup).toContain("Marketing data is temporarily unavailable");
    expect(markup).toContain("Retry");
    // 重试回到同一组筛选,不悄悄换成别的期间。
    expect(markup).toContain("goal=online-sales&amp;range=30-days&amp;comparison=previous-period");
    expect(markup).not.toContain("Not enough evidence yet");
  });

  it("FRONT-A3:已连接但零数据 —— 说得出为什么是零(没有投放),并给一个更宽的真期间", () => {
    const markup = render({
      state: "insufficient",
      goal: "online-sales",
      source: { id: "meta-ads", label: "Meta ads" },
    });
    expect(markup).toContain("Not enough evidence yet");
    expect(markup).toContain("reported no ad delivery in this period");
    expect(markup).toContain("Use last 90 days");
    expect(markup).toContain("range=90-days");
  });

  it("FRONT-A3:partial —— 真数据 + 数到哪一天 + 「只包含 Meta 广告」一句", () => {
    const markup = render(partial);
    expect(markup).toContain("Meta ads is reporting");
    expect(markup).toContain("Partial view");
    expect(markup).toContain("12,480");
    // 数到哪一天,由服务器算好传进来 —— 客户端不自己拿本地时钟编一个。
    expect(markup).toContain("Data through 2 Aug 2026");
    expect(markup).not.toContain("Freshness unavailable");
    expect(markup).toContain("This view only includes facts available from Meta ads.");
    // 单源之下这些都是编的,一个都不许出现。
    expect(markup).not.toContain("ROAS");
    expect(markup).not.toContain("Top performers");
    expect(markup).not.toContain("Channel contribution");
    expect(markup).not.toContain("Recommended next action");
  });

  it("FRONT-A3:没有生产者的组件即使混进版面也画不出东西(变异闸)", () => {
    // 服务端的 `resolveHomeComponents` 早就把它们过滤掉了(home-layout.ts)。这一条是第二道:
    // 就算有人把它们塞回版面,渲染层也拿不出一张卡来 —— 因为它们根本没有数据可画。
    // 把 `HomeComponentBlock` 改成为它们画点什么,这条就红。
    const markup = render(partial, {
      components: ["marketing-health", "efficiency", "what-changed", "top-performers", "recommended-action", "channel-contribution", "waiting-approval", "publishing-next"],
    });
    expect(markup).toContain("Meta ads is reporting");
    for (const designOnly of [
      "Efficiency",
      "What changed",
      "Top performers",
      "Recommended next action",
      "Channel contribution",
      "Waiting for approval",
      "Publishing next",
    ]) {
      expect(markup, `${designOnly} 没有生产者,却画出来了`).not.toContain(designOnly);
    }
  });

  it("FRONT-A3:Customize 面板只列得出有生产者的那一块,别的连勾选格都没有", () => {
    // 面板列什么由服务端的 `availableHomeComponents()` 决定(offeredComponents 传进来的那一串)。
    // 摆一格点了没反应的勾选,就是一个假控件(Founder 2026-09-03 裁决九)。
    const panel = renderToStaticMarkup(createElement(CustomizeHomePanel, {
      selected: ["marketing-health"],
      offered: ["marketing-health"],
      saving: false,
      onToggle: () => {},
      onMove: () => {},
      onReorder: () => {},
      onCancel: () => {},
      onReset: () => {},
      onSave: () => {},
    } as never));
    expect(panel).toContain("Marketing health");
    for (const designOnly of [
      "Efficiency",
      "What changed",
      "Top performers",
      "Recommended next action",
      "Channel contribution",
      "Waiting for approval",
      "Publishing next",
    ]) {
      expect(panel, `${designOnly} 没有生产者,却在面板里可以勾`).not.toContain(designOnly);
    }
  });
});
