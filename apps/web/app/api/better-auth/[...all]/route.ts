import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/better-auth/server";
import { consumePasswordDoor, consumePublicAuthDoor } from "@/lib/rate-limit-gates";
import { withCallerIdentityHeader } from "@/lib/caller-identity";
import { HOURLY_PUBLIC_DOORS } from "@/lib/public-auth-doors";

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

const PASSWORD_SIGN_IN_PATH = "/sign-in/email";

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
 * #678 r3 — the endpoint that MINTS a sign-in credential used to be intercepted here, because
 * Better Auth mounted it whether or not our UI called it and its own handler minted the token
 * inside the request — the exact work an address without access must not be able to cause.
 *
 * The swap from links to codes let that interception go away entirely rather than be rewritten:
 * `/email-otp/send-verification-otp` is now in `disabledPaths` (lib/better-auth/server.ts), so
 * the router answers it 404 and the only caller left is our background queue, through
 * `auth.api.sendVerificationOTP`. A door that does not exist needs no proxy in front of it. The
 * login page asks for a code through a server action (app/login/actions.ts), which runs the same
 * four-step request path the interception used to.
 *
 * What is left here is the two HOURLY caps that Better Auth cannot express (see below). Every
 * other Better Auth endpoint is untouched and goes straight to its own handler.
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
  // readable as "that account exists".
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

  // THE SIGN-IN-CODE DOOR (`/sign-in/email-otp`) IS DELIBERATELY NOT LISTED ABOVE, and that is a
  // decision rather than an oversight.
  //
  // The patient attack an hourly cap exists to stop is guessing, and guessing is already bounded
  // where it cannot be routed around: a wrong code spends one of three attempts recorded ON THE
  // CODE (`allowedAttempts`, lib/better-auth/server.ts), and the fourth try locks that code out
  // for good. Rotating calling addresses buys nothing, because the budget does not belong to the
  // caller. How many codes can exist for one merchant is bounded twice over as well — five per
  // caller-and-address per hour on the request side and five per ADDRESS per hour on the outbound
  // side — so the whole attack surface is fifteen guesses an hour at a six-digit code.
  //
  // A counter here would add a fourth number that bounds nothing the first three do not, while
  // making a shared office address able to lock its own colleagues out of typing their codes.
  return forward.POST(request);
}
