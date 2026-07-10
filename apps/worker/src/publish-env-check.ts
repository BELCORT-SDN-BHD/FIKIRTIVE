/**
 * L1 publish-chain env contract (spec §四) — a fail-SOFT boot check.
 *
 * The publish chain needs three things wired together: MEDIA_PROXY_SECRET (worker signs media
 * tokens; the web route verifies them with the SAME value), TOKEN_ENCRYPTION_KEY (worker decrypts
 * the stored Meta page token), and a public base URL Meta can fetch media from (PUBLIC_BASE_URL,
 * or BETTER_AUTH_URL as the fallback publish.ts already uses).
 *
 * Two deliberate design choices:
 *   1. NEVER crash the worker over this. The chain is inert until Meta App Review (scanDuePublishPosts
 *      is canPublish-gated → returns [] → nothing publishes), so a fully-unset chain is the NORMAL
 *      pre-launch state. Exiting here would take generation/render/caption/research DOWN with it — a
 *      self-inflicted outage. So we only ever warn.
 *   2. Warn ONLY on a PARTIAL config. All-set = ready; all-unset = intentionally inert (no noise).
 *      Some-set-some-missing is the dangerous middle: someone TRIED to enable publishing but missed a
 *      var, so every publish would silently fail closed as an opaque NEEDS_ATTENTION at run time.
 *      Surfacing that at BOOT (by NAME, never the value) turns a silent stall into an obvious fix.
 */
export type PublishChainEnv = {
  MEDIA_PROXY_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  PUBLIC_BASE_URL?: string;
  BETTER_AUTH_URL?: string;
};

/** Returns a boot warning string when the publish chain is PARTIALLY configured, or null when it is
 *  fully configured OR fully absent. The message names the missing/present VARIABLES only — never a
 *  secret value. */
export function publishChainWarning(env: PublishChainEnv): string | null {
  const parts: Record<string, boolean> = {
    MEDIA_PROXY_SECRET: !!env.MEDIA_PROXY_SECRET,
    TOKEN_ENCRYPTION_KEY: !!env.TOKEN_ENCRYPTION_KEY,
    // publish.ts uses PUBLIC_BASE_URL || BETTER_AUTH_URL — treat either as "the base is set".
    PUBLIC_BASE_URL: !!(env.PUBLIC_BASE_URL || env.BETTER_AUTH_URL),
  };
  const present = Object.keys(parts).filter((k) => parts[k]);
  const missing = Object.keys(parts).filter((k) => !parts[k]);
  if (present.length === 0 || missing.length === 0) return null; // all-absent (inert) or all-present (ready)
  return (
    `[worker] L1 publish chain is PARTIALLY configured — publishing will fail closed. ` +
    `present=[${present.join(", ")}] missing=[${missing.join(", ")}]. ` +
    `Set the missing var(s) (see .env.example) so web+worker share MEDIA_PROXY_SECRET/TOKEN_ENCRYPTION_KEY, ` +
    `or unset all to keep the chain inert.`
  );
}
