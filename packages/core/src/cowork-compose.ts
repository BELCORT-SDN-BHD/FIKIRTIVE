/**
 * Deterministic $0 prompt composer (OPT-6 P2, spec §4a). A PURE string transform
 * that appends the resolved model-family directive to the client prompt. NO LLM,
 * NO randomness — byte-stable. Runs ONLY at the spend side (coworkGenerate); the
 * card prompt stays directive-free so it can't double-append (the audit's
 * double-append blocker). Idempotent: if the directive is already at the tail
 * (e.g. a stale card already carried it), composing again is a no-op.
 */
export const COMPOSE_SEP = "\n\n";

/** Append `directive` to `prompt` once, clamped to `maxLen`. A missing/blank
 *  directive → the prompt unchanged (unseeded families = no-op). Idempotent on a
 *  prompt that already ends with the directive. */
export function composePrompt(args: { prompt: string; directive?: string; maxLen: number }): string {
  const base = args.prompt;
  const dir = (args.directive ?? "").trim();
  if (!dir) return base; // unseeded family / disabled cell → no-op
  if (base.trimEnd().endsWith(dir)) return base; // already composed → don't double-append
  const composed = `${base}${COMPOSE_SEP}${dir}`;
  return composed.length <= args.maxLen ? composed : composed.slice(0, args.maxLen);
}
