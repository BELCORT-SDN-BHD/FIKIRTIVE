// @vitest-environment jsdom
/**
 * Home 右上角那一组,和「换屏」这件事本身。
 *
 * 起因是 Founder 的截图:右上角的铃 + 「NA」头像 + chevron 是死的,换屏的等待画面难看、
 * 整个 dashboard 不流畅。这份测试钉住修完之后的两条不变量:
 *
 *  ① 右上角三件都接在**真东西**上,而且不是第二份实现 —— 菜单只有一份,首字母与 badge
 *     都从同一个源头派生,没有写死的 `NA`、没有写死的数字。
 *  ② 每一扇门都有等待画面,而且等待画面与落定画面**用同一批容器 class** —— 几何由同一份
 *     CSS 出,内容一到不跳。这比逐个抄尺寸再断言尺寸强:抄来的数字会各自漂移,
 *     共用的 class 不会。
 *
 * 骨架不许循环动效那条(原型 L1249「刻意静止」)在这里钉的是 `data-r22-skeleton` 这个
 * 挂钩在不在 —— 真正把 `animate-pulse` 按住的规则在 r22-dashboard.css,属样式围栏的活。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { merchantNavLinks } from "@fikirtive/core/navigation";
import { HomeView } from "@/components/home/HomeView";
import { readOk, type HomeData } from "@/components/home/home-data";
import HomeLoading from "@/app/(home)/loading";
import ApprovalsLoading from "@/app/approvals/loading";
import CreateLoading from "@/app/create/loading";
import LibraryLoading from "@/app/library/loading";
import RoutinesLoading from "@/app/routines/loading";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/global-search-actions", () => ({
  loadGlobalSearchProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));

/** Esc 剥层那组测试要能断言 closePanel 有没有被叫到,所以把它提到模块外面自己控。 */
const { closePanelSpy } = vi.hoisted(() => ({ closePanelSpy: vi.fn() }));
vi.mock("@/components/otto/panel/OttoPanelShell", () => ({
  useOttoPanelControls: () => ({
    open: false,
    mode: "docked",
    expanded: false,
    hydrated: true,
    dockedWidth: 0,
    openPanel: vi.fn(),
    closePanel: closePanelSpy,
    togglePanel: vi.fn(),
    toggleExpanded: vi.fn(),
  }),
}));

const APP_DIR = path.resolve(__dirname, "../../app");

function source(relative: string): string {
  return readFileSync(path.join(APP_DIR, relative), "utf8");
}

const HOME_DATA: HomeData = {
  greeting: "Good morning, Nadia",
  credits: readOk("1,240 credits"),
  canvases: readOk([]), thumbs: readOk([]), upcoming: readOk([]), campaigns: readOk([]), equipment: readOk([]),
};

/** 落定画面与等待画面共用的那一批容器 —— 几何全靠它们。
 *
 * `r22-home-connection-steps` 与 `r22-home-context-row` 退场(Home 收静,Founder
 * 2026-08-25 批的样张):落定版把竖排时间线换成了 `.r22-home-stepper` 单行步进器、把
 * `context-row` 整块删掉(按钮并进了 `.r22-home-create-row`)。Home 收尾这一票把骨架
 * (`app/(home)/loading.tsx`)也换成了同一副新几何 —— 步进器归位连接卡内一行、分析卡换成
 * 芯片行 —— 两个旧容器连骨架那一侧也不画了,`r22-home.css` 里对应的规则已经删除,不再是
 * 已知落差。`r22-home-stepper` / `r22-home-skip` 两个新容器补进清单:它们是新形状里骨架
 * 与落定共用的那几行。
 *
 * `r22-home-analysis` / `r22-home-analysis-chips` 2026-08-26 退出清单:「Otto will analyse」
 * 承诺块整块撤下(Founder 裁决),落定页不画,骨架也不画 —— 骨架画一张落定页没有的卡,
 * 正是这份文件立起来要防的那次跳屏。
 *
 * 2026-08-26 深夜同一条纪律再走一轮:连接卡与 Performance 整体闸进幕后(Founder ——
 * social media connect 还没准备好,beta V1 只做 creation),`connectionSurface` 默认关。
 * 连接卡那六个容器(`connect-card` / `connect-copy` / `channels` / `channel` / `stepper` /
 * `skip`)与洞察网格那两个(`insight-grid` / `performance`)因此一起退出清单:默认第一屏
 * 不画它们,骨架也就不许画。**它们没有被删** —— 深链 `?connection=` 下这八个容器照常长出来,
 * 只是那条路径不是骨架要对齐的那一屏。 */
const HOME_GEOMETRY_CONTAINERS = [
  "r22-home",
  "r22-home-header",
  "r22-home-create-row",
];

describe("Home 骨架与落定同几何", () => {
  const skeleton = renderToStaticMarkup(h(HomeLoading));
  const settled = renderToStaticMarkup(h(HomeView, { data: HOME_DATA, connection: { kind: "not_connected" } }));

  it.each(HOME_GEOMETRY_CONTAINERS)("骨架和落定都用 .%s 这一个容器", (className) => {
    expect(skeleton, `骨架少了 ${className}`).toContain(className);
    expect(settled, `落定少了 ${className}`).toContain(className);
  });

  it("骨架不再画换壳以前那个居中窄栏", () => {
    // 旧版骨架是 `mx-auto max-w-5xl` 的居中 1024px 栏,而真 Home 是满宽左对齐、
    // padding 38px 48px 18px。这一条就是那次整屏跳变的来源。
    expect(skeleton).not.toContain("max-w-5xl");
    expect(skeleton).not.toContain("mx-auto");
  });

  it("骨架的根就是 .r22-home 本身,不是另包一层自己的 main", () => {
    expect(skeleton.startsWith('<div class="r22-home"')).toBe(true);
  });

  /**
   * 上面那张清单只管「落定有的,骨架也得有」。反过来那一半才是跳屏真正的来源:骨架画了
   * 一块落定页没有的东西,内容一到那块就整个消失,版面往上塌一截。
   *
   * 连接卡与 Performance 闸进幕后之后,这一半必须有人钉 —— 否则清单缩短反而变成一道更松的
   * 闸:把那八个容器留在骨架里,清单一条都不会红。这里改成扫**骨架自己画了哪些 r22-home-***,
   * 逐个回落定页里找。
   */
  it("骨架不画落定页没有的块 —— 反向也得对上,否则内容一到就往上塌一截", () => {
    const drawn = [...new Set([...skeleton.matchAll(/class="([^"]*)"/g)]
      .flatMap((match) => match[1].split(/\s+/))
      .filter((token) => token.startsWith("r22-home")))];
    expect(drawn.length, "骨架一个 r22-home-* 容器都没画到 —— 这条在核对空气").toBeGreaterThan(2);
    for (const className of drawn) {
      expect(settled, `骨架画了落定页没有的 .${className}`).toContain(className);
    }
  });

  /** 创作入口那一行在闸后是 Home 上唯一的一块,落定页给它 `is-primary` 换了个量级 ——
   *  骨架不跟着换,第一帧那张卡就比落定后矮 23px,内容一到整页往下推一截。 */
  it("创作入口那一行的 is-primary 量级,骨架与落定页一起换", () => {
    expect(skeleton, "骨架还在画闸前那条窄带").toContain('class="r22-home-create-row is-primary"');
    expect(settled, "落定页没给这一行 is-primary").toContain('class="r22-home-create-row is-primary"');
  });
});

describe("每一扇门都有等待画面", () => {
  /** 门 → 它的等待画面文件。`loading.tsx` 覆盖本段与它下面所有没有自己等待画面的子段。 */
  const LOADING_FOR_DOOR: Record<string, string> = {
    "/": "(home)/loading.tsx",
    "/create": "create/loading.tsx",
    "/library": "library/loading.tsx",
    "/brand": "brand/loading.tsx",
    "/campaign": "campaign/loading.tsx",
    "/approvals": "approvals/loading.tsx",
    "/schedule": "schedule/loading.tsx",
    "/schedule/analytics": "schedule/loading.tsx",
    "/routines": "routines/loading.tsx",
    "/settings": "settings/loading.tsx",
    "/settings/connections": "settings/connections/loading.tsx",
    "/billing": "billing/loading.tsx",
  };

  it("导航登记表里的每一个目的地都在名单上 —— 新开一扇门就得给它一张等待画面", () => {
    const destinations = merchantNavLinks().map((item) => item.href);
    for (const href of destinations) {
      expect(LOADING_FOR_DOOR[href], `${href} 没有等待画面,商家按下去那一段没有任何回应`).toBeTruthy();
    }
  });

  it.each(Object.entries(LOADING_FOR_DOOR))("%s 的等待画面读得到", (_href, file) => {
    expect(source(file).length).toBeGreaterThan(0);
  });

  it.each([
    ["Home", HomeLoading],
    ["Approvals", ApprovalsLoading],
    ["Create", CreateLoading],
    ["Library", LibraryLoading],
    ["Routines", RoutinesLoading],
  ] as const)("%s 的骨架挂着 data-r22-skeleton(循环动效的总闸)", (_name, Component) => {
    expect(renderToStaticMarkup(h(Component))).toContain("data-r22-skeleton");
  });

  it.each([
    ["Approvals", ApprovalsLoading, "r22-approvals"],
    ["Create", CreateLoading, "r22-projects"],
    ["Library", LibraryLoading, "r22-library"],
    ["Routines", RoutinesLoading, "r22-routines"],
  ] as const)("%s 的骨架用落定画面同一个根容器 .%s", (_name, Component, rootClass) => {
    expect(renderToStaticMarkup(h(Component))).toContain(`class="${rootClass}"`);
  });

  /**
   * Library 的骨架单拎出来钉一遍**双栏**这件事。
   *
   * 上一版画的是 880px 单栏六方块 —— 那是工作台重建之前的形状,落定页早就是 `.r22-lib` 的
   * 168px + 1fr。根容器那条断言只管最外层,管不到里面画错栏;这四条管的正是里面:
   * 左边那条薄导航、右边工具排、按日分组、六列网格,四个容器 class 一个都不许少,
   * 而且几何必须由 `r22-library.css` 出(所以断言 class,不断言像素)。
   */
  it("Library 的骨架是落定页那副双栏,不是旧的 880px 单栏", () => {
    const markup = renderToStaticMarkup(h(LibraryLoading));
    for (const cls of ["r22-lib", "r22-lib-nav", "r22-lib-main", "r22-lib-tools", "r22-lib-groups", "r22-lib-grid", "r22-lib-tile"]) {
      expect(markup, `骨架里找不到 .${cls} —— 形状又跟落定页对不上了`).toContain(`class="${cls}"`);
    }
    expect(markup, "880px 单栏是重建之前的形状,不许回来").not.toContain("max-w-[880px]");
  });

  it("Library 的骨架把栏宽行高交给 r22-library.css,自己不复刻一份几何", () => {
    const source = readFileSync(path.join(APP_DIR, "library/loading.tsx"), "utf8");
    expect(source, "骨架必须 import 真页面那份 CSS,否则 .r22-lib 那批 class 在等待态是空的").toContain('import "@/components/library/r22-library.css";');
  });

  it("Library 的骨架给等待中的商家留了一句可读的状态", () => {
    expect(renderToStaticMarkup(h(LibraryLoading))).toContain("Loading your Library");
  });
});

/**
 * Home 右上角,2026-08-26 深夜之后**只剩一颗铃**。
 *
 * 这一段上一版钉的是「头像 + chevron 接在真东西上、开的是壳那一份工作区菜单」。Founder 看
 * 成品时点的是更上一层的问题:「右上角和左下角 workspace management 重叠」—— 一份菜单两个
 * 入口,长得还不一样。裁决是合一到侧栏左下角那一颗(它同时写着当前工作区的名字)。
 *
 * 所以这一段翻面:钉的不再是那颗头像接得对不对,是它**不在了**,以及工作区菜单那一份能力
 * 一件都没丢 —— 列表、当前态、settings、sign out 全在左下角那一个入口后面。
 */
describe("右上角整组退场(Founder 2026-08-26 workspace 管理合一 + P2-23 铃进幕后)", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let host: HTMLDivElement;
  let root: Root;

  async function mountShell(identity: { displayName: string; email: string } | null, location = "/") {
    const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
    await act(async () => {
      root.render(
        h(R22DashboardShell, {
          location,
          account: identity ? { ...identity, balance: 0 } : null,
          signOutAction: vi.fn(async () => undefined),
          children: h("div", null, "page"),
        }),
      );
    });
  }

  function click(element: Element | null | undefined) {
    return act(async () => {
      element?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("右上角整组退场 —— 头像、chevron、账号菜单、铃全不画(P2-23,2026-08-26)", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "nadia@harvest.example" });
    expect(host.querySelector(".r22-dashboard-quick-actions"), "右上角那一组又画回来了").toBeNull();
    expect(host.querySelector(".r22-dashboard-account"), "右上角那颗账号按钮又回来了").toBeNull();
    expect(host.querySelector(".r22-dashboard-account-avatar"), "右上角那枚首字母头像又回来了").toBeNull();
    expect(host.querySelector(".r22-dashboard-bell"), "通知铃又回来了").toBeNull();
    expect(host.innerHTML).not.toContain(">NA<");
  });

  it("侧栏左下角那一颗仍然写着真名字的首字母,不是写死的两个字母", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "nadia@harvest.example" });
    expect(host.querySelector(".r22-dashboard-workspace .r22-dashboard-avatar")?.textContent).toBe("HC");

    await mountShell({ displayName: "", email: "nadia@harvest.example" });
    expect(host.querySelector(".r22-dashboard-workspace .r22-dashboard-avatar")?.textContent).toBe("N");
  });

  it("chevron 在侧栏那颗按钮里面 —— 它不是按钮外一个死图标", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    expect(host.querySelector(".r22-dashboard-workspace svg")).not.toBeNull();
  });

  it("工作区菜单只有侧栏那一个入口开得出来,DOM 里同一时刻只有一份", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);

    await click(host.querySelector(".r22-dashboard-workspace"));
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(1);
    expect(host.querySelector(".r22-dashboard-workspace")?.getAttribute("aria-expanded")).toBe("true");
    // 第二个锚点随第二个入口一起退场 —— 菜单只剩一个位置。
    expect(host.querySelector(".r22-dashboard-workspace-menu")?.className).not.toContain("is-account-anchored");

    // 再按一次就收 —— 开合归同一颗。
    await click(host.querySelector(".r22-dashboard-workspace"));
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);
  });

  it("菜单里工作区列表、Workspace settings、Sign out 一件都没丢", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    await click(host.querySelector(".r22-dashboard-workspace"));
    const menu = host.querySelector(".r22-dashboard-workspace-menu")!;

    expect(menu.textContent, "菜单里没有当前工作区").toContain("Harvest Candle Co");
    expect(menu.textContent, "当前态那一条不见了").toContain("Current workspace");
    expect(menu.querySelector('a[href="/settings"]'), "Workspace settings 那扇门不见了").not.toBeNull();
    expect(menu.textContent, "Sign out 没并进这一份菜单").toContain("Sign out");
    // 登出是一次 form 提交(server action),不是一条链接 —— 它得真的能登出。
    expect(menu.querySelector("form button[type=submit]"), "Sign out 不是那个 server action 的提交键").not.toBeNull();
    // 发丝线把「去某个页面」和「结束这一次使用」分开:两条 Separator,不是一条。
    expect(menu.querySelectorAll(".r22-dashboard-workspace-separator").length, "Sign out 上面那条发丝线不见了").toBe(2);
  });

  it("点外面就关(此前整个不存在这一层)", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    await click(host.querySelector(".r22-dashboard-workspace"));
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(1);

    await act(async () => {
      host.querySelector(".r22-dashboard-content")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);
  });

  it("Esc 关掉菜单,焦点回到那唯一的触发点", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    await click(host.querySelector(".r22-dashboard-workspace"));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    expect(document.activeElement).toBe(host.querySelector(".r22-dashboard-workspace"));
  });

  /** 铃 2026-08-26 进幕后(P2-23)。这一条从「铃能开抽屉」改钉「哪一扇门后都没有铃」——
   *  它的病正是「只有首页有」,所以核的是**两扇门都没有**,而不是首页没有。 */
  it("铃在哪一扇门后都不出现了(闸在 BETA_NOTIFICATION_BELL)", async () => {
    for (const location of ["/", "/library", "/create"]) {
      await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" }, location);
      expect(host.querySelector(".r22-dashboard-bell"), `${location} 上还有铃`).toBeNull();
    }
  });
});

describe("badge 与首字母都从源头派生", () => {
  const shell = readFileSync(path.resolve(__dirname, "../../components/r22/R22DashboardShell.tsx"), "utf8");

  it("未读数只有一个算法,没有写死的数字", () => {
    expect(shell).toContain("const unreadCount = fixtureNotifications.filter((item) => !item.read).length;");
    expect(shell).not.toMatch(/<i>\s*\d+\s*<\/i>/);
  });

  it("首字母走 initials(),源头是 identity", () => {
    expect(shell).toContain("{initials(identity)}");
  });

  it("Home 自己不再画一份右上角", () => {
    const home = readFileSync(path.resolve(__dirname, "../../components/home/HomeView.tsx"), "utf8");
    expect(home).not.toContain("r22-home-account");
    expect(home).not.toContain(">NA<");
  });
});

describe("Esc 剥层:切换器/全屏在时,壳不碰面板", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let host: HTMLDivElement;
  let root: Root;
  let layerMarker: HTMLElement | null = null;

  async function mountShell() {
    const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
    await act(async () => {
      root.render(
        h(R22DashboardShell, {
          location: "/",
          account: { displayName: "Harvest Candle Co", email: "n@h.example", balance: 0 },
          signOutAction: vi.fn(async () => undefined),
          children: h("div", null, "page"),
        }),
      );
    });
  }

  function pressEscape() {
    return act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  beforeEach(() => {
    closePanelSpy.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    layerMarker?.remove();
    layerMarker = null;
  });

  it("切换器层在(data-otto-panel-rooms)时,Esc 归 OttoPanelShell 的链,壳不关面板", async () => {
    layerMarker = document.createElement("div");
    layerMarker.setAttribute("data-otto-panel-rooms", "");
    document.body.appendChild(layerMarker);

    await mountShell();
    await pressEscape();

    expect(closePanelSpy).not.toHaveBeenCalled();
  });

  it("全屏层在(data-otto-panel-fullscreen)时,Esc 归 OttoPanelShell 的链,壳不关面板", async () => {
    layerMarker = document.createElement("div");
    layerMarker.setAttribute("data-otto-panel-fullscreen", "");
    document.body.appendChild(layerMarker);

    await mountShell();
    await pressEscape();

    expect(closePanelSpy).not.toHaveBeenCalled();
  });

  it("两层都不在时,Esc 仍然关面板(原行为不变)", async () => {
    await mountShell();
    await pressEscape();

    expect(closePanelSpy).toHaveBeenCalledTimes(1);
  });
});
