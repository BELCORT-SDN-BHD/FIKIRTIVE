// @vitest-environment jsdom
/**
 * r22-home-beta-connection-gate.test.ts —— Home 的 beta 收口(Founder 2026-08-26 深夜三条)。
 *
 * 裁决原话三句,处置各一:
 *   ·「右上角和左下角 workspace management 重叠」→ 右上角整组头像与 chevron 拿掉,
 *     工作区管理只剩侧栏左下角那一个入口,Sign out 并进那一份菜单底部;
 *   ·「social media connect not ready yet」「connection page not optimised, can hide first」
 *     → 连接卡、状态词条、Performance 整块从 Home 默认第一屏撤下;
 *   ·「beta V1 只做 creation」→ 与 `r22-beta-nav-scope.test.ts` 那批导航收窄同源。
 *
 * **闸掉,不是删掉**:连接流与 Performance 的代码一行没删,闸是 `HomeView` 的
 * `connectionSurface` prop,由地址上的 `?connection=` 打开(`app/(home)/page.tsx`)。
 * 所以这份文件钉两面:默认那一屏什么都没有,深链那一屏什么都还在。
 *
 * 变异自检(2026-08-26 逐条实做,做完还原,红 → 绿):
 *   · `R22DashboardShell` 把右上角那颗 `.r22-dashboard-account` 按钮加回来 ⇒ ① 红;
 *   · `HomeView` 的 Performance 那一段去掉 `connectionSurface ?` 变成常驻 ⇒ ③ 红;
 *   · `app/(home)/loading.tsx` 把连接卡骨架块放回去 ⇒ ⑥ 红;
 *   · 工作区菜单里删掉那一行 `<form action={signOutAction}>` ⇒ ② 红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeView } from "@/components/home/HomeView";
import HomeLoading from "@/app/(home)/loading";
import { readOk, type HomeData } from "@/components/home/home-data";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/global-search-actions", () => ({
  loadGlobalSearchProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));

vi.mock("@/components/otto/panel/OttoPanelShell", () => ({
  useOttoPanelControls: () => ({
    open: false, mode: "docked", expanded: false, hydrated: true, dockedWidth: 0,
    openPanel: vi.fn(), closePanel: vi.fn(), togglePanel: vi.fn(), toggleExpanded: vi.fn(),
  }),
}));

/** cmd+K 归位 `ui/command`(cmdk)之后需要 ResizeObserver —— jsdom 没有,补一个替身。
 *  环境缺件,不是被测行为。 */
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
const source = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

const HOME_DATA: HomeData = {
  greeting: "Good morning, Nadia",
  credits: readOk("1,240 cr"),
  canvases: readOk([]), thumbs: readOk([]), upcoming: readOk([]), campaigns: readOk([]), equipment: readOk([]),
};

/** 连接线那一整套在屏上的样子 —— 卡标题、四条状态词条、Performance。默认第一屏一个都不许有。 */
const CONNECTION_SURFACE_COPY = [
  "Connect your first channel",
  "is ready",
  "Not connected",
  "Verifying",
  "Syncing data",
  "Performance",
  "Skip for now",
];

function renderHome(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(h(HomeView, { data: HOME_DATA, connection: { kind: "not_connected" }, ...props } as never));
}

describe("① 右上角没有第二个 workspace 入口了", () => {
  let host: HTMLDivElement;
  let root: Root;

  async function mountShell(location = "/") {
    const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
    await act(async () => {
      root.render(h(R22DashboardShell, {
        location,
        account: { displayName: "Harvest Candle Co", email: "n@h.example", balance: 0 },
        signOutAction: vi.fn(async () => undefined),
        children: h("div", null, "page"),
      }));
    });
  }

  const click = (element: Element | null | undefined) => act(async () => {
    element?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.replaceChildren();
  });

  /**
   * 2026-08-26 深夜第二刀:铃也跟着进了幕后(beta 卫生大扫除 P2-23)。上一版这里钉的是
   * 「右上角只剩铃」—— 那一条已经是旧现实。铃的病是它**只长在 `/` 上**:商家在 Library 里
   * 收到的通知得走回首页才看得见。裁决取「beta 整个拿掉」,闸在 `BETA_NOTIFICATION_BELL`。
   */
  it("Home 右上角整组不在了 —— 头像、chevron、账号菜单、铃,一件都不画", async () => {
    await mountShell();
    expect(host.querySelector(".r22-dashboard-quick-actions"), "右上角那一组又画回来了").toBeNull();
    expect(host.querySelector(".r22-dashboard-account"), "右上角那颗账号按钮又回来了").toBeNull();
    expect(host.querySelector(".r22-dashboard-account-avatar"), "右上角那枚首字母头像又回来了").toBeNull();
    expect(host.querySelector(".r22-dashboard-bell"), "通知铃又回来了").toBeNull();
  });

  it("工作区菜单只有侧栏那一颗开得出来 —— 右上角已经没有第二个触发点了", async () => {
    await mountShell();
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);
    await click(host.querySelector(".r22-dashboard-workspace"));
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu"), "侧栏那颗开不出菜单了").toHaveLength(1);
  });

  it("`.is-account-anchored` 那个第二锚点连样式带用法一起退场", async () => {
    expect(source("components/r22/R22DashboardShell.tsx"), "第二锚点又长回来了").not.toContain("is-account-anchored");
    expect(source("components/r22/r22-dashboard.css").replace(/\/\*[\s\S]*?\*\//g, ""), "第二锚点的 css 还留着")
      .not.toContain("is-account-anchored");
  });
});

describe("② 左下角那一颗是唯一的 workspace 权威", () => {
  let host: HTMLDivElement;
  let root: Root;

  async function mountShell(location = "/") {
    const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
    await act(async () => {
      root.render(h(R22DashboardShell, {
        location,
        account: { displayName: "Harvest Candle Co", email: "n@h.example", balance: 0 },
        signOutAction: vi.fn(async () => undefined),
        children: h("div", null, "page"),
      }));
    });
  }

  const click = (element: Element | null | undefined) => act(async () => {
    element?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.replaceChildren();
  });

  it("菜单三节齐全:工作区列表、Workspace settings、Sign out", async () => {
    await mountShell();
    await click(host.querySelector(".r22-dashboard-workspace"));
    const menu = host.querySelector(".r22-dashboard-workspace-menu")!;

    expect(menu.textContent).toContain("Harvest Candle Co");
    expect(menu.textContent, "当前态那一条不见了").toContain("Current workspace");
    expect(menu.querySelector('a[href="/settings"]'), "Workspace settings 那扇门不见了").not.toBeNull();
    expect(menu.textContent, "Sign out 没并进这一份菜单").toContain("Sign out");
    expect(menu.querySelector("form button[type=submit]"), "Sign out 不是那个 server action 的提交键").not.toBeNull();
    // 「去某个页面」与「结束这一次使用」之间那条发丝线 —— 两条 Separator,不是一条。
    expect(menu.querySelectorAll(".r22-dashboard-workspace-separator")).toHaveLength(2);
  });

  it("双 workspace 隔离仍成立:两个都在列表里,当前那个带勾,另一个按得动", async () => {
    await mountShell("/?fixture=r22");
    await click(host.querySelector(".r22-dashboard-workspace"));
    // 工作区那几行认头像那一枚记号 —— 菜单里 `Help` 也是一颗直接子 button,它不是工作区。
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".r22-dashboard-workspace-menu > button")]
      .filter((row) => row.querySelector(".r22-dashboard-avatar"));

    const labels = rows.map((row) => row.querySelector("b")?.textContent);
    expect(labels, "样张的两个工作区不全在菜单里").toEqual(["Batik House", "Nadi Studio"]);

    const [current, other] = rows;
    expect(current!.textContent, "当前工作区没标出来").toContain("Current workspace");
    expect(current!.querySelector("svg"), "当前那一条上没有勾").not.toBeNull();
    expect(other!.textContent, "另一个工作区标成了当前").not.toContain("Current workspace");
    expect(other!.disabled, "另一个工作区按不动 —— 切换这条路断了").toBe(false);
  });
});

describe("③ Home 默认第一屏:零连接卡、零状态词条、零 Performance", () => {
  it.each([
    ["生产路径", {}],
    ["样张路径", { fixture: true }],
  ])("%s 上一句连接线的字都没有", (_name, props) => {
    const markup = renderHome(props);
    for (const copy of CONNECTION_SURFACE_COPY) {
      expect(markup, `默认第一屏上还有「${copy}」`).not.toContain(copy);
    }
    // 容器也不许留一个空壳占着版面。
    for (const container of ["r22-home-connect-card", "r22-home-insight-grid", "r22-home-performance", "r22-home-stepper"]) {
      expect(markup, `默认第一屏还画着 .${container}`).not.toContain(container);
    }
  });

  it("ready / needs_reconnect / unknown 三态闸后一样什么都不画 —— 闸认的是闸,不是连接状态", () => {
    for (const connection of [
      { kind: "connected", accountLabel: "Meta account", transient: false },
      { kind: "needs_reconnect" },
      { kind: "unknown", message: "Connection status could not be read just now." },
    ] as const) {
      const markup = renderHome({ connection });
      expect(markup, `${connection.kind} 态闸后还画着连接卡`).not.toContain("r22-home-connect-card");
      expect(markup, `${connection.kind} 态闸后还画着 Performance`).not.toContain("r22-home-performance");
    }
  });

  it("留下的是问候 + 创作入口那一族,而且问候副句指向创作不指向连接", () => {
    const markup = renderHome();
    expect(markup).toContain("Good morning, Nadia");
    expect(markup, "副句还在把商家往连接那条路上推").not.toContain("Connect one channel");
    expect(markup).toContain("Start a new piece, or pick up one you already made.");
    // 创作入口一族一件不少(行标题 2026-08-26 换成创作口径,见 `r22-home-create-row.test.ts`)。
    expect(markup).toContain("Start from a blank canvas");
    expect(markup).toContain("Create new");
    expect(markup).toContain("Add brand context");
    expect(markup, "唯一那一块没换成第一块的量级").toContain('class="r22-home-create-row is-primary"');
  });
});

describe("④ 深链开闸:`?connection=` 一带,整套连接线原样回来", () => {
  it("闸一开,连接卡、四步词条、Performance 全在", () => {
    const markup = renderHome({ connectionSurface: true });
    for (const copy of ["Connect your first channel", "Not connected", "Verifying", "Syncing data", "Performance", "Skip for now"]) {
      expect(markup, `开闸后少了「${copy}」`).toContain(copy);
    }
    expect(markup).toContain("r22-home-connect-card");
    expect(markup).toContain("r22-home-performance");
  });

  it("ready 深链下拿得到验证过的那一屏", () => {
    const markup = renderHome({ connectionSurface: true, connection: { kind: "verified_fixture", accountLabel: "@batikhouse" }, fixture: true });
    expect(markup).toContain("is ready");
    expect(markup, "验证过的样张数字不见了").toContain("48.2K");
  });

  it("路由文件真的把开关接到了 `?connection=` 上 —— 两条路都接", () => {
    const page = source("app/(home)/page.tsx");
    expect(page, "开关没有从地址上取").toContain("const connectionSurface = Boolean(connection);");
    expect(page, "样张那一路没接上开关").toMatch(/<R22HomeFixture[^>]*connectionSurface=\{connectionSurface\}/);
    expect(page, "生产那一路没接上开关").toMatch(/<HomeEntry\s+connectionSurface=\{connectionSurface\}\s*\/>/);
  });

  it("闸掉不是删掉:连接流那一整套代码还在这一份组件里", () => {
    const view = source("components/home/HomeView.tsx");
    for (const anchor of ["CONNECTION_STEPS", "ConnectionStepper", "openConnect", "confirmConnection", "r22-home-performance"]) {
      expect(view, `${anchor} 被删掉了 —— 裁决是闸掉,beta 之后还要开回来`).toContain(anchor);
    }
    expect(view, "闸没有默认关").toContain("connectionSurface = false");
  });
});

describe("⑤ 骨架与落定页同形(闸后)", () => {
  const skeleton = renderToStaticMarkup(h(HomeLoading));

  it("骨架不画连接卡、不画 Performance —— 画了就是把跳屏亲手请回来", () => {
    for (const container of [
      "r22-home-connect-card", "r22-home-connect-copy", "r22-home-channels",
      "r22-home-channel", "r22-home-stepper", "r22-home-skip",
      "r22-home-insight-grid", "r22-home-performance",
    ]) {
      expect(skeleton, `骨架还画着 .${container},而落定页默认没有它`).not.toContain(container);
    }
  });

  it("骨架画的两段,落定页一段不少地也有", () => {
    const settled = renderHome();
    for (const container of ["r22-home", "r22-home-header", "r22-home-create-row is-primary"]) {
      expect(skeleton, `骨架少了 ${container}`).toContain(container);
      expect(settled, `落定页少了 ${container}`).toContain(container);
    }
    expect(skeleton, "循环动效的总闸不见了").toContain("data-r22-skeleton");
  });
});
