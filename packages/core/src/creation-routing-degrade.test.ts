/**
 * CREATE-A5 前半条的**第二条**分支:「在菜单上、但它自己声明的默认档没有价」。
 *
 * 为什么要单独一个文件:今天两个在产槽位的默认档都在 SKU 白名单上
 * (mini 默认 720p、高清槽位默认 1080p),所以这条分支用真实数据**构造不出来**——
 * r1 判官正是据此判它是零覆盖的死代码。这里把白名单注入成「高清槽位的默认档没有价」,
 * 让这条分支真的跑一次:降级回默认槽位 + 留日志,而不是让商家撞一次墙。
 *
 * 只替换 `isSellableVideoSku` 一个函数,其余 spend.js 原样透传(`importOriginal`)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isSellableVideoSku = vi.fn();
vi.mock("./spend.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./spend.js")>()),
  isSellableVideoSku,
}));

const { activeVideoModel } = await import("./model-config.js");

beforeEach(() => {
  vi.clearAllMocks();
  // 高清槽位的默认档(1080p)被判为「没有价」;默认槽位照旧有价。
  isSellableVideoSku.mockImplementation((model: string) => model !== "seedance-2-0");
});
afterEach(() => vi.restoreAllMocks());

describe("CREATE-A5 默认档配错的第二种形状:槽位在菜单上,但它的默认档没有价", () => {
  it("CREATE-A5 在菜单上但默认档不可售 ⇒ 降级回白名单内的默认槽位,并留日志", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-0" })).toBe("seedance-2-mini");
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain("OTTO_DEFAULT_VIDEO_MODEL=seedance-2-0");
    // 日志要说清楚是**哪一种**配错(没有过毛利地板的价),不是一句泛泛的「用不了」。
    expect(line).toContain("no margin-floored price for its default tier");
  });

  it("CREATE-A5 同一次注入下,默认档有价的槽位照旧生效、不打日志", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-mini" })).toBe("seedance-2-mini");
    expect(warn).not.toHaveBeenCalled();
  });
});
