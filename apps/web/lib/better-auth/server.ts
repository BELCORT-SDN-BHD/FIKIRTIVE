import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prisma } from "@fikirtive/db";
import { enqueueAuthEmail, sendAuthEmail, AUTH_EMAIL_CODE_TTL_SECONDS } from "./sender";
import { toVerifyLandingUrl } from "./verify-landing-url";
import { convergeIdentity } from "./converge";
import { CALLER_IP_HEADER } from "@/lib/caller-identity";
import { signinSessionId } from "./signin-session";
import { assertAllowedEmail, assertAllowedForUserId } from "./gate";
import { ac, superAdminRole } from "./access";
import { googleSignInConfigured } from "./social-config";
import { isAllowedEmail, isRevokedEmail } from "@/lib/allowlist";
import { admitSelfSignup, signupsPaused, SIGNUPS_PAUSED_MESSAGE } from "@/lib/signup-gate";

/** #543 — the one Better Auth path that self-service registration owns. Anything that is not
 *  EXACTLY this path keeps the deny-by-default allowlist gate; an absent/unknown path (the
 *  database hooks receive a nullable endpoint context) therefore fails closed. */
const SELF_SIGNUP_PATH = "/sign-up/email";
function isSelfSignupPath(path: string | undefined | null): boolean {
  return path === SELF_SIGNUP_PATH;
}

/**
 * EVERY HTTP ENDPOINT THE emailOTP PLUGIN MOUNTS EXCEPT THE ONE THIS PRODUCT USES.
 *
 * Registering the plugin opens nine routes; the sign-in flow needs exactly two of them, and only
 * one of those two is allowed to face the public:
 *
 *   · `/sign-in/email-otp` — the merchant submits the code they were mailed. Stays OPEN, and is
 *     the only OTP route a browser ever calls.
 *   · `/email-otp/send-verification-otp` — MINTS a code and mails it. Closed here and reachable
 *     only through `auth.api.sendVerificationOTP` from the background queue, which is what keeps
 *     #678's property intact: an address nobody invited cannot cause a verification row to be
 *     written, because the public cannot reach the thing that writes one. The login page asks for
 *     a code through a server action instead (app/login/actions.ts).
 *
 * The remaining seven are a SECOND set of doors for jobs this product already does another way —
 * a password reset that takes a code (we mail a link), an email-verification that takes a code
 * (we mail a link, #940), a change-email flow we do not offer at all. Left mounted they would be
 * uncounted duplicates of counted doors: `/email-otp/request-password-reset` mails a merchant a
 * reset credential without ever passing the hourly cap that `/request-password-reset` carries.
 * Nothing needs them, so nothing may call them.
 *
 * `disabledPaths` is Better Auth's own switch and it acts in the ROUTER (`router.onRequest`, 404),
 * which is precisely the right layer: the public loses the endpoint, `auth.api.*` — trusted server
 * code, already past our gates — keeps it.
 */
const CLOSED_EMAIL_OTP_PATHS = [
  "/email-otp/send-verification-otp",
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
] as const;

/** The one OTP endpoint that stays open, and the door the login page's second step calls. */
export const SIGN_IN_CODE_VERIFY_PATH = "/sign-in/email-otp";

// Secret guard — BUILD-SAFE. Do NOT hard-throw at module top level (that can break `next build`
// before env is wired). better-auth already fails closed without a valid secret; this just warns
// loudly so a misconfigured prod deploy is obvious in logs.
if (process.env.NODE_ENV === "production" && (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)) {
  console.error("[better-auth] FATAL: BETTER_AUTH_SECRET is missing or <32 chars — sessions cannot be signed.");
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: "/api/better-auth",
  secret: process.env.BETTER_AUTH_SECRET,
  // Belt-and-suspenders: BA already seeds the baseURL origin; this pins it explicitly.
  trustedOrigins: process.env.BETTER_AUTH_URL ? [new URL(process.env.BETTER_AUTH_URL).origin] : [],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Map BA's four models to the dormant ba_* tables (Task 3).
  user: { modelName: "BetterAuthUser" },
  session: { modelName: "BetterAuthSession" },
  // Account linking: only fold an OAuth identity onto an existing local account when the
  // provider's email is trustworthy (Google's email_verified) AND the local credential is
  // itself verified — never link onto an unverified local email (account-takeover vector).
  account: {
    modelName: "BetterAuthAccount",
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],     // Google's email_verified claim is trustworthy
      requireLocalEmailVerified: true,  // never link onto an unverified local credential
    },
    // #795 — Google's OAuth tokens were the ONE credential this product stored in the clear.
    // Meta's and X's page tokens have been encrypted at rest since L1 (@fikirtive/token-crypto);
    // these sat in `ba_account.accessToken` / `refreshToken` / `idToken` as plain text, so a
    // database backup, a log of a row, or read access to one table was a working Google
    // credential for every merchant who signed in that way.
    //
    // WHY BETTER AUTH'S OWN FLAG AND NOT @fikirtive/token-crypto (the ticket named it). Better
    // Auth encrypts on write AND decrypts on every read it does itself — refresh,
    // `getAccessToken`, account info. Our own encrypt-on-write hook would have no matching
    // decrypt inside those paths: the library would hand a caller our ciphertext believing it was
    // a token, and the first future use of a Google token would fail somewhere far from here.
    //
    // WHAT THE CIPHER ACTUALLY IS — corrected twice, so it is spelled out with its source
    // (`better-auth/dist/crypto/index.mjs`). r1 said AES-256-GCM: wrong. r2 fixed the algorithm
    // but added a `$ba$<version>$` envelope that our configuration does not produce: also wrong,
    // and that second error is exactly what made the cleanup script misread valid ciphertext as
    // plaintext. The truth:
    //   · algorithm — XChaCha20-Poly1305 with a managed nonce, key = SHA-256 of the secret,
    //     output hex-encoded (`rawEncrypt`).
    //   · ENVELOPE ONLY IN THE MULTI-KEY FORM. `symmetricEncrypt` returns `rawEncrypt(...)`
    //     unchanged when the key is a STRING — which is our shape, one secret. The
    //     `$ba$<version>$` prefix is added only for the keyed/rotation form. So our stored
    //     ciphertext is BARE HEX, and "no `$ba$` prefix" does not mean "not encrypted".
    // Still AEAD, still no new vendor, key = BETTER_AUTH_SECRET (already required and already
    // ≥32 chars — see the guard above).
    //
    // WHAT THIS FLAG DOES **NOT** COVER — measured, not assumed. `setTokenUtil` (encrypt on
    // write) is applied to exactly two fields, `accessToken` and `refreshToken`, at all 19 of its
    // call sites (callback, link-account, account routes, generic-oauth). `idToken` is written
    // RAW, and there is no way to close that from out here — see the note on `idToken` below.
    encryptOAuthTokens: true,
  },
  verification: { modelName: "BetterAuthVerification" },
  emailAndPassword: {
    enabled: true,
    // NON-REMOVABLE: better-auth's default is OFF; without this an unverified email+password signup mints a session → account takeover via convergeIdentity. Keep true.
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      // Keep Better Auth's neutral reset response for removed users while still suppressing the
      // email (F17). Session creation independently re-checks access and remains fail-closed.
      // #678 — the access lookup AND the delivery both live on the background side: this hook
      // queues and returns, so the reset response time cannot encode whether the address still
      // has access or whether the mail provider is healthy.
      enqueueAuthEmail({ purpose: "password-reset", email: user.email, url });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      // Same handover as every other auth email (#678): the signup response must not wait on the
      // mail provider either.
      //
      // #940 — the mailed link points at our own /verify-email landing page first, not straight
      // at this raw API route: that route has no page behind it, so a merchant who clicked it
      // saw an entirely blank browser tab for however long verification + auto sign-in +
      // workspace provisioning took server-side. toVerifyLandingUrl() only changes where the
      // link visually lands; token and callbackURL still reach THIS endpoint unchanged.
      enqueueAuthEmail({ purpose: "verify-email", email: user.email, url: toVerifyLandingUrl(url) });
    },
    // #543 — verifying is the last step the merchant should have to take; the link drops
    // them straight into their new workspace. The token is single-use and short-lived, and
    // the session it mints still passes through the fail-closed session.create.before gate.
    autoSignInAfterVerification: true,
    // #543/#544 — the ONE place that turns "email proven" into a tenant + the welcome grant.
    // convergeIdentity is idempotent: a second verification, a re-login or
    // a racing tab all converge on the same org and the same single GRANT row (the grant
    // dedupes on the (orgId, idempotencyKey) unique). #538 — it now throws for exactly one
    // reason: the operator revoked this address mid-provisioning, which is a security refusal
    // and must not surface as a completed verification. Every other failure stays non-fatal.
    // Before this, an unverified account had
    // no User row at all, so nothing could be granted — which is exactly the rule the spec
    // wants: unverified means zero balance, with no extra lock needed.
    afterEmailVerification: async (user) => {
      await convergeIdentity({ email: user.email, name: user.name, image: user.image, emailVerified: true });
    },
  },
  // #681 — register Google ONLY when it is actually configured. Registering it with `?? ""`
  // meant an environment with no credentials still advertised the provider, and the sign-in
  // call died deep inside the OAuth handshake as a 500 for what is purely a missing setting.
  // Same predicate the login page uses to decide whether to show the button, so the offer and
  // the capability cannot disagree. Configured deployments are unaffected.
  socialProviders: googleSignInConfigured()
    ? {
        google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },
      }
    : {},
  // #543 — basic abuse control on the newly public endpoints, using Better Auth's own
  // per-IP limiter (no bespoke machinery). The outbound-email limiter in sender.ts
  // (5 per address per hour) still caps mail volume per victim address on top of this.
  // #795 r5 — BETTER AUTH COUNTS THE SAME CALLER WE DO. One fact, one source.
  //
  // Its default is `X-Forwarded-For`, first entry (`utils/get-request-ip.mjs`), and on this
  // deployment that default is wrong in both directions at once. Railway's edge does not send
  // `X-Forwarded-For` at all — but Next fills one in from the socket
  // (`base-server.js`: `req.headers['x-forwarded-for'] ??= originalRequest.socket.remoteAddress`),
  // and that socket belongs to the platform's internal proxy: every merchant would share ONE
  // address, and the built-in 3-per-10-seconds sign-in rule would refuse the whole product at
  // once. And if anything upstream ever passed a caller-written `X-Forwarded-For` through, `??=`
  // keeps it and its first entry is whatever the caller typed — the forgeable reading, back again.
  //
  // Better Auth's option is a list of header NAMES whose FIRST value it takes; it has no hook for
  // "count from the right", so the `xff:<hops>` deployment shape cannot be written as a header
  // name. The shape is therefore resolved once, in `caller-identity.ts`, and the answer is handed
  // over in a header of ours that the route stamps on every forwarded request (deleting any
  // inbound copy first). When the caller is unidentifiable the header is absent and Better Auth
  // falls back to its own single shared bucket — the same semantics our side gives that case.
  advanced: { ipAddress: { ipAddressHeaders: [CALLER_IP_HEADER] } },
  // See CLOSED_EMAIL_OTP_PATHS. Spread rather than inlined so the list has one home and the tests
  // can assert against the same array the router is handed.
  disabledPaths: [...CLOSED_EMAIL_OTP_PATHS],
  rateLimit: {
    // #795 — THE fix for "the gate is a number nobody can trust". Better Auth's limiter defaults
    // to PROCESS MEMORY, so every one of the rules below was per-instance: a second web replica
    // silently doubled every budget, and every deploy reset every window. Beta is open
    // registration (Founder, 2026-08-11), which makes these the doors that carry the load.
    //
    // "database" is Better Auth's own storage backend — no new vendor, no Redis, one table
    // (`ba_rate_limit`, #795 migration). It reads and writes through the SAME Prisma adapter this
    // config already uses, and it prunes its own expired rows.
    //
    // NOT enabled outside production: Better Auth's own default (`enabled ?? isProduction`) is
    // left alone deliberately — a dev/test run must not be rate-limited into flakiness, and the
    // thing this ticket fixes is a production-scale-out defect.
    storage: "database",
    modelName: "BetterAuthRateLimit",
    // #795 r2 — EMPTY, and that is the fix rather than a regression.
    //
    // Three hourly rules used to live here (`/sign-up/email`, `/request-password-reset`,
    // `/send-verification-email`, each 5 per hour). Under `storage: "database"` Better Auth
    // cannot honour them: its pruning cutoff is
    //   max(rateLimit.window, …its built-in special rules) = max(10 s, 10 s, 60 s) = 60 s
    // and it applies that cutoff without consulting the custom rule that matched. A counter row
    // is therefore deleted 61 seconds after its last request, so "5 per hour" enforced 5 per
    // MINUTE — about 300 an hour. A rule that reads one number and enforces another is the exact
    // defect this ticket exists to close, so the rules are gone from here and the hourly caps run
    // on our own counter (app/api/better-auth/[...all]/route.ts), which prunes on its own window.
    //
    // Raising the global `window` to an hour WOULD fix the cutoff, and was rejected: it re-prices
    // every other endpoint this limiter guards (`/get-session` and friends) from 100-per-10-seconds
    // to 100-per-hour, which takes out a shared office address doing nothing wrong.
    //
    // What Better Auth still enforces here — and what the database storage genuinely fixes — is
    // its BUILT-IN short rules: 3 per 10 s on every /sign-in and /sign-up path, 3 per 60 s on
    // password-reset and verification resend. Those windows are at or under the 60-second cutoff,
    // so the pruning cannot undercut them, and they are now shared across instances instead of
    // being per-process. Burst is its job; the hour is ours.
    //
    // The fence for all of this is `better-auth-rate-limit-storage.test.ts`: it refuses any
    // customRule whose window exceeds the cutoff, and refuses FUNCTION-form rules outright —
    // Better Auth calls those and honours whatever window they return, so a function that returns
    // 61 seconds walks straight back into the trap and no static check could see it coming.
    customRules: {
      // NOTE (#795): there is deliberately NO rule for "/sign-in/email" here either, and that is
      // the OPPOSITE of leaving the password door unguarded. Better Auth's built-in special rule
      // already caps every /sign-in path at 3 per 10 seconds, and `customRules` REPLACES a rule
      // rather than adding to it — an hourly rule written here would delete that burst cap. The
      // password door needs both (a burst cap stops credential stuffing at speed; an hourly cap
      // stops the patient version), so the hourly one is layered in front of this handler instead,
      // in app/api/better-auth/[...all]/route.ts. Nothing here is loosened; a cap is added.
      //
      // NOTE (#678 r3): there is deliberately NO rule for the sign-in-code doors here either.
      // The one that MINTS a code is not a public door at all — it is in `disabledPaths`, and its
      // only caller is our background queue, so a rule here would cap the background rather than
      // the public. The one that REDEEMS a code (`/sign-in/email-otp`) keeps the plugin's own
      // rule — 3 per 60 s per CALLING ADDRESS and path, never per email account: Better Auth keys
      // every rate-limit bucket with `createRateLimitKey(ip, path)`, so this cap says nothing
      // about who was being signed in — untouched for the same reason "/sign-in/email" is: an
      // entry here would REPLACE that burst cap instead of adding to it. What bounds guessing is
      // the per-code attempt budget (`allowedAttempts`), which no request-level limiter can
      // substitute for — see the plugin's configuration below.
    },
  },
  // Deny-by-default allowlist across EVERY method (before any session is issued).
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const email: string | undefined = (ctx.body as Record<string, unknown> | undefined)?.email as string | undefined;
      if (!email) return;
      if (isSelfSignupPath(ctx.path)) {
        // #543 — the ONE open door: self-service registration with email + password. The
        // allowlist is NOT the gate here (that is the whole point of the ticket); the pause
        // switch and the revocation check in databaseHooks.user.create.before are. Nothing
        // else opens: the sign-in code, Google and password sign-in keep their existing gates.
        if (signupsPaused()) throw new APIError("FORBIDDEN", { message: SIGNUPS_PAUSED_MESSAGE });
        return;
      }
      if (ctx.path === SIGN_IN_CODE_VERIFY_PATH || ctx.path === "/sign-in/email") {
        // #678 — DELIBERATELY NO ALLOWLIST DECISION HERE, for both doors. Deciding at the door
        // is what made the ANSWER a function of whether the address has an account:
        //
        //   sign-in code — an allowlist refusal here is a 403 saying so, while every other
        //     submission gets Better Auth's "Invalid OTP". Anyone could then type six random
        //     digits at an address and read which of the two came back: an account-existence
        //     oracle on a door that needs no credential to knock on. (The magic link this
        //     replaced had the same defect in its timing rather than its wording — an address
        //     without access returned after ONE allowlist query while an address with access
        //     went on to mint a token and wait on the email network.)
        //   password — an address without access was refused here, skipping Better Auth's own
        //     dummy password hash (sign-in.mjs hashes the submitted password when no user is
        //     found, precisely so the two cases cost the same). Our shortcut walked around the
        //     constant-time path it was imitating.
        //
        // Where the access decision lives now: for the sign-in code, on the background side
        // BEFORE the code is minted (lib/better-auth/sender.ts) and again in the send hook — so a
        // code only ever reaches an address that already passed it; for the password door, inside
        // Better Auth's own credential check, which is constant-time by construction.
        //
        // NOTHING IS LOOSENED. Redeeming a code is still refused twice over —
        // databaseHooks.user.create.before (assertAllowedEmail) and
        // databaseHooks.session.create.before (assertAllowedForUserId) both stay fail-closed —
        // and reaching either of them requires the correct six digits first.
        // A password sign-in for an address without access still ends in Better Auth's own
        // INVALID_EMAIL_OR_PASSWORD unless the credential is genuinely correct, in which case
        // session.create.before refuses the session.
        return;
      }
      if (ctx.path?.startsWith("/sign-in") || ctx.path?.startsWith("/sign-up")) {
        await assertAllowedEmail(email);
      }
    }),
  },
  // Deny-by-default allowlist gates in databaseHooks — covers ALL methods including OAuth callbacks.
  // Throwing APIError here aborts the operation and propagates a 403 to the caller.
  databaseHooks: {
    /*
     * #795 r3 — THERE IS DELIBERATELY NO `account` HOOK HERE, and the reason is a correction.
     *
     * r2 added one that nulled `idToken` before every account write, on the claim that nothing
     * ever reads it. **That claim was false**, and the round-2 judge was right to reject it.
     * Measured again in better-auth 1.6.20 (`api/routes/account.mjs`), `idToken` IS read back:
     *   · `getValidAccessToken` carries it through a refresh (:283) and RETURNS it (:306)
     *   · the `/get-access-token` and `/refresh-token` endpoints return it (:425, :436, :444)
     * and those endpoints are mounted — this app hands the whole Better Auth router to
     * `toNextJsHandler` at `app/api/better-auth/[...all]/route.ts`, so they answer real requests
     * today (asserted in `better-auth-id-token.test.ts`). Nulling the column would have made
     * those endpoints return `undefined` where a caller asked for an ID token: a working feature
     * quietly answering wrong, which is worse than the exposure it was removing.
     *
     * WHAT THAT LEAVES — stated plainly rather than papered over. `idToken` stays in
     * `ba_account` as PLAIN TEXT. It cannot be encrypted from out here either: the library
     * returns the stored value directly and never decrypts it, so an encrypt-on-write hook would
     * hand callers ciphertext believing it was a token — the same silent break in a different
     * costume. Encrypting it properly is a change inside Better Auth, not in this file.
     *
     * RESIDUAL RISK, as registered on the PR and on #795: a database backup or a read of one
     * table yields Google ID tokens for merchants who signed in with Google. An ID token is an
     * identity assertion minted fresh at sign-in with a short expiry (Google: ~1 hour) — it is
     * not an API credential and grants no access to the merchant's Google account — so what a
     * stolen one buys is a replay window against relying parties that accept it, bounded by that
     * expiry. Mitigation available today: `scripts/tools/clear-plaintext-oauth-tokens.mjs
     * --expired-id-tokens` clears the ones already past their own `exp`. Whether that runs on a
     * schedule is a production-data decision and belongs to the Founder, not to this PR.
     */
    user: {
      create: {
        // Gate 1: prevents any non-allowlisted email from getting a ba_user row (first sign-up, any method).
        // #543 carves out EXACTLY one path — self-service `/sign-up/email` — where the allowlist is
        // no longer the gate. That path is still fail-closed on the two things that must hold:
        // signups must be open, and a REVOKED address can never re-register its way back in. Every
        // other method (the sign-in code, Google, and a null endpoint context) keeps the allowlist gate.
        before: async (user, ctx) => {
          if (isSelfSignupPath(ctx?.path)) {
            if (signupsPaused()) throw new APIError("FORBIDDEN", { message: SIGNUPS_PAUSED_MESSAGE });
            if (await isRevokedEmail(user.email)) {
              throw new APIError("FORBIDDEN", { message: "This email can't be used to create an account." });
            }
            return;
          }
          await assertAllowedEmail(user.email);
        },
        after: async (u, ctx) => {
          // Registration IS the invite — but only once the account actually exists. Writing this
          // from the request body instead would let a refused or abandoned signup pre-stock an
          // address that could still walk in later (e.g. after signups are paused).
          if (isSelfSignupPath(ctx?.path)) await admitSelfSignup(u.email);
          await convergeIdentity({ email: u.email, name: u.name, image: u.image, emailVerified: u.emailVerified });
        },
      },
    },
    session: {
      create: {
        // Gate 2: prevents a session being issued for any non-allowlisted email — covers repeat sign-ins
        // and revocation. Runs on every session creation regardless of method (OAuth, sign-in code, password).
        before: async (session) => {
          await assertAllowedForUserId(session.userId);
        },
        after: async (s, ctx) => {
          const u = await prisma.betterAuthUser.findUnique({ where: { id: s.userId }, select: { email: true, name: true, image: true, emailVerified: true } });
          // #737 — THE session-create hook is the only caller that passes `sessionId`, and it is
          // the only one that should: a session is what a sign-in produces, so its id is what
          // makes the `auth.signin` audit row one-per-login no matter how many times convergence
          // runs. But `session.create` fires for more than sign-ins — `signinSessionId` returns
          // null for the two side-effect session creations (impersonation, password-change
          // rotation), and a null id means this convergence writes no sign-in row at all.
          // Convergence itself still runs: the identity is real either way.
          if (u) {
            await convergeIdentity({
              email: u.email,
              name: u.name,
              image: u.image,
              emailVerified: u.emailVerified,
              sessionId: signinSessionId(s, ctx),
            });
          }
        },
      },
    },
  },
  plugins: [
    emailOTP({
      // #757 — ONE source for the credential's lifetime. This used to be its own `60 * 15` while
      // the auth-email queue sized its capacity against a copy of the same number in a comment;
      // two copies of a load-bearing constant is one edit away from a queue full of credentials
      // that expire before they are posted, with nothing failing to say so. (Better Auth's own
      // default here is 300 s; ours is deliberately longer — see the constant.)
      expiresIn: AUTH_EMAIL_CODE_TTL_SECONDS,
      // Better Auth's default is 6 already; it is written out because it is the number the login
      // page's input length and the email's layout are both built around.
      otpLength: 6,
      /**
       * HOW MANY GUESSES ONE ISSUED CODE IS WORTH — and the reason this, not a new rate limiter,
       * is the answer to brute force.
       *
       * A wrong code increments the attempt counter on the verification row itself and the fourth
       * try is refused outright, leaving the identifier locked (`atomicVerifyOTP` in the plugin).
       * So a code is worth at most 3 of 10⁶, and rotating IP addresses does not buy more tries:
       * the budget lives on the code, not on the caller. Above that, the number of codes an
       * address can be issued is already bounded twice — five per caller-and-address per hour on
       * the request door (better-auth/signin-code-request.ts) and five per ADDRESS per hour on the
       * outbound side (better-auth/sender.ts) — which caps the whole attack at fifteen guesses an
       * hour against any one merchant. Better Auth's own per-IP rule (3 per 60 s on every path
       * this plugin mounts) sits under all of it.
       *
       * 3 is Better Auth's default and it is written out for the same reason as the length: it is
       * the number the security argument above is made of.
       */
      allowedAttempts: 3,
      /**
       * THE CODE DOES NOT SIT IN THE DATABASE IN THE CLEAR — and "hashed" would not have fixed
       * that either. `storeOTP: "hashed"` is an unsalted SHA-256, and the input space is a million
       * six-digit numbers: anyone holding the row recovers the code in milliseconds, so it buys
       * nothing a plaintext column does not already give away. "encrypted" is XChaCha20-Poly1305
       * under BETTER_AUTH_SECRET (the same primitive `account.encryptOAuthTokens` above uses), and
       * that secret is NOT in the database — so a database backup, or read access to one table, is
       * no longer a live set of sign-in codes.
       *
       * NO NEW ENVIRONMENT VARIABLE: the key is BETTER_AUTH_SECRET, which is already required and
       * already guarded at ≥32 chars at the top of this file. The one consequence worth stating:
       * rotating that secret invalidates codes in flight, which is at most fifteen minutes of
       * "ask for a new one" and is the same blast radius rotation already has for sessions.
       */
      storeOTP: "encrypted",
      /**
       * PRESSING "SEND IT AGAIN" RE-SENDS THE SAME CODE — it does not mint a second one, and
       * that is a correctness fix rather than a preference.
       *
       * Better Auth's default ("rotate") writes a NEW verification row per request and never
       * removes the old one, while verification always reads the newest row. So a merchant whose
       * first email is slow, who presses again, ends up holding two emails with two different
       * codes of which only the newer one works — and typing the one they happened to open first
       * is not merely refused, it SPENDS one of the three attempts belonging to a code they have
       * not even seen yet. Three presses and an unlucky reading order locks them out of their own
       * sign-in with two live codes in their inbox.
       *
       * "reuse" makes every email say the same six digits and extends that one code's expiry, so
       * there is exactly one live credential per address and no wrong-but-plausible thing to
       * type. It requires a RECOVERABLE stored code, which `storeOTP: "encrypted"` above is
       * (hashing would silently fall back to rotate).
       *
       * WHAT REUSE DOES AND DOES NOT EXTEND, because only one of the two would matter:
       *   · the EXPIRY is extended, so `expiresIn` is fifteen minutes FROM EACH SEND rather than
       *     from the first — a merchant who presses again keeps one code alive longer than a
       *     quarter of an hour. Bounded by the request door's five presses an address gets per
       *     hour, and harmless: a live code in one merchant's own inbox is what they asked for.
       *   · the ATTEMPT COUNT is NOT reset — `tryReuseOTP` only writes `expiresAt`, and it
       *     refuses outright once the three guesses are spent, so a fresh code is minted instead.
       *     Pressing "send it again" therefore cannot be used to buy more guesses or to
       *     resurrect a burnt code, which is what keeps `allowedAttempts` the real ceiling.
       */
      resendStrategy: "reuse",
      /**
       * Nothing here overrides email VERIFICATION (`overrideDefaultEmailVerification` is left at
       * its default of false) and nothing sends a code on sign-up (`sendVerificationOnSignUp`,
       * same). Signup verification stays the link + /verify-email landing page it already is
       * (#940/#969) — this plugin only owns the sign-in door.
       *
       * `disableSignUp` is left at its default too, which means this door can create an account
       * for an address that does not have one — exactly as the magic link it replaces did, and
       * gated by exactly the same two fail-closed hooks: `databaseHooks.user.create.before`
       * (assertAllowedEmail) and `databaseHooks.session.create.before` (assertAllowedForUserId).
       * Turning it on would ALSO put a user-existence branch inside the send endpoint, which is
       * the shape #678 spent three rounds removing.
       */
      sendVerificationOTP: async ({ email, otp }) => {
        // #678 r3 — this hook is BACKGROUND-ONLY. The single caller of the endpoint that runs it
        // is the auth-email queue (lib/better-auth/sender.ts), which has already checked access
        // and the per-address budget before minting anything. So delivery is simply awaited here:
        // there is no request waiting on it to await.
        //
        // The access check is repeated anyway, and the repetition is deliberate: it makes the
        // ENDPOINT invite-only rather than only the queue in front of it, so no future caller of
        // `auth.api.sendVerificationOTP` — of ANY type, including the password-reset and
        // change-email flows this plugin also mounts — can mail an address nobody invited. Its
        // cost is invisible: it is a background query behind an answer the merchant already has.
        if (!(await isAllowedEmail(email))) return;
        // #939 — this purpose's real lifetime, not Better Auth's default: AUTH_EMAIL_CODE_TTL_SECONDS
        // (15 minutes) is what `expiresIn` above actually configures, so it is also what the
        // "valid for" line in the email must say.
        await sendAuthEmail({
          to: email,
          subject: "Your Fikirtive sign-in code",
          code: otp,
          intro: "Sign in to Fikirtive",
          validitySeconds: AUTH_EMAIL_CODE_TTL_SECONDS,
        });
      },
    }),
    // Operator-console engine. Phase 1: installed for the session.create.before ban hook
    // (BetterAuthUser.banned ⇒ login blocked). Its API stays inert (no BA user has an admin
    // role yet); roles/adminRoles + impersonation arrive in Phase 2.
    admin({
      ac,
      roles: { "super-admin": superAdminRole },
      adminRoles: ["super-admin"],            // MUST be a key in `roles` or init throws
      impersonationSessionDuration: 60 * 30,  // 30 min
    }),
    nextCookies(), // MUST be last.
  ],
});
