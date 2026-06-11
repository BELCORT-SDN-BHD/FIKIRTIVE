import { auth } from "@/auth";

/**
 * Next 16 proxy (the middleware successor; Node runtime by default).
 *
 * The wall is OPT-IN via AUTH_ENABLED=true (founder decision 2026-06-11:
 * defer enforcement until anything cost-incurring ships). Hard trigger,
 * recorded in the design doc: BEFORE the first endpoint that burns money
 * (editor render tracer, API-key generation), set AUTH_ENABLED=true +
 * RESEND_API_KEY in Railway — no code change needed.
 *
 * When enabled, everything is gated except /login, the auth API, and Next
 * statics — including /files/* (reference images are private).
 */
const wall = auth((req) => {
  if (!req.auth) {
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set("from", req.nextUrl.pathname);
    return Response.redirect(login);
  }
});

export default function proxy(req: Parameters<typeof wall>[0], ctx: Parameters<typeof wall>[1]) {
  if (process.env.AUTH_ENABLED !== "true") return;
  return wall(req, ctx);
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
