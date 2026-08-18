/**
 * #992 (W2-10) —— 「哪一格亮」这条规则本身,不看渲染。
 *
 * 规格:`docs/specs/wave2-shell.md` §2.1、§5.3;票面验收第二条:
 * **当前路由高亮唯一**(`/library/editor` 只亮 Library,不同时亮别的)。
 *
 * 唯一性在这里是**结构性**的,不是逐例检查出来的:先算出赢家的 href(最长匹配者独赢),
 * 导轨再逐格问「我是不是那一个」。所以「两格同时亮」不是一个要提防的 bug,而是画不出来的
 * 状态。下面两组断言分别钉这两件事:
 *   ① 规则本身在换壳后的七格上得出规格书要的答案;
 *   ② 拿**今天的权威源**逐条遍历,任何一个地址都至多点亮一格。
 *
 * 用 `SHELL_ROUTES` 拼出七格来验规则,而不是等 `MERCHANT_NAV` 改完再验:这一票不动导航数据
 * (Stack A/B 纪律),但规则今天就得是对的 —— W2-11 改完数据,这些断言原地生效。
 */
import { describe, expect, it } from "vitest";

import {
  MERCHANT_NAV,
  SHELL_ROUTES,
  isNavGroup,
  merchantNavLinks,
  type MerchantNavLink,
} from "@fikirtive/core/navigation";
import {
  activeNavHref,
  activeNavKey,
  isGroupActive,
  navMatchesLocation,
  railBillingLink,
  railNodes,
  splitLocation,
} from "@/components/navigation/rail/rail-tree";

/** 换壳后的七格(规格书 §2.3 ①),只用它来验规则 —— 权威源本身这一票不动。 */
const WAVE2_LINKS: readonly MerchantNavLink[] = [
  { key: "home", label: "Home", href: SHELL_ROUTES.home, does: "" },
  { key: "create", label: "Create", href: SHELL_ROUTES.create, does: "" },
  { key: "library", label: "Library", href: SHELL_ROUTES.library, does: "" },
  { key: "brand", label: "Brand", href: SHELL_ROUTES.brand, does: "" },
  { key: "campaign", label: "Campaigns", href: SHELL_ROUTES.campaign, does: "" },
  { key: "schedule", label: "Schedule", href: SHELL_ROUTES.schedule, does: "" },
  { key: "billing", label: "Billing & credits", href: SHELL_ROUTES.billing, does: "" },
  { key: "connections", label: "Connections", href: SHELL_ROUTES.connections, does: "" },
  { key: "preferences", label: "Preferences", href: SHELL_ROUTES.preferences, does: "" },
];

/** 每一条会被点亮的 href —— 唯一性检查就是「这个数组的长度不许大于 1」。 */
function litHrefs(pathname: string, links: readonly MerchantNavLink[]): string[] {
  const winner = activeNavHref(pathname, links);
  return links.filter((link) => link.href === winner).map((link) => link.href);
}

describe("高亮唯一 —— 换壳后的七格 (票面验收 ②)", () => {
  it("lights Library, and only Library, on the video editor", () => {
    expect(activeNavKey(SHELL_ROUTES.edit, WAVE2_LINKS)).toBe("library");
    expect(litHrefs(SHELL_ROUTES.edit, WAVE2_LINKS)).toEqual([SHELL_ROUTES.library]);
  });

  it("lights Connections, not Preferences, on the connections page", () => {
    // 这一条是最长匹配的理由本身:/settings/connections 同时落在 /settings 上,
    // 但商家心里在 Connections。少了长度比较,Settings 里两格会一起亮。
    expect(activeNavKey(SHELL_ROUTES.connections, WAVE2_LINKS)).toBe("connections");
    expect(activeNavKey(SHELL_ROUTES.preferences, WAVE2_LINKS)).toBe("preferences");
  });

  it("lights Schedule on the analytics tab, which is a tab and not a rail cell (Q4)", () => {
    expect(activeNavKey(SHELL_ROUTES.analytics, WAVE2_LINKS)).toBe("schedule");
  });

  it("keeps Home to itself — every other page is not Home", () => {
    expect(activeNavKey(SHELL_ROUTES.home, WAVE2_LINKS)).toBe("home");
    for (const pathname of [SHELL_ROUTES.library, SHELL_ROUTES.brand, SHELL_ROUTES.canvas]) {
      expect(activeNavKey(pathname, WAVE2_LINKS), `${pathname} must not light Home`).not.toBe("home");
    }
  });

  it("lights Create on the canvas underneath it", () => {
    expect(activeNavKey(SHELL_ROUTES.canvas, WAVE2_LINKS)).toBe("create");
  });

  it("lights nothing at all off the merchant surfaces", () => {
    expect(activeNavKey("/login", WAVE2_LINKS)).toBeNull();
    expect(activeNavHref("/admin/models", WAVE2_LINKS)).toBeNull();
  });
});

describe("高亮唯一 —— 拿今天的权威源逐条遍历", () => {
  const links = merchantNavLinks();

  it("lights exactly one cell on every destination the registry lists", () => {
    for (const link of links) {
      expect(litHrefs(link.href, links), `${link.href} lit more than one cell`).toEqual([link.href]);
    }
  });

  it("lights exactly one cell on a sub-route under every destination", () => {
    for (const link of links) {
      const { path, query } = splitLocation(link.href);
      const queryString = query.toString();
      const deep = queryString ? `${path}/deep/child?${queryString}` : `${path}/deep/child`;
      expect(litHrefs(deep, links), `${deep} lit more than one cell`).toHaveLength(1);
    }
  });

  it("does not let a bare path claim a destination that pins a query", () => {
    // 今天权威源里还有 `/otto?view=library` 这种形状(W2-11 才换掉)。光秃秃的 `/otto`
    // 不许把 Library 点亮 —— 否则商家在助手页上会看到一格随机亮着。
    const pinned = links.filter((link) => splitLocation(link.href).query.toString().length > 0);
    expect(pinned.length, "registry has no query-pinned hrefs left — drop this assertion with them").toBeGreaterThan(0);

    for (const link of pinned) {
      expect(navMatchesLocation(splitLocation(link.href).path, link.href)).toBe(false);
    }
  });
});

describe("导轨画的就是权威源 (§1.3)", () => {
  it("renders the registry's own order, node for node", () => {
    expect(railNodes()).toEqual(MERCHANT_NAV);
  });

  it("marks a group as active exactly when the winner is one of its own children", () => {
    for (const node of MERCHANT_NAV) {
      if (!isNavGroup(node)) continue;
      for (const item of node.items) {
        expect(isGroupActive(node, item.href), `${node.label} must light on ${item.href}`).toBe(true);
      }
      expect(isGroupActive(node, "/login")).toBe(false);
    }
  });

  it("reads the credits row's destination from the registry, not from a literal", () => {
    const billing = railBillingLink();

    expect(billing).toBe(merchantNavLinks().find((link) => link.key === "billing"));
    expect(billing.href).toBe(SHELL_ROUTES.billing);
  });
});
