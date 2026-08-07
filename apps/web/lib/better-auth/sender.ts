import "server-only";
import { emailPort } from "@/lib/email";
import { isAllowedEmail } from "@/lib/allowlist";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_ADDRESS_PER_WINDOW = 5;
const addressAttempts = new Map<string, number[]>();

/** #678 r3 — the per-address bucket key is NORMALISED (trim + lowercase).
 *
 *  It used to be the raw submitted string. Addresses are case-insensitive in the part that
 *  routes them, and the allowlist has always lower-cased before comparing, so `owner@Shop.test`
 *  and `owner@shop.test` are one merchant everywhere EXCEPT here — where they used to be two
 *  independent hourly budgets. Flipping one letter's case bought a fresh five. */
function addressKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Per-address outbound cap — UNCHANGED at 5 auth emails per address per hour. It runs on the
 *  BACKGROUND side so that not even a branch on it exists in the request path. */
function consumeAddressCap(email: string): boolean {
  const key = addressKey(email);
  const now = Date.now();
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
 * A queued auth email. Deliberately opaque: a normalised address plus what it is FOR. Nothing
 * in here says whether the address has access, has an account, or has any budget left — those
 * questions are asked on this side of the handover, never on the request's.
 *
 * `sign-in-link` is the one that has no `url`, and that is the point of #678 r3: minting the
 * token IS background work now, so an address without access never causes a verification row
 * to be written at all.
 */
export type AuthEmailJob =
  | { purpose: "sign-in-link"; email: string; callbackURL: string }
  | { purpose: "password-reset"; email: string; url: string }
  | { purpose: "verify-email"; email: string; url: string };

const queue: AuthEmailJob[] = [];
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let active: Promise<void> | null = null;

/**
 * #678 r3 — put an auth email on the background queue and return. NOTHING about the job runs
 * before this function returns, and that is the whole security property.
 *
 * WHY A TIMER AND NOT "just start the async function". Round 2 handed the job over by calling an
 * `async` function and not awaiting it. That still runs the function's SYNCHRONOUS PREFIX — every
 * statement up to its first real suspension — inside the request. For an address on
 * FOUNDER_ADMIN_EMAILS or AUTH_ALLOWED_EMAILS the access check answers out of a string list with
 * no suspension at all, so the cap check and the send were dispatched before the response was
 * built, while an address that had to be looked up in the database stopped at the query. Same
 * words, measurably different amount of work — the oracle again, one layer in. A `setTimeout(…, 0)`
 * is a macrotask: it cannot run until the current call stack AND the microtask queue behind the
 * response have drained, so the amount of work the request performs is the same for every address.
 *
 * SINGLE PROCESS. The queue lives in this process's memory, exactly like the hourly caps it
 * enforces. That is honest about what this is: an in-process handover, not durable infrastructure.
 * A process that dies between the handover and the send loses that email — the merchant presses
 * the button again. Losing it is preferable to the alternative this replaced, which was answering
 * the merchant at the mail provider's pace.
 */
export function enqueueAuthEmail(job: AuthEmailJob): void {
  queue.push(job);
  scheduleDrain();
}

function scheduleDrain(): void {
  if (pendingTimer || active) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    active = drain().finally(() => {
      active = null;
      if (queue.length) scheduleDrain();
    });
  }, 0);
}

async function drain(): Promise<void> {
  while (queue.length) {
    const job = queue.shift();
    if (!job) break;
    try {
      await runAuthEmailJob(job);
    } catch (error: unknown) {
      // Every failure past the handover is an OPERATOR concern: fixed category, no address
      // (#575 log discipline). Alerting on these lines is what carries "a merchant is waiting
      // for a link that never came" now that the response cannot.
      console.error(
        "[better-auth] auth email job failed:",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }
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
}

/** TEST/SHUTDOWN ONLY. Settle every job already queued. Awaiting this from a request path would
 *  re-couple the response to delivery and re-open #678. */
export async function authEmailQueueSettled(): Promise<void> {
  while (pendingTimer || active || queue.length) {
    if (active) await active.catch(() => {});
    else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
