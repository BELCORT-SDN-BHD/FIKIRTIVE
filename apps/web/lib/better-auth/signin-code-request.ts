import "server-only";
import { consumeRateLimit, clearRateLimitCounters } from "@fikirtive/db/rate-limit";
import { normalizeSignInEmail } from "./signin-code-contract";
import { enqueueAuthEmail } from "./sender";
import { callerKey } from "@/lib/rate-limit-gates";

/**
 * #678 — THE sign-in request path. Every public entrance to the sign-in-code door goes through
 * this function, and it is four fixed steps in a fixed order:
 *
 *   ① check the address is well FORMED — pure string work, and a well-formed address is well
 *      formed whether or not anybody owns it;
 *   ② one constant-cost throttle keyed on the CALLER;
 *   ③ hand an opaque job to the background — no allowlist, no per-address budget, no branch of
 *      any kind on which address this is;
 *   ④ return the one answer.
 *
 * WHY IT HAD TO BECOME A SHAPE RULE. Successive rounds each removed one leak and grew the next
 * one from the same root: the request was still DOING different amounts of work depending on the
 * address. Making the two answers read alike left the clock. Moving delivery to the background
 * left the background's synchronous prefix — an address on FOUNDER_ADMIN_EMAILS resolved out of
 * a string list without suspending, an address that had to be looked up in the database did not.
 * The rule that ends the family is not "balance the branches" but "have no branches": nothing on
 * this path may ask a question whose cost depends on the answer.
 *
 * THAT INCLUDES THE THROTTLE'S OWN VERDICT. An over-budget request used to skip the sanitise,
 * the job, the push and the timer while returning the same words — the same defect, rebuilt
 * inside the fix for it. Step ③ now runs identically for every request and the verdict rides on
 * the job, to be applied by the background executor.
 *
 * WHY THE THROTTLE LIVES HERE AND NOT IN BETTER AUTH'S CONFIG. Better Auth 1.6.20 runs its
 * `rateLimit` rules inside `auth.handler` — the HTTP router. The login page never goes through
 * that router; it calls a server action. So a per-IP rule in that config sat on a door nobody
 * used, and the real door had no cap at all. Since the switch to codes there is no HTTP door for
 * this half of the flow at all: the endpoint that mints a code is in `disabledPaths`
 * (lib/better-auth/server.ts), so THIS function is the only public way to ask for one.
 *
 * #795 — WHERE THE COUNTING MOVED, AND WHY THE PROPERTIES SURVIVED.
 *
 * The buckets used to be a `Map` in this process. That made the published cap a fiction the
 * moment a second web instance existed: two instances, two maps, twice the budget — and every
 * deploy reset every window. On an open-registration beta this is the door that carries the load,
 * so the counters moved to Postgres (packages/db `consumeRateLimit`, one shared row per bucket).
 *
 * Everything this file argued for is now a property of that function rather than of a local ring
 * buffer, and all three are tested against a real database there:
 *   · a refused request charges NOTHING, so a retry loop cannot renew the window it was refused
 *     by (#757 — the lockout with no end, which on a shared egress address is somebody else's
 *     lockout);
 *   · a request is charged to EVERY bucket or to none, so the address bucket refusing cannot
 *     spend the shared caller budget (#757 r2 — the same defect, one bucket over);
 *   · both verdicts do the same work — one statement that reads and writes either way — so the
 *     answer below is not merely worded identically, it costs the same.
 *
 * FAIL CLOSED, and it lands where it should. If the counter is unreachable, `consumeRateLimit`
 * refuses (its default), so the job is handed over marked over-budget and dropped on the
 * background side: the merchant gets the same "check your email" they always get, and no code
 * arrives. That is the same honest cost step ④ already documents — never a distinguishable
 * answer, and never an uncounted door.
 */

const WINDOW_MS = 60 * 60 * 1000;

/** One caller + one address. Sized to a real merchant's worst hour: mistyped once, tried twice
 *  more, then asked for a fresh code. Beyond it the answer is unchanged and the job is dropped
 *  on the background side.
 *
 *  It is also half of what bounds guessing a code: a caller can only cause five codes an hour to
 *  be issued for one address, and Better Auth allows three guesses per code before locking the
 *  identifier (`allowedAttempts`, lib/better-auth/server.ts). Fifteen tries an hour against a
 *  six-digit space is the real ceiling on brute force, and it is set here and there — not by a
 *  limiter on the door where the code is typed. */
export const MAX_PER_CALLER_PER_ADDRESS = 5;

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
 */
export const MAX_PER_CALLER = 60;

/** Namespaced so this door's counters can never collide with another gate's (#795). */
const CALLER_BUCKET = (caller: string) => `signincode:${caller}`;
const ADDRESS_BUCKET = (caller: string, email: string) => `signincode:${caller}|${email}`;

/** The only two outcomes a caller may see. Being over the throttle is NOT one of them: it is
 *  swallowed here on purpose, so no caller — and no future edit to a caller — can turn it into
 *  a distinguishable answer. */
export type SignInCodeRequestOutcome = "accepted" | "invalid_email";

export async function acceptSignInCodeRequest(input: {
  email: unknown;
  requestHeaders: Headers;
}): Promise<SignInCodeRequestOutcome> {
  // ① format
  const email = normalizeSignInEmail(input.email);
  if (!email) return "invalid_email";

  // ② throttle — BOTH buckets in one call, so they are read together, decided together and
  //    written together. Neither is charged unless the request as a whole was granted: a bucket
  //    that still had room must not bank a press the other bucket refused, or one address's retry
  //    loop spends the shared budget every other merchant behind the same egress is sharing.
  //    Both keys are strings that were normalised before they were hashed, so consulting them
  //    costs the same for an address with an account, one on a list, and one nobody has ever
  //    heard of.
  const caller = callerKey(input.requestHeaders);
  const verdict = await consumeRateLimit([
    { key: CALLER_BUCKET(caller), max: MAX_PER_CALLER, windowMs: WINDOW_MS },
    { key: ADDRESS_BUCKET(caller, email), max: MAX_PER_CALLER_PER_ADDRESS, windowMs: WINDOW_MS },
  ]);

  // ③ hand over an opaque job — ALWAYS, and always after the same work. The verdict travels
  //    with the job; the executor is what drops it.
  //
  //    Nothing about where the merchant wanted to end up travels with it any more: a code does
  //    not navigate, so the login page keeps its own redirect and this path carries one fewer
  //    caller-supplied value.
  enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: !verdict.granted });

  // ④ one answer.
  //
  // THE HONEST COST, stated plainly: a merchant who is over the throttle is told a code is on
  // its way and no code arrives. That is the price of an answer that cannot be read as "this
  // address exists" — the alternative is a distinct over-the-limit answer, which is only ever
  // reachable by someone who kept pressing, and a prober can keep pressing too.
  return "accepted";
}

/** TEST ONLY. The buckets have an hour-long window; a test that wants a fresh budget cannot wait
 *  one out. #795 — they are shared rows now, so clearing them is a delete and this is async. */
export async function __resetSignInCodeThrottleForTests(): Promise<void> {
  await clearRateLimitCounters("signincode:");
}
