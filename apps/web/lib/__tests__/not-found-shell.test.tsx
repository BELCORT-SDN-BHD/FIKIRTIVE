// @vitest-environment jsdom
/**
 * `app/not-found.tsx` —— 没建过的地址落在产品里面,不落在 Next 自带的那堵墙上(R3-F11)。
 *
 * 四条停放前缀底下的乱地址各有自己的 catch-all(一律 307,围栏在 `route-redirects.test.ts`);
 * 这一页接的是**其余全部**。它没有正确去处可送 —— 那条地址真的不存在 —— 所以诚实的答案
 * 仍是 404,这里钉的是「这个 404 长在产品里面」:导轨在、账号菜单在、有一条回去的路。
 *
 * 这个文件同时钉住那个**设计选择**:壳由这一页自己带上(`carriesShell`),`isMerchantSurface`
 * 那份按地址推出来的名单一个字没放宽 —— 放宽它会连 `/login`、`/admin` 与免登录的公开分享页
 * 一起画上壳。最后两条 `it` 就是这句话的反面与正面。
 *
 * 真实的 HTTP 404 由 `e2e/journeys/29-parked-prefix-deep-link.spec.ts` 在跑起来的服务器上量
 * (这里渲染得出的只是那一页的样子,不是状态码)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/** 没建过的那条地址。它不是「打字错误的模拟」,它就是打字错误本身。 */
const UNKNOWN_PATH = "/definitely-not-a-route";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => UNKNOWN_PATH),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
}));

// 静态渲染不跑 useEffect,所以 `getMyAccount` 实际一次都不会被调用 —— 挡住这个模块只是为了
// 不让 import 链带出一个真的 "use server" 动作文件(与 `global-navigation.test.ts` 同一口径)。
vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
  signOutAction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tenant-actions", () => ({
  stopImpersonatingTenant: vi.fn(),
}));

const { default: NotFound } = await import("../../app/not-found");
const { MerchantShellContent, isMerchantSurface } = await import("@/components/global-navigation");

function renderNotFound(): string {
  return renderToStaticMarkup(createElement(NotFound));
}

describe("R3-F11 兜底 404 —— 商家仍然站在自己的产品里", () => {
  it("导轨画出来了,而且有一条回去的路", () => {
    const markup = renderNotFound();

    expect(markup, "没有导轨 —— 这正是裸 404 的那堵墙").toContain('aria-label="Global navigation"');
    expect(markup, "没有顶栏/账号菜单").toContain("data-merchant-topbar");
    expect(markup, "没有一条回去的路").toContain(`href="${SHELL_ROUTES.home}"`);
    expect(markup).toContain("Back to Home");
  });

  it("说的是实话,而且只说一句", () => {
    const markup = renderNotFound();

    expect(markup).toContain("Page not found");
    expect(markup).toContain("This address does not lead anywhere in Fikirtive");
    // 「没建过的地址」不是一次故障,别拿崩溃页的措辞吓商家(`components/crash-page.tsx`)。
    expect(markup).not.toContain("Something broke");
    expect(markup).not.toContain("Error reference");
  });

  /* ── 壳是这一页自己带上的,不是把名单放宽 ─────────────────────────────────────────── */

  it("那份按地址推出来的名单一个字没放宽:未知地址仍然不是商家表面", () => {
    expect(isMerchantSurface(UNKNOWN_PATH)).toBe(false);
    // 名单还挡着这几面 —— 放宽它就等于给它们也画上壳。
    expect(isMerchantSurface("/login")).toBe(false);
    expect(isMerchantSurface(SHELL_ROUTES.publicSharePreview)).toBe(false);
  });

  it("所以壳只有 carriesShell 才画得出来 —— 同一条地址,不带它就是裸的", () => {
    const bare = renderToStaticMarkup(
      createElement(
        MerchantShellContent,
        { pathname: UNKNOWN_PATH, signOutAction: vi.fn(async () => undefined) },
        createElement("div", null, "Page content"),
      ),
    );
    const carried = renderToStaticMarkup(
      createElement(
        MerchantShellContent,
        { pathname: UNKNOWN_PATH, signOutAction: vi.fn(async () => undefined), carriesShell: true },
        createElement("div", null, "Page content"),
      ),
    );

    expect(bare).not.toContain('aria-label="Global navigation"');
    expect(carried).toContain('aria-label="Global navigation"');
    expect(carried).toContain("Page content");
  });
});
