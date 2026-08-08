import { describe, it, expect, afterEach } from "vitest";
import { activeImageModel, activeVideoModel, assertSpendableModel } from "./model-config.js";
import { isFlatPricedVideoModel } from "./spend.js";

// 宪法 5:每个收费点毛利率 ≥45%。没有已裁价目表的视频模型收不出毛利,所以 spend 闸必须
// 拒绝它们 —— 哪怕 OTTO_DEFAULT_VIDEO_MODEL 明确选中了它。
// #647 T6 之后,下面这些 id 连菜单都不在了,于是它们**更早**就被 `isKnownModelId` 挡下 ——
// 断言不变(一律 ok:false),只是拦下它们的那道闸从第三道提前到了第一道。
describe("margin floor — video spend gate refuses models without a flat (floored) price", () => {
  it("rejects a retired id even when the env explicitly selects it", () => {
    const r = assertSpendableModel("veo3.1-lite", "video", { OTTO_DEFAULT_VIDEO_MODEL: "veo3.1-lite" });
    expect(r.ok).toBe(false);
  });
  it("the default video model (env unset) is always flat-priced", () => {
    expect(isFlatPricedVideoModel(activeVideoModel({}))).toBe(true);
  });
  it("the env-selected model, when accepted, is always flat-priced", () => {
    for (const model of ["kling", "veo3.1-lite", "veo3.1", "seedance-2-mini", "seedance-2"]) {
      const r = assertSpendableModel(model, "video", { OTTO_DEFAULT_VIDEO_MODEL: model });
      if (r.ok) expect(isFlatPricedVideoModel(model)).toBe(true);
    }
  });
  it("accepts seedance-2-mini when it is the active model", () => {
    expect(assertSpendableModel("seedance-2-mini", "video", { OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-mini" })).toEqual({ ok: true });
  });
});

describe("activeVideoModel", () => {
  it("uses OTTO_DEFAULT_VIDEO_MODEL when it is a known FLAT-PRICED video model", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-mini" })).toBe("seedance-2-mini");
  });
  it("falls back to seedance-2-mini (flat-priced) when env is unset/invalid", () => {
    expect(activeVideoModel({})).toBe("seedance-2-mini");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("seedance-2-mini");
  });
  it("degrades a NON-flat env override to the flat default (no split-brain: the UI must never advertise a model the spend gate rejects)", () => {
    // 2026-07-04 对抗审查:此前 activeVideoModel 会照单返回没有毛利地板的模型,
    // 而新毛利闸拒绝它们 —— UI 供货、扣款全拒。现在 env 选了没有毛利地板的模型时
    // 直接降级到 flat 默认,闸只作兜底。
    // #647 T6:这里用的三个 id 已经下架,所以现在是被「不在菜单上」这一条挡回默认,
    // 结论(降级到 seedance-2-mini,绝不 split-brain)逐字不变。
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "veo3.1-lite" })).toBe("seedance-2-mini");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "kling-2.6" })).toBe("seedance-2-mini");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "veo3.1" })).toBe("seedance-2-mini");
  });
});

describe("assertSpendableModel", () => {
  it("accepts the active image model", () => {
    expect(assertSpendableModel("seedream", "image", {})).toEqual({ ok: true });
  });
  it("rejects a non-active video model", () => {
    const r = assertSpendableModel("veo3.1", "video", { OTTO_DEFAULT_VIDEO_MODEL: "kling" });
    expect(r.ok).toBe(false);
  });
  it("rejects an unknown model id", () => {
    expect(assertSpendableModel("totally-fake", "image", {}).ok).toBe(false);
  });
});

describe("activeVideoModel default", () => {
  const prev = process.env.OTTO_DEFAULT_VIDEO_MODEL;
  afterEach(() => { if (prev === undefined) delete process.env.OTTO_DEFAULT_VIDEO_MODEL; else process.env.OTTO_DEFAULT_VIDEO_MODEL = prev; });
  it("defaults to seedance-2-mini when no env override", () => {
    delete process.env.OTTO_DEFAULT_VIDEO_MODEL;
    expect(activeVideoModel()).toBe("seedance-2-mini");
  });
  it("honors a valid flat-priced env override", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-mini" })).toBe("seedance-2-mini");
  });
  it("ignores an unknown env value (falls back to seedance-2-mini)", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("seedance-2-mini");
  });
});
