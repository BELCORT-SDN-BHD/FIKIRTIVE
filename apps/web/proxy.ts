import { auth } from "@/lib/better-auth/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 proxy (the middleware successor; Node runtime by default).
 *
 * The wall is OPT-IN via AUTH_ENABLED=true (founder decision 2026-06-11:
 * defer enforcement until anything cost-incurring ships). Hard trigger,
 * recorded in the design doc: BEFORE the first endpoint that burns money
 * (editor render tracer, API-key generation), set AUTH_ENABLED=true +
 * RESEND_API_KEY in Railway — no code change needed.
 *
 * When enabled, everything is gated except /login, the auth APIs, and Next
 * statics — including /files/* (reference images are private). The wall is now
 * Better Auth: it reads the BA session via auth.api.getSession.
 */
export default async function proxy(req: NextRequest) {
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
    login.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
}

export const config = {
  // api/better-auth MUST stay excluded — else the sign-in/OAuth-callback endpoints get
  // walled → infinite redirect / total lockout. (NextAuth's api/auth route is retired.)
  // api/stripe excluded — the webhook is unauthenticated (Stripe calls it; the signature is its auth).
  // skin-preview: dev-only visual harness for the UI re-skin (the page itself 404s in
  // production), excluded here so it renders without a session in dev. Throwaway.
  matcher: ["/((?!login|skin-preview|api/better-auth|api/stripe|_next/static|_next/image|favicon.ico).*)"],
};
