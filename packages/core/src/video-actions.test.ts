/**
 * #775 判官 r3 —— 「这段提示词要引擎做哪一件事」的判据搬进 core。
 *
 * 为什么必须住在 core:读它的不止铸卡那一侧。**付费 schema**(`genRequest`)与
 * **卡→请求的构造器**(`gen-from-card`)都要按同一句话把关,而它们都在 core。
 * 判据抄成两份,「批准的」与「执行的」就会在某一天开始各说各话 —— 这正是 r3 逮到的那类病。
 */
import { describe, it, expect } from "vitest";
import {
  VIDEO_CLIP_TOKEN,
  VIDEO_EDIT_OPENING,
  VIDEO_EXTEND_OPENING,
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
