/**
 * How a journey signs in — through the product's own front door, with the email step removed.
 *
 * The suite mints the SAME verification row Better Auth's magic-link plugin mints
 * (`identifier` = the token, `value` = the JSON payload, `expiresAt`), then drives the browser to
 * the real `/api/better-auth/magic-link/verify` URL the email would have carried. Everything after
 * that is production code doing production work: the token is consumed atomically, the allowlist
 * gate runs, `session.create.before` re-checks access, identity convergence runs, and the session
 * cookie is set by the app.
 *
 * WHY NOT FABRICATE THE COOKIE. A hand-written session row plus a hand-signed cookie would skip
 * every gate above — the journeys would prove that the pages render for a session, not that this
 * product lets a merchant in. WHY NOT SEND REAL MAIL: there is no mail provider on a test runner,
 * and a suite that waits on one is a suite that goes red for somebody else's outage.
 *
 * The token is stored PLAIN because that is this deployment's configuration (better-auth's
 * `storeToken` default; `apps/web/lib/better-auth/server.ts` overrides only `expiresIn`). If that
 * ever changes to a hashed store, `signIn` below stops working — loudly, on the first journey,
 * which is the right way for a security-relevant default to change.
 */
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { prisma } from "./db.js";
import type { Workspace } from "./seed.js";

/**
 * THE ONE PLACE IN THIS SUITE THAT READS THE WALL CLOCK, and the reason it is not a timing
 * dependency: Better Auth stores an absolute `expiresAt` on the verification row, so the value
 * has to be "now plus something". Thirty minutes is far wider than the whole suite's runtime
 * (measured: ~15 s locally, ~32 s on the CI runner), the token is consumed within milliseconds of
 * being minted, and no assertion anywhere compares against it — a journey cannot go red or green
 * on account of this number. Every fixture timestamp that a journey DOES read is a fixed instant
 * (support/seed.ts).
 */
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;

/**
 * Better Auth caps every sign-in path at a few attempts per ten seconds, per caller, and this
 * runner has no client IP to key on — so all seventeen journeys share ONE bucket and the fourth
 * one gets a 429 instead of a session.
 *
 * The reset below is per-journey and clears the counter, NOT the rule: each journey is a different
 * merchant signing in for the first time, which is exactly what the counter would say if they had
 * arrived from different shops. Sleeping the window off instead would put a wall clock in the
 * critical path of every journey, which is the flake this suite exists to avoid.
 */
export async function clearAuthRateLimitCounters(): Promise<void> {
  await prisma.betterAuthRateLimit.deleteMany({});
}

async function mintMagicLinkToken(email: string): Promise<string> {
  await clearAuthRateLimitCounters();
  const token = randomUUID().replace(/-/g, "");
  await prisma.betterAuthVerification.create({
    data: {
      id: randomUUID(),
      identifier: token,
      value: JSON.stringify({ email }),
      expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
    },
  });
  return token;
}

/** The URL that would have been in the merchant's inbox. */
export async function magicLinkUrl(email: string, callbackURL = "/otto"): Promise<string> {
  const token = await mintMagicLinkToken(email);
  return `/api/better-auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(callbackURL)}`;
}

/**
 * Sign this workspace's owner in and land them where the link pointed.
 *
 * Asserts the landing rather than assuming it: a refused sign-in redirects back to /login with an
 * `error` parameter, and a journey that quietly continued from there would report a page's
 * emptiness as a product fact.
 */
export async function signIn(page: Page, ws: Workspace, callbackURL = "/otto"): Promise<void> {
  await page.goto(await magicLinkUrl(ws.email, callbackURL));
  await expect(page).toHaveURL(new RegExp(`${callbackURL.split("?")[0]}`));
  expect(new URL(page.url()).searchParams.get("error")).toBeNull();
}
