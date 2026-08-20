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

/**
 * The hard floor under OTTO_LLM_MARGIN: **1.0 = charge exactly what the provider charged us**.
 *
 * Why it exists (钱路审计 P1, 2026-08-18). `ottoLlmMargin()` used to accept ANY positive finite
 * number, and the only thing standing between a typo and selling below cost was that nobody had
 * made the typo yet: `OTTO_LLM_MARGIN=0.5` is a perfectly valid positive finite number, and it
 * would have priced every metered LLM call at HALF the provider's bill — every Otto turn and
 * every research run losing money, silently, with no test and no alarm anywhere in the tree.
 * A markup below 1.0 is never a pricing decision anyone would make on purpose; it is always a
 * configuration mistake, so it is refused rather than honoured.
 *
 * 1.0 is the "never sell below cost" line, NOT the constitutional 45% margin floor. The two are
 * deliberately different guards at different distances: this one is an absolute invariant that
 * holds for any surface at any price, while 45% is a product-level floor the margin gate
 * (scripts/check-margin-floor.mjs + margin-truth.ts) judges per surface — and which, for the
 * research LLM leg, effectively requires this multiplier to be ≥ 1/(1−0.45) ≈ 1.82. Set
 * OTTO_LLM_MARGIN to something between 1.0 and 1.82 and this guard stays quiet while the margin
 * gate goes red naming the surface. That is the intended division of labour: this stops a loss,
 * the gate defends the floor.
 */
export const OTTO_LLM_MARGIN_FLOOR = 1.0;

/**
 * Runtime-overridable margin via OTTO_LLM_MARGIN env var.
 *
 * Accepted only when it is a finite number at or above OTTO_LLM_MARGIN_FLOOR; anything else
 * (absent, unparseable, zero, negative, or below the floor) falls back to OTTO_LLM_MARGIN_DEFAULT.
 * The fallback direction is fail-closed in the money sense — it charges MORE, never less, so a
 * malformed override can never open a hole. The operator is told about it separately: the
 * env-contract boot check (env-contract.ts, `minimum`) names the variable and refuses to start a
 * production process on a below-floor value, so the clamp is a safety net rather than a silence.
 */
export function ottoLlmMargin(): number {
  const v = Number(process.env.OTTO_LLM_MARGIN);
  return Number.isFinite(v) && v >= OTTO_LLM_MARGIN_FLOOR ? v : OTTO_LLM_MARGIN_DEFAULT;
}
