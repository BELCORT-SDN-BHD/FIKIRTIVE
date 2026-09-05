import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  llmPricesFor,
  llmPricesOrNull,
  ottoLlmMargin,
  searchChargeInternal,
  turnBudgetInternal,
  OTTO_BILLABLE_MODEL_ID,
} from "@fikirtive/core";
import { RESEARCH_TIERS, researchTierBudgetInternal } from "./skills/propose-research.helpers.js";
import {
  assertOttoModelsPriced,
  isOverloadError,
  withOverloadFailover,
  injectPromptCacheControl,
  ottoModelRuntime,
  ottoPromptCacheEnabled,
  withPromptCaching,
  OTTO_PRIMARY_MODEL,
  OTTO_FALLBACK_MODEL,
  OTTO_DEFAULT_MODEL,
  OTTO_SUMMARY_MODEL,
  OTTO_SUMMARY_FALLBACK_MODEL,
  ottoModel,
  ottoSummaryModel,
} from "./model.js";

/**
 * ENGINE-A5(Otto 引擎 S2 §7.2①)—— **组合期查价:任一型号没价就拒绝启动。**
 *
 * manifest 是模块加载期的冻结常量,所以「这个文件被 import 成功了」本身就是第一条断言:
 * 三个型号里有一个没价,这整份测试文件根本加载不起来。
 */
describe("ENGINE-A5 型号与价目 fail closed(manifest 组合期)", () => {
  it("ENGINE-A5:manifest 的三个型号今天逐个都查得到价(模块能加载 = 已经过了这一关)", () => {
    for (const id of [OTTO_PRIMARY_MODEL, OTTO_FALLBACK_MODEL, OTTO_DEFAULT_MODEL]) {
      expect(llmPricesOrNull(id), id).not.toBeNull();
    }
    expect(ottoModelRuntime.billableModelId).toBe(OTTO_DEFAULT_MODEL);
  });

  it("ENGINE-A5:任一型号查不到价 → 抛,判词点名是哪个常量、带型号名与两条出路", () => {
    expect(() => assertOttoModelsPriced([["OTTO_FALLBACK_MODEL", "claude-not-in-the-table"]])).toThrow(
      /OTTO_FALLBACK_MODEL/,
    );
    expect(() => assertOttoModelsPriced([["OTTO_FALLBACK_MODEL", "claude-not-in-the-table"]])).toThrow(
      /claude-not-in-the-table/,
    );
    expect(() => assertOttoModelsPriced([["OTTO_PRIMARY_MODEL", "claude-not-in-the-table"]])).toThrow(/价目表/);
    // 一份清单里只要有一个没价就拒绝 —— 不是「大部分有价就放行」。
    expect(() =>
      assertOttoModelsPriced([
        ["OTTO_PRIMARY_MODEL", OTTO_PRIMARY_MODEL],
        ["OTTO_FALLBACK_MODEL", "claude-not-in-the-table"],
      ]),
    ).toThrow();
  });

  it("ENGINE-A6:折叠型号也在组合期查价名单里,manifest 把它作为 summaryBinding 带下去", () => {
    // §7.2④「摘要本身是一次便宜的小调用」—— 折叠跑哪个型号是 manifest 上的一个决定,
    // 不是 foldRollingSummary 里写死的一行。
    expect(llmPricesOrNull(OTTO_SUMMARY_MODEL)).not.toBeNull();
    expect(ottoModelRuntime.summaryBinding).toBe(ottoSummaryModel);
    expect(ottoModelRuntime.binding).toBe(ottoModel);
    expect(() => assertOttoModelsPriced([["OTTO_SUMMARY_MODEL", "claude-not-in-the-table"]])).toThrow(
      /OTTO_SUMMARY_MODEL/,
    );
  });

  it("ENGINE-A6:折叠跑 Haiku,并且 manifest 上的**计价型号**也是它(Founder 2026-09-05 裁决④)", () => {
    // 裁决原话:「折叠摘要换 Haiku,按 Haiku 实价计入商家账单」。两句话是两个断言:
    // 跑哪个(OTTO_SUMMARY_MODEL)、按谁的价收(manifest 的 summaryBillableModelId)。
    expect(OTTO_SUMMARY_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(ottoModelRuntime.summaryBillableModelId).toBe(OTTO_SUMMARY_MODEL);
    // 变异:把 summaryBillableModelId 改回 billableModelId(Sonnet)—— 这一行当场红。
    expect(ottoModelRuntime.summaryBillableModelId).not.toBe(ottoModelRuntime.billableModelId);
    // 折叠腿的价必须真的更便宜,否则这次换型号一分钱都没省。
    expect(llmPricesFor(OTTO_SUMMARY_MODEL).outputPerToken).toBeLessThan(
      llmPricesFor(ottoModelRuntime.billableModelId).outputPerToken,
    );
  });

  it("ENGINE-A6:折叠腿的 529 接管不跨价档 —— 接管型号等于折叠型号自己,且同样要有价", () => {
    // 主轮的接管(sonnet-4-5)与主力同价,所以跑哪个都收同一份钱。折叠换成 Haiku 之后这条
    // 不再成立:用 Sonnet 接管一次 Haiku 折叠 = 跑贵的按便宜的收,差额静默由我们吃。
    // 变异:把 OTTO_SUMMARY_FALLBACK_MODEL 指回 OTTO_FALLBACK_MODEL —— 第一行当场红。
    expect(OTTO_SUMMARY_FALLBACK_MODEL).toBe(OTTO_SUMMARY_MODEL);
    expect(OTTO_SUMMARY_FALLBACK_MODEL).not.toBe(OTTO_FALLBACK_MODEL);
    expect(() =>
      assertOttoModelsPriced([["OTTO_SUMMARY_FALLBACK_MODEL", "claude-not-in-the-table"]]),
    ).toThrow(/OTTO_SUMMARY_FALLBACK_MODEL/);
  });

  it("ENGINE-A5:计价型号是单一源 —— 主力型号逐字取自 @fikirtive/core 的常量", () => {
    expect(OTTO_PRIMARY_MODEL).toBe(OTTO_BILLABLE_MODEL_ID);
    expect(OTTO_DEFAULT_MODEL).toBe(OTTO_BILLABLE_MODEL_ID);
  });

  it("ENGINE-A5:深研预估与 manifest 同取一源 —— RESEARCH_METER_MODEL 那份抄件已消除", () => {
    // 从前 propose-research.helpers.ts 抄了一份裸字符串。抄件与 manifest 分家时,卡面预估
    // 与 worker 真 reserve 会按两个型号的价算,而两边都不会红。绑死在同一个常量上之后,
    // 「分家」在编译期就不存在了;这条用例守的是这层绑定本身。
    const maxSteps = RESEARCH_TIERS.standard.maxSteps;
    const maxSearches = RESEARCH_TIERS.standard.maxSearches;
    expect(researchTierBudgetInternal(maxSteps, maxSearches)).toBe(
      turnBudgetInternal(llmPricesFor(ottoModelRuntime.billableModelId), ottoLlmMargin(), maxSteps) +
        searchChargeInternal(maxSearches),
    );
  });
});

describe("isOverloadError", () => {
  it("detects a raw 529 status code", () => {
    expect(isOverloadError({ statusCode: 529 })).toBe(true);
  });

  it("detects a realistic AI SDK retry wrapper (529 nested on .lastError)", () => {
    expect(isOverloadError({ name: "AI_RetryError", message: "Failed after 3 attempts. Last error: Overloaded", lastError: { statusCode: 529 } })).toBe(true);
  });

  it("does NOT trust a bare 'overload' text mention without a structured signal (P1)", () => {
    // A non-529 error whose message merely contains the word must NOT trigger failover.
    expect(isOverloadError({ name: "AI_RetryError", message: "Last error: Overloaded" })).toBe(false);
    expect(isOverloadError({ statusCode: 400, message: "request rejected: model overloaded with tokens" })).toBe(false);
  });

  it("detects the overloaded_error response body string", () => {
    expect(isOverloadError({ responseBody: '{"type":"error","error":{"type":"overloaded_error"}}' })).toBe(true);
  });

  it("detects a structured overloaded_error in .data", () => {
    expect(isOverloadError({ data: { error: { type: "overloaded_error" } } })).toBe(true);
  });

  it("unwraps a nested overload on .lastError", () => {
    expect(isOverloadError({ name: "AI_RetryError", message: "Failed", lastError: { statusCode: 529 } })).toBe(true);
  });

  it("unwraps a nested overload on .cause", () => {
    expect(isOverloadError({ message: "wrapped", cause: { responseBody: "overloaded_error" } })).toBe(true);
  });

  it("does NOT treat auth/other errors as overload", () => {
    expect(isOverloadError({ statusCode: 401, message: "Unauthorized" })).toBe(false);
    expect(isOverloadError({ statusCode: 500, message: "Internal" })).toBe(false);
    expect(isOverloadError({ name: "AI_APICallError", message: "Not Found", statusCode: 404 })).toBe(false);
  });

  it("is safe on non-objects", () => {
    expect(isOverloadError(null)).toBe(false);
    expect(isOverloadError(undefined)).toBe(false);
    expect(isOverloadError("Overloaded")).toBe(false); // string, not an error object
  });

  it("does not infinitely recurse on a self-referential cause", () => {
    const e: Record<string, unknown> = { message: "x" };
    e.cause = e;
    expect(isOverloadError(e)).toBe(false);
  });

  it("does not infinitely recurse on a two-object cycle (P2)", () => {
    const a: Record<string, unknown> = { message: "a" };
    const b: Record<string, unknown> = { message: "b" };
    a.cause = b;
    b.cause = a;
    expect(isOverloadError(a)).toBe(false);
  });

  it("checks BOTH lastError and cause, not just lastError (P2)", () => {
    // lastError present but non-overload; the real 529 hides on cause.
    expect(isOverloadError({ lastError: { statusCode: 500 }, cause: { statusCode: 529 } })).toBe(true);
  });
});

// Minimal LanguageModel stub: the wrapper only touches these 6 members.
function stubModel(over: Partial<{ doGenerate: unknown; doStream: unknown }> = {}) {
  return {
    specificationVersion: "v2",
    provider: "anthropic.messages",
    modelId: "stub-model",
    supportedUrls: {},
    doGenerate: vi.fn(async () => ({ tag: "gen" })),
    doStream: vi.fn(async () => ({ tag: "stream" })),
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("withOverloadFailover", () => {
  it("delegates identity members to the primary", () => {
    const primary = stubModel();
    const fallback = stubModel();
    const w = withOverloadFailover(primary, fallback);
    expect(w.specificationVersion).toBe("v2");
    expect(w.provider).toBe("anthropic.messages");
    expect(w.modelId).toBe("stub-model");
  });

  it("uses the primary when it succeeds — fallback is never called", async () => {
    const primary = stubModel();
    const fallback = stubModel();
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doGenerate({} as never)).resolves.toEqual({ tag: "gen" });
    expect(primary.doGenerate).toHaveBeenCalledTimes(1);
    expect(fallback.doGenerate).not.toHaveBeenCalled();
  });

  it("falls back ONLY on a 529 overload (doGenerate)", async () => {
    const primary = stubModel({ doGenerate: vi.fn(async () => { throw { statusCode: 529 }; }) });
    const fallback = stubModel({ doGenerate: vi.fn(async () => ({ tag: "fallback-gen" })) });
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doGenerate({} as never)).resolves.toEqual({ tag: "fallback-gen" });
    expect(primary.doGenerate).toHaveBeenCalledTimes(1);
    expect(fallback.doGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back ONLY on a 529 overload (doStream)", async () => {
    const primary = stubModel({ doStream: vi.fn(async () => { throw { responseBody: "overloaded_error" }; }) });
    const fallback = stubModel({ doStream: vi.fn(async () => ({ tag: "fallback-stream" })) });
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doStream({} as never)).resolves.toEqual({ tag: "fallback-stream" });
    expect(fallback.doStream).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-overload error WITHOUT calling the fallback", async () => {
    const authErr = { statusCode: 401, message: "Unauthorized" };
    const primary = stubModel({ doGenerate: vi.fn(async () => { throw authErr; }) });
    const fallback = stubModel();
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doGenerate({} as never)).rejects.toBe(authErr);
    expect(fallback.doGenerate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt caching (engine spec §2.2 Phase 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Realistic CallOptions shape: leading system message (Otto instructions) + history + tools. */
function callOptions() {
  return {
    prompt: [
      { role: "system", content: "You are Otto." },
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ],
    tools: [
      { type: "function", name: "propose", description: "d", inputSchema: {} },
      { type: "function", name: "generate", description: "d", inputSchema: {} },
      { type: "function", name: "setTitle", description: "d", inputSchema: {} },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Count entries carrying the anthropic ephemeral marker. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cacheMarkers(entries: any[]): number {
  return entries.filter((e) => e?.providerOptions?.anthropic?.cacheControl?.type === "ephemeral").length;
}

const ENV_KEY = "OTTO_PROMPT_CACHE";
let savedEnv: string | undefined;
beforeEach(() => { savedEnv = process.env[ENV_KEY]; delete process.env[ENV_KEY]; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("ottoPromptCacheEnabled (kill switch)", () => {
  it("defaults ON when the env var is unset", () => {
    expect(ottoPromptCacheEnabled()).toBe(true);
  });

  it.each(["0", "false", "off", "FALSE", "Off", " 0 "])("'%s' disables it", (v) => {
    process.env[ENV_KEY] = v;
    expect(ottoPromptCacheEnabled()).toBe(false);
  });

  it.each(["1", "true", "on", "yes", ""])("'%s' keeps it enabled", (v) => {
    process.env[ENV_KEY] = v;
    expect(ottoPromptCacheEnabled()).toBe(true);
  });
});

describe("injectPromptCacheControl", () => {
  it("marks EXACTLY the system + last-tool boundary: one marker on the leading system message, one on the last tool", () => {
    const out = injectPromptCacheControl(callOptions()) as ReturnType<typeof callOptions>;

    // system boundary: exactly one marked message, and it is prompt[0]
    expect(cacheMarkers(out.prompt)).toBe(1);
    expect(out.prompt[0].role).toBe("system");
    expect(out.prompt[0].providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });

    // tools boundary: exactly one marked tool, and it is the LAST one
    expect(cacheMarkers(out.tools)).toBe(1);
    expect(out.tools[2].providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });
    expect(out.tools[0].providerOptions).toBeUndefined();
    expect(out.tools[1].providerOptions).toBeUndefined();
  });

  it("leaves history messages (user/assistant) unmarked — only the constant prefix is cached", () => {
    const out = injectPromptCacheControl(callOptions()) as ReturnType<typeof callOptions>;
    expect(out.prompt[1].providerOptions).toBeUndefined();
    expect(out.prompt[2].providerOptions).toBeUndefined();
  });

  it("does NOT mutate its input (copy-on-write)", () => {
    const options = callOptions();
    const snapshot = JSON.parse(JSON.stringify(options));
    injectPromptCacheControl(options);
    expect(options).toEqual(snapshot);
  });

  it("skips the system marker when the first message is not a system message", () => {
    const options = callOptions();
    options.prompt = options.prompt.slice(1); // no leading system
    const out = injectPromptCacheControl(options) as ReturnType<typeof callOptions>;
    expect(cacheMarkers(out.prompt)).toBe(0);
    expect(cacheMarkers(out.tools)).toBe(1); // tools boundary still marked
  });

  it("skips the tool marker when there are no tools", () => {
    const options = callOptions();
    delete options.tools;
    const out = injectPromptCacheControl(options) as ReturnType<typeof callOptions>;
    expect(out.tools).toBeUndefined();
    expect(cacheMarkers(out.prompt)).toBe(1);
  });

  it("preserves pre-existing providerOptions keys when merging the marker", () => {
    const options = callOptions();
    options.prompt[0] = { ...options.prompt[0], providerOptions: { anthropic: { other: "x" }, someProvider: { y: 1 } } };
    const out = injectPromptCacheControl(options) as ReturnType<typeof callOptions>;
    expect(out.prompt[0].providerOptions.anthropic.other).toBe("x");
    expect(out.prompt[0].providerOptions.someProvider).toEqual({ y: 1 });
    expect(out.prompt[0].providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });
  });
});

describe("withPromptCaching", () => {
  it("delegates identity members to the wrapped model", () => {
    const inner = stubModel();
    const w = withPromptCaching(inner);
    expect(w.specificationVersion).toBe("v2");
    expect(w.provider).toBe("anthropic.messages");
    expect(w.modelId).toBe("stub-model");
  });

  it("ON (default): doGenerate receives transformed params with both markers, injected exactly once", async () => {
    const inner = stubModel();
    const w = withPromptCaching(inner);
    await w.doGenerate(callOptions());
    const passed = inner.doGenerate.mock.calls[0][0];
    expect(cacheMarkers(passed.prompt)).toBe(1);
    expect(cacheMarkers(passed.tools)).toBe(1);
  });

  it("ON (default): doStream receives transformed params with both markers", async () => {
    const inner = stubModel();
    const w = withPromptCaching(inner);
    await w.doStream(callOptions());
    const passed = inner.doStream.mock.calls[0][0];
    expect(cacheMarkers(passed.prompt)).toBe(1);
    expect(cacheMarkers(passed.tools)).toBe(1);
  });

  it.each(["0", "false", "off"])("kill switch '%s': params pass through UNTOUCHED (same reference, no markers)", async (v) => {
    process.env[ENV_KEY] = v;
    const inner = stubModel();
    const w = withPromptCaching(inner);
    const options = callOptions();
    await w.doGenerate(options);
    await w.doStream(options);
    // Bypass = byte-identical request: the very same object, zero markers added.
    expect(inner.doGenerate.mock.calls[0][0]).toBe(options);
    expect(inner.doStream.mock.calls[0][0]).toBe(options);
    expect(cacheMarkers(options.prompt)).toBe(0);
    expect(cacheMarkers(options.tools)).toBe(0);
  });

  it("composes with withOverloadFailover: markers reach the fallback on a 529 (V3)", async () => {
    const primary = stubModel({ doGenerate: vi.fn(async () => { throw { statusCode: 529 }; }) });
    const fallback = stubModel();
    const w = withPromptCaching(withOverloadFailover(primary, fallback));
    await w.doGenerate(callOptions());
    const passedToFallback = fallback.doGenerate.mock.calls[0][0];
    expect(cacheMarkers(passedToFallback.prompt)).toBe(1);
    expect(cacheMarkers(passedToFallback.tools)).toBe(1);
  });
});
