import { describe, it, expect } from "vitest";
import {
  llmPricesFor,
  llmPricesOrNull,
  ottoLlmMargin,
  OTTO_BILLABLE_MODEL_ID,
  OTTO_LLM_MARGIN_DEFAULT,
  OTTO_LLM_MARGIN_FLOOR,
  PRICED_MODEL_IDS,
} from "./llm-prices.js";

/**
 * ENGINE-A5(Otto 引擎 S2 §7.2①)—— 价目 fail closed。
 *
 * 从前这几条测的是「猜得对不对」:子串含 opus 就按 opus,其余一律 sonnet,于是「未知型号」
 * 有一个**看起来很安全**的答案(非零、永远收得到钱)。它安全的只是我们不会收 0,不安全
 * 的是我们会按**别的型号**的价收 —— 换一个更贵的型号进 manifest,账单差额静默由我们吃。
 * 所以整族用例翻面:猜价没有了,未知型号是一条能照着修的错误。
 */
describe("ENGINE-A5 llmPricesFor — 未定价的型号一律抛错(fail closed,不再猜价)", () => {
  it("ENGINE-A5:canonical sonnet id → sonnet rates(已定价型号精确命中)", () => {
    expect(llmPricesFor("claude-sonnet-4-6")).toEqual({ inputPerToken: 3e-6, outputPerToken: 15e-6, cachedInputPerToken: 0.3e-6, cacheWriteInputPerToken: 3.75e-6 });
  });

  it("ENGINE-A5:canonical opus id → opus rates(已定价型号精确命中)", () => {
    expect(llmPricesFor("claude-opus-4-8")).toEqual({ inputPerToken: 5e-6, outputPerToken: 25e-6, cachedInputPerToken: 0.5e-6, cacheWriteInputPerToken: 6.25e-6 });
  });

  it("ENGINE-A5:529 同档接管的 claude-sonnet-4-5 有自己的一行价 —— 同档不等于免登记", () => {
    expect(llmPricesFor("claude-sonnet-4-5")).toEqual({ inputPerToken: 3e-6, outputPerToken: 15e-6, cachedInputPerToken: 0.3e-6, cacheWriteInputPerToken: 3.75e-6 });
  });

  it("ENGINE-A5:未知型号必抛,判词带型号名与两条出路", () => {
    expect(() => llmPricesFor("totally-unknown-model-xyz")).toThrow(/totally-unknown-model-xyz/);
    expect(() => llmPricesFor("totally-unknown-model-xyz")).toThrow(/价目表/);
    expect(() => llmPricesFor("totally-unknown-model-xyz")).toThrow(/改回已定价型号/);
  });

  it("ENGINE-A5:子串猜价整段删除 —— provider 前缀 / 大小写 / 空串一个都不再被猜中", () => {
    // 这四个从前**全部有价**:前两个按子串猜,后两个落默认档。猜对了不代表算对了 ——
    // "anthropic/claude-opus-4-8" 拿到的是 opus 价,而它是不是我们真的在跑的那个型号,
    // 这个函数根本不知道。
    for (const model of ["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-4.5", "", "gpt-something"]) {
      expect(() => llmPricesFor(model), `llmPricesFor(${JSON.stringify(model)})`).toThrow();
      expect(llmPricesOrNull(model), `llmPricesOrNull(${JSON.stringify(model)})`).toBeNull();
    }
  });

  it("ENGINE-A5:llmPricesOrNull 是给自己判定的调用方用的 —— 查得到就是同一个对象,不抛", () => {
    expect(llmPricesOrNull("claude-sonnet-4-6")).toEqual(llmPricesFor("claude-sonnet-4-6"));
  });

  it("ENGINE-A5:计价型号常量本身必须在价目表里(两处常量对不上就是一次静默错价)", () => {
    expect(PRICED_MODEL_IDS).toContain(OTTO_BILLABLE_MODEL_ID);
    expect(llmPricesOrNull(OTTO_BILLABLE_MODEL_ID)).not.toBeNull();
  });

  it("EVERY priced model has all four fields strictly > 0 (the money invariant: a paid call can never cost 0)", () => {
    for (const model of PRICED_MODEL_IDS) {
      const p = llmPricesFor(model);
      expect(p.inputPerToken).toBeGreaterThan(0);
      expect(p.outputPerToken).toBeGreaterThan(0);
      expect(p.cachedInputPerToken).toBeGreaterThan(0);
      expect(p.cacheWriteInputPerToken).toBeGreaterThan(0);
    }
  });

  it("cache-write premium is exactly 1.25× input, and cache-read is strictly cheaper than input (Anthropic pricing shape)", () => {
    for (const model of PRICED_MODEL_IDS) {
      const p = llmPricesFor(model);
      expect(p.cacheWriteInputPerToken).toBeCloseTo(p.inputPerToken * 1.25, 12);
      expect(p.cachedInputPerToken).toBeLessThan(p.inputPerToken);
    }
  });
});

describe("ottoLlmMargin", () => {
  /** 每个用例都自己收拾 env —— 这是个进程级全局,漏掉会污染同文件的其它用例。 */
  const withMargin = <T>(value: string | undefined, fn: () => T): T => {
    const saved = process.env.OTTO_LLM_MARGIN;
    if (value === undefined) delete process.env.OTTO_LLM_MARGIN;
    else process.env.OTTO_LLM_MARGIN = value;
    try {
      return fn();
    } finally {
      if (saved === undefined) delete process.env.OTTO_LLM_MARGIN;
      else process.env.OTTO_LLM_MARGIN = saved;
    }
  };

  it("defaults to OTTO_LLM_MARGIN_DEFAULT (2.06) when the env var is unset/invalid", () => {
    withMargin(undefined, () => {
      expect(ottoLlmMargin()).toBe(OTTO_LLM_MARGIN_DEFAULT);
      expect(OTTO_LLM_MARGIN_DEFAULT).toBe(2.06);
    });
  });

  // ── 钱路 M1-c(审计 P1):下限守卫 ────────────────────────────────────────────
  // 病灶就是一行:`Number.isFinite(v) && v > 0`。0.5 是个正经的正有限数,而它的意思是
  // 「每一次 LLM 调用按 provider 账单的一半收费」—— 每卖一单亏一单,没有任何测试会红。
  it("下限 = 裁决值 2.06(Founder 2026-09-01),与默认值合一 —— 覆盖只能调高不能调低", () => {
    expect(OTTO_LLM_MARGIN_FLOOR).toBe(2.06);
    expect(OTTO_LLM_MARGIN_DEFAULT).toBe(OTTO_LLM_MARGIN_FLOOR);
  });

  it("面值毛利 51.46%、本地卡带最坏实收 45.73% —— 2.06 是「刚清 45% 地板」的裁决值", () => {
    // 面值口径:1 − 1/2.06。
    expect(1 - 1 / OTTO_LLM_MARGIN_DEFAULT).toBeCloseTo(0.5146, 4);
    // 最坏实收口径(压力测试口径):面值 × 最坏包实收系数 0.8944(pricing-config 现算,
    // 见 packReceiptCoefficient)。旧费率 2.0 在这个口径下是 44.10% —— 破线,这正是要改的原因。
    const worstCoeff = 0.894444444;
    const receipt = (k: number) => (k * worstCoeff - 1) / (k * worstCoeff);
    expect(receipt(OTTO_LLM_MARGIN_DEFAULT)).toBeCloseTo(0.4573, 4);
    expect(receipt(2.0)).toBeCloseTo(0.441, 3);
    expect(receipt(2.0)).toBeLessThan(0.45);
  });

  it("配成 0.5(亏着卖)→ 忽略,退回默认值 2.06", () => {
    withMargin("0.5", () => expect(ottoLlmMargin()).toBe(OTTO_LLM_MARGIN_DEFAULT));
  });

  it("下限以下的每一种写法都被拒:0.5 / 0.99 / 0 / 负数 / 1.5 / 1.82 / 2.05", () => {
    for (const bad of ["0.5", "0.99", "0", "-3", "1.5", "1.82", "2.05"]) {
      withMargin(bad, () => expect(ottoLlmMargin(), `OTTO_LLM_MARGIN=${bad}`).toBe(OTTO_LLM_MARGIN_DEFAULT));
    }
  });

  // MONEY-A2:验收表点名的那个区间。旧地板 1.0 下 [1.0, 1.82) 是**一路绿灯**的
  // ——钳位放行、开机检查放行、CI 毛利闸读的却是代码默认值,于是生产按 1.5 在卖而无人知晓。
  // 现在同样的覆盖值在运行时被**收紧到 2.06**(这一条),并在开机时被点名(env-contract.test)。
  it("MONEY-A2:费率覆盖设入 [1.0, 1.82) 区间不再静默 —— 运行时地板收紧到 2.06", () => {
    for (const inRange of ["1.0", "1.2", "1.5", "1.81"]) {
      withMargin(inRange, () => {
        expect(ottoLlmMargin(), `OTTO_LLM_MARGIN=${inRange}`).toBe(2.06);
        // 收紧的方向:实际生效的费率**高于**配置值,绝不低于。
        expect(ottoLlmMargin()).toBeGreaterThan(Number(inRange));
      });
    }
  });

  it("正好 2.06 是允许的 —— 下限是闭区间(裁决值本身当然合法)", () => {
    withMargin("2.06", () => expect(ottoLlmMargin()).toBe(2.06));
  });

  it("下限之上的合法覆盖照旧生效(守卫只拦调低,不拦调高)", () => {
    withMargin("2.5", () => expect(ottoLlmMargin()).toBe(2.5));
    withMargin("3", () => expect(ottoLlmMargin()).toBe(3));
  });

  it("退回方向是 fail-closed:被拒时收得**更多**,不是更少", () => {
    withMargin("0.5", () => expect(ottoLlmMargin()).toBeGreaterThan(0.5));
  });

  it("垃圾值照旧退回默认(行为不变)", () => {
    for (const bad of ["", "abc", "NaN", "Infinity"]) {
      withMargin(bad, () => expect(ottoLlmMargin(), `OTTO_LLM_MARGIN=${bad}`).toBe(OTTO_LLM_MARGIN_DEFAULT));
    }
  });
});
