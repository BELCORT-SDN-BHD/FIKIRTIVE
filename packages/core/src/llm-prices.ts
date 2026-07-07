/**
 * LLM token price registry (Task 1.7 Part A+B).
 * Per-token USD prices for the models Otto uses. Unknown models fall back to
 * sonnet pricing — NEVER zero (zero = a metering hole).
 *
 * Part B: OTTO_LLM_MARGIN_DEFAULT is the v1 margin; a per-category admin knob
 * is deferred to OPT-6.
 */

export interface LlmPrices {
  inputPerToken: number;
  outputPerToken: number;
  cachedInputPerToken: number;
  /** Anthropic bills prompt-cache WRITES (cache_creation_input_tokens) at 1.25× input.
   *  Required BEFORE enabling prompt caching — without it the 1.25× write premium is unmetered
   *  (效率工单① 前置, engine spec §2.3). */
  cacheWriteInputPerToken: number;
}

// $/1M ÷ 1e6 = $/token
// Opus 4.8:   $5 in / $25 out / ~$0.50 cached / $6.25 cache-write (1.25×)
// Sonnet 4.6: $3 in / $15 out / ~$0.30 cached / $3.75 cache-write (1.25×)
const TABLE: Record<string, LlmPrices> = {
  "claude-opus-4-8":   { inputPerToken: 5e-6,  outputPerToken: 25e-6, cachedInputPerToken: 0.5e-6, cacheWriteInputPerToken: 6.25e-6 },
  "claude-sonnet-4-6": { inputPerToken: 3e-6,  outputPerToken: 15e-6, cachedInputPerToken: 0.3e-6, cacheWriteInputPerToken: 3.75e-6 },
};

/** Unknown model → sonnet pricing. NEVER returns zero prices. */
const DEFAULT: LlmPrices = TABLE["claude-sonnet-4-6"]!;

/**
 * Resolve LLM prices for a model string.
 * Tries exact match, then substring: "opus" → opus rates, else sonnet rates.
 * This handles both canonical ids ("claude-sonnet-4-6") and provider-prefixed
 * ids ("anthropic/claude-sonnet-4.5") without a zero-price fallthrough.
 */
export function llmPricesFor(model: string): LlmPrices {
  // Exact match (fastest path — Agents SDK uses the canonical id)
  if (TABLE[model]) return TABLE[model]!;
  // Substring match — e.g. "anthropic/claude-opus-4-8" contains "opus"
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return TABLE["claude-opus-4-8"]!;
  // All others (including "sonnet" substrings and complete unknowns) → sonnet
  return DEFAULT;
}

// ── Margin (Part B) ──────────────────────────────────────────────────────────

/** Default markup over raw LLM cost (2.0× = 50% gross margin after the 2026-07-03
 *  costing decision). Overridable per-call (withLlmBudget margin) or via OTTO_LLM_MARGIN env;
 *  the per-category admin-dashboard knob is deferred to OPT-6. v1 source of truth. */
export const OTTO_LLM_MARGIN_DEFAULT = 2.0;

/** Runtime-overridable margin via OTTO_LLM_MARGIN env var (positive finite number).
 *  Falls back to OTTO_LLM_MARGIN_DEFAULT when the env var is absent or invalid. */
export function ottoLlmMargin(): number {
  const v = Number(process.env.OTTO_LLM_MARGIN);
  return Number.isFinite(v) && v > 0 ? v : OTTO_LLM_MARGIN_DEFAULT;
}
