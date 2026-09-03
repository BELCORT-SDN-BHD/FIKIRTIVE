import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function sourceOf(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PRODUCTION_HOME_FAMILY = [
  "app/(home)/page.tsx",
  "components/home/HomeEntry.tsx",
  "components/home/MarketingHomeView.tsx",
  "components/home/marketing-home-copy.ts",
  "lib/home-marketing-health.ts",
] as const;

const PRODUCTION_ANALYSIS_FAMILY = [
  "app/analysis/page.tsx",
  "components/home/HomeAnalysisEntry.tsx",
  "components/home/HomeAnalysisView.tsx",
  "lib/home-analysis-context.ts",
  "lib/home-marketing-health.ts",
] as const;

describe("Home Phase 2 production boundary", () => {
  it("keeps the frozen production files present", () => {
    for (const file of [...PRODUCTION_HOME_FAMILY, ...PRODUCTION_ANALYSIS_FAMILY]) {
      expect(existsSync(path.join(WEB_ROOT, file)), `${file} is missing`).toBe(true);
    }
  });

  it("never imports review fixtures, fixture builders, or review-only route helpers", () => {
    for (const file of [...new Set([...PRODUCTION_HOME_FAMILY, ...PRODUCTION_ANALYSIS_FAMILY])]) {
      const source = sourceOf(file);
      expect(source, file).not.toContain("fixtures");
      expect(source, file).not.toContain("buildHomeDashboardFixture");
      expect(source, file).not.toContain("buildHomeAnalysisFixture");
      expect(source, file).not.toContain("review-links");
      expect(source, file).not.toContain("ProductPatternShellFrame");
    }
  });

  it("uses the real Meta adapter only as one source of the shared marketing-health model", () => {
    const entry = sourceOf("components/home/HomeEntry.tsx");
    const model = sourceOf("lib/home-marketing-health.ts");

    expect(entry).toContain("getAnalytics");
    expect(entry).toContain("marketingHealthFromAnalytics");
    expect(model).toContain('state: "partial"');
    expect(model).toContain('id: "meta-ads"');
    expect(model).not.toContain("revenue");
    expect(model).not.toContain("roas");
    expect(model).not.toContain("topPerformers");
    expect(model).not.toContain("channelContribution");
  });

  it("keeps only the compact real Canvas handoff from the previous Home", () => {
    const entry = sourceOf("components/home/HomeEntry.tsx");
    const view = sourceOf("components/home/MarketingHomeView.tsx");

    expect(entry).toContain("getProjects");
    expect(entry).not.toContain("getRecentGenerationThumbs");
    expect(entry).not.toContain("listScheduledPosts");
    expect(entry).not.toContain("listMemory");
    expect(entry).not.toContain("listBrandRecords");
    expect(entry).not.toContain("getMyAccount");
    expect(view).not.toContain("StartSomething");
    expect(view).not.toContain("Get Otto ready");
    expect(view).not.toContain("What goes out next");
  });

  /**
   * FRONT-A4 之前这条禁的是「Home saved」这句话本身 —— 那时候版面没有落库,说出这句话
   * 就是拿一个 toast 冒充持久化。现在版面**真的**落库了(lib/home-layout-actions.ts),
   * 所以禁的对象要跟着变:不再禁那句话,而是禁**说这句话的资格从哪来**。
   * 浏览器存储仍然一个字都不许出现,而「保存成功」这句话必须站在那一次服务端写入之后。
   */
  it("FRONT-A4: does not fake workspace persistence with browser storage", () => {
    const view = sourceOf("components/home/MarketingHomeView.tsx");
    expect(view).not.toContain("localStorage");
    expect(view).not.toContain("sessionStorage");
    // 版面的写入只有一条路:那个 server action。
    expect(view).toContain('from "@/lib/home-layout-actions"');
    expect(view).toContain("await saveHomeLayout");
    // 而「保存成功」只在那条路返回成功之后才说得出口。
    const save = view.slice(view.indexOf("function saveDraft"));
    expect(save.indexOf('"error" in result'), "先判失败再说成功").toBeLessThan(
      save.indexOf('toast.success("Home saved")'),
    );
  });

  /**
   * 版面定义单源(规格 §7.3⑤「一份版面定义单源,客户端只渲染」)。视图不许自己去
   * 推荐模板里取版面 —— 那样服务端算一份、客户端算一份,两份迟早会不一样,而不一样的
   * 那一天商家看到的是哪一份,没人说得清。
   */
  it("FRONT-A4: the client renders the server's layout instead of computing its own", () => {
    const view = sourceOf("components/home/MarketingHomeView.tsx");
    expect(view).not.toContain("recommendedHome(");
    expect(view).not.toContain("createHomeLayouts");
    expect(view).not.toContain("HOME_TEMPLATES");
    const entry = sourceOf("components/home/HomeEntry.tsx");
    expect(entry).toContain("resolveHomeComponents");
    expect(entry).toContain("readHomeLayout");
  });
});

describe("Home analysis production boundary", () => {
  it("replaces the old Analytics surface with the Home-owned template", () => {
    const route = sourceOf("app/analysis/page.tsx");
    expect(route).toContain("HomeAnalysisEntry");
    expect(route).toContain("parseHomeAnalysisContext");
    expect(route).not.toContain("AnalyticsSurface");
    expect(route).not.toContain("OttoAnalytics");
  });

  it("accepts only typed analysis identifiers and canonical filter registries", () => {
    const context = sourceOf("lib/home-analysis-context.ts");
    expect(context).toContain("HOME_ANALYSIS_TYPES");
    expect(context).toContain("HOME_ANALYSIS_SUBJECTS");
    expect(context).toContain("parseHomeSearchState");
    expect(context).not.toMatch(/search\.(title|value|conclusion)/);
  });
});
