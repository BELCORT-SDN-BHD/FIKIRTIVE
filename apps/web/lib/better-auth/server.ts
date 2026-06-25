import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink, customSession } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prisma } from "@fikirtive/db";
import { isAllowedEmail } from "@/lib/allowlist";
import { sendAuthEmail } from "./sender";
import { roleForEmail } from "./session-role";
import { convergeIdentity } from "./converge";

async function assertAllowed(email: string | null | undefined) {
  if (!(await isAllowedEmail(email))) {
    throw new APIError("FORBIDDEN", { message: "This email isn't on the allowlist." });
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: "/api/better-auth",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Map BA's four models to the dormant ba_* tables (Task 3).
  user: { modelName: "BetterAuthUser" },
  session: { modelName: "BetterAuthSession" },
  account: { modelName: "BetterAuthAccount" },
  verification: { modelName: "BetterAuthVerification" },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
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
      if (email && (ctx.path?.startsWith("/sign-in") || ctx.path?.startsWith("/sign-up"))) {
        await assertAllowed(email);
      }
    }),
  },
  // Convergence after a user row exists (BA's own ba_user); reconnect to the tenant graph by email.
  databaseHooks: {
    user: {
      create: {
        after: async (u) => {
          await convergeIdentity({ email: u.email, name: u.name, image: u.image });
        },
      },
    },
    session: {
      create: {
        after: async (s) => {
          const u = await prisma.betterAuthUser.findUnique({ where: { id: s.userId }, select: { email: true, name: true, image: true } });
          if (u) await convergeIdentity(u);
        },
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        await assertAllowed(email);
        await sendAuthEmail({ to: email, subject: "Sign in to Fikirtive", url, intro: "Sign in to Fikirtive" });
      },
    }),
    // Surface the canonical role on the session so compat.ts matches NextAuth byte-for-byte.
    customSession(async ({ user, session }) => {
      return { user: { ...user, role: await roleForEmail(user.email) }, session };
    }),
    nextCookies(), // MUST be last.
  ],
});
