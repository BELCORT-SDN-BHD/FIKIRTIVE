// @vitest-environment jsdom
/**
 * r22-beta-nav-scope.test.ts —— beta V1 的导航收窄(Founder 裁决 2026-08-26)。
 *
 * 裁决:beta 期只卖创作,所以侧栏只留 Home / Create / Library / Otto IQ 四格加 Settings,
 * Campaigns、Approvals、Schedule、Analytics、Routines 五扇门**藏起来**——代码与路由都不删,
 * 直接输地址仍然到得了,不加闸。
 *
 * 2026-08-26 Founder 裁决:beta V1 导航收窄至 creation 五门,W2-11「七格导航权威」在 beta 期
 * 由此条取代。权威表 `@fikirtive/core` 的 `MERCHANT_NAV` 一格没动(后端线还要用它,
 * `creation-nav-flagship.test.ts` / `nav-rail*.test.ts` 钉的仍然是那张表),收窄发生在壳这一层。
 *
 * 三条钉的是**商家真的看得到什么**:
 *   ⑪ 侧栏只画那五格;
 *   ⑫ 全局搜索的 "Go to" 与侧栏同源 —— 侧栏没有的门,搜索里也搜不出来;
 *   ⑬ 通知样例零指向被藏的门,Approvals 那枚「5」跟着门一起走。
 *
 * 变异自检(2026-08-26 逐条实做,做完以 commit 为锚还原,红 → 绿):
 *   · `NAV_KEYS` 加回 `"approvals"` ⇒ ⑪⑫ 红;
 *   · 通知样例里把第一条换回 `/approvals?fixture=r22` ⇒ ⑬ 红;
 *   · 侧栏 `{fixture && label === "Approvals" && <em>5</em>}` 那一行连同 `NAV_KEYS` 里的
 *     approvals 一起放回来 ⇒ ⑪⑫⑬ 三条全红(徽标那半条只在样张态才存在,所以 ⑬ 在
 *     `?fixture=r22` 下核 —— 在生产态核它等于核对空气)。
 */
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { merchantNavLinks } from "@fikirtive/core/navigation";
import { R22_NOTIFICATION_FIXTURE_ITEMS } from "@/components/notifications/r22-notification-fixture";
import { BETA_HIDDEN_NAV_KEYS } from "@/components/r22/R22DashboardShell";

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
    open: false,
    mode: "docked",
    expanded: false,
    hydrated: true,
    dockedWidth: 0,
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    togglePanel: vi.fn(),
    toggleExpanded: vi.fn(),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 被藏起来那五扇门在权威表里的标签与地址 —— 期望侧不手抄,免得两边一起写错。 */
const HIDDEN = BETA_HIDDEN_NAV_KEYS.map((key) => {
  const link = merchantNavLinks().find((item) => item.key === key);
  if (!link) throw new Error(`权威表里找不到 ${key} —— 这条围栏在核对空气`);
  return link;
});

/**
 * beta V1 商家看得到的那五扇门,顺序即侧栏从上到下。标签逐字来自权威表(Create 那一格
 * 商家读到的名字是「Canvas」),Settings 不是导航格,它在侧栏 Workspace 那一节下面。
 */
const VISIBLE_DOORS = ["home", "create", "library", "brand"]
  .map((key) => merchantNavLinks().find((item) => item.key === key)!.label)
  .concat("Settings");

let host: HTMLDivElement;
let root: Root;

async function mountShell(location = "/") {
  const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
  await act(async () => {
    root.render(
      h(R22DashboardShell, {
        location,
        account: { displayName: "Harvest Candle Co", email: "n@h.example", balance: 0 },
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
  document.body.replaceChildren();
});

describe("beta V1 导航收窄", () => {
  it("⑪ 侧栏只画 creation 那五门", async () => {
    await mountShell();

    const rail = host.querySelector('[aria-label="Global navigation"]')!;
    const doors = [...rail.querySelectorAll("a")]
      .map((node) => node.querySelector("span")?.textContent?.trim())
      .filter((label): label is string => Boolean(label) && label !== "fikirtive");

    expect(doors).toEqual(VISIBLE_DOORS);
    for (const link of HIDDEN) {
      expect(rail.textContent, `${link.label} 还在侧栏里`).not.toContain(link.label);
      expect(rail.innerHTML, `${link.href} 还在侧栏里`).not.toContain(`href="${link.href}"`);
    }
  });

  it("⑫ 全局搜索的 Go to 与侧栏同源 —— 藏起来的门搜不出来", async () => {
    await mountShell();
    await click(host.querySelector(".r22-dashboard-search"));

    const results = document.body.querySelector("#r22-global-search-results");
    expect(results, "搜索层没开出来 —— 下面的断言在核对空气").toBeTruthy();
    for (const label of VISIBLE_DOORS) {
      expect(results!.textContent, `搜索里少了 ${label}`).toContain(label);
    }
    for (const link of HIDDEN) {
      expect(results!.textContent, `${link.label} 还搜得出来`).not.toContain(link.label);
      expect(results!.innerHTML, `${link.href} 还搜得出来`).not.toContain(`href="${link.href}"`);
    }
  });

  it("⑬ 通知样例零指向被藏的门,Approvals 那枚徽标跟着门一起走", async () => {
    for (const item of R22_NOTIFICATION_FIXTURE_ITEMS) {
      for (const link of HIDDEN) {
        expect(item.href.startsWith(link.href), `样例通知「${item.title}」指着 ${link.href}`).toBe(false);
      }
      expect(item.title.toLowerCase(), `样例通知「${item.title}」还在说审批`).not.toContain("approval");
    }

    // 徽标只在样张态出现过(`fixture && label === "Approvals"`),所以要在样张态里核 ——
    // 生产态本来就没有那枚数字,在那里核等于核对空气。
    await mountShell("/?fixture=r22");
    const rail = host.querySelector('[aria-label="Global navigation"]')!;
    expect(rail.textContent, "样张态没进去 —— 下面那条在核对空气").toContain("Library");
    expect(rail.querySelector("em"), "侧栏上还挂着一枚指向被藏的门的徽标").toBeNull();
  });
});
