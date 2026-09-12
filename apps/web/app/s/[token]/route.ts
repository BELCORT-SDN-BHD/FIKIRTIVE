import { NextResponse, type NextRequest } from "next/server";
import { verifySharePreviewToken } from "@fikirtive/token-crypto";
import { SHARE_PREVIEW_COOKIE_NAME, SHARE_PREVIEW_COOKIE_PATH } from "@/lib/share-preview-cookie";

/**
 * SHARE-A6 (docs/specs/share-preview.md 已冻结 · v1) — the clean entry point for a share-preview
 * link.
 *
 * `sharePostPreview` (`lib/schedule-actions.ts`) now mints `${base}/s/<token>` instead of
 * `${base}/schedule/share-preview?t=<token>`. This route does exactly ONE thing: turn the token
 * riding in the URL into an HttpOnly cookie, then 303 to the clean address
 * `SHARE_PREVIEW_COOKIE_PATH` — no query string, so the token never sits in the address bar, a
 * bookmark, browser history, or a navigation breadcrumb a moment longer than this one redirect.
 *
 * A legacy `?t=` link keeps working: `schedule/share-preview/page.tsx` forwards it here on sight,
 * so an old link and a freshly minted one end up in the identical state — the whole reason this
 * file exists is that a plain Server Component page CANNOT set a cookie (Next only allows that
 * from a Server Action or a Route Handler like this one), so the conversion has to happen here.
 *
 * NOT the verification layer. Whatever lands in the cookie is handed unexamined to
 * `loadSharePreview`, which already fails every bad shape (forged, tampered, expired, revoked,
 * empty) closed to the identical "unavailable" page. Verifying twice would only be two places to
 * keep in sync. The one thing decided here is the cookie's own lifetime: real exp when the token
 * reads as valid, a short fallback otherwise — so a token that will never work does not also leave
 * a long-lived cookie sitting in the browser for no reason.
 */
const FALLBACK_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params; // Next requires a non-empty segment to route here at all
  const res = NextResponse.redirect(new URL(SHARE_PREVIEW_COOKIE_PATH, req.nextUrl.origin), 303);

  const claims = verifySharePreviewToken(token, process.env.SHARE_PREVIEW_SECRET ?? "");
  const maxAge = claims
    ? Math.max(0, Math.round((claims.exp - Date.now()) / 1000))
    : FALLBACK_COOKIE_MAX_AGE_SECONDS;

  res.cookies.set(SHARE_PREVIEW_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: SHARE_PREVIEW_COOKIE_PATH,
    maxAge,
  });
  return res;
}
