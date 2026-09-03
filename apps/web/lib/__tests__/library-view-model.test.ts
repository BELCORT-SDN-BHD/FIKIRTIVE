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
  librarySinceForDateFilter,
  libraryTimeGroupLabel,
  parseLibraryView,
} from "../library-view-model";

const NOW = new Date("2026-09-03T09:00:00.000Z");

/**
 * 在一个点名的时区里跑一段断言。`Date` 的本地取值器读的是进程的 `TZ`,而这份测试要证明的
 * 恰恰是「浏览者不在 UTC 时会怎样」—— 跑测试的机器碰巧在哪个时区,不能决定这条围栏成不成立。
 */
function withTimeZone<T>(zone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
  }
}

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
    expect(libraryTimeGroupLabel("2026-09-03T01:00:00.000Z", NOW, "utc")).toBe("Today");
    expect(libraryTimeGroupLabel("2026-09-02T23:00:00.000Z", NOW, "utc")).toBe("Yesterday");
    expect(libraryTimeGroupLabel("2026-08-30T10:00:00.000Z", NOW, "utc")).toBe("August 2026");
    // 夹具的天花板是「Earlier this month」；真库里去年的东西必须仍然说得出自己是哪个月。
    expect(libraryTimeGroupLabel("2025-12-31T10:00:00.000Z", NOW, "utc")).toBe("December 2025");
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
      "utc",
    );
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "August 2026"]);
    expect(groups[2].items.map((row) => row.id)).toEqual(["g1", "g0"]);
  });
});

describe("FRONT-A5 每一格的名字只来自真有的列", () => {
  it("上传写商家自己的文件名", () => {
    expect(libraryItemTitle({ source: "upload", filename: "raya-storefront.png", prompt: "" }))
      .toBe("raya-storefront.png");
  });
  it("引擎产物写它的提示词(过长截断)", () => {
    expect(libraryItemTitle({ source: "generated", filename: "", prompt: "  laksa on a rattan table  " }))
      .toBe("laksa on a rattan table");
    expect(libraryItemTitle({ source: "generated", filename: "", prompt: "x".repeat(200) })).toHaveLength(72);
  });
  it("FRONT-A5 引擎产物**带着** originalFilename 也写提示词 —— 存储键不是名字", () => {
    // 真库实测(共享 dev 库 fikirtive_dev_test):
    //   GENERATED | gen-01M1HNK1FT8YQ9HF3ZY9YM917K.mp4 | Steam curling off a jar of pandan kaya…
    // 引擎产物在生产里从来不是空 filename,所以「filename 优先」等于把机器码写到商家脸上。
    expect(
      libraryItemTitle({
        source: "generated",
        filename: "gen-01M1HNK1FT8YQ9HF3ZY9YM917K.mp4",
        prompt: "Steam curling off a jar of pandan kaya",
      }),
    ).toBe("Steam curling off a jar of pandan kaya");
  });
  it("两样都没有就说 Untitled —— 不拿 id、存储键或 URL 冒充名字", () => {
    expect(libraryItemTitle({ source: "generated", filename: "", prompt: "   " })).toBe("Untitled");
    // 提示词没了、只剩存储键的引擎产物,宁可说 Untitled 也不写 gen-<ulid>.png。
    expect(libraryItemTitle({ source: "generated", filename: "gen-01M1.png", prompt: "" })).toBe("Untitled");
  });
});

describe("FRONT-A5 日界按浏览者本地时区算,不按 UTC", () => {
  /**
   * 生产实测(2026-09-03 17:24 +08):库里最新一行 `createdAt = 2026-09-02 18:21:30 UTC`,
   * 那是商家**今天凌晨 02:21** 做的东西 —— 页面却整组只写了一个 `Yesterday 11`。
   * 下面这两条钉的就是那一刻:同一个瞬间,"utc" 说昨天,"local"(UTC+8)必须说今天。
   */
  const MY_MORNING = "2026-09-02T18:21:30.000Z"; // = 2026-09-03 02:21 in UTC+8
  const MY_NOW = new Date("2026-09-03T09:24:00.000Z"); // = 2026-09-03 17:24 in UTC+8

  it("UTC+8 的商家凌晨做的东西属于 Today,而按 UTC 算会被误标成 Yesterday", () => {
    const local = withTimeZone("Asia/Kuala_Lumpur", () =>
      libraryTimeGroupLabel(MY_MORNING, MY_NOW, "local"));
    expect(local).toBe("Today");
    expect(libraryTimeGroupLabel(MY_MORNING, MY_NOW, "utc")).toBe("Yesterday");
  });

  it("往前一天同样按本地日界,月份标题也用本地钟", () => {
    withTimeZone("Asia/Kuala_Lumpur", () => {
      // 2026-09-01 18:00Z = 本地 09-02 02:00 = 相对本地今天(09-03)的昨天。
      expect(libraryTimeGroupLabel("2026-09-01T18:00:00.000Z", MY_NOW, "local")).toBe("Yesterday");
      // 2026-07-31 18:00Z = 本地 08-01 —— 按 UTC 会写成 July 2026。
      expect(libraryTimeGroupLabel("2026-07-31T18:00:00.000Z", MY_NOW, "local")).toBe("August 2026");
      expect(libraryTimeGroupLabel("2026-07-31T18:00:00.000Z", MY_NOW, "utc")).toBe("July 2026");
    });
  });

  it("分组沿用同一个日界 —— 商家凌晨那一批不会自己掉进 Yesterday 组", () => {
    const groups = withTimeZone("Asia/Kuala_Lumpur", () =>
      groupLibraryItems(
        [
          item({ id: "g1", createdAt: MY_MORNING }),
          item({ id: "g0", createdAt: "2026-09-01T18:00:00.000Z" }),
        ],
        MY_NOW,
        "local",
      ));
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
  });
});

describe("FRONT-A5 Date created 筛选与分组共用同一个日界", () => {
  const MY_NOW = new Date("2026-09-03T09:24:00.000Z"); // = 2026-09-03 17:24 in UTC+8

  it("Today 的起点是商家本地的今天 00:00,所以本地凌晨那一批筛得出来", () => {
    const since = withTimeZone("Asia/Kuala_Lumpur", () =>
      librarySinceForDateFilter("today", MY_NOW, "local"));
    // 本地 2026-09-03 00:00 (+08) = 2026-09-02 16:00Z;商家凌晨 02:21 做的那一行(18:21Z)
    // 落在这个起点之后 —— 按 UTC 的起点(09-03 00:00Z)则会把它整个筛掉。
    expect(since).toBe("2026-09-02T16:00:00.000Z");
    expect(new Date("2026-09-02T18:21:30.000Z").getTime()).toBeGreaterThan(new Date(since!).getTime());
    expect(librarySinceForDateFilter("today", MY_NOW, "utc")).toBe("2026-09-03T00:00:00.000Z");
  });

  it("Any time 不带起点;Last 7 days 是与时区无关的滚动窗口", () => {
    expect(librarySinceForDateFilter("all", MY_NOW, "local")).toBeUndefined();
    expect(librarySinceForDateFilter("week", MY_NOW, "local")).toBe("2026-08-27T09:24:00.000Z");
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
  it("只有生成历史、上传与 Elements —— Favorites 与 Collections 后端还没有对象", () => {
    expect(LIBRARY_VIEWS.map((view) => view.value)).toEqual(["history", "uploads", "elements"]);
  });
  it("地址里认不出来的 ?view= 落回生成历史,而不是画一格空白", () => {
    expect(parseLibraryView("uploads")).toBe("uploads");
    expect(parseLibraryView("favorites")).toBe("history");
    expect(parseLibraryView("collections")).toBe("history");
    expect(parseLibraryView(undefined)).toBe("history");
  });
});
