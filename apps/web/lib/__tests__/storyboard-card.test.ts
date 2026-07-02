import { describe, it, expect } from "vitest";
import { parseStoryboardCardPayload, MAX_STORYBOARD_SHOTS } from "../storyboard-card";
import { MAX_STORYBOARD_SHOTS as MAX_STORYBOARD_SHOTS_OTTO } from "@fikirtive/otto";

describe("MAX_STORYBOARD_SHOTS (client-safe copy)", () => {
  // 本地纯值副本存在,只为让 "use client" 的 StoryboardCard 不必 import @fikirtive/otto
  // (那会把 skills→prisma→pg 拖进浏览器 bundle,导致 build 失败)。这条断言在 node 侧
  // 跑,import otto 安全 —— 一旦权威值改动而副本没跟,测试立刻红,漂移不可能。
  it("等于 @fikirtive/otto 的权威值", () => {
    expect(MAX_STORYBOARD_SHOTS).toBe(MAX_STORYBOARD_SHOTS_OTTO);
  });
});

describe("parseStoryboardCardPayload", () => {
  it("empty / undefined payload → 空标题 + 空 shots", () => {
    expect(parseStoryboardCardPayload(undefined)).toEqual({ storyboardTitle: "", shots: [] });
    expect(parseStoryboardCardPayload(null)).toEqual({ storyboardTitle: "", shots: [] });
    expect(parseStoryboardCardPayload({})).toEqual({ storyboardTitle: "", shots: [] });
  });

  it("shots 不是数组 → shots 归空,标题仍解析", () => {
    const r = parseStoryboardCardPayload({ storyboardTitle: "T", shots: "nope" });
    expect(r).toEqual({ storyboardTitle: "T", shots: [] });
  });

  it("合法 payload → 映射 title + 双 prompt + shotId,按 index 排序", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "New shoes ad",
      shots: [
        { shotId: "sb", index: 1, title: "Hero", firstFramePrompt: "ff-1", videoPrompt: "v-1" },
        { shotId: "sa", index: 0, firstFramePrompt: "ff-0", videoPrompt: "v-0" },
      ],
    });
    expect(r.storyboardTitle).toBe("New shoes ad");
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(r.shots[0]).toEqual({ shotId: "sa", index: 0, firstFramePrompt: "ff-0", videoPrompt: "v-0" });
    expect(r.shots[1].title).toBe("Hero");
    expect(r.shots[1].shotId).toBe("sb");
  });

  it("缺失 shotId 的遗留 payload → 回落到 String(index)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ index: 0, firstFramePrompt: "a", videoPrompt: "b" }, { index: 1, firstFramePrompt: "c", videoPrompt: "d" }],
    });
    expect(r.shots.map((s) => s.shotId)).toEqual(["0", "1"]);
  });

  it("entityIds 是字符串数组时透传,否则省略", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [
        { shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", entityIds: ["ent_1"] },
        { shotId: "s1", index: 1, firstFramePrompt: "c", videoPrompt: "d", entityIds: "nope" },
      ],
    });
    expect(r.shots[0].entityIds).toEqual(["ent_1"]);
    expect(r.shots[1].entityIds).toBeUndefined();
  });

  it("缺失 prompt 字段 → 兜底成空串(不抛)", () => {
    const r = parseStoryboardCardPayload({ storyboardTitle: "X", shots: [{ index: 0 }] });
    expect(r.shots[0].firstFramePrompt).toBe("");
    expect(r.shots[0].videoPrompt).toBe("");
  });

  it("index 缺失 → 回落到数组位置", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ firstFramePrompt: "a", videoPrompt: "b" }, { firstFramePrompt: "c", videoPrompt: "d" }],
    });
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
  });

  it("有 firstFrameGenerationId 时透传(F4 会用)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ index: 0, firstFramePrompt: "a", videoPrompt: "b", firstFrameGenerationId: "gen_123" }],
    });
    expect(r.shots[0].firstFrameGenerationId).toBe("gen_123");
  });

  it("firstFrameCardId 透传(F4 用)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", firstFrameCardId: "child-1" }],
    });
    expect(r.shots[0].firstFrameCardId).toBe("child-1");
  });
});
