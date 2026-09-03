// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OTTO_ASSISTANT, SHELL_ROUTES } from "@fikirtive/core/navigation";
import {
  MerchantAccountMenu,
  merchantIdentityLabel,
} from "@/components/navigation/MerchantAccountMenu";
import { MerchantTopBar } from "@/components/navigation/MerchantTopBar";

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
});
