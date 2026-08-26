// @vitest-environment jsdom
/**
 * Home 的「Create without data」那一排,chevron 那颗按钮。
 *
 * 起因(A-2):它从画上去那天起就没有 `onClick` —— aria-label 写着「More creation choices」,
 * 商家按下去屏幕上什么都不会发生。一颗看得见、点得动、什么都不做的按钮,比没有这颗按钮
 * 更伤:商家会以为是自己按错了,或者以为产品坏了。
 *
 * 修法是挂真菜单(shadcn `dropdown-menu`,键盘、Escape、方向键那一整套由 Radix 出),
 * 这份文件钉的是修完之后的三条不变量:
 *
 *  ① 按下去真的开出一个 `role="menu"`,而且每一项都是真的 `menuitem`;
 *  ② 每一项都指向**今天真的存在的路由**,零死链 —— 期望侧不手抄地址,直接核对
 *     `app/` 底下有没有那张 `page.tsx`;
 *  ③ 菜单里不许出现 beta V1 被故意藏起来的那几扇门(Campaigns / Approvals / Schedule /
 *     Analytics / Routines,Founder 2026-08-26 收窄,权威在 `r22-beta-nav-scope.test.ts`)——
 *     侧栏藏起来、却从 Home 的菜单里偷偷放回去,等于收窄没收。
 *
 * 变异自检(逐条实做,做完还原,红 → 绿):
 *   · 把 `Open Library` 的 href 改成 `/uploads` ⇒ ② 红(`app/uploads/page.tsx` 不存在);
 *   · 菜单里加一项 `Plan a campaign → /campaign` ⇒ ③ 红;
 *   · 把 `DropdownMenuTrigger` 拆掉、退回裸 `<Button>` ⇒ ① 红(开不出菜单)。
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readOk, type HomeData } from "@/components/home/home-data";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

// Radix 的菜单在 jsdom 里要这几样才活得起来(popper 量尺寸、指针捕获、滚动到高亮项)。
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

const { HomeView } = await import("@/components/home/HomeView");

const APP_DIR = path.resolve(__dirname, "../../app");

const DATA: HomeData = {
  greeting: "Good morning, Nadia",
  credits: readOk("1,240 cr"),
  billingHref: "/billing",
  billingLabel: "Billing & credits",
  canvases: readOk([]),
  thumbs: readOk([]),
  upcoming: readOk([]),
  campaigns: readOk([]),
  equipment: readOk([]),
};

/** beta V1 藏起来的那几扇门 —— 菜单里出现任何一个就算把收窄撤了。 */
const HIDDEN_DOORS = ["/campaign", "/approvals", "/schedule", "/routines"] as const;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mountHome(fixture = false) {
  await act(async () => {
    root!.render(createElement(HomeView, { data: DATA, connection: { kind: "not_connected" }, fixture } as never));
  });
}

function trigger(): HTMLElement {
  const node = container!.querySelector<HTMLElement>('[aria-label="More creation choices"]');
  if (!node) throw new Error("Home 的 chevron 按钮不见了");
  return node;
}

async function openMenu(): Promise<HTMLElement> {
  const node = trigger();
  await act(async () => {
    node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  if (!menu) throw new Error("chevron 按下去没有开出菜单 —— 它又变回死按钮了");
  return menu;
}

function menuLinks(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .map((item) => (item instanceof HTMLAnchorElement ? item : item.querySelector("a")))
    .filter((node): node is HTMLAnchorElement => node !== null);
}

/** `/library?fixture=r22` → `library` —— 只留路由段,用来核对 `app/` 里那张 page.tsx。 */
function routeSegment(href: string): string {
  return href.split("?")[0]!.replace(/^\//, "");
}

describe("Home 的 chevron:死按钮换成真菜单(A-2)", () => {
  it("① 按下去开出真菜单,每一项都是真的 menuitem", async () => {
    await mountHome();
    const menu = await openMenu();
    expect(menu.getAttribute("role")).toBe("menu");
    const items = document.querySelectorAll('[role="menuitem"]');
    expect(items.length, "菜单开了但一项都没有").toBeGreaterThanOrEqual(3);
    expect(trigger().getAttribute("aria-expanded"), "触发器没有把展开状态说出来").toBe("true");
  });

  it("② 每一项都指向今天真的存在的路由 —— 零死链", async () => {
    await mountHome();
    await openMenu();
    const links = menuLinks();
    expect(links.length, "菜单项没有一个是真的 <a> —— 没有 href 的菜单项跟死按钮是同一种伤").toBe(3);
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(href, "菜单项没有 href").toMatch(/^\//);
      const segment = routeSegment(href);
      const page = segment === "" ? path.join(APP_DIR, "(home)/page.tsx") : path.join(APP_DIR, segment, "page.tsx");
      expect(existsSync(page), `${href} 在 app/ 底下没有对应的 page.tsx —— 这是一条死链`).toBe(true);
    }
  });

  it("③ 菜单里没有 beta V1 藏起来的那几扇门", async () => {
    await mountHome();
    await openMenu();
    const hrefs = menuLinks().map((link) => routeSegment(link.getAttribute("href") ?? ""));
    for (const door of HIDDEN_DOORS) {
      expect(hrefs, `${door} 是 beta 期被藏起来的门,不许从 Home 的菜单里放回去`).not.toContain(routeSegment(door));
    }
  });

  it("④ 样张态里菜单项带着 fixture 参数走,不会把商家甩回生产态", async () => {
    await mountHome(true);
    await openMenu();
    const hrefs = menuLinks().map((link) => link.getAttribute("href") ?? "");
    expect(hrefs.length).toBe(3);
    for (const href of hrefs) {
      expect(href, `${href} 掉了 fixture 参数 —— 从样张点进去会落到生产态那一份`).toContain("fixture=r22");
    }
  });
});
