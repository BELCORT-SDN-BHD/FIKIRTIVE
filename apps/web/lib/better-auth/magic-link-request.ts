import "server-only";
import { normalizeMagicLinkEmail } from "./magic-link-contract";
import { enqueueAuthEmail } from "./sender";
import { sanitizeCallbackURL } from "@/lib/safe-redirect";

/**
 * #678 r3 — THE sign-in request path. Every public entrance to the magic-link door goes through
 * this function, and it is four fixed steps in a fixed order:
 *
 *   ① check the address is well FORMED — pure string work, and a well-formed address is well
 *      formed whether or not anybody owns it;
 *   ② one constant-cost throttle keyed on the CALLER, in our own layer;
 *   ③ hand an opaque job to the background — no allowlist, no per-address budget, no database,
 *      no branch of any kind on which address this is;
 *   ④ return the one answer.
 *
 * WHY IT HAD TO BECOME A SHAPE RULE. Two earlier rounds each removed one leak and grew the next
 * one from the same root: the request was still DOING different amounts of work depending on the
 * address. Round 1 made the two answers read alike, so the clock gave it away. Round 2 moved
 * delivery to the background, so the background's synchronous prefix gave it away — an address
 * on FOUNDER_ADMIN_EMAILS resolved out of a string list without suspending, an address that had
 * to be looked up in the database did not. The rule that ends the family is not "balance the
 * branches" but "have no branches": nothing on this path may ask a question whose cost depends
 * on the answer.
 *
 * WHY THE THROTTLE LIVES HERE. Better Auth 1.6.20 runs its `rateLimit` rules inside `auth.handler`
 * — the HTTP router. The login page never goes through that router; it calls a server action. So
 * the per-IP rule added in round 2 sat on a door nobody used, and the real door had no cap at all:
 * an anonymous caller could hand over unlimited jobs. This is the cap on the door that exists.
 */

const WINDOW_MS = 60 * 60 * 1000;

/** One caller + one address. Sized to a real merchant's worst hour: mistyped once, tried twice
 *  more, then asked for a fresh link. Beyond it the answer is unchanged and no job is queued. */
const MAX_PER_CALLER_PER_ADDRESS = 5;

/**
 * One caller, all addresses. This is the anti-enumeration bound, and it is deliberately loose
 * because the thing it is keyed on is shared.
 *
 * WHY NOT PER-IP ALONE. A cafe, a co-working floor and most mobile networks put many merchants
 * behind one egress address. A tight per-IP cap there is an availability interlock: the 21st
 * press of the hour locks out everyone else on the same wifi, and none of them can tell why.
 * WHY NOT PER-(IP+ADDRESS) ALONE. That bucket is free to create — one per address the caller
 * invents — so on its own it bounds nothing.
 *
 * So both, and the pair does the work: the tight bucket stops one address being hammered, and
 * this loose one bounds how many DISTINCT addresses a single egress can probe per hour. 60 is
 * twelve full retry budgets — more merchants than share one cafe's wifi in an hour — while an
 * enumeration run needs thousands.
 *
 * Both lookups are a Map hit on a string that was normalised before it was hashed, so they cost
 * the same for an address with an account, one on a list, and one nobody has ever heard of.
 */
const MAX_PER_CALLER = 60;

const buckets = new Map<string, number[]>();
let lastSweep = 0;

/** Drop buckets nobody has touched for a window. Runs at most once per window and is keyed on
 *  the clock, never on the submitted address. */
function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, stamps] of buckets) {
    const live = stamps.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

function take(key: string, max: number, now: number): boolean {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  const room = recent.length < max;
  if (room) recent.push(now);
  buckets.set(key, recent);
  return room;
}

/** Best-effort caller identity. Behind Railway's proxy this is `x-forwarded-for`; a request that
 *  arrives with neither header shares one bucket, which is the conservative direction. */
function callerKey(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0] : requestHeaders.get("x-real-ip");
  return (first ?? "").trim() || "unknown-caller";
}

/** The only two outcomes a caller may see. Being over the throttle is NOT one of them: it is
 *  swallowed here on purpose, so no caller — and no future edit to a caller — can turn it into
 *  a distinguishable answer. */
export type MagicLinkRequestOutcome = "accepted" | "invalid_email";

export function acceptMagicLinkRequest(input: {
  email: unknown;
  callbackURL: string | null | undefined;
  requestHeaders: Headers;
}): MagicLinkRequestOutcome {
  // ① format
  const email = normalizeMagicLinkEmail(input.email);
  if (!email) return "invalid_email";

  // ② throttle — both buckets are consumed unconditionally so the work does not depend on
  //    which one refuses.
  const now = Date.now();
  sweep(now);
  const caller = callerKey(input.requestHeaders);
  const roomForCaller = take(caller, MAX_PER_CALLER, now);
  const roomForPair = take(`${caller}|${email}`, MAX_PER_CALLER_PER_ADDRESS, now);

  // ③ hand over an opaque job
  if (roomForCaller && roomForPair) {
    enqueueAuthEmail({
      purpose: "sign-in-link",
      email,
      callbackURL: sanitizeCallbackURL(input.callbackURL),
    });
  }

  // ④ one answer.
  //
  // THE HONEST COST, stated plainly: a merchant who is over the throttle is told a link is on
  // its way and no link arrives. That is the price of an answer that cannot be read as "this
  // address exists" — the alternative is a distinct over-the-limit answer, which is only ever
  // reachable by someone who kept pressing, and a prober can keep pressing too.
  return "accepted";
}

/** TEST ONLY. The buckets are process memory with an hour-long window; a test that wants a
 *  fresh budget cannot wait one out. */
export function __resetMagicLinkThrottleForTests(): void {
  buckets.clear();
  lastSweep = 0;
}
