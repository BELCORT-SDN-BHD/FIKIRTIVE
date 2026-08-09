import "server-only";
import { normalizeMagicLinkEmail } from "./magic-link-contract";
import { enqueueAuthEmail } from "./sender";
import { sanitizeCallbackURL } from "@/lib/safe-redirect";

/**
 * #678 — THE sign-in request path. Every public entrance to the magic-link door goes through
 * this function, and it is four fixed steps in a fixed order:
 *
 *   ① check the address is well FORMED — pure string work, and a well-formed address is well
 *      formed whether or not anybody owns it;
 *   ② one constant-cost throttle keyed on the CALLER, in our own layer;
 *   ③ hand an opaque job to the background — no allowlist, no per-address budget, no database,
 *      no branch of any kind on which address this is;
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
 * WHY THE THROTTLE LIVES HERE. Better Auth 1.6.20 runs its `rateLimit` rules inside `auth.handler`
 * — the HTTP router. The login page never goes through that router; it calls a server action. So
 * a per-IP rule in that config sat on a door nobody used, and the real door had no cap at all:
 * an anonymous caller could hand over unlimited jobs. This is the cap on the door that exists.
 */

const WINDOW_MS = 60 * 60 * 1000;

/** One caller + one address. Sized to a real merchant's worst hour: mistyped once, tried twice
 *  more, then asked for a fresh link. Beyond it the answer is unchanged and the job is dropped
 *  on the background side. */
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

/**
 * A hard ceiling on how many buckets exist at once, because the KEY SPACE IS ATTACKER-CHOSEN.
 * A caller past its own budget keeps being counted (that is what keeps the work identical), and
 * every fresh address it invents is a fresh `caller|address` key — so without a ceiling one
 * anonymous caller can grow this map without limit.
 *
 * The map is therefore an LRU: every `take` moves its key to the end, and one insertion past the
 * ceiling evicts the least recently used key. That is O(1) per call and, unlike "stop creating
 * buckets once the caller is over budget", it does not make the over-budget path cheaper than
 * the normal one — which is the trap the fix above exists to avoid.
 *
 * 20 000 entries is far more than a real hour of traffic for this product, and each is a short
 * key plus at most 60 timestamps, so the worst case is single-digit megabytes. What an attacker
 * buys by filling it is eviction of somebody else's counters — a rate-limit reset, never access,
 * and never an answer about whether an address exists.
 */
export const MAX_TRACKED_BUCKETS = 20_000;

/**
 * One bucket is a FIXED-SIZE ring of the last `max` GRANTED request times, plus one extra slot
 * at the end that is written and never read.
 *
 * The fixed size is what makes the cost of consulting it the same every time. A list that grew
 * from zero to sixty entries took a different amount of work to scan depending on how much of
 * its budget the caller had spent, and a full bucket skipped the write a fresh one performed —
 * so "how expensive was this request" leaked how close the caller was to its limit. A ring of
 * exactly `max` slots is scanned `max` times and written once, always.
 *
 * #757 — WHAT THE EXTRA SLOT IS FOR. The ring used to slide on REQUESTS: a refused press
 * overwrote the oldest grant with its own time, so the window never ended while anyone kept
 * pressing. Read as an abuse cap that sounded strict; read as availability it was a lockout with
 * no end, and — because the loose bucket is keyed on a SHARED egress address — usually somebody
 * else's lockout. One person's retry loop on a cafe's wifi held the whole floor's sixty-address
 * budget open indefinitely, and none of the others could tell why their link stopped coming.
 *
 * The sustained rate is the same either way (a prober who pauses for an hour always had it), so
 * the old reading bought nothing but starving the impatient user's neighbours. The window now
 * slides on GRANTS. Keeping the write identical is what the extra slot is for: a refusal still
 * performs exactly one array write, into a sink nothing ever scans, so the cost parity r5 asked
 * for survives while the window it was refused by is allowed to end.
 *
 * r2 — AND "GRANT" MEANS THE REQUEST, NOT THE BUCKET. A press is charged to a ring only when
 * EVERY bucket had room for it; a bucket that still had room does not bank a press that the
 * other bucket refused. See `probe`/`commit` for why that had to become two steps.
 *
 * The cap this enforces is unchanged and still tight: one grant always costs one slot in BOTH
 * buckets, so an egress address still buys at most sixty granted presses — and therefore at most
 * sixty distinct addresses — per rolling hour.
 */
type Bucket = { stamps: number[]; next: number };

const buckets = new Map<string, Bucket>();

/**
 * Drop buckets whose slots have all aged out — the sink included, so a caller who is still being
 * refused keeps its bucket rather than being handed a fresh one. NOT called from
 * `acceptMagicLinkRequest`: a full traversal is O(number of buckets), and running it on the
 * request thread hands an attacker who filled the map an event-loop stall. It rides its own timer
 * instead, and `unref` keeps it from holding a process (or a test run) open.
 */
function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.stamps.every((t) => now - t >= WINDOW_MS)) buckets.delete(key);
  }
}

const sweepTimer: unknown = setInterval(() => sweepExpired(Date.now()), WINDOW_MS);
(sweepTimer as { unref?: () => void }).unref?.();

/** Always called, so the eviction step is part of every request's cost rather than of some.
 *  Whether it actually removes anything depends on the TOTAL size of the map — a global
 *  property, not a property of this address or of how much budget this caller has left. */
function evictOldestWhenFull(): void {
  if (buckets.size <= MAX_TRACKED_BUCKETS) return;
  const oldest = buckets.keys().next().value;
  if (oldest !== undefined) buckets.delete(oldest);
}

/**
 * Consulting a bucket is TWO halves, and #757 r2 is why they had to come apart.
 *
 * They used to be one `take` that read its own bucket and immediately wrote it on its own
 * verdict. With two buckets that produced a state neither of them could see: the sixth press for
 * one address is refused as a REQUEST (the address bucket is full) while the shared caller
 * bucket still has room — so `take` on the caller bucket called it a grant and charged it. One
 * merchant retrying one address therefore walked the shared sixty-slot ring round and round, and
 * every other merchant behind that egress address stopped getting sign-in links. That is the
 * defect this ticket exists to remove, rebuilt one bucket over.
 *
 * The rule that ends it is not "fix the caller bucket" but "a refused request charges nothing":
 * every bucket is READ first, the one verdict is computed from all of them, and only then is
 * anything written. Splitting the halves is what makes that expressible.
 */
type Probe = { key: string; bucket: Bucket; max: number; room: boolean };

/** Half one — READ ONLY: one Map read and a fixed `max`-slot scan, the same on every call. */
function probe(key: string, max: number, now: number): Probe {
  const bucket = buckets.get(key) ?? { stamps: new Array<number>(max + 1).fill(0), next: 0 };
  let live = 0;
  for (let i = 0; i < max; i += 1) if (now - bucket.stamps[i] < WINDOW_MS) live += 1;
  return { key, bucket, max, room: live < max };
}

/**
 * Half two — WRITE, with the verdict of the whole REQUEST rather than of this bucket alone: one
 * array write, one field write, one delete + one set (the LRU touch), one eviction step. Every
 * one of those happens on both verdicts, so a refused request still costs exactly what a granted
 * one costs; only the slot the timestamp lands in differs. A grant advances the ring; a refusal
 * lands in the sink — the slot past the ring, which nothing ever scans — leaving the ring where
 * it was, so it cannot push the window forward.
 */
function commit(probed: Probe, granted: boolean, now: number): void {
  const { key, bucket, max } = probed;
  bucket.stamps[granted ? bucket.next : max] = now;
  bucket.next = granted ? (bucket.next + 1) % max : bucket.next;

  buckets.delete(key);
  buckets.set(key, bucket);
  evictOldestWhenFull();
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

  // ② throttle — READ both buckets, decide once, then WRITE both. Both are touched on every
  //    request so the work does not depend on which one refuses, and (r2) neither is CHARGED
  //    unless the request as a whole was granted: a bucket that still had room must not bank a
  //    press the other bucket refused, or one address's retry loop spends the shared budget that
  //    every other merchant behind the same egress address is sharing.
  const now = Date.now();
  const caller = callerKey(input.requestHeaders);
  const callerBudget = probe(caller, MAX_PER_CALLER, now);
  const addressBudget = probe(`${caller}|${email}`, MAX_PER_CALLER_PER_ADDRESS, now);
  const granted = callerBudget.room && addressBudget.room;
  commit(callerBudget, granted, now);
  commit(addressBudget, granted, now);

  // ③ hand over an opaque job — ALWAYS, and always after the same work. The verdict travels
  //    with the job; the executor is what drops it.
  enqueueAuthEmail({
    purpose: "sign-in-link",
    email,
    callbackURL: sanitizeCallbackURL(input.callbackURL),
    overBudget: !granted,
  });

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
}

/** TEST ONLY. The sweep runs on its own hourly timer in production; this is how a test reaches
 *  it without waiting an hour. */
export function __sweepMagicLinkThrottleForTests(now: number = Date.now()): void {
  sweepExpired(now);
}

/** TEST ONLY. The ceiling is the claim; a test has to be able to see the map to check it. */
export function __magicLinkThrottleSizeForTests(): number {
  return buckets.size;
}

/** TEST ONLY. "A refused request does the same work as a granted one" is a claim about what the
 *  bucket looks like afterwards, so a test has to be able to look. The ring and the sink are
 *  reported apart, because the claims about them are opposite ones: the ring must be unchanged
 *  by a refusal, the sink must have been written. */
export function __magicLinkThrottleBucketForTests(
  key: string,
): { stamps: number[]; next: number; sink: number } | undefined {
  const bucket = buckets.get(key);
  if (!bucket) return undefined;
  const max = bucket.stamps.length - 1;
  return { stamps: bucket.stamps.slice(0, max), next: bucket.next, sink: bucket.stamps[max] };
}
