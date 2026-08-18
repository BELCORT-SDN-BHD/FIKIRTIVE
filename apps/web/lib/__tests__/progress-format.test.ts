import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatElapsed, QUEUE_WAIT_NOTE } from "../progress-format";

describe("formatElapsed", () => {
  it('returns "0:00" for 0', () => expect(formatElapsed(0)).toBe("0:00"));
  it('returns "0:05" for 5', () => expect(formatElapsed(5)).toBe("0:05"));
  it('returns "1:23" for 83', () => expect(formatElapsed(83)).toBe("1:23"));
  it('returns "0:00" for negative', () => expect(formatElapsed(-3)).toBe("0:00"));
  it('returns "0:00" for NaN', () => expect(formatElapsed(NaN)).toBe("0:00"));
  it('returns "0:00" for Infinity', () => expect(formatElapsed(Infinity)).toBe("0:00"));
  it('returns "10:00" for 600', () => expect(formatElapsed(600)).toBe("10:00"));
});

// #979 —— 排队那句话不许再带一个没人测过的秒数。
//
// 旧版写死 “usually ~20s” / “usually ~45s”:beta 录像里实测第一次等待 34 秒,而秒表就在
// 那句话旁边跑着 —— 商家看到的是产品在数一个自己当场推翻的数。这条测试封的是「换一个
// 更大的假数字」这件事,不是「换个措辞」:任何数字都不许回到这句话里。
describe("QUEUE_WAIT_NOTE", () => {
  it("carries no number — an unmeasured estimate is what broke trust", () => {
    expect(QUEUE_WAIT_NOTE).not.toMatch(/\d/);
  });

  it("does not dress a guess up as a measurement", () => {
    expect(QUEUE_WAIT_NOTE.toLowerCase()).not.toContain("usually");
    expect(QUEUE_WAIT_NOTE.toLowerCase()).not.toContain("average");
  });

  // 判官第二轮:删掉数字还不够。「a minute or two」没有数字,却仍然是一句量级断言 ——
  // 背后同样没有测量,同样会被旁边那台秒表当场推翻。封的是**量级**这件事本身,
  // 不是阿拉伯数字这个写法。
  it.each(["minute", "minutes", "hour", "hours", "second", "seconds"])(
    "names no unit of time (%s) — a vague magnitude is still an unmeasured claim",
    (unit) => {
      expect(QUEUE_WAIT_NOTE.toLowerCase().split(/\W+/)).not.toContain(unit);
    },
  );

  it("still tells the merchant this is not instant", () => {
    expect(QUEUE_WAIT_NOTE).toBe("this can take a moment");
  });

  // 一处作者:仓库里本来就有这句诚实的话(StoryboardCard 的「Working — …」)。
  // 两处各写各的,就一定会有一处先漂回一个数字。
  it("is the ONE author of this sentence — StoryboardCard reads the constant", () => {
    const source = readFileSync(
      path.join(__dirname, "../../components/otto/StoryboardCard.tsx"),
      "utf8",
    );
    expect(source, "StoryboardCard 又手写了一份等待措辞").not.toContain("take a moment…");
    expect(source).toContain("QUEUE_WAIT_NOTE");
  });
});
