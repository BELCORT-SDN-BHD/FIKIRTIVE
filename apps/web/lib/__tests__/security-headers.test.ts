/**
 * #795 —— 安全响应头的围栏。
 *
 * 这个产品每一个花钱动作、每一个删除动作都是「登录后一次点击」。只要我们可以被 iframe 装
 * 进别人的页面,攻击者就能拿到商家自己那一次真实点击 —— 不需要 XSS,不需要偷 token,只
 * 需要我们没说「不许装」。所以这里钉的不是「配置里有一行」,而是「那一行说的是什么」。
 *
 * 之所以能测,是因为规则被搬出了 next.config.ts:配置文件 vitest 载不进来(要拉 Next 自
 * 己的类型与运行时),写在里面的 headers() 就是一个没人能核的承诺。
 */
import { describe, it, expect } from "vitest";
import {
  securityHeaderRules,
  CSP_ENFORCED,
  CSP_REPORT_ONLY,
  HSTS,
  REFERRER_POLICY_SOURCE,
} from "@/lib/security-headers";

function headerMap(rules: ReturnType<typeof securityHeaderRules>, source: string): Map<string, string> {
  const rule = rules.find((r) => r.source === source);
  return new Map((rule?.headers ?? []).map((h) => [h.key, h.value]));
}

const prod = () => securityHeaderRules({ production: true });
const dev = () => securityHeaderRules({ production: false });

describe("#795 安全响应头", () => {
  it("全站禁止被嵌:frame-ancestors 'none' 是**强制**的,不是 report-only", () => {
    const headers = headerMap(prod(), "/:path*");
    expect(headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(CSP_ENFORCED).toContain("frame-ancestors 'none'");
    // report-only 里的 frame-ancestors 按 CSP 规范会被浏览器忽略 —— 只有强制策略算数。
    expect(headers.get("Content-Security-Policy-Report-Only")).not.toBe(headers.get("Content-Security-Policy"));
  });

  it("老浏览器/内嵌 webview 也堵上:X-Frame-Options: DENY", () => {
    expect(headerMap(prod(), "/:path*").get("X-Frame-Options")).toBe("DENY");
  });

  it("禁止内容类型猜测:nosniff", () => {
    expect(headerMap(prod(), "/:path*").get("X-Content-Type-Options")).toBe("nosniff");
    expect(headerMap(dev(), "/:path*").get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("Referrer 不外泄整条 URL(我们的 URL 带 project/campaign/thread id)", () => {
    expect(headerMap(prod(), REFERRER_POLICY_SOURCE).get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("Referrer 规则绕开媒体代理 —— 那条路自己声明的 no-referrer 更严,站级规则不许把它放松", () => {
    expect(REFERRER_POLICY_SOURCE).toContain("api/media/pub/");
    // 站级规则不许覆盖到媒体代理:用 Next 自己的 path-to-regexp 形状做一次真实匹配核对。
    const asRegex = new RegExp(`^${REFERRER_POLICY_SOURCE.replace(/^\//u, "/")}$`, "u");
    expect(asRegex.test("/api/media/pub/abc.def")).toBe(false);
    expect(asRegex.test("/campaign")).toBe(true);
    expect(asRegex.test("/api/otto/stream")).toBe(true);
  });

  it("HSTS 只在生产发 —— 它是浏览器会记两年的承诺,不该从本机 https 调试台发出去", () => {
    expect(headerMap(prod(), "/:path*").get("Strict-Transport-Security")).toBe(HSTS);
    expect(headerMap(dev(), "/:path*").has("Strict-Transport-Security")).toBe(false);
  });

  it("HSTS 不认领 preload:上预加载名单近乎不可逆,是 Founder 的决定不是一次代码改动", () => {
    expect(HSTS).not.toContain("preload");
    expect(HSTS).toContain("includeSubDomains");
  });

  it("CSP 目标策略先 report-only,且已经堵住三条不需要观察期的路", () => {
    const headers = headerMap(prod(), "/:path*");
    const reportOnly = headers.get("Content-Security-Policy-Report-Only") ?? "";
    expect(reportOnly).toBe(CSP_REPORT_ONLY);
    // object-src/base-uri/form-action:这三条不影响正常页面加载,但各堵一类注入。
    expect(reportOnly).toContain("object-src 'none'");
    expect(reportOnly).toContain("base-uri 'self'");
    expect(reportOnly).toContain("form-action 'self'");
  });

  it("报告策略不带 report-uri —— 没有收集端就不假装有(浏览器 console 仍会报)", () => {
    expect(CSP_REPORT_ONLY).not.toContain("report-uri");
    expect(CSP_REPORT_ONLY).not.toContain("report-to");
  });
});
