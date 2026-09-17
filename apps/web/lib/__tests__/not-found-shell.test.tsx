// @vitest-environment jsdom
/**
 * `app/not-found.tsx` —— 没建过的地址落在产品里面,不落在 Next 自带的那堵墙上(R3-F11)。
 *
 * 四条停放前缀底下的乱地址各有自己的 catch-all(一律 307,围栏在 `route-redirects.test.ts`);
 * 这一页接的是**其余全部**。它没有正确去处可送 —— 那条地址真的不存在 —— 所以诚实的答案
 * 仍是 404,这里钉的是「这个 404 长在产品里面」,以及它的三条边界:
 *
 *   ① 画不画壳由**会话**决定,不由地址决定(判官 P2):`s`/`privacy`/`legal` 整棵子树在认证墙
 *      外面,没有账号的读者也到得了这一页 —— 给他画导轨、余额行与账号菜单是一句假话。
 *   ② 壳由这一页自己带上(`carriesShell`),`isMerchantSurface` 那份按地址推出来的名单一个字
 *      没放宽 —— 放宽它会连 `/login`、`/admin` 与免登录的公开分享页一起画上壳。
 *   ③ 但只画**一层**(判官 P1):名单按前缀匹配,`/billing/<没建过的段>` 在根 layout 那一层
 *      已经有壳了,里层必须原样透出 children,否则同屏两根导轨、两次 `getMyAccount()`。
 *
 * 真实的 HTTP 404 与「浏览器里真的只有一根导轨」由
 * `e2e/journeys/29-parked-prefix-deep-link.spec.ts` 在跑起来的服务器上量。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/** 没建过的那条地址。它不是「打字错误的模拟」,它就是打字错误本身。 */
const UNKNOWN_PATH = "/definitely-not-a-route";

/** 同样没建过,但它**长在一条真商家前缀底下** —— 判官 P1 那一格。 */
const UNKNOWN_PATH_UNDER_MERCHANT_PREFIX = `${SHELL_ROUTES.billing}/a-page-that-was-never-built`;

const RAIL = 'aria-label="Global navigation"';

let pathname = UNKNOWN_PATH;

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => pathname),
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

/** 会话那一头。产品自己的答案就是这个函数(`lib/auth-guard.ts`:有会话且在名单里)。 */
const requireSession = vi.fn<() => Promise<{ email: string } | { error: string }>>();
vi.mock("@/lib/auth-guard", () => ({ requireSession }));

const { default: NotFound } = await import("../../app/not-found");
const { MerchantShellContent, isMerchantSurface } = await import("@/components/global-navigation");

function signedIn() {
  requireSession.mockResolvedValue({ email: "suri@e2e.test" });
}

function signedOut() {
  requireSession.mockResolvedValue({ error: "Not authorized." });
}

/** 这一页是 server component(它读会话),所以先 await 出元素,再静态渲染。 */
async function renderNotFound(): Promise<string> {
  return renderToStaticMarkup(await NotFound());
}

/** 根 layout 那一层壳,外面套着这一页 —— 判官 P1 的复现装置。 */
async function renderInsideRootShell(path: string): Promise<string> {
  pathname = path;
  return renderToStaticMarkup(
    createElement(
      MerchantShellContent,
      { pathname: path, signOutAction: vi.fn(async () => undefined) },
      await NotFound(),
    ),
  );
}

function railCount(markup: string): number {
  return markup.split(RAIL).length - 1;
}

beforeEach(() => {
  pathname = UNKNOWN_PATH;
  requireSession.mockReset();
});

describe("R3-F11 兜底 404 —— 有会话的商家仍然站在自己的产品里", () => {
  it("导轨画出来了,而且有一条回去的路", async () => {
    signedIn();
    const markup = await renderNotFound();

    expect(markup, "没有导轨 —— 这正是裸 404 的那堵墙").toContain(RAIL);
    expect(markup, "没有顶栏/账号菜单").toContain("data-merchant-topbar");
    expect(markup, "没有一条回去的路").toContain(`href="${SHELL_ROUTES.home}"`);
    expect(markup).toContain("Back to Home");
  });

  it("说的是实话,而且只说一句", async () => {
    signedIn();
    const markup = await renderNotFound();

    expect(markup).toContain("Page not found");
    expect(markup).toContain("This address does not lead anywhere in Fikirtive");
    // 「没建过的地址」不是一次故障,别拿崩溃页的措辞吓商家(`components/crash-page.tsx`)。
    expect(markup).not.toContain("Something broke");
    expect(markup).not.toContain("Error reference");
  });
});

/* ── 判官 P2:没有会话的读者也到得了这一页 ───────────────────────────────────────────── */

describe("R3-F11 兜底 404 —— 没有会话的读者不会被画上一个他没有的工作区", () => {
  it("墙外的读者拿到的是干净的一页:没有导轨、没有余额、没有账号菜单", async () => {
    signedOut();
    const markup = await renderNotFound();

    expect(markup, "给一个没有账号的读者画了商家导轨").not.toContain(RAIL);
    expect(markup).not.toContain("data-merchant-topbar");
    expect(markup).not.toContain("credits");
    // 同一句实话仍然说给他听,并且给他一条走得通的路。
    expect(markup).toContain("Page not found");
    expect(markup).toContain('href="/login"');
    expect(markup).toContain("Go to sign in");
  });

  it("这一页真的会去问会话 —— 不是靠地址猜的", async () => {
    signedOut();
    await renderNotFound();
    expect(requireSession).toHaveBeenCalledTimes(1);
  });
});

/* ── 判官 P1:壳只画一层 ─────────────────────────────────────────────────────────────── */

describe("R3-F11 兜底 404 —— 屏幕上永远只有一份壳", () => {
  it("未知地址长在商家前缀底下(/billing/…)时,根那一层已经有壳,里层不再画第二根导轨", async () => {
    signedIn();
    // 前提:这条地址对按前缀匹配的名单来说**就是**商家表面 —— 没有这一条,下面那句话不成立。
    expect(isMerchantSurface(UNKNOWN_PATH_UNDER_MERCHANT_PREFIX)).toBe(true);

    const markup = await renderInsideRootShell(UNKNOWN_PATH_UNDER_MERCHANT_PREFIX);

    expect(railCount(markup), "同屏画出了两根导轨").toBe(1);
    expect(markup).toContain("Page not found");
    expect(markup).toContain("Back to Home");
  });

  it("根那一层没画壳时(未知地址不在任何前缀底下),这一页自己把壳带上 —— 仍然只有一根", async () => {
    signedIn();
    expect(isMerchantSurface(UNKNOWN_PATH)).toBe(false);

    const markup = await renderInsideRootShell(UNKNOWN_PATH);

    expect(railCount(markup)).toBe(1);
  });
});

/* ── 壳是这一页自己带上的,不是把名单放宽 ───────────────────────────────────────────── */

describe("R3-F11 —— 那份按地址推出来的名单一个字没放宽", () => {
  it("未知地址仍然不是商家表面,墙外那几面也仍然不是", () => {
    expect(isMerchantSurface(UNKNOWN_PATH)).toBe(false);
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

    expect(bare).not.toContain(RAIL);
    expect(carried).toContain(RAIL);
    expect(carried).toContain("Page content");
  });
});
