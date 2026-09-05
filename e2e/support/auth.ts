/**
 * How a journey signs in — through the product's own front door, with the inbox removed.
 *
 * Sign-in is a mailed one-time CODE now (Founder ruling, 2026-08-18), so the shape of the
 * shortcut changed with it. The suite asks for a code exactly as the login page does, then reads
 * the code out of the database the way a merchant reads it out of their inbox — decrypting the
 * very row Better Auth just wrote, with the library's own cipher — and types it into the real
 * form. Everything after "the code was delivered" is production code doing production work: the
 * code is consumed atomically and single-use, the per-code attempt budget applies, the allowlist
 * gate runs, `session.create.before` re-checks access, identity convergence runs, and the session
 * cookie is set by the app.
 *
 * WHY NOT WAIT FOR THE MAIL. There is no mail provider on a test runner and there never will be
 * (support/env.ts refuses to run with a RESEND_API_KEY present); what the app under test carries
 * instead is the STUB transport it is explicitly told to use — `AUTH_EMAIL_TRANSPORT=stub`,
 * support/env.ts — which writes the code to a local file rather than mailing it. Reading the
 * stored code is still the honest stand-in for an inbox, and it is a strictly SMALLER shortcut
 * than the one it replaces: the previous helper FORGED a verification row, this one reads the row
 * the product minted for itself.
 *
 * WHY NOT FABRICATE THE COOKIE. A hand-written session row plus a hand-signed cookie would skip
 * every gate above — the journeys would prove that the pages render for a session, not that this
 * product lets a merchant in.
 *
 * THE CODE IS STORED ENCRYPTED (apps/web/lib/better-auth/server.ts, `storeOTP: "encrypted"`,
 * key = BETTER_AUTH_SECRET, which this suite fixes in support/env.ts). Decrypting it here uses
 * Better Auth's own primitive rather than a reimplementation — imported by path for the same
 * reason support/db.ts imports the built @fikirtive/db by path: `e2e/` is not a pnpm workspace
 * project and has no node_modules of its own. If that storage option ever changes, this stops
 * working loudly on the first journey, which is the right way for a security-relevant default to
 * change.
 */
import { expect, type Page } from "@playwright/test";
import { symmetricDecrypt } from "../../apps/web/node_modules/better-auth/dist/crypto/index.mjs";
import { prisma } from "./db.js";
import { E2E_AUTH_SECRET, E2E_BASE_URL } from "./env.js";
import type { Workspace } from "./seed.js";

/** The identifier the email-OTP plugin files a sign-in code under. */
const otpIdentifier = (email: string) => `sign-in-otp-${email.trim().toLowerCase()}`;

/**
 * Better Auth caps every sign-in path at a few attempts per ten seconds, per caller, and this
 * runner has no client IP to key on — so all the journeys share ONE bucket and the fourth one
 * gets a 429 instead of a session. Our own hourly counters (the sign-in-code request door, the
 * per-address outbound cap) share a bucket for the same reason.
 *
 * The reset below is per-journey and clears the counters, NOT the rules: each journey is a
 * different merchant signing in for the first time, which is exactly what the counters would say
 * if they had arrived from different shops. Sleeping the windows off instead would put a wall
 * clock in the critical path of every journey, which is the flake this suite exists to avoid.
 */
export async function clearAuthRateLimitCounters(): Promise<void> {
  await prisma.betterAuthRateLimit.deleteMany({});
  await prisma.rateLimitCounter.deleteMany({});
}

/**
 * The six digits that would have been in the merchant's inbox.
 *
 * Polls because asking for a code is deliberately asynchronous: the login page's server action
 * hands an opaque job to a background queue and returns immediately (#678 — the response time
 * must not encode whether the address has an account), so the row appears a moment after the
 * button is pressed. Bounded, and it fails as an assertion rather than as a suite timeout.
 */
export async function codeFromInbox(email: string): Promise<string> {
  const identifier = otpIdentifier(email);
  const deadline = Date.now() + 15_000;
  for (;;) {
    const row = await prisma.betterAuthVerification.findFirst({
      where: { identifier },
      orderBy: { createdAt: "desc" },
    });
    if (row) {
      // `<stored code>:<attempts so far>` — split at the LAST colon, as the plugin does.
      const stored = row.value.slice(0, row.value.lastIndexOf(":"));
      return symmetricDecrypt({ key: E2E_AUTH_SECRET, data: stored });
    }
    if (Date.now() > deadline) {
      throw new Error(`e2e: no sign-in code was minted for ${email} within 15s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Ask for a code on the real login form, and hand back what was mailed.
 *
 * Split out from `signIn` so journey 1 can walk the two steps with its own assertions in between
 * while every other journey just gets a session.
 */
export async function requestSignInCode(page: Page, email: string, callbackURL: string): Promise<string> {
  await clearAuthRateLimitCounters();
  await page.goto(`/login?from=${encodeURIComponent(callbackURL)}`);
  // /login opens on a hub that only offers the ways in ("Continue with email", "Continue with
  // Google"); the address field lives one step further. Asking for the field on the first screen
  // is how every journey in this suite timed out the day the shell changed.
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email").fill(email);
  // The hub is unmounted by now, so this name belongs to the email step's submit button.
  await page.getByRole("button", { name: "Continue with email" }).click();
  return codeFromInbox(email);
}

/**
 * Sign this workspace's owner in and land them where they were headed.
 *
 * Asserts the landing rather than assuming it: a refused sign-in leaves the merchant on /login,
 * and a journey that quietly continued from there would report a page's emptiness as a product
 * fact.
 *
 * AND WAITS FOR THE SHELL, not merely for the URL. Accepting a code is a client-side navigation,
 * so the address bar reads the destination the instant the redirect starts — before that page has
 * rendered anything. A journey that continued from there would immediately ask about controls
 * that do not exist yet and read "not visible" as "not offered": that is exactly how journey 12's
 * collapsed projects rail went missing (`isVisible()` is a single instantaneous check, not a
 * wait). The global navigation is on every signed-in surface, so its presence is the honest
 * signal that this merchant is in and the app has drawn itself.
 *
 * THE LANDING IS ASSERTED WHOLE (W2-11). This used to compare the address bar against
 * `new RegExp(callbackURL.split("?")[0])` — an UNANCHORED substring, and one with the query
 * thrown away. Two things went wrong with that the day the shell switched:
 *
 *   · it passed on a URL that merely CONTAINED the destination. `/otto?view=library` is a 307 to
 *     `/library` now, and the check went green on the split second the address bar still read
 *     `/otto…` before the redirect resolved — a journey then carried on against whichever page
 *     won the race. Journeys 8 and 13 flipped colour run to run on exactly that.
 *   · with Home at `/`, the destination `/` compiles to a regex that matches EVERY url, so a
 *     journey headed there would have asserted nothing at all.
 *
 * Comparing against the full absolute URL fixes both, and is strictly stronger than what it
 * replaces: a destination that redirects now fails HERE, naming the address the merchant really
 * ended up on, instead of somewhere downstream as a missing control. Journeys pass the address
 * the merchant actually lands on; where a redirect is the thing under test, `page.goto()` is the
 * honest way to walk it (journeys 7 and 9 do).
 */
export async function signIn(page: Page, ws: Workspace, callbackURL = "/"): Promise<void> {
  const code = await requestSignInCode(page, ws.email, callbackURL);
  await page.getByLabel("Login code").fill(code);
  await page.getByRole("button", { name: "Continue with login code" }).click();
  await expect(page).toHaveURL(new URL(callbackURL, E2E_BASE_URL).toString());
  await expect(page.getByRole("link", { name: "FIKIRTIVE home" })).toBeVisible();
}
