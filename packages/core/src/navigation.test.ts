/**
 * 导航唯一权威源的自守(#801)。
 *
 * 这份树有三个读者(导轨、Otto、围栏),所以树自己的形状必须先站得住:名字只写一处、
 * 目的地不重复、每一条都有一句人话、助手不占板块位、一个日历。
 *
 * 零 I/O、零渲染 —— 纯数据断言。
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_HREF,
  CREATE_NAV_HREF,
  CREATE_NAV_LABEL,
  MERCHANT_NAV,
  MERCHANT_NAV_REDIRECTS,
  NAV_PATH_SEPARATOR,
  OTTO_ASSISTANT,
  everyNavDestination,
  isNavGroup,
  merchantNavLinks,
  merchantNavMap,
  navPath,
  navPointableNames,
} from "./navigation.js";

describe("MERCHANT_NAV 的形状", () => {
  it("每个 key 只出现一次(图标、测试与后续票都按 key 认人)", () => {
    const keys = everyNavDestination().map((item) => item.key);
    const groupKeys = MERCHANT_NAV.filter(isNavGroup).map((group) => group.key);
    const all = [...keys, ...groupKeys];
    expect(new Set(all).size).toBe(all.length);
  });

  it("同一个目的地不开两扇门", () => {
    const hrefs = everyNavDestination().map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("每一条都是真路径,而且都有一句能说给商家听的话", () => {
    for (const item of everyNavDestination()) {
      expect(item.href.startsWith("/"), `${item.key} → ${item.href}`).toBe(true);
      expect(item.label.trim().length, item.key).toBeGreaterThan(0);
      expect(item.does.trim().length, item.key).toBeGreaterThan(20);
    }
  });

  it("标签是 English sentence case —— 不是 Title Case", () => {
    for (const item of everyNavDestination()) {
      // 第二个词起,除了品牌与专有名词(Otto)与缩写(CRM),不许再大写开头。
      const words = item.label.split(/\s+/).slice(1);
      const shouty = words.filter((word) => /^[A-Z]/.test(word) && !["Otto", "CRM"].includes(word));
      expect(shouty, `${item.key}: ${item.label}`).toEqual([]);
    }
  });

  it("每个分组至少有一条子项(导轨在 1024–1279 会拿第一条当整组的门)", () => {
    for (const group of MERCHANT_NAV.filter(isNavGroup)) {
      expect(group.items.length, group.key).toBeGreaterThan(0);
    }
  });
});

describe("创作正名(Founder 裁决:画布是旗舰面,不下线)", () => {
  it("创作入口的名字只写在一处 —— 白标命名体系定了改这一行就够", () => {
    const create = merchantNavLinks().find((item) => item.key === "create");
    expect(create).toBeDefined();
    expect(create!.label).toBe(CREATE_NAV_LABEL);
  });

  it("创作是主导航第一格,通向画布的家", () => {
    const first = MERCHANT_NAV.at(0);
    expect(first).toBeDefined();
    expect(isNavGroup(first!)).toBe(false);
    expect((first as { key: string }).key).toBe("create");
    expect((first as { href: string }).href).toBe(CREATE_NAV_HREF);
  });

  it("画布本身就在那扇门后面(不是另一处孤岛)", () => {
    expect(CANVAS_HREF.startsWith(`${CREATE_NAV_HREF}/`)).toBe(true);
  });
});

describe("Otto 是助手,不是模块", () => {
  it("助手不在板块列表里", () => {
    expect(merchantNavLinks().some((item) => item.key === OTTO_ASSISTANT.key)).toBe(false);
    expect(MERCHANT_NAV.some((node) => isNavGroup(node) && node.key === OTTO_ASSISTANT.key)).toBe(false);
  });

  it("但它确实是一个真能点开的目的地 —— 没有消失", () => {
    expect(everyNavDestination().some((item) => item.href === OTTO_ASSISTANT.href)).toBe(true);
    expect(OTTO_ASSISTANT.href).toBe("/otto");
  });
});

describe("两个日历择一为准", () => {
  it("树里只有一本日历,就是排期", () => {
    const calendars = merchantNavLinks().filter((item) => /calendar|schedule/i.test(item.href));
    expect(calendars.map((item) => item.href)).toEqual(["/otto?view=schedule"]);
  });

  it("旧的战役日历有去处,不是 404", () => {
    const retired = MERCHANT_NAV_REDIRECTS.find((row) => row.from === "/campaign/calendar");
    expect(retired?.to).toBe("/otto?view=schedule");
  });

  it("每一条收敛掉的旧路由都写明了去哪、为什么", () => {
    for (const row of MERCHANT_NAV_REDIRECTS) {
      expect(row.from.startsWith("/")).toBe(true);
      expect(row.to.startsWith("/")).toBe(true);
      expect(row.why.trim().length, row.from).toBeGreaterThan(20);
    }
  });
});

describe("路名(#802:Otto 说出口的地名只有这一个来源)", () => {
  it("组内的写成「分组 › 子项」,顶层的就是它自己的名字", () => {
    expect(navPath("schedule")).toBe("Workspace › Schedule");
    expect(navPath("connections")).toBe("Settings › Connections");
    expect(navPath("create")).toBe(CREATE_NAV_LABEL);
    expect(navPath("otto")).toBe(OTTO_ASSISTANT.label);
  });

  it("不存在的 key 直接炸 —— 不许静默返回一个编出来的名字", () => {
    expect(() => navPath("insights")).toThrow(/insights/);
  });

  it("每一条目的地都取得到路名,且路名与地图里的写法逐字一致", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      const path = navPath(item.key);
      expect(path.trim().length, item.key).toBeGreaterThan(0);
      expect(map, `${item.key} 的路名与地图写法不一致`).toContain(`${path} (${item.href})`);
    }
  });

  it("可说出口的名单 = 助手 + 顶层板块 + 分组名 + 每条完整路名,一条不多一条不少", () => {
    const names = navPointableNames();
    const expected = [
      OTTO_ASSISTANT.label,
      ...MERCHANT_NAV.flatMap((node) =>
        isNavGroup(node) ? [node.label, ...node.items.map((item) => navPath(item.key))] : [node.label],
      ),
    ];
    expect([...names].sort()).toEqual([...expected].sort());
    expect(new Set(names).size, "名单里不许有重名").toBe(names.length);
  });

  it("分组名是单个词 —— Otto 侧围栏按这个形状取词(#802)", () => {
    // 这条不是洁癖:packages/otto 的界面地图围栏用「分隔符两侧」认路名,分组名一旦带空格,
    // 那道围栏会取错左半边并**变红**。真要给分组起一个两词的名字,先改那道围栏再改这里。
    for (const group of MERCHANT_NAV.filter(isNavGroup)) {
      expect(group.label, `${group.key} 的分组名带了空格`).not.toMatch(/\s/);
    }
  });
});

describe("给 Otto 的界面地图", () => {
  it("路名用的是同一个分隔符(围栏按它认路)", () => {
    expect(merchantNavMap()).toContain(`Workspace ${NAV_PATH_SEPARATOR} Schedule`);
  });

  it("从同一棵树生成 —— 每一条门都在地图里", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      expect(map, `${item.key} 不在地图里`).toContain(item.href);
      expect(map, `${item.key} 的名字不在地图里`).toContain(item.label);
    }
  });

  it("分组的路写成商家跟得下去的形状", () => {
    expect(merchantNavMap()).toContain("Workspace › Schedule");
  });

  it("地图里不出现供应商或模型名(白标)", () => {
    const map = merchantNavMap().toLowerCase();
    for (const forbidden of ["seedance", "seedream", "byteplus", "claude", "anthropic", "openai"]) {
      expect(map, forbidden).not.toContain(forbidden);
    }
  });
});
