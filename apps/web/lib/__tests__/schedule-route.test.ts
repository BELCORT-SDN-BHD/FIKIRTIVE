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

    expect(SHELL_ROUTES.homeAnalysis).toBe("/analysis");
    expect(legacy).toContain("redirect(SHELL_ROUTES.homeAnalysis)");
    expect(canonical).toContain("<AnalyticsSurface");
    expect(canonical).toContain("requireOwner()");
  });

  it("does not wrap the public share page in the retired merchant tabs", () => {
    const layout = source("app/schedule/layout.tsx");
    const share = source("app/schedule/share-preview/page.tsx");

    expect(layout).not.toContain("ScheduleTabs");
    expect(layout).toContain("<>{children}</>");
    expect(share).not.toContain("redirect(SHELL_ROUTES.home)");
  });
});
