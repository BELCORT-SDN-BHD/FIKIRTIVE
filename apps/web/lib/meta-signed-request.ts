/**
 * parseMetaSignedRequest — Meta 回调(data-deletion / deauthorize)的 signed_request
 * 验证(2026-07-04 法务盲区修复)。格式:base64url(HMAC-SHA256 sig) + "." +
 * base64url(JSON payload);签名覆盖的是 base64url 编码后的 payload 字符串本身。
 * 签名是该端点的全部鉴权 —— 任何解析/校验失败一律返回 null(fail-closed),
 * 比较用 timingSafeEqual 防时序侧信道。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function parseMetaSignedRequest(signedRequest: string, appSecret: string): { userId: string } | null {
  const dot = signedRequest.indexOf(".");
  if (dot <= 0 || signedRequest.indexOf(".", dot + 1) !== -1) return null;
  const sigB64 = signedRequest.slice(0, dot);
  const payloadB64 = signedRequest.slice(dot + 1);
  try {
    const expected = createHmac("sha256", appSecret).update(payloadB64).digest();
    const given = Buffer.from(sigB64, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      user_id?: unknown;
      algorithm?: unknown;
    };
    if (payload.algorithm !== "HMAC-SHA256") return null;
    if (typeof payload.user_id !== "string" && typeof payload.user_id !== "number") return null;
    const userId = String(payload.user_id);
    if (!userId) return null;
    return { userId };
  } catch {
    return null;
  }
}
