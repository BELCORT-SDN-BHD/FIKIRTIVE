import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { emailPort } from "@/lib/email";
import { isAllowedEmail } from "@/lib/allowlist";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_ADDRESS_PER_WINDOW = 5;
const addressAttempts = new Map<string, number[]>();

/** #678 — the per-address bucket key is NORMALISED (trim + lowercase).
 *
 *  It used to be the raw submitted string. Addresses are case-insensitive in the part that
 *  routes them, and the allowlist has always lower-cased before comparing, so `owner@Shop.test`
 *  and `owner@shop.test` are one merchant everywhere EXCEPT here — where they used to be two
 *  independent hourly budgets. Flipping one letter's case bought a fresh five. */
function addressKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Drop addresses nobody has written to for a window. `/send-verification-email` is a public
 *  endpoint, so without this the map grows one entry per address anyone ever submits and never
 *  gives one back. Runs at most once per window, and only on this background side. */
let lastSweep = 0;
function sweepAddressCaps(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, stamps] of addressAttempts) {
    const live = stamps.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) addressAttempts.delete(key);
    else addressAttempts.set(key, live);
  }
}

/** Per-address outbound cap — UNCHANGED at 5 auth emails per address per hour. It runs on the
 *  BACKGROUND side so that not even a branch on it exists in the request path. */
function consumeAddressCap(email: string): boolean {
  const key = addressKey(email);
  const now = Date.now();
  sweepAddressCaps(now);
  const recent = (addressAttempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_ADDRESS_PER_WINDOW) {
    addressAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  addressAttempts.set(key, recent);
  return true;
}

/**
 * A queued auth email. Deliberately opaque: a normalised address, what it is FOR, and — for the
 * sign-in link — whether the request that produced it was inside its budget.
 *
 * `overBudget` RIDES ON THE JOB rather than gating the enqueue, and that placement is the point.
 * Skipping the hand-over for an over-budget request meant the request did strictly less work
 * (no sanitise, no job, no push, no timer) while returning the same words — the very shape
 * difference this ticket exists to remove, rebuilt inside its own throttle. Every request now
 * performs the identical four steps and this module is what drops the job.
 */
export type AuthEmailJob =
  | { purpose: "sign-in-link"; email: string; callbackURL: string; overBudget: boolean }
  | { purpose: "password-reset"; email: string; url: string }
  | { purpose: "verify-email"; email: string; url: string };

const isDiscardable = (job: AuthEmailJob): boolean =>
  job.purpose === "sign-in-link" && job.overBudget;

// ── executor tuning ──────────────────────────────────────────────────────────────────────────

/**
 * #757 — HOW LONG THE THING IN THE ENVELOPE STAYS USABLE, and the single place that decides it.
 *
 * A sign-in link is a credential with an expiry, so every other number in this file is measured
 * against it: a queue may only be as deep as the mail it holds can still be delivered in time.
 * That made it the one constant that must not be restated anywhere — and it was. Better Auth's
 * `magicLink({ expiresIn })` in server.ts carried its own literal `60 * 15`, and the queue's
 * capacity carried a comment quoting it. Two copies of a load-bearing number is one edit away
 * from a queue that sizes itself against a lifetime nothing enforces, and nothing would fail.
 *
 * server.ts now reads `AUTH_EMAIL_LINK_TTL_SECONDS` from here, so there is one number.
 */
export const AUTH_EMAIL_LINK_TTL_MS = 15 * 60 * 1000;

/** The same lifetime in the unit Better Auth's plugin takes. Derived, never restated. */
export const AUTH_EMAIL_LINK_TTL_SECONDS = AUTH_EMAIL_LINK_TTL_MS / 1000;

/**
 * How many auth-email jobs may be in flight at once.
 *
 * WHY NOT ONE. A single serial worker made every job wait for the one in front of it, and that
 * turned the queue into a clock an attacker could read. Submit the address you want to probe,
 * then immediately submit your own address, which you can receive mail at: your mail's lateness
 * answers a question about somebody else's address. Serial execution also meant one slow
 * provider call held up every other tenant's sign-in link.
 *
 * WHY NOT MANY. The far side is one shared mail provider with its own rate limits; a large pool
 * would turn a burst into 429s, which is the failure this system is least able to surface.
 */
export const AUTH_EMAIL_MAX_CONCURRENCY = 4;

/**
 * THE FLOOR. Every job holds its worker slot for at least this long, whichever branch it took.
 *
 * WHY THIS AND NOT MORE JITTER. Concurrency stopped a canary from queueing BEHIND a probe, but
 * it left a subtler channel: WHEN THE SLOT COMES BACK. An address with no access returns at the
 * allowlist check in a few milliseconds and frees its worker at once; an address with access
 * mints a token, re-checks and waits on the mail provider, so its worker comes back much later
 * — up to the deadline if the provider hangs. Anyone who can watch the pool's availability (by
 * timing their own mail through it) reads that difference. There is a reverse form too: an
 * address that is ON a list but has spent its hourly send budget answers out of memory with no
 * database work at all, faster than an unknown address's database miss. Jitter cannot close
 * either one — it is zero-mean noise that averages away, while the branch difference does not.
 *
 * Holding the slot for a fixed floor makes all three indistinguishable from outside: fast
 * return, slow return and instant memory return all give the worker back at the same moment.
 *
 * WHY 3 SECONDS. It has to exceed the real work comfortably — an allowlist query, a token write
 * and one provider round trip are a few hundred milliseconds at worst — so that the work's own
 * duration never shows through. It also sets throughput: four slots at three seconds is 1.33
 * jobs a second, about 4 800 an hour, far above what a product sending tens of auth emails an
 * hour needs. Beyond the floor only a genuinely slow provider shows, and that is bounded by the
 * deadline below and covered by the jitter.
 */
export const AUTH_EMAIL_SLOT_FLOOR_MS = 3_000;

/**
 * Each job waits a uniformly random 0–2000 ms before it starts, and the floor above is measured
 * from the END of that wait.
 *
 * Ordering it this way is what keeps it harmless: the random part is added to every job equally
 * and the floor still covers the whole of the branch-dependent work, so slot release is
 * `jitter + floor` — random, but random in a way that has nothing to do with which branch ran.
 * (Measuring the floor from before the jitter instead would have let a long draw and a long
 * branch add up, which is the variance the floor exists to remove.)
 *
 * It is defence in depth now, not the primary cover: it stops two jobs handed over milliseconds
 * apart from starting together and contending for the same scheduler, database pool and socket
 * pool at exactly the same instant.
 *
 * #757 (P3) — THE WAIT HOLDS A WORKER SLOT, and it stays that way on purpose. Moving it in front
 * of the pool would buy a little throughput and cost a third population of jobs (waiting, but
 * neither queued nor in flight) that every capacity check would have to remember to count — the
 * kind of bookkeeping that goes wrong quietly. The consequence that actually mattered was the
 * capacity arithmetic under-counting a slot, and that is fixed where it belongs: the jitter is
 * part of `AUTH_EMAIL_WORST_SLOT_MS`, so the depth is derived from what a slot really costs.
 */
export const AUTH_EMAIL_JITTER_MAX_MS = 2000;

/**
 * A job gets 20 seconds, end to end, and then its slot is taken back.
 *
 * The mail adapter's `fetch` had no deadline and no cancel: a provider that accepts a connection
 * and never answers held the worker forever. The signal below is a real cancel (it reaches
 * `fetch`); the race is the belt for anything that ignores it. 20 s is several times a healthy
 * provider round trip, so nothing legitimate is cut short.
 */
export const AUTH_EMAIL_JOB_TIMEOUT_MS = 20_000;

/**
 * #757 — THE LONGEST ONE JOB CAN OCCUPY A WORKER.
 *
 * The floor is a MINIMUM hold, and the previous round's capacity arithmetic read it as if it
 * were the maximum: it costed a slot at floor + jitter (5 s) and concluded a 500-deep queue
 * drained in ten and a half minutes, comfortably inside a link's fifteen. But a job that runs
 * to its deadline holds the slot for the jitter plus the whole timeout, and nothing caps it
 * below that — a mail provider that accepts connections and stops answering puts EVERY job on
 * that branch at once. The honest slot length is therefore the jitter plus whichever of the
 * floor and the deadline is longer: 22 seconds, not 5.
 */
export const AUTH_EMAIL_WORST_SLOT_MS =
  AUTH_EMAIL_JITTER_MAX_MS + Math.max(AUTH_EMAIL_SLOT_FLOOR_MS, AUTH_EMAIL_JOB_TIMEOUT_MS);

/**
 * How many jobs may be outstanding at once, across everything not yet finished.
 *
 * WHY A BOUND AT ALL. Every valid request hands over a job — including the over-budget ones,
 * because making them cheaper is itself a timing channel. Unbounded, that means one anonymous
 * caller can grow this queue without limit and starve every merchant's sign-in link, password
 * reset and verification email behind their backlog. A bound turns that into a bounded amount
 * of dropped mail with an operator log, which is a far better failure.
 *
 * #757 — WHY IT IS NOT A NUMBER ANY MORE. A bound only helps if a job that lands at the BACK of
 * the queue still arrives while the link it carries is alive; past that point the queue is full
 * of credentials that will be posted dead, which costs the merchant their hourly budget as well
 * as their link. 500 was chosen against a five-second slot and fails against a twenty-two-second
 * one — the same 500 jobs take 45.8 minutes to clear, so everything past roughly the 163rd was
 * always going to be posted after it expired.
 *
 * So the depth is DERIVED from the three quantities it depends on, and the inequality
 * `depth × worst slot ÷ workers ≤ link lifetime` holds by construction rather than by comment.
 * Change the deadline, the pool or the link's life and the depth follows on its own.
 */
export const AUTH_EMAIL_MAX_QUEUED = Math.floor(
  (AUTH_EMAIL_LINK_TTL_MS * AUTH_EMAIL_MAX_CONCURRENCY) / AUTH_EMAIL_WORST_SLOT_MS,
);

/** One drop line per ten seconds. The case it fires in is a flood, and a line per dropped job
 *  would be a second denial of service. */
export const AUTH_EMAIL_DROP_LOG_INTERVAL_MS = 10_000;

let maxConcurrency = AUTH_EMAIL_MAX_CONCURRENCY;
let slotFloorMs = AUTH_EMAIL_SLOT_FLOOR_MS;
let jitterMaxMs = AUTH_EMAIL_JITTER_MAX_MS;
let jobTimeoutMs = AUTH_EMAIL_JOB_TIMEOUT_MS;
let maxQueued = AUTH_EMAIL_MAX_QUEUED;
let dropLogIntervalMs = AUTH_EMAIL_DROP_LOG_INTERVAL_MS;
let randomSource: () => number = Math.random;
const realSleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));
let sleep: (ms: number) => Promise<void> = realSleep;

/**
 * The job currently running, so `sendAuthEmail` can reach its deadline without every layer in
 * between having to carry a parameter. Same process, same call chain — nothing outside this
 * module can put a value in here.
 *
 * `sendDispatched` is set the moment a send is handed to the transport, and #757 is why it
 * exists: an abort cancels our wait, it does not un-accept a request the provider already took.
 * A job that dies at its deadline WITHOUT having dispatched anything definitely sent nothing; a
 * job that dies with a request on the wire is genuinely indeterminate, and the operator log has
 * to be able to tell an operator which of the two they are looking at.
 */
type JobContext = { signal: AbortSignal; sendDispatched: boolean };
const jobAbortStore = new AsyncLocalStorage<JobContext>();

/**
 * Jobs that will be delivered, and jobs the throttle already refused. Two collections rather than
 * one so "drop the refused ones first" is a single removal rather than a scan — a scan on the
 * request thread is the very thing the bucket map had to stop doing.
 *
 * #757 (P3) — the deliverable side is a LINKED LIST, not an array with `shift()`. `shift()` moves
 * every remaining element on each dequeue, so draining a full queue cost O(depth²) and the depth
 * is chosen by whoever is flooding. Two pointers make both ends O(1) with no compaction heuristic
 * and no array that quietly grows while its head marches along it.
 *
 * The refused side stays an array because `pump` discards the whole of it at once and nothing
 * ever reads it in order; taking from its END is O(1) and picks an equally undeliverable job.
 */
type QueueNode = { job: AuthEmailJob; next: QueueNode | null };
let pendingHead: QueueNode | null = null;
let pendingTail: QueueNode | null = null;
let pendingCount = 0;

function pushPending(job: AuthEmailJob): void {
  const node: QueueNode = { job, next: null };
  if (pendingTail) pendingTail.next = node;
  else pendingHead = node;
  pendingTail = node;
  pendingCount += 1;
}

function takePending(): AuthEmailJob | undefined {
  const node = pendingHead;
  if (!node) return undefined;
  pendingHead = node.next;
  if (!pendingHead) pendingTail = null;
  pendingCount -= 1;
  return node.job;
}

const refused: AuthEmailJob[] = [];
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
const inFlight = new Set<Promise<void>>();
/** Work abandoned at its deadline but possibly still alive. Kept so `authEmailQueueSettled`
 *  cannot report "done" while it is running, and so nothing it does can arrive unnoticed. */
const straggling = new Set<Promise<unknown>>();

let droppedSinceLastLog = 0;
let lastDropLog = 0;
let dropLogTimer: ReturnType<typeof setTimeout> | null = null;

function flushDropLog(): void {
  dropLogTimer = null;
  if (droppedSinceLastLog === 0) return;
  console.warn(`[better-auth] auth email queue full: dropped ${droppedSinceLastLog} job(s)`);
  droppedSinceLastLog = 0;
  lastDropLog = Date.now();
}

/**
 * #757 (P3) — the aggregation window is a RATE LIMIT, not a filter.
 *
 * It used to be both by accident: a line went out only when a NEW drop arrived after the window,
 * so whatever was dropped in a flood's final seconds sat in the counter forever. Every flood
 * ends, so every flood ended with its tail unreported — the operator was told about one dropped
 * job for an incident that dropped thousands. The residue now rides a timer of its own, and
 * `unref` keeps it from holding a process (or a test run) open.
 */
function noteDrop(): void {
  droppedSinceLastLog += 1;
  const since = Date.now() - lastDropLog;
  if (since >= dropLogIntervalMs) {
    flushDropLog();
    return;
  }
  if (dropLogTimer) return;
  dropLogTimer = setTimeout(flushDropLog, dropLogIntervalMs - since);
  (dropLogTimer as { unref?: () => void }).unref?.();
}

const outstanding = (): number => pendingCount + refused.length + inFlight.size;

/**
 * #678 — put an auth email on the background queue and return. NOTHING about the job runs before
 * this function returns, and that is the whole security property.
 *
 * The hand-over is a capacity check, one push and (at most) one timer — all constant cost, none
 * of it dependent on the address or on the throttle's verdict.
 *
 * WHY A TIMER AND NOT "just start the async function". An earlier round handed the job over by
 * calling an `async` function and not awaiting it. That still runs the function's SYNCHRONOUS
 * PREFIX — every statement up to its first real suspension — inside the request. For an address
 * on FOUNDER_ADMIN_EMAILS or AUTH_ALLOWED_EMAILS the access check answers out of a string list
 * with no suspension at all, so the budget check and the send were dispatched before the
 * response was built, while an address that had to be looked up in the database stopped at the
 * query. Same words, measurably different amount of work.
 *
 * SINGLE PROCESS. The queue lives in this process's memory, exactly like the hourly caps it
 * enforces. A process that dies between the hand-over and the send loses that email — the
 * merchant presses the button again.
 */
export function enqueueAuthEmail(job: AuthEmailJob): void {
  if (outstanding() >= maxQueued) {
    // Make room by dropping a job the throttle already refused — those were never going to be
    // delivered, so they are the cheapest thing in the queue to lose. If there are none, the
    // incoming job is dropped instead. Either way the merchant's answer is unchanged; this is
    // an operator signal only.
    if (refused.length > 0) refused.pop();
    else {
      noteDrop();
      return;
    }
    noteDrop();
  }

  if (isDiscardable(job)) refused.push(job);
  else pushPending(job);
  if (pumpTimer) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, 0);
}

/** Start as many jobs as the concurrency budget allows. Called after a job becomes runnable and
 *  again whenever a slot frees up. */
function pump(): void {
  // Refused jobs never take a slot. They exist only so the request that produced them did the
  // same work as any other; making a flood of them occupy workers for the floor below would be
  // exactly the starvation the capacity bound exists to prevent. Their verdict came from the
  // caller's own request count, never from anything about the address, so discarding them
  // cheaply reveals nothing.
  refused.length = 0;

  while (pendingCount > 0 && inFlight.size < maxConcurrency) {
    const job = takePending();
    if (!job) break;
    const running: Promise<void> = runOneJob(job).finally(() => {
      inFlight.delete(running);
      pump();
    });
    inFlight.add(running);
  }
}

async function runOneJob(job: AuthEmailJob): Promise<void> {
  // The random part first, then the floor measured from here — see AUTH_EMAIL_JITTER_MAX_MS for
  // why this order and not the other one.
  await sleep(Math.min(jitterMaxMs, Math.floor(randomSource() * (jitterMaxMs + 1))));
  const workStartedAt = Date.now();

  const controller = new AbortController();
  let clearDeadline!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("AuthEmailJobTimeout"));
    }, jobTimeoutMs);
    clearDeadline = () => clearTimeout(timer);
  });
  deadline.catch(() => {});

  const context: JobContext = { signal: controller.signal, sendDispatched: false };
  const work = jobAbortStore.run(context, () => runAuthEmailJob(job));
  work.catch(() => {});

  try {
    await Promise.race([work, deadline]);
  } catch (error: unknown) {
    // Every failure past the hand-over is an OPERATOR concern: fixed category, no address
    // (#575 log discipline). Alerting on these lines is what carries "a merchant is waiting for
    // a link that never came" now that the response cannot.
    //
    // #757 — and the two kinds of timeout are not the same operational fact. "Nothing was sent"
    // is actionable (re-send it); "we abandoned a request that was already with the provider" is
    // not, because the provider may well have posted it and a re-send would put a second live
    // link in the same inbox. Saying so is the only honest line, and it is the reason the send
    // carries an idempotency key: it makes the recovery safe when an operator takes it anyway.
    const timedOut = error instanceof Error && error.message === "AuthEmailJobTimeout";
    const reason = timedOut
      ? context.sendDispatched
        ? "timeout after the send was dispatched — delivery outcome unknown"
        : "timeout"
      : error instanceof Error
        ? error.name
        : "unknown";
    console.error("[better-auth] auth email job failed:", reason);
    if (timedOut) {
      // The slot is back, but the work may not be finished. Hold a handle to it so a shutdown
      // (or a test) can tell the difference between "abandoned" and "gone".
      const straggler: Promise<unknown> = work.finally(() => straggling.delete(straggler));
      straggling.add(straggler);
    }
  } finally {
    clearDeadline();
  }

  // THE FLOOR. Whichever branch ran — allowlist miss, spent budget, or a full mint-and-send —
  // the slot goes back at the same moment. This runs unconditionally; when the work already took
  // longer than the floor the wait is zero.
  await sleep(Math.max(0, slotFloorMs - (Date.now() - workStartedAt)));
}

async function runAuthEmailJob(job: AuthEmailJob): Promise<void> {
  if (job.purpose === "sign-in-link") {
    // ORDER MATTERS. Access first, minting second: an address without access never reaches
    // Better Auth, so it never writes a verification row. That is what closes "an anonymous
    // caller can write unbounded verification rows" — the row is a consequence of being
    // allowed in, not of having asked.
    if (!(await isAllowedEmail(job.email))) return;
    if (!consumeAddressCap(job.email)) {
      console.warn("[better-auth] auth email suppressed: per-address hourly cap reached");
      return;
    }
    // Dynamic import breaks the cycle (server.ts imports this module for its send hooks) and
    // costs nothing here — this is the background, and the module is already resident.
    const { auth } = await import("./server");
    await auth.api.signInMagicLink({
      body: { email: job.email, callbackURL: job.callbackURL },
      headers: internalCallHeaders(),
    });
    return;
  }

  // Password reset re-checks access; verification email is the ONE path a brand-new
  // self-service account walks before it is on any list (#543), so it does not.
  if (job.purpose === "password-reset" && !(await isAllowedEmail(job.email))) return;
  if (!consumeAddressCap(job.email)) {
    console.warn("[better-auth] auth email suppressed: per-address hourly cap reached");
    return;
  }
  await sendAuthEmail({
    to: job.email,
    subject: job.purpose === "password-reset" ? "Reset your Fikirtive password" : "Verify your Fikirtive email",
    url: job.url,
    intro: job.purpose === "password-reset" ? "Reset your password" : "Verify your email",
  });
}

/** Headers for the background's own call into Better Auth. Fixed and caller-independent: the
 *  merchant's request is long gone by now, and nothing about it should reach this call. */
function internalCallHeaders(): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  const base = process.env.BETTER_AUTH_URL;
  if (base) {
    try {
      headers.set("origin", new URL(base).origin);
    } catch {
      /* a malformed BETTER_AUTH_URL is already fatal elsewhere; do not add a second failure here */
    }
  }
  return headers;
}

/**
 * #757 — ONE MINTED LINK IS ONE EMAIL, however many times it is dispatched.
 *
 * Derived from the message rather than from the attempt, which is the whole point: two dispatches
 * of the same link produce the same key and the provider delivers one of them, while two
 * different links are two different emails and are left alone. A per-attempt id (a job uuid, a
 * timestamp) would de-duplicate nothing, since the case worth surviving is precisely the second
 * attempt at the first message.
 *
 * Hashed rather than sent in the clear because the key travels in a header and lands in provider
 * logs; the address is already in the envelope, but nothing here needs to put it anywhere else.
 */
function idempotencyKeyFor(message: { to: string; subject: string; url: string }): string {
  return createHash("sha256")
    .update(`${message.to}\n${message.subject}\n${message.url}`)
    .digest("hex");
}

/**
 * Write one auth email. AWAITED — but only ever from the background side above, or from the
 * Better Auth send hooks that the background side triggers. A request path must never call this.
 *
 * A transport failure is swallowed into an operator log on purpose: the merchant was answered
 * several hundred milliseconds ago, and a shared mail provider's 429 must not become a signal
 * about whose address was in flight when it happened.
 */
export async function sendAuthEmail(message: {
  to: string;
  subject: string;
  url: string;
  intro: string;
}): Promise<void> {
  const context = jobAbortStore.getStore();
  // Past its deadline the job's slot has already gone back to the pool, so starting a send now
  // would be mail arriving from a job the executor considers finished. Refuse to start one.
  if (context?.signal.aborted) {
    console.warn("[better-auth] auth email not started: the job passed its deadline");
    return;
  }
  // Marked BEFORE the call, not after: the question this answers is "might a request have reached
  // the provider", and the conservative answer from the moment we hand it over is yes (#757).
  if (context) context.sendDispatched = true;
  try {
    await emailPort.send({
      to: message.to,
      subject: message.subject,
      text: `${message.intro}:\n${message.url}\n\nIf you didn't request this, ignore this email.`,
      devPreview: message.url,
      signal: context?.signal,
      idempotencyKey: idempotencyKeyFor(message),
    });
  } catch (error: unknown) {
    console.error(
      "[better-auth] auth email delivery failed:",
      error instanceof Error ? error.name : "unknown",
    );
  }
}

/** TEST ONLY. The per-address budgets are process memory with an hour-long window; a test that
 *  needs a fresh one cannot wait an hour out. */
export function __resetAuthEmailCapsForTests(): void {
  addressAttempts.clear();
  lastSweep = 0;
  droppedSinceLastLog = 0;
  lastDropLog = 0;
  if (dropLogTimer) clearTimeout(dropLogTimer);
  dropLogTimer = null;
}

/** TEST ONLY. Wall-clock behaviour is the thing under test in several cases here, and asserting
 *  on real delays in CI is a flake generator — so tests replace the clock and the dice instead of
 *  measuring them. Every field defaults back to the production constant. */
export function __configureAuthEmailQueueForTests(config: {
  maxConcurrency?: number;
  slotFloorMs?: number;
  jitterMaxMs?: number;
  jobTimeoutMs?: number;
  maxQueued?: number;
  dropLogIntervalMs?: number;
  random?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}): void {
  maxConcurrency = config.maxConcurrency ?? AUTH_EMAIL_MAX_CONCURRENCY;
  slotFloorMs = config.slotFloorMs ?? AUTH_EMAIL_SLOT_FLOOR_MS;
  jitterMaxMs = config.jitterMaxMs ?? AUTH_EMAIL_JITTER_MAX_MS;
  jobTimeoutMs = config.jobTimeoutMs ?? AUTH_EMAIL_JOB_TIMEOUT_MS;
  maxQueued = config.maxQueued ?? AUTH_EMAIL_MAX_QUEUED;
  dropLogIntervalMs = config.dropLogIntervalMs ?? AUTH_EMAIL_DROP_LOG_INTERVAL_MS;
  randomSource = config.random ?? Math.random;
  sleep = config.sleepFn ?? realSleep;
}

/** TEST ONLY. The capacity bound is the claim; a test has to be able to see the depth to check
 *  it, and it must be able to see it WITHOUT mocking this module — mocking the sender is what
 *  hid the unbounded queue in the first place. */
export function __authEmailQueueDepthForTests(): number {
  return outstanding();
}

/**
 * TEST/SHUTDOWN ONLY. Settle every job already handed over — including work that was abandoned
 * at its deadline and may still be running. Awaiting this from a request path would re-couple
 * the response to delivery and re-open #678.
 */
export async function authEmailQueueSettled(): Promise<void> {
  while (pumpTimer || outstanding() > 0 || straggling.size > 0) {
    if (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    else if (straggling.size > 0) await Promise.allSettled([...straggling]);
    else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
