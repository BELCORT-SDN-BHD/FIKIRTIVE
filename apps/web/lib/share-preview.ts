/**
 * share-preview — the AUTHORITY layer for seat-less share links (B0-28, NODE-275 收口2).
 *
 * The spec (B4 block spec §2.2) freezes "内部写一行 token 记录": every mint writes ONE
 * SharePreviewToken row, and that ROW — not the HMAC alone — is what grants access.
 * Layering:
 *   - HMAC token (packages/token-crypto signSharePreviewToken) = TRANSPORT layer: tamper-evident,
 *     owner+post-bound, time-boxed. A forged/expired token dies here without touching the DB.
 *   - SharePreviewToken row = AUTHORITY layer: per-token audit (one row per mint) and revocation
 *     (revokedAt). verify = HMAC valid ∧ row live (present ∧ unrevoked ∧ unexpired).
 * The row stores SHA-256(token) (tokenDigest), never the token — a DB leak cannot mint working
 * links. Every failure mode returns null = the caller's fail-closed 404 (越权静默 404).
 *
 * Anonymous-safe by construction: the seat-less preview route has no session, but the row lookup
 * pins BOTH the unique tokenDigest AND the HMAC-attested ownerId/postId, so a token can only ever
 * resolve to the exact row its own mint created (owner iron-curtain preserved without a session).
 */
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@fikirtive/db";
import { verifySharePreviewToken } from "@fikirtive/token-crypto";

/** SHA-256 hex of the signed token — the row's lookup key. Stored instead of the token itself. */
export function sharePreviewTokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type SharePreviewAccess = { ownerId: string; postId: string; exp: number; rowId: string };

/**
 * Full two-layer verification for a share-preview token. Returns the attested claims + row id,
 * or null (never throws) — null is the read route's fail-closed 404. Checks, in order:
 *   1. HMAC + TTL (transport): forged / tampered / expired / secret-unset → null, zero DB reads.
 *   2. Row liveness (authority): the mint row must exist for this exact digest AND the token's own
 *      (ownerId, postId), be unrevoked, and be unexpired server-side.
 */
export async function verifySharePreview(
  token: string,
  now: number = Date.now(),
): Promise<SharePreviewAccess | null> {
  const secret = process.env.SHARE_PREVIEW_SECRET ?? "";
  const claims = verifySharePreviewToken(token, secret, now);
  if (!claims) return null;
  const row = await prisma.sharePreviewToken.findFirst({
    where: {
      tokenDigest: sharePreviewTokenDigest(token),
      ownerId: claims.ownerId,
      scheduledPostId: claims.postId,
      revokedAt: null,
      expiresAt: { gt: new Date(now) },
    },
    select: { id: true },
  });
  if (!row) return null;
  return { ownerId: claims.ownerId, postId: claims.postId, exp: claims.exp, rowId: row.id };
}
