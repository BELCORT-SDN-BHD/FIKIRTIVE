// @vitest-environment jsdom
/**
 * r22-beta-shell-sanitise.test.ts —— 壳这一层的 beta 卫生大扫除(2026-08-26)。
 *
 * 两条,各自对着审计台账上的一条:
 *
 * **P2-21 —— 同一件事两个地址。** Settings 的连接页此前在壳里有两条深链:⌘K 写
 * `/settings?section=connections`,Help 抽屉写 `/settings/connections`。两份地址迟早漂移,
 * 而且 beta 期 Settings 正把 Connections 那一节闸起来 —— 一条指向被闸节的深链,商家按下去
 * 只会落在一屏没有那一节的 Settings 上。处置:两处一起撤,壳里因此**零**条连接深链。
 * (深链本身没有被禁:`?connection=` 那条 Home 侧的路径与 `/settings/connections` 路由都
 * 还在,连接线回来时两处一起加回来,而且只加一份地址。)
 *
 * **P2-23 —— 通知铃只长在首页。** 商家在 Library 里收到的通知得走回 `/` 才看得见,那是
 * 产品里最难解释的一种形状。Founder 裁决:beta 整个拿掉,**只藏不删** —— 抽屉那一整套
 * (`Sheet`、未读数、标记已读、样张三条、生产态空态)一行没动,闸是 `BETA_NOTIFICATION_BELL`。
 *
 * 变异自检(逐条实做,做完还原,红 → 绿):
 *   · `BETA_NOTIFICATION_BELL` 改成 `true` ⇒ ②③ 红(铃回来了、右上角那一组回来了);
 *   · ⌘K 把 `settings:connections` 那一条贴回 `searchResults` ⇒ ① 红;
 *   · Help 抽屉把 `Connection help` 那条 `<Link>` 贴回去 ⇒ ① 红;
 *   · 把整段 `Sheet`(通知抽屉)从组件里删掉、只留闸 ⇒ ④ 红(藏变成了删)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** cmd+K 归位 `ui/command`(cmdk)之后需要 ResizeObserver —— jsdom 没有,补一个替身。 */
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHELL_SOURCE = readFileSync(
  path.resolve(__dirname, "../../components/r22/R22DashboardShell.tsx"),
  "utf8",
);

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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

/** 壳渲染出来的每一条 href —— portal 出去的层(⌘K、抽屉)也算,所以从 document 上取。 */
function allHrefs(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((node) => node.getAttribute("href") ?? "");
}

describe("① Settings 连接页:壳里零条深链,自然也就没有第二个地址(P2-21)", () => {
  it("⌘K 的结果里搜不到 Connections —— 那一节 beta 期被闸起来了", async () => {
    await mountShell();
    await click(host.querySelector(".r22-dashboard-search"));
    const results = document.body.querySelector("[data-r22-search-results]");
    expect(results, "搜索层没开出来 —— 下面的断言在核对空气").toBeTruthy();
    expect(results!.textContent, "⌘K 里还搜得出 Connections").not.toContain("Connections");
    expect(results!.textContent, "⌘K 里还搜得出 Members").not.toContain("Members");
    // 留下来的那一节还在 —— 收窄不是把 Settings 整个从搜索里抹掉。
    expect(results!.textContent, "Billing and credits 也被顺手删了").toContain("Billing and credits");
  });

  it("Help 抽屉里没有 Connection help,壳里一条连接深链都不剩", async () => {
    await mountShell();
    await click(host.querySelector(".r22-dashboard-workspace"));
    const help = [...host.querySelectorAll<HTMLButtonElement>(".r22-dashboard-workspace-menu button")]
      .find((node) => node.textContent?.trim() === "Help");
    expect(help, "工作区菜单里没有 Help —— 下面的断言在核对空气").toBeTruthy();
    await click(help);

    const drawer = document.body.querySelector("[data-r22-help-region]");
    expect(drawer, "Help 抽屉没开出来").toBeTruthy();
    expect(drawer!.textContent, "Help 抽屉里还有 Connection help").not.toContain("Connection help");
    expect(drawer!.textContent, "Ask Otto 也被顺手删了").toContain("Ask Otto");

    const connectionHrefs = allHrefs().filter((href) => href.includes("connections"));
    expect(connectionHrefs, `壳里还留着连接深链:${connectionHrefs.join(" / ")}`).toEqual([]);
  });

  it("源码里也不剩第二种写法 —— 两份地址是漂移的根", () => {
    // 注释里可以谈这件事,代码里不许再出现这两条地址中的任何一条。
    const code = SHELL_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "⌘K 那条 `?section=connections` 又回来了").not.toContain("section=connections");
    expect(code, "Help 那条 `/settings/connections` 又回来了").not.toContain("/settings/connections");
  });
});

describe("②③④ 通知铃进幕后:只藏不删(P2-23)", () => {
  it("② 哪一扇门后都没有铃 —— 它的病正是「只有首页有」", async () => {
    for (const location of ["/", "/library", "/create", "/brand"]) {
      await mountShell(location);
      expect(host.querySelector(".r22-dashboard-bell"), `${location} 上还有铃`).toBeNull();
      expect(host.querySelector("[aria-label^='Notifications']"), `${location} 上还有通知触发点`).toBeNull();
    }
  });

  it("③ 右上角那一组整块不渲染,不是留一个空壳占着版面", async () => {
    await mountShell();
    expect(host.querySelector(".r22-dashboard-quick-actions"), "右上角留了一个空容器").toBeNull();
    expect(document.body.querySelector("[data-r22-notifications-region]"), "抽屉自己挂上来了").toBeNull();
  });

  it("④ 闸掉不是删掉:抽屉那一整套代码与那扇门都还在", () => {
    for (const anchor of [
      "BETA_NOTIFICATION_BELL",
      "r22-dashboard-bell",
      "data-r22-notifications-region",
      "Mark all notifications as read",
      "Notification delivery is not connected yet",
      "const unreadCount = fixtureNotifications.filter((item) => !item.read).length;",
    ]) {
      expect(SHELL_SOURCE, `${anchor} 被删掉了 —— 裁决是藏,不是删`).toContain(anchor);
    }
    expect(SHELL_SOURCE, "闸没有默认关").toContain("const BETA_NOTIFICATION_BELL = false;");
    // `/notifications` 那扇门本身照常在(抽屉里的「View all」与空态都指着它)。
    expect(
      readFileSync(path.resolve(__dirname, "../../app/notifications/page.tsx"), "utf8").length,
    ).toBeGreaterThan(0);
  });
});
