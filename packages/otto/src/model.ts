import { aisdk } from "@openai/agents-extensions/ai-sdk"; // SUBPATH, not the package root
import { anthropic } from "@ai-sdk/anthropic";
import { llmPricesFor, llmPricesOrNull, OTTO_BILLABLE_MODEL_ID, PRICED_MODEL_IDS } from "@fikirtive/core";
import { mapOttoUsage } from "./meter.js";
import type { OttoModelRuntime } from "./runtime.js";

/**
 * Otto's model with same-tier overload failover.
 *
 * Anthropic occasionally returns 529 "Overloaded" for a specific model when that model's
 * capacity is saturated, while sibling models stay healthy. Without failover, every Otto turn
 * throws and the user sees "Couldn't reach Otto". This wraps the model so a 529 — and ONLY a
 * 529 — transparently retries on a same-tier sibling. The wrapper sits at the LanguageModel
 * layer, so it is invisible to the Agent and to RunState: fresh-turn, approve, and worker-resume
 * paths are all covered without touching the run() call sites.
 */

/** Primary model. Used again automatically once Anthropic capacity recovers (failover is per-call, not sticky).
 *  值取自 `@fikirtive/core` 的 OTTO_BILLABLE_MODEL_ID —— 计价型号与跑的型号是同一件事,
 *  一份真相(ENGINE-A5;从前 propose-research.helpers.ts 抄了第二份裸字符串)。 */
export const OTTO_PRIMARY_MODEL = OTTO_BILLABLE_MODEL_ID;

/** Same-tier sibling used ONLY on a 529 overload of the primary. Same pricing tier (sonnet) — see OTTO_DEFAULT_MODEL. */
export const OTTO_FALLBACK_MODEL = "claude-sonnet-4-5";

/**
 * Model string used for credit price lookup (withLlmBudget). Failover never leaves the sonnet
 * tier, so this stays accurate even when a turn actually ran on OTTO_FALLBACK_MODEL.
 */
export const OTTO_DEFAULT_MODEL = OTTO_PRIMARY_MODEL;

type LanguageModel = ReturnType<typeof anthropic>;

/**
 * True when `err` is Anthropic's 529 "Overloaded" capacity error, at any wrapping depth.
 *
 * Strictly STRUCTURED — never a generic text match. A 400/401/404 or any non-529 error
 * that merely mentions "overload" must NOT trigger failover (that would mask a real primary
 * failure whenever the fallback happens to succeed). The only signals trusted are: HTTP 529,
 * Anthropic's exact `overloaded_error` type (parsed `.data` or raw `.responseBody` token),
 * and the same recursively through an AI SDK retry wrapper's `.lastError`/`.cause`.
 *
 * `seen` guards against cyclic error graphs (a.cause = b; b.cause = a) — without it an
 * arbitrary thrown value could recurse to a stack overflow.
 */
export function isOverloadError(err: unknown, seen: Set<unknown> = new Set()): boolean {
  if (!err || typeof err !== "object" || seen.has(err)) return false;
  seen.add(err);
  const e = err as Record<string, unknown>;
  if (e.statusCode === 529) return true;
  const data = e.data as { error?: { type?: unknown } } | undefined;
  if (data?.error?.type === "overloaded_error") return true;
  if (typeof e.responseBody === "string" && e.responseBody.includes("overloaded_error")) return true;
  // Unwrap wrapped errors (AI SDK RetryError nests the underlying 529 here) — check BOTH.
  return isOverloadError(e.lastError, seen) || isOverloadError(e.cause, seen);
}

/**
 * Wrap two same-shape models so calls hit `primary`, transparently falling back to `fallback`
 * ONLY on a 529 overload. Any other error propagates unchanged (a real failure must not be hidden).
 */
export function withOverloadFailover(primary: LanguageModel, fallback: LanguageModel): LanguageModel {
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    async doGenerate(options: Parameters<LanguageModel["doGenerate"]>[0]) {
      try {
        return await primary.doGenerate(options);
      } catch (e) {
        if (isOverloadError(e)) return await fallback.doGenerate(options);
        throw e;
      }
    },
    async doStream(options: Parameters<LanguageModel["doStream"]>[0]) {
      try {
        return await primary.doStream(options);
      } catch (e) {
        if (isOverloadError(e)) return await fallback.doStream(options);
        throw e;
      }
    },
  };
}

// ── Prompt caching (engine spec §2.2, injection point B) ────────────────────────────────────
//
// The @openai/agents aisdk adapter builds the system message as a bare
// `{ role: "system", content: instructions }` and tools without providerOptions, so the
// standard @ai-sdk/anthropic per-message providerOptions channel does NOT flow through from
// the Agent config (verified against @openai/agents-extensions@0.11.8). Instead we inject at
// the LanguageModel layer — the same layer withOverloadFailover already wraps — which is
// invisible to the Agent and to RunState: fresh-turn, approve, and worker-resume paths are
// all covered without touching the run() call sites.

type CallOptions = Parameters<LanguageModel["doGenerate"]>[0];

/** Anthropic ephemeral cache marker, read by @ai-sdk/anthropic's CacheControlValidator from
 *  `providerOptions.anthropic.cacheControl` on system messages and function tools. */
const EPHEMERAL_CACHE_CONTROL = { type: "ephemeral" } as const;

/**
 * Kill switch (engine spec §2.8): OTTO_PROMPT_CACHE — default ON.
 * "0" / "false" / "off" (case-insensitive) bypasses the caching middleware entirely, making
 * the request byte-identical to pre-caching behavior. Read per-call so a redeploy with the
 * env flag flipped takes effect without code changes.
 */
export function ottoPromptCacheEnabled(): boolean {
  const v = (process.env.OTTO_PROMPT_CACHE ?? "").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * Pure transform: mark Otto's CONSTANT prompt prefix with Anthropic ephemeral cache_control.
 * Exactly two breakpoints per request (limit is 4):
 *
 *  1. The LAST function tool — caches the ~7.7k-token tool-schema block (tools precede
 *     system in Anthropic's request layout, so this breakpoint stands even if the system
 *     text ever changes).
 *  2. The LEADING system message (Otto's inlined instructions, ~4.7k tokens) — a breakpoint
 *     here caches everything up to and including it, i.e. tools + system: the full ~12.4k
 *     constant prefix. Steps 2..N of a turn (and turns within Anthropic's 5-min TTL) then
 *     read the prefix at the cached rate.
 *
 * Per-turn conversation history is deliberately NOT marked (engine spec §三点五·3).
 * Never mutates its input: options, prompt, and tools arrays are copied on write.
 */
export function injectPromptCacheControl(options: CallOptions): CallOptions {
  const out: CallOptions = { ...options };

  if (Array.isArray(out.tools) && out.tools.length > 0) {
    const last = out.tools[out.tools.length - 1]!;
    if (last.type === "function") {
      const tools = out.tools.slice();
      tools[tools.length - 1] = {
        ...last,
        providerOptions: {
          ...last.providerOptions,
          anthropic: { ...last.providerOptions?.anthropic, cacheControl: EPHEMERAL_CACHE_CONTROL },
        },
      };
      out.tools = tools;
    }
  }

  const first = out.prompt[0];
  if (first && first.role === "system") {
    const prompt = out.prompt.slice();
    prompt[0] = {
      ...first,
      providerOptions: {
        ...first.providerOptions,
        anthropic: { ...first.providerOptions?.anthropic, cacheControl: EPHEMERAL_CACHE_CONTROL },
      },
    };
    out.prompt = prompt;
  }

  return out;
}

/**
 * LanguageModel middleware: transformParams-style cache_control injection on every
 * doGenerate/doStream call. Wraps OUTSIDE withOverloadFailover so a single transform covers
 * both the primary and the 529-fallback model (both are sonnet-tier; caching markers are
 * valid on both, and price lookup stays OTTO_DEFAULT_MODEL either way).
 * When the kill switch is off, options pass through UNTOUCHED (same reference).
 */
export function withPromptCaching(model: LanguageModel): LanguageModel {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(options: CallOptions) {
      return model.doGenerate(ottoPromptCacheEnabled() ? injectPromptCacheControl(options) : options);
    },
    async doStream(options: CallOptions) {
      return model.doStream(ottoPromptCacheEnabled() ? injectPromptCacheControl(options) : options);
    },
  };
}

/** Otto's model: prompt-cache marking over same-tier 529-failover, adapted for the OpenAI Agents SDK. */
export const ottoModel = aisdk(
  withPromptCaching(
    withOverloadFailover(anthropic(OTTO_PRIMARY_MODEL), anthropic(OTTO_FALLBACK_MODEL)),
  ),
);

// ── The production atomic model-runtime manifest (engine spec §6.2, PH1-A1) ─────────────────
//
// Model binding, billable model id, resolved model policy, usage mapper, cache capabilities
// and pricing travel as ONE frozen value. Every production entry's withLlmBudget parameters
// derive from THIS manifest (runtime.ts ottoBudgetArgsFor) — no entry holds an independent
// model or price constant. Frozen: nothing at runtime can flip the billable model or swap
// the binding (fixture/CLI runtimes are separate TEST compositions, never this object).
/**
 * ENGINE-A5 —— **manifest 组合期查价:任一型号没价就拒绝启动。**
 *
 * 这个 manifest 是模块加载期的冻结常量,所以在它构造之前抛错就是「进程起不来」:web 与
 * worker 都 import 得到 otto,谁都躲不过。查的是 manifest 真的会用到的三个 id —— 主力、
 * 529 同档接管的备份、以及计价用的那一个。
 *
 * 为什么组合期和开机检查(env-contract 的「型号必须已定价」)两处都要:开机检查是**说给
 * 运维听的**那一半(点名、给出路、warn 免疫),这里是**物理上拦住**的那一半 —— 换型号的
 * 人改的是这个文件,错误必须长在他手边,而不是等某次生产开机才出现。
 *
 * 导出成函数只为可测:默认参数就是生产的三个 id,测试传一个假 id 来演示它真的会抛。
 */
export function assertOttoModelsPriced(
  ids: readonly (readonly [constant: string, id: string])[] = [
    ["OTTO_PRIMARY_MODEL", OTTO_PRIMARY_MODEL],
    ["OTTO_FALLBACK_MODEL", OTTO_FALLBACK_MODEL],
    ["OTTO_DEFAULT_MODEL", OTTO_DEFAULT_MODEL],
  ],
): void {
  for (const [constant, id] of ids) {
    if (llmPricesOrNull(id) === null) {
      throw new Error(
        `Otto refuses to start: ${constant} = "${id}" has no entry in the LLM price table ` +
          `— 未定价的型号一律拒绝:把它加进价目表(packages/core/src/llm-prices.ts 的 TABLE),` +
          `或改回已定价型号(priced today: ${PRICED_MODEL_IDS.join(", ")})。`,
      );
    }
  }
}

assertOttoModelsPriced();

export const ottoModelRuntime: OttoModelRuntime = Object.freeze({
  binding: ottoModel,
  billableModelId: OTTO_DEFAULT_MODEL,
  resolvedModelPolicy: Object.freeze({
    primaryModelId: OTTO_PRIMARY_MODEL,
    fallbackModelId: OTTO_FALLBACK_MODEL,
    failover: "same-tier-529-only" as const,
  }),
  mapUsage: mapOttoUsage,
  cacheCapabilities: Object.freeze({
    // withPromptCaching marks the constant prefix (tools + system) with ephemeral
    // cache_control; kill switch OTTO_PROMPT_CACHE (read per-call in model.ts above).
    promptCache: true,
  }),
  pricing: llmPricesFor,
});
