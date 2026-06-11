import { auth } from "@/auth";

/**
 * Next 16 proxy (the middleware successor; Node runtime by default, so the
 * full Auth.js config incl. Prisma adapter is usable here directly).
 * Everything is gated except the login page, the auth API, and Next statics —
 * including /files/* (reference images are private).
 */
export default auth((req) => {
  if (!req.auth) {
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set("from", req.nextUrl.pathname);
    return Response.redirect(login);
  }
});

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
