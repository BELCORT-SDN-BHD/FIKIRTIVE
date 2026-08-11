import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/better-auth/server";
import { MAGIC_LINK_INVALID_EMAIL_MESSAGE } from "@/lib/better-auth/magic-link-contract";
import { acceptMagicLinkRequest } from "@/lib/better-auth/magic-link-request";
import { consumePasswordDoor, consumePublicAuthDoor } from "@/lib/rate-limit-gates";
import { withCallerIdentityHeader } from "@/lib/caller-identity";

const handlers = toNextJsHandler(auth);

/**
 * #795 r5 — EVERY request that reaches Better Auth is stamped with the one authoritative caller
 * address first (see `withCallerIdentityHeader`). Better Auth's own burst rules read that header
 * and nothing else, so its buckets and ours are the same buckets. Without this, its default
 * (`X-Forwarded-For`, first entry) reads a header Next fills in from the platform proxy's socket
 * on our deployment — one bucket for the entire product.
 *
 * The stamp goes on the request we FORWARD, never on one whose body we then read ourselves:
 * constructing a Request from a Request disturbs the original's body.
 */
const forward = {
  GET: (request: Request) => handlers.GET(withCallerIdentityHeader(request)),
  POST: (request: Request) => handlers.POST(withCallerIdentityHeader(request)),
};

export const GET = forward.GET;

const MAGIC_LINK_PATH = "/sign-in/magic-link";
const PASSWORD_SIGN_IN_PATH = "/sign-in/email";

/**
 * #795 r2 — the three public doors whose HOURLY cap has to live here.
 *
 * They used to be `rateLimit.customRules` entries with a one-hour window. Better Auth's database
 * storage prunes its own rows on a 60-second cutoff that ignores the custom rule, so an hourly
 * budget of five silently became five per MINUTE the moment the counters moved to the database.
 * The full reasoning, and why raising Better Auth's global window is not the fix, is at
 * PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR.
 *
 * Better Auth's own short built-in rules still apply to all three underneath this — burst is its
 * job, the hour is ours.
 */
export const HOURLY_PUBLIC_DOORS = [
  "/sign-up/email",
  "/request-password-reset",
  "/send-verification-email",
] as const;

/** Better Auth's own 429, byte for byte (api/rate-limiter/index.ts), so a caller cannot tell
 *  which of the two caps refused it — and so the client plugin's error handling is unchanged. */
function tooManyRequests(retryAfterMs: number): Response {
  return new Response(JSON.stringify({ message: "Too many requests. Please try again later." }), {
    status: 429,
    statusText: "Too Many Requests",
    headers: { "X-Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
  });
}

/**
 * #678 r3 — the magic-link endpoint is mounted here by Better Auth, so it is a public door
 * whether or not our UI uses it. It gets the SAME four-step request path as the login page's
 * server action rather than Better Auth's own handler, for two reasons:
 *
 *   - Better Auth's handler mints the verification token inside the request, which is the work
 *     an address without access must not be able to cause. The background side mints it, after
 *     the access check.
 *   - Better Auth's per-IP `rateLimit` rules only run inside this handler, so leaving the two
 *     doors on different limiters meant the door the product actually uses had none.
 *
 * Every other Better Auth endpoint is untouched and still goes to its own handler.
 */
export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;

  // #795 — the PATIENT half of the password door's protection.
  //
  // Better Auth caps /sign-in/* at 3 per 10 seconds, which ends a fast credential-stuffing run
  // and leaves the slow one completely unbounded: 3 every 10 seconds is over a thousand attempts
  // an hour from one address, forever. The hourly cap has to live HERE rather than in Better
  // Auth's `customRules`, because a rule there REPLACES the burst rule instead of adding to it —
  // writing the hourly cap in that map would have deleted the burst cap it was meant to reinforce.
  //
  // Counted on the CALLING ADDRESS ONLY, never on the submitted email: a 429 must never be
  // readable as "that account exists". Same discipline as the magic-link door below.
  if (pathname.endsWith(PASSWORD_SIGN_IN_PATH)) {
    const retryAfterMs = await consumePasswordDoor(request.headers);
    if (retryAfterMs !== null) return tooManyRequests(retryAfterMs);
    return forward.POST(request);
  }

  // The hourly half of the three public doors — see HOURLY_PUBLIC_DOORS. Each door counts into
  // its own bucket, so spending the registration budget never closes password reset.
  const hourlyDoor = HOURLY_PUBLIC_DOORS.find((door) => pathname.endsWith(door));
  if (hourlyDoor) {
    const retryAfterMs = await consumePublicAuthDoor(hourlyDoor, request.headers);
    if (retryAfterMs !== null) return tooManyRequests(retryAfterMs);
    return forward.POST(request);
  }

  if (!pathname.endsWith(MAGIC_LINK_PATH)) {
    return forward.POST(request);
  }

  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const outcome = await acceptMagicLinkRequest({
    email: body.email,
    callbackURL: typeof body.callbackURL === "string" ? body.callbackURL : "/",
    requestHeaders: request.headers,
  });

  // A malformed address is refused the same way for everyone — the check is pure string work and
  // never asks whether anybody owns it. Everything else gets Better Auth's own `{status:true}`,
  // byte for byte, so the client plugin keeps working and no caller can tell the cases apart.
  return outcome === "invalid_email"
    ? Response.json({ message: MAGIC_LINK_INVALID_EMAIL_MESSAGE, code: "INVALID_EMAIL" }, { status: 400 })
    : Response.json({ status: true });
}
