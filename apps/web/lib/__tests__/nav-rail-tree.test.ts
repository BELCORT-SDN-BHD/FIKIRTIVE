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
  type MerchantNavGroup,
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

function L(key: string, href: string): MerchantNavLink {
  return { key, label: key, href, does: "" };
}

/** 换壳后的七格(规格书 §2.3 ①),只用它来验规则 —— 权威源本身这一票不动。 */
const WAVE2_LINKS: readonly MerchantNavLink[] = [
  L("home", SHELL_ROUTES.home),
  L("create", SHELL_ROUTES.create),
  L("library", SHELL_ROUTES.library),
  L("brand", SHELL_ROUTES.brand),
  L("campaign", SHELL_ROUTES.campaign),
  L("schedule", SHELL_ROUTES.schedule),
  L("billing", SHELL_ROUTES.billing),
  L("connections", SHELL_ROUTES.connections),
  L("preferences", SHELL_ROUTES.preferences),
];

/** 换壳后的 Settings 分组(§2.1)。分组高亮这条规则同样要能在数据改完之前就验。 */
const WAVE2_SETTINGS_GROUP: MerchantNavGroup = {
  key: "settings",
  label: "Settings",
  items: [
    L("billing", SHELL_ROUTES.billing),
    L("connections", SHELL_ROUTES.connections),
    L("preferences", SHELL_ROUTES.preferences),
  ],
};

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
    // /settings/connections 同时落在 /settings 上。少了长度比较,亮的**仍然只有一格**,
    // 但会是错的那一格 —— 唯一性与「赢的是对的那一个」是两条纪律,见下面那条顺序无关的断言。
    expect(activeNavKey(SHELL_ROUTES.connections, WAVE2_LINKS)).toBe("connections");
    expect(activeNavKey(SHELL_ROUTES.preferences, WAVE2_LINKS)).toBe("preferences");
  });

  it("longest match wins regardless of list order", () => {
    // 判官 r1 [P2]:上面那条断言在 WAVE2_LINKS 里恰好 connections 排在 preferences 之前,
    // 所以把长度比较换成「取第一条匹配」它也照样绿 —— 侥幸通过,不是钉住。
    // 顺序无关才是这条规则的真形状:同一组链接正反两序都必须答 connections。
    const pair = [L("preferences", SHELL_ROUTES.preferences), L("connections", SHELL_ROUTES.connections)];

    expect(activeNavKey(SHELL_ROUTES.connections, pair)).toBe("connections");
    expect(activeNavKey(SHELL_ROUTES.connections, [...pair].reverse())).toBe("connections");
  });

  it("lights the deepest match wherever a third level appears", () => {
    // 三层同前缀,六种排列都要答最深的那一条:两条链接对不出「是不是真的按长度」,
    // 因为随便一种偏好都可能在两条上碰巧对一次。
    const three = [
      L("shallow", "/settings"),
      L("middle", "/settings/connections"),
      L("deep", "/settings/connections/meta"),
    ];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];

    for (const order of orders) {
      const links = order.map((index) => three[index]!);
      expect(
        activeNavKey("/settings/connections/meta", links),
        `order ${order.join("")} picked the wrong cell`,
      ).toBe("deep");
    }
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

  // W2-11 换掉了权威源里最后几条带查询串的地址(`/otto?view=X` → 各自的真路由),
  // 这份名单从此不再有 `?query=` 钉住的目的地——这条断言原本守的就是那个形状,随它一起撤。
  // 如果 §1.3 那份权威源哪天又长出一条带查询的地址,`nav-rail.test.ts`/`nav-rail-tree.test.ts`
  // 上面那些逐条遍历权威源的断言(`lights exactly one cell on every destination…`)仍然会
  // 照着新形状去核,不需要专门再补一条。
  it("每一条目的地都是路径地址,不带查询串", () => {
    for (const link of links) {
      expect(splitLocation(link.href).query.toString(), link.href).toBe("");
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

  it("lights the Settings group on each of its Wave 2 children, and on nothing else", () => {
    // 判官 r1 [P3-2]:分组高亮从前只在今天的权威源上验过 —— 而本票的承诺是「规则今天就对,
    // W2-11 只改数据」。把换壳后的分组形态传进来,这条承诺对分组才成立。
    for (const item of WAVE2_SETTINGS_GROUP.items) {
      expect(
        isGroupActive(WAVE2_SETTINGS_GROUP, item.href, WAVE2_LINKS),
        `Settings must light on ${item.href}`,
      ).toBe(true);
    }

    // 一个不属于它的赢家不许把它点亮 —— 包括 Settings 自己名下那条 `/settings` 的**子路径**
    // 被别人赢走的情况(赢家在整棵树里选,不是在分组内部选)。
    expect(isGroupActive(WAVE2_SETTINGS_GROUP, SHELL_ROUTES.library, WAVE2_LINKS)).toBe(false);
    expect(isGroupActive(WAVE2_SETTINGS_GROUP, "/login", WAVE2_LINKS)).toBe(false);
  });

  it("reads the credits row's destination from the registry, not from a literal", () => {
    const billing = railBillingLink();

    expect(billing).toBe(merchantNavLinks().find((link) => link.key === "billing"));
    expect(billing.href).toBe(SHELL_ROUTES.billing);
  });
});
