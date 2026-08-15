/**
 * #940 — turns Better Auth's raw verification URL (`{baseURL}/verify-email?token=...` under
 * `/api/better-auth`) into a link that points at THIS app's own `/verify-email` landing page
 * first. That raw endpoint is a bare API route with no page behind it, so a merchant who
 * clicked the old link saw a blank browser tab for as long as token verification + auto
 * sign-in + workspace provisioning took server-side (measured ~11s) — the landing page exists
 * to paint a "Signing you in…" state on the very first frame instead.
 *
 * This function makes no decision about the token: `token` and `callbackURL` are forwarded to
 * the real endpoint byte for byte, via an unmodified query string. It only changes which path
 * the link visually lands on first.
 */
export function toVerifyLandingUrl(betterAuthVerifyUrl: string): string {
  const real = new URL(betterAuthVerifyUrl);
  const landing = new URL("/verify-email", real.origin);
  landing.search = real.search;
  return landing.toString();
}
