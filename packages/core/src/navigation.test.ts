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
  OTTO_ASSISTANT,
  everyNavDestination,
  isNavGroup,
  merchantNavLinks,
  merchantNavMap,
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
      // 第二个词起,除了品牌与专有名词(Otto),不许再大写开头。
      const words = item.label.split(/\s+/).slice(1);
      const shouty = words.filter((word) => /^[A-Z]/.test(word) && !["Otto"].includes(word));
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

describe("没通电的能力只开一扇诚实的门(#792)", () => {
  const customers = merchantNavLinks().find((item) => item.key === "customers");

  it("客户能力只有一扇门,而且它就是 /crm 的根", () => {
    expect(customers).toBeDefined();
    expect(customers!.href).toBe("/crm");

    // 折叠的意思是**导轨上只剩一格**:七扇 /crm/* 子门一个都不许再回到主导航。
    const crmDoors = everyNavDestination().filter((item) => item.href.startsWith("/crm"));
    expect(crmDoors.map((item) => item.href)).toEqual(["/crm"]);
  });

  it("那扇门带着一句实话,而且实话说的是渠道没接通", () => {
    expect(customers!.preview, "预览门没有实话就只是一个改了名的板块").toBeTruthy();
    expect(customers!.preview!.length).toBeGreaterThan(40);
    expect(customers!.preview).toMatch(/messaging channel/i);
  });

  it("能力齐的门不许挂 preview —— 这枚徽章只在真的没通电时出现", () => {
    const preview = everyNavDestination().filter((item) => item.preview);
    expect(preview.map((item) => item.key)).toEqual(["customers"]);
  });

  it("实话不写工期 —— 产品不承诺自己不知道的事", () => {
    for (const item of everyNavDestination()) {
      expect(item.preview ?? "", item.key).not.toMatch(/coming soon|next (week|month)|by \w+ \d{4}/i);
    }
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

describe("给 Otto 的界面地图", () => {
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

  it("预览门的实话跟着它进地图 —— Otto 不可能只说前一半(#792)", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      if (!item.preview) continue;
      // 同一行:能做什么与还不能做什么分不开。
      const line = map.split("\n").find((row) => row.includes(`(${item.href})`));
      expect(line, `${item.key} 不在地图里`).toBeDefined();
      expect(line, `${item.key} 的实话没跟上`).toContain(item.preview);
    }
  });

  it("地图里不出现供应商或模型名(白标)", () => {
    const map = merchantNavMap().toLowerCase();
    for (const forbidden of ["seedance", "seedream", "byteplus", "claude", "anthropic", "openai"]) {
      expect(map, forbidden).not.toContain(forbidden);
    }
  });
});
