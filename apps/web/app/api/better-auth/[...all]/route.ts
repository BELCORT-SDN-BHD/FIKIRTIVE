import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/better-auth/server";
import { MAGIC_LINK_INVALID_EMAIL_MESSAGE } from "@/lib/better-auth/magic-link-contract";
import { acceptMagicLinkRequest } from "@/lib/better-auth/magic-link-request";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

const MAGIC_LINK_PATH = "/sign-in/magic-link";

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
  if (!new URL(request.url).pathname.endsWith(MAGIC_LINK_PATH)) {
    return handlers.POST(request);
  }

  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const outcome = acceptMagicLinkRequest({
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
