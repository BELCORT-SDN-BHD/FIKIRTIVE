// @vitest-environment jsdom
/**
 * otto-mobile-nav-handoff — #747:/otto 手机上两颗汉堡按钮叠罗汉。
 *
 * 病灶(走查在 375px 复现):全局导轨那颗 `fixed left-3 top-3` 40×40 的汉堡,正压在
 * Otto 自己顶栏的 44×44「Open menu」(16,4)上。两颗开的是两个不同抽屉,商家点到哪一颗
 * 全凭运气。同一根因在 681–1023px 也成立:那一档 Otto 顶栏不出现,改由 34×34 的
 * 「Show sidebar」占住 (12,12) —— 依旧和全局那颗同点重叠。
 *
 * 根因:#685 给 Otto 的豁免只免掉了「为按钮预留的高度」,没免掉按钮本身。按钮是
 * `fixed`,不占布局 —— 于是「不预留」恰恰等于「让它压上去」。
 *
 * 修法(Founder 2026-08-08 裁定):自带移动顶栏的页面,连入口一起自己承担 ——
 * 壳不再画那颗浮动汉堡,全局导航改由 Otto 菜单里的一项「Go to…」打开真正的全局抽屉。
 *
 * 这里断言的是行为,不是像素:同屏只剩一个抽屉入口、这个入口真的能把全局抽屉打开、
 * 打开时 Otto 自己的导轨两种打开方式都被关上(否则全局抽屉会开在它下面,z-40 vs z-200,
 * 商家看到的是「点了没反应」)。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/otto"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MerchantShellContent } = await import("@/components/global-navigation");
const { OttoNav } = await import("@/components/otto/OttoNav");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

type NavCallbacks = {
  onDrawerClose: ReturnType<typeof vi.fn>;
  onToggleCollapse: ReturnType<typeof vi.fn>;
};

function ottoNavElement(
  callbacks: NavCallbacks,
  { drawerOpen, collapsed }: { drawerOpen: boolean; collapsed: boolean },
): ReactElement {
  return createElement(OttoNav, {
    view: "otto",
    onViewChange: vi.fn(),
    projects: [],
    activeProjectId: "p1",
    sidebarThreads: [],
    activeThreadId: null,
    onSelectThread: vi.fn(),
    onSwitchProject: vi.fn(),
    onNewChat: vi.fn(),
    onRenameProject: vi.fn(),
    onSetProjectPinned: vi.fn(),
    onDeleteProject: vi.fn(),
    onNewProject: vi.fn(async () => true),
    onRenameThread: vi.fn(),
    onSetThreadPinned: vi.fn(),
    onDeleteThread: vi.fn(),
    drawerOpen,
    collapsed,
    onDrawerClose: callbacks.onDrawerClose,
    onToggleCollapse: callbacks.onToggleCollapse,
  });
}

/** The real composition on /otto: the merchant shell with Otto's own rail inside it. */
async function mountOttoSurface(
  state: { drawerOpen: boolean; collapsed: boolean } = { drawerOpen: true, collapsed: true },
): Promise<{ container: HTMLDivElement; callbacks: NavCallbacks }> {
  const callbacks: NavCallbacks = { onDrawerClose: vi.fn(), onToggleCollapse: vi.fn() };
  const dom = await mount(
    createElement(
      MerchantShellContent,
      { pathname: "/otto", signOutAction: vi.fn(async () => undefined) },
      ottoNavElement(callbacks, state),
    ),
  );
  return { container: dom, callbacks };
}

function goToButton(dom: HTMLElement): HTMLButtonElement | undefined {
  return [...dom.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Go to"),
  ) as HTMLButtonElement | undefined;
}

/** The global drawer is the `aside` the rail lives in; open = it is not translated away. */
function globalDrawerOpen(dom: HTMLElement): boolean {
  const aside = dom.querySelector("aside");
  expect(aside).not.toBeNull();
  return !aside!.className.includes("-translate-x-full");
}

describe("/otto mobile navigation entry", () => {
  it("draws no second hamburger over Otto's own", async () => {
    const { container: dom } = await mountOttoSurface();

    expect(dom.querySelector('[aria-label="Open navigation"]')).toBeNull();
    // Otto's own bar is not part of this tree (OttoApp draws it), so what is proven here
    // is the half the shell owns: on this surface the shell contributes zero triggers.
  });

  it("still draws the shell's trigger on a surface that has no top bar of its own", async () => {
    const dom = await mount(
      createElement(MerchantShellContent, {
        pathname: "/billing",
        signOutAction: vi.fn(async () => undefined),
      }),
    );

    expect(dom.querySelector('[aria-label="Open navigation"]')).not.toBeNull();
  });

  it("offers exactly one Go to entry inside Otto's own menu", async () => {
    const { container: dom } = await mountOttoSurface();

    const matches = [...dom.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("Go to"),
    );
    expect(matches).toHaveLength(1);
    // Hidden from 1024px up, where the global rail is permanently on screen already.
    expect(matches[0]!.closest("div")!.className).toContain("lg:hidden");
  });

  it("opens the real global drawer when Go to is pressed", async () => {
    const { container: dom } = await mountOttoSurface();

    expect(globalDrawerOpen(dom)).toBe(false);

    const button = goToButton(dom);
    expect(button).toBeDefined();
    await act(async () => button!.click());

    expect(globalDrawerOpen(dom)).toBe(true);
    // It opens the real thing, not a copy: credits, Profile and Sign out come with it.
    expect(dom.querySelector('a[href="/profile"]')).not.toBeNull();
    expect(dom.querySelector('a[href="/campaign"]')).not.toBeNull();
    expect(dom.querySelector('a[href="/crm/inbox"]')).not.toBeNull();
  });

  it("closes Otto's rail on the way, whichever way it was open", async () => {
    const fromDrawer = await mountOttoSurface({ drawerOpen: true, collapsed: true });
    await act(async () => goToButton(fromDrawer.container)!.click());
    expect(fromDrawer.callbacks.onDrawerClose).toHaveBeenCalled();
    // Already collapsed — toggling here would REOPEN it under the global drawer.
    expect(fromDrawer.callbacks.onToggleCollapse).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    container?.remove();
    root = null;

    const fromExpanded = await mountOttoSurface({ drawerOpen: false, collapsed: false });
    await act(async () => goToButton(fromExpanded.container)!.click());
    expect(fromExpanded.callbacks.onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("offers no Go to outside the merchant shell, where there is no global drawer", async () => {
    // /skin-preview mounts the real Otto shell with mock data and no global navigation.
    const dom = await mount(
      ottoNavElement(
        { onDrawerClose: vi.fn(), onToggleCollapse: vi.fn() },
        { drawerOpen: true, collapsed: true },
      ),
    );

    expect(goToButton(dom)).toBeUndefined();
  });
});
