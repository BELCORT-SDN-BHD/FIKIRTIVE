import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptToken,
  decryptToken,
  signMediaToken,
  verifyMediaToken,
  signSharePreviewToken,
  verifySharePreviewToken,
} from "./index.js";

beforeAll(() => {
  // 32-byte key as 64 hex chars
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
});

describe("token-crypto (AES-256-GCM)", () => {
  it("round-trips a token", () => {
    const t = "EAAB_long_lived_meta_token_xyz";
    expect(decryptToken(encryptToken(t))).toBe(t);
  });
  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });
  it("throws on a tampered ciphertext (GCM auth)", () => {
    const enc = encryptToken("secret");
    const [ivB64, tagB64, ctB64] = enc.split(".") as [string, string, string];
    const ct = Buffer.from(ctB64, "base64"); ct[0]! ^= 0xff; // flip a byte
    const tampered = [ivB64, tagB64, ct.toString("base64")].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });
  it("throws when the key is the wrong length", () => {
    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = "abcd"; // too short
    expect(() => encryptToken("x")).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = prev;
  });
});

describe("media-proxy token (HMAC, Plan B §四C)", () => {
  const SECRET = "media-secret-abc";
  const KEY = "u/org_1/" + "a".repeat(64) + ".jpg";
  const now = 1_000_000_000_000;

  it("round-trips ownerId + key + exp", () => {
    const t = signMediaToken("org_1", KEY, now + 3600_000, SECRET);
    expect(verifyMediaToken(t, SECRET, now)).toEqual({ ownerId: "org_1", key: KEY, exp: now + 3600_000 });
  });
  it("rejects a tampered payload (owner swap keeps the old signature)", () => {
    const t = signMediaToken("org_1", KEY, now + 3600_000, SECRET);
    const dot = t.lastIndexOf(".");
    const forged = Buffer.from(JSON.stringify({ o: "org_2", k: KEY, exp: now + 3600_000 })).toString("base64url");
    expect(verifyMediaToken(`${forged}.${t.slice(dot + 1)}`, SECRET, now)).toBeNull();
  });
  it("rejects a tampered signature", () => {
    const t = signMediaToken("org_1", KEY, now + 3600_000, SECRET);
    expect(verifyMediaToken(t.slice(0, -2) + "zz", SECRET, now)).toBeNull();
  });
  it("rejects a token signed with a different secret", () => {
    const t = signMediaToken("org_1", KEY, now + 3600_000, SECRET);
    expect(verifyMediaToken(t, "other-secret", now)).toBeNull();
  });
  it("rejects an expired token", () => {
    const t = signMediaToken("org_1", KEY, now + 1000, SECRET);
    expect(verifyMediaToken(t, SECRET, now + 2000)).toBeNull();
    expect(verifyMediaToken(t, SECRET, now)).not.toBeNull();
  });
  it("fails closed when the secret is empty (sign throws, verify returns null)", () => {
    expect(() => signMediaToken("org_1", KEY, now + 1000, "")).toThrow();
    expect(verifyMediaToken("anything.sig", "", now)).toBeNull();
  });
  it("rejects malformed input", () => {
    expect(verifyMediaToken("garbage", SECRET, now)).toBeNull();
  });
});

describe("share-preview token (HMAC, B0-28 §2.2)", () => {
  const SECRET = "share-secret-xyz";
  const now = 1_800_000_000_000;

  it("round-trips owner + post + expiry", () => {
    const t = signSharePreviewToken("org_1", "post_9", now + 3600_000, SECRET);
    expect(verifySharePreviewToken(t, SECRET, now)).toEqual({ ownerId: "org_1", postId: "post_9", exp: now + 3600_000 });
  });
  it("owner isolation: a tampered payload (swap owner/post) fails the HMAC → null", () => {
    const t = signSharePreviewToken("org_1", "post_9", now + 3600_000, SECRET);
    const dot = t.lastIndexOf(".");
    const forged = Buffer.from(JSON.stringify({ o: "org_2", p: "post_9", exp: now + 3600_000 })).toString("base64url");
    expect(verifySharePreviewToken(`${forged}.${t.slice(dot + 1)}`, SECRET, now)).toBeNull();
  });
  it("rejects a tampered signature", () => {
    const t = signSharePreviewToken("org_1", "post_9", now + 3600_000, SECRET);
    expect(verifySharePreviewToken(t.slice(0, -2) + "zz", SECRET, now)).toBeNull();
  });
  it("rejects a token signed with a different secret", () => {
    const t = signSharePreviewToken("org_1", "post_9", now + 3600_000, SECRET);
    expect(verifySharePreviewToken(t, "other-secret", now)).toBeNull();
  });
  it("expires (越权/过期 → null → route 404)", () => {
    const t = signSharePreviewToken("org_1", "post_9", now + 1000, SECRET);
    expect(verifySharePreviewToken(t, SECRET, now + 2000)).toBeNull();
    expect(verifySharePreviewToken(t, SECRET, now)).not.toBeNull();
  });
  it("fails closed when the secret is unset", () => {
    expect(() => signSharePreviewToken("org_1", "post_9", now + 1000, "")).toThrow();
    expect(verifySharePreviewToken("anything.sig", "", now)).toBeNull();
  });
  it("rejects malformed input", () => {
    expect(verifySharePreviewToken("garbage", SECRET, now)).toBeNull();
  });
});
