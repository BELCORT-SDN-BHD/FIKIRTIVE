import { describe, it, expect } from "vitest";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
  applySetContinuity,
} from "../storyboard-edit";
import type { StoryboardCardPayload } from "@fikirtive/otto";

function base(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      // s0 carries the FULL frame+video pointer set — cascade matrix exercises which keys survive.
      { shotId: "s0", index: 0, title: "A", firstFramePrompt: "ff0", videoPrompt: "v0", entityIds: ["ent_a"], durationSeconds: 5, firstFrameCardId: "fc0", firstFrameGenerationId: "gen0", videoCardId: "vc0", videoGenerationId: "vg0" },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1", firstFrameGenerationId: "gen1", videoGenerationId: "vg1" },
      { shotId: "s2", index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

describe("applyEditShotPrompt — cascade matrix (G-block)", () => {
  // --- firstFramePrompt present → frame stale ⇒ video stale: drop ALL FOUR keys ---
  it("改 firstFramePrompt → 更新文字并清帧两键 + 视频两键(帧过期⇒视频过期)", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW" });
    expect(r.shots[0].firstFramePrompt).toBe("NEW");
    expect("firstFrameCardId" in r.shots[0]).toBe(false);
    expect("firstFrameGenerationId" in r.shots[0]).toBe(false);
    expect("videoCardId" in r.shots[0]).toBe(false);
    expect("videoGenerationId" in r.shots[0]).toBe(false);
  });
  it("编辑保留该镜头的 shotId 与 entityIds(只清帧/视频引用)", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW" });
    expect(r.shots[0].shotId).toBe("s0");
    expect(r.shots[0].entityIds).toEqual(["ent_a"]);
  });

  // --- videoPrompt-ONLY → G-block correction of F3: PRESERVE the paid frame, drop only video ---
  it("只改 videoPrompt → 只清视频两键;帧两键(含已付费的首帧图)保留", () => {
    // G-block semantic FIX to F3: F3 unconditionally dropped the frame keys on any edit.
    // Editing video text must NOT invalidate the paid first frame — only the two video keys go.
    const r = applyEditShotPrompt(base(), 0, { videoPrompt: "NEWV" });
    expect(r.shots[0].videoPrompt).toBe("NEWV");
    // frame keys PRESERVED with their original values
    expect(r.shots[0].firstFrameCardId).toBe("fc0");
    expect(r.shots[0].firstFrameGenerationId).toBe("gen0");
    // video keys DROPPED (by key omission)
    expect("videoCardId" in r.shots[0]).toBe(false);
    expect("videoGenerationId" in r.shots[0]).toBe(false);
  });

  // --- durationSeconds-ONLY (new patch field) → apply value, drop only video pair, frame intact ---
  it("只改 durationSeconds → 写入时长 + 只清视频两键;帧两键保留(时长变⇒视频过期)", () => {
    const r = applyEditShotPrompt(base(), 0, { durationSeconds: 10 });
    expect(r.shots[0].durationSeconds).toBe(10);
    expect(r.shots[0].firstFrameCardId).toBe("fc0");
    expect(r.shots[0].firstFrameGenerationId).toBe("gen0");
    expect("videoCardId" in r.shots[0]).toBe(false);
    expect("videoGenerationId" in r.shots[0]).toBe(false);
  });

  // --- combination: firstFramePrompt + videoPrompt → still all four dropped ---
  it("组合:含 firstFramePrompt(+videoPrompt)→ 四键全清", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW", videoPrompt: "NEWV" });
    expect(r.shots[0].firstFramePrompt).toBe("NEW");
    expect(r.shots[0].videoPrompt).toBe("NEWV");
    expect("firstFrameCardId" in r.shots[0]).toBe(false);
    expect("firstFrameGenerationId" in r.shots[0]).toBe(false);
    expect("videoCardId" in r.shots[0]).toBe(false);
    expect("videoGenerationId" in r.shots[0]).toBe(false);
  });

  it("不影响其它镜头的 frame/video 引用", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW" });
    expect(r.shots[1].firstFrameGenerationId).toBe("gen1");
    expect(r.shots[1].videoGenerationId).toBe("vg1");
  });
  it("越界 index → 原样返回", () => {
    const r = applyEditShotPrompt(base(), 9, { firstFramePrompt: "X" });
    expect(r.shots).toEqual(base().shots);
  });
  it("不 mutate 入参", () => {
    const b = base();
    applyEditShotPrompt(b, 0, { videoPrompt: "NEWV" });
    expect(b.shots[0].videoPrompt).toBe("v0");
    expect(b.shots[0].videoGenerationId).toBe("vg0");
    expect(b.shots[0].firstFrameGenerationId).toBe("gen0");
  });
});

describe("applyAddShot", () => {
  it("追加新镜头并重编 index;新镜头带 shotId、无 firstFrameGenerationId", () => {
    const r = applyAddShot(base(), { shotId: "sN", firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect(r.shots).toHaveLength(4);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(r.shots[3].shotId).toBe("sN");
    expect(r.shots[3].firstFramePrompt).toBe("ffN");
    expect(r.shots[3].firstFrameGenerationId).toBeUndefined();
  });
  it("带 title", () => {
    const r = applyAddShot(base(), { shotId: "sN", title: "T", firstFramePrompt: "ffN", videoPrompt: "vN" });
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
  it("按给定顺序重排并重编 index(shotId 跟着镜头走,不因重排改变)", () => {
    const r = applyReorderShots(base(), [2, 0, 1]);
    expect(r.shots.map((s) => s.firstFramePrompt)).toEqual(["ff2", "ff0", "ff1"]);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(r.shots.map((s) => s.shotId)).toEqual(["s2", "s0", "s1"]);
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

  it("重排经 restamp `...s` 展开自然保留新字段(durationSeconds/video 两键)", () => {
    // s0 (full pointer set) moves to position 1; its new G-block fields must survive the spread.
    const r = applyReorderShots(base(), [2, 0, 1]);
    const moved = r.shots[1];
    expect(moved.shotId).toBe("s0");
    expect(moved.durationSeconds).toBe(5);
    expect(moved.videoCardId).toBe("vc0");
    expect(moved.videoGenerationId).toBe("vg0");
    expect(moved.firstFrameGenerationId).toBe("gen0");
  });
});

describe("#782 applySetContinuity —— 只改开关,一件已生成的东西都不动", () => {
  it("开 → 落 continuity:true,镜头逐字不变(含已付费的帧/片键)", () => {
    const p = base();
    const next = applySetContinuity(p, true);
    expect(next.continuity).toBe(true);
    expect(next.shots).toEqual(p.shots);
    expect(p.continuity).toBeUndefined(); // 不 mutate 入参
  });

  it("关 → 不落键(与从没开过逐字节同形),镜头同样不动", () => {
    const p = { ...base(), continuity: true };
    const next = applySetContinuity(p, false);
    expect("continuity" in next).toBe(false);
    expect(next.shots).toEqual(p.shots);
  });

  it("反复开关不会累积任何副作用", () => {
    const p = base();
    const back = applySetContinuity(applySetContinuity(applySetContinuity(p, true), false), true);
    expect(back.continuity).toBe(true);
    expect(back.shots).toEqual(p.shots);
  });
});
