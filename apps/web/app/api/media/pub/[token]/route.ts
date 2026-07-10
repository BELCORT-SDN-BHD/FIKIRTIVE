import { NextRequest, NextResponse } from "next/server";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { parseStorageKey, keyOwnerMatches } from "@fikirtive/core";
import { storage, mimeOf } from "@/lib/storage";

/**
 * Signed media proxy (L1 spec §四C, Plan B). IG only fetches media from a PUBLIC URL, but our
 * media lives in a private, owner-namespaced R2 bucket (宪法 6 铁幕). The publish worker signs a
 * short-lived HMAC token over (ownerId + storage key + expiry) and hands Meta this URL; here we
 * verify it server-side and STREAM the bytes back — no session (Meta's servers call this), no
 * public bucket, no presigned-URL leak of our storage host.
 *
 * Fail-closed at every step: a bad/expired/forged token, an owner-namespace mismatch, a malformed
 * key, or a missing object all return 404 — never bytes. Inert until the publish worker actually
 * signs tokens (energize slice) + App Review passes; nothing here can be reached otherwise.
 *
 * Node runtime (the default for a route touching @/lib/storage + node:crypto) — never edge.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params; // Next 16: params are async
  const secret = process.env.MEDIA_PROXY_SECRET ?? "";

  // 1) HMAC + TTL. A null result (bad sig / expired / secret unset) → fail-closed 404.
  const claims = verifyMediaToken(token, secret);
  if (!claims) return new NextResponse("Not found", { status: 404 });

  // 2) Defense in depth: the SIGNED key must live in the SIGNED owner's namespace. A token can only
  //    ever be minted for u/<ownerId>/… by the worker, but re-check so a signing bug can't cross tenants.
  if (!keyOwnerMatches(claims.key, claims.ownerId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const { ext } = parseStorageKey(claims.key); // rejects traversal / malformed keys
    const bytes = await storage.get(claims.key); // whole object — IG images are small; L1 never auto-publishes video
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": mimeOf(ext),
        // never cache a signed, tenant-scoped payload; don't let it leak via referrers
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
