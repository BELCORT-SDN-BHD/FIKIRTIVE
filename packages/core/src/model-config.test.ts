import { describe, it, expect, afterEach } from "vitest";
import { activeImageModel, activeVideoModel, assertSpendableModel } from "./model-config.js";
import { isFlatPricedVideoModel } from "./spend.js";

// 宪法 5:每个收费点毛利率 ≥45%。非 flat 定价的视频模型按真实成本上取整收费(≈零毛利),
// 所以 spend 闸必须拒绝它们 —— 哪怕 OTTO_DEFAULT_VIDEO_MODEL 明确选中了它。
describe("margin floor — video spend gate refuses models without a flat (floored) price", () => {
  it("rejects veo3.1-lite even when the env explicitly selects it", () => {
    const r = assertSpendableModel("veo3.1-lite", "video", { OTTO_DEFAULT_VIDEO_MODEL: "veo3.1-lite" });
    expect(r.ok).toBe(false);
  });
  it("the default video model (env unset) is always flat-priced", () => {
    expect(isFlatPricedVideoModel(activeVideoModel({}))).toBe(true);
  });
  it("the env-selected model, when accepted, is always flat-priced", () => {
    for (const model of ["kling", "veo3.1-lite", "veo3.1", "seedance-2-fast", "seedance-2"]) {
      const r = assertSpendableModel(model, "video", { OTTO_DEFAULT_VIDEO_MODEL: model });
      if (r.ok) expect(isFlatPricedVideoModel(model)).toBe(true);
    }
  });
  it("accepts seedance-2-fast when it is the active model", () => {
    expect(assertSpendableModel("seedance-2-fast", "video", { OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-fast" })).toEqual({ ok: true });
  });
});

describe("activeVideoModel", () => {
  it("uses OTTO_DEFAULT_VIDEO_MODEL when it is a known FLAT-PRICED video model", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-fast" })).toBe("seedance-2-fast");
  });
  it("falls back to seedance-2-fast (flat-priced) when env is unset/invalid", () => {
    expect(activeVideoModel({})).toBe("seedance-2-fast");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("seedance-2-fast");
  });
  it("degrades a NON-flat env override to the flat default (no split-brain: the UI must never advertise a model the spend gate rejects)", () => {
    // 2026-07-04 对抗审查:此前 activeVideoModel 会照单返回 veo3.1-lite/kling-2.6 等
    // 非 flat 模型,而新毛利闸拒绝它们 —— UI 供货、扣款全拒。现在 env 选了没有毛利
    // 地板的模型时直接降级到 flat 默认,闸只作兜底。
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "veo3.1-lite" })).toBe("seedance-2-fast");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "kling-2.6" })).toBe("seedance-2-fast");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "veo3.1" })).toBe("seedance-2-fast");
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
  it("defaults to seedance-2-fast when no env override", () => {
    delete process.env.OTTO_DEFAULT_VIDEO_MODEL;
    expect(activeVideoModel()).toBe("seedance-2-fast");
  });
  it("honors a valid flat-priced env override", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-fast" })).toBe("seedance-2-fast");
  });
  it("ignores an unknown env value (falls back to seedance-2-fast)", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("seedance-2-fast");
  });
});
