// @vitest-environment jsdom
/**
 * `components/global-navigation.tsx`(W2-11,规格书 §5.1、§5.3)。
 *
 * 这个文件从 #801/#992 那一代起就画过一整棵导航树;那棵树连同它的三层响应式形态、
 * `<details>` 手搓的分组与身份菜单、`SectionTabs` 页签兜底,已随本票整个删除
 * (`docs/specs/wave2-shell.md` §5.1)。今天的 `global-navigation.tsx` 不再画任何一格 ——
 * 画法在 `components/navigation/rail/NavigationRail.tsx`,已经被 `nav-rail.test.ts`(渲染、
 * 高亮、折叠、真菜单)与 `nav-rail-tree.test.ts`(高亮规则本身)逐条钉过。这个文件剩下的
 * 职责只有三件,也是这里唯一还测的三件:
 *
 *  ① `isMerchantSurface` —— 哪些地址算「商家表面」,派生自权威源,不是手抄的名单。
 *  ② `MerchantShellContent` —— 商家表面画壳、非商家表面原样透出内容,不多管导轨怎么画。
 *  ③ 印证横幅(`ImpersonationBanner`)仍然叠在壳之上。
 *
 * 「utility bar 的 Ask Otto 拨的是同一个开关」这条 Application shell 接线,钉在
 * `otto-panel-mount.test.ts`(它已经有完整的面板挂载测试台,不在这里重复搭一遍)。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { APPLICATION_SHELL_CARVE_OUTS, NAVIGATION_OWNED_SURFACES, SHELL_ROUTES, everyNavDestination, merchantNavLinks } from "@fikirtive/core/navigation";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { MerchantShellContent, isMerchantSurface, shellTopBarLabel } from "@/components/global-navigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/tenant-actions", () => ({
  stopImpersonatingTenant: vi.fn(),
}));

// 静态渲染不会跑 useEffect,所以这个模块实际上一次都不会被调用 —— 挡住它只是为了不让
// import 链带出一个真的 "use server" 动作文件。
vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));

function renderShell(pathname: string) {
  return renderToStaticMarkup(
    createElement(
      MerchantShellContent,
      { pathname, signOutAction: vi.fn(async () => undefined) },
      createElement("div", null, "Page content"),
    ),
  );
}

describe("isMerchantSurface —— 从权威源推出来,不是手抄的名单 (W2-11)", () => {
  it("权威源里的每一条非 carve-out 目的地都是商家表面", () => {
    for (const link of everyNavDestination()) {
      if (APPLICATION_SHELL_CARVE_OUTS.includes(link.href as (typeof APPLICATION_SHELL_CARVE_OUTS)[number])) continue;
      expect(isMerchantSurface(link.href), link.href).toBe(true);
    }
  });

  it("/profile 是商家表面 —— 它是身份菜单进得去的一页,只是不占导航格", () => {
    expect(isMerchantSurface(SHELL_ROUTES.profile)).toBe(true);
    expect(merchantNavLinks().some((link) => link.href === SHELL_ROUTES.profile)).toBe(false);
  });

  it("approved child surface 跟着 owner,Canvas 与 public share 保持 standalone", () => {
    expect(isMerchantSurface(SHELL_ROUTES.homeAnalysis)).toBe(true);
    expect(isMerchantSurface(SHELL_ROUTES.connections)).toBe(true);
    expect(isMerchantSurface(SHELL_ROUTES.billing)).toBe(true);
    expect(isMerchantSurface(SHELL_ROUTES.canvas)).toBe(false);
    expect(isMerchantSurface(SHELL_ROUTES.publicSharePreview)).toBe(false);
    expect(isMerchantSurface(SHELL_ROUTES.edit)).toBe(false);
  });

  it.each(["/login", "/admin", "/admin/tenants", "/crm", "/crm/reports/report-1", "/campaign", "/campaign/workbench", "/schedule"])(
    "%s 不是商家表面",
    (pathname) => {
      expect(isMerchantSurface(pathname)).toBe(false);
    },
  );
});

describe("MerchantShellContent —— 只管这一面要不要壳", () => {
  it("在商家表面画出导轨,商家自己的内容原样透出", () => {
    const markup = renderShell(SHELL_ROUTES.home);

    expect(markup).toContain('aria-label="Global navigation"');
    expect(markup).toContain(`href="${SHELL_ROUTES.home}"`);
    expect(markup).toContain(`href="${SHELL_ROUTES.billing}"`);
    expect(markup).toContain("data-merchant-shell-frame");
    expect(markup).toContain("data-merchant-topbar");
    expect(markup).toContain("Page content");
  });

  it.each(["/login", "/admin", "/admin/tenants"])(
    "%s 上不画壳,内容原样透出",
    (pathname) => {
      const markup = renderShell(pathname);

      expect(markup).not.toContain('aria-label="Global navigation"');
      expect(markup).toContain("Page content");
    },
  );

  // W2-13(#993)— CRM 整段收起来了,所以 /crm 底下不再有任何一扇门,壳也不该在那里画导轨:
  // `MERCHANT_SURFACE_PATHS` 是从 `merchantNavLinks()` 推出来的,那一格删了,这些路径就不再
  // 是商家表面。那些路由文件仍在(各自 `redirect("/")`),所以旧书签落地在 Home 上,不是 404。
  // 半扇门 = 导轨上亮着一格、点进去却被弹走,正是这条要挡的东西。
  it.each(["/crm", "/crm/reports/report-1", "/crm/inbox/templates"])(
    "%s 上一根导轨都不画 —— 那个板块整个藏起来,不是半开的门",
    (pathname) => {
      const markup = renderShell(pathname);

      expect(markup).not.toContain('aria-label="Global navigation"');
      expect(markup).not.toContain('href="/crm"');
      expect(markup).toContain("Page content");
    },
  );

  // FRONT-A14 —— 顶栏面包屑。已批准的 Home analysis 夹具
  // (design-system/patterns/founder-home/HomeAnalysisReference.tsx)在顶栏写的是
  // 「Workspace › Home / Analysis」,它靠 `topBarLabel` 传给壳;生产从来没传过这个 prop,
  // 于是 /analysis 上只写「Workspace › Home」。补的是接线,字从导航权威源读。
  it("FRONT-A14: /analysis 的面包屑写出 Home / Analysis,与已批准的夹具一致", () => {
    expect(shellTopBarLabel(SHELL_ROUTES.homeAnalysis)).toBe("Home / Analysis");

    const markup = renderShell(SHELL_ROUTES.homeAnalysis);
    expect(markup).toContain("data-merchant-topbar");
    expect(markup).toContain("Home / Analysis");
  });

  it("FRONT-A14: 没有 breadcrumbLabel 的 child surface 面包屑照旧只写 owner 那格", () => {
    // 已批准的 Settings pattern 顶栏写的是「Settings」,不是「Settings / Billing & credits」。
    for (const pathname of [SHELL_ROUTES.billing, SHELL_ROUTES.profile, SHELL_ROUTES.connections]) {
      expect(shellTopBarLabel(pathname)).toBeUndefined();
    }
    expect(shellTopBarLabel(SHELL_ROUTES.home)).toBeUndefined();
    expect(shellTopBarLabel(SHELL_ROUTES.library)).toBeUndefined();

    const markup = renderShell(SHELL_ROUTES.billing);
    expect(markup).toContain("Settings");
    expect(markup).not.toContain("Settings / ");
  });

  it("FRONT-A14: 面包屑的字来自导航权威源,壳里一个地名都不手打", () => {
    const shellSource = readFileSync(
      resolve(__dirname, "../../components/global-navigation.tsx"),
      "utf8",
    );
    expect(shellSource).not.toContain('"Home / Analysis"');
    expect(shellSource).toContain("breadcrumbLabel");
    expect(
      NAVIGATION_OWNED_SURFACES.find((surface) => surface.key === "homeAnalysis")?.breadcrumbLabel,
    ).toBe("Analysis");
  });

  it("keeps the impersonation banner above the merchant sidebar", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(ImpersonationBanner),
        createElement(
          MerchantShellContent,
          { pathname: SHELL_ROUTES.billing, signOutAction: vi.fn(async () => undefined) },
          createElement("div", null, "Page content"),
        ),
      ),
    );

    expect(markup).toContain('class="sticky top-0 z-50"');
    expect(markup).toContain("You are impersonating a customer — spend is disabled.");
    expect(markup).toContain("Stop impersonating");

    // W2-11 —— 新导轨是一行 flex 里的普通子元素:没有 `fixed`,没有 z-index
    // (`NavigationRail.tsx` 的根 `<nav>` 只有 `flex h-dvh shrink-0 ...`)。旧壳靠
    // `fixed inset-y-0 left-0 z-40` 跟横幅的 z-50 比大小;新壳没有数字可比,真正要守住的是
    // 文档序 —— 横幅必须排在导轨前面,`sticky` 元素才会稳稳盖在一个没有定位、没有 z-index
    // 的导轨之上。
    const bannerIndex = markup.indexOf("sticky top-0 z-50");
    const railIndex = markup.indexOf('aria-label="Global navigation"');
    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(railIndex).toBeGreaterThan(bannerIndex);
    expect(markup).not.toContain("fixed inset-y-0 left-0 z-40");
  });
});
