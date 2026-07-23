import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink, customSession, admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prisma } from "@fikirtive/db";
import { sendAuthEmail } from "./sender";
import { roleForEmail } from "./session-role";
import { convergeIdentity } from "./converge";
import { assertAllowedEmail, assertAllowedForUserId } from "./gate";
import { ac, superAdminRole } from "./access";
import { isAllowedEmail } from "@/lib/allowlist";

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
      if (!(await isAllowedEmail(user.email))) return;
      await sendAuthEmail({ to: user.email, subject: "Reset your Fikirtive password", url, intro: "Reset your password" });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({ to: user.email, subject: "Verify your Fikirtive email", url, intro: "Verify your email" });
    },
  },
  socialProviders: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" },
  },
  // Deny-by-default allowlist across EVERY method (before any session is issued).
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const email: string | undefined = (ctx.body as Record<string, unknown> | undefined)?.email as string | undefined;
      if (!email) return;
      if (ctx.path === "/sign-in/magic-link") {
        if (!(await isAllowedEmail(email))) {
          // Enumeration-safe parity: the public endpoint returns the same success body without
          // creating a verification token or attempting delivery for an address without access.
          return ctx.json({ status: true });
        }
      } else if (ctx.path === "/sign-in/email") {
        if (!(await isAllowedEmail(email))) {
          // Match Better Auth's native invalid-credential response so the password form cannot
          // be used as a second allowlist-membership probe.
          throw new APIError("UNAUTHORIZED", {
            code: "INVALID_EMAIL_OR_PASSWORD",
            message: "Invalid email or password",
          });
        }
      } else if (ctx.path?.startsWith("/sign-in") || ctx.path?.startsWith("/sign-up")) {
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
        before: async (user) => {
          await assertAllowedEmail(user.email);
        },
        after: async (u) => {
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
        // Re-check after the before-hook in case access was revoked between the two awaits.
        // Returning normally keeps the endpoint response neutral while session creation remains
        // independently fail-closed through databaseHooks.session.create.before.
        if (!(await isAllowedEmail(email))) return;
        await sendAuthEmail({ to: email, subject: "Sign in to Fikirtive", url, intro: "Sign in to Fikirtive" });
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
