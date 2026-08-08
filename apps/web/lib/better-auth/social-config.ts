/**
 * Which social sign-in doors this deployment actually has (#681).
 *
 * The login page used to offer "Continue with Google" unconditionally. On an environment
 * where the Google credentials are missing, the button promised a road that did not exist:
 * clicking it produced a 500 and a generic "Sign-in failed. Try again.", so the merchant
 * blamed themselves and retried. Classic "what we say" ≠ "what we do".
 *
 * The cure is that both halves read the SAME fact, on the SERVER: the provider is only
 * registered when it is configured, and the button is only rendered when the provider is
 * registered. A client-side `NEXT_PUBLIC_*` guess would be a second source of truth and
 * could drift back out of step with the server that has to honour the click.
 *
 * Deliberately NOT `server-only`: this module holds one pure predicate over `process.env`
 * and is imported by the auth config and by the login server component. It must never be
 * imported from a client component — the login page passes the answer down as a prop.
 *
 * Nothing here loosens a guard. An absent or blank credential means the door is CLOSED;
 * every allowlist / session gate downstream is untouched.
 */

/** Configured means present AND non-blank — `GOOGLE_CLIENT_ID=""` is not configured. */
function configured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * True only when BOTH Google OAuth credentials are set. Half a credential pair cannot
 * complete a sign-in, so it counts as unconfigured rather than as "nearly working".
 */
export function googleSignInConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return configured(env.GOOGLE_CLIENT_ID) && configured(env.GOOGLE_CLIENT_SECRET);
}
