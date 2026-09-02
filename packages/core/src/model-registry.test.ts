import { describe, it, expect } from "vitest";
import { ALL_MODEL_IDS, isKnownModelId, enabledVideoModels, isModelDisabled, knownDisabledSet } from "./model-registry.js";
import { GEN_MODELS, GEN_VIDEO_MODELS } from "./gen.js";
import { REFGEN_MODELS } from "./refgen.js";

describe("ALL_MODEL_IDS", () => {
  it("is the deduped union of the three typed catalogs (REFGEN included)", () => {
    const expected = new Set<string>([...GEN_MODELS, ...GEN_VIDEO_MODELS, ...REFGEN_MODELS]);
    expect(new Set(ALL_MODEL_IDS)).toEqual(expected);
    // seedream appears in GEN_MODELS AND REFGEN_MODELS but exactly once in the union
    expect(ALL_MODEL_IDS.filter((m) => m === "seedream")).toHaveLength(1);
  });
  it("isKnownModelId accepts a catalog id and rejects garbage", () => {
    expect(isKnownModelId("seedream")).toBe(true);
    expect(isKnownModelId("seedance-2-mini")).toBe(true);
    // #647 T6:下架模型不再是「代码认识的模型」—— 后台连关它都关不了(也不需要关)
    expect(isKnownModelId("kling")).toBe(false);
    expect(isKnownModelId("nonexistent")).toBe(false);
    expect(isKnownModelId("")).toBe(false);
  });
});

describe("isModelDisabled / enabledVideoModels (additive narrowing only)", () => {
  it("nothing disabled → full typed video menu, nothing reported disabled", () => {
    const none = new Set<string>();
    expect(enabledVideoModels(none)).toEqual([...GEN_VIDEO_MODELS]);
    expect(isModelDisabled("seedance-2-mini", none)).toBe(false);
  });
  it("a disabled id is filtered out of the video menu and reported disabled", () => {
    const d = new Set(["seedance-2-mini"]);
    expect(enabledVideoModels(d)).not.toContain("seedance-2-mini");
    expect(enabledVideoModels(d).length).toBe(GEN_VIDEO_MODELS.length - 1);
    expect(isModelDisabled("seedance-2-mini", d)).toBe(true);
    expect(isModelDisabled("seedream", d)).toBe(false);
  });
  it("subset property: the enabled set is ALWAYS a subset of the typed menu for ANY (even garbage) disabled set", () => {
    const garbage = new Set(["kling", "not-a-model", "", "💸"]); // kling 已下架 = 与其它垃圾同类
    const enabled = enabledVideoModels(garbage);
    for (const m of enabled) expect((GEN_VIDEO_MODELS as readonly string[]).includes(m)).toBe(true);
    // a garbage disabled id can't change the menu (it was never in it)
    expect(isModelDisabled("not-a-model", garbage)).toBe(true); // disable-set membership is literal
  });
  // Creation S2 §8.1①(2026-09-02):图片菜单开出第二格(`seedream-pro`),参考图菜单没有动
  // —— 于是这两个 catalog 第一次**不再是同一个集合**,而这正是 dedup 那行代码存在的理由:
  // 它必须把两边共有的 `seedream` 合成一格,同时不吞掉只属于图片菜单的那一格。
  it("the union dedup matters: GEN_MODELS ⊋ REFGEN_MODELS (shared 'seedream' dedupes to one)", () => {
    expect([...GEN_MODELS]).toEqual(["seedream", "seedream-pro"]);
    expect([...REFGEN_MODELS]).toEqual(["seedream"]);
    // 共有的那一格只出现一次,独有的那一格没有被吞掉。
    expect(ALL_MODEL_IDS.filter((id) => id === "seedream")).toHaveLength(1);
    expect(ALL_MODEL_IDS).toContain("seedream-pro");
  });
});

describe("knownDisabledSet (unknown ignored at the resolver boundary)", () => {
  it("drops unknown ids and keeps known ones — unknowns never enter the set", () => {
    const set = knownDisabledSet(["seedance-2-mini", "kling", "not-a-model", "", "💸", "seedream"]);
    expect(set.has("seedance-2-mini")).toBe(true);
    expect(set.has("seedream")).toBe(true);
    expect(set.has("kling")).toBe(false); // #647 T6:下架模型不再在册,进不了这个集合
    expect(set.has("not-a-model")).toBe(false);
    expect(set.has("")).toBe(false);
    expect(set.has("💸")).toBe(false);
    expect(set.size).toBe(2);
  });
  it("an unknown id, even if asked to disable, can never reach a spend chokepoint", () => {
    // isModelDisabled is a literal predicate — but at the resolver boundary the set is
    // built via knownDisabledSet, so the unknown id was never admitted in the first place.
    const set = knownDisabledSet(["ghost-model"]);
    expect(isModelDisabled("ghost-model", set)).toBe(false);
  });
});
