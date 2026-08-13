import { describe, it, expect } from "vitest";
import {
  VIDEO_ACTION_IDS,
  VIDEO_ACTIONS,
  VIDEO_CRAFT,
  videoActionsFor,
  videoAction,
  actionNeedsClip,
  openingForTeaching,
  videoActionFromPrompt,
  VIDEO_CLIP_TOKEN,
  type VideoAction,
} from "./video-capabilities.js";
import { seedanceShot, seedancePromptInput } from "./seedance-prompt.helpers.js";

const NOTHING = { hasStill: false, hasEndStill: false, hasClip: false };
const STILL = { hasStill: true, hasEndStill: false, hasClip: false };
const STILL_PAIR = { hasStill: true, hasEndStill: true, hasClip: false };
const CLIP = { hasStill: false, hasEndStill: false, hasClip: true };

describe("VIDEO_ACTIONS — 能力表本身", () => {
  it("每个 id 有且只有一行,次序与 VIDEO_ACTION_IDS 一致", () => {
    expect(VIDEO_ACTIONS.map((c) => c.id)).toEqual([...VIDEO_ACTION_IDS]);
  });

  it("每一行都说得出它需要什么、以及商家为什么会要它", () => {
    for (const cap of VIDEO_ACTIONS) {
      expect(cap.meaning.length).toBeGreaterThan(0);
      expect(typeof cap.needs).toBe("function");
    }
  });

  it("videoAction() 按 id 取行,取不到就抛(绝不回一个空壳)", () => {
    for (const id of VIDEO_ACTION_IDS) expect(videoAction(id).id).toBe(id);
    expect(() => videoAction("nope" as VideoAction)).toThrow();
  });
});

describe("能力表按**收到什么**开门 —— 形状不对的动作永远不在候选里", () => {
  it("什么都没给:只能从文字做一条新的", () => {
    expect(videoActionsFor(NOTHING)).toEqual(["fromText"]);
  });

  it("给了一张图:动这张图;给了首尾两张:两张之间走一趟", () => {
    expect(videoActionsFor(STILL)).toEqual(["animateStill"]);
    expect(videoActionsFor(STILL_PAIR)).toEqual(["stillToStill"]);
  });

  it("给了一整条片子:改它 / 接下去 / 照着它做,三件事都开门", () => {
    expect(videoActionsFor(CLIP)).toEqual(["editClip", "extendClip", "guideFromClip"]);
  });

  it("剪辑与续写**只有**拿到整条片子才成立(这是它们与其它动作的唯一分界)", () => {
    for (const id of VIDEO_ACTION_IDS) {
      const needsClip = actionNeedsClip(id);
      expect(needsClip).toBe(id === "editClip" || id === "extendClip" || id === "guideFromClip");
      if (needsClip) {
        expect(videoAction(id).needs(NOTHING)).toBe(false);
        expect(videoAction(id).needs(STILL)).toBe(false);
      }
    }
  });
});

describe("官方句式与禁词 —— 剪辑/续写这两件事的全部要害", () => {
  it("剪辑与续写各有自己的官方开头,并且都点名那条片子", () => {
    expect(videoAction("editClip").opening).toBe(`Strictly edit ${VIDEO_CLIP_TOKEN}, and modify`);
    expect(videoAction("extendClip").opening).toBe(`Extend ${VIDEO_CLIP_TOKEN}`);
  });

  it('剪辑/续写禁 "reference" —— 官方明言那个词会把任务读成「照着做一条新的」', () => {
    expect(videoAction("editClip").bannedWords).toContain("reference");
    expect(videoAction("extendClip").bannedWords).toContain("reference");
  });

  it("照着做一条新的那一档**不禁** reference —— 它本来就是参考", () => {
    expect(videoAction("guideFromClip").bannedWords).toEqual([]);
  });

  it("片子编号只有一个位置,因为付费请求只送得出一条片子", () => {
    expect(VIDEO_CLIP_TOKEN).toBe("<Video_1>");
  });

  it("教 Otto 的那一份**不带**编号 —— 编号只能由真正装那条片子的代码产出", () => {
    expect(openingForTeaching("editClip")).toBe("Strictly edit the clip, and modify");
    expect(openingForTeaching("extendClip")).toBe("Extend the clip");
    for (const id of VIDEO_ACTION_IDS) {
      expect(openingForTeaching(id) ?? "").not.toContain(VIDEO_CLIP_TOKEN);
    }
  });

  it("没有官方句式的动作,教学面也没有", () => {
    expect(openingForTeaching("guideFromClip")).toBeNull();
    expect(openingForTeaching("fromText")).toBeNull();
  });
});

describe("从提示词认动作 —— 认的是官方开头,不是关键词", () => {
  it("两个官方开头互不吃掉", () => {
    expect(videoActionFromPrompt(`${videoAction("editClip").opening} the shirt.`)).toBe("editClip");
    expect(videoActionFromPrompt(`${videoAction("extendClip").opening} forward, he waves.`)).toBe("extendClip");
  });

  it("前面有空白照样认(装配层不产,但认的这一端不该因此变脆)", () => {
    expect(videoActionFromPrompt(`\n  ${videoAction("editClip").opening} the shirt.`)).toBe("editClip");
  });

  it("普通提示词一律回 null —— 不猜", () => {
    for (const plain of [
      "cinematic quality, natural motion, film-grade color, sharp focus",
      "a jar of sambal turns slowly on a marble counter",
      "",
      "   ",
    ]) {
      expect(videoActionFromPrompt(plain)).toBeNull();
    }
  });

  it("**只在开头**才算 —— 句中提到那几个词不构成一个动作", () => {
    for (const nearMiss of [
      "The client asked me to strictly edit <Video_1>, and modify the shirt.",
      "Later we will extend <Video_1> forward.",
      "Extend the clip forward, he waves.", // 没有编号 = 不是官方句式
      "Strictly edit the clip, and modify the shirt.", // 同上(这是**教学面**的写法)
    ]) {
      expect(videoActionFromPrompt(nearMiss)).toBeNull();
    }
  });

  it("没有官方句式的那几个动作,永远不会被认出来 —— 它们本来就没有开头可认", () => {
    for (const id of VIDEO_ACTION_IDS) {
      if (videoAction(id).opening === null) {
        expect(VIDEO_ACTIONS.filter((c) => c.id === id && c.opening !== null)).toEqual([]);
      }
    }
  });
});

describe("创作能力表 —— 每一格都必须有一个真字段撑着(不许手工猜)", () => {
  it("表里每一格指向的字段都真的在 schema 上", () => {
    const shotKeys = new Set(Object.keys(seedanceShot.shape));
    const inputKeys = new Set(Object.keys(seedancePromptInput.shape));
    for (const row of VIDEO_CRAFT) {
      if (row.field.startsWith("shot:")) {
        expect(shotKeys.has(row.field.slice("shot:".length))).toBe(true);
      } else {
        expect(inputKeys.has(row.field.slice("clip:".length))).toBe(true);
      }
    }
  });

  it("schema 上每一个可表达的字段都在表里 —— 加一个字段而不加一行,这条当场红", () => {
    const covered = new Set(VIDEO_CRAFT.map((r) => r.field));
    for (const k of Object.keys(seedanceShot.shape)) expect(covered.has(`shot:${k}`)).toBe(true);
    for (const k of Object.keys(seedancePromptInput.shape)) expect(covered.has(`clip:${k}`)).toBe(true);
  });

  it("没有重复行", () => {
    expect(new Set(VIDEO_CRAFT.map((r) => r.field)).size).toBe(VIDEO_CRAFT.length);
  });

  it("每一格都有一句给 Otto 读的人话", () => {
    for (const row of VIDEO_CRAFT) expect(row.does.length).toBeGreaterThan(0);
  });
});
