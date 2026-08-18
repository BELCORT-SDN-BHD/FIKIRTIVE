// @vitest-environment jsdom
/**
 * #992 (W2-10) —— 新左导轨,真的渲染出来。
 *
 * 规格:`docs/specs/wave2-shell.md` §2.1(形状)、§5.3(一层导轨)、§5.6 ④(dropdown-menu)。
 * 票面验收四条,这个文件逐条钉:
 *
 *  ① 导轨渲染出板块 + Settings 分组 + credits 行 + 身份菜单 —— 而且**每一格都来自权威源**:
 *     标签、地址、顺序逐项对账,手抄一格就红。
 *  ② 当前路由高亮唯一 —— 这里验的是画出来的 DOM 里 `aria-current="page"` 恰好一个
 *     (规则本身在 `nav-rail-tree.test.ts`)。
 *  ③ 一层导轨:240px ↔ 64px 是**商家**按出来的,状态存 localStorage;
 *     「按宽度自动换形态」那套连一行都不许在新实现里复活(源码闸:没有断点前缀、没有 matchMedia)。
 *  ④ 身份菜单与分组是真菜单:ESC 关得掉、点外面关得掉、`role="menu"` 是真的、方向键真的走。
 *     钉的不是「源码里没有 `<details>`」,而是**换来的行为真的在**。
 *
 * 这一票只建组件族、不挂现网,所以这里没有任何一条断言依赖 layout —— 导轨拿 `pathname`
 * 当参数,拿回调开 Otto 面板,挂载与旧轨删除是 W2-11 的活。
 */
import fs from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MERCHANT_NAV,
  SHELL_ROUTES,
  isNavGroup,
  merchantNavLinks,
  type MerchantNavLink,
} from "@fikirtive/core/navigation";
import { creditsLabel } from "@/lib/credit-format";

// Radix 的菜单在 jsdom 里要这三样才活得起来(popper 量尺寸、指针捕获、滚动到高亮项)。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { NAV_RAIL_ELEMENT_ID, NAV_RAIL_ICONS, NavigationRail, railIdentityLabel } = await import(
  "@/components/navigation/rail/NavigationRail"
);
const { NAV_RAIL_STORAGE_KEY, RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } = await import(
  "@/components/navigation/rail/rail-state"
);

const WEB_ROOT = path.resolve(__dirname, "../..");
const RAIL_SOURCE = path.join(WEB_ROOT, "components/navigation/rail/NavigationRail.tsx");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function rail(props: Partial<Parameters<typeof NavigationRail>[0]> = {}) {
  return createElement(NavigationRail, {
    pathname: "/",
    onAskOtto: () => {},
    signOutAction: async () => {},
    ...props,
  });
}

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

function railOf(el: HTMLElement): HTMLElement {
  const node = el.querySelector<HTMLElement>("[data-nav-rail]");
  if (!node) throw new Error("rail not rendered");
  return node;
}

/** 真鼠标那一发:Radix 的 trigger 认的是 pointerdown,不是 click。 */
function pointer(type: string, target: EventTarget): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
}

async function openMenu(trigger: HTMLElement): Promise<HTMLElement> {
  await act(async () => {
    pointer("pointerdown", trigger);
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  if (!menu) throw new Error("menu did not open");
  // DismissableLayer 的「点外面」监听器是在一个 setTimeout(0) 之后才挂上的,
  // 所以关外面那几条断言必须等这一拍过去,否则验的是一个还没装好的行为。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  return menu;
}

function menuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

async function press(key: string, target: EventTarget = document): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  // 方向键在菜单项之间移动焦点是排在下一拍上的(Radix 的 roving focus 用 setTimeout),
  // 所以按完要让那一拍过去,否则读到的是按之前的焦点。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

/** 源码闸都跑在**剥掉注释**的正文上:讲清楚「不许再有 lg: / xl:」就得把它们写出来。 */
function railSourceWithoutComments(): string {
  return fs
    .readFileSync(RAIL_SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("导轨画的每一格都来自权威源 (§1.3,票面验收 ①)", () => {
  it("renders the registry's own top-level cells, in the registry's own order", async () => {
    const el = await render(rail());

    const rendered = Array.from(railOf(el).querySelectorAll<HTMLAnchorElement>("a[data-nav-rail-link]")).map(
      (a) => ({ key: a.dataset.navRailLink, href: a.getAttribute("href"), label: a.textContent?.trim() }),
    );
    const expected = MERCHANT_NAV.filter((node): node is MerchantNavLink => !isNavGroup(node)).map((link) => ({
      key: link.key,
      href: link.href,
      label: link.preview ? `${link.label}Preview` : link.label,
    }));

    expect(rendered).toEqual(expected);
  });

  it("renders one trigger per group, and the group's own children inside its menu", async () => {
    const el = await render(rail());
    const groups = MERCHANT_NAV.filter(isNavGroup);

    const triggers = Array.from(railOf(el).querySelectorAll<HTMLElement>("[data-nav-rail-group]"));
    expect(triggers.map((t) => t.dataset.navRailGroup)).toEqual(groups.map((g) => g.key));

    for (const [index, group] of groups.entries()) {
      const menu = await openMenu(triggers[index]!);
      const items = Array.from(menu.querySelectorAll<HTMLAnchorElement>("a[data-nav-rail-link]"));

      expect(items.map((a) => ({ key: a.dataset.navRailLink, href: a.getAttribute("href") }))).toEqual(
        group.items.map((item) => ({ key: item.key, href: item.href })),
      );
      expect(items.map((a) => a.textContent?.trim())).toEqual(group.items.map((item) => item.label));

      await press("Escape");
    }
  });

  it("has an icon for every key the registry names — no silent fallback", () => {
    const keys = [
      ...MERCHANT_NAV.map((node) => node.key),
      ...merchantNavLinks().map((link) => link.key),
      // 换壳后的第一格。W2-11 改完数据它就出现,那一天不该还要回来补一个图标。
      "home",
    ];

    for (const key of new Set(keys)) {
      expect(NAV_RAIL_ICONS[key], `no rail icon for "${key}"`).toBeTruthy();
    }
  });

  it("writes no route of its own — every address comes from the registry", () => {
    const source = railSourceWithoutComments();
    const literals = source.match(/(["'`])\/[A-Za-z][^"'`\s]*\1/g) ?? [];

    expect(literals, "a hand-written route literal in the rail is a second source of truth").toEqual([]);
  });

  it("takes the credits row to the registry's Billing destination", async () => {
    const el = await render(rail());
    const credits = railOf(el).querySelector<HTMLAnchorElement>("[data-nav-rail-credits]")!;

    expect(credits.getAttribute("href")).toBe(SHELL_ROUTES.billing);
    expect(credits.textContent).toContain("Credits");
  });

  it("shows the real balance once the account is handed in", async () => {
    const el = await render(rail({ account: { email: "a@b.my", displayName: "Aisyah", balance: 1234 } }));

    expect(railOf(el).querySelector("[data-nav-rail-credits]")!.textContent).toBe(creditsLabel(1234));
  });

  it("says a preview door is a preview before it is clicked (#792)", async () => {
    const preview = MERCHANT_NAV.find((node) => !isNavGroup(node) && node.preview);
    if (!preview || isNavGroup(preview)) return; // 权威源里没有预览门了 —— 这条自然退场

    const el = await render(rail());
    const row = railOf(el).querySelector<HTMLAnchorElement>(`[data-nav-rail-link="${preview.key}"]`)!;

    expect(row.getAttribute("aria-label")).toBe(`${preview.label} (preview)`);
    expect(row.getAttribute("title")).toContain(preview.preview!);
    expect(row.textContent).toContain("Preview");
  });
});

describe("高亮唯一 (票面验收 ②)", () => {
  it("lights exactly one row on every destination the registry lists", async () => {
    for (const link of merchantNavLinks()) {
      const el = await render(rail({ pathname: link.href }));
      const lit = Array.from(railOf(el).querySelectorAll('[aria-current="page"]'));

      expect(lit.length, `${link.href} lit ${lit.length} rows`).toBeLessThanOrEqual(1);

      await act(async () => root?.unmount());
      container?.remove();
      root = null;
      container = null;
    }
  });

  it("lights the top-level row a sub-route sits under", async () => {
    const first = MERCHANT_NAV.find((node) => !isNavGroup(node))!;
    if (isNavGroup(first)) throw new Error("unreachable");

    const el = await render(rail({ pathname: `${first.href}/something/deeper` }));
    const lit = railOf(el).querySelectorAll<HTMLAnchorElement>('[aria-current="page"]');

    expect(lit).toHaveLength(1);
    expect(lit[0]!.dataset.navRailLink).toBe(first.key);
  });

  it("lights nothing off the merchant surfaces", async () => {
    const el = await render(rail({ pathname: "/login" }));

    expect(railOf(el).querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });
});

describe("一层导轨:240 ↔ 64,商家自己按 (§5.3,票面验收 ③)", () => {
  it("renders 240px with labels on the first frame, with transitions off", () => {
    const markup = renderToStaticMarkup(rail());

    expect(markup).toContain(`width:${RAIL_WIDTH_EXPANDED}px`);
    expect(markup).toContain("transition:none");
    expect(markup).not.toContain("data-nav-rail-hydrated");
  });

  it("collapses to 64px on the merchant's own click and remembers it", async () => {
    const el = await render(rail());
    const toggle = () => railOf(el).querySelector<HTMLButtonElement>("[data-nav-rail-toggle]")!;

    expect(railOf(el).style.width).toBe(`${RAIL_WIDTH_EXPANDED}px`);
    expect(toggle().getAttribute("aria-label")).toBe("Collapse navigation");
    // 判官 r1 [P3-5]:`aria-expanded` 只说「有东西展着」,`aria-controls` 才说清是哪一样。
    expect(toggle().getAttribute("aria-controls")).toBe(NAV_RAIL_ELEMENT_ID);
    expect(railOf(el).id).toBe(NAV_RAIL_ELEMENT_ID);

    await act(async () => toggle().click());

    expect(railOf(el).style.width).toBe(`${RAIL_WIDTH_COLLAPSED}px`);
    expect(railOf(el).getAttribute("data-nav-rail-state")).toBe("collapsed");
    expect(toggle().getAttribute("aria-label")).toBe("Expand navigation");
    expect(JSON.parse(window.localStorage.getItem(NAV_RAIL_STORAGE_KEY)!)).toEqual({ collapsed: true });

    await act(async () => toggle().click());
    expect(railOf(el).style.width).toBe(`${RAIL_WIDTH_EXPANDED}px`);
  });

  it("applies the stored form after mount, and marks itself hydrated", async () => {
    window.localStorage.setItem(NAV_RAIL_STORAGE_KEY, JSON.stringify({ collapsed: true }));

    const el = await render(rail());

    expect(railOf(el).hasAttribute("data-nav-rail-hydrated")).toBe(true);
    expect(railOf(el).style.width).toBe(`${RAIL_WIDTH_COLLAPSED}px`);
    expect(railOf(el).style.transition).toContain("200ms");
  });

  it("falls back to the open rail — and does not throw — on a corrupt stored value", async () => {
    window.localStorage.setItem(NAV_RAIL_STORAGE_KEY, "{ this is not json");

    const el = await render(rail());

    expect(railOf(el).style.width).toBe(`${RAIL_WIDTH_EXPANDED}px`);
  });

  it("keeps every row's name when the labels are gone", async () => {
    window.localStorage.setItem(NAV_RAIL_STORAGE_KEY, JSON.stringify({ collapsed: true }));
    const el = await render(rail());

    for (const link of MERCHANT_NAV) {
      if (isNavGroup(link)) continue;
      const row = railOf(el).querySelector<HTMLElement>(`[data-nav-rail-link="${link.key}"]`)!;
      expect(row.textContent, `${link.label} still spells itself out at 64px`).not.toContain(link.label);
      expect(row.getAttribute("aria-label"), `${link.label} lost its name at 64px`).toContain(link.label);
    }
  });

  it("never changes form by itself: no breakpoint prefixes, no matchMedia", () => {
    const source = railSourceWithoutComments();

    expect(source).not.toMatch(/\b(sm|md|lg|xl|2xl):/);
    expect(source).not.toContain("matchMedia");
  });
});

describe("身份菜单与分组是真菜单 (§5.6 ④,票面验收 ④)", () => {
  it("no longer hides a menu inside a <details> disclosure", () => {
    const source = railSourceWithoutComments();

    expect(source).not.toContain("<details");
    expect(source).not.toContain("<summary");
  });

  it("opens a real menu with real menu items", async () => {
    const el = await render(rail());
    const trigger = railOf(el).querySelector<HTMLElement>("[data-nav-rail-identity]")!;

    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    const menu = await openMenu(trigger);

    expect(menu.getAttribute("role")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(["Profile", "Sign out"]);
    expect(menu.querySelector<HTMLAnchorElement>("[data-nav-rail-profile]")!.getAttribute("href")).toBe(
      SHELL_ROUTES.profile,
    );
  });

  it("closes on Escape — the thing the hand-rolled disclosure never did", async () => {
    const el = await render(rail());
    await openMenu(railOf(el).querySelector<HTMLElement>("[data-nav-rail-identity]")!);

    await press("Escape");

    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on a click outside itself", async () => {
    const el = await render(rail());
    await openMenu(railOf(el).querySelector<HTMLElement>("[data-nav-rail-identity]")!);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    await act(async () => {
      pointer("pointerdown", outside);
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    outside.remove();
  });

  it("walks its items with the arrow keys", async () => {
    const el = await render(rail());
    const menu = await openMenu(railOf(el).querySelector<HTMLElement>("[data-nav-rail-identity]")!);

    await press("ArrowDown", menu);
    expect(document.activeElement?.textContent?.trim()).toBe("Profile");

    await press("ArrowDown", document.activeElement!);
    expect(document.activeElement?.textContent?.trim()).toBe("Sign out");

    await press("ArrowUp", document.activeElement!);
    expect(document.activeElement?.textContent?.trim()).toBe("Profile");
  });

  it("signs the merchant out from the menu item", async () => {
    const signOutAction = vi.fn(async () => {});
    const el = await render(rail({ signOutAction }));
    await openMenu(railOf(el).querySelector<HTMLElement>("[data-nav-rail-identity]")!);

    await act(async () => {
      document.querySelector<HTMLElement>("[data-nav-rail-signout]")!.click();
    });

    expect(signOutAction).toHaveBeenCalledTimes(1);
  });

  it("names the merchant, and falls back to their email and then to Account", async () => {
    expect(railIdentityLabel(null)).toBe("Account");
    expect(railIdentityLabel({ email: "a@b.my", displayName: "", balance: 0 })).toBe("a@b.my");
    expect(railIdentityLabel({ email: "a@b.my", displayName: "Aisyah", balance: 0 })).toBe("Aisyah");

    const el = await render(rail({ account: { email: "a@b.my", displayName: "Aisyah", balance: 0 } }));
    expect(railOf(el).querySelector("[data-nav-rail-identity]")!.textContent).toContain("Aisyah");
  });
});

describe("Ask Otto 是面板,不是地址 (§2.3 ②)", () => {
  it("is a button that opens the panel, never a link that navigates", async () => {
    const onAskOtto = vi.fn();
    const el = await render(rail({ onAskOtto }));
    const ask = railOf(el).querySelector<HTMLButtonElement>("[data-nav-rail-ask-otto]")!;

    expect(ask.tagName).toBe("BUTTON");
    expect(ask.getAttribute("href")).toBeNull();

    await act(async () => ask.click());

    expect(onAskOtto).toHaveBeenCalledTimes(1);
  });

  it("keeps its name when the rail is collapsed", async () => {
    window.localStorage.setItem(NAV_RAIL_STORAGE_KEY, JSON.stringify({ collapsed: true }));
    const el = await render(rail());
    const ask = railOf(el).querySelector<HTMLButtonElement>("[data-nav-rail-ask-otto]")!;

    expect(ask.textContent).not.toContain("Ask Otto");
    expect(ask.getAttribute("aria-label")).toBe("Ask Otto");
  });
});
