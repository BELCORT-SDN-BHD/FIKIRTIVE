/**
 * parseMetaSignedRequest — Meta data-deletion 回调的签名验证(2026-07-04 法务盲区)。
 * signed_request = base64url(HMAC-SHA256 sig) + "." + base64url(JSON payload)。
 * 签名就是这个端点的全部鉴权 —— 验证必须 fail-closed。
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { parseMetaSignedRequest } from "../meta-signed-request";

const SECRET = "test-app-secret";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: object, secret = SECRET): string {
  const encoded = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret).update(encoded).digest());
  return `${sig}.${encoded}`;
}

describe("parseMetaSignedRequest", () => {
  const payload = { user_id: "1234567890", algorithm: "HMAC-SHA256", issued_at: 1783150000 };

  it("parses a correctly signed request", () => {
    expect(parseMetaSignedRequest(sign(payload), SECRET)).toEqual({ userId: "1234567890" });
  });

  it("rejects a request signed with the WRONG secret", () => {
    expect(parseMetaSignedRequest(sign(payload, "attacker-secret"), SECRET)).toBeNull();
  });

  it("rejects a tampered payload (sig no longer matches)", () => {
    const good = sign(payload);
    const [sig] = good.split(".");
    const tampered = b64url(Buffer.from(JSON.stringify({ ...payload, user_id: "999" })));
    expect(parseMetaSignedRequest(`${sig}.${tampered}`, SECRET)).toBeNull();
  });

  it("rejects an unexpected algorithm declaration", () => {
    expect(parseMetaSignedRequest(sign({ ...payload, algorithm: "MD5" }), SECRET)).toBeNull();
  });

  it("rejects malformed inputs without throwing", () => {
    expect(parseMetaSignedRequest("", SECRET)).toBeNull();
    expect(parseMetaSignedRequest("no-dot-here", SECRET)).toBeNull();
    expect(parseMetaSignedRequest("a.b.c", SECRET)).toBeNull();
    expect(parseMetaSignedRequest("!!.@@", SECRET)).toBeNull();
  });

  it("rejects a payload without a user_id", () => {
    expect(parseMetaSignedRequest(sign({ algorithm: "HMAC-SHA256" }), SECRET)).toBeNull();
  });
});
