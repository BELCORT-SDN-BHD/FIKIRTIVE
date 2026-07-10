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
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

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
