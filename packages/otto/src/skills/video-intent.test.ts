import { describe, it, expect } from "vitest";
import { anchoredActionUnavailableReason } from "@fikirtive/core";
import { decideVideoAction, VIDEO_INTENT_SIGNALS } from "./video-intent.js";
import { VIDEO_ACTION_IDS } from "./video-capabilities.js";
import { assembleSeedance, seedancePromptInput } from "./seedance-prompt.helpers.js";

const NOTHING = { hasStill: false, hasEndStill: false, hasClip: false };
const STILL = { hasStill: true, hasEndStill: false, hasClip: false };
const CLIP = { hasStill: false, hasEndStill: false, hasClip: true };

function actionOf(text: string, shape = CLIP) {
  const d = decideVideoAction({ text, shape });
  if (d.kind !== "action") throw new Error(`expected an action, got ask: ${JSON.stringify(d)}`);
  return d.action;
}

describe("意图 → 动作:承重形状(商家说人话,Otto 选对那件事)", () => {
  it("「改这条片子」那一族 → 剪辑", () => {
    for (const text of [
      "can you change the shirt in this clip to red",
      "fix the ending of this video please",
      "把这条片子的衣服改成红色",
      "帮我修一下这段视频的结尾",
      "tolong ubah baju dalam klip ni jadi merah",
    ]) {
      expect(actionOf(text)).toBe("editClip");
    }
  });

  /**
   * #922:这一族原本落到 `extendClip`。续写在 beta 期间下架(Founder 裁决 2026-08-14)
   * 之后,它不再是一个动作 —— 但**信号一个字没删**,因为认得出他要什么,才说得出那句
   * 实话。落到别的动作(比如「照着它做一条新的」)才是这里最危险的错法:商家会为一条
   * 他没要的片子付钱。
   */
  it("「接下去」那一族 → 照实说这件事现在关着,绝不换成另一个动作(#922)", () => {
    for (const text of [
      "keep it going for a few more seconds",
      "what happens next in this clip",
      "把这条片子接下去",
      "这段视频再延长一点",
      "sambung klip ni lagi sikit",
    ]) {
      const d = decideVideoAction({ text, shape: CLIP });
      expect(d.kind, text).toBe("ask");
      if (d.kind !== "ask") throw new Error("unreachable");
      expect(d.question, text).toBe(anchoredActionUnavailableReason("extendClip"));
      // 挂着片子的人不该被叫去「把片子挂上来」—— 那句话在这里是假的。
      expect(d.question).not.toContain("attach it");
    }
  });

  it("「照着这条做一条新的」那一族 → 参考", () => {
    for (const text of [
      "make one like this for my sambal",
      "same vibe as this clip but for my new product",
      "照着这条的感觉再做一条",
      "buat satu macam ni untuk produk baru",
    ]) {
      expect(actionOf(text)).toBe("guideFromClip");
    }
  });

  it("挂了片子却一个信号都没有 → 不预判,落到「照着它做」这一档,不擅自去改商家的片子", () => {
    expect(actionOf("here you go")).toBe("guideFromClip");
    expect(actionOf("")).toBe("guideFromClip");
  });

  it("没挂东西 / 挂了一张图,各自落到自己那一档", () => {
    expect(actionOf("make me a clip about my new sambal", NOTHING)).toBe("fromText");
    expect(actionOf("bring this photo to life", STILL)).toBe("animateStill");
  });
});

describe("含糊与错配 —— 宁可问一句,绝不静默做错那件事", () => {
  // #922:两件事里有一件关着 ⇒ 先说关着的那一句(而不是把两件事摆出来让他选一个
  // 他其实拿不到的)。选项仍然点名那个动作,好让铸卡侧的第二个证人认得出这是哪一件事。
  it("同一句话里既要改又要接 → 先说「接下去现在关着」,不假装还能选(#922)", () => {
    const d = decideVideoAction({ text: "change the ending and keep it going", shape: CLIP });
    expect(d.kind).toBe("ask");
    if (d.kind !== "ask") throw new Error("unreachable");
    expect(d.options).toEqual(["extendClip"]);
    expect(d.question).toBe(anchoredActionUnavailableReason("extendClip"));
  });

  it("嘴上说要改片子,手上一条片子都没挂 → 问一句,不悄悄改成别的动作", () => {
    const d = decideVideoAction({ text: "change the shirt in this video to red", shape: NOTHING });
    expect(d.kind).toBe("ask");
    if (d.kind !== "ask") throw new Error("unreachable");
    expect(d.options).toEqual(["editClip"]);
  });

  it("说要接下去、却没挂片子 → 同样问一句", () => {
    const d = decideVideoAction({ text: "把这条片子接下去", shape: NOTHING });
    expect(d.kind).toBe("ask");
  });

  it("反问最多一句 —— 选项不超过两个(含糊 ≤2 问)", () => {
    const d = decideVideoAction({ text: "change the ending and keep it going and make one like this", shape: CLIP });
    if (d.kind === "ask") expect(d.options.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 判官 r1 P1-1 —— 这个模块的**生产入口**:按提示词判,而不是按一个可以漏传的声明
// ---------------------------------------------------------------------------

const promptOf = (mode: "edit" | "extend" | "t2v" | "i2v") =>
  assembleSeedance(
    seedancePromptInput.parse({ mode, shots: [{ subject: "the jar", action: "turns slowly" }] }),
  );

describe("提示词是最强证据 —— 它就是引擎真会收到的那段字", () => {
  it("严格编辑的开头 + 手上有片子 ⇒ 剪辑,商家一个字都没说也一样", () => {
    const d = decideVideoAction({ prompt: promptOf("edit"), shape: CLIP });
    expect(d.kind).toBe("action");
    if (d.kind !== "action") throw new Error("unreachable");
    expect(d.action).toBe("editClip");
  });

  // #922:提示词仍然被**认成**续写(认不出来,付费闸就拒不了残留卡);认出来之后,
  // 回的是「这件事现在关着」那一句,而不是一个动作。
  it("延长的开头 + 手上有片子 ⇒ 认得出是续写,但照实说它现在关着(#922)", () => {
    const d = decideVideoAction({ prompt: promptOf("extend"), shape: CLIP });
    if (d.kind !== "ask") throw new Error("expected an ask");
    expect(d.options).toEqual(["extendClip"]);
    expect(d.question).toBe(anchoredActionUnavailableReason("extendClip"));
  });

  it("严格编辑的开头、手上一条片子都没有 ⇒ 问一句,绝不落到别的动作上", () => {
    const d = decideVideoAction({ prompt: promptOf("edit"), shape: NOTHING });
    expect(d.kind).toBe("ask");
    if (d.kind !== "ask") throw new Error("unreachable");
    expect(d.options).toEqual(["editClip"]);
  });

  it("提示词与商家的话对不上时,**提示词说了算** —— 它才是引擎收到的东西", () => {
    const d = decideVideoAction({ text: "make one like this", prompt: promptOf("edit"), shape: CLIP });
    if (d.kind !== "action") throw new Error("expected an action");
    expect(d.action).toBe("editClip");
  });

  it("没有官方开头的提示词 + 有片子 ⇒ 确定语义:照着做一条新的", () => {
    for (const mode of ["t2v", "i2v"] as const) {
      const d = decideVideoAction({ prompt: promptOf(mode), shape: CLIP });
      if (d.kind !== "action") throw new Error("expected an action");
      expect(d.action).toBe("guideFromClip");
    }
  });

  it("没给提示词时,老的按话判一个字没变(剪辑这一族)", () => {
    expect(actionOf("把这条片子的衣服改成红色")).toBe("editClip");
  });
});

describe("信号表本身", () => {
  it("同一个词不会在两种语言里各记一次(#485 判官 P2:三语信号重复计权)", () => {
    for (const [, langs] of Object.entries(VIDEO_INTENT_SIGNALS)) {
      const all = Object.values(langs).flat();
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it("一个信号只属于一个动作 —— 否则打分永远打平", () => {
    const seen = new Map<string, string>();
    for (const [action, langs] of Object.entries(VIDEO_INTENT_SIGNALS)) {
      for (const phrase of Object.values(langs).flat()) {
        expect(seen.get(phrase), `"${phrase}" 同时属于 ${seen.get(phrase)} 与 ${action}`).toBeUndefined();
        seen.set(phrase, action);
      }
    }
  });

  it("信号表只给需要辨认的动作建格 —— 表上的 key 必须是真动作", () => {
    for (const key of Object.keys(VIDEO_INTENT_SIGNALS)) {
      expect(VIDEO_ACTION_IDS).toContain(key);
    }
  });

  it("政策是能力表,不是硬拦截 —— 任何一句话都拿得到一个动作或一个问题,永不拒绝", () => {
    // 八种形状全枚举(三个布尔),含讲不通的那几种 —— 每一种都必须有出口,
    // 而且拿到的 action 一定是能力表上真有的那几个,绝不是 undefined。
    for (const hasStill of [false, true]) {
      for (const hasEndStill of [false, true]) {
        for (const hasClip of [false, true]) {
          for (const text of ["", "???", "做点什么", "asdfgh", "生成", "change this clip"]) {
            const d = decideVideoAction({ text, shape: { hasStill, hasEndStill, hasClip } });
            expect(["action", "ask"]).toContain(d.kind);
            if (d.kind === "action") expect(VIDEO_ACTION_IDS).toContain(d.action);
          }
        }
      }
    }
  });

  it("形状讲不通(只有末帧、没有首帧)⇒ 问一句,不从空集合里取一个不存在的动作", () => {
    const d = decideVideoAction({
      text: "animate this",
      shape: { hasStill: false, hasEndStill: true, hasClip: false },
    });
    expect(d.kind).toBe("ask");
    if (d.kind !== "ask") throw new Error("unreachable");
    expect(d.options).toEqual([]);
    expect(d.question.length).toBeGreaterThan(0);
  });
});
