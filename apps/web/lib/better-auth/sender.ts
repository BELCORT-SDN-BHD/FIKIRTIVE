import "server-only";
import { emailPort } from "@/lib/email";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

/** Per-address outbound cap — UNCHANGED at 5 auth emails per address per hour. It runs on the
 *  background side (see dispatchAuthEmail) so that not even a branch on it exists in the
 *  request path. */
function withinRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

export type AuthEmailDispatch = {
  to: string;
  subject: string;
  url: string;
  intro: string;
  /** Whether this address may actually be written to. Resolved on the BACKGROUND side, never
   *  in the request. An address without access still travels this whole path — the same call,
   *  the same job, the same handover — and simply has nothing delivered at the end of it. */
  deliverIf: () => boolean | Promise<boolean>;
};

/** Handed-over jobs that have not settled yet. Exists so tests (and, later, a graceful
 *  shutdown) have a join point — production code MUST NOT await this on a request path. */
const inFlight = new Set<Promise<void>>();

/**
 * #678 r2 — hand an auth email to the background and return IMMEDIATELY. Never awaited by a
 * request path, and that is the whole security property.
 *
 * WHY THIS SHAPE. Making the two answers identical in WORDS was not enough: the request still
 * *took* a different amount of time depending on the answer. An address with no account was one
 * allowlist query and out; an address with an account created a verification token, queried
 * again, and then waited on the email network — five slow replies followed by a suddenly fast
 * sixth once the per-address cap kicked in. "Slow ×5 then fast" is a fingerprint, and no amount
 * of copy-matching hides it. Worse, the delivery outcome itself leaked: an address with no
 * account always succeeded, while an address with an account surfaced a delivery failure the
 * moment the shared mail provider returned 429 or 5xx — pressure an attacker can create through
 * any public sending surface.
 *
 * Both go away for the same reason once delivery is off the request path: the response can no
 * longer be a function of (a) whether the address has an account, (b) which attempt this is, or
 * (c) whether the mail provider is healthy. Nothing here is balanced by sleeping — the
 * request simply never waits on any of it.
 *
 * Every failure past this point is an OPERATOR concern, not a merchant-facing one: it is logged
 * with a fixed category and no address (#575 log discipline). Alerting on these lines is what
 * carries the "a merchant is waiting for a link that never came" case now.
 */
export function dispatchAuthEmail(job: AuthEmailDispatch): void {
  const done = deliverAuthEmail(job)
    .catch((error: unknown) => {
      // Unreachable in practice (deliverAuthEmail already swallows delivery faults); this is
      // the belt so a dispatch can never surface as an unhandled rejection.
      console.error(
        "[better-auth] auth email dispatch failed:",
        error instanceof Error ? error.name : "unknown",
      );
    })
    .finally(() => {
      inFlight.delete(done);
    });
  inFlight.add(done);
}

async function deliverAuthEmail(job: AuthEmailDispatch): Promise<void> {
  // The access decision lives HERE, off the request path. An address without access reaches
  // this line exactly like one with access and stops one step later.
  if (!(await job.deliverIf())) return;
  if (!withinRateLimit(job.to)) {
    console.warn("[better-auth] auth email suppressed: per-address hourly cap reached");
    return;
  }
  try {
    await emailPort.send({
      to: job.to,
      subject: job.subject,
      text: `${job.intro}:\n${job.url}\n\nIf you didn't request this, ignore this email.`,
      devPreview: job.url,
    });
  } catch (error: unknown) {
    // The merchant already got the same neutral answer several hundred milliseconds ago. This
    // line — fixed category, no address — is what operations watches.
    console.error(
      "[better-auth] auth email delivery failed:",
      error instanceof Error ? error.name : "unknown",
    );
  }
}

/** TEST/SHUTDOWN ONLY. Settle every dispatch already handed over. Awaiting this from a request
 *  path would re-couple the response to delivery and re-open #678. */
export async function authEmailDispatchesSettled(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}
