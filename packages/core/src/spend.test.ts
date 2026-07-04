import { describe, it, expect } from "vitest";
import { genSpentUsd, refgenSpentUsd, pricedGenCredits, pricedRefgenCredits, displayCredits, CREDITS_PER_USD, INTERNAL_PER_DISPLAY, BETA_INITIAL_GRANT_CREDITS } from "./spend.js";
import { GEN_PRICE_USD_PER_IMAGE, videoPriceUsd } from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";
// Note: video credit charge is split — flat per resolution for BytePlus flat-priced models
// (seedance-2-fast), USD-formula for all other (fal) models.

describe("genSpentUsd", () => {
  it("image = flat per-image price × count", () => {
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 1);
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 4);
  });
  it("video = videoPriceUsd with the job's resolved options", () => {
    const vo = { seconds: 5, resolution: "1080p", audio: true };
    expect(genSpentUsd({ kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo }))
      .toBe(videoPriceUsd("veo3.1-fast", { seconds: 5, resolution: "1080p", audio: true, count: 1 }));
  });
  it("video with null/partial videoOptions falls back to the model's defaults (never NaN)", () => {
    const v = genSpentUsd({ kind: "VIDEO", model: "kling", count: 1, videoOptions: null });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
  it("seedance-2-fast COGS uses the BytePlus basis, not the old fal 0.2419/s (F39)", () => {
    // 5s × 0.03/s = 0.15 (the ~$0.15/5s benchmark), not 5 × 0.2419 = 1.21.
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } }))
      .toBeCloseTo(0.15, 5);
  });
});

describe("refgenSpentUsd", () => {
  it("= flat refgen per-image price × count (its OWN constant, not GEN_PRICE)", () => {
    expect(refgenSpentUsd({ model: "seedream", count: 1 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 1);
    expect(refgenSpentUsd({ model: "seedream", count: 3 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 3);
  });
});

describe("credit pricing (deterministic CHARGE in internal credits; 1 internal = $0.01, 1 displayed = 10 internal)", () => {
  it("image = 1 displayed credit (10 internal) PER image — flat, with margin over the ~$0.04 true cost", () => {
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })).toBe(10);
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null })).toBe(40);
  });
  it("seedance-2-fast CHARGE is flat-per-resolution and UNCHANGED by the F39 COGS-basis edit", () => {
    // Money-safety pin: lowering the recorded COGS (videoRateUsdPerSec) must NOT change what the
    // user pays — seedance-2-fast is flat-priced (720p → 7 displayed credits = 70 internal).
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } }))
      .toBe(7 * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: false } }))
      .toBe(7 * INTERNAL_PER_DISPLAY); // duration doesn't change a flat charge
  });
  it("video (fal, non-flat model) = USD formula, NOT the flat BytePlus table", () => {
    const job = { kind: "VIDEO" as const, model: "kling", count: 1, videoOptions: { seconds: 5, resolution: "", audio: false } };
    const c = pricedGenCredits(job);
    expect(c % INTERNAL_PER_DISPLAY).toBe(0); // whole displayed credits
    expect(c).toBeGreaterThanOrEqual(10);     // at least 1 displayed credit
    // Must equal the USD-formula result, NOT the flat 1080p fallback (160)
    const expected = Math.max(1, Math.ceil(genSpentUsd(job) / 0.1)) * INTERNAL_PER_DISPLAY;
    expect(c).toBe(expected);
    expect(c).not.toBe(160); // 160 = the stale flat fallback that would have been charged before the fix
  });
  it("refgen = 1 displayed credit per image", () => {
    expect(pricedRefgenCredits({ model: "seedream", count: 1 })).toBe(10);
    expect(pricedRefgenCredits({ model: "seedream", count: 3 })).toBe(30);
  });
  it("displayCredits converts internal→displayed; CREDITS_PER_USD=100", () => {
    expect(displayCredits(2500)).toBe(250);
    expect(CREDITS_PER_USD).toBe(100);
  });
  it("video charge is flat per resolution: 720p=7cr, 1080p=16cr (internal ×10)", () => {
    const v = (resolution: string) => pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution, audio: true } });
    expect(v("720p")).toBe(70);   // 7 displayed credits
    expect(v("1080p")).toBe(160); // 16 displayed credits
  });
  it("seedance-2-fast: unknown/higher resolution → the 1080p price (never under-charge)", () => {
    const v = (resolution: string) => pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution, audio: true } });
    expect(v("4K")).toBe(160);  // unknown res → 1080p price (16 displayed × 10)
    expect(v("")).toBe(160);
    expect(v("480p")).toBe(160);
  });
  it("image charge stays 1 displayed credit per image", () => {
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })).toBe(10);
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 3, videoOptions: null })).toBe(30);
  });
  it("beta signup grant is 100 displayed credits (internal = ×INTERNAL_PER_DISPLAY)", () => {
    expect(BETA_INITIAL_GRANT_CREDITS).toBe(100 * INTERNAL_PER_DISPLAY);
    expect(displayCredits(BETA_INITIAL_GRANT_CREDITS)).toBe(100);
  });
});

// ── 宪法 5 毛利地板守卫:每个可售视频组合 ≥45% ─────────────────────────────────
// 这个测试是"地板的警报器":BytePlus 成本(videoRateUsdPerSec)涨了、或有人改了
// VIDEO_CREDITS_BY_RESOLUTION 的售价、或给 flat 名单加了没算过账的模型 —— 任何
// 一种情况把某个可售组合的毛利打到 45% 以下,这里立刻变红。视频任务恒 count=1
// (gen-actions 强制),所以按 count=1 逐组合断言。
import { FLAT_PRICED_VIDEO_MODELS } from "./spend.js";
import { GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "./gen.js";

describe("margin floor — every sellable video combo keeps ≥45% gross margin (宪法 5)", () => {
  it("holds for all flat-priced models × durations × resolutions × audio", () => {
    for (const model of FLAT_PRICED_VIDEO_MODELS) {
      const opts = GEN_VIDEO_MODEL_OPTIONS[model as GenVideoModel];
      expect(opts, `flat-priced model ${model} must exist in GEN_VIDEO_MODEL_OPTIONS`).toBeDefined();
      const resolutions = opts.resolutions.length ? opts.resolutions : [""];
      const audios = opts.audioToggle ? [true, false] : [false];
      for (const seconds of opts.durations) {
        for (const resolution of resolutions) {
          for (const audio of audios) {
            const job = { kind: "VIDEO" as const, model, count: 1, videoOptions: { seconds, resolution, audio } };
            const priceUsd = pricedGenCredits(job) / CREDITS_PER_USD;
            const costUsd = genSpentUsd(job);
            const margin = (priceUsd - costUsd) / priceUsd;
            expect(
              margin,
              `${model} ${seconds}s ${resolution || "(default res)"} audio=${audio}: price $${priceUsd} cost $${costUsd} margin ${(margin * 100).toFixed(1)}%`,
            ).toBeGreaterThanOrEqual(0.45);
          }
        }
      }
    }
  });
});
