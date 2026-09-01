import { describe, it, expect } from "vitest";
import {
  COST_PINS,
  costPinValue,
  evaluateCostPin,
  evaluateAllCostPins,
  type CostPin,
} from "./cost-pins.js";
import { FX_PIN, SEARCH_PROVIDER_COST_USD } from "./pricing-config.js";
import { BYTEPLUS_USD_PER_MTOKEN, BYTEPLUS_USD_PER_MTOKEN_WITH_VIDEO_INPUT, GEN_PRICE_USD_PER_IMAGE } from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";
import { UNDERSTANDING_USD_PER_MTOKEN_IN, UNDERSTANDING_USD_PER_MTOKEN_OUT } from "./asset-understanding.js";

/**
 * 成本钉点表的行为测试(规格 docs/specs/money-engine.md §7.1)。
 *
 * 这张表回答的问题是:**我们对供应商成本知道什么、什么时候知道的、从哪知道的**。
 * 测试同时充当钉点数值的**第二证人** —— 数字在这里是手抄的,和表里的抄写各自独立,
 * 任何一边被悄悄改动都会当场对不上(与 `check-margin-floor.mjs` 的双证人同一思路)。
 */

/* ─────────────────── 闸的行为(验收 MONEY-A4) ─────────────────── */

describe("MONEY-A4 成本钉点闸(判词样式与汇率钉点闸一致)", () => {
  const good: CostPin = {
    value: 0.035,
    unit: "USD/张",
    source: "arkcli 实查",
    observedOn: "2026-08-29",
    nextReviewDate: "2026-11-18",
  };

  it("MONEY-A4:现行钉点今天全绿 —— 不红也不黄", () => {
    expect(evaluateCostPin("test:pin", good, "2026-09-01")).toEqual([]);
  });

  // ── 黄:复核期到了,提醒复核,不拦发布 ──

  it("MONEY-A4:把复核期改成已过期(today > nextReviewDate)→ 闸黄,提醒复核,不拦发布", () => {
    const problems = evaluateCostPin("test:pin", good, "2026-12-01");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.level).toBe("yellow");
    expect(problems[0]!.pin).toBe("test:pin");
    expect(problems[0]!.message).toContain("复核期到了");
    // 「不拦发布」的机器口径:一条红都没有。
    expect(problems.filter((p) => p.level === "red")).toEqual([]);
  });

  it("MONEY-A4:复核期正好是今天(today === nextReviewDate)→ 同样闸黄(到期日当天就响,不宽限)", () => {
    const problems = evaluateCostPin("test:pin", good, good.nextReviewDate);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.level).toBe("yellow");
    expect(problems.filter((p) => p.level === "red")).toEqual([]);
  });

  // ── 红:没出处的成本不是证据 ──

  it("MONEY-A4:删掉钉点的来源字段 → 闸红(没出处的成本不是证据)", () => {
    const noSource = { ...good, source: undefined as unknown as string };
    const problems = evaluateCostPin("test:pin", noSource, "2026-09-01");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.level).toBe("red");
    expect(problems[0]!.message).toContain("不是证据");
  });

  it("MONEY-A4:来源字段只有空白 → 同样闸红(空字符串不算出处)", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      const problems = evaluateCostPin("test:pin", { ...good, source: blank }, "2026-09-01");
      expect(problems.some((p) => p.level === "red" && p.message.includes("不是证据"))).toBe(true);
    }
  });

  // ── 红:声明本身坏掉了 ──

  it("MONEY-A4:数值不是正有限数(0 / 负 / NaN / Infinity)→ 闸红", () => {
    for (const bad of [0, -1, -0.035, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const problems = evaluateCostPin("test:pin", { ...good, value: bad }, "2026-09-01");
      expect(problems.some((p) => p.level === "red" && p.message.includes("value"))).toBe(true);
    }
  });

  it("MONEY-A4:日期不是 YYYY-MM-DD → 闸红(复核闹钟本身坏了)", () => {
    for (const bad of ["2026-11", "11/18/2026", "2026-11-18T00:00:00Z", "", "很快"]) {
      expect(
        evaluateCostPin("test:pin", { ...good, observedOn: bad }, "2026-09-01")
          .some((p) => p.level === "red" && p.message.includes("observedOn")),
      ).toBe(true);
      expect(
        evaluateCostPin("test:pin", { ...good, nextReviewDate: bad }, "2026-09-01")
          .some((p) => p.level === "red" && p.message.includes("nextReviewDate")),
      ).toBe(true);
    }
  });

  it("MONEY-A4:判词都带钉点键名 —— 闸红时人能直接找到是哪一条", () => {
    const problems = evaluateCostPin("image:seedream-pro:per-image", { ...good, source: "" }, "2026-09-01");
    expect(problems[0]!.pin).toBe("image:seedream-pro:per-image");
    expect(problems[0]!.message).toContain("image:seedream-pro:per-image");
  });

  it("MONEY-A4:整张表今天全绿(首批钉点没有一条红或黄)", () => {
    expect(evaluateAllCostPins("2026-09-01")).toEqual([]);
  });

  it("MONEY-A4:整张表到了复核日全黄不红(一次复核管两张表,提醒到位但不卡发布)", () => {
    const problems = evaluateAllCostPins("2026-11-18");
    expect(problems.length).toBe(Object.keys(COST_PINS).length);
    expect(problems.every((p) => p.level === "yellow")).toBe(true);
  });
});

/* ─────────────────── 表的内容(第二证人) ─────────────────── */

describe("成本钉点表 —— 首批钉点(规格 §7.1)", () => {
  it("首批钉点的复核到期日全部 = 汇率钉点同日(一次复核管两张表)", () => {
    for (const [key, pin] of Object.entries(COST_PINS)) {
      expect(`${key}:${pin.nextReviewDate}`).toBe(`${key}:${FX_PIN.nextReviewDate}`);
    }
    expect(FX_PIN.nextReviewDate).toBe("2026-11-18");
  });

  it("每条钉点四要素齐全:数值 / 来源 / 观察日 / 复核到期日(外加计价单位)", () => {
    for (const [key, pin] of Object.entries(COST_PINS)) {
      // 断言里带上 key,失败时直接看得出是哪一条钉点坏了。
      expect({ key, positiveFinite: Number.isFinite(pin.value) && pin.value > 0 }).toEqual({ key, positiveFinite: true });
      expect(pin.unit.trim().length).toBeGreaterThan(0);
      expect(pin.source.trim().length).toBeGreaterThan(0);
      expect(pin.observedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(pin.nextReviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("数值锚:每条钉点逐键手抄对账(测试是第二证人,数字在这里是独立抄写)", () => {
    expect(costPinValue("video:seedance-2-mini:t2v-per-mtoken")).toBe(3.5);
    expect(costPinValue("video:seedance-2-mini:v2v-per-mtoken")).toBe(2.1);
    expect(costPinValue("video:seedance-2.0:1080p-per-ktoken")).toBe(0.0077);
    expect(costPinValue("video:seedance-2.0:1080p-tokens-per-5s")).toBe(245025);
    expect(costPinValue("image:seedream-lite:per-image")).toBe(0.035);
    expect(costPinValue("image:seedream-pro:per-image")).toBe(0.045);
    expect(costPinValue("understanding:in-per-mtoken")).toBe(0.1);
    expect(costPinValue("understanding:out-per-mtoken")).toBe(0.4);
    expect(costPinValue("search:tavily:basic-per-call")).toBe(0.008);
    expect(costPinValue("search:tavily:advanced-per-call")).toBe(0.016);
    expect(costPinValue("search:brave:per-call")).toBe(0.005);
    expect(costPinValue("stripe:fee:local-card-percent")).toBe(0.03);
    expect(costPinValue("stripe:fee:local-card-fixed-myr-minor")).toBe(100);
    expect(costPinValue("stripe:fee:international-card-percent-surcharge")).toBe(0.01);
    expect(costPinValue("stripe:fee:currency-conversion-percent")).toBe(0.02);
  });

  it("1080p 成本可机器推导:单价 × 实测 tokens = $1.8867 / 5s(不再靠 720p 回退值)", () => {
    const usdPer5s =
      costPinValue("video:seedance-2.0:1080p-per-ktoken") *
      (costPinValue("video:seedance-2.0:1080p-tokens-per-5s") / 1000);
    expect(usdPer5s).toBeCloseTo(1.8867, 4);
  });

  it("Brave 回退通道成本低于主通道 Tavily basic —— 回退时毛利只高不低(毛利表以此为证)", () => {
    expect(costPinValue("search:brave:per-call")).toBeLessThan(costPinValue("search:tavily:basic-per-call"));
  });

  it("两条带复核条款的钉点(Brave / Stripe)在备注里写明了怎么复核", () => {
    expect(COST_PINS["search:brave:per-call"].note).toContain("首笔真实账单复核");
    expect(COST_PINS["stripe:fee:local-card-percent"].note).toContain("balance_transaction");
  });

  it("大图不入表 = 不可售(fail closed,重申 S1)", () => {
    expect(Object.keys(COST_PINS).some((k) => k.includes("large") || k.includes("大图"))).toBe(false);
  });
});

/* ─────────────────── 消费面回归(改线后出口值一个不变) ─────────────────── */

describe("成本钉点表 —— 消费面回归(常量改为从钉点取值,数值逐字不变)", () => {
  it("生成侧视频牌价两档出口不变", () => {
    expect(BYTEPLUS_USD_PER_MTOKEN).toBe(3.5);
    expect(BYTEPLUS_USD_PER_MTOKEN_WITH_VIDEO_INPUT).toBe(2.1);
  });

  it("图片与参考图记账基准出口不变(两条链路今天同价,共用一条钉点)", () => {
    expect(GEN_PRICE_USD_PER_IMAGE).toBe(0.035);
    expect(REFGEN_PRICE_USD_PER_IMAGE).toBe(0.035);
    expect(GEN_PRICE_USD_PER_IMAGE).toBe(costPinValue("image:seedream-lite:per-image"));
    expect(REFGEN_PRICE_USD_PER_IMAGE).toBe(costPinValue("image:seedream-lite:per-image"));
  });

  it("素材理解牌价出口不变", () => {
    expect(UNDERSTANDING_USD_PER_MTOKEN_IN).toBe(0.1);
    expect(UNDERSTANDING_USD_PER_MTOKEN_OUT).toBe(0.4);
  });

  it("搜索成本表出口不变(as const 形状与 SearchDepth 类型不动)", () => {
    expect(SEARCH_PROVIDER_COST_USD.basic).toBe(0.008);
    expect(SEARCH_PROVIDER_COST_USD.advanced).toBe(0.016);
  });
});
