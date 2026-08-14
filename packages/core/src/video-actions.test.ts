/**
 * #775 判官 r3 —— 「这段提示词要引擎做哪一件事」的判据搬进 core。
 *
 * 为什么必须住在 core:读它的不止铸卡那一侧。**付费 schema**(`genRequest`)与
 * **卡→请求的构造器**(`gen-from-card`)都要按同一句话把关,而它们都在 core。
 * 判据抄成两份,「批准的」与「执行的」就会在某一天开始各说各话 —— 这正是 r3 逮到的那类病。
 */
import { describe, it, expect } from "vitest";
import {
  ANCHORED_ACTION_UNAVAILABLE,
  VIDEO_CLIP_TOKEN,
  VIDEO_EDIT_OPENING,
  VIDEO_EXTEND_OPENING,
  anchoredActionUnavailableReason,
  anchoredVideoAction,
  isAnchoredVideoPrompt,
} from "./video-actions.js";

describe("官方开头", () => {
  it("片子只有一个编号位 —— 付费请求只送得出一条片子", () => {
    expect(VIDEO_CLIP_TOKEN).toBe("<Video_1>");
    expect(VIDEO_EDIT_OPENING).toBe("Strictly edit <Video_1>, and modify");
    expect(VIDEO_EXTEND_OPENING).toBe("Extend <Video_1>");
  });
});

describe("认得出装配器真会产出的那两种开头", () => {
  it("剪辑 / 续写各自认得出来", () => {
    expect(anchoredVideoAction(`${VIDEO_EDIT_OPENING} the shirt to red.`)).toBe("editClip");
    expect(anchoredVideoAction(`${VIDEO_EXTEND_OPENING} forward, he waves.`)).toBe("extendClip");
    expect(isAnchoredVideoPrompt(`${VIDEO_EDIT_OPENING} the shirt to red.`)).toBe(true);
  });

  it("前导空白照认", () => {
    expect(anchoredVideoAction(`\n  ${VIDEO_EDIT_OPENING} the shirt.`)).toBe("editClip");
  });
});

describe("判官 r3 P2 —— 开头要有**结束边界**,不是 startsWith 就算", () => {
  it("开头后面直接黏着别的字 ⇒ 不算(判官原样探针)", () => {
    expect(anchoredVideoAction("Strictly edit <Video_1>, and modifyX the shirt.")).toBeNull();
    expect(anchoredVideoAction("Strictly edit <Video_1>, and modifying the shirt.")).toBeNull();
    expect(anchoredVideoAction("Extend <Video_1>ing forward, he waves.")).toBeNull();
    expect(anchoredVideoAction("Extend <Video_1>x")).toBeNull();
  });

  it("装配器产出的形状永远是「开头 + 一个空格 + 内容」,所以边界就是那个空格", () => {
    expect(anchoredVideoAction(`${VIDEO_EDIT_OPENING} a`)).toBe("editClip");
    expect(anchoredVideoAction(`${VIDEO_EXTEND_OPENING} forward, a`)).toBe("extendClip");
  });

  it("光有开头、后面什么都没有 ⇒ 不算(装配器不产这种东西)", () => {
    expect(anchoredVideoAction(VIDEO_EDIT_OPENING)).toBeNull();
    expect(anchoredVideoAction(VIDEO_EXTEND_OPENING)).toBeNull();
  });
});

describe("只在开头才算,普通提示词一律 null", () => {
  it("句中提到不算", () => {
    for (const p of [
      "The client asked me to strictly edit <Video_1>, and modify the shirt.",
      "Later we will extend <Video_1> forward.",
    ]) {
      expect(anchoredVideoAction(p)).toBeNull();
    }
  });

  it("少了编号不算 —— 没有编号就不是官方句式", () => {
    expect(anchoredVideoAction("Strictly edit the clip, and modify the shirt.")).toBeNull();
    expect(anchoredVideoAction("Extend the clip forward, he waves.")).toBeNull();
  });

  it("普通提示词、空串、纯空白", () => {
    for (const p of ["a jar of sambal turns slowly", "", "   ", "cinematic quality, natural motion"]) {
      expect(anchoredVideoAction(p)).toBeNull();
      expect(isAnchoredVideoPrompt(p)).toBe(false);
    }
  });
});

/**
 * #922 缺口 B 前置 —— beta 期间的下架名单。
 *
 * 名单是**唯一**权威:Otto 的能力表、商家手动入口、以及付费 schema 都从这里读。
 * 所以这一组只证名单本身说得清、说得一致 —— 三处「真的读了它」由各自那一层的
 * 测试证(`video-capabilities.test.ts` / `clip-manual-entry.test.ts` /
 * `anchored-spend-gate.test.ts`),这里不代它们签字。
 */
describe("#922 —— 下架名单", () => {
  it("续写关着,剪辑开着", () => {
    expect(anchoredActionUnavailableReason("extendClip")).not.toBeNull();
    expect(anchoredActionUnavailableReason("editClip")).toBeNull();
  });

  it("关着的那一句是给商家看的人话:说清关了什么、还剩什么,且不出现供应商名", () => {
    const said = anchoredActionUnavailableReason("extendClip")!;
    expect(said.length).toBeGreaterThan(0);
    // 还剩什么必须说 —— 只说「不行」等于把商家推到猜。
    expect(said.toLowerCase()).toContain("clip");
    expect(said.toLowerCase()).not.toMatch(/seedance|byteplus|ark|volc|credit/);
  });

  it("名单只收锚定那两档 —— 表上不许出现别的 key", () => {
    for (const key of Object.keys(ANCHORED_ACTION_UNAVAILABLE)) {
      expect(["editClip", "extendClip"]).toContain(key);
    }
  });

  it("下架不影响**认字**:那段字仍然被认成续写(认错了,付费闸就拒不了它)", () => {
    expect(anchoredVideoAction(`${VIDEO_EXTEND_OPENING} forward, he waves.`)).toBe("extendClip");
    expect(isAnchoredVideoPrompt(`${VIDEO_EXTEND_OPENING} forward, he waves.`)).toBe(true);
  });
});
