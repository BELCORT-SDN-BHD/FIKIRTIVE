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

/** Otto's model: primary with same-tier 529-failover, adapted for the OpenAI Agents SDK. */
export const ottoModel = aisdk(
  withOverloadFailover(anthropic(OTTO_PRIMARY_MODEL), anthropic(OTTO_FALLBACK_MODEL)),
);
