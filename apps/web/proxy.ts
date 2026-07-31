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
  // (Prod also requires RESEND_API_KEY so magic-link sign-in works behind the wall.)
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

export const config = {
  // api/better-auth MUST stay excluded — else the sign-in/OAuth-callback endpoints get
  // walled → infinite redirect / total lockout. (NextAuth's api/auth route is retired.)
  // api/stripe excluded — the webhook is unauthenticated (Stripe calls it; the signature is its auth).
  // api/health excluded — external uptime monitors probe it; it returns only up/stale, no data.
  // api/meta/data-deletion excluded — Meta calls it unauthenticated; the signed_request is its auth.
  // api/media/pub excluded — the ONLY caller is Meta's async media-fetch server (no session, ever).
  //   The route's HMAC token (signed by the publish worker over ownerId+key+expiry) is its SOLE
  //   authorization; verifyMediaToken fail-closes to 404 on any bad/expired/forged token. This
  //   exception is scoped to exactly /api/media/pub/* (the [token] route) — it opens nothing else.
  // skin-preview: dev-only visual harness for the UI re-skin (the page itself 404s in
  // production), excluded here so it renders without a session in dev. Throwaway.
  // northstar: the design-only prototype city + immersive app (zero backend, zero auth) —
  // same precedent as skin-preview. The `northstar` prefix also covers `northstar-immersive`.
  // Both layouts 404 in production unless NORTHSTAR_PREVIEW=1, so exempting auth is safe.
  // signup / forgot-password / reset-password: the #543 self-service door. These three pages
  // MUST render without a session — that is the whole point of them — so they join /login
  // outside the wall. They mutate nothing on their own; every action behind them goes through
  // Better Auth's own gates (pause switch, allowlist, verification, rate limit).
  matcher: ["/((?!login|signup|forgot-password|reset-password|terms|privacy|legal|skin-preview|northstar|api/better-auth|api/stripe|api/health|api/meta/data-deletion|api/media/pub/|_next/static|_next/image|favicon.ico).*)"],
};
