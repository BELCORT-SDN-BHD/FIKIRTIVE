import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@artlio/db";
import { newId, isRole, FOUNDER_OWNER_ID } from "@artlio/core";
import { isAllowedEmail } from "@/lib/allowlist";

/**
 * D18: email magic-link auth, founder-only via allowlist.
 *  - AUTH_ALLOWED_EMAILS: comma-separated allowlist (deny-by-default)
 *  - RESEND_API_KEY: production sender; in dev without a key, the magic link
 *    is written to .data/last-magic-link.txt so local flows (and smokes) work
 *  - rate limit: 5 link requests per email per hour (in-memory, single node)
 *  - audit: every sign-in lands in ActionEvent (auth.signin)
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

function rateLimit(email: string) {
  const now = Date.now();
  const recent = (attempts.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    throw new Error("Too many sign-in links requested — try again in an hour.");
  }
  recent.push(now);
  attempts.set(email, recent);
}

/** Deny-by-default allowlist check (env ∪ DB). Exported so admin handlers can
 *  re-assert it inside the handler (R7), not just at login. Async: awaiting is
 *  REQUIRED — a bare `!allowed(email)` check would always be falsy (Promise). */
export async function allowed(email: string | null | undefined): Promise<boolean> {
  return isAllowedEmail(email);
}

/** Dedicated founder list (OPT-6 P1b) — distinct from AUTH_ALLOWED_EMAILS. These
 *  emails are seeded to super-admin on sign-in (and one-time-backfilled in the P1b
 *  migration). The allowlist (allowed()) stays the outer app wall and never reads
 *  role, so a default-viewer can't lock the team out of the app, only out of
 *  role-gated sections. */
export function isFounderAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Resend({
      from: process.env.AUTH_EMAIL_FROM ?? "Fikirtive <onboarding@resend.dev>",
      async sendVerificationRequest({ identifier, url, provider }) {
        rateLimit(identifier);
        if (!process.env.RESEND_API_KEY) {
          if (process.env.NODE_ENV === "production") {
            throw new Error("RESEND_API_KEY is not configured.");
          }
          // dev: no email service — drop the link where the founder (and the
          // smoke suite) can pick it up
          const { writeFile, mkdir } = await import("node:fs/promises");
          const path = await import("node:path");
          const dir = path.join(process.cwd(), "..", "..", ".data");
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, "last-magic-link.txt"), url, "utf8");
          console.log(`[auth] magic link for ${identifier}: ${url}`);
          return;
        }
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: provider.from,
            to: identifier,
            subject: "Sign in to Fikirtive",
            text: `Sign in to Fikirtive:\n${url}\n\nIf you didn't request this, ignore this email.`,
          }),
        });
        if (!res.ok) {
          throw new Error(`Magic-link email failed (${res.status}).`);
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login?sent=1",
    error: "/login",
  },
  callbacks: {
    // deny-by-default allowlist — the link is never even sent otherwise
    async signIn({ user, email }) {
      void email;
      return await allowed(user?.email);
    },
    // OPT-6 P1b: DB session strategy passes the fresh User row as `user`. Copy its
    // role onto session.user.role so requireRole/UI read it. Garbage/missing → viewer
    // (deny-by-default; never throw — a session read must not 500).
    session({ session, user }) {
      session.user.role = isRole(user?.role) ? user.role : "viewer";
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      // OPT-6 P1b PART (b): self-healing founder super-admin on every sign-in.
      // Idempotent + promote-only: a founder is always (re)set to super-admin; a
      // non-founder is never touched here (their role is managed via the Team UI).
      if (isFounderAdmin(user.email) && user.email) {
        await prisma.user
          .updateMany({
            where: { email: user.email, role: { not: "super-admin" } },
            data: { role: "super-admin" },
          })
          .catch(() => {}); // best-effort — never block sign-in on a role write
      }
      // closed-beta P1 (DORMANT until P3): ensure the founder's Membership in the seeded
      // "founder" org exists. Idempotent (@@unique([userId, orgId])), best-effort, NEVER
      // blocks sign-in. Only the founder maps to the "founder" org; other users get their
      // own org in P3. Nothing reads Membership yet — this just seeds it early.
      if (isFounderAdmin(user.email) && user.id) {
        await prisma.membership
          .upsert({
            where: { userId_orgId: { userId: user.id, orgId: FOUNDER_OWNER_ID } },
            create: { id: newId(), userId: user.id, orgId: FOUNDER_OWNER_ID, role: "owner" },
            update: {},
          })
          .catch(() => {}); // best-effort — never block sign-in on a membership write
      }
      // closed-beta P3: converge a NON-founder's personal org early (best-effort). This is
      // ONLY a convergence path — requireOwner() is the authoritative, fail-closed resolver
      // and re-bootstraps on demand if this never ran. NEVER blocks sign-in.
      if (!isFounderAdmin(user.email) && user.id && user.email) {
        try {
          const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
          await bootstrapPersonalOrg(user.id, user.email);
        } catch (e) {
          console.warn("[auth] signIn personal-org bootstrap failed (non-fatal):", e instanceof Error ? e.message : e);
        }
      }
      await prisma.actionEvent.create({
        data: {
          id: newId(),
          ownerId: "founder",
          type: "auth.signin",
          payload: { email: user.email ?? "" },
        },
      });
    },
  },
});
