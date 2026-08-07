import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink, customSession, admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prisma } from "@fikirtive/db";
import { dispatchAuthEmail } from "./sender";
import { roleForEmail } from "./session-role";
import { convergeIdentity } from "./converge";
import { assertAllowedEmail, assertAllowedForUserId } from "./gate";
import { ac, superAdminRole } from "./access";
import { isAllowedEmail, isRevokedEmail } from "@/lib/allowlist";
import { admitSelfSignup, signupsPaused, SIGNUPS_PAUSED_MESSAGE } from "@/lib/signup-gate";

/** #543 — the one Better Auth path that self-service registration owns. Anything that is not
 *  EXACTLY this path keeps the deny-by-default allowlist gate; an absent/unknown path (the
 *  database hooks receive a nullable endpoint context) therefore fails closed. */
const SELF_SIGNUP_PATH = "/sign-up/email";
function isSelfSignupPath(path: string | undefined | null): boolean {
  return path === SELF_SIGNUP_PATH;
}

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
  },
  verification: { modelName: "BetterAuthVerification" },
  emailAndPassword: {
    enabled: true,
    // NON-REMOVABLE: better-auth's default is OFF; without this an unverified email+password signup mints a session → account takeover via convergeIdentity. Keep true.
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      // Keep Better Auth's neutral reset response for removed users while still suppressing the
      // email (F17). Session creation independently re-checks access and remains fail-closed.
      // #678 r2 — the access lookup AND the delivery both moved off the request path: this hook
      // now hands the job over and returns, so the reset response time cannot encode whether the
      // address still has access or whether the mail provider is healthy.
      dispatchAuthEmail({
        to: user.email,
        subject: "Reset your Fikirtive password",
        url,
        intro: "Reset your password",
        deliverIf: () => isAllowedEmail(user.email),
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      // Same handover as every other auth email (#678 r2): the signup response must not wait on
      // the mail provider either.
      dispatchAuthEmail({
        to: user.email,
        subject: "Verify your Fikirtive email",
        url,
        intro: "Verify your email",
        deliverIf: () => true,
      });
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
  socialProviders: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" },
  },
  // #543 — basic abuse control on the newly public endpoints, using Better Auth's own
  // per-IP limiter (no bespoke machinery). The outbound-email limiter in sender.ts
  // (5 per address per hour) still caps mail volume per victim address on top of this.
  rateLimit: {
    customRules: {
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/send-verification-email": { window: 60 * 60, max: 5 },
      // #678 r2 — every submitted address now mints a verification token (that is what makes
      // the two doors cost the same), so this endpoint writes a row for callers it used to turn
      // away for free. This is the compensating per-IP cap on that write, set well above any
      // real merchant's retrying and far below a script's. Per-IP, so it is identical for an
      // address with an account and one without — it adds no existence signal.
      "/sign-in/magic-link": { window: 60 * 60, max: 20 },
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
        // else opens: magic link, Google and password sign-in keep their existing gates.
        if (signupsPaused()) throw new APIError("FORBIDDEN", { message: SIGNUPS_PAUSED_MESSAGE });
        return;
      }
      if (ctx.path === "/sign-in/magic-link" || ctx.path === "/sign-in/email") {
        // #678 r2 — DELIBERATELY NO ALLOWLIST DECISION HERE, for both doors. Deciding at the
        // door is what made the RESPONSE TIME a function of whether the address has an account:
        //
        //   magic link — an address without access returned after ONE allowlist query, while an
        //     address with access went on to write a verification token, query again and wait on
        //     the email network. Same words, visibly different clock.
        //   password — an address without access was refused here, skipping Better Auth's own
        //     dummy password hash (sign-in.mjs hashes the submitted password when no user is
        //     found, precisely so the two cases cost the same). Our shortcut walked around the
        //     constant-time path it was imitating.
        //
        // Both doors now run Better Auth's normal flow for EVERY address, and the access
        // decision happens where it cannot be timed: off the request path, inside the auth-email
        // dispatch (magic link), or in Better Auth's own credential check (password).
        //
        // NOTHING IS LOOSENED. A magic-link token minted for an address without access is never
        // delivered to anyone, and redeeming one is still refused twice over —
        // databaseHooks.user.create.before (assertAllowedEmail) and
        // databaseHooks.session.create.before (assertAllowedForUserId) both stay fail-closed.
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
    user: {
      create: {
        // Gate 1: prevents any non-allowlisted email from getting a ba_user row (first sign-up, any method).
        // #543 carves out EXACTLY one path — self-service `/sign-up/email` — where the allowlist is
        // no longer the gate. That path is still fail-closed on the two things that must hold:
        // signups must be open, and a REVOKED address can never re-register its way back in. Every
        // other method (magic link, Google, and a null endpoint context) keeps the allowlist gate.
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
        // and revocation. Runs on every session creation regardless of method (OAuth, magic-link, password).
        before: async (session) => {
          await assertAllowedForUserId(session.userId);
        },
        after: async (s) => {
          const u = await prisma.betterAuthUser.findUnique({ where: { id: s.userId }, select: { email: true, name: true, image: true, emailVerified: true } });
          if (u) await convergeIdentity({ email: u.email, name: u.name, image: u.image, emailVerified: u.emailVerified });
        },
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        // #678 r2 — this hook AWAITS NOTHING. It hands the job over and returns, so the endpoint
        // has answered before the access lookup or the mail provider has been touched. The
        // access re-check still happens (it is `deliverIf`), just on the background side, where
        // its cost and its outcome cannot be observed from outside. Session creation remains
        // independently fail-closed through databaseHooks.session.create.before.
        dispatchAuthEmail({
          to: email,
          subject: "Sign in to Fikirtive",
          url,
          intro: "Sign in to Fikirtive",
          deliverIf: () => isAllowedEmail(email),
        });
      },
    }),
    // Surface the canonical role on the session so compat.ts matches NextAuth byte-for-byte.
    customSession(async ({ user, session }) => {
      return { user: { ...user, role: await roleForEmail(user.email) }, session };
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
