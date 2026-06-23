import { describe, it, expect } from "vitest";
import { llmPricesFor, ottoLlmMargin, OTTO_LLM_MARGIN_DEFAULT } from "./llm-prices.js";

describe("llmPricesFor — never priced free (metering-hole guard)", () => {
  it("canonical sonnet id → sonnet rates", () => {
    expect(llmPricesFor("claude-sonnet-4-6")).toEqual({ inputPerToken: 3e-6, outputPerToken: 15e-6, cachedInputPerToken: 0.3e-6 });
  });

  it("canonical opus id → opus rates", () => {
    expect(llmPricesFor("claude-opus-4-8")).toEqual({ inputPerToken: 5e-6, outputPerToken: 25e-6, cachedInputPerToken: 0.5e-6 });
  });

  it("provider-prefixed fal sonnet id (anthropic/claude-sonnet-4.5) → sonnet rates, NOT zero", () => {
    const p = llmPricesFor("anthropic/claude-sonnet-4.5");
    expect(p.inputPerToken).toBe(3e-6);
    expect(p.outputPerToken).toBe(15e-6);
  });

  it("provider-prefixed opus id → opus rates (substring match)", () => {
    expect(llmPricesFor("anthropic/claude-opus-4-8")).toEqual({ inputPerToken: 5e-6, outputPerToken: 25e-6, cachedInputPerToken: 0.5e-6 });
  });

  it("completely unknown model → non-zero default (sonnet), NEVER zero", () => {
    const p = llmPricesFor("totally-unknown-model-xyz");
    expect(p.inputPerToken).toBe(3e-6);
    expect(p.outputPerToken).toBe(15e-6);
  });

  it("EVERY resolved price has all three fields strictly > 0 (the money invariant: a paid call can never cost 0)", () => {
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-8", "anthropic/claude-sonnet-4.5", "", "x", "gpt-something"]) {
      const p = llmPricesFor(model);
      expect(p.inputPerToken).toBeGreaterThan(0);
      expect(p.outputPerToken).toBeGreaterThan(0);
      expect(p.cachedInputPerToken).toBeGreaterThan(0);
    }
  });
});

describe("ottoLlmMargin", () => {
  it("defaults to OTTO_LLM_MARGIN_DEFAULT (3) when the env var is unset/invalid", () => {
    const saved = process.env.OTTO_LLM_MARGIN;
    delete process.env.OTTO_LLM_MARGIN;
    expect(ottoLlmMargin()).toBe(OTTO_LLM_MARGIN_DEFAULT);
    expect(OTTO_LLM_MARGIN_DEFAULT).toBe(3);
    if (saved !== undefined) process.env.OTTO_LLM_MARGIN = saved;
  });
});
