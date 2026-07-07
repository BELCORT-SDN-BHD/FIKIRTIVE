import { aisdk } from "@openai/agents-extensions/ai-sdk"; // SUBPATH, not the package root
import { anthropic } from "@ai-sdk/anthropic";

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

/** Primary model. Used again automatically once Anthropic capacity recovers (failover is per-call, not sticky). */
export const OTTO_PRIMARY_MODEL = "claude-sonnet-4-6";

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
