// @vitest-environment jsdom
/**
 * #995(W2-8)—— 上下文 chip 与页面快捷 chips,在真的商家壳里。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4。
 *
 * 三件事只有在「面板真的知道商家在看哪一页」之后才成立:
 *
 *  ① **上下文 chip 说的是真名字**。在一条战役页上写的是这条战役自己的名字(从数据库读),
 *     不是 id、不是「Campaign」。读不到就不画 —— 编一个名字比不画更糟。
 *  ② **关得掉,而且关掉之后不再自动带上下文**。断言看的是面板上那条状态
 *     (`data-otto-panel-context-attached`),不是「少了一个 div」:chip 本来就可能因为
 *     这一页没有上下文而不在,两件事必须分得开。
 *  ③ **快捷 chips 随页面变,而且文案不是这一票新写的**。每一颗的字都必须逐字等于
 *     `GOAL_PRESETS` 里那个目标的 label —— 也就是商家点下去真正发出的那句话。
 *     新写一份文案的那一天,商家的画布就会被我们的 chip 命名(#979 的第三组样本)。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GOAL_PRESETS } from "@fikirtive/core/goals";
import { SHELL_ROUTES, navLinkByKey } from "@fikirtive/core/navigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/campaign"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));

const loadOttoPanelSeed = vi.fn();
vi.mock("@/lib/otto-panel-seed", () => ({ loadOttoPanelSeed: () => loadOttoPanelSeed() }));

const loadOttoPanelContextName = vi.fn();
vi.mock("@/lib/otto-panel-context", () => ({
  loadOttoPanelContextName: (...args: unknown[]) => loadOttoPanelContextName(...args),
}));

const createEmptyCoworkThread = vi.fn();
vi.mock("@/lib/otto-client-actions", () => ({
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: (...args: unknown[]) => createEmptyCoworkThread(...args),
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MerchantShellContent } = await import("@/components/global-navigation");
const { panelContextSubject, panelQuickChips } = await import("@/components/otto/panel/panel-page");

const WEB_ROOT = path.resolve(__dirname, "../..");

const SEED = {
  projectId: "p_raya",
  entities: [],
  projects: [{ id: "p_raya", name: "Raya campaign", pinnedAt: null }],
  threads: [],
  activeThreadId: null,
  balanceUsd: 12,
  userName: "Aisyah",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  // 点一颗 chip 会把会话流画出来,而它挂了 use-stick-to-bottom(jsdom 没有 ResizeObserver)。
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, writable: true, configurable: true });
  window.localStorage.clear();
  loadOttoPanelSeed.mockResolvedValue(SEED);
  loadOttoPanelContextName.mockResolvedValue(null);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
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
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function shell(pathname: string) {
  return createElement(
    MerchantShellContent,
    { pathname, signOutAction: async () => {} },
    createElement("div", { "data-page": "" }, "Page"),
  );
}

// ---------------------------------------------------------------------------
// 纯函数:这一页是什么
// ---------------------------------------------------------------------------
describe("面板知道商家在看哪一页 (§3.4)", () => {
  it("一页 → 它在导航里的名字,不是路径", () => {
    const subject = panelContextSubject(SHELL_ROUTES.library);
    expect(subject).toEqual({ kind: "page", routeKey: "library", label: navLinkByKey("library").label });
  });

  it("一个对象 → 只交出身份,名字由取数那一步给", () => {
    expect(panelContextSubject(`${SHELL_ROUTES.campaign}/abc`)).toEqual({
      kind: "object",
      routeKey: "campaign",
      objectKind: "campaign",
      objectId: "abc",
    });
  });

  it("首页只认全等 —— 拿 `/` 当前缀会把整个站点都算成它的对象", () => {
    // 首页在导航树里没有一格,所以它没有可说的上下文 —— 但它绝不能把别的面吃掉。
    expect(panelContextSubject(SHELL_ROUTES.home)).toBeNull();
    expect(panelContextSubject(SHELL_ROUTES.campaign)).not.toBeNull();
  });

  it("长的先命中 —— 画布不是 Create 的一个对象", () => {
    const subject = panelContextSubject(SHELL_ROUTES.canvas);
    // canvas 在导航树里没有单独一格(它在 Create 那扇门后面),所以没有 chip;
    // 关键是它没有被读成 `{ objectId: "canvas" }`。
    expect(subject).toBeNull();
    expect(panelContextSubject(SHELL_ROUTES.edit)).toMatchObject({ kind: "page", routeKey: "edit" });
  });

  it("query 与末尾斜杠不影响判定", () => {
    expect(panelContextSubject(`${SHELL_ROUTES.campaign}/abc?tab=plan`)).toMatchObject({ objectId: "abc" });
    expect(panelContextSubject(`${SHELL_ROUTES.library}/`)).toMatchObject({ routeKey: "library" });
  });
});

// ---------------------------------------------------------------------------
// 上下文 chip
// ---------------------------------------------------------------------------
describe("上下文 chip", () => {
  it("在一条战役上写这条战役的真名字", async () => {
    loadOttoPanelContextName.mockResolvedValue({ name: "Raya promo" });

    const el = await mount(shell(`${SHELL_ROUTES.campaign}/01J0000000000000000000000A`));
    const chip = el.querySelector<HTMLElement>("[data-otto-panel-context]")!;

    expect(loadOttoPanelContextName).toHaveBeenCalledWith("campaign", "01J0000000000000000000000A");
    expect(chip.textContent).toContain("On this page: Raya promo");
    // id 不许露在商家眼前。
    expect(chip.textContent).not.toContain("01J0000000000000000000000A");
  });

  it("名字读不到就不画 —— 不用 id 顶替,也不编一个", async () => {
    loadOttoPanelContextName.mockResolvedValue(null);

    const el = await mount(shell(`${SHELL_ROUTES.campaign}/01J0000000000000000000000A`));

    expect(el.querySelector("[data-otto-panel-context]")).toBeNull();
    expect(el.querySelector("[data-otto-panel][data-otto-panel-context-attached]")).toBeNull();
  });

  it("列表页写那一页的名字,一次取数都不做", async () => {
    const el = await mount(shell(SHELL_ROUTES.campaign));

    expect(el.querySelector("[data-otto-panel-context]")!.textContent).toContain(
      `On this page: ${navLinkByKey("campaign").label}`,
    );
    expect(loadOttoPanelContextName).not.toHaveBeenCalled();
  });

  it("关掉之后 chip 消失,而且本次会话不再自动带上下文", async () => {
    const el = await mount(shell(SHELL_ROUTES.campaign));

    // 关之前:面板上明写着「这一轮带着上下文」。
    expect(el.querySelector("[data-otto-panel][data-otto-panel-context-attached]")).not.toBeNull();

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Stop using this page as context"]')!.click();
    });

    expect(el.querySelector("[data-otto-panel-context]")).toBeNull();
    // 状态断言:少了一个 div 不算数,面板必须说它不再带上下文了。
    expect(el.querySelector("[data-otto-panel][data-otto-panel-context-attached]")).toBeNull();
  });

  it("关掉之后换一条会话也不会自己回来", async () => {
    const el = await mount(shell(SHELL_ROUTES.campaign));
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Stop using this page as context"]')!.click();
    });

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click();
    });

    expect(el.querySelector("[data-otto-panel][data-otto-panel-context-attached]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 快捷 chips
// ---------------------------------------------------------------------------
describe("页面快捷 chips", () => {
  it("每一页 3–4 颗,而且随页面变", () => {
    const home = panelQuickChips(SHELL_ROUTES.home).map((c) => c.goalKey);
    const schedule = panelQuickChips(SHELL_ROUTES.schedule).map((c) => c.goalKey);
    const library = panelQuickChips(SHELL_ROUTES.library).map((c) => c.goalKey);

    for (const set of [home, schedule, library]) {
      expect(set.length).toBeGreaterThanOrEqual(3);
      expect(set.length).toBeLessThanOrEqual(4);
    }
    expect(home).not.toEqual(schedule);
    expect(home).not.toEqual(library);
    // 规格书点名的那两颗。
    expect(home).toContain("plan-campaign");
    expect(schedule).toContain("fill-week");
  });

  it("对象页跟着它所在的那一面走", () => {
    expect(panelQuickChips(`${SHELL_ROUTES.campaign}/abc`).map((c) => c.goalKey)).toEqual(
      panelQuickChips(SHELL_ROUTES.campaign).map((c) => c.goalKey),
    );
  });

  it("每一颗的字都来自 GOAL_PRESETS —— 这一票没有新写的文案", () => {
    for (const route of Object.values(SHELL_ROUTES)) {
      for (const chip of panelQuickChips(route)) {
        expect(chip.label, `${route} 上的 ${chip.goalKey}`).toBe(GOAL_PRESETS[chip.goalKey].label);
      }
    }
  });

  it("chips 组件与页面表都不自己写标签", () => {
    const labels = Object.values(GOAL_PRESETS).map((g) => g.label);
    for (const file of ["components/otto/panel/OttoQuickChips.tsx", "components/otto/panel/panel-page.ts"]) {
      const source = readFileSync(path.join(WEB_ROOT, file), "utf8");
      for (const label of labels) {
        expect(source, `${file} 又手写了标签「${label}」`).not.toContain(`"${label}"`);
      }
    }
  });

  it("面板底部真的画出来了,顺序与页面表一致", async () => {
    const el = await mount(shell(SHELL_ROUTES.campaign));
    const rendered = [...el.querySelectorAll<HTMLElement>("[data-otto-quick-chip]")];

    expect(rendered.map((n) => n.getAttribute("data-otto-quick-chip"))).toEqual(
      panelQuickChips(SHELL_ROUTES.campaign).map((c) => c.goalKey),
    );
    expect(rendered.map((n) => n.textContent)).toEqual(
      panelQuickChips(SHELL_ROUTES.campaign).map((c) => c.label),
    );
  });

  it("点一颗 = 开一条新会话,把那句话交给会话流(与前门同一条路)", async () => {
    createEmptyCoworkThread.mockResolvedValue({ id: "t_new" });

    const el = await mount(shell(SHELL_ROUTES.campaign));
    const first = panelQuickChips(SHELL_ROUTES.campaign)[0]!;

    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-quick-chip="${first.goalKey}"]`)!.click();
    });

    expect(createEmptyCoworkThread).toHaveBeenCalledWith({ projectId: SEED.projectId, title: first.label });
  });
});

// ---------------------------------------------------------------------------
// 头部的历史入口
// ---------------------------------------------------------------------------
describe("头部的 ☰ 历史", () => {
  it("点开就是列表,再点回到会话", async () => {
    const el = await mount(shell(SHELL_ROUTES.campaign));
    const history = el.querySelector<HTMLButtonElement>('[aria-label="Conversation history"]')!;

    expect(el.querySelector("[data-otto-thread-list]")).toBeNull();

    await act(async () => history.click());
    expect(el.querySelector("[data-otto-thread-list]")).not.toBeNull();
    expect(history.getAttribute("aria-pressed")).toBe("true");

    await act(async () => history.click());
    expect(el.querySelector("[data-otto-thread-list]")).toBeNull();
  });
});
