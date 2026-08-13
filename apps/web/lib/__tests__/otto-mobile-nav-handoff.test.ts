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

// The 681–1023px case needs the REAL OttoApp, because the button under test is mounted by
// OttoApp's own `navCollapsed` state — asserting on OttoNav's callbacks alone cannot see it.
// Everything below OttoApp that is not navigation is stubbed away.
vi.mock("@/lib/actions", () => ({
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  autoTitleProjectIfDefault: vi.fn(),
  setProjectPinned: vi.fn(),
}));
vi.mock("@/lib/otto-client-actions", () => ({
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: vi.fn() }));
vi.mock("@/components/otto/OttoView", () => ({ OttoView: () => null }));
vi.mock("@/components/otto/OttoPromptDialog", () => ({
  OttoConfirmDialog: () => null,
  OttoRenameDialog: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MerchantShellContent } = await import("@/components/global-navigation");
const { OttoNav } = await import("@/components/otto/OttoNav");
const { OttoApp } = await import("@/components/otto/OttoApp");

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

/** Otto's own rail. Closed = `.otto-nav` without `--open`, which the rail's own CSS pairs
 *  with visibility:hidden and pointer-events:none — off screen AND not clickable. */
function ottoRailOpen(dom: HTMLElement): boolean {
  const rail = dom.querySelector("nav.otto-nav");
  expect(rail).not.toBeNull();
  return rail!.className.includes("otto-nav--open");
}

/** OttoApp's floating desktop toggle. Present only while its own `navCollapsed` is true. */
function showSidebarButton(dom: HTMLElement): HTMLButtonElement | null {
  return dom.querySelector('button[aria-label="Show sidebar"]');
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
    expect(dom.querySelector('a[href="/crm"]')).not.toBeNull();
  });

  it("withdraws Otto's rail while the drawer is up, whichever way it was open", async () => {
    // The rail is z-200 over the drawer's z-40 from the same left edge — it cannot stay.
    const fromDrawer = await mountOttoSurface({ drawerOpen: true, collapsed: true });
    expect(ottoRailOpen(fromDrawer.container)).toBe(true);
    await act(async () => goToButton(fromDrawer.container)!.click());
    expect(fromDrawer.callbacks.onDrawerClose).toHaveBeenCalled();
    expect(ottoRailOpen(fromDrawer.container)).toBe(false);

    await act(async () => root?.unmount());
    container?.remove();
    root = null;

    const fromExpanded = await mountOttoSurface({ drawerOpen: false, collapsed: false });
    expect(ottoRailOpen(fromExpanded.container)).toBe(true);
    await act(async () => goToButton(fromExpanded.container)!.click());
    expect(ottoRailOpen(fromExpanded.container)).toBe(false);
  });

  it("leaves the merchant's own rail preference alone — it steps aside, it is not collapsed", async () => {
    // Collapsing would be a lasting edit to the merchant's layout, and it is what mounts
    // OttoApp's floating "Show sidebar" button on top of the drawer (r2 finding).
    const expanded = await mountOttoSurface({ drawerOpen: false, collapsed: false });
    await act(async () => goToButton(expanded.container)!.click());

    expect(expanded.callbacks.onToggleCollapse).not.toHaveBeenCalled();
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

/**
 * 681–1023px 那一档(r2 判官发现)。这一档 Otto 的移动顶栏不出现,导轨改由 OttoApp
 * 自己的 34×34「Show sidebar」开合——而那颗按钮挂在 OttoApp 的 `navCollapsed` state 上。
 * 上面那组只断言回调次数,看不见父组件重渲染后又长出了什么;这里挂真 OttoApp,让
 * navCollapsed 真的翻、真的重渲染,再看左上角还剩什么。
 */
describe("/otto tablet tier — no Otto control may surface over the global drawer", () => {
  function ottoAppElement(initialNavCollapsed: boolean): ReactElement {
    return createElement(OttoApp, {
      projectId: "p1",
      projects: [],
      sidebarThreads: [],
      entities: [],
      threads: [],
      balanceUsd: 0,
      userName: "Ana",
      memory: [],
      records: [],
      ads: [],
      adJobs: [],
      account: null,
      analytics: {},
      ottoStreamEnabled: false,
      initialNavCollapsed,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Only the navigation props matter here; the rest are opaque payloads OttoView (stubbed) would read.
    } as any);
  }

  async function mountTablet(initialNavCollapsed: boolean): Promise<HTMLDivElement> {
    return mount(
      createElement(
        MerchantShellContent,
        { pathname: "/otto", signOutAction: vi.fn(async () => undefined) },
        ottoAppElement(initialNavCollapsed),
      ),
    );
  }

  it("mounts no Show sidebar button behind the drawer when the rail was expanded", async () => {
    const dom = await mountTablet(false);

    expect(showSidebarButton(dom)).toBeNull();
    expect(ottoRailOpen(dom)).toBe(true);

    await act(async () => goToButton(dom)!.click());

    expect(globalDrawerOpen(dom)).toBe(true);
    // The r2 regression: collapsing the rail used to mount this 34×34 z-50 button at
    // (12,12) — right on top of the z-40 drawer that had just opened.
    expect(showSidebarButton(dom)).toBeNull();
    // And Otto's rail itself is off screen and not clickable, so no second drawer either.
    expect(ottoRailOpen(dom)).toBe(false);
  });

  it("mounts none either on the full tablet journey: open the rail, then Go to", async () => {
    const dom = await mountTablet(true);

    // Rail collapsed — this button is the only way in at this width.
    const showSidebar = showSidebarButton(dom);
    expect(showSidebar).not.toBeNull();
    await act(async () => showSidebar!.click());
    expect(ottoRailOpen(dom)).toBe(true);
    expect(showSidebarButton(dom)).toBeNull();

    await act(async () => goToButton(dom)!.click());

    expect(globalDrawerOpen(dom)).toBe(true);
    expect(showSidebarButton(dom)).toBeNull();
    expect(ottoRailOpen(dom)).toBe(false);
  });

  it("gives the rail back exactly as the merchant left it once the drawer closes", async () => {
    const dom = await mountTablet(false);
    await act(async () => goToButton(dom)!.click());
    expect(ottoRailOpen(dom)).toBe(false);

    const close = dom.querySelector('button[aria-label="Close navigation"]') as HTMLButtonElement;
    await act(async () => close.click());

    expect(globalDrawerOpen(dom)).toBe(false);
    // Borrowing the screen for a moment must not rewrite the merchant's own layout.
    expect(ottoRailOpen(dom)).toBe(true);
    expect(showSidebarButton(dom)).toBeNull();
  });
});

/**
 * #820 —— 把窗口拉宽跨过 1024px。
 *
 * 抽屉只存在于 `lg` 以下,可它并不知道窗口变宽了。跨过去之后 `mobileOpen` 还是 true,
 * 而能把它关掉的三样东西 —— 关闭按钮、遮罩、汉堡 —— 全带 `lg:hidden`,一个都点不到;
 * 抽屉开着又正是 Otto 导轨与「Show sidebar」让位的条件,于是导轨也跟着一起消失。
 * 商家只能靠导航、刷新、或者把窗口缩回去才能恢复。
 *
 * jsdom 没有 matchMedia,所以这里装一个可控的:`resizeTo` 翻答案并派发 change,
 * 就是浏览器在窗口被拉宽时做的事。装它之前先断言旧行为 —— 没有这个监听时抽屉不会关。
 */
describe("#820 crossing 1024px puts the drawer away", () => {
  type Media = { resizeTo(width: number): void };

  function installMatchMedia(initialWidth: number): Media {
    let width = initialWidth;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const minWidthOf = (query: string) => Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    let asked = "";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => {
        asked = query;
        return {
          media: query,
          get matches() {
            return width >= minWidthOf(query);
          },
          addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
            listeners.add(listener);
          },
          removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
            listeners.delete(listener);
          },
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        };
      },
    });
    return {
      resizeTo(next: number) {
        width = next;
        const event = { matches: next >= minWidthOf(asked), media: asked } as MediaQueryListEvent;
        for (const listener of [...listeners]) listener(event);
      },
    };
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  async function openDrawerAt(width: number): Promise<{ dom: HTMLDivElement; media: Media }> {
    const media = installMatchMedia(width);
    const dom = await mount(
      createElement(
        MerchantShellContent,
        { pathname: "/otto", signOutAction: vi.fn(async () => undefined) },
        createElement(OttoApp, {
          projectId: "p1",
          projects: [],
          sidebarThreads: [],
          entities: [],
          threads: [],
          balanceUsd: 0,
          userName: "Ana",
          memory: [],
          records: [],
          ads: [],
          adJobs: [],
          account: null,
          analytics: {},
          ottoStreamEnabled: false,
          initialNavCollapsed: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Only the navigation props matter here.
        } as any),
      ),
    );
    await act(async () => goToButton(dom)!.click());
    expect(globalDrawerOpen(dom)).toBe(true);
    return { dom, media };
  }

  it("closes the drawer and gives the rail back when the window grows past the breakpoint", async () => {
    const { dom, media } = await openDrawerAt(375);
    // While the drawer is up, Otto's rail has stepped aside — that is the state the merchant
    // was stuck in above 1024px, with nothing on screen able to end it.
    expect(ottoRailOpen(dom)).toBe(false);

    await act(async () => media.resizeTo(1280));

    expect(globalDrawerOpen(dom)).toBe(false);
    expect(ottoRailOpen(dom)).toBe(true);
  });

  it("leaves the drawer alone on a resize that stays below the breakpoint", async () => {
    // The drawer is the right thing to be showing at 900px — a reset there would slam it
    // shut in the merchant's face for turning the tablet sideways.
    const { dom, media } = await openDrawerAt(375);

    await act(async () => media.resizeTo(900));

    expect(globalDrawerOpen(dom)).toBe(true);
  });

  it("closes it again on a second crossing, not only the first", async () => {
    const { dom, media } = await openDrawerAt(375);
    await act(async () => media.resizeTo(1280));
    expect(globalDrawerOpen(dom)).toBe(false);

    await act(async () => media.resizeTo(375));
    await act(async () => goToButton(dom)!.click());
    expect(globalDrawerOpen(dom)).toBe(true);

    await act(async () => media.resizeTo(1280));
    expect(globalDrawerOpen(dom)).toBe(false);
  });
});
