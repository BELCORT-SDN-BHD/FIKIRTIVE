import { describe, it, expect } from "vitest";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
} from "../storyboard-edit";
import type { StoryboardCardPayload } from "@fikirtive/otto";

function base(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { index: 0, title: "A", firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameGenerationId: "gen0" },
      { index: 1, firstFramePrompt: "ff1", videoPrompt: "v1", firstFrameGenerationId: "gen1" },
      { index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

describe("applyEditShotPrompt", () => {
  it("改 firstFramePrompt → 更新文字并清掉该镜头 firstFrameGenerationId", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW" });
    expect(r.shots[0].firstFramePrompt).toBe("NEW");
    expect(r.shots[0].firstFrameGenerationId).toBeUndefined();
    expect("firstFrameGenerationId" in r.shots[0]).toBe(false);
  });
  it("改 videoPrompt 也清该镜头首帧图引用", () => {
    const r = applyEditShotPrompt(base(), 1, { videoPrompt: "NEWV" });
    expect(r.shots[1].videoPrompt).toBe("NEWV");
    expect(r.shots[1].firstFrameGenerationId).toBeUndefined();
  });
  it("不影响其它镜头的 firstFrameGenerationId", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW" });
    expect(r.shots[1].firstFrameGenerationId).toBe("gen1");
  });
  it("越界 index → 原样返回", () => {
    const r = applyEditShotPrompt(base(), 9, { firstFramePrompt: "X" });
    expect(r.shots).toEqual(base().shots);
  });
  it("不 mutate 入参", () => {
    const b = base();
    applyEditShotPrompt(b, 0, { firstFramePrompt: "NEW" });
    expect(b.shots[0].firstFramePrompt).toBe("ff0");
    expect(b.shots[0].firstFrameGenerationId).toBe("gen0");
  });
});

describe("applyAddShot", () => {
  it("追加新镜头并重编 index;新镜头无 firstFrameGenerationId", () => {
    const r = applyAddShot(base(), { firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect(r.shots).toHaveLength(4);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(r.shots[3].firstFramePrompt).toBe("ffN");
    expect(r.shots[3].firstFrameGenerationId).toBeUndefined();
  });
  it("带 title", () => {
    const r = applyAddShot(base(), { title: "T", firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect(r.shots[3].title).toBe("T");
  });
});

describe("applyDeleteShot", () => {
  it("删中间镜头 → 其余重编 0-based", () => {
    const r = applyDeleteShot(base(), 1);
    expect(r.shots).toHaveLength(2);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(r.shots.map((s) => s.firstFramePrompt)).toEqual(["ff0", "ff2"]);
  });
  it("越界 index → 原样返回", () => {
    const r = applyDeleteShot(base(), 9);
    expect(r.shots).toHaveLength(3);
  });
});

describe("applyReorderShots", () => {
  it("按给定顺序重排并重编 index", () => {
    const r = applyReorderShots(base(), [2, 0, 1]);
    expect(r.shots.map((s) => s.firstFramePrompt)).toEqual(["ff2", "ff0", "ff1"]);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1, 2]);
  });
  it("order 不是当前 index 的合法排列 → 原样返回", () => {
    expect(applyReorderShots(base(), [0, 1]).shots).toEqual(base().shots);      // 少一个
    expect(applyReorderShots(base(), [0, 1, 5]).shots).toEqual(base().shots);   // 含越界
    expect(applyReorderShots(base(), [0, 0, 1]).shots).toEqual(base().shots);   // 重复
  });

  it("非法排列返回同一引用(动作层 `next === cur` 守卫依赖此契约)", () => {
    const b = base();
    // 返回值必须是 SAME 引用,不是等值副本 —— reorderShots 动作靠 `next === cur`
    // 判定"非法排列 → 不回写",若改成返回副本会静默破坏该守卫。
    expect(applyReorderShots(b, [0, 1])).toBe(b);
  });
});
