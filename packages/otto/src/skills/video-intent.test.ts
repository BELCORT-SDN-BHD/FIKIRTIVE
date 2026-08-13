import { describe, it, expect } from "vitest";
import { decideVideoAction, VIDEO_INTENT_SIGNALS } from "./video-intent.js";
import { VIDEO_ACTION_IDS } from "./video-capabilities.js";

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

  it("「接下去」那一族 → 续写", () => {
    for (const text of [
      "keep it going for a few more seconds",
      "what happens next in this clip",
      "把这条片子接下去",
      "这段视频再延长一点",
      "sambung klip ni lagi sikit",
    ]) {
      expect(actionOf(text)).toBe("extendClip");
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
  it("同一句话里既要改又要接 → 问一句,选项就是那两件事", () => {
    const d = decideVideoAction({ text: "change the ending and keep it going", shape: CLIP });
    expect(d.kind).toBe("ask");
    if (d.kind !== "ask") throw new Error("unreachable");
    expect(d.options).toEqual(["editClip", "extendClip"]);
    expect(d.question.length).toBeGreaterThan(0);
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
    for (const shape of [NOTHING, STILL, CLIP]) {
      for (const text of ["", "???", "做点什么", "asdfgh", "生成"]) {
        const d = decideVideoAction({ text, shape });
        expect(["action", "ask"]).toContain(d.kind);
      }
    }
  });
});
