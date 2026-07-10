/**
 * Shared AES-256-GCM token encryption (L1 spec §四B).
 *
 * Extracted from apps/web/lib/token-encryption.ts so BOTH the web app (OAuth
 * connect) and the publish worker (decrypting a page access token to publish)
 * can encrypt/decrypt Meta tokens WITHOUT the worker reverse-importing
 * apps/web/lib. apps/web/lib/token-encryption.ts now re-exports from here, so
 * every existing web importer is unchanged.
 *
 * Key: TOKEN_ENCRYPTION_KEY = 32 bytes as 64 hex chars. Ciphertext format:
 *   base64(iv).base64(tag).base64(ciphertext)   (random 12-byte IV per call)
 */
import { randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const k = Buffer.from(hex, "hex");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return k;
}

/** Encrypt → "base64(iv).base64(tag).base64(ciphertext)" with a random 12-byte IV per call. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/** Decrypt; throws if the key is wrong or the ciphertext/tag was tampered (GCM auth). */
export function decryptToken(enc: string): string {
  const parts = enc.split(".");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/* ── Signed media-proxy token (L1 spec §四C, Plan B) ──────────────────────────
 *
 * IG only fetches media from a PUBLIC URL, but our media lives in a private,
 * owner-namespaced R2 bucket (宪法 6 铁幕). The publish worker signs a short-lived
 * HMAC token over (ownerId + storage key + expiry); the public route
 * /api/media/pub/<token> verifies it server-side, re-checks the key is in the
 * token owner's namespace, and streams the bytes back to Meta. No session, no
 * public bucket — owner-scoped, time-boxed, tamper-evident.
 *
 * Format:  base64url(JSON{o,k,exp}) + "." + base64url(HMAC-SHA256(payload)).
 * The secret is passed in by the caller (web route / worker) so this stays PURE
 * + unit-testable; both sides read the SAME env (MEDIA_PROXY_SECRET). */

export type MediaTokenClaims = { ownerId: string; key: string; exp: number };

function hmacB64url(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Sign a media-proxy token. `expMs` is an absolute epoch-ms expiry (worker sets
 *  now + a TTL that comfortably covers Meta's async media pull, spec A5). */
export function signMediaToken(ownerId: string, key: string, expMs: number, secret: string): string {
  if (!secret) throw new Error("MEDIA_PROXY_SECRET is not set");
  const payload = Buffer.from(JSON.stringify({ o: ownerId, k: key, exp: expMs })).toString("base64url");
  return `${payload}.${hmacB64url(payload, secret)}`;
}

/** Verify a media-proxy token: constant-time HMAC compare + TTL. Returns the
 *  claims or null (never throws) — a null result is the route's fail-closed 404. */
export function verifyMediaToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): MediaTokenClaims | null {
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmacB64url(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: { o?: unknown; k?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.o !== "string" || typeof parsed.k !== "string" || typeof parsed.exp !== "number") return null;
  if (now > parsed.exp) return null;
  return { ownerId: parsed.o, key: parsed.k, exp: parsed.exp };
}
