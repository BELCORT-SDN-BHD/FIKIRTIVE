import { auth } from "@/lib/better-auth/server";
import { NextResponse, type NextRequest } from "next/server";

const STALE_OTTO_THREAD_ACTIVITY_ACTION_IDS = new Set([
  "40e295ab821708676046d9a9ce1d58dca80ea9c87c",
]);

function isStaleOttoThreadActivityAction(req: NextRequest) {
  return req.method === "POST"
    && req.nextUrl.pathname === "/otto"
    && STALE_OTTO_THREAD_ACTIVITY_ACTION_IDS.has(req.headers.get("next-action") ?? "");
}

/**
 * Next 16 proxy (the middleware successor; Node runtime by default).
 *
 * The wall is OPT-IN via AUTH_ENABLED=true (founder decision 2026-06-11:
 * defer enforcement until anything cost-incurring ships). Hard trigger,
 * recorded in the design doc: BEFORE the first endpoint that burns money
 * (editor render tracer, API-key generation), set AUTH_ENABLED=true +
 * RESEND_API_KEY in Railway — no code change needed.
 *
 * When enabled, everything is gated except /login, public legal pages, the auth APIs, and Next
 * statics — including /files/* (reference images are private). The wall is now
 * Better Auth: it reads the BA session via auth.api.getSession.
 */
export default async function proxy(req: NextRequest) {
  if (isStaleOttoThreadActivityAction(req)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
        "x-fikirtive-stale-client": "otto-thread-activity",
      },
    });
  }

  // Fail-closed in production: now that money-incurring features (Otto) ship, a prod
  // deploy that simply FORGETS the flag must not serve the app unauthenticated. So in
  // production the wall is ON unless someone EXPLICITLY sets AUTH_ENABLED=false. In dev
  // it stays opt-in (AUTH_ENABLED=true) so local work needs no login.
  // (Prod also requires RESEND_API_KEY so sign-in codes work behind the wall.)
  const enabled =
    process.env.NODE_ENV === "production"
      ? process.env.AUTH_ENABLED !== "false"
      : process.env.AUTH_ENABLED === "true";
  if (!enabled) return;
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    const login = new URL("/login", req.nextUrl);
    // F42: keep the query string too, so a deep link (e.g. ?project=…&thread=…) survives the
    // login round-trip. LoginForm's sanitizeCallbackURL already accepts a path with a query.
    login.searchParams.set("from", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
}

// ⚠️ DO NOT hand-edit the matcher below. #901 / #978.
//
// Every exemption — which path, whether it is one path or a whole subtree, and WHY it may answer
// without a session — is declared in lib/auth-wall-ledger.ts. That ledger is the source of truth;
// the string below is its output, copied here because Next requires config.matcher to be a
// build-time constant ("matcher values need to be constants so they can be statically analyzed
// at build-time. Dynamic values such as variables will be ignored" — next/…/file-conventions/proxy),
// so it cannot be computed at runtime from the ledger.
//
// To change what is outside the wall: edit the ledger, run the ledger's generator, paste the
// result here. lib/__tests__/proxy.test.ts asserts `config.matcher[0] === buildAuthWallMatcher()`
// byte for byte, plus the boundary shapes of every single entry, so drifting the two apart — or
// hand-writing a new unbounded prefix straight into this string — turns CI red immediately.
//
// northstar: NO LONGER EXEMPT (#606, D7 · T7). The exemption existed only because that
// prefix was a design-only prototype behind a preview flag that 404'd in production. The
// mock pages and the flag are both deleted; what is left under the prefix are two REAL
// product routes (Home + Canvas) that read the merchant's own projects and canvas, so the
// prefix belongs inside the wall like every other product surface. The pages keep their own
// requireOwner() gates — the wall is the outer of two locks, not the only one.
export const config = {
  matcher: ["/((?!login/?$|signup/?$|forgot-password/?$|reset-password/?$|verify-email/?$|schedule/share-preview/?$|terms/?$|privacy(?:/.*)?$|legal(?:/.*)?$|api/better-auth(?:/.*)?$|api/stripe(?:/.*)?$|api/health/?$|api/ops/dlq/?$|api/ready/?$|api/meta/data-deletion/?$|api/media/pub(?:/.*)?$|_next/static(?:/.*)?$|_next/image(?:/.*)?$|favicon\\.ico/?$).*)"],
};
