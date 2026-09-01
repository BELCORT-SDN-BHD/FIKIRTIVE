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

/**
 * Default markup over raw LLM cost — **2.06×** (Founder 2026-09-01 裁决,S2 批准后同日追加:
 * 初裁 2.05,改到 2.06 是为了把**国际卡带**一并清线;docs/specs/money-engine.md §7.0 拍板 1、
 * §7.2「研究档 2.06× 落地」)。前值 2.0× 自 2026-07-03 起用了两个月。
 *
 * 三个数字,三个口径,别混(§7.0 量尺口径备案):
 *   - **面值毛利 51.46%** = 1 − 1/2.06。商家账面上我们赚这么多。
 *   - **本地卡带最坏实收 45.73%** = 面值 × 最坏包实收系数(0.8944:最深包折扣 × 实测 Stripe
 *     手续费 × 汇率钉点 4.5)。宪法 5 的 45% 地板按这个口径量,2.06 是**刚清线**的费率
 *     (恰好守线的最小值 2.033)。
 *   - **国际卡带 45.16%** = 再叠 Stripe 国际卡 +1%(系数 0.8852,恰好守线最小值 2.054)。
 *     这一带只入注记不入闸(备案见 cost-pins.ts 的国际卡加成钉点 + §7.9)。
 *
 * 2.0× 之所以要动:它的最坏实收是 44.10%,**破线**。破的是压力口径(假设马币贬到钉点 4.5),
 * 不是现金已损 —— 按参考现汇 2.0× 实收 49.53%。但闸量的就是压力口径,所以费率必须抬。
 *
 * Overridable per-call (withLlmBudget margin) 或 OTTO_LLM_MARGIN 环境变量,**只能往上**
 * (见下面的 FLOOR);per-category admin-dashboard knob 仍 deferred to OPT-6。v1 source of truth.
 */
export const OTTO_LLM_MARGIN_DEFAULT = 2.06;

/**
 * The hard floor under OTTO_LLM_MARGIN: **2.06 = the ruled rate itself**(#1047 生产值盲区关闭,
 * MONEY-A2;Founder 2026-09-01,docs/specs/money-engine.md §7.0 拍板 1 + §7.2)。
 *
 * Why it exists (钱路审计 P1, 2026-08-18). `ottoLlmMargin()` used to accept ANY positive finite
 * number, and the only thing standing between a typo and selling below cost was that nobody had
 * made the typo yet: `OTTO_LLM_MARGIN=0.5` is a perfectly valid positive finite number, and it
 * would have priced every metered LLM call at HALF the provider's bill — every Otto turn and
 * every research run losing money, silently, with no test and no alarm anywhere in the tree.
 * A markup below the ruled rate is never a pricing decision anyone would make on purpose; it is
 * always a configuration mistake, so it is refused rather than honoured.
 *
 * **为什么从 1.0 抬到 2.06(#1047 关的那个盲区)**:旧地板 1.0 只挡「亏着卖」,而毛利闸量的是
 * **生产进程实际跑的那个值**。`OTTO_LLM_MARGIN=1.5` 在旧配置里一路绿灯:钳位放行(1.5 ≥ 1.0)、
 * 开机检查放行(1.5 ≥ 1.0)、而毛利闸在 CI 里读的是**代码默认值** 2.0 —— 于是生产上每一次深研
 * 都按 33% 面值毛利在卖,压力实收 −25%,仓库里没有任何一处会响。地板与裁决值合一之后这条路
 * 物理上没了:任何低于 2.06 的覆盖值都被钳回 2.06(方向永远多收),而覆盖值本身仍会在开机时
 * 被点名(env-contract 的 `minimum`)。
 *
 * 与宪法 5 的分工没变,只是距离变了:这条是绝对不变量(任何面、任何价都成立),45% 是毛利闸
 * (scripts/check-margin-floor.mjs + margin-truth.ts)按面判的产品地板 —— 而对深研 LLM 这条腿,
 * 45% 地板按**最坏实收口径**换算过来要求的正是 ≥2.033,2.06 是 Founder 在它之上取的裁决值。
 * 环境覆盖**只能调高不能调低**:调高是定价自由,调低是配置事故。
 */
export const OTTO_LLM_MARGIN_FLOOR = 2.06;

/**
 * Runtime-overridable margin via OTTO_LLM_MARGIN env var.
 *
 * Accepted only when it is a finite number at or above OTTO_LLM_MARGIN_FLOOR; anything else
 * (absent, unparseable, zero, negative, or below the floor) falls back to OTTO_LLM_MARGIN_DEFAULT.
 * FLOOR 与 DEFAULT 今天是同一个数(2.06),所以这条钳位的效果就是一句话:**任何低于 2.06 的
 * 覆盖值都被收紧回 2.06**,不静默按低值跑(MONEY-A2)。
 * The fallback direction is fail-closed in the money sense — it charges MORE, never less, so a
 * malformed override can never open a hole. The operator is told about it separately: the
 * env-contract boot check (env-contract.ts, `minimum`) names the variable and refuses to start a
 * production process on a below-floor value, so the clamp is a safety net rather than a silence.
 */
export function ottoLlmMargin(): number {
  const v = Number(process.env.OTTO_LLM_MARGIN);
  return Number.isFinite(v) && v >= OTTO_LLM_MARGIN_FLOOR ? v : OTTO_LLM_MARGIN_DEFAULT;
}
