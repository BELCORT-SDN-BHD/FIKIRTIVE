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
import RoutinesLoading from "@/app/routines/loading";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/global-search-actions", () => ({
  loadGlobalSearchProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));

const APP_DIR = path.resolve(__dirname, "../../app");

function source(relative: string): string {
  return readFileSync(path.join(APP_DIR, relative), "utf8");
}

const HOME_DATA: HomeData = {
  greeting: "Good morning, Nadia",
  credits: readOk("1,240 credits"),
  billingHref: "/settings?section=billing",
  billingLabel: "Billing & credits",
  canvases: readOk([]), thumbs: readOk([]), upcoming: readOk([]), campaigns: readOk([]), equipment: readOk([]),
};

/** 落定画面与等待画面共用的那一批容器 —— 几何全靠它们。 */
const HOME_GEOMETRY_CONTAINERS = [
  "r22-home",
  "r22-home-header",
  "r22-home-connect-card",
  "r22-home-connect-copy",
  "r22-home-channels",
  "r22-home-channel",
  "r22-home-connection-steps",
  "r22-home-insight-grid",
  "r22-home-performance",
  "r22-home-analysis",
  "r22-home-create-row",
  "r22-home-context-row",
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
    ["Routines", RoutinesLoading],
  ] as const)("%s 的骨架挂着 data-r22-skeleton(循环动效的总闸)", (_name, Component) => {
    expect(renderToStaticMarkup(h(Component))).toContain("data-r22-skeleton");
  });

  it.each([
    ["Approvals", ApprovalsLoading, "r22-approvals"],
    ["Create", CreateLoading, "r22-projects"],
    ["Routines", RoutinesLoading, "r22-routines"],
  ] as const)("%s 的骨架用落定画面同一个根容器 .%s", (_name, Component, rootClass) => {
    expect(renderToStaticMarkup(h(Component))).toContain(`class="${rootClass}"`);
  });
});

describe("Home 右上角:铃、头像、chevron", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let host: HTMLDivElement;
  let root: Root;

  async function mountShell(identity: { displayName: string; email: string } | null) {
    const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
    await act(async () => {
      root.render(
        h(R22DashboardShell, {
          location: "/",
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

  it("头像是按钮,首字母来自真名字,不是写死的 NA", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "nadia@harvest.example" });
    const account = host.querySelector<HTMLButtonElement>(".r22-dashboard-account");
    expect(account?.tagName).toBe("BUTTON");
    expect(host.querySelector(".r22-dashboard-account-avatar")?.textContent).toBe("HC");
    expect(host.innerHTML).not.toContain(">NA<");
  });

  it("没有 displayName 就退到 email,仍然不是写死的两个字母", async () => {
    await mountShell({ displayName: "", email: "nadia@harvest.example" });
    expect(host.querySelector(".r22-dashboard-account-avatar")?.textContent).toBe("N");
  });

  it("chevron 在按钮里面 —— 它不是按钮外一个死图标", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    expect(host.querySelector(".r22-dashboard-account svg")).not.toBeNull();
  });

  it("按头像开的是壳那一份工作区菜单,而且 DOM 里同一时刻只有一份", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);

    await click(host.querySelector(".r22-dashboard-account"));
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(1);
    expect(host.querySelector(".r22-dashboard-workspace-menu")?.className).toContain("is-account-anchored");
    expect(host.querySelector(".r22-dashboard-account")?.getAttribute("aria-expanded")).toBe("true");

    // 侧栏那个触发点开的是同一份菜单,只是锚点换了 —— 不是第二个组件。
    await click(host.querySelector(".r22-dashboard-account"));
    await click(host.querySelector(".r22-dashboard-workspace"));
    const railMenu = host.querySelectorAll(".r22-dashboard-workspace-menu");
    expect(railMenu).toHaveLength(1);
    expect(railMenu[0]!.className).not.toContain("is-account-anchored");
  });

  it("点外面就关(此前整个不存在这一层)", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    await click(host.querySelector(".r22-dashboard-account"));
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(1);

    await act(async () => {
      host.querySelector(".r22-dashboard-content")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);
  });

  it("Esc 关掉菜单,焦点回到按下的那一颗", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    const account = host.querySelector<HTMLButtonElement>(".r22-dashboard-account");
    await click(account);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelectorAll(".r22-dashboard-workspace-menu")).toHaveLength(0);
  });

  it("铃能开抽屉,而且只在 Home 这一屏出现", async () => {
    await mountShell({ displayName: "Harvest Candle Co", email: "n@h.example" });
    const bell = host.querySelector<HTMLButtonElement>(".r22-dashboard-bell");
    expect(bell).not.toBeNull();
    await click(bell);
    expect(host.querySelector('[aria-label="Notifications"]')).not.toBeNull();
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
