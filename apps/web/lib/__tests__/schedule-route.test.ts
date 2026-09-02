import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("Schedule is parked in the Beta", () => {
  it("keeps legacy route files so old bookmarks do not 404", () => {
    expect(existsSync(path.join(WEB_ROOT, "app/schedule/page.tsx"))).toBe(true);
    expect(existsSync(path.join(WEB_ROOT, "app/schedule/analytics/page.tsx"))).toBe(true);
  });

  it("sends the merchant Schedule surface to Home through the route SSOT", () => {
    const route = source("app/schedule/page.tsx");
    expect(route).toContain("redirect(SHELL_ROUTES.home)");
    expect(route).toContain("@fikirtive/core/navigation");
  });

  it("re-owns legacy analytics under Home analysis", () => {
    const legacy = source("app/schedule/analytics/page.tsx");
    const canonical = source("app/analysis/page.tsx");
    // Home Phase 2 换掉了 `/analysis` 的实现:页面本身不再直接挂 `<AnalyticsSurface>`,
    // 而是渲染 `HomeAnalysisEntry`,登录闸 `requireOwner()` 跟着搬进那个组件。
    // 这一条钉的两件事没变 —— 旧地址转到 `/analysis`,而 `/analysis` 是**登录后才看得到的
    // 真分析页** —— 只是跟着多了一层间接。所以断言跟着走一层,不是放松。
    const entry = source("components/home/HomeAnalysisEntry.tsx");

    expect(SHELL_ROUTES.homeAnalysis).toBe("/analysis");
    expect(legacy).toContain("redirect(SHELL_ROUTES.homeAnalysis)");
    expect(canonical).toContain("<HomeAnalysisEntry");
    expect(entry).toContain("requireOwner()");
  });

  it("does not wrap the public share page in the retired merchant tabs", () => {
    const layout = source("app/schedule/layout.tsx");
    const share = source("app/schedule/share-preview/page.tsx");

    expect(layout).not.toContain("ScheduleTabs");
    expect(layout).toContain("<>{children}</>");
    expect(share).not.toContain("redirect(SHELL_ROUTES.home)");
  });
});
