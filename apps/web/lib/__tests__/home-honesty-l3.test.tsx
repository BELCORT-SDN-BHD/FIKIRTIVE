// @vitest-environment jsdom

/**
 * Home / Analysis 的四件「诚实收口」围栏(接线盘点 L3)。
 *
 * 四件事各自钉一条真行为,不是钉一句文案:
 *   ① Retry **真重取** —— 按下去调 `router.refresh()`(服务器重跑这一页的 RSC,
 *      `HomeEntry` 因此重新 `getAnalytics()`)。以前它是一条指回同一个地址的链接,
 *      重取靠 Next 对 same-page 导航的特判 —— 框架行为,不是我们的保证,而且没有测试
 *      守着(判官 2026-09-05 P2-1)。这里真按一下,断言 refresh 被调用。
 *   ② Comparison 下拉在 partial 版面**不出现** —— partial 单源之下没有任何东西消费它
 *      (读只按 `range` 走),摆着就是一颗点了没反应的控件(Founder 2026-09-03 裁决九)。
 *   ③ 新鲜度**只在有真时间戳时**显示 —— `unknown` 时不摆「Freshness unavailable」。
 *   ④ Analysis 顶栏那一栏**不再写死**「Live source data」 —— 逐字来自读模型。
 *
 * 这一份用 jsdom 真挂载、真点击,所以「把按钮换回链接」「把 onClick 拿掉」都当场红;
 * 纯字符串渲染看不出这两种回退。
 */

import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeAnalysisView } from "@/components/home/HomeAnalysisView";
import { MarketingHomeView } from "@/components/home/MarketingHomeView";
import { buildHomeDashboardFixture } from "@/design-system/patterns/founder-home/fixtures";

const refresh = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
  // `useDesktopHome()` 读 matchMedia;jsdom 没有它。Home 只在桌面渲染,所以这里说 true。
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

const filters = {
  goal: "online-sales" as const,
  range: "30-days" as const,
  comparison: "previous-period" as const,
};

const partialHealth = {
  state: "partial",
  goal: "online-sales",
  period: "30-days",
  freshness: { status: "known", label: "Data through 2 Aug 2026", asOf: "2026-08-02" },
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

const analysisContext = {
  type: "performance-change" as const,
  subject: "meta-ads-overview",
  goal: "online-sales" as const,
  range: "30-days" as const,
  comparison: "previous-period" as const,
  originRange: "30-days" as const,
  originComparison: "previous-period" as const,
  returnFocus: "marketing-health-heading",
};

/** 读模型是服务端算好传进来的,测试直接摆一份 —— 与既有 Home 测试同一套写法。 */
function renderHome(health: unknown, props: Record<string, unknown> = {}): Promise<void> {
  const homeProps = {
    filters,
    recents: { ok: true, value: [] },
    health,
    components: ["marketing-health"],
    offeredComponents: ["marketing-health"],
    recommendedComponents: ["marketing-health"],
    canManageHome: true,
    ...props,
  } as unknown as ComponentProps<typeof MarketingHomeView>;
  return render(<MarketingHomeView {...homeProps} />);
}

function renderAnalysis(health: unknown): Promise<void> {
  const analysisProps = {
    context: analysisContext,
    health,
  } as unknown as ComponentProps<typeof HomeAnalysisView>;
  return render(<HomeAnalysisView {...analysisProps} />);
}

describe("FRONT-A3:Home 的 Retry 是一次真重取,不是一条指回原地的链接", () => {
  it("FRONT-A3:Home 读不出来时 Retry 是一颗按钮,按下去真的让服务器重读", async () => {
    await renderHome({ state: "unavailable", goal: "online-sales", retryable: true });

    const retry = buttonLabelled("Retry");
    expect(retry, "Retry 不是一颗按钮 —— 换回链接就没有重取保证了").toBeTruthy();
    expect(retry!.getAttribute("type")).toBe("button");
    // 它不能同时还是一条链接:一条 href 指回同一个地址,靠的是框架行为,不是我们的保证。
    expect(
      Array.from(document.body.querySelectorAll("a")).some((anchor) =>
        (anchor.textContent ?? "").trim() === "Retry",
      ),
      "Retry 又变回链接了",
    ).toBe(false);

    expect(refresh).not.toHaveBeenCalled();
    await click(retry!);
    expect(refresh, "按下 Retry 没有触发服务器重读").toHaveBeenCalledTimes(1);
  });

  it("FRONT-A3:Analysis 读不出来时 Retry analysis 同样是真重取", async () => {
    await renderAnalysis({ state: "unavailable", goal: "online-sales", retryable: true });

    const retry = buttonLabelled("Retry analysis");
    expect(retry, "Retry analysis 不是一颗按钮").toBeTruthy();
    await click(retry!);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("FRONT-A3:去别处的恢复动作仍然是真链接,没有被一起改成按钮", async () => {
    await renderHome({ state: "not-configured", goal: "online-sales", action: "connect" });

    const connect = Array.from(document.body.querySelectorAll("a")).find(
      (anchor) => (anchor.textContent ?? "").trim() === "Manage connections",
    );
    expect(connect?.getAttribute("href")).toBe("/settings/connections");
    expect(buttonLabelled("Manage connections")).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("FRONT-A3:Comparison 在没有消费者的版面不出现(裁决九)", () => {
  /** 筛选器的可及名在 `aria-label` 上(`HomeFilterPicker` 把 label 挂在 SelectTrigger)。 */
  function filterControl(label: string): Element | undefined {
    return Array.from(document.body.querySelectorAll("[aria-label]")).find(
      (node) => node.getAttribute("aria-label") === label,
    );
  }
  const comparisonControl = () => filterControl("Comparison");

  it("FRONT-A3:partial 单源 Home 上没有 Comparison 控件", async () => {
    await renderHome(partialHealth);
    // 真数据确实画出来了 —— 这一条不是靠「什么都没渲染」蒙混过关的。
    expect(document.body.textContent).toContain("Meta ads is reporting");
    expect(comparisonControl(), "partial 版面画出了没人消费的 Comparison").toBeUndefined();
    // 有真消费者的两个筛选照旧在:goal 决定推荐版面,range 决定去 Meta 读哪一段。
    expect(filterControl("Business goal")).toBeTruthy();
    expect(filterControl("Date range")).toBeTruthy();
  });

  it("FRONT-A3:五个恢复态上也没有 Comparison 控件", async () => {
    for (const health of [
      { state: "not-configured", goal: "online-sales", action: "connect" },
      { state: "not-configured", goal: "online-sales", action: "reconnect" },
      { state: "not-configured", goal: "online-sales", action: "connect-ad-account" },
      { state: "insufficient", goal: "online-sales", source: { id: "meta-ads", label: "Meta ads" } },
      { state: "unavailable", goal: "online-sales", retryable: true },
    ]) {
      await renderHome(health);
      expect(comparisonControl(), `${health.state} 态画出了 Comparison`).toBeUndefined();
      if (root) await act(async () => root?.unmount());
      container?.remove();
      root = null;
      container = null;
    }
  });

  it("FRONT-A3:多来源 ready 版面接上时 Comparison 回来 —— 那时它有真消费者", async () => {
    await renderHome({
      state: "ready",
      goal: "online-sales",
      period: "30-days",
      freshness: { status: "known", label: "Data through 2 Aug 2026", asOf: "2026-08-02" },
      evidenceStrength: "complete",
      sources: [{ id: "meta-ads", label: "Meta ads" }],
      snapshot: buildHomeDashboardFixture("online-sales", "30-days", "previous-period"),
    });
    expect(comparisonControl(), "ready 版面反而丢了 Comparison").toBeTruthy();
  });

  it("FRONT-A3:partial 分析页上也没有 Comparison 控件", async () => {
    await renderAnalysis(partialHealth);
    expect(document.body.textContent).toContain("Meta ads changed during this period");
    expect(comparisonControl(), "partial 分析页画出了没人消费的 Comparison").toBeUndefined();
    expect(filterControl("Date range")).toBeTruthy();
  });
});

describe("FRONT-A3:新鲜度只在有真时间戳时说", () => {
  it("FRONT-A3:有日序列时 Home 说得出数到哪一天", async () => {
    await renderHome(partialHealth);
    expect(document.body.textContent).toContain("Meta ads · Data through 2 Aug 2026");
  });

  it("FRONT-A3:拿不到日序列时 Home 只说来源,不摆一句没有内容的新鲜度", async () => {
    await renderHome({
      ...partialHealth,
      freshness: { status: "unknown", label: "Freshness unavailable" },
      chart: null,
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Meta ads");
    expect(text, "没有真时间戳,却还摆着一栏新鲜度").not.toContain("Freshness unavailable");
    expect(text).not.toContain("Meta ads ·");
  });

  it("FRONT-A3:分析页的 limited coverage 句子在没有时间戳时不硬贴一句", async () => {
    await renderAnalysis({
      ...partialHealth,
      freshness: { status: "unknown", label: "Freshness unavailable" },
      chart: null,
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("It does not claim revenue impact or cross-channel attribution.");
    expect(text).not.toContain("Freshness unavailable");
  });
});

describe("FRONT-A12:Analysis 顶栏的来源栏逐字来自读模型,不写死", () => {
  it("FRONT-A12:partial 时说的是谁报的、数到哪一天,而不是一句「Live source data」", async () => {
    await renderAnalysis(partialHealth);
    const text = document.body.textContent ?? "";
    expect(text, "「Live」是一句没人验过的新鲜度断言").not.toContain("Live source data");
    expect(text).toContain("Meta ads · Data through 2 Aug 2026");
  });

  it("FRONT-A12:来源标签换一个,顶栏跟着换 —— 证明它真的读了模型(变异闸)", async () => {
    await renderAnalysis({
      ...partialHealth,
      source: { id: "meta-ads", label: "Meta ads sandbox" },
    });
    expect(document.body.textContent).toContain("Meta ads sandbox · Data through 2 Aug 2026");
  });

  it("FRONT-A12:没有时间戳时顶栏只报来源,不补一个编出来的时间", async () => {
    await renderAnalysis({
      ...partialHealth,
      freshness: { status: "unknown", label: "Freshness unavailable" },
      chart: null,
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Meta ads");
    expect(text).not.toContain("Live source data");
    expect(text).not.toContain("Freshness unavailable");
  });

  it("FRONT-A12:读不出来时这一栏整个不出现 —— 那一刻没有任何来源在报", async () => {
    await renderAnalysis({ state: "unavailable", goal: "online-sales", retryable: true });
    expect(document.body.textContent).not.toContain("Live source data");
    expect(document.body.textContent).toContain("We couldn't refresh this analysis");
  });
});
