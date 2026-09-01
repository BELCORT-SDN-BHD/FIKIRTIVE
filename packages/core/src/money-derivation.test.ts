/**
 * 钱引擎 S2 §7.2 —— **定价推导法**的验收测试(MONEY-A1 / MONEY-A3)。
 *
 * 这个文件回答两个问题:
 *   ① 价格真的是**算**出来的吗?(A1:改一个成本钉点,只有对应 SKU 变;运行时报价
 *      直接消费推导产物,不存在第二份手抄价目)
 *   ② 护栏真的按档了吗?(A3:1080p 11cr/秒、pro 图 2cr/张、每一个可售时长档都不低于
 *      该档公式价,16cr 倒挂已修)
 *
 * 与 `money-anchor.test.ts` 的分工:那边钉**结果**(24 格价格逐字不动),这边钉**来源**
 * (这些结果是怎么算出来的)。两边一起才是「重构没改价、而且以后改价只能走钉点」。
 */
import { describe, it, expect } from "vitest";
import {
  GEN_MARGIN_TARGET,
  deriveVideoDisplayPer10s,
  deriveImageDisplayCredits,
  SEEDANCE_1080P_COGS_USD_PER_SECOND,
  SEEDANCE_DISPLAY_CREDITS_PER_10S,
  MEMORABLE_PER_10S_OVERRIDES,
  IMAGE_DISPLAY_CREDITS_PER_IMAGE,
  PRO_IMAGE_DISPLAY_CREDITS_PER_IMAGE,
  REFERENCE_VIDEO_CREDITS,
  assertDerivedPricing,
  derivedPriceRows,
  videoGuardrailInternal,
  pricedGenCredits,
  pricedRefgenCredits,
  INTERNAL_PER_DISPLAY,
  CREDITS_PER_USD,
} from "./spend.js";
import { SEEDANCE_COGS_USD_PER_SECOND, REFERENCE_VIDEO_COGS_USD } from "./gen.js";
import { costPinValue } from "./cost-pins.js";

const videoJob = (seconds: number, resolution: string) => ({
  kind: "VIDEO" as const,
  model: "seedance-2-mini",
  count: 1,
  videoOptions: { seconds, resolution, audio: true },
});

describe("MONEY-A1 定价推导:价格由成本钉点算出来,全仓没有第二份手抄价目", () => {
  it("推导函数逐个复算(65% 公式 + 向上取整到收费格)", () => {
    // 视频:每秒成本 → 每 10 秒的整数显示 credits。
    expect(deriveVideoDisplayPer10s(0.035154)).toBe(11);        // 480p:10.044 → 11
    expect(deriveVideoDisplayPer10s(0.0760764375)).toBe(22);    // 720p:21.7361 → 22
    expect(deriveVideoDisplayPer10s(SEEDANCE_1080P_COGS_USD_PER_SECOND)).toBe(108); // 1080p:107.811 → 108
    // 按件:单件成本 → 整数显示 credits。
    expect(deriveImageDisplayCredits(0.035)).toBe(1);           // lite 图:恰好 1.0000
    expect(deriveImageDisplayCredits(0.045)).toBe(2);           // pro 图:1.2857 → 2
    expect(deriveImageDisplayCredits(REFERENCE_VIDEO_COGS_USD)).toBe(15); // 整段参考视频:14.256 → 15
    // 公式本身也钉住:目标毛利就是 65%,不是别的数。
    expect(GEN_MARGIN_TARGET).toBe(0.65);
    expect(SEEDANCE_1080P_COGS_USD_PER_SECOND).toBeCloseTo(0.3773385, 9);
  });

  it("改一个成本钉点 → 只有对应 SKU 的价格变,其余 SKU 一格不动", () => {
    // 演示环境改钉点等价于给推导函数换一个输入(推导是纯函数,这就是 A1 要的可复算性)。
    // 把 480p 的每秒成本翻倍:20.088 → 21cr,那一档确实动了。
    expect(deriveVideoDisplayPer10s(SEEDANCE_COGS_USD_PER_SECOND["480p"] * 2)).toBe(21);
    expect(deriveVideoDisplayPer10s(SEEDANCE_COGS_USD_PER_SECOND["480p"])).toBe(11);
    // 同一次「改钉点」里,没被改的那些档原值不动 —— 价格之间没有互相牵连。
    expect(deriveVideoDisplayPer10s(SEEDANCE_COGS_USD_PER_SECOND["720p"])).toBe(22);
    expect(deriveImageDisplayCredits(costPinValue("image:seedream-lite:per-image"))).toBe(1);
    expect(deriveImageDisplayCredits(costPinValue("image:seedream-pro:per-image"))).toBe(2);
  });

  it("运行时报价直接消费推导产物 —— 每一格都能指回它的成本钉点", () => {
    // 视频价目表:逐档 = 公式值,或明示登记在「好记数上调表」里的那一格。
    expect(Object.keys(SEEDANCE_DISPLAY_CREDITS_PER_10S).sort()).toEqual(["1080p", "480p", "720p"]);
    expect(SEEDANCE_DISPLAY_CREDITS_PER_10S["480p"])
      .toBe(deriveVideoDisplayPer10s(SEEDANCE_COGS_USD_PER_SECOND["480p"]));
    expect(SEEDANCE_DISPLAY_CREDITS_PER_10S["720p"])
      .toBe(deriveVideoDisplayPer10s(SEEDANCE_COGS_USD_PER_SECOND["720p"]));
    expect(SEEDANCE_DISPLAY_CREDITS_PER_10S["1080p"]).toBe(MEMORABLE_PER_10S_OVERRIDES["1080p"]);
    // 好记数只允许**上调**:登记的那一格必须 ≥ 公式价。
    expect(MEMORABLE_PER_10S_OVERRIDES["1080p"])
      .toBeGreaterThanOrEqual(deriveVideoDisplayPer10s(SEEDANCE_1080P_COGS_USD_PER_SECOND));
    // 图片与参考图:同一张 lite 钉点,同一个推导值,不再各抄一份「1 显示 credit」。
    expect(IMAGE_DISPLAY_CREDITS_PER_IMAGE)
      .toBe(deriveImageDisplayCredits(costPinValue("image:seedream-lite:per-image")));
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 3, videoOptions: null }))
      .toBe(3 * IMAGE_DISPLAY_CREDITS_PER_IMAGE * INTERNAL_PER_DISPLAY);
    expect(pricedRefgenCredits({ model: "seedream", count: 3 }))
      .toBe(3 * IMAGE_DISPLAY_CREDITS_PER_IMAGE * INTERNAL_PER_DISPLAY);
    // 整段参考视频:好记数 16 ≥ 公式价 15。
    expect(REFERENCE_VIDEO_CREDITS).toBeGreaterThanOrEqual(deriveImageDisplayCredits(REFERENCE_VIDEO_COGS_USD));
  });

  it("浮点陷阱回归:恰好压线的图片档必须是 1 显示 credit,绝不因为最后一位被抬成 2", () => {
    // 0.035 / 0.35 在 IEEE754 里 = 1.0000000000000002,裸 ceil 会给出 2 —— 图片凭空贵一倍。
    expect(0.035 / 0.35).toBeGreaterThan(0.1);            // 陷阱确实存在(不是假想)
    expect(Math.ceil((0.035 / (1 - 0.65)) * 100 / 10)).toBe(2); // 裸 ceil 的错误答案
    expect(deriveImageDisplayCredits(0.035)).toBe(1);      // 带容差的正确答案
    expect(IMAGE_DISPLAY_CREDITS_PER_IMAGE).toBe(1);
  });

  it("判官 P0-1:取整容差是**相对量级**的 —— 真实高于格线一丁点必须进位,浮点噪声不进位", () => {
    // 反例(判官原例):单件成本 $0.0350000000175 —— 比 lite 图钉点高 5e-10 美元。
    //   公式价 = 0.0350000000175 ÷ 0.35 × 100 ÷ 10 = 1.0000000005cr
    // 规格 §7.2 要求向上取整到收费格 ⇒ 2cr。旧的**绝对** 1e-9 容差把它压回 1cr,
    // 而 charged 与 formula 出自同一个函数 ⇒ 启动断言与 65% 毛利闸会同时漏过这一格。
    expect(deriveImageDisplayCredits(0.0350000000175)).toBe(2);
    // 同一把尺子对纯浮点噪声(相对误差 ~2e-16)必须不动价:钉点原值仍是 1cr。
    expect(deriveImageDisplayCredits(0.035)).toBe(1);

    // 按秒 SKU 同型两例。
    // ① 现役 480p 钉点不受影响(10.044 → 11,一格不动)。
    expect(deriveVideoDisplayPer10s(0.035154)).toBe(11);
    // ② 构造一个恰高于格线一丁点的每秒成本:
    //    每秒 $0.00350000000175 → 每 10 秒成本 $0.0350000000175
    //    → ÷ 0.35 = $0.1000000000500 → × 100 ÷ 10 = 1.0000000005cr ⇒ ceil = 2cr(旧实现给 1cr)。
    expect(deriveVideoDisplayPer10s(0.00350000000175)).toBe(2);
    // 对照:去掉那一丁点(每秒 $0.0035,恰好压线)只有浮点噪声 ⇒ 仍是 1cr。
    expect(deriveVideoDisplayPer10s(0.0035)).toBe(1);
  });

  it("启动断言:现价低于公式价就 throw(成本涨穿定价 = 停售等 Founder 重定价)", () => {
    // 生产里这条断言在模块加载时跑,所以现役价目一定是合法的。
    expect(() => assertDerivedPricing(derivedPriceRows())).not.toThrow();
    // 构造一格「好记数低于公式价」的行:必须炸,而且判词要是人话。
    expect(() => assertDerivedPricing([{ tier: "视频 1080p(每 10 秒)", charged: 100, formula: 108 }]))
      .toThrow(/低于公式价/);
    expect(() => assertDerivedPricing([{ tier: "图片 x", charged: 0, formula: 0 }]))
      .toThrow(/正整数/);
    expect(() => assertDerivedPricing([{ tier: "图片 x", charged: 1.5, formula: 1 }]))
      .toThrow(/正整数/);
  });
});

describe("MONEY-A3 两 SKU 回填 + 护栏按档:1080p 11cr/秒、pro 图 2cr/张、16cr 倒挂已修", () => {
  it("1080p = 11cr/秒(5 秒报价 55cr),由公式推导可复算", () => {
    expect(SEEDANCE_DISPLAY_CREDITS_PER_10S["1080p"]).toBe(110);
    expect(pricedGenCredits(videoJob(5, "1080p"))).toBe(550);
    // 「可复算」的意思是能指回成本:$0.3773385/s ÷ 0.35 = 10.78cr/秒,上调到 11 好记数。
    expect(deriveVideoDisplayPer10s(SEEDANCE_1080P_COGS_USD_PER_SECOND)).toBe(108);
    expect(110).toBeGreaterThanOrEqual(108);
  });

  it("pro 图 = 2cr/张,由公式推导可复算(上架归 Creation 线,这里只落数字与围栏)", () => {
    expect(PRO_IMAGE_DISPLAY_CREDITS_PER_IMAGE).toBe(2);
    expect(PRO_IMAGE_DISPLAY_CREDITS_PER_IMAGE)
      .toBe(deriveImageDisplayCredits(costPinValue("image:seedream-pro:per-image")));
  });

  it("护栏**逐档**:每一个可售时长档都不低于该档公式价(单一定额挡不住 15 秒档)", () => {
    // 未知分辨率 → 最贵可售档按秒价(11cr/秒)。逐档手抄复算,和生产那一侧独立。
    for (let seconds = 4; seconds <= 15; seconds++) {
      const expected = Math.ceil((seconds * 110) / 10 - 1e-9) * INTERNAL_PER_DISPLAY;
      expect(videoGuardrailInternal("未知res", seconds), `${seconds}s`).toBe(expected);
      // 「不低于该档公式价」= 这一档按 1080p 成本算的 65% 价。
      const formulaUsd = (seconds * SEEDANCE_1080P_COGS_USD_PER_SECOND) / (1 - GEN_MARGIN_TARGET);
      expect(videoGuardrailInternal("未知res", seconds) / CREDITS_PER_USD, `${seconds}s 公式价`)
        .toBeGreaterThanOrEqual(formulaUsd - 1e-9);
    }
    expect(videoGuardrailInternal("未知res", 15)).toBe(1650);
    // 旧的单一定额 16cr 在 15 秒档只有 $1.60,对着 $5.66 的成本 —— 这正是 A3 要修的那件事。
    expect(1650).toBeGreaterThan(16 * INTERNAL_PER_DISPLAY);
  });

  it("护栏对已知分辨率按**它自己的**费率算,不误伤也不贱卖", () => {
    for (const [resolution, ratePer10s] of [["480p", 11], ["720p", 22], ["1080p", 110]] as const) {
      for (const seconds of [3, 16, 20]) {
        expect(videoGuardrailInternal(resolution, seconds), `${resolution} ${seconds}s`)
          .toBe(Math.ceil((seconds * ratePer10s) / 10 - 1e-9) * INTERNAL_PER_DISPLAY);
      }
    }
  });

  it("畸形秒数按最长可售档收,绝不算成免费;正的非整数向上取整", () => {
    // 注:数字长相的字符串("5")自判官 P0-2 起**不再**算畸形,改按实秒计 —— 见下一条。
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}]) {
      expect(videoGuardrailInternal("未知res", seconds), `seconds=${String(seconds)}`).toBe(1650); // 15 × 11cr
      expect(videoGuardrailInternal("未知res", seconds), `seconds=${String(seconds)} 绝不免费`).toBeGreaterThan(0);
    }
    expect(videoGuardrailInternal("未知res", 4.5)).toBe(550);   // ceil(4.5)=5 秒 × 11cr
    expect(videoGuardrailInternal("未知res", 0.001)).toBe(110); // ceil(0.001)=1 秒 —— 不是 0cr
  });

  it("判官 P0-2:数字长相的字符串秒数按**实秒**收,不按最长档封顶(少收 11cr 的洞已堵)", () => {
    // 反例(判官原例):videoOptions.seconds = "16"。worker 只做 TS 强转就把它原样发给付费
    // 供应商(apps/worker/src/jobs/gen.ts:1227 → :1241 → packages/generation/src/byteplus.ts),
    // 供应商若真按 16 秒执行,公式护栏价 = 16 × 110 ÷ 10 = 176cr;旧写法按 15 秒封顶只收
    // 165cr —— 少收 11cr。护栏的血统是「宁可贵,不许贱卖」,所以按可能被执行的实秒收。
    expect(videoGuardrailInternal("1080p", "16")).toBe(1760);
    expect(videoGuardrailInternal("1080p", "16")).toBeGreaterThan(videoGuardrailInternal("1080p", 15));
    // 字符串按这一档**自己的**费率算,不误伤成最贵档。
    expect(videoGuardrailInternal("720p", "5")).toBe(110);   // 5 × 22 ÷ 10 = 11cr
    expect(videoGuardrailInternal("未知res", "5")).toBe(550); // 未知分辨率仍按最贵档费率
    // 不是数字长相的串仍然是畸形 → 最长可售档(1650),绝不因为「是个字符串」就免费或贱卖。
    for (const bad of ["abc", "", "   ", "-3", "0", "16abc", "1e309"]) {
      expect(videoGuardrailInternal("1080p", bad), `seconds=${JSON.stringify(bad)}`).toBe(1650);
    }
    // 数字路径回归:一格不动。
    expect(videoGuardrailInternal("1080p", 16)).toBe(1760);
    expect(videoGuardrailInternal("未知res", 5)).toBe(550);
  });

  it("16cr 倒挂已修:1080p 与未知分辨率都不再落那个定额", () => {
    // 5 秒 1080p 的成本 $1.8867;旧价 16cr = $1.60 ⇒ 毛利 −17.9%(卖一单亏一单)。
    const oldFlat = 16 * INTERNAL_PER_DISPLAY;
    expect(pricedGenCredits(videoJob(5, "1080p"))).toBe(550);
    expect(pricedGenCredits(videoJob(5, "1080p"))).toBeGreaterThan(oldFlat);
    const priceUsd = pricedGenCredits(videoJob(5, "1080p")) / CREDITS_PER_USD;
    const costUsd = 5 * SEEDANCE_1080P_COGS_USD_PER_SECOND;
    expect((priceUsd - costUsd) / priceUsd).toBeGreaterThanOrEqual(GEN_MARGIN_TARGET - 1e-9);
    // 未知分辨率同样不再是 16cr 定额。
    expect(pricedGenCredits(videoJob(5, "4K"))).toBe(550);
    expect(pricedGenCredits(videoJob(15, "4K"))).toBe(1650);
  });
});
