// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
// Next 自己的 redirect 错误构造器:成功登出那一路的拒因就是它做出来的东西(见下面 P1-1 那条)。
import { getRedirectError } from "next/dist/client/components/redirect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OTTO_ASSISTANT, SHELL_ROUTES } from "@fikirtive/core/navigation";
import {
  MerchantAccountMenu,
  merchantIdentityLabel,
} from "@/components/navigation/MerchantAccountMenu";
import { MerchantTopBar } from "@/components/navigation/MerchantTopBar";
import { toast } from "@/components/ui/toast";

vi.mock("@/components/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

async function openAccountMenu(trigger: HTMLElement) {
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("MerchantTopBar", () => {
  it("derives the breadcrumb from the canonical navigation registry", async () => {
    const el = await render(
      createElement(MerchantTopBar, {
        pathname: SHELL_ROUTES.billing,
        signOutAction: async () => {},
        onAskOtto: () => {},
      }),
    );

    expect(el.querySelector("[data-merchant-topbar]")?.textContent).toContain("Workspace");
    expect(el.querySelector("[data-merchant-topbar]")?.textContent).toContain("Settings");
  });

  it("keeps Home analysis owned by Home", async () => {
    const el = await render(
      createElement(MerchantTopBar, {
        pathname: SHELL_ROUTES.homeAnalysis,
        signOutAction: async () => {},
        onAskOtto: () => {},
      }),
    );

    expect(el.querySelector("[data-merchant-topbar]")?.textContent).toContain("Home");
  });

  it("opens the shared Otto panel control without becoming a navigation link", async () => {
    const onAskOtto = vi.fn();
    const el = await render(
      createElement(MerchantTopBar, {
        pathname: SHELL_ROUTES.home,
        signOutAction: async () => {},
        onAskOtto,
      }),
    );
    const trigger = el.querySelector<HTMLButtonElement>("[data-shell-ask-otto]")!;

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("href")).toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe(OTTO_ASSISTANT.label);

    await act(async () => trigger.click());
    expect(onAskOtto).toHaveBeenCalledTimes(1);
  });

  // CREATE-A1 · 判官裁定 P1-A(2026-09-04):`onAskOtto` 从 `() => controls?.togglePanel()`
  // 改成可选(`global-navigation.tsx` 只在 `controls` 非空时才传函数)——面板没挂在这一面时,
  // 这颗按钮此前仍然画出来,按下去却是一次空动作。这里直接钉住 MerchantTopBar 自己的那一半:
  // 没有 `onAskOtto` 时,它压根不画这颗按钮,而不是画一颗点了没反应的死按钮。账户菜单照常渲染,
  // 证明这不是整条 utility bar 崩了。
  it("CREATE-A1 · doesn't render Ask Otto when the panel isn't mounted on this surface (no onAskOtto)", async () => {
    const el = await render(
      createElement(MerchantTopBar, {
        pathname: SHELL_ROUTES.home,
        signOutAction: async () => {},
      }),
    );

    expect(el.querySelector("[data-shell-ask-otto]")).toBeNull();
    // 账户菜单是另一颗控件,没有一起消失。
    expect(el.querySelector("[data-shell-identity]")).not.toBeNull();
  });
});

describe("MerchantAccountMenu", () => {
  it("uses one identity fallback rule", () => {
    expect(merchantIdentityLabel(null)).toBe("Account");
    expect(merchantIdentityLabel({ email: "owner@example.com", displayName: "", balance: 0 })).toBe(
      "owner@example.com",
    );
    expect(
      merchantIdentityLabel({ email: "owner@example.com", displayName: "Aisyah", balance: 0 }),
    ).toBe("Aisyah");
  });

  it("owns profile and sign-out actions in the utility bar account menu", async () => {
    const signOutAction = vi.fn(async () => {});
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: { email: "owner@example.com", displayName: "Aisyah", balance: 1240 },
        signOutAction,
      }),
    );
    const trigger = el.querySelector<HTMLElement>("[data-shell-identity]")!;

    expect(trigger.getAttribute("title")).toBe("Aisyah");
    await openAccountMenu(trigger);

    const profile = document.querySelector<HTMLAnchorElement>("[data-shell-profile]");
    const signOut = document.querySelector<HTMLElement>("[data-shell-signout]");
    expect(profile?.getAttribute("href")).toBe(SHELL_ROUTES.profile);
    expect(signOut?.textContent).toContain("Sign out");

    await act(async () => signOut?.click());
    expect(signOutAction).toHaveBeenCalledTimes(1);
  });

  /** 接线盘点 L5 —— 登出以前是 `void signOutAction()`:屏幕上什么都不变,失败也不出声。
   *  这一条把两件事一起钉住:点下去有进行中态,失败有反馈且能重来。 */
  it("FRONT-A12: sign out shows an in-progress state and reports failure instead of going quiet", async () => {
    let rejectSignOut: (reason: unknown) => void = () => {};
    const signOutAction = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSignOut = reject;
        }),
    );
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: { email: "owner@example.com", displayName: "Aisyah", balance: 1240 },
        signOutAction,
      }),
    );
    await openAccountMenu(el.querySelector<HTMLElement>("[data-shell-identity]")!);

    const signOut = () => document.querySelector<HTMLElement>("[data-shell-signout]")!;
    expect(signOut().textContent).toContain("Sign out");

    await act(async () => signOut().click());

    // 进行中:菜单不关(关了就没地方显示状态),文案与 aria 都改口。
    expect(signOut().textContent).toContain("Signing out");
    expect(signOut().getAttribute("aria-busy")).toBe("true");

    // 进行中再点一次不会打第二趟登出。
    await act(async () => signOut().click());
    expect(signOutAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectSignOut(new Error("offline"));
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledWith("Couldn't sign you out. Try again.");
    // 失败后回到可重试,不是卡死在「Signing out…」。
    expect(signOut().textContent).toContain("Sign out");
    expect(signOut().getAttribute("aria-busy")).toBeNull();

    await act(async () => signOut().click());
    expect(signOutAction).toHaveBeenCalledTimes(2);
  });

  /** 判官 P1-1(2026-09-05)—— 上一条只证明了**失败**那一路。真正的成功那一路长得像失败:
   *  Next 16 的 server-action reducer 只要服务端答了 redirect 就 `reject` 一个 redirect 错误
   *  (`next/dist/.../server-action-reducer.js`),而 `signOutAction()` 每次成功都以
   *  `redirect("/login")` 收尾。改前那个不分辨的 catch 于是把每一次成功登出都报成失败。
   *  这里的拒因不是手写 digest,是 Next 自己的 `getRedirectError()`,所以格式变了这条会红。 */
  it("FRONT-A12: sign out stays in progress and stays silent when the action redirects (the real success path)", async () => {
    vi.mocked(toast.error).mockClear();
    const signOutAction = vi.fn(async () => {
      throw getRedirectError("/login", "push");
    });
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: { email: "owner@example.com", displayName: "Aisyah", balance: 1240 },
        signOutAction,
      }),
    );
    await openAccountMenu(el.querySelector<HTMLElement>("[data-shell-identity]")!);

    const signOut = () => document.querySelector<HTMLElement>("[data-shell-signout]")!;
    await act(async () => {
      signOut().click();
      await Promise.resolve();
    });

    // 壳马上被换掉,进行中才是实话——不复位、不弹失败。
    expect(toast.error).not.toHaveBeenCalled();
    expect(signOut().textContent).toContain("Signing out");
    expect(signOut().getAttribute("aria-busy")).toBe("true");
  });

  /** 判官 P2-3(2026-09-05)—— 评审夹具传的是 `async () => {}`:不跳转,正常 resolve。
   *  「成功＝壳会被换掉」写死成假设时,这一路会把菜单项永久钉在「Signing out…」。 */
  it("FRONT-A12: sign out resets when the action resolves without redirecting (review fixtures)", async () => {
    vi.mocked(toast.error).mockClear();
    const signOutAction = vi.fn(async () => {});
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: { email: "owner@example.com", displayName: "Aisyah", balance: 1240 },
        signOutAction,
      }),
    );
    await openAccountMenu(el.querySelector<HTMLElement>("[data-shell-identity]")!);

    const signOut = () => document.querySelector<HTMLElement>("[data-shell-signout]")!;
    await act(async () => {
      signOut().click();
      await Promise.resolve();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(signOut().textContent).toContain("Sign out");
    expect(signOut().getAttribute("aria-busy")).toBeNull();
  });

  it("can hide sign out on a review surface without hiding Profile", async () => {
    const signOutAction = vi.fn(async () => {});
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: { email: "owner@example.com", displayName: "Aisyah", balance: 1240 },
        signOutAction,
        profileHref: "/product-patterns/settings?section=profile",
        showSignOutAction: false,
      }),
    );

    await openAccountMenu(el.querySelector<HTMLElement>("[data-shell-identity]")!);

    expect(document.querySelector<HTMLAnchorElement>("[data-shell-profile]")?.getAttribute("href")).toBe(
      "/product-patterns/settings?section=profile",
    );
    expect(document.querySelector("[data-shell-signout]")).toBeNull();
    expect(signOutAction).not.toHaveBeenCalled();
  });

  /** P1-012(发布身份)— the menu is shared shell chrome, so it rides FRONT-A14's six-face pass.
   *  判官四轮 P2-3:sha 现在是直接传进来的 prop(`getMyAccount()` 那趟顺风车的产物),这个组件
   *  自己不再发任何请求——测试直接传 `buildSha`,不再需要 DI 或等一轮微任务去 flush 一个
   *  已经不存在的 useEffect。 */
  it("FRONT-A14: shows a compact build version row and copies the /api/build-info link", async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: { email: "owner@example.com", displayName: "Aisyah", balance: 1240 },
        signOutAction: async () => {},
        buildSha: "abc123de",
      }),
    );
    await openAccountMenu(el.querySelector<HTMLElement>("[data-shell-identity]")!);

    const build = document.querySelector<HTMLElement>("[data-shell-build-info]");
    expect(build?.textContent).toContain("Build abc123de");

    await act(async () => build?.click());
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("/api/build-info"));
  });

  it("FRONT-A14: no platform-injected sha (local dev) shows 'Build local', never a blank row", async () => {
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: null,
        signOutAction: async () => {},
        buildSha: null,
      }),
    );
    await openAccountMenu(el.querySelector<HTMLElement>("[data-shell-identity]")!);

    expect(document.querySelector("[data-shell-build-info]")?.textContent).toContain("Build local");
  });

  /** 判官四轮 P2-2:可见文案是紧凑版本号「Build <sha>」,不该也不会变;读屏该报的是这颗项
   *  真正做的事(复制链接),按 accessible name(`aria-label`)能单独取到它,且落在同一个元素上。 */
  it("P2-2: the build-info item's accessible name describes the action, visible text stays the compact label", async () => {
    const el = await render(
      createElement(MerchantAccountMenu, {
        account: { email: "owner@example.com", displayName: "Aisyah", balance: 1240 },
        signOutAction: async () => {},
        buildSha: "abc123de",
      }),
    );
    await openAccountMenu(el.querySelector<HTMLElement>("[data-shell-identity]")!);

    const byAccessibleName = document.querySelector<HTMLElement>('[aria-label="Copy build info link"]');
    const byTestHook = document.querySelector<HTMLElement>("[data-shell-build-info]");
    expect(byAccessibleName).not.toBeNull();
    expect(byAccessibleName).toBe(byTestHook);
    expect(byAccessibleName?.textContent).toContain("Build abc123de");
  });
});
