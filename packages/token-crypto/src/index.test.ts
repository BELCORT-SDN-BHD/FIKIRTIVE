import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "./index.js";

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
