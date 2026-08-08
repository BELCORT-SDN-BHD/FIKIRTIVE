import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
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
 * performs the identical four steps and the executor below is what drops the job.
 */
export type AuthEmailJob =
  | { purpose: "sign-in-link"; email: string; callbackURL: string; overBudget: boolean }
  | { purpose: "password-reset"; email: string; url: string }
  | { purpose: "verify-email"; email: string; url: string };

// ── executor tuning ──────────────────────────────────────────────────────────────────────────

/**
 * How many auth-email jobs may be in flight at once.
 *
 * WHY NOT ONE. A single serial worker made every job wait for the one in front of it, and that
 * turned the queue into a clock an attacker could read. Submit the address you want to probe,
 * then immediately submit your own address, which you can receive mail at: if the probe has no
 * access its job returns at the allowlist check, and your mail arrives promptly; if it does have
 * access its job goes on to mint a token, re-check, and wait on the mail provider, and your mail
 * arrives later. The delay on YOUR OWN email answers the question about SOMEBODY ELSE'S. Serial
 * execution also meant one slow provider call held up every other tenant's sign-in link.
 *
 * WHY NOT MANY. The far side is one shared mail provider with its own rate limits; a large pool
 * would turn a burst into 429s, which is the failure this system is least able to surface.
 *
 * Four is the smallest number that makes a probe-then-canary pair genuinely independent (they
 * run side by side rather than in sequence) with headroom for a couple of unrelated tenants, and
 * it stays far under any provider's per-second budget for a product whose auth-email volume is
 * measured in tens per hour.
 */
export const AUTH_EMAIL_MAX_CONCURRENCY = 4;

/**
 * Each job waits a uniformly random 0–2000 ms before it starts.
 *
 * Concurrency removes the QUEUEING correlation; jitter removes what is left. Two jobs handed over
 * milliseconds apart still share an event loop, a database pool and a socket pool, so the cheaper
 * branch can still finish measurably sooner on average. The branch difference being hidden is the
 * cost of "mint a token + re-check access + one provider round trip" — hundreds of milliseconds
 * at the very worst. A uniform 0–2000 ms delay has a standard deviation of about 577 ms and a
 * range that fully contains that difference, so a single observation carries no usable signal and
 * an averaged attack needs the difference to survive noise several times its own size.
 *
 * It is free to spend. Delivery already answered the merchant; an email that leaves up to two
 * seconds later still arrives inside the same breath of inbox latency.
 */
export const AUTH_EMAIL_JITTER_MAX_MS = 2000;

/**
 * A job gets 20 seconds, end to end, and then its slot is taken back.
 *
 * The mail adapter's `fetch` had no deadline and no cancel: a provider that accepts a connection
 * and never answers held the worker forever, and with a serial worker that meant every other
 * tenant's sign-in link, password reset and verification email behind it. The signal below is a
 * real cancel (it reaches `fetch`); the race is the belt for anything that ignores it.
 *
 * 20 s is several times a healthy provider round trip, so nothing legitimate is cut short.
 */
export const AUTH_EMAIL_JOB_TIMEOUT_MS = 20_000;

let maxConcurrency = AUTH_EMAIL_MAX_CONCURRENCY;
let jitterMaxMs = AUTH_EMAIL_JITTER_MAX_MS;
let jobTimeoutMs = AUTH_EMAIL_JOB_TIMEOUT_MS;
let randomSource: () => number = Math.random;
let sleep: (ms: number) => Promise<void> = (ms) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The deadline of the job currently running, so `sendAuthEmail` can hand it to the transport
 *  without every layer in between having to carry a parameter. Same process, same call chain —
 *  nothing outside this module can put a value in here. */
const jobAbortStore = new AsyncLocalStorage<AbortSignal>();

const queue: AuthEmailJob[] = [];
const inFlight = new Set<Promise<void>>();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * #678 — put an auth email on the background queue and return. NOTHING about the job runs before
 * this function returns, and that is the whole security property.
 *
 * WHY A TIMER AND NOT "just start the async function". An earlier round handed the job over by
 * calling an `async` function and not awaiting it. That still runs the function's SYNCHRONOUS
 * PREFIX — every statement up to its first real suspension — inside the request. For an address
 * on FOUNDER_ADMIN_EMAILS or AUTH_ALLOWED_EMAILS the access check answers out of a string list
 * with no suspension at all, so the cap check and the send were dispatched before the response
 * was built, while an address that had to be looked up in the database stopped at the query. Same
 * words, measurably different amount of work. A `setTimeout(…, 0)` is a macrotask: it cannot run
 * until the current call stack AND the microtask queue behind the response have drained.
 *
 * SINGLE PROCESS. The queue lives in this process's memory, exactly like the hourly caps it
 * enforces. A process that dies between the hand-over and the send loses that email — the
 * merchant presses the button again. Losing it is preferable to the alternative this replaced,
 * which was answering the merchant at the mail provider's pace.
 */
export function enqueueAuthEmail(job: AuthEmailJob): void {
  queue.push(job);
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    pump();
  }, 0);
}

/** Start as many jobs as the concurrency budget allows. Called on the macrotask after a
 *  hand-over and again whenever a slot frees up. */
function pump(): void {
  while (queue.length > 0 && inFlight.size < maxConcurrency) {
    const job = queue.shift();
    if (!job) break;
    const running: Promise<void> = runOneJob(job).finally(() => {
      inFlight.delete(running);
      pump();
    });
    inFlight.add(running);
  }
}

async function runOneJob(job: AuthEmailJob): Promise<void> {
  // Jitter first, so it covers the whole job including the branch that decides how much work
  // there is to do.
  await sleep(Math.min(jitterMaxMs, Math.floor(randomSource() * (jitterMaxMs + 1))));

  const controller = new AbortController();
  let expire!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("AuthEmailJobTimeout"));
    }, jobTimeoutMs);
    expire = () => clearTimeout(timer);
  });
  // An abandoned job may still be resolving somewhere; keep its rejection from escaping.
  deadline.catch(() => {});

  try {
    const work = jobAbortStore.run(controller.signal, () => runAuthEmailJob(job));
    work.catch(() => {});
    await Promise.race([work, deadline]);
  } catch (error: unknown) {
    // Every failure past the hand-over is an OPERATOR concern: fixed category, no address
    // (#575 log discipline). Alerting on these lines is what carries "a merchant is waiting for
    // a link that never came" now that the response cannot.
    console.error(
      "[better-auth] auth email job failed:",
      error instanceof Error ? error.message === "AuthEmailJobTimeout" ? "timeout" : error.name : "unknown",
    );
  } finally {
    expire();
  }
}

async function runAuthEmailJob(job: AuthEmailJob): Promise<void> {
  if (job.purpose === "sign-in-link") {
    // The throttle's verdict, applied HERE rather than at the door it came from. Dropping first
    // means an over-budget request causes no lookup and no row — it just cost the same on the
    // way in as every other request.
    if (job.overBudget) {
      console.warn("[better-auth] auth email suppressed: caller over the sign-in request budget");
      return;
    }
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
  try {
    await emailPort.send({
      to: message.to,
      subject: message.subject,
      text: `${message.intro}:\n${message.url}\n\nIf you didn't request this, ignore this email.`,
      devPreview: message.url,
      signal: jobAbortStore.getStore(),
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
}

/** TEST ONLY. Wall-clock behaviour is the thing under test in several cases here, and asserting
 *  on real delays in CI is a flake generator — so tests replace the clock and the dice instead of
 *  measuring them. Every field defaults back to the production constant. */
export function __configureAuthEmailQueueForTests(config: {
  maxConcurrency?: number;
  jitterMaxMs?: number;
  jobTimeoutMs?: number;
  random?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}): void {
  maxConcurrency = config.maxConcurrency ?? AUTH_EMAIL_MAX_CONCURRENCY;
  jitterMaxMs = config.jitterMaxMs ?? AUTH_EMAIL_JITTER_MAX_MS;
  jobTimeoutMs = config.jobTimeoutMs ?? AUTH_EMAIL_JOB_TIMEOUT_MS;
  randomSource = config.random ?? Math.random;
  sleep = config.sleepFn ?? ((ms) => (ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))));
}

/** TEST/SHUTDOWN ONLY. Settle every job already queued. Awaiting this from a request path would
 *  re-couple the response to delivery and re-open #678. */
export async function authEmailQueueSettled(): Promise<void> {
  while (pendingTimer || inFlight.size > 0 || queue.length > 0) {
    if (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
