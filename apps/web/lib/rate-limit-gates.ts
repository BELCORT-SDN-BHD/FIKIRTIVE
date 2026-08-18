import "server-only";
import { consumeRateLimit } from "@fikirtive/db/rate-limit";
import { callerKey } from "@/lib/caller-identity";

export { callerKey } from "@/lib/caller-identity";

/**
 * #795 — the product's own gates, in one place.
 *
 * Better Auth guards its own endpoints (and now counts them in Postgres). These are the four
 * doors it knows nothing about, and every one of them had NO limit at all:
 *
 *   · the PASSWORD door — Better Auth caps it at 3 per 10 seconds, which stops a fast attack and
 *     does nothing at all about a patient one (3/10s is 1,080 attempts an hour from one address);
 *   · the OTTO CONVERSATION door (added 2026-08-18) — a turn used to hold and charge credits, so
 *     the balance was the bound; now that chat is free the platform pays for every turn and
 *     nothing else counts them;
 *   · GENERATION — the paid dispatch. Credits bound what can be SPENT, not how many jobs, rows
 *     and queue messages a stuck client loop can create on the way to running out;
 *   · UPLOAD — mints a presigned URL into our own bucket, once per call, with nothing counting;
 *   · the EXTERNAL LINK — the signed media proxy, the one route with no session by design.
 *
 * WHY EACH LIMIT IS THE NUMBER IT IS is written at the constant. The rule used for all of them:
 * size the cap against the most demanding REAL use we can name (a 24-cell batch, a bulk product
 * import, ten people behind one office address), then leave headroom — a gate that refuses honest
 * work is an outage we inflicted on ourselves, and every one of these is a first gate where there
 * was none, so "generous" is still strictly tighter than what it replaces.
 *
 * KEYS. `door:subject`. The subject is a TENANT id for merchant doors (a signed-in caller is
 * counted as themselves, not as their office's shared address) and a caller address for the
 * public ones (there is nobody else to count).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Password sign-in, per calling address, per hour.
 *
 * Better Auth's burst rule is deliberately left in place underneath this (see the note in
 * lib/better-auth/server.ts): `customRules` REPLACES a rule, so writing an hourly rule there
 * would have deleted the 3-per-10-seconds cap. Two different attacks, two caps.
 *
 * 30 is chosen against the worst honest hour we can name: a shared office or cafe address where
 * several people each mistype a password a few times. A credential-stuffing run wants thousands.
 * Keyed on the ADDRESS ONLY, never on the submitted email — a refusal must never be readable as
 * "that account exists" (the same rule the magic-link door is built around).
 */
export const PASSWORD_DOOR_PER_CALLER_PER_HOUR = 30;

/**
 * #795 r2 — the three PUBLIC Better Auth doors, per calling address, per hour.
 *
 * These used to be `rateLimit.customRules` entries with a 3600-second window, and moving Better
 * Auth's storage to the database silently broke them. Its database backend prunes with a cutoff
 * of `max(rateLimit.window, …built-in special rules)` — 10 s and 60 s respectively, so 60
 * seconds — and it does that pruning without consulting the custom rule that actually applied.
 * A row therefore disappears 61 seconds after it was last touched, and an hourly budget of five
 * became five per minute: roughly 300 an hour, from a rule that reads "5". The published number
 * was not the enforced number, which is the exact defect this whole ticket exists to remove.
 *
 * Raising Better Auth's global `window` to an hour would fix the cutoff and re-price EVERY other
 * endpoint it guards (`/get-session` and friends) from 100-per-10-seconds to 100-per-hour, which
 * would take out a shared office address in ordinary use. So the hourly caps move here instead,
 * onto our own counter, which prunes on its own `expiresAt` and cannot be undercut by a window
 * it does not know about. Better Auth keeps its short built-in burst rules on the same paths —
 * this is a second cap in front, never a replacement.
 *
 * The number is UNCHANGED at five per address per hour: this ticket restores what the config
 * already claimed, it does not re-price the door.
 */
export const PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR = 5;

/**
 * Paid generation dispatch, per tenant, per hour.
 *
 * Sized against the largest legitimate burst the product can produce: one factory batch is up to
 * MAX_BATCH_CELLS (24) startGen calls dispatched together, and a busy merchant may run several
 * back to back while also working the canvas. 600 leaves room for roughly twenty-five full
 * batches an hour — far past any human session — while still bounding a runaway client loop to
 * hundreds of refused attempts instead of unbounded ones.
 *
 * This is NOT a spend cap. Credits are the spend cap and stay the money authority; this only
 * bounds how much work a single tenant can ask for per hour.
 */
export const GENERATION_PER_TENANT_PER_HOUR = 600;

/**
 * Otto conversation turns, per tenant, per hour.
 *
 * WHY IT EXISTS NOW. Until 2026-08-18 a turn held and charged credits, so the balance was itself
 * the bound: a runaway client loop ran out of money and stopped. Founder ruling 2026-08-18 made
 * chat free (OTTO_CONVERSATION_TURN_MARGIN in @fikirtive/core), which is the right product call
 * and removes the only thing that was counting. The platform still pays the model for every one
 * of those turns, so the bound has to come from somewhere: this is it.
 *
 * IT IS NOT A PRICE AND NOT A SPEND CAP. It cannot charge anyone, it does not shrink with a
 * balance, and it is not a lever for monetising conversation — chat is free and stays free. It
 * exists only so one tenant's stuck retry loop cannot bill the platform for an unbounded number
 * of model calls while the merchant sees nothing wrong.
 *
 * WHY 60. Sized against the most demanding real hour we can name and then left generous: a
 * merchant working steadily with Otto sends a message every minute or two, and a beta session
 * that felt long measured well under twenty turns. Sixty is roughly one a minute for a solid
 * hour — past any human conversation — while still bounding a broken client to dozens of refused
 * calls an hour instead of thousands of paid ones. A gate that refuses honest work is an outage
 * we inflicted on ourselves; this one should never be reached by a person.
 */
export const OTTO_TURN_PER_TENANT_PER_HOUR = 60;

/**
 * Upload authorisation, per tenant, per hour.
 *
 * Every call mints a presigned URL into our own bucket. A bulk product import is tens of files
 * and a merchant may do several in a sitting, so the honest ceiling is high; 1000 bounds a script
 * without ever reaching a real import.
 */
export const UPLOAD_PER_TENANT_PER_HOUR = 1000;

/**
 * The signed media proxy, per calling address, per ten minutes.
 *
 * This one is generous ON PURPOSE. Its intended caller is a platform's own media-fetch fleet
 * pulling images for a post we already charged the merchant for, and those fleets are many
 * addresses making many requests. The cap exists to bound bulk scraping of signed URLs, not to
 * police the fetcher, so it sits far above any real fetch pattern.
 */
export const MEDIA_PROXY_PER_CALLER_PER_10_MIN = 600;

/** The password door. Returns the retry hint (ms) when refused, or null when allowed through. */
export async function consumePasswordDoor(requestHeaders: Headers): Promise<number | null> {
  const verdict = await consumeRateLimit([
    { key: `pw:${callerKey(requestHeaders)}`, max: PASSWORD_DOOR_PER_CALLER_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted ? null : verdict.retryAfterMs;
}

/**
 * The three public Better Auth doors (registration, password reset, verification resend), each
 * with its OWN hourly bucket so one door being spent never closes another.
 * Returns the retry hint (ms) when refused, or null when allowed through.
 */
export async function consumePublicAuthDoor(door: string, requestHeaders: Headers): Promise<number | null> {
  const verdict = await consumeRateLimit([
    {
      key: `authdoor:${door}:${callerKey(requestHeaders)}`,
      max: PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR,
      windowMs: HOUR,
    },
  ]);
  return verdict.granted ? null : verdict.retryAfterMs;
}

/** The paid generation dispatch. */
export async function consumeGenerationGate(ownerId: string): Promise<boolean> {
  const verdict = await consumeRateLimit([
    { key: `gen:${ownerId}`, max: GENERATION_PER_TENANT_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted;
}

/**
 * What a merchant is told when the Otto conversation gate refuses (Founder 2026-08-18).
 *
 * ONE sentence for BOTH doors — the streaming route and the non-streaming `ottoTurn` — so the two
 * entries to the same conversation cannot end up saying different things about the same limit.
 * Honest about the wait: the window is an hour, so "a moment" would be a promise it cannot keep.
 * It never mentions credits — nothing was charged, and hinting otherwise would undo the very
 * ruling this gate protects.
 */
export const OTTO_TURN_RATE_LIMIT_MESSAGE =
  "You've sent Otto a lot of messages in the last hour. Take a short break and try again a little later.";

/** The Otto conversation door — both entries (stream route and ottoTurn) go through this. */
export async function consumeOttoTurnGate(ownerId: string): Promise<boolean> {
  const verdict = await consumeRateLimit([
    { key: `otto:${ownerId}`, max: OTTO_TURN_PER_TENANT_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted;
}

/** Upload authorisation. */
export async function consumeUploadGate(ownerId: string): Promise<boolean> {
  const verdict = await consumeRateLimit([
    { key: `upload:${ownerId}`, max: UPLOAD_PER_TENANT_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted;
}

/**
 * The signed media proxy.
 *
 * The ONE gate that stays open when the counter cannot be reached, and the reason is specific to
 * this route: it is the only one that otherwise touches no database at all (its authorisation is
 * an HMAC the publish worker signed). Every other gate here guards work that needs Postgres
 * anyway, so refusing when Postgres is down costs nothing. Here it would cost something real — a
 * database blip would break a publish the merchant already paid for, and the rate limiter would
 * be the only reason it broke. Authorisation is unaffected either way: a forged, expired or
 * foreign token still 404s regardless of what this returns.
 */
export async function consumeMediaProxyGate(requestHeaders: Headers): Promise<boolean> {
  const verdict = await consumeRateLimit(
    [{ key: `media:${callerKey(requestHeaders)}`, max: MEDIA_PROXY_PER_CALLER_PER_10_MIN, windowMs: 10 * MINUTE }],
    { onStorageFailure: "allow" },
  );
  return verdict.granted;
}
