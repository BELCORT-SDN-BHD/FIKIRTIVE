/**
 * SHARE-A6(docs/specs/share-preview.md 已冻结 · v1)—— `/s/<token>` 干净入口的行为契约:
 * 把 URL 里的 token 换成一个 HttpOnly cookie,再 303 到没有 query 的干净地址。不在这里验证
 * token 本身(那是 `loadSharePreview` 的事,`lib/__tests__/share-preview-view.test.ts` 已经
 * 证过每一种坏形状都归一到同一个 unavailable) —— 这份文件只证明「搬家」这一件事做对了。
 */
import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { signSharePreviewToken } from "@fikirtive/token-crypto";
import { SHARE_PREVIEW_COOKIE_NAME, SHARE_PREVIEW_COOKIE_PATH } from "@/lib/share-preview-cookie";

const { GET } = await import("@/app/s/[token]/route");

const SECRET = "share-secret-route-s";

function req(): NextRequest {
  return { nextUrl: new URL("https://app.test/s/whatever") } as unknown as NextRequest;
}
const call = (token: string) => GET(req(), { params: Promise.resolve({ token }) });

describe("/s/[token] — SHARE-A6 clean share-preview entry", () => {
  it("303s to the clean address, no query string, no token in the Location", async () => {
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 3_600_000, SECRET);
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call(token);
    expect(res.status).toBe(303);
    expect(res.url).toBe(`https://app.test${SHARE_PREVIEW_COOKIE_PATH}`);
    expect(res.url).not.toContain("?");
    expect(res.url).not.toContain(token);
  });

  it("sets an HttpOnly cookie carrying the token, scoped to the preview page's own path", async () => {
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 3_600_000, SECRET);
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call(token);
    const cookie = res.cookies.get(SHARE_PREVIEW_COOKIE_NAME);
    expect(cookie?.value).toBe(token);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe(SHARE_PREVIEW_COOKIE_PATH);
  });

  it("a valid token's cookie lives roughly as long as the token's own remaining expiry", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 600_000, SECRET); // 10 min out
    const res = await call(token);
    const maxAge = res.cookies.get(SHARE_PREVIEW_COOKIE_NAME)?.maxAge as number;
    expect(maxAge).toBeGreaterThan(590);
    expect(maxAge).toBeLessThanOrEqual(600);
  });

  it("still redirects AND still sets a cookie for a forged/garbage token — verification is the page's job, not this route's", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call("garbage.sig");
    expect(res.status).toBe(303);
    expect(res.url).toBe(`https://app.test${SHARE_PREVIEW_COOKIE_PATH}`);
    // A token that will never verify still gets a (short-lived) cookie: the redirect target is
    // unconditional, and `loadSharePreview` fails it closed to the same "unavailable" page either way.
    expect(res.cookies.get(SHARE_PREVIEW_COOKIE_NAME)?.value).toBe("garbage.sig");
  });

  it("an unverifiable token's cookie gets a short fallback lifetime, not a long-lived one", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call("garbage.sig");
    const maxAge = res.cookies.get(SHARE_PREVIEW_COOKIE_NAME)?.maxAge as number;
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(600); // FALLBACK_COOKIE_MAX_AGE_SECONDS
  });
});
