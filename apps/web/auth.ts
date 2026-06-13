import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@artlio/db";
import { newId } from "@artlio/core";

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

/** Deny-by-default allowlist check (AUTH_ALLOWED_EMAILS). Exported so admin
 *  handlers can re-assert it inside the handler (R7), not just at login. */
export function allowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Resend({
      from: process.env.AUTH_EMAIL_FROM ?? "Artlio <onboarding@resend.dev>",
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
            subject: "Sign in to Artlio",
            text: `Sign in to Artlio:\n${url}\n\nIf you didn't request this, ignore this email.`,
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
    signIn({ user, email }) {
      void email;
      return allowed(user?.email);
    },
  },
  events: {
    async signIn({ user }) {
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
