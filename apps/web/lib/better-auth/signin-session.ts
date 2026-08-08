/** #737 — WHICH session creations are actually a SIGN-IN.
 *
 *  `session.create` is NOT a synonym for "someone logged in". Better Auth mints a session as a
 *  side effect of two authenticated actions this app enables, and recording either as
 *  `auth.signin` puts a login in the audit log that never happened:
 *
 *    IMPERSONATION (admin plugin) — `impersonateUser` creates a session that belongs to the
 *      MERCHANT and carries the founder's id in `impersonatedBy`. Recorded as a sign-in it reads
 *      as "the merchant signed in", sitting right next to the founder's own `impersonate.start`
 *      row: the audit would put a customer's name on an action the founder took. That is worse
 *      than a missing row — it is a false one, about someone who was not there. The signal is
 *      structural (it is on the session record itself), not a guess.
 *
 *    /change-password with `revokeOtherSessions` — the endpoint deletes the caller's sessions and
 *      mints ONE replacement so the person who just changed their password stays logged in. The
 *      replacement record carries nothing to tell it apart, so it is identified by the ENDPOINT
 *      Better Auth hands the hook — the same `ctx.path` signal `user.create` already uses to
 *      recognise self-service signup. Framework routing identity, not a heuristic on our side.
 *
 *  Everything else that mints a session in this configuration is a door somebody came through —
 *  `/sign-in/email`, the magic link, the Google callback, and the auto sign-in after email
 *  verification — so every real sign-in still yields exactly one row.
 *
 *  DENY-LIST, DELIBERATELY. An allow-list of sign-in paths would silently DROP a real login the
 *  day a door is added, and a login this table never recorded cannot be recovered; an unlisted
 *  side-effect session is instead visible as a wrong row that can be corrected. The two entries
 *  below are the complete set for the plugins this app enables (magic link, admin, Google,
 *  email+password) as of Better Auth 1.6.20 — verified against its own `createSession` call
 *  sites, not inferred.
 */
export type SessionCreation = { id: string; impersonatedBy?: string | null };
export type SessionCreationContext = { path?: string } | null | undefined;

/** The endpoint that re-issues a session for an ALREADY signed-in person (password change). */
const SESSION_ROTATION_PATH = "/change-password";

/** The session id to attribute a sign-in to, or null when this session creation is not one. */
export function signinSessionId(session: SessionCreation, ctx?: SessionCreationContext): string | null {
  if (session.impersonatedBy) return null;
  if (ctx?.path === SESSION_ROTATION_PATH) return null;
  return session.id;
}
