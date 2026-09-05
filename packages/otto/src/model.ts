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

/**
 * ENGINE-A6 —— 滚动摘要那次**折叠**跑在哪个型号上(规格 §7.2④:「摘要本身是一次便宜的小调用」)。
 *
 * 从前这个决定不存在:`runtime.ts` 的 `foldRollingSummary` 直接取 manifest 的主绑定,谁都改不到。
 * 现在它是这里的一个常量,manifest 把它作为 `summaryBinding` 带下去,调用处一行型号都不写死。
 *
 * **Founder 2026-09-05 裁决④**:「折叠摘要换 Haiku,按 Haiku 实价计入商家账单」。规格 §5 登记的
 * 那两个决定因此都有了答案:
 *   (1) 价目表加了 `claude-haiku-4-5-20251001` 一行(四个官方单价,来源写在那一行的注释里);
 *   (2) 折叠那条腿**按它自己跑的型号计价** —— 它的 usage 单独记成一条 `LlmBillingLeg`,本轮
 *       总额 = 主腿按 Sonnet 价 + 折叠腿按 Haiku 价(meter.ts 不变量 #13)。仍然是一次 reserve、
 *       一次 settle、一个 refId;毛利加成照旧套在两腿之和上。
 * 两端硬顶(输入 24,000 字符、输出 400 token,见 runtime.ts)不变 —— 换小型号是省价,不是放宽量。
 */
export const OTTO_SUMMARY_MODEL = "claude-haiku-4-5-20251001";

/**
 * 折叠腿的 529 同档接管型号 —— **刻意等于折叠型号自己**。
 *
 * 主轮的接管(OTTO_FALLBACK_MODEL = sonnet-4-5)之所以安全,是因为它与主力**同价**:跑哪个都
 * 按同一张价目结算。折叠腿换成 Haiku 之后这条不再成立 —— 用 sonnet 接管一次 haiku 的折叠,
 * 就是跑贵的型号按便宜的价收,差额静默由我们吃(ENGINE-A5 要消灭的正是这一族)。折叠本身
 * **从不 load-bearing**(`foldRollingSummary` 吞掉任何抛错,这一轮照常返回),所以「不跨档接管」
 * 的全部代价只是偶尔少折一次摘要 —— 比一条按错价的账便宜得多。
 */
export const OTTO_SUMMARY_FALLBACK_MODEL = OTTO_SUMMARY_MODEL;

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
 * Pure transform: mark Otto's prompt prefix with Anthropic ephemeral cache_control.
 * Exactly two breakpoints per request (limit is 4):
 *
 *  1. The LAST function tool — caches the tool-schema block (tools precede system in
 *     Anthropic's request layout, so this breakpoint stands even if the system text
 *     changes). This one IS constant across turns: the toolset is composed once per
 *     process (`createOttoRuntime`) and never varies per request.
 *  2. The LEADING system message — a breakpoint here caches everything up to and
 *     including it, i.e. tools + system. Within ONE turn, steps 2..N always read it at
 *     the cached rate (the same assembled text goes out every step).
 *
 * ⑤⑥⑦尾巴轮按现码改口(⑥段登记 P2-5,规格 §5)。这一段原本写着「Otto 的**恒定**前缀」,
 * 并按「system 块 ~4.7k tokens、前缀共 ~12.4k、5 分钟 TTL 内跨轮按缓存价读」推理。⑥段用
 * 文件柜换掉单体说明书之后,那已经不是实话:
 *
 *  · 断点 2 **不再跨轮恒定** —— 每一轮的说明书是现装的(`instructions.ts` 的
 *    `assembleOttoInstructions`:常驻薄层 ＋ 全部书脊标签 ＋ 这一轮对上标签的那几份全文)。
 *    商家换个话题拉进一份新柜文,那一轮就付一次 cache write 而不是 cache read。
 *    (恢复轮是例外:它整柜装载,system 文本回到那份恒定的全柜稿。)
 *  · 装载集**不单调**:④段之后,匹配输入是这一轮此刻真正带着的上下文(裁剪后的历史 ＋ 滚动
 *    摘要 ＋ 本轮刚裁掉的那几轮),而摘要每折一次就整段重写 —— 不再被提起的话题当轮就掉出去,
 *    下次再提又装回来。所以「一场对话最多付 12 次 cache write」那条上界不成立。
 *  · 上面那三个 token 数是单体时代的量,⑥段之后**没有重新测过**,已从正文删去;缓存的净账
 *    (省下的 cache read 减去多付的 cache write)同样**没有数** —— 装载集的实际抖动频率没测,
 *    §7.7 那句「实测峰值约 $0.17/轮」又是按旧的恒定前缀假设算的。两个数都要等一次真跑
 *    (与 ENGINE-A1 基线同一把钥匙、同一趟)。
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

/** One model binding: prompt-cache marking over same-tier 529-failover, adapted for the OpenAI
 *  Agents SDK. Written once so the fold's binding cannot drift into a second wrapper stack. */
const ottoBindingFor = (modelId: string, fallbackId: string) =>
  aisdk(withPromptCaching(withOverloadFailover(anthropic(modelId), anthropic(fallbackId))));

/** Otto's model: prompt-cache marking over same-tier 529-failover, adapted for the OpenAI Agents SDK. */
export const ottoModel = ottoBindingFor(OTTO_PRIMARY_MODEL, OTTO_FALLBACK_MODEL);

/** ENGINE-A6 —— 折叠那次调用的绑定(型号见 OTTO_SUMMARY_MODEL,接管型号见 OTTO_SUMMARY_FALLBACK_MODEL)。 */
export const ottoSummaryModel = ottoBindingFor(OTTO_SUMMARY_MODEL, OTTO_SUMMARY_FALLBACK_MODEL);

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
    // 折叠也真的会被跑到,所以它也必须有价 —— 换成一个没登记的小型号,开机就被拒。
    ["OTTO_SUMMARY_MODEL", OTTO_SUMMARY_MODEL],
    // 折叠腿的接管型号今天等于折叠型号本身,但它是**另一个常量**:有人把它指向别处时,
    // 「那个型号有没有价」必须照样在开机时被问一次。
    ["OTTO_SUMMARY_FALLBACK_MODEL", OTTO_SUMMARY_FALLBACK_MODEL],
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
  // ENGINE-A6:折叠那条腿的绑定也在 manifest 上,`foldRollingSummary` 从这里取。
  summaryBinding: ottoSummaryModel,
  // ENGINE-A6 × Founder 2026-09-05 裁决④:折叠腿**按自己的型号计价**。绑定与计价 id 是同一个
  // 决定的两面,所以它们并排放在 manifest 上,而不是让计费处去猜绑定跑的是哪个型号。
  summaryBillableModelId: OTTO_SUMMARY_MODEL,
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
