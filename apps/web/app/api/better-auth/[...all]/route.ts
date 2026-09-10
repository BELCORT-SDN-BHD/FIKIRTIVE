import { toNextJsHandler } from "better-auth/next-js";
import { auth, CLOSED_PASSWORD_PATH_PREFIXES } from "@/lib/better-auth/server";
import { consumePublicAuthDoor } from "@/lib/rate-limit-gates";
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

/** Better Auth 自己给 `disabledPaths` 的答案，字节一致（`dist/api/index.mjs:166`）—— 两道闸
 *  必须长得一样，否则「哪一层拒的」本身就是一条可读的信息。 */
const notFound = () => new Response("Not Found", { status: 404 });

/**
 * SIGNIN-A4 —— `/reset-password/:token` 这条**带路径参数**的密码门。
 *
 * 为什么不在 `disabledPaths` 里、为什么必须在这里：见 lib/better-auth/server.ts 的
 * `CLOSED_PASSWORD_PATH_PREFIXES` 注释（那道闸逐字比对实际路径，参数路由永远匹配不到）。
 * 这里比对的是**去掉挂载前缀之后**的路径，而不是整条 URL 做子串包含 —— 后者会把任何带
 * `/reset-password/` 字样的路径也一起 404，闸的范围要写死在它该管的那一段上。
 */
const AUTH_BASE_PATH = "/api/better-auth";

function isRetiredPasswordPath(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  const authPath = pathname.startsWith(AUTH_BASE_PATH)
    ? pathname.slice(AUTH_BASE_PATH.length)
    : pathname;
  return CLOSED_PASSWORD_PATH_PREFIXES.some((prefix) => authPath.startsWith(prefix));
}

export const GET = (request: Request): Promise<Response> | Response =>
  isRetiredPasswordPath(request) ? notFound() : forward.GET(request);

const SIGN_IN_CODE_VERIFY_PATH = "/sign-in/email-otp";

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
 * Better Auth's own INVALID_OTP refusal, byte for byte — `APIError.from("BAD_REQUEST",
 * EMAIL_OTP_ERROR_CODES.INVALID_OTP)` serialises to exactly this (`@better-auth/core`'s
 * `defineErrorCodes` puts the key in `code` and the sentence in `message`). Reusing the shape
 * rather than inventing one keeps the client plugin's error handling unchanged.
 */
function invalidSignInCode(): Response {
  return Response.json({ message: "Invalid OTP", code: "INVALID_OTP" }, { status: 400 });
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
 * What is left here is the HOURLY cap that Better Auth cannot express (see below), plus the
 * sign-in-code door's one-refusal normalisation. Every other Better Auth endpoint is untouched
 * and goes straight to its own handler.
 */
export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;

  // SIGNIN-A4 —— 参数化的密码门先答 404，和 GET 那一侧同一条闸（这条路由本身只挂 GET，
  // 但「一律 404」要对每个动词都成立，否则 405 与 404 的差别本身就是一条回声）。
  if (isRetiredPasswordPath(request)) return notFound();

  // SIGNIN-A4 —— 这里以前的第一段是密码门（`/sign-in/email`）的每小时闸：#795 用它补 Better
  // Auth「10 秒 3 次」挡不住的那种耐心型撞库。密码整体退役之后（docs/specs/sign-in.md 已冻结
  // · v1）那条路径在 router 层就 404，闸没有门可守；更要紧的是闸跑在转发之前，留着它会让第
  // 31 次请求拿到 429 而不是验收 A4 要的「一律 404」，等于给一个已退役的端点留一个可探测的
  // 回声。所以闸随门一起撤（`consumePasswordDoor` 也一并删掉，仓库里不留一个没人调的门）。

  // ── THE SIGN-IN-CODE DOOR ANSWERS ONE REFUSAL, WHATEVER WENT WRONG ──────────────────────────
  //
  // This is #678's defect wearing a new face, and it arrived with the swap from links to codes.
  // The login page collapses every refusal into one sentence, but a probe reads the RESPONSE, not
  // the copy — and Better Auth's three refusals are three different answers about the same thing:
  //
  //   · no verification row at all      → 400 INVALID_OTP
  //   · a row whose attempts are spent  → 403 TOO_MANY_ATTEMPTS
  //   · a row past its expiry           → 400 OTP_EXPIRED
  //
  // A row only ever exists for an address that PASSED THE ALLOWLIST — the background job refuses
  // to mint one otherwise (lib/better-auth/sender.ts, `if (!allowed) return`) — so "which refusal
  // came back" is "does this address have an account". Deterministically, with no credential and
  // no waiting: send four guesses and read the fourth (403 for a merchant, 400 for a stranger),
  // or send one guess after the code expires (OTP_EXPIRED vs INVALID_OTP) for a single request per
  // address. Under an open-registration beta that enumerates the customer list.
  //
  // The magic link this replaced had no such surface: its redeem door took a TOKEN and no email,
  // so there was nothing to key a probe on, and its request door was normalised to one
  // `{status:true}` right here. So the fence goes back in the same place, in the same shape.
  //
  // WHAT IS DELIBERATELY LET THROUGH, and why neither leaks:
  //   · 2xx — the sign-in itself, which has to keep its `Set-Cookie`. Reaching it requires the
  //     correct six digits, which only ever went to that address's inbox.
  //   · 429 — the rate limiter's own refusal. It is counted on the CALLING ADDRESS and the path,
  //     never on the submitted email (Better Auth's `createRateLimitKey(ip, path)`), so it says
  //     nothing about the account — the same reasoning every other door here runs on.
  //
  // WHAT THIS DOES NOT CLOSE, stated rather than implied: the two branches still do different
  // amounts of DATABASE work (a row that exists is consumed and re-written with an incremented
  // attempt count; a row that does not exist is one lookup that finds nothing), so a difference
  // remains on the clock. It is one INSERT wide — not the "one query versus a token write plus the
  // mail network" gulf #678 was about — and closing it properly means equalising work inside
  // Better Auth's own handler, which is not reachable from out here. Registered as residual risk
  // rather than papered over.
  if (pathname.endsWith(SIGN_IN_CODE_VERIFY_PATH)) {
    const response = await forward.POST(request);
    if (response.ok || response.status === 429) return response;
    return invalidSignInCode();
  }

  // The hourly half of the public doors — see HOURLY_PUBLIC_DOORS. Each door counts into its own
  // bucket, so spending one door's budget never closes another.
  const hourlyDoor = HOURLY_PUBLIC_DOORS.find((door) => pathname.endsWith(door));
  if (hourlyDoor) {
    const retryAfterMs = await consumePublicAuthDoor(hourlyDoor, request.headers);
    if (retryAfterMs !== null) return tooManyRequests(retryAfterMs);
    return forward.POST(request);
  }

  // THE SIGN-IN-CODE DOOR GETS NO HOURLY BUCKET OF ITS OWN, and that is a decision rather than
  // an oversight.
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
