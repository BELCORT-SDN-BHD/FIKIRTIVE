import { NextRequest, NextResponse } from "next/server";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { parseStorageKey, keyOwnerMatches } from "@fikirtive/core";
import { storage, mimeOf } from "@/lib/storage";
import { admitMediaProxyRequest } from "@/lib/media-proxy-access";
import { isSharePreviewRowLive } from "@/lib/share-preview";
import { parseByteRange } from "@/lib/byte-range";
import { toWebStream } from "@/lib/web-stream";

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
  //    platform's media-fetch fleet). SHARE-A3/A4/A12: it is now FAIL-CLOSED when the counter is
  //    unreachable, with a short grace window for a client who is already looking and an alert
  //    so the outage is not silent — all three at lib/media-proxy-access.ts, where the reasons
  //    are written. 429, not 404: "too fast" is an honest answer to a caller who already proved
  //    the link is theirs, and `Retry-After` says how long.
  const admission = await admitMediaProxyRequest(req.headers);
  if (!admission.admitted) {
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(admission.retryAfterSeconds) },
    });
  }

  // 4) SHARE-A7 — a token minted for a share-preview post's media names the SharePreviewToken row
  //    it belongs to (`shareRowId`); a publish-worker or Copy-link token never sets this claim, so
  //    their requests are unaffected. This token's own HMAC expiry is short but independent of the
  //    share link's — a merchant hitting Revoke must kill an already-loaded image AT ONCE, not wait
  //    for that separate clock to run out, so we ask the row's live status on every request instead.
  if (claims.shareRowId && !(await isSharePreviewRowLive(claims.shareRowId))) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const { ext } = parseStorageKey(claims.key); // rejects traversal / malformed keys
    // SHARE-A1/A2 — STREAM, never buffer. This used to be `storage.get()` → `Buffer.from(bytes)`,
    // which parked the WHOLE object in this process: a legitimate request for one 2 GB upload
    // (the cap in packages/core/src/upload.ts) was enough to exhaust the web process's memory,
    // and an anonymous caller holding one valid link could ask for it as often as the gate above
    // allows (#1053 finding 1). Now the bytes flow straight from the driver to the response, and
    // a `Range:` request reads ONLY the requested span out of storage.
    const headers: Record<string, string> = {
      "Content-Type": mimeOf(ext),
      // never cache a signed, tenant-scoped payload; don't let it leak via referrers
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      // Say so explicitly: a player that does not see this header will not even try to seek.
      "Accept-Ranges": "bytes",
    };

    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      // The total is only needed to resolve a range (open-ended and suffix forms both need it),
      // so the plain 200 path below still costs exactly one storage call, as it did before.
      const total = await storage.sizeOf(claims.key);
      if (total === null) return new NextResponse("Not found", { status: 404 });
      const range = parseByteRange(rangeHeader, total);
      if (range === "unsatisfiable") {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
      }
      if (range) {
        const body = toWebStream(await storage.readStream(claims.key, range));
        return new NextResponse(body, {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
            "Content-Length": String(range.end - range.start + 1),
          },
        });
      }
      // range === null: a shape we do not serve (multi-range, a unit that is not bytes). RFC 9110
      // lets us ignore it, and falling through to the full 200 below is what we do.
    }

    return new NextResponse(toWebStream(await storage.readStream(claims.key)), { headers });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
