import { NextRequest, NextResponse } from "next/server";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { parseStorageKey, keyOwnerMatches } from "@fikirtive/core";
import { storage, mimeOf } from "@/lib/storage";
import { consumeMediaProxyGate } from "@/lib/rate-limit-gates";

/**
 * Signed media proxy (L1 spec §四C, Plan B). IG only fetches media from a PUBLIC URL, but our
 * media lives in a private, owner-namespaced R2 bucket (宪法 6 铁幕). A signer mints a short-lived
 * HMAC token over (ownerId + storage key + expiry) and hands out this URL; here we verify it
 * server-side and STREAM the bytes back — no session, no public bucket, no presigned-URL leak of
 * our storage host.
 *
 * TWO SIGNERS, ONE DOOR. It was written for the publish worker handing Meta a URL (that half is
 * still inert until the energize slice + App Review). B0-28 added the second, and that one is
 * LIVE: the seat-less share preview (apps/web/lib/share-preview-view.ts) signs a 10-minute token
 * for the shared post's own media so a client with no account can see the image. So "nothing here
 * can be reached yet" is no longer true — an ordinary browser is now a routine caller, which is
 * exactly what the fail-closed checks below were built for.
 *
 * Fail-closed at every step: a bad/expired/forged token, an owner-namespace mismatch, a malformed
 * key, or a missing object all return 404 — never bytes.
 *
 * Node runtime (the default for a route touching @/lib/storage + node:crypto) — never edge.
 *
 * #463: intentionally no principal frame. This handler reaches storage and (since #795) one
 * tenant-less counter row; the signed token already carries the ownerId it checks against, so
 * there is nothing for a principal to scope. Left unwrapped on purpose; do not flag it as a
 * missing system context.
 */
export async function GET(
  req: NextRequest,
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

  // 3) #795 — the external-link gate, per calling address. A public, session-less route with no
  //    cap lets anyone holding ONE valid signed URL pull it as fast as the network allows.
  //
  //    ORDER IS DELIBERATE: it runs AFTER the HMAC checks, so a forged or expired token is still
  //    refused by pure crypto with zero database work — putting the counter first would have
  //    turned an unauthenticated GET into a database write and built a cheaper attack than the
  //    one it was closing.
  //
  //    Generous by design (see MEDIA_PROXY_PER_CALLER_PER_10_MIN: the intended caller is a
  //    platform's media-fetch fleet), and OPEN when the counter is unreachable — this is the one
  //    route that otherwise needs no database, so a database blip must not become the reason a
  //    publish the merchant already paid for fails. 429, not 404: "too fast" is an honest answer
  //    to a caller who already proved the link is theirs.
  if (!(await consumeMediaProxyGate(req.headers))) {
    return new NextResponse("Too many requests", { status: 429 });
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
