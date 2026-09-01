import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const WEB_ROOT = path.resolve(__dirname, "../..");
const analytics = readFileSync(path.join(WEB_ROOT, "components/otto/OttoAnalytics.tsx"), "utf8");
const perAd = readFileSync(path.join(WEB_ROOT, "components/otto/PerAdPerformance.tsx"), "utf8");

describe("Analytics 使用同一套 design system", () => {
  it("数据、状态与筛选都由 shadcn 组件承载", () => {
    for (const primitive of [
      "@/components/ui/badge",
      "@/components/ui/button",
      "@/components/ui/card",
      "@/components/ui/chart",
      "@/components/ui/empty",
      "@/components/ui/native-select",
    ]) {
      expect(analytics).toContain(primitive);
    }
    expect(perAd).toContain("@/components/ui/table");
  });

  it("不再复制 Otto 标志、不再手搓图表或裸交互", () => {
    expect(analytics).toContain("<OttoAvatar");
    expect(analytics).not.toContain("CoralCloud");
    expect(analytics).not.toMatch(/<svg\b/);
    expect(analytics).not.toMatch(/<(button|select)\b/);
    expect(perAd).not.toMatch(/<svg\b/);
  });

  it("页面颜色来自 token，而不是散落的十六进制字面量", () => {
    expect(analytics).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(perAd).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });

  it("权限未开放时不给用户一颗永远不能点击的按钮", () => {
    expect(analytics).toContain("Top posts need one more permission");
    expect(analytics).not.toContain("Learn more");
  });
});
