// @vitest-environment jsdom
/**
 * #995(W2-8)—— 上下文 chip 与页面快捷 chips,在真的商家壳里。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4。
 *
 * 三件事:
 *
 *  ① **上下文 chip 这一票不画**。判官 r1 [P2]:服务端没有任何读者会因为商家在看哪一页
 *     而改变这一轮的上下文,所以「Otto 看得见我这一页」与「关掉它就不看了」都是假话。
 *     解析器留着、围栏留着,chip 随 #879 step 2 启用。
 *  ② **面板仍然认得这一页是哪一页**(纯函数),包括「战役底下的固定子段不是一条战役」。
 *  ③ **快捷 chips 随页面变,而且文案不是这一票新写的**。每一颗的字都必须逐字等于
 *     `GOAL_PRESETS` 里那个目标的 label —— 也就是商家点下去真正发出的那句话。
 *     新写一份文案的那一天,商家的画布就会被我们的 chip 命名(#979 的第三组样本)。
 *
 * 另有两组是判官 r1 两项 P1 的钉板:点进历史看得到内容、开历史不丢正在做的事。
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

const createEmptyCoworkThread = vi.fn();
vi.mock("@/lib/otto-client-actions", () => ({
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: (...args: unknown[]) => createEmptyCoworkThread(...args),
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
const getCoworkThreadClient = vi.fn();
vi.mock("@/lib/cowork-fetch", () => ({
  getCoworkThreadClient: (...args: unknown[]) => getCoworkThreadClient(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MerchantShellContent } = await import("@/components/global-navigation");
const { panelContextSubject, panelQuickChips } = await import("@/components/otto/panel/panel-page");
// 会话体现在由 `OttoPanelHost` 里的 `React.lazy` 分包(收口移植,main P3-6)。先把它取进
// registry,`mount()` 里那两拍 microtask 才等得到落地的结果,不然看到的永远是 Suspense
// fallback(同一处理法见 otto-panel-mount.test.ts)。
await import("@/components/otto/panel/OttoPanelConversation");

const WEB_ROOT = path.resolve(__dirname, "../..");

/** 一条只有 meta 的历史会话 —— 种子里除打开那条以外的每一条都长这样(`messages: []`)。 */
const META_THREAD = {
  id: "t_old",
  projectId: "p_raya",
  title: "Kuih teaser",
  updatedAt: new Date("2026-08-18T02:00:00.000Z").toISOString(),
  messages: [],
};

/** 同一条会话,带着真正的消息 —— `getCoworkThreadClient` 取回来的那一份。 */
function fullThread(text: string) {
  return {
    ...META_THREAD,
    messages: [
      {
        id: "m1",
        role: "USER" as const,
        kind: "TEXT" as const,
        seq: 1,
        text,
        payload: null,
        genJobId: null,
        createdAt: META_THREAD.updatedAt,
      },
    ],
  };
}

const SEED = {
  projectId: "p_raya",
  entities: [],
  projects: [{ id: "p_raya", name: "Raya campaign", pinnedAt: null }],
  threads: [META_THREAD],
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
  getCoworkThreadClient.mockResolvedValue(fullThread("Kuih teaser for Raya"));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});

/**
 * 会话体是 `React.lazy` 分包的,所以要多等几拍:先是 import() 那个 promise,再是 Suspense
 * 提交,再是种子自己那次取数。等的是拍数而不是一个固定 sleep(与 `otto-panel-mount.test.ts`
 * 的 `settle()` 逐字同一份做法)。
 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await settle();
  return container;
}

/**
 * 生产变体的商家壳 —— `MerchantAppShell` 不传 `ottoVariant`,所以商家看到的永远是
 * `r22`(`components/global-navigation.tsx` 的默认值)。这一份考卷必须是那一份:
 * 拿 legacy 去考,考的就不是商家手上那块面板。
 */
function shell(pathname: string, ottoVariant: "legacy" | "r22" = "r22") {
  return createElement(
    MerchantShellContent,
    { pathname, signOutAction: async () => {}, ottoVariant },
    createElement("div", { "data-page": "" }, "Page"),
  );
}

/**
 * R22 首屏只画 compact launcher,面板是收着的、种子也还没取(那条规格钉在
 * `otto-panel-mount.test.ts` 的「R22 Otto 生产默认」)。所以面板**里面**的每一条断言都得先
 * 按这一颗 —— 商家真的要点它一下才看得到 chips、历史与草稿框。少了这一步,下面每一条
 * DOM 断言都会在一块根本没画出来的面板上空过。
 */
async function openPanel(el: HTMLDivElement): Promise<void> {
  // legacy 壳在这个视窗宽度上默认就是开着的(`defaultOttoPanelState`),那时根本没有
  // launcher 可按 —— 只有 r22 才需要这一下。所以按不到就往下走,并且不论哪一条路都要
  // 亲眼看到面板真的在 DOM 里,不然下面每一条断言又回到「在空气上核对」。
  const launcher = el.querySelector<HTMLButtonElement>("[data-otto-launcher]");
  if (launcher) await act(async () => launcher.click());
  await settle();
  expect(el.querySelector("[data-otto-panel]"), "面板没开,下面的断言在核对空气").not.toBeNull();
}

/** 挂上真的商家壳并按开面板 —— 面板内的断言都从这里起步。 */
async function mountOpen(pathname: string, ottoVariant: "legacy" | "r22" = "r22"): Promise<HTMLDivElement> {
  const el = await mount(shell(pathname, ottoVariant));
  await openPanel(el);
  return el;
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

  it("首页只认全等 —— 拿 `/` 当前缀不会把整个站点都算成它的对象", () => {
    // W2-11:Home 换壳后自己就是导航树里第一格(七格骨架的第一个),所以它今天确实有
    // 名字可说了 —— 但 matchShellRoute() 对 home 仍然只认全等(见 panel-page.ts 里
    // `href === SHELL_ROUTES.home` 那个特判),这条真正要钉的是「/ 不会被当成前缀吃掉
    // 别的面」:campaign 必须解出它自己,不能被读成首页的对象。
    expect(panelContextSubject(SHELL_ROUTES.home)).toEqual({
      kind: "page",
      routeKey: "home",
      label: navLinkByKey("home").label,
    });
    expect(panelContextSubject(SHELL_ROUTES.campaign)).toMatchObject({ routeKey: "campaign" });
  });

  it("长的先命中 —— 画布不是 Create 的一个对象,剪辑台也不是 Library 的一个对象", () => {
    const subject = panelContextSubject(SHELL_ROUTES.canvas);
    // canvas 在导航树里没有单独一格(它在 Create 那扇门后面),所以没有 chip;
    // 关键是它没有被读成 `{ objectId: "canvas" }`。
    expect(subject).toBeNull();
    // W2-11:剪辑台的导轨门撤了(规格书 §2.3①,「edit」不再是 MERCHANT_NAV 的一格 ——
    // 这是已知、已上报的可发现性缺口,见 edit-desk-two-surfaces.test.ts),所以它今天
    // 也没有名字可说了(navLabelForRoute 在导航树里找不到它)—— 但它仍然必须落在
    // 自己的 shell 路由上,不能被读成 library 的一个对象。
    expect(panelContextSubject(SHELL_ROUTES.edit)).toBeNull();
    // 换一个今天还真的有导航名字的「子路径压过父路径」例子:connections 在 settings 下面。
    expect(panelContextSubject(SHELL_ROUTES.connections)).toMatchObject({ kind: "page", routeKey: "connections" });
  });

  it("query 与末尾斜杠不影响判定", () => {
    expect(panelContextSubject(`${SHELL_ROUTES.campaign}/abc?tab=plan`)).toMatchObject({ objectId: "abc" });
    expect(panelContextSubject(`${SHELL_ROUTES.library}/`)).toMatchObject({ routeKey: "library" });
  });
});

// ---------------------------------------------------------------------------
// 上下文 chip
// ---------------------------------------------------------------------------
describe("上下文 chip 这一票不画 —— 因为它今天说不出真话", () => {
  /**
   * 判官 r1 [P2]:chip 写着「On this page: Raya promo」,商家读到的是「Otto 看得见我这一页」。
   * 今天没有任何服务端读者会因为这一页是哪一页而改变这一轮的上下文,所以那句话是假的,
   * 「关掉它 Otto 就不看了」也是假的。两句假话不如不说。
   *
   * 这一组断言钉的是**两件事同时成立**:界面上不画,以及解析器仍然备着 —— #879 step 2
   * 接上真读者的那一天,接回两个 prop 就够,不必重做一遍。
   */
  it("任何一面上都不画 chip", async () => {
    for (const location of [SHELL_ROUTES.campaign, `${SHELL_ROUTES.campaign}/01J0000000000000000000000A`]) {
      const el = await mountOpen(location);
      // 面板真的开着才算数 —— 「收着所以没画 chip」不构成这一条的证据。
      expect(el.querySelector("[data-otto-panel]"), location).not.toBeNull();
      expect(el.querySelector("[data-otto-panel-context]"), location).toBeNull();
      expect(el.querySelector("[data-otto-panel][data-otto-panel-context-attached]"), location).toBeNull();
      if (root) await act(async () => root?.unmount());
      container?.remove();
      root = null;
      container = null;
    }
  });

  it("对象页上也没有 —— 名字读得到与否都不改变这一条", async () => {
    const el = await mountOpen(`${SHELL_ROUTES.campaign}/01J0000000000000000000000A`);
    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
    expect(el.querySelector("[data-otto-panel-context]")).toBeNull();
  });

  it("解析器仍然认得这一页与这个对象(#879 step 2 接得上)", () => {
    expect(panelContextSubject(SHELL_ROUTES.campaign)).toEqual({
      kind: "page",
      routeKey: "campaign",
      label: navLinkByKey("campaign").label,
    });
    expect(panelContextSubject(`${SHELL_ROUTES.campaign}/abc`)).toMatchObject({ kind: "object", objectId: "abc" });
  });

  it("战役底下的固定子段不是对象 —— 不许拿它的名字当 id 去查库", () => {
    for (const segment of ["calendar", "trends"]) {
      const subject = panelContextSubject(`${SHELL_ROUTES.campaign}/${segment}`);
      expect(subject, segment).toMatchObject({ kind: "page", routeKey: "campaign" });
      expect(subject && "objectId" in subject, segment).toBe(false);
    }
    expect(panelContextSubject(SHELL_ROUTES.approvals)).toMatchObject({ kind: "page", routeKey: "approvals" });
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

  /**
   * 判官 2026-08-25 的版式判决:R22 的面板只有三格(头 / 会话体 / 体底那格输入框,
   * 原型 L5433-5469),没有第四排 chips。而 r22 的 composer 住在体**里面**,所以这一排画
   * 出来就落在输入框下面,读起来像第二个 footer —— 那正是 Founder 亲验时看到的偏离。
   * 因此这一排只活在 legacy 壳里,下面两条 DOM 断言跟着搬到 legacy 上考。
   * chips 这门能力没有丢:r22 的起手式在体里(fixture 是 `.r22-otto-starters`,真接后端是
   * `OttoFrontDoor` 的目标格),两处与这一排读的是同一份 `GOAL_PRESETS`。
   */
  it("legacy 面板底部真的画出来了,顺序与页面表一致", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign, "legacy");
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

    const el = await mountOpen(SHELL_ROUTES.campaign, "legacy");
    const first = panelQuickChips(SHELL_ROUTES.campaign)[0]!;

    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-quick-chip="${first.goalKey}"]`)!.click();
    });

    expect(createEmptyCoworkThread).toHaveBeenCalledWith({ projectId: SEED.projectId, title: first.label });
  });

  it("商家那块 r22 面板里没有这一排 —— 输入框下面不许再有第二个 footer", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);

    // 先证明面板真的开着,否则下面这条是绿的假象。
    expect(el.querySelector("[data-otto-panel]"), "面板没开,这条在核对空气").not.toBeNull();
    expect(el.querySelector("[data-otto-panel-quick-chips]")).toBeNull();
    expect(el.querySelectorAll("[data-otto-quick-chip]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 头部的历史入口
// ---------------------------------------------------------------------------
describe("头部的会话切换器", () => {
  /**
   * r22 的历史从「盖住会话的一整屏列表」换成了原型那层切换器(`OttoRoomSwitcher`,
   * Cloudflare 四子流那一轮)。这一段考的仍是同三件事 —— 点得开、点得回、选完自己收起来
   * ——只是问的对象换成了那一层。legacy 壳那份列表原样留着,由它自己那几条考。
   */
  it("点开就是切换器,再点回到会话", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);
    const history = el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!;

    expect(el.querySelector("[data-otto-panel-rooms]")).toBeNull();

    await act(async () => history.click());
    expect(el.querySelector("[data-otto-panel-rooms]")).not.toBeNull();
    expect(history.getAttribute("aria-expanded")).toBe("true");

    await act(async () => history.click());
    expect(el.querySelector("[data-otto-panel-rooms]")).toBeNull();
  });

  it("选一条会话 / 开新对话都会把切换器收起来", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);
    const history = el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!;

    await act(async () => history.click());
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-room="${META_THREAD.id}"]`)!.click();
    });
    expect(el.querySelector("[data-otto-panel-rooms]")).toBeNull();

    await act(async () => history.click());
    await act(async () => {
      el.querySelector<HTMLButtonElement>("[data-otto-panel-rooms-new]")!.click();
    });
    expect(el.querySelector("[data-otto-panel-rooms]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 判官 r1 [P1-1] —— 点进历史不是一片空白
// ---------------------------------------------------------------------------
describe("选一条历史会话,消息真的出来 (P1-1)", () => {
  it("meta 会话被选中时把真正的消息取回来,并画出来", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);
    await act(async () => {
      el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!.click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-room="${META_THREAD.id}"]`)!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // ① 真的去取了(种子里这一条只有 meta,不取就只能画空白)。
    expect(getCoworkThreadClient).toHaveBeenCalledWith(META_THREAD.id);
    // ② 取回来的消息真的渲染出来了 —— 断言的是商家看得到的字,不是内部状态。
    expect(el.querySelector<HTMLElement>("[data-otto-panel-body]")!.textContent).toContain("Kuih teaser for Raya");
  });

  it("已经带着消息的那一条不再多取一次", async () => {
    loadOttoPanelSeed.mockResolvedValue({
      ...SEED,
      threads: [{ ...META_THREAD, messages: [{ id: "m1", role: "USER", kind: "TEXT", text: "already here", seq: 1 }] }],
    });

    const el = await mountOpen(SHELL_ROUTES.campaign);
    await act(async () => {
      el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!.click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-room="${META_THREAD.id}"]`)!.click();
    });

    expect(getCoworkThreadClient).not.toHaveBeenCalled();
  });

  it("取数途中改主意开新对话 —— 迟到的结果被丢弃,前门不被拽回", async () => {
    // 取数悬着,直到测试自己放行 —— 「迟到」在这里是可控的,不是靠 sleep 撞运气。
    let release: (value: unknown) => void = () => {};
    getCoworkThreadClient.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    // 这一条要的是「禁用挡不住的第二条意图源」,底部 chip 是最方便的那一颗 —— 它只画在
    // legacy 壳上(r22 的版式判决见上面那条),所以这一条在 legacy 壳上考。守的是意图号,
    // 那道守卫两个变体共用一份,不因为换壳而变。legacy 的历史入口是头部那颗 ☰,不是
    // r22 那颗会话名。
    const el = await mountOpen(SHELL_ROUTES.campaign, "legacy");
    const history = () => el.querySelector<HTMLButtonElement>('[aria-label="Conversation history"]')!;
    await act(async () => {
      history().click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-thread-list-thread="${META_THREAD.id}"]`)!.click();
    });

    // 取数途中:会改变「显示哪一条」的两颗先禁掉(意图号才是真守卫,这只是不必发生的一下)。
    expect(history().disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[aria-label="New conversation"]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>("[data-otto-thread-list-new]")!.disabled).toBe(true);

    // 商家改主意:开新对话(走头部那颗以外的第二条路也一样 —— 这里直接调列表里那颗之外的
    // 意图源,模拟「禁用挡不住的那些路」,例如底部 chip)。
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-quick-chip="${panelQuickChips(SHELL_ROUTES.campaign)[0]!.goalKey}"]`)!.click();
    });

    // 现在那份取数才回来。
    await act(async () => {
      release(fullThread("Kuih teaser for Raya"));
      await Promise.resolve();
    });

    // 没有被拽回旧会话:面板上不是那条历史的内容。
    expect(el.querySelector<HTMLElement>("[data-otto-panel-body]")!.textContent).not.toContain("Kuih teaser for Raya");
    // 也不会为一个已经放弃的动作弹一句错误出来。
    expect(el.querySelector("[data-otto-thread-list-error]")).toBeNull();
  });

  it("取不到就留在列表上说实话,不切过去让商家盯着一片空白", async () => {
    getCoworkThreadClient.mockResolvedValue(null);

    const el = await mountOpen(SHELL_ROUTES.campaign);
    await act(async () => {
      el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!.click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-room="${META_THREAD.id}"]`)!.click();
    });

    expect(el.querySelector("[data-otto-panel-rooms-error]")).not.toBeNull();
    // 切换器还开着 —— 没有切到一条画不出内容的会话上去。
    expect(el.querySelector("[data-otto-panel-rooms]")).not.toBeNull();
  });

  it("那句「打不开」不许跨开合残留 —— 关掉再打开是新的一眼", async () => {
    getCoworkThreadClient.mockResolvedValue(null);

    const el = await mountOpen(SHELL_ROUTES.campaign);
    const history = el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!;
    await act(async () => history.click());
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-room="${META_THREAD.id}"]`)!.click();
    });
    expect(el.querySelector("[data-otto-panel-rooms-error]")).not.toBeNull();

    await act(async () => history.click()); // 关
    await act(async () => history.click()); // 再开

    expect(el.querySelector("[data-otto-panel-rooms]")).not.toBeNull();
    expect(el.querySelector("[data-otto-panel-rooms-error]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 判官 r1 [P1-2] —— 开历史不许把正在做的事丢掉
// ---------------------------------------------------------------------------
describe("开关历史不丢草稿 (P1-2)", () => {
  /** 照 React 的方式改输入框的值,让 onChange 真的跑一遍。 */
  function typeInto(textarea: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("打了一半的字在开关历史之后还在,而且还是同一个输入框(没被卸载重建)", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);
    const composer = el.querySelector<HTMLTextAreaElement>("[data-otto-panel-body] textarea")!;
    await act(async () => typeInto(composer, "Raya promo, 3 posts"));
    expect(composer.value).toBe("Raya promo, 3 posts");

    const history = el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!;
    await act(async () => history.click());
    await act(async () => history.click());

    const after = el.querySelector<HTMLTextAreaElement>("[data-otto-panel-body] textarea")!;
    // 值还在 —— 这是商家看得到的那一半。
    expect(after.value).toBe("Raya promo, 3 posts");
    // 节点是同一个 —— 这是「没有被卸载重建」的证据。换组件类型的写法过不了这一条。
    expect(after).toBe(composer);
  });

  /**
   * r22 的切换器是浮在头部下面的一层,会话连**藏**都不用藏 —— 商家一边看着刚才那段话,
   * 一边挑下一条(Cloudflare 四子流那一轮换的正是这个)。P1-2 那条判词要的是「开历史不许
   * 把正在做的事丢掉」,这一版比藏起来更强:它压根没离开视线。
   *
   * legacy 壳那份盖住整段的列表照旧用 `display:none` 藏,那一条由下面第二个 it 钉住 ——
   * 两个变体各考各的形态,同一条判词。
   */
  it("r22:切换器开着的时候会话还看得见,更不会被卸掉", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);
    await act(async () => {
      el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!.click();
    });

    const wrap = el.querySelector<HTMLElement>("[data-otto-panel-conversation-wrap]")!;
    expect(el.querySelector("[data-otto-panel-rooms]")).not.toBeNull();
    expect(wrap.style.display).toBe("flex");
    // 还在 DOM 里 = `useChat` 实例还在 = 流式那一轮的 onFinish 还写得回去。
    expect(wrap.querySelector("textarea")).not.toBeNull();
  });

  it("legacy:列表盖住会话时会话只是被藏起来,没有被卸掉", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign, "legacy");
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Conversation history"]')!.click();
    });

    const wrap = el.querySelector<HTMLElement>("[data-otto-panel-conversation-wrap]")!;
    expect(wrap.style.display).toBe("none");
    expect(wrap.querySelector("textarea")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 判官 r1 [P2-2] —— chip 点失败要说出来
// ---------------------------------------------------------------------------
describe("chip 点失败照前门的形状说话 (P2-2)", () => {
  it("建会话失败时画出那句话,chips 仍可再点", async () => {
    createEmptyCoworkThread.mockResolvedValue({ error: "You're out of credits." });

    // chips 只画在 legacy 壳上(r22 的版式判决见「页面快捷 chips」那一段)。
    const el = await mountOpen(SHELL_ROUTES.campaign, "legacy");
    const first = panelQuickChips(SHELL_ROUTES.campaign)[0]!;
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-otto-quick-chip="${first.goalKey}"]`)!.click();
    });

    const alert = el.querySelector<HTMLElement>("[data-otto-quick-chip-error]")!;
    expect(alert).not.toBeNull();
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("You're out of credits.");
    // 死按钮不许留下 —— 失败之后还能再试。
    expect(el.querySelector<HTMLButtonElement>(`[data-otto-quick-chip="${first.goalKey}"]`)!.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// beta 卫生 P2-19 —— 头部那颗 ＋ 在已经是新对话时是死的
// ---------------------------------------------------------------------------
/**
 * 面板头部并排两颗都写着 "New conversation":左边那颗是会话名(按下去开切换器),右边
 * 那颗 ＋ 是「换到一条新对话上」。审计实测右边那颗在**新对话状态下**按了什么都不发生 ——
 * 没有 DOM 变化、没有提示、没有报错。它不是坏的,是这一刻本来就无事可做;既然无事可做,
 * 就该看起来不能按。
 *
 * 这两条考的是**真的商家壳 + 真的 host 接线**,不是给组件手喂一个 prop:接线断了(host
 * 忘了传)组件测试照样绿,而商家手上那颗照样是死的。
 */
describe("头部 ＋ 在新对话状态下禁用 (beta 卫生 P2-19)", () => {
  const newChat = (el: HTMLDivElement) => el.querySelector<HTMLButtonElement>('[aria-label="New conversation"]')!;

  it("种子里没有开着的会话 = 面板已经在新对话上,＋ 一开始就是禁用的", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);
    expect(SEED.activeThreadId).toBeNull();
    expect(newChat(el).disabled).toBe(true);
  });

  it("打开一条历史会话之后 ＋ 才活过来;按下去回到新对话,它自己又禁掉", async () => {
    const el = await mountOpen(SHELL_ROUTES.campaign);

    await act(async () => el.querySelector<HTMLButtonElement>("[data-otto-panel-title]")!.click());
    await act(async () => el.querySelector<HTMLButtonElement>(`[data-otto-room="${META_THREAD.id}"]`)!.click());
    await settle();

    // 现在真的有一条会话开着 —— ＋ 有事可做了。
    expect(newChat(el).disabled).toBe(false);

    await act(async () => newChat(el).click());
    await settle();

    // 它做完了它那件事,于是把自己禁掉 —— 商家不会再按到一颗什么都不做的按钮。
    expect(newChat(el).disabled).toBe(true);
  });
});
