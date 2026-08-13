/**
 * Analytics 只留一个平台(#792,Founder 裁决 2026-08-08)。
 *
 * 折叠前:一个下拉框列着五个平台,其中四个标 "(soon)",选中任何一个都只得到一张
 * 「coming soon」卡片。四个格子后面没有适配器、没有数据、也没有工期 —— 一个选得动的
 * 选择器是在替产品许愿。裁决:收起来,只留真的读得到数的那一个。
 *
 * 这份围栏钉两件事:注册表里只剩一个名字;屏幕上没有第二个平台可选。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ANALYTICS_PLATFORM_LABEL } from "@/lib/analytics-platforms";

const WEB_ROOT = path.resolve(__dirname, "../..");

/** 注释里记着从前有过什么,不算屏幕上还有什么。 */
function screenSource(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("Analytics 读的平台", () => {
  it("只有一个名字,而且它就是真的读得到数的那一个", () => {
    expect(ANALYTICS_PLATFORM_LABEL).toBe("Meta (IG + FB)");
  });
});

describe("Analytics 屏幕上没有第二个平台", () => {
  const screen = screenSource("components/otto/OttoAnalytics.tsx");

  it("平台选择器不在了 —— 一个选不出东西的选择不是选择", () => {
    expect(screen).not.toContain('aria-label="Platform"');
  });

  it("四个 soon 平台一个都不出现在屏幕上", () => {
    for (const gone of ["TikTok", "Shopee", "Google", "WhatsApp"]) {
      expect(screen, `${gone} 还在 Analytics 上`).not.toContain(gone);
    }
  });

  it("也不再说 coming soon", () => {
    expect(screen).not.toMatch(/coming soon/i);
  });

  it("平台名字从权威源读,页面自己不手写", () => {
    expect(screen).toContain("ANALYTICS_PLATFORM_LABEL");
    expect(screen).not.toContain('"Meta (IG + FB)"');
  });

  it("日期范围那个选择器留着 —— 它每一项都真的换得出数", () => {
    expect(screen).toContain('aria-label="Date range"');
  });
});
