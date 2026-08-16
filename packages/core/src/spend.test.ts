import { describe, it, expect } from "vitest";
import { genSpentUsd, refgenSpentUsd, pricedGenCredits, pricedRefgenCredits, displayCredits, CREDITS_PER_USD, INTERNAL_PER_DISPLAY, SIGNUP_GRANT_CREDITS } from "./spend.js";
// #810 P3-2:一轮对话真正会冻结的额度 —— 挡住商家的就是这个数,所以它是「一场对话
// 花多少」的活权威,不是注释里抄来的实测值。
import { OTTO_CONVERSATION_TURN_RESERVE_INTERNAL } from "./otto-budget.js";
import { GEN_IMAGE_ASPECTS, GEN_PRICE_USD_PER_IMAGE, videoPriceUsd } from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";
import { MARGIN_FLOOR, marginTruthTable, pendingRulingFor, acceptedExceptionFor } from "./margin-truth.js";
// Note: video credit charge is split — flat per resolution for BytePlus flat-priced models
// (seedance-2-mini), USD-formula for all other (retired, menu-external) models.

describe("genSpentUsd", () => {
  it("image = flat per-image price × count", () => {
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 1);
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 4);
  });
  it("video = videoPriceUsd with the job's resolved options", () => {
    const vo = { seconds: 5, resolution: "720p", audio: true };
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: vo }))
      .toBe(videoPriceUsd("seedance-2-mini", { seconds: 5, resolution: "720p", audio: true, count: 1 }));
  });
  it("video with null/partial videoOptions falls back to the model's defaults (never NaN)", () => {
    const v = genSpentUsd({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: null });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
  it("#644/#645/#769 seedance-2-mini COGS = 官方牌价 token 公式,按各档**最差比例**", () => {
    // 记账基准一路的沿革:2026-06 资源包折后价($0.077/s,5s≈$0.39)→ #644 回到 fast 牌价
    // $5.60/M → #769 换引擎,走 mini 牌价 **$3.50/M**(ModelArk 模型档案
    // dreamina-seedance-2-0-mini-260615 的 NV2VCompletion.original_price = 0.0035/K)。
    // 折后价一律不抄:拿不拿得到折扣不由我们说了算,记账只认牌价。
    //
    // #645 T4:收费是**按档**的(同档六个比例一个价),所以记账基准也按档里最贵的那个比例走
    // ——720p 的 4:3/3:4(927,408px)⇒ $0.0760764375/s,比 16:9 的 $0.0756/s 贵 0.6%。
    // 方向永远安全:宁可高记,不许低估(同 REFERENCE_VIDEO_COGS_USD 取上限的理由)。
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } }))
      .toBeCloseTo(0.3803821875, 6);
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: false } }))
      .toBeCloseTo(0.760764375, 6);
    // 480p 是真的半价档,成本也必须按 480p 记(记成 720p 会把它的毛利算错)。
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 5, resolution: "480p", audio: false } }))
      .toBeCloseTo(0.17577, 6);
    // 声音开关不改价(2.0 系列),记账基准也必须不随它动。
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: true } }))
      .toBeCloseTo(0.3803821875, 6);
  });

  it("#769 换引擎不改**收费**:同一批档位的 credits 与 fast 时代逐字相同", () => {
    // 这一条是本次换引擎的护栏:成本换了,商家那一侧一格都不许动(调价是另一次裁决)。
    const cr = (seconds: number, resolution: string) =>
      pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds, resolution, audio: true } });
    expect(cr(5, "720p")).toBe(11 * INTERNAL_PER_DISPLAY);
    expect(cr(10, "720p")).toBe(22 * INTERNAL_PER_DISPLAY);
    expect(cr(15, "720p")).toBe(33 * INTERNAL_PER_DISPLAY);
    expect(cr(5, "480p")).toBe(6 * INTERNAL_PER_DISPLAY);
    expect(cr(10, "480p")).toBe(11 * INTERNAL_PER_DISPLAY);
  });

  it("#644/#769 整段参考视频 COGS = 含视频输入档 $2.10/M × (6s 参考上限 + 5s 出片)", () => {
    // mini 的 V2VCompletion.original_price = 0.0021/K = $2.10/M(fast 时代是 $3.30/M)。
    // (5 + 6) × 21,600 tok/s × $2.10/M = $0.49896。收费仍是 REFERENCE_VIDEO_CREDITS(16cr)。
    expect(genSpentUsd({
      kind: "VIDEO",
      model: "seedance-2-mini",
      count: 1,
      referenceVideoGenerationId: "gen_ref",
      videoOptions: { seconds: 5, resolution: "720p", audio: true },
    })).toBeCloseTo(0.49896, 6);
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
  it("seedance-2-mini CHARGE follows the locked costing model, not the record-only COGS", () => {
    // Money-safety pin: changing the recorded COGS (videoRateUsdPerSec) must NOT change what the
    // user pays — seedance-2-mini is final-priced in credits.
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } }))
      .toBe(11 * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: false } }))
      .toBe(22 * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits({
      kind: "VIDEO",
      model: "seedance-2-mini",
      count: 1,
      referenceVideoGenerationId: "gen_ref",
      videoOptions: { seconds: 5, resolution: "720p", audio: false },
    })).toBe(16 * INTERNAL_PER_DISPLAY);
  });
  it("#647 T6:菜单外的模型(历史行)落护栏价 —— 算不出价就宁可贵,绝不贱卖", () => {
    // 这条测试的前身是「非 flat 模型走 USD 公式」。那 12 台当初走备用供应商的引擎在 T6 下架
    // 之后,它们各自抄来的费率也随之作废(videoRateUsdPerSec 对菜单外的 id 回 0),USD 公式会
    // 算出 1 显示 credit —— 一条视频卖一毛钱。新的付费请求永远走不到这里(契约闸只放行
    // 在产那一台),这只是历史行读价的兜底,而兜底的语义只有一个:护栏价。
    const job = { kind: "VIDEO" as const, model: "kling", count: 1, videoOptions: { seconds: 5, resolution: "", audio: false } };
    const c = pricedGenCredits(job);
    expect(c % INTERNAL_PER_DISPLAY).toBe(0); // whole displayed credits
    expect(c).toBe(16 * INTERNAL_PER_DISPLAY);
    expect(Number.isNaN(c)).toBe(false);
    // 记账那一侧照旧是 record-only:不知道成本就是 0,而不是编一个数
    expect(genSpentUsd(job)).toBe(0);

    // #769:换引擎之后 seedance-2-fast 自己也变成「菜单外的历史 id」,走同一条兜底 ——
    // 老行读价落 16cr 护栏(不是免费),记账落 0(不是编一个 fast 时代的成本)。
    const retiredFast = { kind: "VIDEO" as const, model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: true } };
    expect(pricedGenCredits(retiredFast)).toBe(16 * INTERNAL_PER_DISPLAY);
    expect(genSpentUsd(retiredFast)).toBe(0);
  });
  it("refgen = 1 displayed credit per image", () => {
    expect(pricedRefgenCredits({ model: "seedream", count: 1 })).toBe(10);
    expect(pricedRefgenCredits({ model: "seedream", count: 3 })).toBe(30);
  });
  it("displayCredits converts internal→displayed; CREDITS_PER_USD=100", () => {
    expect(displayCredits(2500)).toBe(250);
    expect(CREDITS_PER_USD).toBe(100);
  });
  it("video charge is per-second by resolution: 720p 5s=11cr, 720p 10s=22cr, 480p 5s=6cr, 1080p=16cr", () => {
    const v = (resolution: string) => pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 5, resolution, audio: true } });
    expect(v("720p")).toBe(110);  // 11 displayed credits(#644 Founder 裁决 2026-08-06,#645 按秒表复算同值)
    expect(v("480p")).toBe(60);   // #645 T4:半价档 1.1cr/秒 ⇒ ceil(5.5) = 6 displayed
    expect(v("1080p")).toBe(160); // 16 displayed credits(护栏价,mini 同样给不了 1080p)
    expect(pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: true } }))
      .toBe(220);
  });
  it("seedance-2-mini: unknown resolution → the 16cr guardrail (never under-charge)", () => {
    const v = (resolution: string) => pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, videoOptions: { seconds: 5, resolution, audio: true } });
    expect(v("4K")).toBe(160);  // unknown res → guardrail price (16 displayed × 10)
    expect(v("")).toBe(160);
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
  it("signup welcome grant is 25 displayed credits (#791 Founder decision 2026-08-08; internal = ×INTERNAL_PER_DISPLAY)", () => {
    expect(SIGNUP_GRANT_CREDITS).toBe(25 * INTERNAL_PER_DISPLAY);
    expect(displayCredits(SIGNUP_GRANT_CREDITS)).toBe(25);
  });

  // #791-3:注册页承诺的是「a conversation with Otto, an image, and a short video」。
  // 那句话必须买得起。
  //
  // #810 P3-2(跨族判官):这条原本把对话花费写死成 9.5 —— 一个从注释里抄来的实测值。
  // 抄来的数字防不住漂移:它不随任何计价常量变,所以计价再动一次,这条也只是继续拿
  // 2026-07 的账去核 2026-08 的价。现在三项**全部**从活的计价权威读:
  //   · 图与视频:pricedGenCredits(价目表本身);
  //   · 对话:每一轮真正会从商家余额上冻结的那个数
  //     (OTTO_CONVERSATION_TURN_RESERVE_INTERNAL)—— 挡住商家的就是它,不是事后结算值。
  // 「一场对话」= 几轮,是对注册页那句话的读法,写在这里、只此一处。
  const CONVERSATION_TURNS = 3;
  it("赠额买得起注册页承诺的那一整轮:一场对话 + 一张图 + 一条 5s 视频", () => {
    const oneImage = pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null });
    const oneVideo = pricedGenCredits({
      kind: "VIDEO", model: "seedance-2-mini", count: 1,
      videoOptions: { seconds: 5, resolution: "720p" },
    });
    const oneConversation = OTTO_CONVERSATION_TURN_RESERVE_INTERNAL * CONVERSATION_TURNS;
    expect(
      SIGNUP_GRANT_CREDITS,
      `赠额 ${displayCredits(SIGNUP_GRANT_CREDITS)} 买不起注册页承诺的那一轮:` +
        `对话 ${displayCredits(oneConversation)} + 图 ${displayCredits(oneImage)} + 视频 ${displayCredits(oneVideo)}`,
    ).toBeGreaterThanOrEqual(oneConversation + oneImage + oneVideo);
  });

  // 注册页那句话本身(数字是算出来的、承诺的正是这三件)钉在 apps/web —— 页面归页面,
  // 价目表归 core。见 apps/web/lib/__tests__/public-copy-honesty-791.test.ts。
  // #644:记账基准改真后视频两档一度跌到 24.4% / 13.6%,Founder 于 2026-08-06 裁决调价
  // (8→11cr、14→22cr,PR #655 评论留档),两档回到 45.0%,待裁决名单已清空。断言仍是
  // 「≥45%,除非它在 BELOW_FLOOR_PENDING_FOUNDER_RULING 这张**待 Founder 裁决**的名单上」——
  // 名单被两头钉死(见 margin-truth.ts 的注释与 margin-truth.test.ts):新的违规藏不住,
  // 已经达标的档位留在名单上同样红。
  it("launch-priced spend points satisfy the constitutional >=45% margin floor(两张名单内的除外)", () => {
    for (const row of marginTruthTable()) {
      // 两张名单,两种身份:pending = 还没人拍板(带闹钟);accepted = Founder 已裁「接受」。
      const parked = pendingRulingFor(row.id) !== undefined || acceptedExceptionFor(row.id) !== undefined;
      const detail = `${row.id}: 收费 $${row.chargeUsd} 成本 $${row.cogsUsd} 毛利率 ${(row.margin * 100).toFixed(1)}%`;
      if (parked) {
        expect(row.clearsFloor, `${detail} —— 已清地板,请把它从名单里删掉`).toBe(false);
      } else {
        expect(row.margin, `${detail} —— 跌破地板且不在任何名单上`).toBeGreaterThanOrEqual(MARGIN_FLOOR - 1e-9);
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
            // 1e-9 = IEEE754 容差:定价可以精确压在 45.0% 地板上,而正好压住的那一档在浮点里
            // 会落到地板下一个 ulp。#644 裁决(2026-08-06)后 720p 两档是从上方贴着地板定价的
            // ——10s 22cr = $2.20 对成本 $1.2096、5s 11cr = $1.10 对成本 $0.6048,都是 45.0%
            // ——所以眼下没有一档真的依赖这个容差;「正好压在地板上」的情形由
            // scripts/__tests__/check-margin-floor.test.mjs 的夹具继续守着。
            const tier = `video:${model}:${seconds}:${resolution}`;
            if (pendingRulingFor(tier) || acceptedExceptionFor(tier)) {
              expect(margin, `${detail} —— 已清地板,请把它从名单里删掉`).toBeLessThan(MARGIN_FLOOR - 1e-9);
            } else {
              expect(margin, `${detail} —— 跌破地板且不在任何名单上`).toBeGreaterThanOrEqual(MARGIN_FLOOR - 1e-9);
            }
          }
        }
      }
    }
    expect(checked, "可售视频组合一个都没被检查到 —— 枚举坏了").toBeGreaterThan(0);
  });
});
