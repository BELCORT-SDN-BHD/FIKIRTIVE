import { describe, it, expect } from "vitest";
import { genSpentUsd, refgenSpentUsd, pricedGenCredits, pricedRefgenCredits, displayCredits, CREDITS_PER_USD, INTERNAL_PER_DISPLAY, SIGNUP_GRANT_CREDITS } from "./spend.js";
import { GEN_IMAGE_ASPECTS, GEN_PRICE_USD_PER_IMAGE, videoPriceUsd } from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";
import { MARGIN_FLOOR, marginTruthTable, pendingRulingFor } from "./margin-truth.js";
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
  it("#644 seedance-2-fast COGS = 官方牌价 token 公式,不再是资源包折后价", () => {
    // 官方成品价对照(https://docs.byteplus.com/en/docs/ModelArk/Pricing,2026-08-05 核):
    // 720p 5s = $0.60、10s = $1.21。旧值 $0.077/s(5s≈$0.39)是 2026-06 资源包折后价,
    // 不是我们随时都拿得到的价 —— 记账基准回到牌价(见 gen.ts byteplusVideoCogsUsd)。
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } }))
      .toBeCloseTo(0.6048, 6);
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: false } }))
      .toBeCloseTo(1.2096, 6);
    // 声音开关不改价(2.0 系列),记账基准也必须不随它动。
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: true } }))
      .toBeCloseTo(0.6048, 6);
  });

  it("#644 整段参考视频 COGS = 含视频输入档 $3.30/M × (6s 参考上限 + 5s 出片)", () => {
    expect(genSpentUsd({
      kind: "VIDEO",
      model: "seedance-2-fast",
      count: 1,
      referenceVideoGenerationId: "gen_ref",
      videoOptions: { seconds: 5, resolution: "720p", audio: true },
    })).toBeCloseTo(0.78408, 6);
  });
});

describe("refgenSpentUsd", () => {
  it("= flat refgen per-image price × count (its OWN constant, not GEN_PRICE)", () => {
    expect(refgenSpentUsd({ model: "seedream", count: 1 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 1);
    expect(refgenSpentUsd({ model: "seedream", count: 3 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 3);
  });
});

describe("credit pricing (deterministic CHARGE in internal credits; 1 internal = $0.01, 1 displayed = 10 internal)", () => {
  it("image = 1 displayed credit (10 internal) PER image — flat, with margin over the $0.035 true cost", () => {
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })).toBe(10);
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null })).toBe(40);
  });
  it("seedance-2-fast CHARGE follows the locked costing model, not the record-only COGS", () => {
    // Money-safety pin: changing the recorded COGS (videoRateUsdPerSec) must NOT change what the
    // user pays — seedance-2-fast is final-priced in credits.
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } }))
      .toBe(11 * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: false } }))
      .toBe(22 * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits({
      kind: "VIDEO",
      model: "seedance-2-fast",
      count: 1,
      referenceVideoGenerationId: "gen_ref",
      videoOptions: { seconds: 5, resolution: "720p", audio: false },
    })).toBe(16 * INTERNAL_PER_DISPLAY);
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
  it("video charge is flat by duration/guardrail: 720p 5s=11cr, 720p 10s=22cr, 1080p=16cr", () => {
    const v = (resolution: string) => pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution, audio: true } });
    expect(v("720p")).toBe(110);  // 11 displayed credits(#644 Founder 裁决 2026-08-06)
    expect(v("1080p")).toBe(160); // 16 displayed credits
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: true } }))
      .toBe(220);
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
  it("#642 画幅不动价格:八个画幅同价 = count × INTERNAL_PER_DISPLAY(引擎按张计价)", () => {
    // 形状**根本不是**计价输入 —— 这里连多塞一个 aspectRatio 键都改不动结果。
    // 端到端那一半(真跑 startGen 逐个画幅比预扣)在 apps/web 的 gen-actions 测试里。
    for (const count of [1, 4]) {
      const prices = GEN_IMAGE_ASPECTS.map((aspectRatio) =>
        pricedGenCredits({ kind: "IMAGE", model: "seedream", count, videoOptions: null, ...{ aspectRatio } }));
      expect(new Set(prices).size, `count=${count} 各画幅必须同价`).toBe(1);
      expect(prices[0]).toBe(count * INTERNAL_PER_DISPLAY);
    }
  });
  it("signup welcome grant is 20 displayed credits (#543 Founder decision; internal = ×INTERNAL_PER_DISPLAY)", () => {
    expect(SIGNUP_GRANT_CREDITS).toBe(20 * INTERNAL_PER_DISPLAY);
    expect(displayCredits(SIGNUP_GRANT_CREDITS)).toBe(20);
  });
  // #644:记账基准改真后视频两档一度跌到 24.4% / 13.6%,Founder 于 2026-08-06 裁决调价
  // (8→11cr、14→22cr,PR #655 评论留档),两档回到 45.0%,待裁决名单已清空。断言仍是
  // 「≥45%,除非它在 BELOW_FLOOR_PENDING_FOUNDER_RULING 这张**待 Founder 裁决**的名单上」——
  // 名单被两头钉死(见 margin-truth.ts 的注释与 margin-truth.test.ts):新的违规藏不住,
  // 已经达标的档位留在名单上同样红。
  it("launch-priced spend points satisfy the constitutional >=45% margin floor(名单内的除外)", () => {
    for (const row of marginTruthTable()) {
      const pending = pendingRulingFor(row.id) !== undefined;
      const detail = `${row.id}: 收费 $${row.chargeUsd} 成本 $${row.cogsUsd} 毛利率 ${(row.margin * 100).toFixed(1)}%`;
      if (pending) {
        expect(row.clearsFloor, `${detail} —— 已清地板,请把它从待裁决名单删掉`).toBe(false);
      } else {
        expect(row.margin, `${detail} —— 跌破地板且不在待裁决名单上`).toBeGreaterThanOrEqual(MARGIN_FLOOR - 1e-9);
      }
      // 无论在不在名单上,收费低于成本(卖一单亏一单)永远不许通过。
      expect(row.grossUsd, `${detail} —— 收费低于成本`).toBeGreaterThan(0);
    }
  });
});

// ── 宪法 5 毛利地板守卫:每个可售视频组合 ≥45% ─────────────────────────────────
// 这个测试是"地板的警报器":BytePlus 成本(videoRateUsdPerSec)涨了、或有人改了
// VIDEO_CREDITS_BY_RESOLUTION 的售价、或给 flat 名单加了没算过账的模型 —— 任何
// 一种情况把某个可售组合的毛利打到 45% 以下,这里立刻变红。视频任务恒 count=1
// (gen-actions 强制),所以按 count=1 逐组合断言。
//
// 唯一的例外:挂在 BELOW_FLOOR_PENDING_FOUNDER_RULING 上、正等 Founder 裁决的档位
// (2026-08-06 裁决落地后名单为空)。**新**跌破的组合(换档位、换定价、成本上涨)
// 照旧当场变红。
import { FLAT_PRICED_VIDEO_MODELS } from "./spend.js";
import { GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "./gen.js";

describe("margin floor — every sellable video combo keeps ≥45% gross margin (宪法 5)", () => {
  it("holds for all flat-priced models × durations × resolutions × audio", () => {
    let checked = 0;
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
            const detail = `${model} ${seconds}s ${resolution || "(default res)"} audio=${audio}: price $${priceUsd} cost $${costUsd} margin ${(margin * 100).toFixed(1)}%`;
            checked += 1;
            // 收费低于成本(卖一单亏一单)对任何组合都是硬红,名单也救不了。
            expect(priceUsd - costUsd, `${detail} —— 收费低于成本`).toBeGreaterThan(0);
            // 1e-9 = IEEE754 容差:定价可以精确压在 45.0% 地板上(720p 10s 档,
            // #129 按 Ark 实测成本核定),0.63/1.4 在浮点里是 0.44999999999999996。
            if (pendingRulingFor(`video:${model}:${seconds}:${resolution}`)) {
              expect(margin, `${detail} —— 已清地板,请把它从待裁决名单删掉`).toBeLessThan(MARGIN_FLOOR - 1e-9);
            } else {
              expect(margin, `${detail} —— 跌破地板且不在待裁决名单上`).toBeGreaterThanOrEqual(MARGIN_FLOOR - 1e-9);
            }
          }
        }
      }
    }
    expect(checked, "可售视频组合一个都没被检查到 —— 枚举坏了").toBeGreaterThan(0);
  });
});
