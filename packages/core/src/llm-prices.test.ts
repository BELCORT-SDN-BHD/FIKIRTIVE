import { describe, it, expect } from "vitest";
import { llmPricesFor, ottoLlmMargin, OTTO_LLM_MARGIN_DEFAULT, OTTO_LLM_MARGIN_FLOOR } from "./llm-prices.js";

describe("llmPricesFor — never priced free (metering-hole guard)", () => {
  it("canonical sonnet id → sonnet rates", () => {
    expect(llmPricesFor("claude-sonnet-4-6")).toEqual({ inputPerToken: 3e-6, outputPerToken: 15e-6, cachedInputPerToken: 0.3e-6, cacheWriteInputPerToken: 3.75e-6 });
  });

  it("canonical opus id → opus rates", () => {
    expect(llmPricesFor("claude-opus-4-8")).toEqual({ inputPerToken: 5e-6, outputPerToken: 25e-6, cachedInputPerToken: 0.5e-6, cacheWriteInputPerToken: 6.25e-6 });
  });

  it("provider-prefixed sonnet id (OpenRouter-style, anthropic/claude-sonnet-4.5) → sonnet rates, NOT zero", () => {
    const p = llmPricesFor("anthropic/claude-sonnet-4.5");
    expect(p.inputPerToken).toBe(3e-6);
    expect(p.outputPerToken).toBe(15e-6);
  });

  it("provider-prefixed opus id → opus rates (substring match)", () => {
    expect(llmPricesFor("anthropic/claude-opus-4-8")).toEqual({ inputPerToken: 5e-6, outputPerToken: 25e-6, cachedInputPerToken: 0.5e-6, cacheWriteInputPerToken: 6.25e-6 });
  });

  it("completely unknown model → non-zero default (sonnet), NEVER zero", () => {
    const p = llmPricesFor("totally-unknown-model-xyz");
    expect(p.inputPerToken).toBe(3e-6);
    expect(p.outputPerToken).toBe(15e-6);
  });

  it("EVERY resolved price has all four fields strictly > 0 (the money invariant: a paid call can never cost 0)", () => {
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-8", "anthropic/claude-sonnet-4.5", "", "x", "gpt-something"]) {
      const p = llmPricesFor(model);
      expect(p.inputPerToken).toBeGreaterThan(0);
      expect(p.outputPerToken).toBeGreaterThan(0);
      expect(p.cachedInputPerToken).toBeGreaterThan(0);
      expect(p.cacheWriteInputPerToken).toBeGreaterThan(0);
    }
  });

  it("cache-write premium is exactly 1.25× input, and cache-read is strictly cheaper than input (Anthropic pricing shape)", () => {
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-8"]) {
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

  it("defaults to OTTO_LLM_MARGIN_DEFAULT (2.0) when the env var is unset/invalid", () => {
    withMargin(undefined, () => {
      expect(ottoLlmMargin()).toBe(OTTO_LLM_MARGIN_DEFAULT);
      expect(OTTO_LLM_MARGIN_DEFAULT).toBe(2.0);
    });
  });

  // ── 钱路 M1-c(审计 P1):下限守卫 ────────────────────────────────────────────
  // 病灶就是一行:`Number.isFinite(v) && v > 0`。0.5 是个正经的正有限数,而它的意思是
  // 「每一次 LLM 调用按 provider 账单的一半收费」—— 每卖一单亏一单,没有任何测试会红。
  it("下限是 1.0 = 绝不低于 provider 自己的账单", () => {
    expect(OTTO_LLM_MARGIN_FLOOR).toBe(1.0);
    expect(OTTO_LLM_MARGIN_DEFAULT).toBeGreaterThan(OTTO_LLM_MARGIN_FLOOR);
  });

  it("配成 0.5(亏着卖)→ 忽略,退回默认值 2.0", () => {
    withMargin("0.5", () => expect(ottoLlmMargin()).toBe(OTTO_LLM_MARGIN_DEFAULT));
  });

  it("下限以下的每一种写法都被拒:0.5 / 0.99 / 0 / 负数", () => {
    for (const bad of ["0.5", "0.99", "0", "-3"]) {
      withMargin(bad, () => expect(ottoLlmMargin(), `OTTO_LLM_MARGIN=${bad}`).toBe(OTTO_LLM_MARGIN_DEFAULT));
    }
  });

  it("正好 1.0 是允许的 —— 下限是闭区间(平价转售不亏,只是不赚)", () => {
    withMargin("1", () => expect(ottoLlmMargin()).toBe(1.0));
  });

  it("下限之上的合法覆盖照旧生效(守卫只拦亏本,不改行为)", () => {
    withMargin("2.5", () => expect(ottoLlmMargin()).toBe(2.5));
    withMargin("1.82", () => expect(ottoLlmMargin()).toBe(1.82));
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
