import { describe, it, expect } from "vitest";
import {
  FX_PIN,
  MYR_PER_USD_PIN,
  myrMinorToUsd,
  evaluateFxPin,
  type FxPin,
  CREDIT_PACKS,
  CREDIT_PACK_CURRENCY,
  verifyCreditPackPurchase,
  SEARCH_MARGIN_MULTIPLIER,
  SEARCH_PROVIDER_COST_USD,
  searchUnitChargeInternal,
  searchChargeInternal,
  packReceiptCoefficient,
  worstPackReceiptCoefficient,
} from "./pricing-config.js";
import { CREDITS_PER_USD } from "./spend.js";
import { costPinValue } from "./cost-pins.js";

/**
 * 钱路 M1-c —— 集中定价配置的行为测试。
 *
 * 这三节合起来回答一个问题:**代码现在知道价格的哪些事,是它以前不知道的?**
 * FX 换算、在售包表、搜索费率 —— 三样都曾经只活在文档或 Stripe 后台里。
 */

/* ───────────────────────── §1 FX 钉点 ───────────────────────── */

describe("FX 钉点(Founder 2026-08-18 裁决 10)", () => {
  const good: FxPin = {
    myrPerUsd: 4.5,
    nextReviewDate: "2026-11-18",
    reference: { rate: 4.062917, observedOn: "2026-08-18", source: "现汇" },
  };

  it("钉点是 4.50,复核期 2026-11-18,参考现汇带日期与出处", () => {
    expect(FX_PIN.myrPerUsd).toBe(4.5);
    expect(MYR_PER_USD_PIN).toBe(FX_PIN.myrPerUsd);
    expect(FX_PIN.nextReviewDate).toBe("2026-11-18");
    expect(FX_PIN.reference.rate).toBeCloseTo(4.062917, 6);
    expect(FX_PIN.reference.observedOn).toBe("2026-08-18");
    expect(FX_PIN.reference.source.trim().length).toBeGreaterThan(0);
  });

  it("钉点 = 现汇 × 1.10 的安全缓冲(Founder 拍的是机制,这里钉住那个机制)", () => {
    // 4.062917 × 1.10 = 4.4692…,取整到 4.50 —— 缓冲只多不少。
    expect(FX_PIN.myrPerUsd).toBeGreaterThanOrEqual(FX_PIN.reference.rate * 1.1);
    // 但也不许离谱地高(高到假装我们收得比实际少太多,毛利算不出真话)。
    expect(FX_PIN.myrPerUsd).toBeLessThan(FX_PIN.reference.rate * 1.25);
  });

  it("现行钉点在今天是全绿(不红也不黄)", () => {
    expect(evaluateFxPin(FX_PIN, "2026-08-18")).toEqual([]);
  });

  it("换算:RM100 按钉点 = $22.22(业务代码引这一个函数,不再写汇率字面量)", () => {
    expect(myrMinorToUsd(10000)).toBeCloseTo(100 / 4.5, 9);
    expect(myrMinorToUsd(2500)).toBeCloseTo(25 / 4.5, 9);
  });

  // ── F3 红:令吉弱过钉点 = 毛利被吃 ──
  it("F3 红:参考现汇 > 钉点(令吉走弱)→ 红,并点名请 Founder 重定价", () => {
    const weak = { ...good, reference: { ...good.reference, rate: 4.8 } };
    const problems = evaluateFxPin(weak, "2026-08-18");
    const red = problems.filter((p) => p.level === "red");
    expect(red).toHaveLength(1);
    expect(red[0]!.message).toMatch(/弱过/);
    expect(red[0]!.message).toMatch(/F3/);
  });

  it("F3 边界:现汇正好等于钉点还不红(缓冲刚好用尽,尚未亏)", () => {
    const exact = { ...good, reference: { ...good.reference, rate: 4.5 } };
    expect(evaluateFxPin(exact, "2026-08-18").filter((p) => p.level === "red")).toEqual([]);
  });

  it("F3 绿:令吉走强(现汇 < 钉点)不报任何东西 —— 缓冲变厚不是问题", () => {
    const strong = { ...good, reference: { ...good.reference, rate: 3.9 } };
    expect(evaluateFxPin(strong, "2026-08-18")).toEqual([]);
  });

  // ── F4 黄:复核到期 ──
  it("F4 黄:过了 nextReviewDate → 黄(提醒复核),**不是**红", () => {
    const problems = evaluateFxPin(good, "2026-11-18");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.level).toBe("yellow");
    expect(problems[0]!.message).toMatch(/复核期到了/);
    // 到期当天就响,不是隔天才响。
    expect(evaluateFxPin(good, "2026-11-17")).toEqual([]);
    expect(evaluateFxPin(good, "2027-01-01")[0]!.level).toBe("yellow");
  });

  it("黄不带红:复核过期本身永远不该拦住发布(汇率复核是 Founder 的定价动作)", () => {
    expect(evaluateFxPin(good, "2027-06-01").filter((p) => p.level === "red")).toEqual([]);
  });

  // ── F1 / F2 红:声明本身烂掉 ──
  it("F1 红:钉点或参考现汇不是正有限数", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const pin = { ...good, myrPerUsd: bad } as FxPin;
      expect(evaluateFxPin(pin, "2026-08-18").some((p) => p.level === "red")).toBe(true);
    }
    const badRef = { ...good, reference: { ...good.reference, rate: 0 } };
    expect(evaluateFxPin(badRef, "2026-08-18").some((p) => p.level === "red")).toBe(true);
  });

  it("F2 红:日期不是 YYYY-MM-DD", () => {
    const badDate = { ...good, nextReviewDate: "2026/11/18" };
    expect(evaluateFxPin(badDate, "2026-08-18").some((p) => p.message.includes("F2"))).toBe(true);
    const badObserved = { ...good, reference: { ...good.reference, observedOn: "next week" } };
    expect(evaluateFxPin(badObserved, "2026-08-18").some((p) => p.message.includes("F2"))).toBe(true);
  });

  it("F1 红:参考现汇没有出处 —— 查不到出处的汇率不是证据", () => {
    const noSource = { ...good, reference: { ...good.reference, source: "   " } };
    expect(evaluateFxPin(noSource, "2026-08-18").some((p) => p.message.includes("source"))).toBe(true);
  });
});

/* ───────────────────────── §2 充值包表 ───────────────────────── */

describe("充值包表 + 入账核对(钱路审计:充值包只活在 Stripe 后台、金额无核对)", () => {
  it("三个在售包:RM25/50cr、RM100/220cr、RM250/600cr", () => {
    expect(CREDIT_PACK_CURRENCY).toBe("myr");
    expect(CREDIT_PACKS.map((p) => [p.amountMinor, p.credits])).toEqual([
      [2500, 50],
      [10000, 220],
      [25000, 600],
    ]);
  });

  it("包表本身没有重复的 credits 数 —— 否则「按 credits 找包」就不是唯一的", () => {
    const creditCounts = CREDIT_PACKS.map((p) => p.credits);
    expect(new Set(creditCounts).size).toBe(creditCounts.length);
  });

  it("每个包都在毛利上说得通:$/credit 不低于 1 显示 credit = $0.10 的锚(按钉点换算)", () => {
    for (const pack of CREDIT_PACKS) {
      const usd = myrMinorToUsd(pack.amountMinor);
      // 一个显示 credit 卖 $0.10 是产品的锚(spend.ts INTERNAL_PER_DISPLAY)。包是打折卖的,
      // 但折扣不许深到把 credit 卖成半价 —— 那是定价决定,不是可以悄悄漂移的东西。
      expect(usd / pack.credits).toBeGreaterThan(0.05);
      expect(usd / pack.credits).toBeLessThanOrEqual(0.12);
    }
  });

  // ── 匹配:照常入账 ──
  it("match:金额、币种、credits 三样对得上 → 照常入账", () => {
    for (const pack of CREDIT_PACKS) {
      const r = verifyCreditPackPurchase({ credits: pack.credits, amountTotal: pack.amountMinor, currency: "myr" });
      expect(r.verdict).toBe("match");
      expect(r.verdict === "match" && r.pack.name).toBe(pack.name);
    }
  });

  it("match:币种大小写不敏感(Stripe 回小写,但不赌它)", () => {
    expect(verifyCreditPackPurchase({ credits: 220, amountTotal: 10000, currency: "MYR" }).verdict).toBe("match");
  });

  // ── 不匹配:报警不入账 ──
  it("mismatch:付 RM25 却写 220 credits(后台错配)→ 不入账", () => {
    const r = verifyCreditPackPurchase({ credits: 220, amountTotal: 2500, currency: "myr" });
    expect(r.verdict).toBe("mismatch");
    expect(r.verdict === "mismatch" && r.reason).toMatch(/金额 2500/);
  });

  it("mismatch:credits 数根本不在包表里(Stripe 后台加了包而代码没更新)", () => {
    const r = verifyCreditPackPurchase({ credits: 999, amountTotal: 45000, currency: "myr" });
    expect(r.verdict).toBe("mismatch");
    expect(r.verdict === "mismatch" && r.reason).toMatch(/不在 CREDIT_PACKS/);
  });

  it("mismatch:币种不是 MYR", () => {
    const r = verifyCreditPackPurchase({ credits: 220, amountTotal: 10000, currency: "usd" });
    expect(r.verdict).toBe("mismatch");
    expect(r.verdict === "mismatch" && r.reason).toMatch(/币种/);
  });

  it("mismatch:credits 不是正整数", () => {
    for (const bad of [0, -5, 1.5, "abc", null, undefined]) {
      expect(verifyCreditPackPurchase({ credits: bad, amountTotal: 10000, currency: "myr" }).verdict).toBe("mismatch");
    }
  });

  // ── 没法核 ≠ 不匹配 ──
  it("unverifiable:Stripe 没报金额 → 不是 mismatch(「没法核」不等于「对不上」)", () => {
    for (const bad of [null, undefined, "10000", Number.NaN]) {
      const r = verifyCreditPackPurchase({ credits: 220, amountTotal: bad, currency: "myr" });
      expect(r.verdict, `amountTotal=${String(bad)}`).toBe("unverifiable");
    }
  });

  it("unverifiable:Stripe 没报币种", () => {
    expect(verifyCreditPackPurchase({ credits: 220, amountTotal: 10000, currency: null }).verdict).toBe("unverifiable");
    expect(verifyCreditPackPurchase({ credits: 220, amountTotal: 10000, currency: "  " }).verdict).toBe("unverifiable");
  });

  it("金额对不上时**优先报 mismatch**,不会因为顺序问题降级成 unverifiable", () => {
    // credits 认得出包、金额读得到但是错的 → 必须是 mismatch(会拦住入账),不是 unverifiable。
    const r = verifyCreditPackPurchase({ credits: 50, amountTotal: 1, currency: "myr" });
    expect(r.verdict).toBe("mismatch");
  });
});

/* ───────────────────────── §3 搜索计价 3× ───────────────────────── */

describe("搜索计价 3×(Founder 2026-07-03 裁决,2026-08-18 裁决 9b 落地)", () => {
  it("倍数是 3.0,牌价 basic $0.008 / advanced $0.016", () => {
    expect(SEARCH_MARGIN_MULTIPLIER).toBe(3.0);
    expect(SEARCH_PROVIDER_COST_USD.basic).toBe(0.008);
    expect(SEARCH_PROVIDER_COST_USD.advanced).toBe(0.016);
  });

  it("单次收费与裁决里写的数逐字对上:basic → 3 internal、advanced → 5 internal", () => {
    expect(searchUnitChargeInternal("basic")).toBe(3);
    expect(searchUnitChargeInternal("advanced")).toBe(5);
    expect(searchUnitChargeInternal()).toBe(3); // 现役 research 走 basic
  });

  it("3× 的毛利率是 66.7%,清 45% 地板还有 20 多个点", () => {
    const margin = 1 - 1 / SEARCH_MARGIN_MULTIPLIER;
    expect(margin).toBeCloseTo(2 / 3, 9);
    expect(margin).toBeGreaterThan(0.45);
  });

  it("单次收费 ≥ 单次成本 —— 逐次进位,余量归我们,永不亏着卖", () => {
    for (const depth of ["basic", "advanced"] as const) {
      const costInternal = SEARCH_PROVIDER_COST_USD[depth] * CREDITS_PER_USD;
      expect(searchUnitChargeInternal(depth)).toBeGreaterThan(costInternal);
    }
  });

  it("N 次 = N × 单次(逐次进位,不是先乘后进位)", () => {
    expect(searchChargeInternal(5)).toBe(15);
    expect(searchChargeInternal(12)).toBe(36);
    expect(searchChargeInternal(25)).toBe(75);
    expect(searchChargeInternal(12, "advanced")).toBe(60);
  });

  it("计数器坏掉 → 收 0,不收一个编出来的数", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(searchChargeInternal(bad), `searches=${String(bad)}`).toBe(0);
    }
  });
});

/* ─────── §2b 实收系数(MONEY-A2:45% 地板的最坏实收口径) ─────── */

/**
 * 三个系数是这次施工里唯一「看起来像常量」的数字,所以它们必须被钉死 —— 但钉的是
 * **算出来的值**,不是抄进来的值。任何一样输入动了(包价、包 credits、Stripe 费率、
 * 汇率钉点),这一节当场变红,逼一次口径重审。
 */
describe("充值包实收系数(MONEY-A2:面值 × 包折扣 × 手续费 × 汇率钉点)", () => {
  const byName = (needle: string) => CREDIT_PACKS.find((p) => p.name.startsWith(needle))!;

  it("MONEY-A2:三包系数 = Starter 1.0333(溢价)/ Standard 0.9697 / Pro 0.8944", () => {
    expect(packReceiptCoefficient(byName("Starter"))).toBeCloseTo(1.0333, 4);
    expect(packReceiptCoefficient(byName("Standard"))).toBeCloseTo(0.9697, 4);
    expect(packReceiptCoefficient(byName("Pro"))).toBeCloseTo(0.8944, 4);
  });

  it("最坏包是**算出来的**(min),不是「最深折扣包」这条公理", () => {
    const coeffs = CREDIT_PACKS.map((p) => ({ name: p.name, c: packReceiptCoefficient(p) }));
    const worst = coeffs.reduce((a, b) => (b.c < a.c ? b : a));
    // 今天答案是 Pro —— 但它是比出来的,不是记住的。
    expect(worst.name).toContain("Pro");
    expect(worstPackReceiptCoefficient()).toBeCloseTo(worst.c, 12);
    expect(worstPackReceiptCoefficient()).toBeCloseTo(0.8944, 4);
  });

  it("小包是**溢价**卖的:Starter 系数 > 1 —— 「买得越多我们收得越少」不是一条直觉,是算术", () => {
    expect(packReceiptCoefficient(byName("Starter"))).toBeGreaterThan(1);
    expect(packReceiptCoefficient(byName("Standard"))).toBeLessThan(1);
    expect(packReceiptCoefficient(byName("Pro"))).toBeLessThan(packReceiptCoefficient(byName("Standard")));
  });

  it("系数由现算,不是手抄:逐包复算一遍算式(手续费 = round(金额×3%) + RM1)", () => {
    for (const pack of CREDIT_PACKS) {
      const feeMinor =
        Math.round(pack.amountMinor * costPinValue("stripe:fee:local-card-percent")) +
        costPinValue("stripe:fee:local-card-fixed-myr-minor");
      const expected = myrMinorToUsd(pack.amountMinor - feeMinor) / (pack.credits / 10);
      expect(packReceiptCoefficient(pack), pack.name).toBeCloseTo(expected, 12);
    }
  });

  it("研究档 2.06× 在最坏实收口径下**刚清** 45% 地板,旧费率 2.0× 破线", () => {
    const worst = worstPackReceiptCoefficient();
    const receiptMargin = (k: number) => (k * worst - 1) / (k * worst);
    expect(receiptMargin(2.06)).toBeCloseTo(0.4573, 4);
    expect(receiptMargin(2.06)).toBeGreaterThanOrEqual(0.45);
    expect(receiptMargin(2.0)).toBeCloseTo(0.441, 3);
    expect(receiptMargin(2.0)).toBeLessThan(0.45);
    // 聊天 1.05× 在同一口径下是负的 —— 已知、已注记、不改费率(margin-truth.ts 的 RULED 行)。
    expect(receiptMargin(1.05)).toBeCloseTo(-0.0648, 4);
  });
});
