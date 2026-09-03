/**
 * library-view-model —— Library 网格上那两件**必须从真实列算出来**的东西
 * (前端基线规格 `docs/specs/frontend-baseline.md` §7.1 段②;验收行 FRONT-A5)。
 *
 * 已批准的 Library 夹具把时间分组写成三个常量(`Today / Yesterday / Earlier this month`)、
 * 把每格的名字写成一个人手打的 `title`。生产里两样都不存在:分组只能从 `createdAt` 算,
 * 名字只能来自真有的列。接线契约 §8.3② 逐字要求「时间分组从真实 created time 计算,
 * 不能沿用 fixture group」——这份文件就是那句话的围栏。
 *
 * 变异自查(逐一实做,做完还原,红→绿):
 *   · 把 `libraryTimeGroupLabel` 的月份分支换成常量 "Earlier this month" ⇒「按月分组」红;
 *   · 让 `libraryItemTitle` 在两样都没有时回落成 item.id ⇒「不编名字」红;
 *   · 让 `groupLibraryItems` 自己按时间再排一次 ⇒「保持服务端顺序」红。
 */
import { describe, expect, it } from "vitest";
import type { LibraryItem } from "../library-actions";
import {
  LIBRARY_VIEWS,
  groupLibraryItems,
  libraryDurationLabel,
  libraryItemTitle,
  libraryTimeGroupLabel,
  parseLibraryView,
} from "../library-view-model";

const NOW = new Date("2026-09-03T09:00:00.000Z");

function item(overrides: Partial<LibraryItem> & { id: string; createdAt: string }): LibraryItem {
  return {
    projectId: "prj_1",
    assetId: `ast_${overrides.id}`,
    url: `/files/u/own_1/${overrides.id}.png`,
    kind: "image",
    source: "generated",
    prompt: "",
    filename: "",
    width: null,
    height: null,
    durationS: null,
    favorite: false,
    ...overrides,
  };
}

describe("FRONT-A5 生成历史的时间分组来自真实 createdAt,不是夹具那三个常量", () => {
  it("今天与昨天按天算,再往前按月 —— 库里放多久都有一个真名字", () => {
    expect(libraryTimeGroupLabel("2026-09-03T01:00:00.000Z", NOW)).toBe("Today");
    expect(libraryTimeGroupLabel("2026-09-02T23:00:00.000Z", NOW)).toBe("Yesterday");
    expect(libraryTimeGroupLabel("2026-08-30T10:00:00.000Z", NOW)).toBe("August 2026");
    // 夹具的天花板是「Earlier this month」；真库里去年的东西必须仍然说得出自己是哪个月。
    expect(libraryTimeGroupLabel("2025-12-31T10:00:00.000Z", NOW)).toBe("December 2025");
  });

  it("分组保持传进来的顺序 —— 排序权威是服务端的 orderBy,这里不排第二次", () => {
    const groups = groupLibraryItems(
      [
        item({ id: "g3", createdAt: "2026-09-03T08:00:00.000Z" }),
        item({ id: "g2", createdAt: "2026-09-02T08:00:00.000Z" }),
        item({ id: "g1", createdAt: "2026-08-11T08:00:00.000Z" }),
        item({ id: "g0", createdAt: "2026-08-01T08:00:00.000Z" }),
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "August 2026"]);
    expect(groups[2].items.map((row) => row.id)).toEqual(["g1", "g0"]);
  });
});

describe("FRONT-A5 每一格的名字只来自真有的列", () => {
  it("上传写商家自己的文件名", () => {
    expect(libraryItemTitle({ filename: "raya-storefront.png", prompt: "" })).toBe("raya-storefront.png");
  });
  it("引擎产物写它的提示词(过长截断)", () => {
    expect(libraryItemTitle({ filename: "", prompt: "  laksa on a rattan table  " })).toBe("laksa on a rattan table");
    expect(libraryItemTitle({ filename: "", prompt: "x".repeat(200) })).toHaveLength(72);
  });
  it("两样都没有就说 Untitled —— 不拿 id 或 URL 冒充名字", () => {
    expect(libraryItemTitle({ filename: "", prompt: "   " })).toBe("Untitled");
  });
});

describe("FRONT-A5 视频时长只在真有时长的时候写", () => {
  it("有 durationS 就写 m:ss", () => {
    expect(libraryDurationLabel({ durationS: 8 })).toBe("0:08");
    expect(libraryDurationLabel({ durationS: 75.4 })).toBe("1:15");
  });
  it("没有就整块不出现,不编一个 0:00", () => {
    expect(libraryDurationLabel({ durationS: null })).toBeNull();
  });
});

describe("FRONT-A5 一级视图清单 = 今天真的有数据支撑的那几格", () => {
  // 段②第②③刀(2026-09-03)把 Favorite / Collection / CollectionItem 三张表与它们的
  // 动作层建起来了,所以这两格按前端规则第①条回到导航上 —— 顺序与已批准设计逐格一致。
  it("FRONT-A5 五格与已批准设计逐格一致(Favorites 与 Collections 已有后端对象)", () => {
    expect(LIBRARY_VIEWS.map((view) => view.value)).toEqual([
      "history",
      "uploads",
      "favorites",
      "collections",
      "elements",
    ]);
  });
  it("地址里认不出来的 ?view= 落回生成历史,而不是画一格空白", () => {
    expect(parseLibraryView("uploads")).toBe("uploads");
    expect(parseLibraryView("favorites")).toBe("favorites");
    expect(parseLibraryView("collections")).toBe("collections");
    expect(parseLibraryView("nope")).toBe("history");
    expect(parseLibraryView(undefined)).toBe("history");
  });
});
