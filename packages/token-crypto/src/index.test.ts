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

  // SHARE-A7(docs/specs/share-preview.md 已冻结 · v1)—— 可选的第五个参数,只有分享预览页
  // 才传;不传的调用方(发布 worker、素材面板的 Copy link)行为一个字节不变(上面那条
  // round-trip 测试就是证据:不传时 `.toEqual` 里压根没有 shareRowId 这个键)。
  it("SHARE-A7 —— 传了 shareRowId 时原样带回来", () => {
    const t = signMediaToken("org_1", KEY, now + 3600_000, SECRET, "row_42");
    expect(verifyMediaToken(t, SECRET, now)).toEqual({
      ownerId: "org_1",
      key: KEY,
      exp: now + 3600_000,
      shareRowId: "row_42",
    });
  });
  it("SHARE-A7 —— shareRowId 一样受 HMAC 保护,篡改它令牌照样作废", () => {
    const t = signMediaToken("org_1", KEY, now + 3600_000, SECRET, "row_42");
    const dot = t.lastIndexOf(".");
    const forged = Buffer.from(JSON.stringify({ o: "org_1", k: KEY, exp: now + 3600_000, s: "row_other" })).toString(
      "base64url",
    );
    expect(verifyMediaToken(`${forged}.${t.slice(dot + 1)}`, SECRET, now)).toBeNull();
  });
  it("SHARE-A11(docs/specs/share-preview.md 已冻结 · v1)—— 载荷是签名过的明文,不是加密:任何持有者不解密就能读出 owner/key/expiry", () => {
    const t = signMediaToken("org_1", KEY, now + 3600_000, SECRET);
    const payload = t.slice(0, t.lastIndexOf("."));
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(decoded).toEqual({ o: "org_1", k: KEY, exp: now + 3600_000 });
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

  it("SHARE-A11(docs/specs/share-preview.md 已冻结 · v1)—— 载荷是签名过的明文,持有链接的人不需要密钥就能读出 ownerId/postId/expiry", () => {
    const t = signSharePreviewToken("org_1", "post_9", now + 3600_000, SECRET);
    const payload = t.slice(0, t.lastIndexOf("."));
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(decoded).toEqual({ o: "org_1", p: "post_9", exp: now + 3600_000 });
  });
});
